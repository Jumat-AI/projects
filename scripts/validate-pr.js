const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');
const yaml = require('js-yaml');

const RESERVED_SLUGS = [
  'admin', 'api', 'hub', 'auth', 'login', 'static', 'assets',
  'dashboard', 'root', 'test', 'help', 'docs', 'settings', 'user', 'users'
];

const SLUG_REGEX = /^[a-z0-9]+(-[a-z0-9]+)*$/;
// Batas resource PER PROYEK: jumlah limit semua service dalam satu docker-compose.yml
const MAX_CPU_LIMIT = 0.5; // Maksimal total 0.5 core CPU per proyek
const MAX_MEMORY_LIMIT_MB = 512; // Maksimal total 512 MB RAM per proyek
const REQUIRED_NETWORK_NAME = 'jumat-ai-web';
const TEMPLATE_PLACEHOLDER_SLUG = 'nama-project-anda';

// Pinning source code eksternal ke satu commit (bukan branch)
const COMMIT_SHA_REGEX = /^[0-9a-f]{40}$/;
const PLACEHOLDER_COMMIT_SHA = '0'.repeat(40);
// Hanya URL https tanpa spasi/karakter shell; tidak boleh diawali '-' (mencegah option injection ke git)
const REPO_URL_REGEX = /^https:\/\/[A-Za-z0-9.-]+\/[A-Za-z0-9._~\/-]+$/;

const DANGEROUS_DOCKERFILE_PATTERNS = [
  /(\/etc\/shadow|\/etc\/sudoers)/i,
  /(xmrig|minerd|stratum\+tcp)/i,
  /(mkfifo.*\/bin\/sh|bash\s+-i\s+>&|\/dev\/tcp\/)/i,
  /docker\.sock/i
];

const SNIFFER_PATTERNS = [
  { name: 'Private Key bocor', regex: /-----BEGIN (RSA|EC|OPENSSH|DSA|PGP) PRIVATE KEY-----/ },
  { name: 'Koneksi Mining Crypto', regex: /(stratum\+tcp|stratum\+ssl|xmr\.pool|nanopool|supportxmr)/i },
  { name: 'Reverse Shell', regex: /(nc\s+-e\s+\/bin\/(sh|bash)|mkfifo.*\/dev\/tcp|bash\s+-i\s+>&)/i },
  { name: 'AWS Access Key bocor', regex: /AKIA[0-9A-Z]{16}/ },
  { name: 'OpenAI Secret Key bocor', regex: /sk-[a-zA-Z0-9]{20,}/ }
];

let hasErrors = false;
// Mode koleksi (dipakai test): error ditampung ke errorSink dan output konsol dibisukan
let errorSink = null;
let quiet = false;

function say(...args) {
  if (!quiet) console.log(...args);
}

/**
 * Jalankan fn dan kembalikan daftar error yang dicatat (tanpa output konsol,
 * tanpa memengaruhi status hasErrors global). Dipakai oleh test.
 */
function collectErrors(fn) {
  const prev = { hasErrors, errorSink, quiet };
  const sink = [];
  errorSink = sink;
  quiet = true;
  try {
    fn();
  } finally {
    hasErrors = prev.hasErrors;
    errorSink = prev.errorSink;
    quiet = prev.quiet;
  }
  return sink;
}

function logPass(msg) {
  say(`\x1b[32m✔ [PASS]\x1b[0m ${msg}`);
}

function logError(msg) {
  hasErrors = true;
  if (errorSink) errorSink.push(msg);
  if (!quiet) console.error(`\x1b[31m✖ [FAIL]\x1b[0m ${msg}`);
}

function logWarn(msg) {
  if (!quiet) console.warn(`\x1b[33m▲ [WARN]\x1b[0m ${msg}`);
}

function parseMemory(memStr) {
  if (typeof memStr === 'number') return memStr / (1024 * 1024);
  const match = String(memStr).trim().match(/^([0-9.]+)\s*([a-zA-Z]+)?$/);
  if (!match) return 0;
  const val = parseFloat(match[1]);
  const unit = (match[2] || 'm').toLowerCase();
  if (unit === 'g' || unit === 'gb') return val * 1024;
  if (unit === 'm' || unit === 'mb') return val;
  if (unit === 'k' || unit === 'kb') return val / 1024;
  return val / (1024 * 1024);
}

function normalizeRepoUrl(url) {
  return String(url || '').trim().replace(/\/+$/, '').replace(/\.git$/, '').toLowerCase();
}

function stripQuotes(value) {
  const v = String(value ?? '').trim();
  return v.replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1');
}

// Ambil nilai default dari instruksi `ARG NAMA=nilai` di Dockerfile
function parseDockerfileArgs(content) {
  const args = {};
  const re = /^\s*ARG\s+([A-Za-z_][A-Za-z0-9_]*)(?:=(\S*))?\s*$/gim;
  let m;
  while ((m = re.exec(content)) !== null) {
    args[m[1]] = m[2] !== undefined ? stripQuotes(m[2]) : undefined;
  }
  return args;
}

// Ambil build args dari service compose (format object maupun array "KEY=VALUE")
function parseComposeBuildArgs(service) {
  const raw = service && typeof service.build === 'object' ? service.build.args : null;
  const args = {};
  if (Array.isArray(raw)) {
    for (const item of raw) {
      const [k, ...v] = String(item).split('=');
      args[k.trim()] = v.length ? stripQuotes(v.join('=')) : undefined;
    }
  } else if (raw && typeof raw === 'object') {
    for (const [k, v] of Object.entries(raw)) {
      args[k] = v === null ? undefined : stripQuotes(v);
    }
  }
  return args;
}

function usesExternalSource(dockerContent) {
  return /\bgit\s+(clone|fetch)\b/i.test(dockerContent) || /^\s*ARG\s+REPO_URL\b/im.test(dockerContent);
}

/**
 * Aturan pinning commit: jika Dockerfile mengambil kode dari repo eksternal,
 * kode wajib dikunci ke COMMIT_SHA (40 hex) yang sama di Dockerfile/compose/project.json,
 * sehingga kode yang di-deploy identik dengan kode yang di-review saat PR.
 */
// Service utama = service bernama persis <slug>; fallback: service pertama yang punya 'build'
// (lalu service pertama). Nama service 'app' tidak lagi punya arti khusus.
function pickPrimaryServiceName(services, slug) {
  const names = Object.keys(services || {});
  if (slug && names.includes(slug)) return slug;
  const withBuild = names.find((n) => services[n] && typeof services[n] === 'object' && services[n].build !== undefined);
  return withBuild || names[0];
}

