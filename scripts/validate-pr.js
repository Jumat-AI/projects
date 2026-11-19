const fs = require('fs');
const path = require('path');

const RESERVED_SLUGS = [
  'admin', 'api', 'hub', 'auth', 'login', 'static', 'assets',
  'dashboard', 'root', 'test', 'help', 'docs', 'settings', 'user', 'users'
];

const ALLOWED_AI_TYPES = ['client-side', 'byok', 'external-backend', 'utility'];

const FORBIDDEN_EXTENSIONS = [
  '.exe', '.dll', '.bat', '.cmd', '.sh', '.php', '.py', '.rb',
  '.pl', '.env', '.pem', '.key', '.zip', '.tar', '.gz', '.bin',
  '.iso', '.msi', '.apk', '.jar', '.c', '.cpp', '.rs', '.go'
];

const MAX_FOLDER_SIZE_BYTES = 15 * 1024 * 1024; // 15 MB
const SLUG_REGEX = /^[a-z0-9]+(-[a-z0-9]+)*$/;

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

function calculateFolderSize(dirPath) {
  let total = 0;
  const items = fs.readdirSync(dirPath);

  for (const item of items) {
    const fullPath = path.join(dirPath, item);
    const lstat = fs.lstatSync(fullPath);

    if (lstat.isSymbolicLink()) {
      logError(`Dilarang menggunakan symlink: ${fullPath}`);
    } else if (lstat.isDirectory()) {
      total += calculateFolderSize(fullPath);
    } else if (lstat.isFile()) {
      const ext = path.extname(item).toLowerCase();
      if (FORBIDDEN_EXTENSIONS.includes(ext) || item.startsWith('.env')) {
        logError(`Tipe file tidak diizinkan: ${fullPath} (${ext})`);
      }
      total += lstat.size;
    }
  }

  return total;
}

function validateProject(folderName, projectDir) {
  console.log(`\nMemeriksa project: \x1b[36m${folderName}\x1b[0m`);

  // 1. Validasi format nama slug
  if (!SLUG_REGEX.test(folderName)) {
    logError(`Nama folder "${folderName}" tidak valid. Hanya boleh huruf kecil, angka, dan strip (contoh: "voice-ai-id").`);
  } else {
    logPass(`Format nama slug valid: ${folderName}`);
  }

  // 2. Cek reserved slug
  if (RESERVED_SLUGS.includes(folderName)) {
    logError(`Nama folder "${folderName}" menggunakan nama cadangan sistem yang dilarang.`);
  }

  // 3. Cek keberadaan index.html
  const indexPath = path.join(projectDir, 'index.html');
  if (!fs.existsSync(indexPath)) {
    logError(`File wajib "index.html" tidak ditemukan di "${projectDir}".`);
  } else {
    logPass(`File "index.html" ditemukan.`);
  }

  // 4. Cek keberadaan project.json
  const metadataPath = path.join(projectDir, 'project.json');
  if (!fs.existsSync(metadataPath)) {
    logError(`File wajib "project.json" tidak ditemukan di "${projectDir}".`);
    return;
  }

  // 5. Validasi isi project.json
  try {
    const rawContent = fs.readFileSync(metadataPath, 'utf-8');
    const meta = JSON.parse(rawContent);

    if (meta.slug !== folderName) {
      logError(`Field "slug" di project.json ("${meta.slug}") tidak cocok dengan nama folder ("${folderName}").`);
    }

    if (!meta.title || typeof meta.title !== 'string' || meta.title.length < 3 || meta.title.length > 60) {
      logError(`Field "title" harus berupa teks antara 3 - 60 karakter.`);
    }

    if (!meta.description || typeof meta.description !== 'string' || meta.description.length < 10 || meta.description.length > 300) {
      logError(`Field "description" harus berupa teks antara 10 - 300 karakter.`);
    }

    if (!meta.author || typeof meta.author !== 'object' || !meta.author.name || !meta.author.github) {
      logError(`Field "author" harus memiliki "name" dan "github" username.`);
    }

    if (!Array.isArray(meta.tags) || meta.tags.length === 0 || meta.tags.length > 6) {
      logError(`Field "tags" harus berupa array berisi 1 sampai 6 string.`);
    }

    if (!ALLOWED_AI_TYPES.includes(meta.ai_type)) {
      logError(`Field "ai_type" harus salah satu dari: ${ALLOWED_AI_TYPES.join(', ')}.`);
    }

    logPass(`Metadata project.json valid.`);
  } catch (err) {
    logError(`Gagal membaca/parse project.json: ${err.message}`);
  }

  // 6. Cek ukuran folder & file terlarang
  const folderSize = calculateFolderSize(projectDir);
  const sizeMB = (folderSize / (1024 * 1024)).toFixed(2);

  if (folderSize > MAX_FOLDER_SIZE_BYTES) {
    logError(`Ukuran folder project terlalu besar (${sizeMB} MB). Maksimal yang diizinkan adalah 15 MB.`);
  } else {
    logPass(`Ukuran folder aman: ${sizeMB} MB (Batas: 15 MB).`);
  }
}

function run() {
  console.log(`\n=== \x1b[1mVALIDASI PROYEK KOMUNITAS JUMAT.AI\x1b[0m ===`);
  const projectsDir = path.join(__dirname, '..', 'projects');

  if (!fs.existsSync(projectsDir)) {
    logError(`Direktori "projects" tidak ditemukan.`);
    process.exit(1);
  }

  const entries = fs.readdirSync(projectsDir, { withFileTypes: true });
  const projectFolders = entries
    .filter(entry => entry.isDirectory() && !entry.name.startsWith('_'))
    .map(entry => entry.name);

  if (projectFolders.length === 0) {
    logWarn(`Belum ada project komunitas (hanya template).`);
    return;
  }

  for (const folder of projectFolders) {
    validateProject(folder, path.join(projectsDir, folder));
  }

  console.log(`\n============================================`);
  if (hasErrors) {
    console.error(`\x1b[31m❌ Validasi GAGAL! Silakan perbaiki kesalahan di atas sebelum merge PR.\x1b[0m\n`);
    process.exit(1);
  } else {
    console.log(`\x1b[32m✔ Semua project lolos uji keamanan dan struktur!\x1b[0m\n`);
  }
}

run();
