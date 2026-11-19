const fs = require('fs');
const path = require('path');

const projectsDir = path.join(__dirname, '..', 'projects');
const hubDir = path.join(__dirname, '..', 'hub');
const outputJsonPath = path.join(hubDir, 'projects.json');

function buildCatalog() {
  console.log(`\n📦 Mengompilasi katalog proyek komunitas...`);

  if (!fs.existsSync(projectsDir)) {
    console.error(`Folder projects/ tidak ditemukan!`);
    process.exit(1);
  }

  if (!fs.existsSync(hubDir)) {
    fs.mkdirSync(hubDir, { recursive: true });
  }

  const entries = fs.readdirSync(projectsDir, { withFileTypes: true });
  const catalog = [];

  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('_')) {
      continue;
    }

    const metadataPath = path.join(projectsDir, entry.name, 'project.json');
    if (!fs.existsSync(metadataPath)) {
      console.warn(`[SKIP] Folder "${entry.name}" tidak memiliki project.json.`);
      continue;
    }

    try {
      const data = JSON.parse(fs.readFileSync(metadataPath, 'utf-8'));
      // Pastikan slug terisi
      data.slug = data.slug || entry.name;
      // Periksa apakah preview image ada
      const previewLocalPath = path.join(projectsDir, entry.name, 'preview.png');
      data.has_preview = fs.existsSync(previewLocalPath);

      catalog.push(data);
      console.log(`  + Terdaftar: ${data.title} (${data.slug})`);
    } catch (err) {
      console.error(`[ERROR] Gagal memproses ${metadataPath}: ${err.message}`);
    }
  }

  // Sort by created_at desc (terbaru di atas)
  catalog.sort((a, b) => {
    const dateA = new Date(a.created_at || '2000-01-01');
    const dateB = new Date(b.created_at || '2000-01-01');
    return dateB - dateA;
  });

  fs.writeFileSync(outputJsonPath, JSON.stringify(catalog, null, 2), 'utf-8');
  console.log(`\n✔ Sukses! ${catalog.length} proyek tersimpan di: ${outputJsonPath}\n`);
}

buildCatalog();
