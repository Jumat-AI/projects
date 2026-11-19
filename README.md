# Showcase Proyek Komunitas — Jumat.AI

Repositori monorepo resmi untuk platform showcase kreasi komunitas **[project.jumat.ai.id](https://project.jumat.ai.id)**, bagian dari inisiatif belajar bersama **[jumat.ai.id](https://jumat.ai.id)**.

Platform ini dirancang khusus dengan arsitektur **Static-First**:
- 🛡️ **Paling Aman (Zero RCE Risk):** Tidak ada eksekusi kode server-side asing (Node/Python/PHP/Docker) di server pribadi Anda.
- ⚡ **Paling Hemat Sumber Daya:** RAM server yang dibutuhkan sangat minim (~20 MB untuk Nginx) bahkan saat melayani puluhan hingga ratusan proyek komunitas.
- 🤖 **Ramah AI:** Mendukung model browser (WebLLM/Transformers.js), mekanisme BYOK (Bring Your Own Key), maupun integrasi backend eksternal bebas biaya (Hugging Face Spaces).
- 🚀 **Otomatis:** Validasi keamanan ketat saat Pull Request (PR) masuk, dan auto-deploy via SSH Rsync saat PR di-merge.

---

## 📁 Struktur Direktori

```text
project-jumat-ai/
│
├── .github/
│   └── workflows/
│       ├── pr-validation.yml    # CI: Pengecekan otomatis struktur, ukuran & keamanan PR
│       └── deploy.yml           # CD: Otomatis deploy ke server pribadi saat merge
│
├── hub/                         # Halaman katalog utama (project.jumat.ai.id/)
│   ├── index.html               # UI katalog (pencarian instan, filter kategori AI)
│   ├── styles.css               # Desain modern & responsif (dark mode)
│   ├── app.js                   # Logika render kartu proyek dinamis
│   └── projects.json            # Index seluruh proyek terdaftar (auto-generated)
│
├── projects/                    # Direktori tempat seluruh proyek komunitas disimpan
│   ├── _template/               # Starter template siap pakai untuk kontributor baru
│   └── gemini-prompt-crafter/   # Contoh proyek bawaan (generator prompt AI dengan BYOK)
│
├── nginx/
│   └── project.jumat.ai.id.conf # Konfigurasi Nginx produksi (Rate limit, SSL, security headers)
│
├── scripts/
│   ├── build-catalog.js         # Mengompilasi seluruh project.json menjadi hub/projects.json
│   ├── validate-pr.js           # Skrip pengujian keamanan & validasi PR
│   └── serve.js                 # Dev server lokal tanpa dependensi tambahan
│
├── CONTRIBUTING.md              # Panduan lengkap kontribusi bagi komunitas
└── package.json
```

---

## 🛠️ Menjalankan Secara Lokal

Repositori ini tidak memerlukan instalasi dependensi pihak ketiga (`npm install` tidak diperlukan karena skrip menggunakan runtime standar Node.js).

```bash
# 1. Kompilasi katalog proyek
npm run build

# 2. Validasi integritas seluruh proyek
npm run validate

# 3. Jalankan server lokal
npm run dev
```

Buka peramban di:
- **Katalog Utama:** [http://localhost:3000/](http://localhost:3000/)
- **Proyek Bawaan:** [http://localhost:3000/gemini-prompt-crafter/](http://localhost:3000/gemini-prompt-crafter/)

---

## 🚀 Setup & Deployment di Server Pribadi (Self-Hosted)

### 1. Siapkan Direktori di Server Anda
Login ke server pribadi (VPS) Anda dan buat foldernya:
```bash
sudo mkdir -p /var/www/project.jumat.ai.id
sudo chown -R $USER:$USER /var/www/project.jumat.ai.id
```

### 2. Pasang Konfigurasi Nginx
1. Salin konfigurasi dari [`nginx/project.jumat.ai.id.conf`](file:///D:/AI/project-jumat-ai/nginx/project.jumat.ai.id.conf) ke server Anda di `/etc/nginx/sites-available/project.jumat.ai.id`.
2. Aktifkan konfigurasi dan reload Nginx:
   ```bash
   sudo ln -s /etc/nginx/sites-available/project.jumat.ai.id /etc/nginx/sites-enabled/
   sudo nginx -t
   sudo systemctl reload nginx
   ```
3. Pasang sertifikat SSL gratis via Certbot:
   ```bash
   sudo certbot --nginx -d project.jumat.ai.id
   ```

### 3. Konfigurasi GitHub Actions Secrets
Pada repositori GitHub Anda, buka **Settings > Secrets and variables > Actions**, lalu tambahkan:
- `SERVER_HOST`: Alamat IP publik atau domain server pribadi Anda.
- `SERVER_USER`: Username SSH di server Anda (misal: `ubuntu` atau `deploy`).
- `SERVER_SSH_KEY`: Private SSH Key yang memiliki akses rsync ke server Anda.
- `SERVER_PORT`: Port SSH server Anda (default: `22`).

Setiap kali Anda menekan tombol **Merge** pada Pull Request kontributor, GitHub Action akan otomatis mengompilasi katalog dan menyinkronkan file ke server Anda dalam hitungan detik.

---

## 🤝 Berkontribusi
Ingin membagikan proyek AI Anda di sini? Silakan baca panduan lengkap di [CONTRIBUTING.md](file:///D:/AI/project-jumat-ai/CONTRIBUTING.md).
