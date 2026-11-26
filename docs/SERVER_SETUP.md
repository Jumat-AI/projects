# 🖥️ Panduan Setup Server Produksi — Jumat.AI

Dokumen ini ditujukan untuk **pengelola/administrator** server VPS yang menjalankan platform **projects.jumat.ai.id**.

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
sudo mkdir -p /var/www/projects.jumat.ai.id
sudo chown -R $USER:$USER /var/www/projects.jumat.ai.id
```

Struktur folder di server nantinya akan tersinkronisasi otomatis:
```text
/var/www/projects.jumat.ai.id/
├── hub/                         # Container katalog depan
└── projects/                    # Folder masing-masing proyek komunitas
    ├── gemini-prompt-crafter/
    └── <proyek-lain>/
```

---

## 3. 🏃 Setup Self-Hosted Runner untuk Deploy

Workflow [`deploy.yml`](../.github/workflows/deploy.yml) berjalan di **self-hosted runner** yang terpasang langsung di server produksi. Tidak ada SSH key di GitHub Secrets dan port SSH tidak perlu dibuka untuk GitHub. Validasi PR (`pr-validation.yml`) dan komentar PR (`pr-comment.yml`) tetap berjalan di runner GitHub-hosted.

> [!CAUTION]
> Runner yang punya akses Docker **setara root** di server. Pull Request dari fork dapat menyisipkan workflow baru yang menargetkan runner ini. Semua pengaman di bagian 4 **wajib** dipasang **sebelum** runner diaktifkan.

### 3.1 Buat user khusus runner

```bash
sudo useradd -m -s /bin/bash gh-runner
sudo usermod -aG docker gh-runner                        # butuh akses docker compose
sudo chown -R gh-runner:gh-runner /var/www/projects.jumat.ai.id
sudo apt-get install -y rsync git                        # dipakai oleh deploy.yml
```

Jangan jalankan runner sebagai `root` atau sebagai user admin pribadi Anda.

### 3.2 Pasang runner

1. Buka **Settings repo > Actions > Runners > New self-hosted runner** (Linux), lalu ikuti perintah unduh yang ditampilkan GitHub sebagai user `gh-runner` (`sudo -iu gh-runner`).
2. Saat menjalankan `./config.sh`, tambahkan label khusus deploy:
   ```bash
   ./config.sh --url https://github.com/Jumat-AI/projects --token <TOKEN> \
     --labels jumat-ai-deploy --runnergroup "deploy-production" --unattended
   ```
3. Jalankan sebagai service systemd agar otomatis hidup setelah reboot:
   ```bash
   sudo ./svc.sh install gh-runner
   sudo ./svc.sh start
   ```
4. Pastikan runner tampil **Idle** di halaman Runners. Jika runner mati, deploy akan tertahan di status *Queued* tanpa error, jadi pantau status service ini.

### 3.3 Deploy pertama kali

Server menyimpan SHA terakhir yang berhasil di-deploy di `/var/www/projects.jumat.ai.id/.last-deployed-sha`. Setelah runner aktif, jalankan **Actions > Deploy Otomatis per Proyek ke Server > Run workflow** dengan opsi **full_deploy** dicentang untuk membangun semua proyek sekali dan membuat file tersebut.

### 3.4 Hapus secret lama

Secret `SERVER_HOST`, `SERVER_USER`, `SERVER_SSH_KEY`, dan `SERVER_PORT` tidak dipakai lagi. Hapus dari **Settings > Secrets and variables > Actions**, lalu cabut public key terkait dari `~/.ssh/authorized_keys` di server.

---

## 4. 🛡️ Pengaman Wajib di GitHub

Pengaturan berikut dilakukan di halaman Settings GitHub (tidak bisa diatur dari file di repo):

| # | Lokasi | Pengaturan | Fungsi |
| :- | :--- | :--- | :--- |
| 1 | **Settings organisasi > Actions > Runner groups** | Buat grup `deploy-production`, akses repo: hanya `Jumat-AI/projects`; **Workflow access: Selected workflows** = `Jumat-AI/projects/.github/workflows/deploy.yml@refs/heads/main` | **Pengaman utama.** Runner hanya mau menjalankan `deploy.yml` dari `main`; workflow sisipan dari PR (fork maupun branch internal) ditolak. Jika repo publik, aktifkan *Allow public repositories* hanya untuk grup ini |
| 2 | **Settings repo > Actions > General** | *Fork pull request workflows*: **Require approval for all external contributors** | Workflow dari fork tidak berjalan sebelum Anda menekan *Approve and run* |
| 3 | **Settings repo > Environments** | Buat environment `production`: **Required reviewers** = Anda; **Deployment branches** = `main` saja; *Prevent self-review* **dimatikan** (agar Anda bisa menyetujui merge Anda sendiri) | Setiap deploy menunggu persetujuan Anda |
| 4 | **Settings repo > Rules > Rulesets** (target branch `main`) | Aktifkan *Require a pull request before merging* + **Require review from Code Owners**; blokir force-push & penghapusan branch | Memaksa file sensitif di [`.github/CODEOWNERS`](../.github/CODEOWNERS) di-review pengelola |

> [!NOTE]
> Code Owner tidak bisa meng-approve PR buatannya sendiri. Jika Anda satu-satunya pengelola, tambahkan diri Anda ke *bypass list* ruleset untuk PR milik sendiri. PR dari kontributor tetap wajib Anda review.

Saat me-review PR kontributor, periksa **semua file di luar `projects/<nama-proyek>/`**. Perubahan pada `.github/`, `scripts/`, `package*.json`, dan `hub/` akan dieksekusi di server produksi setelah merge.

---

## 5. 🔄 Alur Deploy Otomatis

Setiap kali Pull Request proyek komunitas di-merge ke branch `main`:
1. Job deploy masuk antrean dan **menunggu persetujuan Anda** di environment `production`.
2. Setelah disetujui, self-hosted runner membandingkan `HEAD` dengan SHA deploy terakhir (`.last-deployed-sha`) untuk menemukan proyek yang berubah atau dihapus, termasuk dari push yang deploy-nya sempat terlewat. Rename folder proyek dibaca sebagai *hapus lama + tambah baru*.
3. Semua isi `hub/` dan `projects/` disinkronisasi secara lokal ke `/var/www/projects.jumat.ai.id/` dengan `rsync`. Tanpa `--delete`, sehingga file yang hanya ada di server (`.env`, data runtime) tidak terhapus. File dengan nama sama yang ikut ter-commit di repo **akan menimpa** versi server.
4. Proyek yang dihapus dari repo dihentikan (`docker compose down`) lalu dipindah ke `_archived/<slug>-<timestamp>/`. Folder hanya dipindah bila container berhasil dihentikan.
5. `docker compose up -d --build --remove-orphans` dieksekusi **hanya di folder proyek yang berubah**, lalu container Hub di-refresh.
6. Kegagalan satu proyek **tidak menghentikan** proyek lain. Proyek yang gagal dicatat di `.failed-projects` dan otomatis dicoba ulang pada deploy berikutnya, run ditandai gagal (merah), dan SHA tetap dicatat ke `.last-deployed-sha`. Bila refresh Hub gagal, SHA tidak dicatat sehingga seluruh perubahan diulang.
7. Traefik otomatis mendeteksi rute baru dan menayangkan aplikasi di `https://projects.jumat.ai.id/<slug>/`.

> [!WARNING]
> - Deploy menolak berjalan bila commit-nya **lebih lama** dari deploy terakhir (mis. tombol *Re-run* pada run lama), supaya produksi tidak mundur versi. Bila file `.last-deployed-sha` hilang, deploy berikutnya hanya memproses perubahan dari push tersebut (dengan peringatan) atau gagal dengan instruksi menjalankan `full_deploy`.
> - Named volume Docker milik proyek yang diarsipkan **tidak ikut dihapus**. Jangan izinkan slug proyek lama dipakai ulang oleh kontributor lain tanpa menghapus volume-nya terlebih dulu (`docker volume ls` / `docker volume rm`), karena proyek baru akan mewarisi datanya.
