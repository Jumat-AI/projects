# Showcase Proyek Komunitas — Jumat.AI

Repositori resmi platform showcase kreasi komunitas **[project.jumat.ai.id](https://project.jumat.ai.id)**, bagian dari inisiatif belajar bersama **[jumat.ai.id](https://jumat.ai.id)**.

Platform ini mengadopsi arsitektur **Containerized Multi-Tenant (Docker + Traefik)** dengan tata kelola berbasis **GitOps**:
- 🛡️ **Network Isolation:** Proyek komunitas berjalan di network Docker terisolasi (`jumat-ai-web`), terpisah total dari network proyek pribadi Anda di server.
- ⚡ **Build & Deploy Independen:** Multi-stage build di-clone langsung dari repo GitHub kontributor. Server hanya mem-build dan me-restart container proyek yang mengalami perubahan.
- 🚫 **Zero Port Exposure:** Tidak ada port yang diekspos langsung ke publik (`ports:` dilarang). Seluruh akses melewati Traefik melalui path `project.jumat.ai.id/<nama_project>`.
- ⚖️ **Resource Enforcement:** Setiap container dibatasi secara ketat (CPU <= 0.5 vCPU, RAM <= 512MB).
- 🔍 **Security Code Sniffer:** GitHub Actions otomatis memindai potensi malware, crypto-miner, dan kredensial bocor pada repo kontributor sebelum Pull Request di-merge.

---

## 📁 Struktur Direktori

```text
project-jumat-ai/
│
├── .github/
│   └── workflows/
│       ├── pr-validation.yml    # CI: Linter Docker/Compose & Code Sniffer repo kontributor
│       └── deploy.yml           # CD: Build & deploy otomatis HANYA untuk proyek yang berubah
│
├── docs/
│   └── ARCHITECTURE.md          # Dokumentasi teknis isolasi jaringan, Traefik, & keamanan
│
├── hub/                         # Halaman katalog utama (project.jumat.ai.id/)
│   ├── index.html               # UI katalog (pencarian, filter kategori, responsive dark mode)
│   ├── styles.css               # Desain UI modern
│   ├── app.js                   # Logika render kartu proyek
│   └── projects.json            # Index seluruh proyek terdaftar (auto-generated)
│
├── projects/                    # Direktori seluruh proyek komunitas
│   ├── _template/               # Starter template Dockerfile + docker-compose untuk kontributor
│   └── gemini-prompt-crafter/   # Contoh proyek bawaan berbasis container
│
├── scripts/
│   ├── build-catalog.js         # Mengompilasi metadata seluruh proyek menjadi hub/projects.json
│   ├── validate-pr.js           # Validator keamanan Docker, compose rules, & Code Sniffer
│   └── serve.js                 # Dev server lokal bawaan Node.js
│
├── CONTRIBUTING.md              # Panduan lengkap kontribusi bagi komunitas
├── package.json
└── README.md
```

---

## 🚀 Setup 1-Kali di Server (Production Server)

Karena **Traefik** sudah aktif di server Anda pada network `web`, Anda hanya perlu melakukan langkah berikut satu kali:

### 1. Buat Network Terisolasi & Hubungkan ke Traefik
Agar container proyek komunitas tidak dapat mengakses container proyek pribadi Anda di network `web`:
```bash
# 1. Buat network khusus komunitas
docker network create jumat-ai-web

# 2. Hubungkan container Traefik ke network baru ini
docker network connect jumat-ai-web <nama_container_traefik_anda>
```

### 2. Siapkan Direktori Target di Server
```bash
sudo mkdir -p /var/www/project.jumat.ai.id
sudo chown -R $USER:$USER /var/www/project.jumat.ai.id
```

### 3. Konfigurasi GitHub Secrets
Pada repositori GitHub Anda, buka **Settings > Secrets and variables > Actions**, lalu tambahkan:
- `SERVER_HOST`: IP publik atau domain server Anda.
- `SERVER_USER`: Username SSH server Anda (misal: `ubuntu` atau `deploy`).
- `SERVER_SSH_KEY`: SSH Private Key untuk rsync dan akses eksekusi docker.
- `SERVER_PORT`: Port SSH server Anda (default: `22`).

---

## 🛠️ Pengujian Lokal & Pembuatan Proyek Baru

```bash
# 1. Validasi seluruh konfigurasi Dockerfile & docker-compose
npm run validate

# 2. Kompilasi katalog proyek
npm run build

# 3. Jalankan server lokal untuk melihat tampilan hub katalog
npm run dev
```

Untuk panduan lengkap bagi kontributor yang ingin menambahkan proyek baru menggunakan template, silakan baca **[CONTRIBUTING.md](file:///D:/AI/project-jumat-ai/CONTRIBUTING.md)**.
