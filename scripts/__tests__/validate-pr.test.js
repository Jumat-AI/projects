const { test, describe, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const yaml = require('js-yaml');

const { validateProjectDir } = require('../validate-pr.js');

const SLUG = 'demo-app';
const SECOND = `${SLUG}-cache`;
const DIGEST = 'sha256:' + 'a'.repeat(64);
const REDIS_IMAGE = `redis:7-alpine@${DIGEST}`;
const REPO_ROOT = path.join(__dirname, '..', '..');
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'validate-pr-test-'));
after(() => fs.rmSync(tmpRoot, { recursive: true, force: true }));

let counter = 0;

function baseCompose() {
  return {
    services: {
      [SLUG]: {
        container_name: `jumat-ai-${SLUG}`,
        build: { context: '.' },
        restart: 'unless-stopped',
        expose: ['80'],
        networks: ['traefik-net'],
        volumes: ['data:/data'],
        // Bersama secondService() (0.25 + 128M) total tepat di jatah per proyek: 0.5 vCPU & 512M
        deploy: { resources: { limits: { cpus: '0.25', memory: '384M' } } },
        labels: [
          'traefik.enable=true',
          'traefik.docker.network=jumat-ai-web',
          `traefik.http.routers.${SLUG}.rule=Host(\`projects.jumat.ai.id\`) && PathPrefix(\`/${SLUG}\`)`,
          `traefik.http.routers.${SLUG}.entrypoints=websecure`,
          `traefik.http.routers.${SLUG}.tls=true`,
          `traefik.http.middlewares.${SLUG}-strip.stripprefix.prefixes=/${SLUG}`,
          `traefik.http.routers.${SLUG}.middlewares=${SLUG}-strip`,
          `traefik.http.services.${SLUG}.loadbalancer.server.port=80`
        ]
      }
    },
    volumes: { data: null },
    networks: { 'traefik-net': { name: 'jumat-ai-web', external: true } }
  };
}

function secondService(extra = {}) {
  return {
    image: REDIS_IMAGE,
    networks: ['internal'],
    deploy: { resources: { limits: { cpus: '0.25', memory: '128M' } } },
    ...extra
  };
}

/**
 * Buat folder proyek fixture. `mutate(doc, dir)` boleh mengubah objek compose;
 * `opts.rawCompose` mengganti isi docker-compose.yml; `opts.setup(dir)` menambah file.
 */
function makeProject(mutate, opts = {}) {
  const slug = opts.slug || SLUG;
  const dir = path.join(fs.mkdtempSync(path.join(tmpRoot, `p${counter++}-`)), slug);
  fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir, 'project.json'), JSON.stringify({
    slug,
    title: 'Demo',
    description: 'Proyek uji',
    author: { name: 'Penguji', github: 'penguji' },
    repo_url: 'https://github.com/penguji/demo'
  }));
  fs.writeFileSync(path.join(dir, 'Dockerfile'), 'FROM nginx:alpine\nCOPY . /usr/share/nginx/html\n');
  const doc = baseCompose();
  if (mutate) mutate(doc, dir);
  fs.writeFileSync(path.join(dir, 'docker-compose.yml'), opts.rawCompose ?? yaml.dump(doc));
  if (opts.setup) opts.setup(dir);
  return { slug, dir };
}

function errorsOf(mutate, opts) {
  const { slug, dir } = makeProject(mutate, opts);
  return validateProjectDir(slug, dir);
}

function assertRejected(errors, pattern) {
  assert.ok(errors.length > 0, 'seharusnya ada error, tetapi validasi lolos');
  if (pattern) {
    assert.ok(errors.some((e) => pattern.test(e)), `tidak ada error yang cocok ${pattern}. Error:\n${errors.join('\n')}`);
  }
}

// Tambah service kedua yang sah ke compose dasar, lalu terapkan perubahan
function withSecond(extra, docMutate) {
  return (doc) => {
    doc.services[SECOND] = secondService(extra);
    doc.networks.internal = {};
    if (docMutate) docMutate(doc);
  };
}

describe('baseline', () => {
  test('compose valid lolos tanpa error', () => {
    assert.deepEqual(errorsOf(), []);
  });

  test('compose valid dengan service kedua yang sah lolos', () => {
    assert.deepEqual(errorsOf(withSecond({})), []);
  });

  test('template proyek asli lolos', () => {
    const dir = path.join(REPO_ROOT, 'projects', '_template');
    assert.deepEqual(validateProjectDir('_template', dir), []);
  });

  test('proyek gemini-prompt-crafter asli lolos', () => {
    const dir = path.join(REPO_ROOT, 'projects', 'gemini-prompt-crafter');
    assert.deepEqual(validateProjectDir('gemini-prompt-crafter', dir), []);
  });

  test('environment dengan nilai literal diizinkan', () => {
    assert.deepEqual(errorsOf((d) => { d.services[SLUG].environment = { NODE_ENV: 'production', PORT: 80 }; }), []);
  });

  test('tmpfs diizinkan (short dan long syntax)', () => {
    assert.deepEqual(errorsOf((d) => {
      d.services[SLUG].tmpfs = ['/tmp'];
      d.services[SLUG].volumes.push({ type: 'tmpfs', target: '/run' });
    }), []);
  });

  test('label berbentuk map diizinkan', () => {
    assert.deepEqual(errorsOf((d) => {
      const arr = d.services[SLUG].labels;
      d.services[SLUG].labels = Object.fromEntries(arr.map((l) => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1)]; }));
    }), []);
  });
});

