# 🏛️ Arsitektur Sistem — Project Jumat.AI

Dokumen ini menjelaskan rancangan arsitektur teknis, isolasi jaringan, tata kelola container, serta sistem keamanan otomatis platform **projects.jumat.ai.id**.

---

## 1. 🌐 Arsitektur Jaringan & Isolasi Traefik

Server produksi menjalankan **Traefik** sebagai reverse proxy utama untuk semua layanan (proyek pribadi dan proyek komunitas).

### Tantangan Keamanan Jaringan
Secara bawaan pada Docker, jika container proyek komunitas diletakkan di network `web` yang sama dengan proyek-proyek pribadi Anda, container komunitas dapat melakukan scanning dan menghubungi port internal proyek pribadi Anda via Docker DNS.

### Solusi: Isolasi Multi-Network Traefik
Traefik memiliki kemampuan untuk terhubung ke **lebih dari satu Docker network** sekaligus. Kita memanfaatkan fitur ini untuk memisahkan domain keamanan:

```text
                                  INTERNET
                                     │
                             (Port 80 / 443)
                                     ▼
                      ┌─────────────────────────────┐
                      │    Traefik Reverse Proxy    │
                      └──────────────┬──────────────┘
                                     │
           ┌─────────────────────────┴─────────────────────────┐
           │                                                   │
  (Network: "web")                                  (Network: "jumat-ai-web")
           ▼                                                   ▼
┌─────────────────────────┐                       ┌─────────────────────────┐
│  Proyek Pribadi Anda    │                       │ Proyek Komunitas AI 1   │
│  - database internal    │                       │  (RAM <= 512M, CPU 0.5) │
│  - api pribadi          │                       ├─────────────────────────┤
│  - web klien            │                       │ Proyek Komunitas AI 2   │
└─────────────────────────┘                       │  (RAM <= 512M, CPU 0.5) │
                                                  └─────────────────────────┘
                                                               │
                         [TERISOLASI TOTAL DARI NETWORK "web"] ◄─┘
```

### Konfigurasi 1-Kali di Server
Untuk mengaktifkan isolasi ini, jalankan perintah berikut sekali saja di server Anda:
```bash
# 1. Buat network terisolasi khusus proyek komunitas
docker network create jumat-ai-web

# 2. Hubungkan container Traefik yang sudah ada ke network baru ini
docker network connect jumat-ai-web <nama_container_traefik_anda>
```

Dengan langkah di atas:
1. Traefik dapat merutekan trafik HTTPS ke proyek komunitas di `projects.jumat.ai.id/<nama-project>`.
2. Proyek komunitas **tidak memiliki akses jaringan sama sekali** ke network `web` tempat proyek pribadi Anda berjalan.

---

## 2. 📦 Siklus Build Multi-Stage (Clean Server)

Source code aplikasi berada di repositori GitHub masing-masing kontributor. Repositori `project-jumat-ai` Anda hanya menyimpan orkestrasinya (`Dockerfile`, `docker-compose.yml`, dan `project.json`).

### Mengapa Multi-Stage Build?
```dockerfile
# Stage 1: Cloner
FROM alpine/git:latest AS cloner
ARG REPO_URL
ARG COMMIT_SHA   # hash commit 40 karakter, dikunci lewat PR
WORKDIR /source
RUN git init -q . && git remote add origin "${REPO_URL}" \
 && git fetch -q --depth 1 origin "${COMMIT_SHA}" && git checkout -q FETCH_HEAD

# Stage 2: Runner
FROM node:20-alpine
COPY --from=cloner /source /app
...
```
* **Disk Server Ramping:** Git history, tool git, dan file sementara dibuang oleh Docker saat build selesai.
* **Isolasi Kode:** Server tidak menyimpan file mentah di direktori luar container. Seluruh dependensi terkapsul di dalam image container.
* **Pinning Commit:** Kode diambil tepat di `COMMIT_SHA` yang tercatat di `project.json`, bukan dari branch. Kode yang di-build saat deploy (atau saat rebuild kapan pun) selalu identik dengan kode yang dipindai Code Sniffer dan di-review saat PR. Validator menolak `git clone`, argumen `BRANCH`, `ADD <url>`, serta SHA yang tidak konsisten antara `Dockerfile`, `docker-compose.yml`, dan `project.json`.

