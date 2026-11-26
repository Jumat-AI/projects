# 📋 Technical Debt & Backlog — Project Jumat.AI

Dokumen ini mencatat keputusan desain, fitur keamanan lanjutan, dan optimasi arsitektur yang sengaja ditangguhkan (*technical debt*) untuk diimplementasikan pada iterasi berikutnya seiring pertumbuhan jumlah kontributor dan proyek.

---

## 1. 🔐 Manajemen Kredensial Mandiri Kontributor (GitLab Secure Files Equivalent)

### Status
- **Prioritas:** Sedang
- **Kategori:** Security & Automation
- **Status Saat Ini:** Backlog / Technical Debt

### Konteks & Latar Belakang
Saat ini, proyek yang membutuhkan API Key AI atau secret backend disarankan menggunakan:
1. **BYOK (Bring Your Own Key)** langsung di browser pengguna (Zero risk).
2. **File `.env` lokal** yang diletakkan manual oleh pengelola di server VPS (`/var/www/projects.jumat.ai.id/projects/<slug>/.env`).

Kebutuhan akan fitur serupa *GitLab Project Secure Files* muncul agar kontributor dapat mengunggah file konfigurasi rahasia/kredensial tanpa perlu menghubungi admin secara manual dan tanpa membocorkannya di Pull Request publik.

### Rencana Implementasi Masa Depan
1. **Asymmetric Encryption (`age` / `SOPS`):**
   - Publikasikan Public Key resmi Jumat.AI di repositori (`docs/jumat-ai.pub`).
   - Kontributor mengenkripsi file `.env` lokal menjadi `.env.enc` dan meng-commitnya ke dalam PR.
   - Workflow GitHub Actions ([`deploy.yml`](file:///D:/AI/project-jumat-ai/.github/workflows/deploy.yml)) otomatis men-dekripsi `.env.enc` menjadi `.env` di server menggunakan Private Key rahasia yang tersimpan di GitHub Secrets.
2. **Alternatif Managed Secret Engine:**
   - Evaluasi penggunaan open-source secret manager seperti **Infisical** atau **Doppler** jika skala proyek melebihi puluhan kontributor aktif.

### Alasan Ditunda Saat Ini
Pada fase awal peluncuran showcase, mayoritas proyek komunitas menggunakan pendekatan **BYOK (Bring Your Own Key)** di sisi klien atau model lokal browser (Transformers.js / WebLLM), sehingga manajemen secret terenkripsi di PR belum menjadi *blocker* kritis.

---

## 2. 🧹 Otomasi Pembersihan Disk & Cache Container

### Status
- **Prioritas:** Rendah
- **Kategori:** Maintenance & Infrastructure

### Konteks
Setiap kali ada pembaruan kode dan `docker compose up -d --build` dijalankan, Docker engine akan menyisakan *dangling images* dan *build cache*.

### Rencana Implementasi
- Menambahkan cron job berkala di server VPS:
  ```bash
  # Membersihkan build cache dan container/image lama yang tidak lagi terpakai
  0 3 * * 0 docker system prune -af --volumes=false
  ```

---

## 3. 🌐 Dukungan Custom Subdomain Per Proyek

### Status
- **Prioritas:** Rendah
- **Kategori:** Routing & Traefik

### Konteks
Saat ini seluruh proyek disajikan melalui path prefix: `projects.jumat.ai.id/<nama-project>`.

### Rencana Implementasi
- Menyediakan opsi di `project.json` bagi proyek yang ingin menggunakan subdomain independen (misal: `voice.projects.jumat.ai.id`) dengan wildcard DNS `*.projects.jumat.ai.id` dan routing Traefik berbasis `Host(...)`.