describe('A. key service & allowlist (semua service)', () => {
  test('service kedua privileged ditolak', () => {
    assertRejected(errorsOf(withSecond({ privileged: true })), /cache.*privileged/);
  });

  test('ports di service utama ditolak', () => {
    assertRejected(errorsOf((d) => { d.services[SLUG].ports = ['8080:80']; }), /'demo-app'.*ports/);
  });

  test('ports di service kedua ditolak', () => {
    assertRejected(errorsOf(withSecond({ ports: ['6379:6379'] })), /cache.*ports/);
  });

  test('ports dalam compose mentah (raw text) tetap ditolak', () => {
    const raw = yaml.dump(baseCompose()).replace('    expose:', '    ports:\n      - "8080:80"\n    expose:');
    assertRejected(errorsOf(null, { rawCompose: raw }), /ports/);
  });

  test('network_mode host ditolak', () => {
    assertRejected(errorsOf(withSecond({ network_mode: 'host' })), /network_mode/);
  });

  test('pid host ditolak', () => {
    assertRejected(errorsOf(withSecond({ pid: 'host' })), /'pid'/);
  });

  for (const key of ['ipc', 'uts', 'userns_mode', 'cgroup', 'cgroup_parent', 'runtime', 'isolation', 'oom_kill_disable', 'oom_score_adj', 'platform', 'profiles', 'extends', 'logging']) {
    test(`key '${key}' ditolak`, () => {
      assertRejected(errorsOf(withSecond({ [key]: key === 'profiles' ? ['x'] : 'host' })), new RegExp(`'${key}'`));
    });
  }

  test('cap_add ditolak', () => {
    assertRejected(errorsOf(withSecond({ cap_add: ['SYS_ADMIN'] })), /cap_add/);
  });

  test('devices ditolak', () => {
    assertRejected(errorsOf(withSecond({ devices: ['/dev/sda:/dev/sda'] })), /devices/);
  });

  test('volumes_from ditolak', () => {
    assertRejected(errorsOf(withSecond({ volumes_from: ['container:traefik'] })), /volumes_from/);
  });

  test('external_links / links / group_add / sysctls / ulimits ditolak', () => {
    for (const [k, v] of [['external_links', ['x']], ['links', ['x']], ['group_add', ['docker']], ['sysctls', { a: 1 }], ['ulimits', { nofile: 1 }], ['dns', ['1.1.1.1']], ['extra_hosts', ['a:1.1.1.1']]]) {
      assertRejected(errorsOf(withSecond({ [k]: v })), new RegExp(`'${k}'`));
    }
  });

  test('device_cgroup_rules ditolak', () => {
    assertRejected(errorsOf(withSecond({ device_cgroup_rules: ['c 1:3 mr'] })), /device_cgroup_rules/);
  });

  test('security_opt selain no-new-privileges:true ditolak', () => {
    assertRejected(errorsOf(withSecond({ security_opt: ['seccomp:unconfined'] })), /security_opt/);
    assertRejected(errorsOf(withSecond({ security_opt: ['apparmor:unconfined'] })), /security_opt/);
  });

  test('security_opt no-new-privileges:true diizinkan', () => {
    assert.deepEqual(errorsOf(withSecond({ security_opt: ['no-new-privileges:true'] })), []);
  });
});

describe('A. deploy / resource limit', () => {
  test('deploy hilang di service kedua ditolak', () => {
    assertRejected(errorsOf(withSecond({}, (d) => { delete d.services[SECOND].deploy; })), /cache.*deploy\.resources\.limits/);
  });

  test('limits hilang di service kedua ditolak', () => {
    assertRejected(errorsOf(withSecond({}, (d) => { d.services[SECOND].deploy = { resources: {} }; })), /cache.*limits/);
  });

  test('cpus > 0.5 di service kedua ditolak', () => {
    assertRejected(errorsOf(withSecond({}, (d) => { d.services[SECOND].deploy.resources.limits.cpus = '2'; })), /cache.*CPU/);
  });

  test('memory > 512M di service kedua ditolak', () => {
    assertRejected(errorsOf(withSecond({}, (d) => { d.services[SECOND].deploy.resources.limits.memory = '2G'; })), /cache.*Memory/);
  });

  test('memory tanpa unit valid yang tidak dikenal ditolak', () => {
    assertRejected(errorsOf((d) => { d.services[SLUG].deploy.resources.limits.memory = '1x'; }), /Memory/);
  });

  test('deploy dengan key selain resources ditolak', () => {
    assertRejected(errorsOf((d) => { d.services[SLUG].deploy.replicas = 50; }), /deploy\.replicas/);
  });

  test('reservations (devices) ditolak', () => {
    assertRejected(errorsOf((d) => {
      d.services[SLUG].deploy.resources.reservations = { devices: [{ capabilities: ['gpu'] }] };
    }), /reservations\.devices/);
  });

  test('reservations melebihi limit ditolak', () => {
    assertRejected(errorsOf((d) => { d.services[SLUG].deploy.resources.reservations = { cpus: '0.5', memory: '1G' }; }), /Reservasi Memory/);
  });

  test('reservations di bawah limit diizinkan', () => {
    assert.deepEqual(errorsOf((d) => { d.services[SLUG].deploy.resources.reservations = { cpus: '0.25', memory: '256M' }; }), []);
  });
});