---

## 3. 🔄 Alur Lengkap GitOps (Dari PR Hingga Deploy)

Mekanisme penambahan dan pembaruan proyek diatur secara otomatis melalui siklus GitOps:

```mermaid
flowchart TD
    subgraph TahapKontributor["1. Kontributor"]
        A["Fork & Clone project-jumat-ai"] --> B["Duplikasi projects/_template/"]
        B --> C["Sesuaikan project.json, Dockerfile, & docker-compose.yml"]
        C --> D["Uji Mandiri: npm run validate"]
        D --> E["Buka Pull Request (PR) ke branch main"]
    end

    subgraph TahapCI["2. GitHub Actions CI (Cloud Runner)"]
        E --> F["Trigger pr-validation.yml\n(permissions: contents: read)\nValidator & dependency dari commit base,\nhanya projects/ yang diambil dari PR"]
        F --> G{"Linter Orkestrasi:\n- Zero host ports?\n- Limit CPU & RAM?\n- Network jumat-ai-web?"}
        G -- Gagal --> H["Validasi Gagal"]
        G -- Lolos --> I["Clone Sandbox Sementara\n& Jalankan Code Sniffer"]
        I -- Gagal --> H
        I -- Lolos --> J["Centang Hijau di PR"]
        H --> R["Upload artifact hasil\n(nomor PR + status)"]
        J --> R
        R --> S["Trigger pr-comment.yml via workflow_run\n(berjalan dari main, permissions: pull-requests: write)"]
        S --> U["Verifikasi head SHA PR\n= commit yang divalidasi"]
        U --> T["Upsert komentar bot\n(marker jumat-ai-pr-validation)\n+ peringatan file di luar projects/ via API"]
    end

    subgraph TahapAdmin["3. Pengelola Jumat.AI"]
        J --> K["Review & Merge PR"]
    end

    subgraph TahapCD["4. Server VPS (Self-Hosted Runner)"]
        K --> L["Trigger deploy.yml\n(concurrency: deploy-production)"]
        L --> L2{"Approval environment\nproduction"}
        L2 -- Disetujui --> M["Deteksi folder proyek yang berubah\nvia git diff .last-deployed-sha..HEAD"]
        M --> V["rsync lokal hub/ & projects/\nke /var/www/projects.jumat.ai.id\n(tanpa --delete)"]
        V --> Q{"Folder proyek\nmasih ada di repo?"}
        Q -- Dihapus --> X["docker compose down\n& pindah ke _archived/nama-timestamp"]
        Q -- Ada --> N["Eksekusi: docker compose up -d --build\nHANYA di folder proyek tersebut"]
        X --> W["Refresh container Hub"]
        N --> W
        W --> Y["Catat SHA ke .last-deployed-sha"]
        Y --> O["Traefik deteksi rute baru via Docker socket"]
        O --> P["Live di https://projects.jumat.ai.id/slug/"]
    end
```

---

## 4. ⚡ Eksekusi Build Independen Per Proyek

Salah satu keunggulan utama arsitektur ini adalah **efisiensi deploy**:
* Self-hosted runner di server mendeteksi folder proyek yang berubah sejak **deploy sukses terakhir** (SHA tersimpan di `/var/www/projects.jumat.ai.id/.last-deployed-sha`). Push yang deploy-nya gagal atau terlewat ikut ter-deploy pada run berikutnya. Fallback: commit sebelum push (`github.event.before`), lalu `HEAD~1`:
  ```bash
  git diff --name-only "$(cat /var/www/projects.jumat.ai.id/.last-deployed-sha)" HEAD | grep '^projects/'
  ```
* Setiap deploy menunggu persetujuan pengelola melalui environment `production` (lihat [SERVER_SETUP.md](SERVER_SETUP.md)).
* Folder proyek yang **dihapus dari repo** dihentikan (`docker compose down`) lalu dipindah ke `/var/www/projects.jumat.ai.id/_archived/<slug>-<timestamp>/`, bukan dihapus permanen, agar data masih bisa dipulihkan.
* Runner hanya mengeksekusi build pada folder yang bersangkutan:
  ```bash
  cd /var/www/projects.jumat.ai.id/projects/<slug-yang-berubah>
  docker compose up -d --build --remove-orphans
  ```