function validateSourcePinning(dockerContent, composeDoc, metadata, isTemplate, slug) {
  if (dockerContent === null) return;

  if (!usesExternalSource(dockerContent)) {
    logPass(`Dockerfile tidak mengambil kode dari repo eksternal; pinning commit tidak diperlukan.`);
    return;
  }

  let ok = true;
  const fail = (msg) => { ok = false; logError(msg); };

  if (/\bgit\s+clone\b/i.test(dockerContent)) {
    fail(`Aturan Pinning: 'git clone' dilarang karena selalu mengambil kode terbaru dari branch. Gunakan 'git fetch --depth 1 origin "\${COMMIT_SHA}"' seperti di projects/_template/Dockerfile.`);
  }

  const dockerArgs = parseDockerfileArgs(dockerContent);
  const services = composeDoc?.services || {};
  const primaryName = pickPrimaryServiceName(services, slug);
  const primaryService = services[primaryName];
  const composeArgs = parseComposeBuildArgs(primaryService);
  // Semua service yang di-build diperiksa (bukan hanya primary) agar build args service lain
  // tidak bisa menunjuk commit/repo berbeda dari yang di-review.
  const otherBuilds = Object.entries(services).filter(([n, svc]) => n !== primaryName && svc && typeof svc === 'object' && svc.build !== undefined);

  if ('BRANCH' in dockerArgs || 'BRANCH' in composeArgs || otherBuilds.some(([, svc]) => 'BRANCH' in parseComposeBuildArgs(svc))) {
    fail(`Aturan Pinning: argumen 'BRANCH' tidak lagi digunakan. Kunci kode dengan 'COMMIT_SHA'.`);
  }

  if (!('COMMIT_SHA' in dockerArgs)) {
    fail(`Aturan Pinning: Dockerfile wajib mendeklarasikan 'ARG COMMIT_SHA'.`);
  }
  if (!/\$\{?COMMIT_SHA\b/.test(dockerContent)) {
    fail(`Aturan Pinning: Dockerfile wajib memakai \${COMMIT_SHA} saat mengambil kode (git fetch/checkout).`);
  }

  for (const [n, svc] of otherBuilds) {
    const a = parseComposeBuildArgs(svc);
    const sameSha = (a.COMMIT_SHA ?? dockerArgs.COMMIT_SHA) === (composeArgs.COMMIT_SHA ?? dockerArgs.COMMIT_SHA);
    const sameRepo = (a.REPO_URL ?? dockerArgs.REPO_URL) === (composeArgs.REPO_URL ?? dockerArgs.REPO_URL);
    if (!sameSha || !sameRepo) {
      fail(`Aturan Pinning: build args COMMIT_SHA/REPO_URL service '${n}' harus identik dengan service utama '${primaryName}'.`);
    }
  }

  // Nilai efektif: build args compose menimpa default ARG di Dockerfile
  const effectiveSha = composeArgs.COMMIT_SHA ?? dockerArgs.COMMIT_SHA;
  const effectiveRepo = composeArgs.REPO_URL ?? dockerArgs.REPO_URL;
  const metaSha = metadata?.commit_sha;

  if (!metaSha || !COMMIT_SHA_REGEX.test(metaSha)) {
    fail(`Field 'commit_sha' di project.json wajib berisi hash commit lengkap (40 karakter hex huruf kecil), bukan nama branch.`);
  } else if (!isTemplate && metaSha === PLACEHOLDER_COMMIT_SHA) {
    fail(`Field 'commit_sha' masih berisi placeholder template. Isi dengan hasil 'git rev-parse HEAD' dari repo aplikasi Anda.`);
  }

  if (!effectiveSha || !COMMIT_SHA_REGEX.test(effectiveSha)) {
    fail(`COMMIT_SHA di Dockerfile/docker-compose.yml ("${effectiveSha || 'tidak ada'}") bukan hash commit lengkap 40 karakter.`);
  } else if (metaSha && effectiveSha !== metaSha) {
    fail(`COMMIT_SHA yang dipakai build ("${effectiveSha}") berbeda dengan 'commit_sha' di project.json ("${metaSha}").`);
  }

  if (!effectiveRepo) {
    fail(`REPO_URL tidak ditemukan di Dockerfile (ARG) maupun docker-compose.yml (build.args).`);
  } else if (!REPO_URL_REGEX.test(effectiveRepo)) {
    fail(`REPO_URL "${effectiveRepo}" tidak valid. Gunakan URL https repo publik, contoh: https://github.com/user/repo.git`);
  } else if (metadata?.repo_url && normalizeRepoUrl(effectiveRepo) !== normalizeRepoUrl(metadata.repo_url)) {
    fail(`REPO_URL yang dipakai build ("${effectiveRepo}") berbeda dengan 'repo_url' di project.json ("${metadata.repo_url}").`);
  }

  if (ok) {
    logPass(`Source code terkunci ke commit ${effectiveSha.slice(0, 12)}… dan konsisten di Dockerfile, compose, dan project.json.`);
  }
}

// ---------------------------------------------------------------------------
// Validasi docker-compose berbasis ALLOWLIST: apa pun yang tidak dikenal ditolak.
// Compose dijalankan oleh user grup docker (setara root) di server produksi,
// jadi setiap key yang tidak secara eksplisit aman dianggap berbahaya.
// ---------------------------------------------------------------------------

const ALLOWED_SERVICE_KEYS = new Set([
  'image', 'build', 'command', 'entrypoint', 'environment', 'env_file', 'expose',
  'labels', 'networks', 'volumes', 'deploy', 'restart', 'healthcheck', 'depends_on',
  'working_dir', 'user', 'read_only', 'tmpfs', 'init', 'stop_grace_period',
  'stop_signal', 'container_name', 'security_opt', 'shm_size'
]);
const ALLOWED_TOP_LEVEL_KEYS = new Set(['services', 'volumes', 'networks', 'version']);
const ALLOWED_BUILD_KEYS = new Set(['context', 'dockerfile', 'args', 'target']);
const FORBIDDEN_BUILD_KEYS = [
  'additional_contexts', 'ssh', 'secrets', 'network', 'extra_hosts', 'privileged', 'entitlements'
];
const ALLOWED_VOLUME_LONG_KEYS = new Set(['type', 'source', 'target', 'read_only', 'volume', 'tmpfs']);
// File yang otomatis dibaca `docker compose` dan bisa menimpa/menambah konfigurasi
const ALT_COMPOSE_FILES = [
  'compose.yaml', 'compose.yml', 'docker-compose.yaml',
  'docker-compose.override.yml', 'docker-compose.override.yaml',
  'compose.override.yml', 'compose.override.yaml'
];
const TRAEFIK_HOST = 'projects.jumat.ai.id';
const ALLOWED_TRAEFIK_ENTRYPOINTS = ['web', 'websecure'];
const NAMED_VOLUME_REGEX = /^[A-Za-z0-9][A-Za-z0-9_.-]*$/;
// Service image-only (tanpa build) hanya boleh database / object storage S3-compatible.
// Edit daftar ini untuk menambah repositori yang diizinkan (huruf kecil, tanpa prefix docker.io/).
const ALLOWED_IMAGE_REPOS = new Set([
  'postgres', 'pgvector/pgvector', 'mysql', 'mariadb', 'mongo', 'redis',
  'valkey/valkey', 'qdrant/qdrant', 'chromadb/chroma', 'minio/minio', 'quay.io/minio/minio'
]);
const IMAGE_DIGEST_REGEX = /@sha256:[0-9a-f]{64}$/;

// Ambil repositori ternormalisasi dari referensi image (tanpa tag/digest, tanpa docker.io/library)
function normalizeImageRepo(image) {
  let ref = String(image).trim().toLowerCase().replace(/@.*$/, '');
  const lastSlash = ref.lastIndexOf('/');
  const colon = ref.lastIndexOf(':');
  if (colon > lastSlash) ref = ref.slice(0, colon);
  for (const prefix of ['docker.io/library/', 'docker.io/', 'library/']) {
    if (ref.startsWith(prefix)) { ref = ref.slice(prefix.length); break; }
  }
  return ref;
}

const SECURITY_OPT_ALLOWED = 'no-new-privileges:true';
const MEMORY_STRING_REGEX = /^[0-9]+(\.[0-9]+)?\s*(b|k|kb|m|mb|g|gb)?$/i;

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function isInside(baseDir, target) {
  const rel = path.relative(baseDir, target);
  if (rel === '') return true;
  if (path.isAbsolute(rel)) return false;
  return rel !== '..' && !rel.startsWith('..' + path.sep) && !rel.startsWith('../');
}

/**
 * Pastikan `raw` adalah path relatif lokal yang tetap berada di dalam `root`
 * (default: `base`). Mengembalikan { resolved } atau { error }.
 */
function resolveInside(base, raw, root = base) {
  if (typeof raw !== 'string' || raw.trim() === '') {
    return { error: 'harus berupa path string yang tidak kosong' };
  }
  const p = raw.trim().replace(/\\/g, '/');
  if (p.startsWith('/') || p.startsWith('~') || /^[A-Za-z]:/.test(p)) {
    return { error: 'harus path relatif (bukan absolut)' };
  }
  // Konteks remote git/http dianggap path lokal oleh path.resolve, padahal bukan
  if (p.includes('://') || p.startsWith('git@') || p.startsWith('github.com/')) {
    return { error: 'tidak boleh URL/repo remote' };
  }
  const resolved = path.resolve(base, p);
  if (!isInside(root, resolved)) {
    return { error: 'keluar dari folder proyek' };
  }
  return { resolved };
}

// Normalisasi labels (array "k=v" atau map) menjadi [[key, value], ...]; key di-lowercase
// seperti yang dilakukan Traefik. Setiap entri array tetap diperiksa (tidak hanya yang terakhir).
function normalizeLabels(labels) {
  if (labels === undefined || labels === null) return [];
  if (Array.isArray(labels)) {
    return labels.map((l) => {
      const s = String(l);
      const i = s.indexOf('=');
      return i === -1
        ? [s.trim().toLowerCase(), '']
        : [s.slice(0, i).trim().toLowerCase(), s.slice(i + 1).trim()];
    });
  }
  if (isPlainObject(labels)) {
    return Object.entries(labels).map(([k, v]) => [String(k).trim().toLowerCase(), v === null || v === undefined ? '' : String(v).trim()]);
  }
  return null;
}

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Cari '$' (interpolasi compose) di seluruh dokumen, termasuk key dan nilai environment.
function findInterpolation(node, where, found) {
  if (typeof node === 'string') {
    if (node.includes('$')) found.push(where);
  } else if (Array.isArray(node)) {
    node.forEach((v, i) => findInterpolation(v, `${where}[${i}]`, found));
  } else if (isPlainObject(node)) {
    for (const [k, v] of Object.entries(node)) {
      if (String(k).includes('$')) found.push(`${where}.${k} (key)`);
      findInterpolation(v, where ? `${where}.${k}` : k, found);
    }
  }
}

function validateServiceBuild(svc, ctx, err) {
  if (svc.build === undefined) return;
  let build;
  if (typeof svc.build === 'string') build = { context: svc.build };
  else if (isPlainObject(svc.build)) build = svc.build;
  else { err(`'build' harus berupa string atau object.`); return; }

  for (const key of Object.keys(build)) {
    if (FORBIDDEN_BUILD_KEYS.includes(key)) {
      err(`'build.${key}' dilarang.`);
    } else if (!ALLOWED_BUILD_KEYS.has(key)) {
      err(`Key 'build.${key}' tidak diizinkan. Yang diizinkan: ${[...ALLOWED_BUILD_KEYS].join(', ')}.`);
    }
  }

  const ctxRaw = build.context === undefined ? '.' : build.context;
  const c = resolveInside(ctx.projectDir, ctxRaw);
  if (c.error) { err(`'build.context' "${ctxRaw}" ${c.error}.`); return; }

  const dfRaw = build.dockerfile === undefined ? 'Dockerfile' : build.dockerfile;
  const d = resolveInside(c.resolved, dfRaw, ctx.projectDir);
  if (d.error) { err(`'build.dockerfile' "${dfRaw}" ${d.error}.`); return; }
  // Hanya Dockerfile root proyek yang diperiksa validator; Dockerfile lain = tidak ter-review
  if (path.relative(ctx.projectDir, d.resolved) !== 'Dockerfile') {
    err(`'build.dockerfile' harus menunjuk ke 'Dockerfile' di root folder proyek (satu-satunya yang diperiksa validator), bukan "${dfRaw}".`);
  }
}

function validateServiceVolumes(vols, ctx, err) {
  if (!Array.isArray(vols)) { err(`'volumes' harus berupa list.`); return; }
  for (const vol of vols) {
    if (typeof vol === 'string') {
      const parts = vol.split(':');
      if (parts.length === 1) {
        // Volume anonim: hanya path target di dalam container
        if (!vol.startsWith('/')) err(`Spesifikasi volume "${vol}" tidak valid.`);
        continue;
      }
      const source = parts[0];
      if (!NAMED_VOLUME_REGEX.test(source)) {
        err(`Aturan Keamanan: Dilarang bind-mount path host: "${vol}". Hanya named volume yang dideklarasikan di top-level 'volumes' yang diizinkan.`);
      } else if (!ctx.declaredVolumes.has(source)) {
        err(`Volume "${source}" tidak dideklarasikan di top-level 'volumes'.`);
      }
    } else if (isPlainObject(vol)) {
      if (vol.type === 'tmpfs') continue;
      for (const key of Object.keys(vol)) {
        if (!ALLOWED_VOLUME_LONG_KEYS.has(key)) err(`Key '${key}' pada long-syntax volume tidak diizinkan.`);
      }
      if (vol.type !== 'volume') {
        err(`Aturan Keamanan: Dilarang volume bertipe '${vol.type}' (bind mount dan sejenisnya). Hanya type 'volume' atau 'tmpfs'.`);
        continue;
      }
      if (typeof vol.source !== 'string' || !NAMED_VOLUME_REGEX.test(vol.source) || !ctx.declaredVolumes.has(vol.source)) {
        err(`Source volume "${vol.source}" harus named volume yang dideklarasikan di top-level 'volumes'.`);
      }
    } else {
      err(`Entri volume tidak valid: ${JSON.stringify(vol)}.`);
    }
  }
}

/**
 * Validasi deploy.resources satu service.
 * Mengembalikan { cpus, memoryMb } bila limit valid (untuk dijumlahkan per proyek), atau null.
 */
function validateServiceDeploy(name, deploy, err) {
  if (deploy === undefined) {
    err(`Wajib mendefinisikan batasan resource di 'deploy.resources.limits' (cpus & memory).`);
    return;
  }
  if (!isPlainObject(deploy)) { err(`'deploy' harus berupa object.`); return; }
  for (const key of Object.keys(deploy)) {
    if (key !== 'resources') err(`Key 'deploy.${key}' tidak diizinkan. Hanya 'deploy.resources'.`);
  }
  const resources = deploy.resources;
  if (!isPlainObject(resources)) {
    err(`Wajib mendefinisikan batasan resource di 'deploy.resources.limits' (cpus & memory).`);
    return;
  }
  for (const key of Object.keys(resources)) {
    if (key !== 'limits' && key !== 'reservations') err(`Key 'deploy.resources.${key}' tidak diizinkan.`);
  }
  const limits = resources.limits;
  if (!isPlainObject(limits)) {
    err(`Wajib mendefinisikan batasan resource di 'deploy.resources.limits' (cpus & memory).`);
    return;
  }
  for (const key of Object.keys(limits)) {
    if (key !== 'cpus' && key !== 'memory') err(`Key 'deploy.resources.limits.${key}' tidak diizinkan (hanya cpus & memory).`);
  }

  const parseCpu = (v) => (v === undefined || v === null || String(v).trim() === '' ? NaN : Number(v));
  const parseMem = (v) => {
    if (typeof v === 'number') return parseMemory(v);
    if (typeof v !== 'string' || !MEMORY_STRING_REGEX.test(v.trim())) return 0;
    return parseMemory(v);
  };

  const cpus = parseCpu(limits.cpus);
  const memoryMb = parseMem(limits.memory);
  let limitsOk = true;

  // Batas per service = batas per proyek; total semua service dicek di validateDockerCompose.
  if (!Number.isFinite(cpus) || cpus <= 0 || cpus > MAX_CPU_LIMIT) {
    err(`Batasan CPU (${limits.cpus ?? 'tidak ada'}) melebihi batas maksimal yang diizinkan (${MAX_CPU_LIMIT} vCPU per proyek) atau tidak valid.`);
    limitsOk = false;
  } else {
    logPass(`Batasan CPU valid (service '${name}'): ${cpus} vCPU`);
  }
  if (!(memoryMb > 0) || memoryMb > MAX_MEMORY_LIMIT_MB) {
    err(`Batasan Memory (${limits.memory ?? 'tidak ada'}) melebihi batas maksimal yang diizinkan (${MAX_MEMORY_LIMIT_MB} MB per proyek) atau tidak valid.`);
    limitsOk = false;
  } else {
    logPass(`Batasan Memory valid (service '${name}'): ${limits.memory}`);
  }

  const result = limitsOk ? { cpus, memoryMb } : null;

  const res = resources.reservations;
  if (res !== undefined) {
    if (!isPlainObject(res)) { err(`'deploy.resources.reservations' harus berupa object.`); return result; }
    for (const key of Object.keys(res)) {
      if (key !== 'cpus' && key !== 'memory') err(`Key 'deploy.resources.reservations.${key}' tidak diizinkan (hanya cpus & memory).`);
    }
    if (res.cpus !== undefined) {
      const rc = parseCpu(res.cpus);
      if (!Number.isFinite(rc) || rc <= 0 || (limitsOk && rc > cpus)) err(`Reservasi CPU (${res.cpus}) tidak valid atau melebihi limit.`);
    }
    if (res.memory !== undefined) {
      const rm = parseMem(res.memory);
      if (!(rm > 0) || (limitsOk && rm > memoryMb)) err(`Reservasi Memory (${res.memory}) tidak valid atau melebihi limit.`);
    }
  }
  return result;
}

function validateServiceNetworks(svc, ctx, err) {
  // Kembalikan daftar nama network EFEKTIF (name di top-level) yang dipakai service
  if (svc.networks === undefined) return [];
  let keys;
  if (Array.isArray(svc.networks)) {
    keys = svc.networks.map(String);
  } else if (isPlainObject(svc.networks)) {
    keys = Object.keys(svc.networks);
    for (const [k, v] of Object.entries(svc.networks)) {
      if (v === null || (isPlainObject(v) && Object.keys(v).length === 0)) continue;
      // aliases/ipv4_address dll. di network bersama bisa membajak nama DNS container proyek lain
      err(`Konfigurasi network '${k}' (${isPlainObject(v) ? Object.keys(v).join(', ') : typeof v}) tidak diizinkan; cukup daftar nama network.`);
    }
  } else {
    err(`'networks' harus berupa list atau object.`);
    return [];
  }
  const effective = [];
  for (const k of keys) {
    if (!ctx.declaredNetworks.has(k)) {
      err(`Network '${k}' tidak dideklarasikan di top-level 'networks'.`);
    } else {
      effective.push(ctx.declaredNetworks.get(k));
    }
  }
  return effective;
}

/**
 * Validasi label Traefik satu service. Mengembalikan { enabled }.
 */
function validateTraefikLabels(entries, slug, err) {
  const nameOk = (n) => n === slug || n.startsWith(`${slug}-`);
  const refOk = (ref) => {
    for (let item of String(ref).split(',')) {
      item = item.trim().replace(/@docker$/, '');
      if (item === '' || item.includes('@') || !nameOk(item)) return false;
    }
    return true;
  };
  const ruleRegex = new RegExp(
    '^\\s*Host\\(\\s*`' + escapeRegex(TRAEFIK_HOST) + '`\\s*\\)\\s*&&\\s*PathPrefix\\(\\s*`/' + escapeRegex(slug) + '`\\s*\\)\\s*$'
  );

  const enableVals = [];
  const networks = [];
  let hasHttpLabels = false;

  for (const [k, v] of entries) {
    if (!k.startsWith('traefik.')) continue;
    if (k === 'traefik.enable') {
      enableVals.push(v);
      if (v !== 'true' && v !== 'false') err(`Label 'traefik.enable' harus 'true' atau 'false', bukan "${v}".`);
      continue;
    }
    if (k === 'traefik.docker.network') { networks.push(v); continue; }
    if (k.startsWith('traefik.tcp.') || k.startsWith('traefik.udp.')) {
      err(`Aturan Keamanan: Label Traefik TCP/UDP dilarang ('${k}'). Hanya routing HTTP.`);
      continue;
    }
    const m = k.match(/^traefik\.http\.(routers|services|middlewares)\.([^.]+)\.(.+)$/);
    if (!m) { err(`Label Traefik '${k}' tidak dikenal/diizinkan.`); continue; }
    hasHttpLabels = true;
    const [, kind, name, rest] = m;

    if (!nameOk(name)) {
      err(`Nama ${kind.slice(0, -1)} Traefik "${name}" pada label '${k}' wajib sama dengan slug "${slug}" atau diawali "${slug}-".`);
    }

    if (kind === 'routers') {
      if (rest === 'rule') {
        if (!ruleRegex.test(v)) {
          err(`Rule router "${name}" wajib persis: Host(\`${TRAEFIK_HOST}\`) && PathPrefix(\`/${slug}\`). Ditemukan: ${v}`);
        }
      } else if (rest === 'entrypoints') {
        for (const ep of v.split(',').map((s) => s.trim())) {
          if (!ALLOWED_TRAEFIK_ENTRYPOINTS.includes(ep)) err(`Entrypoint Traefik "${ep}" tidak diizinkan (hanya ${ALLOWED_TRAEFIK_ENTRYPOINTS.join(', ')}).`);
        }
      } else if (rest === 'tls' || rest === 'tls.certresolver') {
        // diizinkan
      } else if (rest === 'middlewares') {
        if (!refOk(v)) err(`Middleware yang direferensikan router "${name}" ("${v}") harus milik slug "${slug}" (diawali "${slug}-").`);
      } else if (rest === 'service') {
        if (!refOk(v)) err(`Service yang direferensikan router "${name}" ("${v}") harus milik slug "${slug}" (tidak boleh service provider lain, mis. api@internal).`);
      } else if (rest === 'priority') {
        err(`Label 'traefik.http.routers.${name}.priority' dilarang (bisa membajak routing proyek lain).`);
      } else {
        err(`Label router Traefik '${k}' tidak diizinkan.`);
      }
    } else if (kind === 'services') {
      if (!['loadbalancer.server.port', 'loadbalancer.server.scheme', 'loadbalancer.passhostheader'].includes(rest)) {
        err(`Label service Traefik '${k}' tidak diizinkan (hanya loadbalancer.server.port/scheme dan passhostheader).`);
      }
    } else if (kind === 'middlewares') {
      if (!['stripprefix.prefixes', 'stripprefix.forceslash'].includes(rest)) {
        err(`Middleware Traefik '${rest.split('.')[0]}' pada label '${k}' dilarang. Hanya 'stripprefix' yang diizinkan.`);
      }
    }
  }

  const enabled = enableVals.includes('true');
  if (enabled) {
    if (!networks.length || networks.some((n) => n !== REQUIRED_NETWORK_NAME)) {
      err(`Label 'traefik.docker.network' harus disetel ke '${REQUIRED_NETWORK_NAME}'.`);
    }
  } else if (hasHttpLabels && !enableVals.includes('false')) {
    err(`Label Traefik http dipakai tanpa 'traefik.enable=true'.`);
  }
  return { enabled };
}

function validateTopLevelNetworks(doc, err) {
  // Mengembalikan Map(key -> nama efektif)
  const declared = new Map();
  const nets = doc.networks;
  if (nets === undefined || nets === null) return declared;
  if (!isPlainObject(nets)) { err(`'networks' top-level harus berupa object.`); return declared; }

  for (const [key, conf] of Object.entries(nets)) {
    const c = conf === null ? {} : conf;
    if (!isPlainObject(c)) { err(`Network '${key}' tidak valid.`); continue; }
    const isExternal = c.external !== undefined && c.external !== false;

    if (isExternal) {
      const effective = c.name === undefined ? key : c.name;
      if (c.external !== true) err(`Network '${key}': 'external' harus bernilai true.`);
      if (effective !== REQUIRED_NETWORK_NAME) {
        err(`Aturan Keamanan: Network external '${key}' (name: ${effective}) dilarang. Satu-satunya network external yang diizinkan adalah '${REQUIRED_NETWORK_NAME}'.`);
      }
      for (const extra of Object.keys(c)) {
        if (extra !== 'external' && extra !== 'name') err(`Network external '${key}' tidak boleh memakai '${extra}'.`);
      }
      declared.set(key, effective);
    } else {
      for (const extra of Object.keys(c)) {
        if (extra === 'external') continue;
        if (extra === 'internal') continue;
        err(`Aturan Keamanan: Network '${key}' tidak boleh memakai '${extra}' (driver/driver_opts/ipam/name dll. dilarang).`);
      }
      declared.set(key, key);
    }
  }
  return declared;
}

function validateTopLevelVolumes(doc, err) {
  const declared = new Set();
  const vols = doc.volumes;
  if (vols === undefined || vols === null) return declared;
  if (!isPlainObject(vols)) { err(`'volumes' top-level harus berupa object.`); return declared; }
  for (const [key, conf] of Object.entries(vols)) {
    if (conf !== null && !(isPlainObject(conf))) { err(`Volume '${key}' tidak valid.`); continue; }
    for (const extra of Object.keys(conf || {})) {
      err(`Aturan Keamanan: Volume top-level '${key}' tidak boleh memakai '${extra}' (driver, driver_opts, external, name dilarang; bisa dipakai untuk bind mount tersembunyi).`);
    }
    declared.add(key);
  }
  return declared;
}

// Cek file di folder proyek: symlink (rekursif), file compose alternatif, dan .env
function validateProjectFiles(projectDir) {
  let ok = true;
  const fail = (m) => { ok = false; logError(m); };

  const walk = (dir) => {
    let items;
    try { items = fs.readdirSync(dir); } catch (e) { fail(`Tidak dapat membaca folder ${dir}: ${e.message}`); return; }
    for (const item of items) {
      const full = path.join(dir, item);
      let st;
      try { st = fs.lstatSync(full); } catch (e) { fail(`Tidak dapat memeriksa ${full}: ${e.message}`); continue; }
      if (st.isSymbolicLink()) {
        fail(`Aturan Keamanan: Symlink dilarang di folder proyek: ${path.relative(projectDir, full)}`);
      } else if (st.isDirectory()) {
        walk(full);
      }
    }
  };
  walk(projectDir);

  let top = [];
  try { top = fs.readdirSync(projectDir); } catch (_) {}
  for (const f of top) {
    if (ALT_COMPOSE_FILES.includes(f.toLowerCase())) {
      fail(`Aturan Keamanan: File compose alternatif '${f}' dilarang (dibaca otomatis oleh docker compose dan melewati validasi). Gunakan hanya docker-compose.yml.`);
    }
    if (f === '.env') {
      fail(`Aturan Keamanan: File '.env' dilarang di folder proyek (dipakai compose untuk interpolasi variabel).`);
    }
  }
  if (ok) logPass(`Folder proyek bersih: tanpa symlink, file compose alternatif, atau .env.`);
}

function validateDockerCompose(composePath, slug) {
  if (!fs.existsSync(composePath)) {
    logError(`File docker-compose.yml tidak ditemukan di ${composePath}`);
    return null;
  }

  const projectDir = path.dirname(path.resolve(composePath));
  const rawContent = fs.readFileSync(composePath, 'utf8');

  let doc;
  try {
    doc = yaml.load(rawContent);
  } catch (e) {
    logError(`Format YAML pada docker-compose.yml tidak valid: ${e.message}`);
    return null;
  }

  if (!isPlainObject(doc) || !doc.services) {
    logError(`docker-compose.yml wajib mendefinisikan section 'services'.`);
    return null;
  }
  if (!isPlainObject(doc.services) || Object.keys(doc.services).length === 0) {
    logError(`Tidak ada service yang didefinisikan di docker-compose.yml.`);
    return null;
  }

  // B. Key top-level
  for (const key of Object.keys(doc)) {
    if (ALLOWED_TOP_LEVEL_KEYS.has(key) || key.startsWith('x-')) continue;
    logError(`Aturan Keamanan: Key top-level '${key}' tidak diizinkan. Yang diizinkan: services, volumes, networks, x-*.`);
  }

  // Interpolasi: '$' dilarang di seluruh dokumen (termasuk environment)
  const interp = [];
  findInterpolation(doc, '', interp);
  for (const where of interp) {
    logError(`Aturan Keamanan: Interpolasi variabel ('$') dilarang di '${where}'. Tulis nilai literal (jangan pakai variabel seperti $VAR atau \${VAR}, dan jangan pakai $$); compose server bisa membocorkan variabel environment server.`);
  }

  const declaredVolumes = validateTopLevelVolumes(doc, logError);
  const declaredNetworks = validateTopLevelNetworks(doc, logError);

  if (![...declaredNetworks.values()].includes(REQUIRED_NETWORK_NAME)) {
    logError(`docker-compose.yml wajib mendefinisikan network external '${REQUIRED_NETWORK_NAME}' untuk isolasi Traefik.`);
  } else {
    logPass(`Network terisolasi '${REQUIRED_NETWORK_NAME}' terkonfigurasi dengan benar.`);
  }

  const ctx = { slug, projectDir, declaredVolumes, declaredNetworks };
  let anyPorts = false;
  let anyTraefik = false;
  // Akumulasi limit resource semua service (batas berlaku per proyek)
  let totalCpus = 0;
  let totalMemoryMb = 0;
  let allLimitsValid = true;

  for (const [name, svc] of Object.entries(doc.services)) {
    const err = (msg) => logError(`Service '${name}': ${msg}`);
    if (!isPlainObject(svc)) { err(`definisi service harus berupa object.`); continue; }

    // Nama service harus unik per proyek agar tidak bentrok DNS di network bersama
    if (!(name === slug || name.startsWith(`${slug}-`))) {
      err(`nama service wajib sama dengan slug "${slug}" atau diawali "${slug}-" (mencegah bentrok nama DNS di network bersama '${REQUIRED_NETWORK_NAME}').`);
    }
    const imageOnly = svc.build === undefined;
    if (imageOnly) {
      if (typeof svc.image !== 'string' || svc.image.trim() === '') {
        err(`wajib punya 'build' atau 'image'.`);
      } else {
        const repo = normalizeImageRepo(svc.image);
        if (!ALLOWED_IMAGE_REPOS.has(repo)) {
          err(`image "${svc.image}" tidak diizinkan. Service tanpa 'build' hanya boleh image database/object storage (${[...ALLOWED_IMAGE_REPOS].join(', ')}); aplikasi wajib di-build dari Dockerfile proyek.`);
        }
        if (!IMAGE_DIGEST_REGEX.test(svc.image.trim().toLowerCase())) {
          err(`image "${svc.image}" wajib dipin dengan digest: <repo>[:tag]@sha256:<64 hex>.`);
        }
      }
    }

    // A. Allowlist key service
    for (const key of Object.keys(svc)) {
      if (ALLOWED_SERVICE_KEYS.has(key)) continue;
      if (key === 'ports') {
        anyPorts = true;
        err(`Aturan Keamanan Terlanggar: DILARANG menggunakan 'ports:'! Mengekspos port ke host publik tidak diizinkan; gunakan 'expose:' untuk port internal.`);
      } else if (key === 'privileged') {
        err(`Aturan Keamanan: 'privileged' sangat dilarang.`);
      } else {
        err(`Aturan Keamanan: Key '${key}' tidak diizinkan (allowlist). Yang diizinkan: ${[...ALLOWED_SERVICE_KEYS].join(', ')}.`);
      }
    }

    if (svc.expose === undefined || (Array.isArray(svc.expose) && svc.expose.length === 0)) {
      logWarn(`Service '${name}' sebaiknya mendefinisikan 'expose:' untuk port internal.`);
    }

    if (svc.security_opt !== undefined) {
      const opts = Array.isArray(svc.security_opt) ? svc.security_opt : [svc.security_opt];
      for (const o of opts) {
        if (o !== SECURITY_OPT_ALLOWED) err(`security_opt "${o}" tidak diizinkan. Hanya "${SECURITY_OPT_ALLOWED}".`);
      }
    }

    if (svc.container_name !== undefined) {
      const cn = svc.container_name;
      const prefix = `jumat-ai-${slug}`;
      if (typeof cn !== 'string' || !(cn === prefix || cn.startsWith(`${prefix}-`))) {
        err(`container_name "${cn}" wajib sama dengan "${prefix}" atau diawali "${prefix}-".`);
      }
    }

    validateServiceBuild(svc, ctx, err);

    if (svc.volumes !== undefined) validateServiceVolumes(svc.volumes, ctx, err);

    if (svc.env_file !== undefined) {
      const list = Array.isArray(svc.env_file) ? svc.env_file : [svc.env_file];
      for (const item of list) {
        const raw = isPlainObject(item) ? item.path : item;
        const r = resolveInside(projectDir, raw);
        if (r.error) err(`env_file "${raw}" ${r.error}.`);
      }
    }

    const svcLimits = validateServiceDeploy(name, svc.deploy, err);
    if (svcLimits) {
      totalCpus += svcLimits.cpus;
      totalMemoryMb += svcLimits.memoryMb;
    } else {
      allLimitsValid = false;
    }

    const effectiveNets = validateServiceNetworks(svc, ctx, err);

    const entries = normalizeLabels(svc.labels);
    if (entries === null) {
      err(`'labels' harus berupa list atau object.`);
    } else {
      if (imageOnly) {
        if (entries.some(([k]) => k.startsWith('traefik.'))) {
          err(`service image-only (tanpa 'build') tidak boleh memiliki label traefik.*.`);
        }
        if (effectiveNets.includes(REQUIRED_NETWORK_NAME)) {
          err(`service image-only (tanpa 'build') tidak boleh tersambung ke network '${REQUIRED_NETWORK_NAME}'; gunakan network internal proyek saja.`);
        }
        continue;
      }
      const { enabled } = validateTraefikLabels(entries, slug, err);
      if (enabled) {
        anyTraefik = true;
        if (!effectiveNets.includes(REQUIRED_NETWORK_NAME)) {
          err(`Service dengan 'traefik.enable=true' wajib tersambung ke network '${REQUIRED_NETWORK_NAME}'.`);
        }
      }
    }
  }

  if (!anyPorts) logPass(`Zero host port exposure: Tidak ada port host yang diekspos.`);

  // Total limit semua service tidak boleh melebihi jatah per proyek.
  // Pembulatan untuk menghindari galat floating point (mis. 0.25 + 0.15 + 0.1).
  if (allLimitsValid) {
    const cpuTotal = Math.round(totalCpus * 1000) / 1000;
    const memTotal = Math.round(totalMemoryMb * 1000) / 1000;
    if (cpuTotal > MAX_CPU_LIMIT) {
      logError(`Total batasan CPU semua service (${cpuTotal} vCPU) melebihi jatah per proyek (${MAX_CPU_LIMIT} vCPU). Bagi limit di antara service, mis. app 0.35 + db 0.15.`);
    } else {
      logPass(`Total batasan CPU proyek valid: ${cpuTotal} vCPU (Maks: ${MAX_CPU_LIMIT} per proyek)`);
    }
    if (memTotal > MAX_MEMORY_LIMIT_MB) {
      logError(`Total batasan Memory semua service (${memTotal} MB) melebihi jatah per proyek (${MAX_MEMORY_LIMIT_MB} MB). Bagi limit di antara service, mis. app 384M + db 128M.`);
    } else {
      logPass(`Total batasan Memory proyek valid: ${memTotal} MB (Maks: ${MAX_MEMORY_LIMIT_MB} MB per proyek)`);
    }
  }

  if (!anyTraefik) {
    logError(`Label 'traefik.enable=true' wajib ada.`);
  } else {
    logPass(`Label 'traefik.enable=true' ditemukan.`);
  }

  return doc;
}

function validateDockerfile(dockerfilePath) {
  if (!fs.existsSync(dockerfilePath)) {
    logError(`File Dockerfile tidak ditemukan di ${dockerfilePath}`);
    return null;
  }

  const content = fs.readFileSync(dockerfilePath, 'utf8');

  for (const pattern of DANGEROUS_DOCKERFILE_PATTERNS) {
    if (pattern.test(content)) {
      logError(`Dockerfile terdeteksi memuat instruksi yang berisiko keamanan tinggi: ${pattern}`);
    }
  }

  // ADD dari URL remote mengambil konten yang bisa berubah kapan saja (melewati pinning commit)
  if (/^\s*ADD\s+(--\S+\s+)*https?:\/\//im.test(content)) {
    logError(`Aturan Pinning: 'ADD <url>' dilarang. Ambil kode lewat git fetch dengan COMMIT_SHA.`);
  }

  logPass(`Pemeriksaan keamanan dasar Dockerfile lolos.`);
  return content;
}

/**
 * @param {string} repoUrl   URL repo aplikasi kontributor
 * @param {string|null} commitSha  Jika diisi, sniffer memindai TEPAT commit ini (kode yang akan di-deploy)
 * @param {string} slug
 */
function runCodeSniffer(repoUrl, commitSha, slug) {
  if (!repoUrl || repoUrl.includes('username_anda') || repoUrl.includes('example.com')) {
    logWarn(`Repo URL "${repoUrl}" adalah placeholder template. Sniffer eksternal dilewati.`);
    return;
  }

  // repo_url berasal dari PR (input tak tepercaya): validasi format dan jangan pernah lewat shell
  if (!REPO_URL_REGEX.test(repoUrl)) {
    logError(`Repo URL "${repoUrl}" tidak valid untuk sniffer. Gunakan URL https repo publik.`);
    return;
  }

  const pinned = Boolean(commitSha && COMMIT_SHA_REGEX.test(commitSha) && commitSha !== PLACEHOLDER_COMMIT_SHA);
  say(`\n\x1b[35m[CODE SNIFFER]\x1b[0m Memeriksa repositori eksternal: ${repoUrl}${pinned ? ` @ ${commitSha}` : ''}`);
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), `sniff-${slug}-`));
  const git = (args) => execFileSync('git', args, { stdio: 'pipe', timeout: 30000 });

  try {
    try {
      if (pinned) {
        git(['init', '-q', tmpDir]);
        git(['-C', tmpDir, 'remote', 'add', 'origin', repoUrl]);
        git(['-C', tmpDir, 'fetch', '-q', '--depth', '1', 'origin', commitSha]);
        git(['-C', tmpDir, 'checkout', '-q', 'FETCH_HEAD']);
        logPass(`Shallow fetch commit ${commitSha.slice(0, 12)}… ke sandbox berhasil.`);
      } else {
        git(['clone', '--depth', '1', '--', repoUrl, tmpDir]);
        logPass(`Shallow clone ke sandbox berhasil.`);
      }
    } catch (err) {
      if (pinned) {
        logError(`Commit ${commitSha} tidak dapat diambil dari ${repoUrl}. Pastikan repo publik dan commit sudah di-push. (${err.message.split('\n')[0]})`);
      } else {
        logWarn(`Gagal menjalankan sniffer clone untuk ${repoUrl}: ${err.message}`);
      }
      return;
    }

    // Pindai file-file di repo
    const filesToScan = [];
    function gatherFiles(dir) {
      const items = fs.readdirSync(dir);
      for (const item of items) {
        if (item === '.git') continue;
        const full = path.join(dir, item);
        const stat = fs.statSync(full);
        if (stat.isDirectory()) {
          gatherFiles(full);
        } else if (stat.isFile() && stat.size < 2 * 1024 * 1024) {
          filesToScan.push(full);
        }
      }
    }
    gatherFiles(tmpDir);

    let issuesCount = 0;
    for (const f of filesToScan) {
      const text = fs.readFileSync(f, 'utf8');
      for (const rule of SNIFFER_PATTERNS) {
        if (rule.regex.test(text)) {
          logError(`[SNIFFER DETEKSI]: ${rule.name} ditemukan pada file: ${path.relative(tmpDir, f)}`);
          issuesCount++;
        }
      }
    }

    if (issuesCount === 0) {
      logPass(`Code sniffer bersih: Tidak ada malware, miner, atau secret bocor terdeteksi.`);
    }
  } catch (err) {
    logWarn(`Gagal memindai isi repo ${repoUrl}: ${err.message}`);
  } finally {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch (_) {}
  }
}

