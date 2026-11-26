# ==============================================================================
# TEMPLATE DOCKERFILE PROYEK KOMUNITAS JUMAT.AI
# Arsitektur Multi-Stage: Clone repo eksternal saat build untuk hemat resource server
# ==============================================================================

# ------------------------------------------------------------------------------
# STAGE 1: Cloner (Mengambil kode dari repo GitHub Anda)
# ------------------------------------------------------------------------------
# WAJIB: kode dikunci ke satu commit (COMMIT_SHA, 40 karakter hex), BUKAN branch.
# Dengan begitu kode yang di-deploy selalu sama dengan kode yang di-review saat PR.
# Untuk merilis versi baru, ganti COMMIT_SHA lewat Pull Request baru.
# Nilai REPO_URL & COMMIT_SHA di sini, di docker-compose.yml (build.args), dan di
# project.json (repo_url & commit_sha) harus sama persis.
# ------------------------------------------------------------------------------
FROM alpine/git:latest AS cloner
ARG REPO_URL="https://github.com/username_anda/repo-proyek-anda.git"
ARG COMMIT_SHA="0000000000000000000000000000000000000000"
WORKDIR /source

# Fetch shallow tepat di commit yang dikunci, lalu pastikan HEAD sesuai COMMIT_SHA
RUN git init -q . && \
    git remote add origin "${REPO_URL}" && \
    git fetch -q --depth 1 origin "${COMMIT_SHA}" && \
    git checkout -q FETCH_HEAD && \
    test "$(git rev-parse HEAD)" = "${COMMIT_SHA}" && \
    rm -rf .git

# ------------------------------------------------------------------------------
# STAGE 2: Runtime Application
# Contoh di bawah menggunakan Node.js 20.
# Anda dapat menggantinya sesuai bahasa proyek Anda (Python, Go, Rust, dll).
# ------------------------------------------------------------------------------
FROM node:20-alpine AS runner
WORKDIR /app

# Atur environment produksi
ENV NODE_ENV=production

# Salin source code dari stage cloner
COPY --from=cloner /source /app

# Install dependencies jika file package.json ada
RUN if [ -f package.json ]; then npm install --production --silent; fi

# Gunakan non-root user demi standar keamanan
USER node

# Expose port internal aplikasi (HANYA internal container, TIDAK ada port mapping di host)
EXPOSE 3000

CMD ["npm", "start"]

# ==============================================================================
# CATATAN CONTOH RUNTIME ALTERNATIF LAIN:
# ==============================================================================
# Untuk Python FastAPI / Flask / Streamlit:
# ------------------------------------------------------------------------------
# FROM python:3.11-slim AS runner
# WORKDIR /app
# COPY --from=cloner /source /app
# RUN if [ -f requirements.txt ]; then pip install --no-cache-dir -r requirements.txt; fi
# EXPOSE 8000
# CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
# ==============================================================================