* **Keuntungan:** Puluhan proyek lain yang sedang aktif berjalan tidak akan terganggu, tidak mengalami restart, dan server tidak terbebani me-rebuild proyek yang tidak berubah.

---

## 5. 🛡️ Penegakan Keamanan & Code Sniffer

Setiap Pull Request (PR) yang masuk melewati 2 lapis pengujian otomatis di GitHub Actions sebelum diizinkan untuk di-merge:

### Lapis 1: Linter Aturan Orkestrasi (`validate-pr.js`)
* 🚫 **Zero Host Port Exposure:** Dilarang menggunakan deklarasi `ports:`. Hanya `expose:` internal yang diizinkan agar seluruh trafik wajib melewati Traefik.
* 🚫 **Allowlist Opsi Service:** Berlaku untuk **semua** service. Opsi di luar daftar izin (`privileged`, `network_mode`, `pid`, `cap_add`, `devices`, dll.) ditolak.
* 🚫 **No Host Bind-Mount:** Hanya named volume yang dideklarasikan di top-level; bind mount dalam bentuk apa pun dan volume dengan `driver_opts` ditolak.
* 🚫 **No Interpolasi:** `$`, `${...}`, dan `$$` dilarang di seluruh compose agar tidak menarik variabel environment server.
* 🚫 **Image Siap Pakai Terbatas:** `image:` tanpa `build` hanya untuk database/S3-compatible di allowlist, wajib dipin digest, tanpa label Traefik, dan tidak boleh di network `jumat-ai-web`.
* 🚫 **Routing Terkunci ke Slug:** Nama service, router, dan middleware wajib diawali slug; rule router wajib `Host(projects.jumat.ai.id) && PathPrefix(/<slug>)`.
* ⚖️ **Resource Quota per Proyek:** Total `limits` semua service maksimal:
  - CPU: `0.5` vCPU.
  - RAM: `512M`.

### Lapis 2: Code Sniffer Sandbox di Cloud GitHub
Sebelum kode menyentuh server Anda, GitHub Actions meng-clone repositori kontributor ke sandbox runner sementara dan memindai:
1. **Pencegahan Kripto-Mining:** Memindai pola `xmrig`, `stratum+tcp`, `nanopool`, dll.
2. **Pencegahan Reverse Shell:** Memindai pola `nc -e`, `/dev/tcp/`, `mkfifo`, dll.
3. **Pencegahan Kebocoran Rahasia:** Memindai RSA Private Key, AWS Key, atau API Key yang tertinggal di repositori publik.

---

## 6. 🏷️ Traefik Routing & Middleware StripPrefix

Setiap proyek disajikan pada sub-path: `projects.jumat.ai.id/<slug>`.

Agar aplikasi kontributor tidak perlu mengubah kode routing internalnya, middleware `stripprefix` digunakan:
```yaml
labels:
  - "traefik.enable=true"
  - "traefik.docker.network=jumat-ai-web"
  - "traefik.http.routers.slug.rule=Host(`projects.jumat.ai.id`) && PathPrefix(`/slug`)"
  - "traefik.http.middlewares.slug-strip.stripprefix.prefixes=/slug"
  - "traefik.http.routers.slug.middlewares=slug-strip"
  - "traefik.http.services.slug.loadbalancer.server.port=3000"
```
Dengan konfigurasi ini:
* Pengguna mengakses: `https://projects.jumat.ai.id/voice-ai/api/generate`
* Aplikasi di container menerima request bersih: `/api/generate`

---

## 7. 📋 Technical Debt & Pengembangan Mendatang

Daftar pertimbangan arsitektur dan fitur yang ditangguhkan ke iterasi berikutnya (termasuk manajemen file kredensial mandiri kontributor ala *GitLab Secure Files*) dapat dilihat pada dokumen:
👉 **[docs/TECHNICAL_DEBT.md](file:///D:/AI/project-jumat-ai/docs/TECHNICAL_DEBT.md)**