function validateProject(folderName, projectDir, options = {}) {
  const isTemplate = folderName === '_template';
  // Template memakai placeholder slug 'nama-project-anda' di container_name & label Traefik
  const composeSlug = isTemplate ? TEMPLATE_PLACEHOLDER_SLUG : folderName;
  say(`\n======================================================`);
  say(`Memeriksa project: \x1b[36m${folderName}\x1b[0m`);
  say(`======================================================`);

  if (!isTemplate) {
    if (!SLUG_REGEX.test(folderName)) {
      logError(`Nama folder "${folderName}" tidak valid. Hanya boleh huruf kecil, angka, dan strip (kebab-case).`);
    } else {
      logPass(`Format nama slug valid: ${folderName}`);
    }

    if (RESERVED_SLUGS.includes(folderName)) {
      logError(`Nama folder "${folderName}" menggunakan nama cadangan sistem yang dilarang.`);
    }
  }

  // 1. Cek Metadata project.json
  const metadataPath = path.join(projectDir, 'project.json');
  let metadata = null;
  if (!fs.existsSync(metadataPath)) {
    logError(`File wajib "project.json" tidak ditemukan.`);
  } else {
    try {
      metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
      if (!isTemplate && metadata.slug !== folderName) {
        logError(`Field 'slug' di project.json ("${metadata.slug}") harus sama dengan nama folder ("${folderName}").`);
      }
      if (!metadata.title || !metadata.description) {
        logError(`Field 'title' dan 'description' wajib diisi di project.json.`);
      }
      if (!metadata.author || !metadata.author.name || !metadata.author.github) {
        logError(`Data author (name, github) wajib diisi lengkap.`);
      }
      if (!metadata.repo_url) {
        logError(`Field 'repo_url' wajib diisi dengan link GitHub proyek.`);
      }
      logPass(`Metadata project.json valid.`);
    } catch (e) {
      logError(`Format JSON di project.json tidak valid: ${e.message}`);
    }
  }

  // 2. Cek Dockerfile
  const dockerContent = validateDockerfile(path.join(projectDir, 'Dockerfile'));

  // 3. Cek file di folder proyek (symlink, compose alternatif, .env) dan docker-compose.yml
  validateProjectFiles(projectDir);
  const composeDoc = validateDockerCompose(path.join(projectDir, 'docker-compose.yml'), composeSlug);

  // 4. Cek pinning source code eksternal ke COMMIT_SHA
  validateSourcePinning(dockerContent, composeDoc, metadata, isTemplate, composeSlug);

  // 5. Jalankan Code Sniffer jika diminta (memindai commit yang dikunci bila ada)
  if (options.sniff && metadata && metadata.repo_url && !isTemplate) {
    const external = dockerContent !== null && usesExternalSource(dockerContent);
    runCodeSniffer(metadata.repo_url, external ? metadata.commit_sha : null, folderName);
  }
}