describe('A. limit resource per proyek (total semua service)', () => {
  test('satu service dengan jatah penuh 0.5 vCPU & 512M lolos', () => {
    assert.deepEqual(errorsOf((d) => { d.services[SLUG].deploy.resources.limits = { cpus: '0.5', memory: '512M' }; }), []);
  });

  test('total tepat di batas (0.25 + 0.25, 384M + 128M) lolos', () => {
    assert.deepEqual(errorsOf(withSecond({})), []);
  });

  test('total galat floating point (0.25 + 0.15 + 0.1) tetap lolos', () => {
    assert.deepEqual(errorsOf(withSecond({}, (d) => {
      d.services[SECOND].deploy.resources.limits.cpus = '0.15';
      d.services[`${SLUG}-cache2`] = secondService({ deploy: { resources: { limits: { cpus: '0.1', memory: '0.000001M' } } } });
      d.services[SLUG].deploy.resources.limits.memory = '383M';
    })), []);
  });

  test('dua service masing-masing 0.5 vCPU (total 1.0) ditolak', () => {
    assertRejected(errorsOf(withSecond({}, (d) => {
      d.services[SLUG].deploy.resources.limits.cpus = '0.5';
      d.services[SECOND].deploy.resources.limits.cpus = '0.5';
    })), /Total batasan CPU.*1 vCPU/);
  });

  test('total CPU sedikit di atas batas (0.25 + 0.26) ditolak', () => {
    assertRejected(errorsOf(withSecond({}, (d) => {
      d.services[SECOND].deploy.resources.limits.cpus = '0.26';
    })), /Total batasan CPU/);
  });

  test('total memory melebihi 512M (384M + 256M) ditolak', () => {
    assertRejected(errorsOf(withSecond({}, (d) => {
      d.services[SECOND].deploy.resources.limits.memory = '256M';
    })), /Total batasan Memory.*640 MB/);
  });

  test('total memory dengan unit campuran (0.5G + 128M) ditolak', () => {
    assertRejected(errorsOf(withSecond({}, (d) => {
      d.services[SLUG].deploy.resources.limits.memory = '0.5G';
    })), /Total batasan Memory/);
  });

  test('tiga service yang masing-masing sah tapi totalnya melebihi jatah ditolak', () => {
    assertRejected(errorsOf(withSecond({}, (d) => {
      d.services[`${SLUG}-cache2`] = secondService();
    })), /Total batasan (CPU|Memory)/);
  });
});

describe('A. volumes', () => {
  test("bind mount '/' di service kedua ditolak", () => {
    assertRejected(errorsOf(withSecond({ volumes: ['/:/host'] })), /cache.*bind-mount/);
  });

  test('bind mount docker.sock ditolak', () => {
    assertRejected(errorsOf((d) => { d.services[SLUG].volumes.push('/var/run/docker.sock:/var/run/docker.sock'); }), /bind-mount/);
  });

  test("bind mount relatif '../..' ditolak", () => {
    assertRejected(errorsOf((d) => { d.services[SLUG].volumes.push('../..:/host'); }), /bind-mount/);
  });

  test("bind mount './data' ditolak", () => {
    assertRejected(errorsOf((d) => { d.services[SLUG].volumes.push('./data:/data2'); }), /bind-mount/);
  });

  test("bind mount '~' ditolak", () => {
    assertRejected(errorsOf((d) => { d.services[SLUG].volumes.push('~/.ssh:/ssh'); }), /bind-mount/);
  });

  test("bind mount dengan '$' ditolak", () => {
    assertRejected(errorsOf((d) => { d.services[SLUG].volumes.push('${HOME}:/h'); }), /Interpolasi|bind-mount/);
  });

  test("source mengandung '\\' ditolak", () => {
    assertRejected(errorsOf((d) => { d.services[SLUG].volumes.push('C:\\Users:/h'); }), /./);
  });

  test('long syntax type bind ditolak', () => {
    assertRejected(errorsOf((d) => { d.services[SLUG].volumes.push({ type: 'bind', source: '/', target: '/host' }); }), /bertipe 'bind'/);
  });

  test('long syntax tanpa type ditolak', () => {
    assertRejected(errorsOf((d) => { d.services[SLUG].volumes.push({ source: '/', target: '/host' }); }), /type/);
  });

  test('long syntax type volume dengan source tak dideklarasikan ditolak', () => {
    assertRejected(errorsOf((d) => { d.services[SLUG].volumes.push({ type: 'volume', source: 'hantu', target: '/x' }); }), /hantu/);
  });

  test('long syntax type volume dengan named volume diizinkan', () => {
    assert.deepEqual(errorsOf((d) => { d.services[SLUG].volumes.push({ type: 'volume', source: 'data', target: '/x' }); }), []);
  });

  test('named volume yang tidak dideklarasikan ditolak', () => {
    assertRejected(errorsOf((d) => { d.services[SLUG].volumes.push('belumada:/x'); }), /belumada/);
  });
});

