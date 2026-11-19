# ==============================================================================
# TEMPLATE DOCKERFILE PROYEK KOMUNITAS JUMAT.AI
# Arsitektur Multi-Stage: Clone repo eksternal saat build untuk hemat resource server
# ==============================================================================

# ------------------------------------------------------------------------------
# STAGE 1: Cloner (Mengambil kode dari repo GitHub Anda)
# ------------------------------------------------------------------------------
FROM alpine/git:latest AS cloner
ARG REPO_URL="https://github.com/username_anda/repo-proyek-anda.git"
ARG BRANCH="main"
WORKDIR /source

# Clone shallow (kedalaman 1) agar proses build cepat dan hemat bandwidth
RUN git clone --depth 1 --branch ${BRANCH} ${REPO_URL} . && \
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