function main() {
  console.log(`\n======================================================`);
  console.log(`   VALIDASI PROYEK JUMAT.AI (DOCKER & TRAEFIK)       `);
  console.log(`======================================================`);

  const args = process.argv.slice(2);
  const shouldSniff = args.includes('--sniff');
  const targetIdx = args.indexOf('--target');
  const targetSlug = targetIdx !== -1 ? args[targetIdx + 1] : null;

  const projectsRoot = path.join(__dirname, '..', 'projects');
  if (!fs.existsSync(projectsRoot)) {
    logError(`Direktori projects tidak ditemukan di ${projectsRoot}`);
    process.exit(1);
  }

  const entries = fs.readdirSync(projectsRoot, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (targetSlug && entry.name !== targetSlug) continue;

    validateProject(entry.name, path.join(projectsRoot, entry.name), { sniff: shouldSniff });
  }

  console.log(`\n======================================================`);
  if (hasErrors) {
    console.error(`\x1b[31m✖ Validasi GAGAL! Perbaiki pelanggaran di atas sebelum mengirim PR.\x1b[0m\n`);
    process.exit(1);
  } else {
    console.log(`\x1b[32m✔ Semua konfigurasi proyek lolos verifikasi keamanan & arsitektur!\x1b[0m\n`);
  }
}

/**
 * Validasi satu folder proyek dan kembalikan daftar pesan error (tanpa output konsol/exit).
 */
function validateProjectDir(folderName, projectDir, options = {}) {
  return collectErrors(() => validateProject(folderName, projectDir, options));
}

if (require.main === module) {
  main();
}

module.exports = {
  validateProject,
  validateProjectDir,
  validateDockerCompose,
  validateProjectFiles,
  collectErrors
};
