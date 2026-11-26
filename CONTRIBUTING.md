# Panduan Kontribusi Proyek Komunitas — Jumat.AI

Terima kasih atas ketertarikan Anda untuk membagikan karya Anda di **[projects.jumat.ai.id](https://projects.jumat.ai.id)**! Platform ini adalah wadah terbuka bagi seluruh pembelajar dan praktisi AI di Indonesia.

---

## 🗺️ Alur Kontribusi (Overview)

```mermaid
flowchart TD
    subgraph Kontributor["1. Di Komputer Kontributor"]
        A["Fork & Clone repo project-jumat-ai"] --> B["Salin folder projects/_template/\nmenjadi projects/nama-project/"]
        B --> C["Sesuaikan project.json, Dockerfile,\n& docker-compose.yml"]
        C --> D["Uji mandiri: npm run validate"]
        D --> E["Commit & Kirim Pull Request (PR) ke branch main"]
    end

    subgraph GitHubCI["2. Di Cloud GitHub (CI & Sniffer)"]
        E --> F["GitHub Actions: pr-validation.yml\n(token read-only, aman untuk PR dari fork)"]
        F --> G{"Linter Orkestrasi:\n- Zero host ports?\n- Total CPU <= 0.5 & RAM <= 512M per proyek?\n- Network jumat-ai-web?"}
        G -- Tidak --> H["Validasi Gagal"]
        G -- Ya --> I["Clone sementara repo kontributor\n& Jalankan Code Sniffer (Malware/Miner/Secret)"]
        I -- Temuan --> H
        I -- Bersih --> J["Validasi Lolos: Centang Hijau"]
        H --> R["Simpan hasil sebagai artifact"]
        J --> R
        R --> S["GitHub Actions: pr-comment.yml\n(dipicu workflow_run)"]
        S --> T["Bot pasang / perbarui SATU komentar\nhasil validasi di PR"]
    end

    subgraph AdminAction["3. Di Sisi Pengelola"]
        J --> K["Pengelola Review & Klik 'Merge'"]
    end

    subgraph ServerDeploy["4. Di Server VPS (CD)"]
        K --> L["GitHub Actions: deploy.yml\n(self-hosted runner, menunggu persetujuan pengelola)"]
        L --> M["Deteksi folder yang berubah via git diff\n(seluruh commit dalam push)"]
        M --> Q{"Folder proyek\nmasih ada?"}
        Q -- Dihapus --> X["docker compose down\n& arsipkan ke _archived/"]
        X --> Z["Proyek offline & hilang dari Katalog Depan"]
        Q -- Ada --> N["Build & up HANYA proyek tersebut:\ndocker compose up -d --build"]
        N --> O["Traefik deteksi rute baru via docker socket"]
        O --> P["🚀 Live di projects.jumat.ai.id/nama-project/\n& Otomatis Muncul di Katalog Depan!"]
    end
```

---

## 📋 Syarat & Ketentuan Proyek

Untuk menjaga **keamanan**, **stabilitas server bersama**, dan **keadilan resource**, setiap proyek yang diunggah wajib mematuhi aturan berikut:

1. **Format Aplikasi:** Harus diorkestrasikan menggunakan **Dockerfile** (multi-stage build yang meng-clone kode dari repo GitHub Anda) dan **docker-compose.yml**.
2. **Konektivitas & Routing:**
   - DILAYANI melalui subdomain utama: `https://projects.jumat.ai.id/<nama-project>`.
   - **Zero Host Port Exposure:** DILARANG menggunakan deklarasi `ports:`. Hanya gunakan `expose:` untuk port internal container.
   - Wajib terhubung ke network eksternal: `jumat-ai-web`.
3. **Batasan Resource:**
   - Batas berlaku **per proyek**: jumlah `deploy.resources.limits` dari **semua** service di `docker-compose.yml`.
   - **CPU:** Total maksimal `0.5` vCPU (mis. satu service `cpus: '0.5'`, atau aplikasi `0.35` + database `0.15`).
   - **RAM:** Total maksimal `512 MB` (mis. satu service `memory: 512M`, atau aplikasi `384M` + database `128M`).
   - Setiap service tetap wajib mencantumkan `limits` sendiri.
4. **Keamanan & Standar Kode** (berlaku untuk **setiap** service di `docker-compose.yml`):
   - Hanya opsi service yang ada di daftar izin validator yang boleh dipakai. `privileged`, `network_mode`, `pid`, `cap_add`, `devices`, dan opsi tingkat host lainnya ditolak.
   - Dilarang bind-mount path apa pun dari host (termasuk `./data` atau `../`). Gunakan **named volume** yang dideklarasikan di bagian `volumes:` top-level.
   - Dilarang memakai variabel `${...}`, `$VAR`, atau `$$` di file compose, termasuk di `environment`. Tulis nilai literal.
   - Nama service wajib sama dengan slug atau diawali `<slug>-` (mis. `audio-summarizer`, `audio-summarizer-db`), agar tidak bentrok dengan proyek lain di network bersama.
   - Rule router Traefik wajib persis `Host(\`projects.jumat.ai.id\`) && PathPrefix(\`/<slug>\`)`, dan nama router/middleware wajib diawali slug. Middleware yang diizinkan hanya `stripprefix`.
   - Dilarang menyertakan symlink, file `.env`, atau file compose alternatif (`compose.yaml`, `docker-compose.override.yml`, dll.) di folder proyek.
   - Repositori kode Anda akan dipindai oleh **Code Sniffer** otomatis saat Pull Request untuk memastikan bebas dari malware, script crypto-mining, reverse shell, dan kebocoran kredensial pribadi.

---

## 🚀 Langkah-Langkah Mengirimkan Proyek Baru

### 1. Fork & Clone Repositori
1. Klik tombol **Fork** di repositori GitHub `project-jumat-ai`.
2. Kloning ke komputer Anda:
   ```bash
   git clone https://github.com/<username-anda>/project-jumat-ai.git
   cd project-jumat-ai
   npm install
   ```

### 2. Salin Starter Template
Salin folder `projects/_template` menjadi nama proyek Anda (gunakan huruf kecil dan strip):
```bash
# Contoh nama slug: audio-summarizer
cp -r projects/_template projects/audio-summarizer
```

### 3. Sesuaikan Metadata `projects/<slug>/project.json`
Buka file `project.json` di dalam folder proyek Anda:
```json
{
  "slug": "audio-summarizer",
  "title": "Audio AI Summarizer",
  "description": "Ringkas file audio panjang menggunakan Whisper dan LLM.",
  "repo_url": "https://github.com/username_anda/audio-summarizer-app",
  "commit_sha": "3f9c2a1e8b7d6c5f4e3a2b1c0d9e8f7a6b5c4d3e",
  "internal_port": 8000,
  "author": {
    "name": "Nama Lengkap Anda",
    "github": "username_github_anda",
    "avatar": "https://github.com/username_github_anda.png"
  },
  "tags": ["audio", "whisper", "summarizer"],
  "ai_type": "external-backend",
  "resources": {
    "cpu": "0.5",
    "memory": "512M"
  },
  "version": "1.0.0",
  "created_at": "2026-11-20"
}
```

> [!IMPORTANT]
> **Aturan Pinning Commit:** `commit_sha` wajib berisi hash commit **lengkap (40 karakter)** dari repo aplikasi Anda, bukan nama branch. Dapatkan dengan `git rev-parse HEAD` di repo aplikasi Anda, dan pastikan commit tersebut sudah di-push. Server hanya mem-build kode di commit itu, sehingga kode yang berjalan selalu sama dengan kode yang di-review. Untuk merilis versi baru, kirim PR baru yang mengganti `commit_sha`.

### 4. Sesuaikan `projects/<slug>/Dockerfile`
Pastikan argumen `REPO_URL` dan `COMMIT_SHA` sama persis dengan `repo_url` dan `commit_sha` di `project.json`. Jangan ganti blok `git fetch` dengan `git clone`; validator akan menolaknya.
```dockerfile
FROM alpine/git:latest AS cloner
ARG REPO_URL="https://github.com/username_anda/audio-summarizer-app.git"
ARG COMMIT_SHA="3f9c2a1e8b7d6c5f4e3a2b1c0d9e8f7a6b5c4d3e"
WORKDIR /source
RUN git init -q . && \
    git remote add origin "${REPO_URL}" && \
    git fetch -q --depth 1 origin "${COMMIT_SHA}" && \
    git checkout -q FETCH_HEAD && \
    test "$(git rev-parse HEAD)" = "${COMMIT_SHA}" && \
    rm -rf .git

# Ganti base image sesuai bahasa aplikasi Anda (Python / Node / dll)
FROM python:3.11-slim AS runner
WORKDIR /app
COPY --from=cloner /source /app
RUN if [ -f requirements.txt ]; then pip install --no-cache-dir -r requirements.txt; fi

EXPOSE 8000
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
```

### 5. Sesuaikan `projects/<slug>/docker-compose.yml`
Ganti seluruh teks `nama-project-anda` dengan nama slug proyek Anda dan pastikan port internal sesuai:
```yaml
version: '3.8'

services:
  audio-summarizer:   # nama service WAJIB = slug (atau diawali "<slug>-")
    container_name: jumat-ai-audio-summarizer
    build:
      context: .
      args:
        REPO_URL: "https://github.com/username_anda/audio-summarizer-app.git"
        COMMIT_SHA: "3f9c2a1e8b7d6c5f4e3a2b1c0d9e8f7a6b5c4d3e"
    restart: unless-stopped
    expose:
      - "8000"
    networks:
      - traefik-net
    deploy:
      resources:
        limits:
          cpus: '0.5'
          memory: 512M
    labels:
      - "traefik.enable=true"
      - "traefik.docker.network=jumat-ai-web"
      - "traefik.http.routers.audio-summarizer.rule=Host(`projects.jumat.ai.id`) && PathPrefix(`/audio-summarizer`)"
      - "traefik.http.routers.audio-summarizer.entrypoints=websecure"
      - "traefik.http.routers.audio-summarizer.tls=true"
      - "traefik.http.middlewares.audio-summarizer-strip.stripprefix.prefixes=/audio-summarizer"
      - "traefik.http.routers.audio-summarizer.middlewares=audio-summarizer-strip"
      - "traefik.http.services.audio-summarizer.loadbalancer.server.port=8000"

networks:
  traefik-net:
    name: jumat-ai-web
    external: true
```

#### (Opsional) Menambahkan Database atau Object Storage
Aplikasi Anda wajib di-build dari `Dockerfile` proyek. Image siap pakai (`image:` tanpa `build:`) **hanya** diizinkan untuk database dan object storage S3-compatible berikut: `postgres`, `pgvector/pgvector`, `mysql`, `mariadb`, `mongo`, `redis`, `valkey/valkey`, `qdrant/qdrant`, `chromadb/chroma`, `minio/minio`.

Syaratnya:
- Image **wajib dipin digest** (`nama:tag@sha256:<64 karakter hex>`). Dapatkan digest dengan `docker buildx imagetools inspect postgres:16-alpine`.
- Service database **tidak boleh** punya label `traefik.*` dan **tidak boleh** tersambung ke network `jumat-ai-web`. Hubungkan lewat network internal proyek.
- Tetap wajib memakai named volume dan batasan resource. Jatah `0.5` vCPU & `512M` dibagi untuk aplikasi **dan** database, jadi kurangi limit service aplikasi Anda.

```yaml
services:
  audio-summarizer:
    # ... konfigurasi aplikasi seperti di atas, dengan perubahan:
    networks:
      - traefik-net
      - internal
    environment:
      DATABASE_URL: "postgresql://app:app@audio-summarizer-db:5432/app"
    deploy:
      resources:
        limits:
          cpus: '0.35'     # 0.35 + 0.15 (db) = 0.5 vCPU per proyek
          memory: 384M     # 384M + 128M (db) = 512M per proyek

  audio-summarizer-db:
    image: postgres:16-alpine@sha256:<ganti-dengan-digest-64-hex>
    restart: unless-stopped
    environment:
      POSTGRES_USER: app
      POSTGRES_PASSWORD: app
      POSTGRES_DB: app
    volumes:
      - db-data:/var/lib/postgresql/data
    networks:
      - internal
    deploy:
      resources:
        limits:
          cpus: '0.15'
          memory: 128M

volumes:
  db-data:

networks:
  traefik-net:
    name: jumat-ai-web
    external: true
  internal: {}
```

> [!NOTE]
> Karena variabel `${...}` dilarang, kredensial database ditulis literal di file compose. Database hanya bisa diakses dari network internal proyek Anda, jadi jangan gunakan kredensial yang Anda pakai di tempat lain.

### 6. Uji Validasi Mandiri
Jalankan skrip pengujian otomatis sebelum melakukan commit:
```bash
npm run validate
```
Pastikan seluruh indikator berstatus `✔ [PASS]`.

### 7. Kirim Pull Request (PR)
1. Commit dan push perubahan Anda ke GitHub:
   ```bash
   git add projects/audio-summarizer/
   git commit -m "feat: tambah proyek audio-summarizer"
   git push origin main
   ```
2. Buka GitHub repositori utama `project-jumat-ai` dan klik **Compare & pull request**.
3. Sistem CI otomatis akan memvalidasi file orkestrasi Anda dan menjalankan **Code Sniffer** pada repositori aplikasi Anda.
4. Setelah diverifikasi dan disetujui oleh pengelola, proyek Anda otomatis di-build dan langsung live di **`https://projects.jumat.ai.id/<nama-project>`**! 🎉
