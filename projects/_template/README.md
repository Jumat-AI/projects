# Template Proyek Komunitas Jumat.AI

Folder ini adalah starter template resmi berbasis **Docker & Traefik** untuk mempublikasikan proyek AI Anda di **projects.jumat.ai.id**.

---

## 🛠️ Langkah Cepat Penggunaan

1. **Salin Folder Template:**
   ```bash
   cp -r projects/_template projects/slug-proyek-anda
   ```
   *(Gunakan huruf kecil dan tanda strip, contoh: `voice-transcriber`)*

2. **Sesuaikan `project.json`:**
   - Isi `slug`, `title`, dan `description`.
   - Masukkan link repositori GitHub aplikasi Anda di `repo_url`.
   - Isi `commit_sha` dengan hash commit lengkap (40 karakter) yang ingin di-deploy: jalankan `git rev-parse HEAD` di repo aplikasi Anda (commit harus sudah di-push).
   - Masukkan port internal aplikasi Anda di `internal_port` (contoh: `3000`, `8000`, atau `8501` untuk Streamlit).
   - Isi identitas Anda di bagian `author`.

3. **Sesuaikan `Dockerfile`:**
   - Isi `REPO_URL` dan `COMMIT_SHA` sama dengan `project.json`. Jangan ganti blok `git fetch` dengan `git clone`.
   - Tentukan base image sesuai bahasa aplikasi Anda (Node.js, Python, Go, dll).
   - Pastikan port yang di-expose sama dengan `internal_port`.

4. **Sesuaikan `docker-compose.yml`:**
   - Ganti semua teks `nama-project-anda` dengan slug proyek Anda.
   - Ganti `REPO_URL` dan `COMMIT_SHA` di `build.args` agar sama dengan `project.json`.
   - Sesuaikan port `loadbalancer.server.port` dan `expose`.
   - **Ingat:** Jangan hapus batasan CPU/RAM dan jangan pernah mengekspos port ke host (`ports:` dilarang).

5. **Uji Validasi Lokal:**
   ```bash
   npm run validate
   ```
   Pastikan tidak ada peringatan kesalahan sebelum mengirim Pull Request ke branch `main`.
