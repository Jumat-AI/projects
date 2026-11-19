const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');
const yaml = require('js-yaml');

const RESERVED_SLUGS = [
  'admin', 'api', 'hub', 'auth', 'login', 'static', 'assets',
  'dashboard', 'root', 'test', 'help', 'docs', 'settings', 'user', 'users'
];

const SLUG_REGEX = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const MAX_CPU_LIMIT = 0.5; // Maksimal 0.5 core CPU
const MAX_MEMORY_LIMIT_MB = 512; // Maksimal 512 MB RAM
const REQUIRED_NETWORK_NAME = 'jumat-ai-web';

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

function logPass(msg) {
  console.log(`\x1b[32m✔ [PASS]\x1b[0m ${msg}`);
}

function logError(msg) {
  hasErrors = true;
  console.error(`\x1b[31m✖ [FAIL]\x1b[0m ${msg}`);
}

function logWarn(msg) {
  console.warn(`\x1b[33m▲ [WARN]\x1b[0m ${msg}`);
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

function validateDockerCompose(composePath, slug) {
  if (!fs.existsSync(composePath)) {
    logError(`File docker-compose.yml tidak ditemukan di ${composePath}`);
    return false;
  }

  const rawContent = fs.readFileSync(composePath, 'utf8');

  // 1. Cek port exposure di raw text
  if (/^\s*ports\s*:/m.test(rawContent)) {
    logError(`Aturan Keamanan Terlanggar: DILARANG menggunakan 'ports:' pada docker-compose.yml! Proyek hanya boleh menggunakan 'expose:' untuk port internal.`);
  }

  let doc;
  try {
    doc = yaml.load(rawContent);
  } catch (e) {
    logError(`Format YAML pada docker-compose.yml tidak valid: ${e.message}`);
    return false;
  }

  if (!doc || !doc.services) {
    logError(`docker-compose.yml wajib mendefinisikan section 'services'.`);
    return false;
  }

  const serviceNames = Object.keys(doc.services);
  if (serviceNames.length === 0) {
    logError(`Tidak ada service yang didefinisikan di docker-compose.yml.`);
    return false;
  }

  const primaryService = doc.services.app || doc.services[serviceNames[0]];

  // 2. Cek Expose & Ports
  if (primaryService.ports && primaryService.ports.length > 0) {
    logError(`Service '${serviceNames[0]}' mengekspos port ke host publik via 'ports:'. Ini dilarang.`);
  } else {
    logPass(`Zero host port exposure: Tidak ada port host yang diekspos.`);
  }

  if (!primaryService.expose || primaryService.expose.length === 0) {
    logWarn(`Service sebaiknya mendefinisikan 'expose:' untuk port internal.`);
  }

  // 3. Cek Privileged Mode
  if (primaryService.privileged) {
    logError(`Aturan Keamanan: 'privileged: true' sangat dilarang.`);
  }

  // 4. Cek Volumes (Dilarang bind-mount direktori sensitif host)
  if (primaryService.volumes) {
    for (const vol of primaryService.volumes) {
      const volStr = typeof vol === 'string' ? vol : vol.source || '';
      if (volStr.startsWith('/') || volStr.startsWith('~') || volStr.includes('docker.sock')) {
        logError(`Aturan Keamanan: Dilarang bind-mount path host sistem: "${volStr}". Hanya named volume yang diizinkan.`);
      }
    }
  }

  // 5. Cek Batasan Resource (CPU & RAM)
  const limits = primaryService.deploy?.resources?.limits;
  if (!limits) {
    logError(`Wajib mendefinisikan batasan resource di 'deploy.resources.limits' (cpus & memory).`);
  } else {
    const cpus = parseFloat(limits.cpus || 0);
    const memoryMb = parseMemory(limits.memory);

    if (!limits.cpus || cpus <= 0 || cpus > MAX_CPU_LIMIT) {
      logError(`Batasan CPU (${limits.cpus || 'tidak ada'}) melebihi batas maksimal yang diizinkan (${MAX_CPU_LIMIT} vCPU).`);
    } else {
      logPass(`Batasan CPU valid: ${cpus} vCPU (Maks: ${MAX_CPU_LIMIT})`);
    }

    if (!limits.memory || memoryMb <= 0 || memoryMb > MAX_MEMORY_LIMIT_MB) {
      logError(`Batasan Memory (${limits.memory || 'tidak ada'}) melebihi batas maksimal yang diizinkan (${MAX_MEMORY_LIMIT_MB} MB).`);
    } else {
      logPass(`Batasan Memory valid: ${limits.memory} (Maks: ${MAX_MEMORY_LIMIT_MB} MB)`);
    }
  }

  // 6. Cek Traefik Labels
  const labels = primaryService.labels || [];
  const labelObj = {};
  if (Array.isArray(labels)) {
    for (const l of labels) {
      const [k, ...v] = l.split('=');
      labelObj[k.trim()] = v.join('=').trim();
    }
  } else if (typeof labels === 'object') {
    Object.assign(labelObj, labels);
  }

  if (labelObj['traefik.enable'] !== 'true') {
    logError(`Label 'traefik.enable=true' wajib ada.`);
  } else {
    logPass(`Label 'traefik.enable=true' ditemukan.`);
  }

  if (labelObj['traefik.docker.network'] !== REQUIRED_NETWORK_NAME) {
    logError(`Label 'traefik.docker.network' harus disetel ke '${REQUIRED_NETWORK_NAME}'.`);
  }

  // Cek Network isolasi
  const networks = doc.networks || {};
  let networkValid = false;
  for (const netKey of Object.keys(networks)) {
    const netConf = networks[netKey];
    if (netConf && (netConf.name === REQUIRED_NETWORK_NAME || netKey === REQUIRED_NETWORK_NAME) && netConf.external === true) {
      networkValid = true;
      break;
    }
  }

  if (!networkValid) {
    logError(`docker-compose.yml wajib mendefinisikan network external '${REQUIRED_NETWORK_NAME}' untuk isolasi Traefik.`);
  } else {
    logPass(`Network terisolasi '${REQUIRED_NETWORK_NAME}' terkonfigurasi dengan benar.`);
  }

  return true;
}

function validateDockerfile(dockerfilePath) {
  if (!fs.existsSync(dockerfilePath)) {
    logError(`File Dockerfile tidak ditemukan di ${dockerfilePath}`);
    return false;
  }

  const content = fs.readFileSync(dockerfilePath, 'utf8');

  for (const pattern of DANGEROUS_DOCKERFILE_PATTERNS) {
    if (pattern.test(content)) {
      logError(`Dockerfile terdeteksi memuat instruksi yang berisiko keamanan tinggi: ${pattern}`);
    }
  }

  logPass(`Pemeriksaan keamanan dasar Dockerfile lolos.`);
  return true;
}

function runCodeSniffer(repoUrl, slug) {
  if (!repoUrl || repoUrl.includes('username_anda') || repoUrl.includes('example.com')) {
    logWarn(`Repo URL "${repoUrl}" adalah placeholder template. Sniffer eksternal dilewati.`);
    return;
  }

  console.log(`\n\x1b[35m[CODE SNIFFER]\x1b[0m Memeriksa repositori eksternal: ${repoUrl}`);
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), `sniff-${slug}-`));

  try {
    execSync(`git clone --depth 1 ${repoUrl} "${tmpDir}"`, { stdio: 'pipe', timeout: 30000 });
    logPass(`Shallow clone ke sandbox berhasil.`);

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
    logWarn(`Gagal menjalankan sniffer clone untuk ${repoUrl}: ${err.message}`);
  } finally {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch (_) {}
  }
}

function validateProject(folderName, projectDir, options = {}) {
  const isTemplate = folderName === '_template';
  console.log(`\n======================================================`);
  console.log(`Memeriksa project: \x1b[36m${folderName}\x1b[0m`);
  console.log(`======================================================`);

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
  validateDockerfile(path.join(projectDir, 'Dockerfile'));

  // 3. Cek docker-compose.yml
  validateDockerCompose(path.join(projectDir, 'docker-compose.yml'), folderName);

  // 4. Jalankan Code Sniffer jika diminta
  if (options.sniff && metadata && metadata.repo_url && !isTemplate) {
    runCodeSniffer(metadata.repo_url, folderName);
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

main();