describe('A. build', () => {
  test("build.context '..' ditolak", () => {
    assertRejected(errorsOf((d) => { d.services[SLUG].build.context = '..'; }), /build\.context/);
  });

  test("build.context '../..' di service kedua ditolak", () => {
    assertRejected(errorsOf(withSecond({ build: { context: '../..' } }, (d) => { delete d.services[SECOND].image; })), /cache.*build\.context/);
  });

  test('build.context absolut ditolak', () => {
    assertRejected(errorsOf((d) => { d.services[SLUG].build.context = '/etc'; }), /build\.context/);
  });

  test('build.context URL git ditolak', () => {
    assertRejected(errorsOf((d) => { d.services[SLUG].build = 'https://github.com/x/y.git'; }), /build\.context/);
  });

  test('build.dockerfile di luar folder ditolak', () => {
    assertRejected(errorsOf((d) => { d.services[SLUG].build.dockerfile = '../../Dockerfile'; }), /build\.dockerfile/);
  });

  test('build.dockerfile selain Dockerfile root ditolak', () => {
    assertRejected(errorsOf((d) => { d.services[SLUG].build.dockerfile = 'Dockerfile.evil'; }), /build\.dockerfile/);
  });

  for (const key of ['additional_contexts', 'ssh', 'secrets', 'network', 'extra_hosts', 'privileged', 'entitlements']) {
    test(`build.${key} ditolak`, () => {
      assertRejected(errorsOf((d) => { d.services[SLUG].build[key] = key === 'network' ? 'host' : ['x']; }), new RegExp(`build\\.${key}`));
    });
  }

  test('build.dockerfile_inline ditolak (allowlist)', () => {
    assertRejected(errorsOf((d) => { d.services[SLUG].build.dockerfile_inline = 'FROM evil'; }), /dockerfile_inline/);
  });
});

describe('A. env_file', () => {
  test('env_file relatif di dalam folder diizinkan', () => {
    assert.deepEqual(errorsOf((d) => { d.services[SLUG].env_file = ['./app.env']; }), []);
  });

  test("env_file '../../.ssh/id' ditolak", () => {
    assertRejected(errorsOf((d) => { d.services[SLUG].env_file = ['../../secret.env']; }), /env_file/);
  });

  test('env_file absolut ditolak', () => {
    assertRejected(errorsOf((d) => { d.services[SLUG].env_file = '/etc/shadow'; }), /env_file/);
  });

  test('env_file long syntax di luar folder ditolak', () => {
    assertRejected(errorsOf((d) => { d.services[SLUG].env_file = [{ path: '../x.env' }]; }), /env_file/);
  });
});

describe('A. network & container_name', () => {
  test('network_mode host ditolak (di service utama)', () => {
    assertRejected(errorsOf((d) => { d.services[SLUG].network_mode = 'host'; }), /network_mode/);
  });

  test('service merujuk network yang tidak dideklarasikan ditolak', () => {
    assertRejected(errorsOf(withSecond({ networks: ['gaib'] })), /gaib/);
  });

  test('service traefik tidak tersambung ke jumat-ai-web ditolak', () => {
    assertRejected(errorsOf((d) => { d.networks.lokal = {}; d.services[SLUG].networks = ['lokal']; }), /wajib tersambung ke network/);
  });

  test('service traefik tanpa networks ditolak', () => {
    assertRejected(errorsOf((d) => { delete d.services[SLUG].networks; }), /wajib tersambung ke network/);
  });

  test('aliases pada network bersama ditolak', () => {
    assertRejected(errorsOf((d) => { d.services[SLUG].networks = { 'traefik-net': { aliases: ['traefik'] } }; }), /aliases/);
  });

  test('container_name tanpa prefix ditolak', () => {
    assertRejected(errorsOf((d) => { d.services[SLUG].container_name = 'traefik'; }), /container_name/);
  });

  test('container_name milik slug lain (prefix saja) ditolak', () => {
    assertRejected(errorsOf((d) => { d.services[SLUG].container_name = `jumat-ai-${SLUG}x`; }), /container_name/);
  });

  test('container_name service kedua tanpa prefix ditolak', () => {
    assertRejected(errorsOf(withSecond({ container_name: 'mysql' })), /cache.*container_name/);
  });

  test('container_name dengan sufiks diizinkan', () => {
    assert.deepEqual(errorsOf(withSecond({ container_name: `jumat-ai-${SLUG}-cache` })), []);
  });
});

describe('A. interpolasi', () => {
  test('${HOME} di command ditolak', () => {
    assertRejected(errorsOf((d) => { d.services[SLUG].command = 'echo ${HOME}'; }), /Interpolasi.*command/);
  });

  test('$VAR di image service kedua ditolak', () => {
    assertRejected(errorsOf(withSecond({ image: '$EVIL_IMAGE' })), /Interpolasi.*cache\.image/);
  });

  test('${HOME} di build.args ditolak', () => {
    assertRejected(errorsOf((d) => { d.services[SLUG].build.args = { X: '${HOME}' }; }), /Interpolasi/);
  });

  test('${HOME} di labels ditolak', () => {
    assertRejected(errorsOf((d) => { d.services[SLUG].labels.push('x=${HOME}'); }), /Interpolasi/);
  });

  test('${HOME} di volume source ditolak', () => {
    assertRejected(errorsOf((d) => { d.services[SLUG].volumes.push('${HOME}/x:/x'); }), /Interpolasi/);
  });

  test('interpolasi di key top-level x-* ditolak', () => {
    assertRejected(errorsOf((d) => { d['x-ext'] = { a: '${HOME}' }; }), /Interpolasi/);
  });

  test('$ di nilai environment (map) ditolak', () => {
    assertRejected(errorsOf((d) => { d.services[SLUG].environment = { API_KEY: '${SERVER_API_KEY}' }; }), /Interpolasi.*environment.*nilai literal/);
    assertRejected(errorsOf((d) => { d.services[SLUG].environment = { X: '$HOME' }; }), /Interpolasi/);
  });

  test('$ di environment (array) ditolak, nilai maupun key', () => {
    assertRejected(errorsOf((d) => { d.services[SLUG].environment = ['A=${B}']; }), /Interpolasi/);
    assertRejected(errorsOf((d) => { d.services[SLUG].environment = ['${A}=b']; }), /Interpolasi/);
  });

  test('$$ (escape dolar) tetap ditolak: tidak ada pengecualian untuk $$', () => {
    assertRejected(errorsOf((d) => { d.services[SLUG].environment = { PRICE: '$$5' }; }), /Interpolasi/);
    assertRejected(errorsOf((d) => { d.services[SLUG].command = 'sh -c "echo $$HOME"'; }), /Interpolasi.*command/);
    assertRejected(errorsOf((d) => { d.services[SLUG].healthcheck = { test: ['CMD-SHELL', 'curl -f localhost:$$PORT'] }; }), /Interpolasi.*healthcheck/);
  });
});

