# Panduan Kontribusi Proyek Komunitas — Jumat.AI

Terima kasih atas ketertarikan Anda untuk membagikan karya Anda di **[project.jumat.ai.id](https://project.jumat.ai.id)**! Platform ini adalah wadah kreasi terbuka bagi seluruh pembelajar dan praktisi AI di Indonesia.

---

## 📋 Syarat & Ketentuan Proyek

Untuk menjaga **keamanan**, **performa server**, dan **kenyamanan bersama**, setiap proyek yang diunggah harus memenuhi kriteria berikut:

1. **Format Aplikasi:** Harus berupa **Static Web App** (HTML, CSS, JavaScript/WASM). Tidak diperkenankan menyertakan backend server (Node.js daemon, Python server, PHP, atau Docker).
2. **Kategori Integrasi AI:**
   - 🔑 **BYOK (Bring Your Own Key):** Form input agar pengunjung memasukkan API Key mereka sendiri (Gemini / OpenAI / Groq) yang disimpan di `sessionStorage` peramban.
   - ⚡ **Client-Side AI:** Menjalankan model AI langsung di browser menggunakan WebGPU / WASM (contoh: Transformers.js, WebLLM, ONNX Runtime Web).
   - 🌐 **External Backend:** Jika Anda membuat model/backend sendiri di FastAPI/Flask, hosting backend Anda di layanan gratis (seperti Hugging Face Spaces / Render), lalu panggil endpoint HTTPS tersebut dari frontend Anda via `fetch()`.
   - 🛠️ **Utility Tools:** Alat bantu seperti tokenizer, prompt formatter, atau visualizer dataset.
3. **Ukuran Maksimal:** Total ukuran folder proyek maksimal **15 MB**. Jika membutuhkan aset besar (seperti video/model weights), gunakan tautan eksternal (CDN / Hugging Face).
4. **Keamanan:**
   - Dilarang keras menyertakan file binary (`.exe`, `.bin`), skrip bash/cmd (`.sh`, `.bat`), atau file rahasia (`.env`).
   - Dilarang membuat form login palsu / phishing.
   - Dilarang menggunakan symlink.

---

## 🚀 Langkah-Langkah Mengirimkan Proyek

### 1. Fork & Clone Repositori
1. Klik tombol **Fork** di pojok kanan atas repositori GitHub ini.
2. Clone repositori hasil fork ke komputer lokal Anda:
   ```bash
   git clone https://github.com/<username-anda>/project-jumat-ai.git
   cd project-jumat-ai
   ```

### 2. Salin Folder Template
Salin folder `projects/_template` menjadi nama proyek Anda (gunakan huruf kecil dan tanda strip):
```bash
# Contoh nama: voice-transcriber-id
cp -r projects/_template projects/nama-project-anda
```

### 3. Sesuaikan Metadata `project.json`
Buka file `projects/nama-project-anda/project.json` dan isi data Anda:
```json
{
  "slug": "nama-project-anda",
  "title": "Nama Judul Proyek",
  "description": "Deskripsi singkat dan menarik mengenai apa yang dilakukan oleh proyek AI ini.",
  "author": {
    "name": "Nama Lengkap Anda",
    "github": "username_github_anda",
    "avatar": "https://github.com/username_github_anda.png"
  },
  "tags": ["gemini", "prompt-engineering", "byok"],
  "ai_type": "byok",
  "version": "1.0.0",
  "created_at": "2026-11-20"
}
```

### 4. Bangun Aplikasi Anda
- Edit `index.html`, `style.css`, dan `script.js` di dalam folder proyek Anda.
- Pastikan semua link internal menggunakan path relatif (`./style.css` atau `script.js`) agar berjalan lancar di subdomain `project.jumat.ai.id/nama-project-anda/`.

### 5. Uji Coba Secara Lokal
Jalankan dev server bawaan untuk melihat hasilnya di peramban:
```bash
# 1. Kompilasi katalog lokal
npm run build

# 2. Jalankan server lokal
npm run dev
```
Buka peramban di:
- Katalog utama: [http://localhost:3000/](http://localhost:3000/)
- Proyek Anda: [http://localhost:3000/nama-project-anda/](http://localhost:3000/nama-project-anda/)

### 6. Jalankan Uji Validasi
Sebelum melakukan commit, pastikan proyek Anda lolos semua aturan linter & keamanan:
```bash
npm run validate
```
Jika muncul pesan `✔ Semua project lolos uji keamanan dan struktur!`, Anda siap melangkah ke tahap berikutnya.

### 7. Kirim Pull Request (PR)
1. Commit dan push perubahan Anda ke GitHub:
   ```bash
   git add projects/nama-project-anda/
   git commit -m "feat: tambah proyek nama-project-anda"
   git push origin main
   ```
2. Buka GitHub repositori utama dan klik **Compare & pull request**.
3. Berikan judul yang jelas: `feat: Menambahkan proyek <nama-project>`.
4. Sistem otomatis (GitHub Actions) akan memvalidasi PR Anda. Pengelola Jumat.AI akan meninjau dan menerima (merge) PR Anda.

Setelah di-merge, proyek Anda akan langsung tayang di **[project.jumat.ai.id/<nama-project>](https://project.jumat.ai.id)**! 🎉
