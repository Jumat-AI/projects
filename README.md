# Showcase Proyek Komunitas — Jumat.AI

Selamat datang di repositori showcase kreasi komunitas **[projects.jumat.ai.id](https://projects.jumat.ai.id)**, bagian dari inisiatif belajar bersama **[jumat.ai.id](https://jumat.ai.id)**.

Repositori ini adalah tempat bagi anggota komunitas untuk mempublikasikan aplikasi dan eksperimen AI berbasis Docker agar dapat diakses oleh publik di `https://projects.jumat.ai.id/<nama-project>`.

---

## 🚀 Cara Menambahkan Proyek Anda

Untuk mempublikasikan proyek AI Anda, ikuti 5 langkah mudah berikut:

### 1. Fork & Clone Repositori
1. Klik tombol **Fork** di pojok kanan atas repositori ini.
2. Clone ke komputer Anda:
   ```bash
   git clone https://github.com/<username-anda>/project-jumat-ai.git
   cd project-jumat-ai
   npm install
   ```

### 2. Duplikasi Folder Template
Salin folder `projects/_template` menjadi nama proyek Anda (gunakan huruf kecil dan tanda strip):
```bash
# Contoh nama slug: audio-summarizer
cp -r projects/_template projects/audio-summarizer
```

### 3. Sesuaikan File Konfigurasi
Buka folder `projects/<nama-project>/` dan sesuaikan 3 file berikut:

1. **`project.json`:**
   Isi informasi slug, judul, deskripsi, link repositori aplikasi asli Anda di GitHub (`repo_url`), port internal aplikasi (`internal_port`), dan profil pembuat.
2. **`Dockerfile`:**
   Pastikan `REPO_URL` mengarah ke repositori Anda, sesuaikan base image runtime (Node.js, Python, Go, dll), serta port yang di-`EXPOSE`.
3. **`docker-compose.yml`:**
   Ganti teks `nama-project-anda` dengan nama slug proyek Anda, dan sesuaikan port internal di `loadbalancer.server.port`.

> [!IMPORTANT]
> **Aturan Wajib Proyek:**
> - 🚫 **Zero Host Port:** Dilarang menggunakan `ports:` (hanya gunakan `expose:` internal).
> - ⚖️ **Batasan Resource:** Wajib mencantumkan limit `cpus: '0.5'` dan `memory: 512M`.
> - 🌐 **Network:** Wajib terhubung ke network `jumat-ai-web`.

### 4. Uji Mandiri Secara Lokal
Pastikan konfigurasi proyek Anda memenuhi semua standar keamanan dan orkestrasi:
```bash
npm run validate
```
Pastikan seluruh indikator berstatus `✔ [PASS]`.

### 5. Kirim Pull Request (PR)
1. Commit dan push perubahan Anda:
   ```bash
   git add projects/nama-project-anda/
   git commit -m "feat: tambah proyek nama-project-anda"
   git push origin main
   ```
2. Buka **Pull Request** ke branch `main` repositori resmi `project-jumat-ai`.
3. Bot GitHub Actions akan otomatis memvalidasi file orkestrasi dan menjalankan **Code Sniffer** pada repositori kode Anda.
4. Setelah disetujui dan di-merge oleh pengelola, proyek Anda otomatis live di **`https://projects.jumat.ai.id/<nama-project>`**! 🎉

---

## 📚 Dokumentasi Lanjutan (Docs)

Seluruh alur cara kerja internal aplikasi, arsitektur teknis, dan panduan server tersimpan di direktori **[`docs/`](docs/)**:

* 🏛️ **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md):** Penjelasan mendalam arsitektur monorepo, topologi isolasi multi-network Traefik, dan alur kerja GitOps.
* 🖥️ **[docs/SERVER_SETUP.md](docs/SERVER_SETUP.md):** Panduan setup server VPS produksi, network Docker, dan konfigurasi GitHub Secrets untuk pengelola.
* 📋 **[docs/TECHNICAL_DEBT.md](docs/TECHNICAL_DEBT.md):** Catatan backlog dan rencana manajemen kredensial mandiri kontributor.
* 📖 **[CONTRIBUTING.md](CONTRIBUTING.md):** Panduan kontribusi komprehensif beserta diagram visual.
