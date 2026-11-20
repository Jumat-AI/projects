# 🖥️ Panduan Setup Server Produksi — Jumat.AI

Dokumen ini ditujukan untuk **pengelola/administrator** server VPS yang menjalankan platform **project.jumat.ai.id**.

---

## 1. 🌐 Setup Jaringan Traefik (1-Kali Saja)

Platform ini menggunakan reverse proxy **Traefik** yang sudah ada di server. Agar proyek komunitas tidak dapat mengakses container proyek pribadi Anda yang berada di network `web`, buat network terisolasi khusus:

```bash
# 1. Buat network Docker khusus proyek komunitas
docker network create jumat-ai-web

# 2. Hubungkan container Traefik yang sedang aktif ke network ini
docker network connect jumat-ai-web <nama_container_traefik_anda>
```

---

## 2. 📁 Penyiapan Direktori Target di Server

Buat folder root deployment di server VPS:

```bash
sudo mkdir -p /var/www/project.jumat.ai.id
sudo chown -R $USER:$USER /var/www/project.jumat.ai.id
```

Struktur folder di server nantinya akan tersinkronisasi otomatis:
```text
/var/www/project.jumat.ai.id/
├── hub/                         # Container katalog depan
└── projects/                    # Folder masing-masing proyek komunitas
    ├── gemini-prompt-crafter/
    └── <proyek-lain>/
```

---

## 3. 🔑 Konfigurasi GitHub Actions Secrets

Buka repositori GitHub di menu **Settings > Secrets and variables > Actions**, lalu tambahkan Repository Secrets berikut:

| Nama Secret | Deskripsi | Contoh |
| :--- | :--- | :--- |
| `SERVER_HOST` | IP publik atau domain server VPS Anda | `203.0.113.1` atau `vps.jumat.ai.id` |
| `SERVER_USER` | Username SSH untuk login dan eksekusi Docker | `deploy` atau `ubuntu` |
| `SERVER_SSH_KEY` | Private SSH Key yang memiliki hak akses ke server | `-----BEGIN OPENSSH PRIVATE KEY-----...` |
| `SERVER_PORT` | Port SSH server Anda | `22` |

> [!TIP]
> Pastikan user SSH yang digunakan (`SERVER_USER`) sudah tergabung dalam grup `docker` di server (`sudo usermod -aG docker $USER`), sehingga dapat mengeksekusi perintah `docker compose` tanpa `sudo`.

---

## 4. 🔄 Alur Deploy Otomatis

Setiap kali Pull Request proyek komunitas di-merge ke branch `main`:
1. GitHub Action membaca `git diff` untuk menemukan proyek yang berubah.
2. File disinkronisasi ke `/var/www/project.jumat.ai.id/` via SSH `rsync`.
3. Command `docker compose up -d --build --remove-orphans` dieksekusi **hanya di folder proyek yang berubah**.
4. Traefik otomatis mendeteksi rute baru dan menayangkan aplikasi di `https://project.jumat.ai.id/<slug>/`.