describe('nama service', () => {
  test("nama service 'app' ditolak", () => {
    const err = errorsOf((d) => { d.services.app = d.services[SLUG]; delete d.services[SLUG]; });
    assertRejected(err, /Service 'app': nama service wajib/);
  });

  test('nama service kedua tanpa prefix slug ditolak', () => {
    const err = errorsOf((d) => {
      d.services.db = secondService({ image: `postgres:16@${DIGEST}` });
      d.networks.internal = {};
    });
    assertRejected(err, /Service 'db': nama service wajib/);
  });

  test('<slug>-db diizinkan', () => {
    assert.deepEqual(errorsOf((d) => {
      d.services[`${SLUG}-db`] = secondService({ image: `postgres:16@${DIGEST}` });
      d.networks.internal = {};
    }), []);
  });

  test('nama service yang hanya berawalan slug tanpa strip ditolak', () => {
    assertRejected(errorsOf((d) => {
      d.services[`${SLUG}db`] = secondService({ image: `postgres:16@${DIGEST}` });
      d.networks.internal = {};
    }), /nama service wajib/);
  });
});

describe('service image-only (tanpa build)', () => {
  const addImage = (image, extra = {}) => (d) => {
    d.services[`${SLUG}-db`] = secondService({ image, ...extra });
    d.networks.internal = {};
  };
  const PG = `postgres:16@${DIGEST}`;

  for (const repo of ['postgres:16', 'pgvector/pgvector:pg16', 'mysql:8', 'mariadb:11', 'mongo:7', 'redis:7', 'valkey/valkey:8', 'qdrant/qdrant:v1', 'chromadb/chroma:0.5', 'minio/minio:latest', 'quay.io/minio/minio:latest', 'postgres']) {
    test(`image ${repo} dengan digest lolos`, () => {
      assert.deepEqual(errorsOf(addImage(`${repo}@${DIGEST}`)), []);
    });
  }

  test('image allowlist tanpa digest ditolak', () => {
    assertRejected(errorsOf(addImage('postgres:16')), /wajib dipin dengan digest/);
    assertRejected(errorsOf(addImage('postgres')), /wajib dipin dengan digest/);
  });

  test('digest tidak valid (bukan 64 hex) ditolak', () => {
    assertRejected(errorsOf(addImage('postgres:16@sha256:abc')), /digest/);
    assertRejected(errorsOf(addImage(`postgres:16@sha1:${'a'.repeat(40)}`)), /digest/);
  });

  test('image non-allowlist ditolak walau ada digest', () => {
    assertRejected(errorsOf(addImage(`nginx:alpine@${DIGEST}`)), /wajib di-build dari Dockerfile proyek/);
    assertRejected(errorsOf(addImage(`evil/postgres@${DIGEST}`)), /tidak diizinkan/);
    assertRejected(errorsOf(addImage(`ghcr.io/evil/redis@${DIGEST}`)), /tidak diizinkan/);
  });

  test('normalisasi prefix docker.io/, docker.io/library/, library/ dan huruf besar', () => {
    for (const image of ['docker.io/postgres:16', 'docker.io/library/postgres:16', 'library/postgres:16', 'POSTGRES:16', 'docker.io/pgvector/pgvector:pg16']) {
      assert.deepEqual(errorsOf(addImage(`${image}@${DIGEST}`)), [], image);
    }
  });

  test('registry dengan port (host:port) tidak dianggap tag dan ditolak', () => {
    assertRejected(errorsOf(addImage(`localhost:5000/postgres:16@${DIGEST}`)), /tidak diizinkan/);
  });

  test('image-only dengan label traefik apa pun ditolak', () => {
    assertRejected(errorsOf(addImage(PG, { labels: ['traefik.enable=false'] })), /tidak boleh memiliki label traefik/);
    assertRejected(errorsOf(addImage(PG, { labels: { 'traefik.enable': 'true' } })), /tidak boleh memiliki label traefik/);
  });

  test('image-only dengan label non-traefik diizinkan', () => {
    assert.deepEqual(errorsOf(addImage(PG, { labels: ['com.contoh.tim=data'] })), []);
  });

  test('image-only di network jumat-ai-web ditolak', () => {
    assertRejected(errorsOf(addImage(PG, { networks: ['traefik-net'] })), /tidak boleh tersambung ke network 'jumat-ai-web'/);
    assertRejected(errorsOf(addImage(PG, { networks: { 'traefik-net': null } })), /tidak boleh tersambung ke network 'jumat-ai-web'/);
  });

  test('image-only di network internal proyek lolos', () => {
    assert.deepEqual(errorsOf(addImage(PG)), []);
  });

  test('image-only tanpa networks (default network compose) lolos', () => {
    assert.deepEqual(errorsOf(addImage(PG, { networks: undefined })), []);
  });

  test('service dengan build boleh punya image (nama tag hasil build) tanpa digest/allowlist', () => {
    assert.deepEqual(errorsOf((d) => { d.services[SLUG].image = 'jumat-ai/demo-app:latest'; }), []);
  });

  test('service tanpa build dan tanpa image ditolak', () => {
    assertRejected(errorsOf((d) => {
      d.services[`${SLUG}-x`] = { deploy: { resources: { limits: { cpus: '0.25', memory: '128M' } } } };
    }), /wajib punya 'build' atau 'image'/);
  });

  test('aturan resource limit tetap berlaku untuk image-only', () => {
    assertRejected(errorsOf((d) => {
      addImage(PG)(d);
      delete d.services[`${SLUG}-db`].deploy;
    }), /-db'.*deploy\.resources\.limits/);
  });

  test('aturan named-volume tetap berlaku untuk image-only', () => {
    assertRejected(errorsOf(addImage(PG, { volumes: ['/var/lib:/var/lib/postgresql'] })), /bind-mount/);
    assert.deepEqual(errorsOf(addImage(PG, { volumes: ['data:/var/lib/postgresql/data'] })), []);
  });
});

describe('service utama untuk pinning', () => {
  test('service utama = service bernama persis slug, bukan yang pertama', () => {
    const sha = 'c'.repeat(40);
    const dockerfile = 'FROM alpine\nARG REPO_URL\nARG COMMIT_SHA\nRUN git init . && git fetch --depth 1 "$REPO_URL" "${COMMIT_SHA}"\n';
    const { slug, dir } = makeProject((d, p) => {
      const main = d.services[SLUG];
      main.build.args = { REPO_URL: 'https://github.com/penguji/demo.git', COMMIT_SHA: sha };
      const aux = secondService();
      delete aux.image;
      aux.build = { context: '.', args: { REPO_URL: 'https://github.com/penguji/demo.git', COMMIT_SHA: sha } };
      // service tambahan didefinisikan lebih dulu dalam urutan key
      d.services = { [`${SLUG}-aux`]: aux, [SLUG]: main };
      d.networks.internal = {};
      fs.writeFileSync(path.join(p, 'Dockerfile'), dockerfile);
      const meta = JSON.parse(fs.readFileSync(path.join(p, 'project.json'), 'utf8'));
      meta.commit_sha = sha;
      fs.writeFileSync(path.join(p, 'project.json'), JSON.stringify(meta));
    });
    assert.deepEqual(validateProjectDir(slug, dir), []);
  });
});


describe('B. top-level', () => {
  test('include ditolak', () => {
    assertRejected(errorsOf((d) => { d.include = ['../../other/compose.yml']; }), /'include'/);
  });

  for (const key of ['name', 'configs', 'secrets', 'models']) {
    test(`key top-level '${key}' ditolak`, () => {
      assertRejected(errorsOf((d) => { d[key] = { x: {} }; }), new RegExp(`'${key}'`));
    });
  }

  test("key top-level 'version' dan 'x-*' diizinkan", () => {
    assert.deepEqual(errorsOf((d) => { d.version = '3.8'; d['x-common'] = { a: 1 }; }), []);
  });

  test('top-level volume dengan driver_opts bind ditolak', () => {
    assertRejected(errorsOf((d) => {
      d.volumes.data = { driver: 'local', driver_opts: { type: 'none', o: 'bind', device: '/' } };
    }), /Volume top-level 'data'.*(driver|driver_opts)/);
  });

  for (const [key, val] of [['driver', 'local'], ['external', true], ['name', 'volume-orang']]) {
    test(`top-level volume dengan '${key}' ditolak`, () => {
      assertRejected(errorsOf((d) => { d.volumes.data = { [key]: val }; }), new RegExp(`'${key}'`));
    });
  }

  test("network external 'web' ditolak", () => {
    assertRejected(errorsOf((d) => { d.networks.web = { external: true }; }), /external 'web'/);
  });

  test('network external dengan name lain ditolak', () => {
    assertRejected(errorsOf((d) => { d.networks.lain = { name: 'milik-orang', external: true }; }), /milik-orang/);
  });

  test('network non-external dengan driver ditolak', () => {
    assertRejected(errorsOf((d) => { d.networks.x = { driver: 'macvlan' }; }), /driver/);
  });

  test('network non-external dengan driver_opts / ipam ditolak', () => {
    assertRejected(errorsOf((d) => { d.networks.x = { driver_opts: { parent: 'eth0' } }; }), /driver_opts/);
    assertRejected(errorsOf((d) => { d.networks.y = { ipam: { config: [{ subnet: '10.0.0.0/8' }] } }; }), /ipam/);
  });

  test('network internal biasa diizinkan', () => {
    assert.deepEqual(errorsOf(withSecond({})), []);
  });

  test('network jumat-ai-web tidak dideklarasikan ditolak', () => {
    assertRejected(errorsOf((d) => { d.networks = { lokal: {} }; d.services[SLUG].networks = ['lokal']; }), /jumat-ai-web/);
  });
});

describe('C. label Traefik', () => {
  const setLabel = (d, prefix, value) => {
    d.services[SLUG].labels = d.services[SLUG].labels.filter((l) => !l.startsWith(prefix));
    d.services[SLUG].labels.push(`${prefix}${value}`);
  };
  const ruleKey = `traefik.http.routers.${SLUG}.rule=`;

  test('traefik.docker.network salah ditolak', () => {
    assertRejected(errorsOf((d) => { setLabel(d, 'traefik.docker.network=', 'web'); }), /traefik\.docker\.network/);
  });

  test('traefik.docker.network hilang ditolak', () => {
    assertRejected(errorsOf((d) => { d.services[SLUG].labels = d.services[SLUG].labels.filter((l) => !l.startsWith('traefik.docker.network')); }), /traefik\.docker\.network/);
  });

  test('traefik.enable hilang di semua service ditolak', () => {
    assertRejected(errorsOf((d) => { d.services[SLUG].labels = []; }), /traefik\.enable=true/);
  });

  test('rule HostRegexp ditolak', () => {
    assertRejected(errorsOf((d) => { setLabel(d, ruleKey, 'HostRegexp(`{any:.+}`)'); }), /Rule router/);
  });

  test('rule Host domain lain ditolak', () => {
    assertRejected(errorsOf((d) => { setLabel(d, ruleKey, `Host(\`evil.com\`) && PathPrefix(\`/${SLUG}\`)`); }), /Rule router/);
  });

  test('rule PathPrefix slug lain ditolak', () => {
    assertRejected(errorsOf((d) => { setLabel(d, ruleKey, 'Host(`projects.jumat.ai.id`) && PathPrefix(`/proyek-lain`)'); }), /Rule router/);
  });

  test('rule dengan operator || ditolak', () => {
    assertRejected(errorsOf((d) => { setLabel(d, ruleKey, `Host(\`projects.jumat.ai.id\`) && PathPrefix(\`/${SLUG}\`) || PathPrefix(\`/\`)`); }), /Rule router/);
  });

  test('rule hanya PathPrefix(/) ditolak', () => {
    assertRejected(errorsOf((d) => { setLabel(d, ruleKey, 'PathPrefix(`/`)'); }), /Rule router/);
  });

  test('variasi spasi pada rule yang benar diizinkan', () => {
    assert.deepEqual(errorsOf((d) => { setLabel(d, ruleKey, `Host( \`projects.jumat.ai.id\` )  &&  PathPrefix( \`/${SLUG}\` )`); }), []);
  });

  test('nama router bukan slug ditolak', () => {
    assertRejected(errorsOf((d) => {
      d.services[SLUG].labels = d.services[SLUG].labels.map((l) => l.replace(`routers.${SLUG}.`, 'routers.traefik-dashboard.'));
    }), /Nama router/);
  });

  test('nama router dengan prefix slug tanpa strip diawali slug-lain ditolak', () => {
    assertRejected(errorsOf((d) => {
      d.services[SLUG].labels.push(`traefik.http.routers.${SLUG}extra.rule=Host(\`projects.jumat.ai.id\`) && PathPrefix(\`/${SLUG}\`)`);
    }), /Nama router/);
  });

  test('nama service dan middleware bukan slug ditolak', () => {
    assertRejected(errorsOf((d) => { d.services[SLUG].labels.push('traefik.http.services.lain.loadbalancer.server.port=80'); }), /Nama service/);
    assertRejected(errorsOf((d) => { d.services[SLUG].labels.push('traefik.http.middlewares.lain.stripprefix.prefixes=/x'); }), /Nama middleware/);
  });

  test('middleware forwardauth ditolak', () => {
    assertRejected(errorsOf((d) => {
      d.services[SLUG].labels.push(`traefik.http.middlewares.${SLUG}-auth.forwardauth.address=http://evil`);
    }), /forwardauth/);
  });

  test('middleware headers ditolak', () => {
    assertRejected(errorsOf((d) => {
      d.services[SLUG].labels.push(`traefik.http.middlewares.${SLUG}-h.headers.customrequestheaders.X=1`);
    }), /headers/);
  });

  test('middleware stripprefixregex ditolak', () => {
    assertRejected(errorsOf((d) => {
      d.services[SLUG].labels.push(`traefik.http.middlewares.${SLUG}-r.stripprefixregex.regex=.*`);
    }), /stripprefixregex/);
  });

  test('router menunjuk middleware milik proyek lain ditolak', () => {
    assertRejected(errorsOf((d) => { setLabel(d, `traefik.http.routers.${SLUG}.middlewares=`, 'auth@file'); }), /Middleware yang direferensikan/);
  });

  test('router menunjuk service api@internal ditolak', () => {
    assertRejected(errorsOf((d) => { d.services[SLUG].labels.push(`traefik.http.routers.${SLUG}.service=api@internal`); }), /Service yang direferensikan/);
  });

  test('traefik.tcp ditolak', () => {
    assertRejected(errorsOf((d) => {
      d.services[SLUG].labels.push(`traefik.tcp.routers.${SLUG}.rule=HostSNI(\`*\`)`);
    }), /TCP\/UDP/);
  });

  test('traefik.udp ditolak', () => {
    assertRejected(errorsOf((d) => { d.services[SLUG].labels.push(`traefik.udp.routers.${SLUG}.entrypoints=dns`); }), /TCP\/UDP/);
  });

  test('router priority ditolak', () => {
    assertRejected(errorsOf((d) => { d.services[SLUG].labels.push(`traefik.http.routers.${SLUG}.priority=99999`); }), /priority/);
  });

  test('entrypoint selain web/websecure ditolak', () => {
    assertRejected(errorsOf((d) => { setLabel(d, `traefik.http.routers.${SLUG}.entrypoints=`, 'traefik'); }), /Entrypoint/);
  });

  test('loadbalancer.server.url (SSRF ke host) ditolak', () => {
    assertRejected(errorsOf((d) => { d.services[SLUG].labels.push(`traefik.http.services.${SLUG}.loadbalancer.servers.url=http://172.17.0.1`); }), /Label service Traefik/);
  });

  test('label traefik tidak dikenal ditolak', () => {
    assertRejected(errorsOf((d) => { d.services[SLUG].labels.push('traefik.foo=bar'); }), /tidak dikenal/);
  });

  test('label berbahaya di service kedua juga diperiksa', () => {
    assertRejected(errorsOf(withSecond({
      build: { context: '.' },
      labels: ['traefik.enable=true', 'traefik.docker.network=jumat-ai-web', 'traefik.http.routers.hijack.rule=PathPrefix(`/`)']
    }, (d) => { delete d.services[SECOND].image; })), /cache.*Nama router/);
  });

  test('label duplikat: entri yang salah tetap terdeteksi walau bukan yang terakhir', () => {
    assertRejected(errorsOf((d) => {
      d.services[SLUG].labels.push('traefik.docker.network=web');
    }), /traefik\.docker\.network/);
  });
});

describe('D. file di folder proyek', () => {
  test('symlink ditolak', (t) => {
    const { slug, dir } = makeProject(null);
    try {
      fs.symlinkSync(os.tmpdir(), path.join(dir, 'link'), 'junction');
    } catch (e) {
      t.skip(`tidak bisa membuat symlink di lingkungan ini: ${e.code}`);
      return;
    }
    assertRejected(validateProjectDir(slug, dir), /Symlink/);
  });

  test('symlink bersarang (rekursif) ditolak', (t) => {
    const { slug, dir } = makeProject(null, {
      setup: (p) => { fs.mkdirSync(path.join(p, 'sub', 'dalam'), { recursive: true }); }
    });
    try {
      fs.symlinkSync(os.tmpdir(), path.join(dir, 'sub', 'dalam', 'link'), 'junction');
    } catch (e) {
      t.skip(`tidak bisa membuat symlink di lingkungan ini: ${e.code}`);
      return;
    }
    assertRejected(validateProjectDir(slug, dir), /Symlink.*link/);
  });

  test('symlink file ditolak', (t) => {
    const { slug, dir } = makeProject(null);
    const target = path.join(dir, 'Dockerfile');
    try {
      fs.symlinkSync(target, path.join(dir, 'alias.txt'), 'file');
    } catch (e) {
      t.skip(`tidak bisa membuat symlink di lingkungan ini: ${e.code}`);
      return;
    }
    assertRejected(validateProjectDir(slug, dir), /Symlink/);
  });

  for (const name of ['compose.yaml', 'compose.yml', 'docker-compose.yaml', 'docker-compose.override.yml', 'docker-compose.override.yaml', 'compose.override.yml', 'compose.override.yaml']) {
    test(`file compose alternatif ${name} ditolak`, () => {
      assertRejected(errorsOf(null, { setup: (d) => fs.writeFileSync(path.join(d, name), 'services: {}\n') }), /File compose alternatif/);
    });
  }

  test('file .env ditolak', () => {
    assertRejected(errorsOf(null, { setup: (d) => fs.writeFileSync(path.join(d, '.env'), 'X=1\n') }), /\.env/);
  });

  test('.env.example tidak dianggap pelanggaran', () => {
    assert.deepEqual(errorsOf(null, { setup: (d) => fs.writeFileSync(path.join(d, '.env.example'), 'X=1\n') }), []);
  });
});

describe('format & struktur dasar', () => {
  test('YAML rusak ditolak', () => {
    assertRejected(errorsOf(null, { rawCompose: 'services: [\n' }), /YAML/);
  });

  test('compose tanpa services ditolak', () => {
    assertRejected(errorsOf(null, { rawCompose: 'networks: {}\n' }), /services/);
  });

  test('compose tidak ada ditolak', () => {
    const { slug, dir } = makeProject(null);
    fs.rmSync(path.join(dir, 'docker-compose.yml'));
    assertRejected(validateProjectDir(slug, dir), /tidak ditemukan/);
  });

  test('validateProjectDir tidak membocorkan status error antar pemanggilan', () => {
    assertRejected(errorsOf((d) => { d.services[SLUG].privileged = true; }));
    assert.deepEqual(errorsOf(), []);
  });
});

describe('pinning commit di semua service yang di-build', () => {
  const SHA_A = 'a'.repeat(40);
  const SHA_B = 'b'.repeat(40);
  const dockerfile = 'FROM alpine\nARG REPO_URL\nARG COMMIT_SHA\nRUN git init . && git fetch --depth 1 "$REPO_URL" "${COMMIT_SHA}"\n';

  function pinned(mutate) {
    return makeProject((d, dir) => {
      d.services[SLUG].build.args = { REPO_URL: 'https://github.com/penguji/demo.git', COMMIT_SHA: SHA_A };
      if (mutate) mutate(d);
      fs.writeFileSync(path.join(dir, 'Dockerfile'), dockerfile);
      const meta = JSON.parse(fs.readFileSync(path.join(dir, 'project.json'), 'utf8'));
      meta.commit_sha = SHA_A;
      fs.writeFileSync(path.join(dir, 'project.json'), JSON.stringify(meta));
    });
  }

  test('satu service ter-pin dengan benar lolos', () => {
    const { slug, dir } = pinned();
    assert.deepEqual(validateProjectDir(slug, dir), []);
  });

  test('service kedua di-build dengan COMMIT_SHA berbeda ditolak', () => {
    const { slug, dir } = pinned((d) => {
      d.services[`${SLUG}-worker`] = {
        build: { context: '.', args: { REPO_URL: 'https://github.com/penguji/demo.git', COMMIT_SHA: SHA_B } },
        networks: ['internal'],
        deploy: { resources: { limits: { cpus: '0.25', memory: '128M' } } }
      };
      d.networks.internal = {};
    });
    assertRejected(validateProjectDir(slug, dir), /service 'demo-app-worker'/);
  });
});
