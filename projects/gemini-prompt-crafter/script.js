const STORAGE_KEY = 'jumat_ai_gemini_key';

const apiKeyInput = document.getElementById('apiKeyInput');
const saveKeyBtn = document.getElementById('saveKeyBtn');
const clearKeyBtn = document.getElementById('clearKeyBtn');
const keyFeedback = document.getElementById('keyFeedback');

const domainSelect = document.getElementById('domainSelect');
const formatSelect = document.getElementById('formatSelect');
const rawPrompt = document.getElementById('rawPrompt');
const craftBtn = document.getElementById('craftBtn');
const outputContainer = document.getElementById('outputContainer');
const craftedPromptText = document.getElementById('craftedPromptText');
const copyBtn = document.getElementById('copyBtn');

function initKeyUI() {
  const savedKey = sessionStorage.getItem(STORAGE_KEY);
  if (savedKey) {
    apiKeyInput.value = '••••••••••••••••••••••••••••••••';
    apiKeyInput.disabled = true;
    saveKeyBtn.style.display = 'none';
    clearKeyBtn.style.display = 'inline-block';
    keyFeedback.innerHTML = '<span style="color:#34d399">✔ Gemini API Key terpasang (Siap memproses dengan AI nyata)</span>';
  } else {
    apiKeyInput.value = '';
    apiKeyInput.disabled = false;
    saveKeyBtn.style.display = 'inline-block';
    clearKeyBtn.style.display = 'none';
    keyFeedback.innerHTML = '<span style="color:#9ca3af">Mode Simulasi aktif. Masukkan key jika ingin menghubungkan langsung ke Google Gemini.</span>';
  }
}

saveKeyBtn.addEventListener('click', () => {
  const key = apiKeyInput.value.trim();
  if (!key) {
    alert('Masukkan API Key Gemini terlebih dahulu.');
    return;
  }
  sessionStorage.setItem(STORAGE_KEY, key);
  initKeyUI();
});

clearKeyBtn.addEventListener('click', () => {
  sessionStorage.removeItem(STORAGE_KEY);
  initKeyUI();
});

copyBtn.addEventListener('click', () => {
  navigator.clipboard.writeText(craftedPromptText.textContent);
  copyBtn.textContent = '✔ Tersalin!';
  setTimeout(() => { copyBtn.textContent = 'Salin Prompt'; }, 2000);
});

craftBtn.addEventListener('click', async () => {
  const text = rawPrompt.value.trim();
  if (!text) {
    alert('Masukkan ide atau kebutuhan prompt Anda terlebih dahulu.');
    return;
  }

  const role = domainSelect.value;
  const format = formatSelect.value;
  const apiKey = sessionStorage.getItem(STORAGE_KEY);

  craftBtn.disabled = true;
  craftBtn.innerHTML = '<span>⏳ Sedang menyusun prompt...</span>';
  outputContainer.style.display = 'block';
  craftedPromptText.textContent = 'Menghubungi AI...';

  try {
    if (apiKey) {
      // Panggil Gemini 1.5 Flash via REST API
      const systemInstruction = `Kamu adalah Prompt Engineer ahli. Tugasmu adalah mengubah ide mentah dari user menjadi Mega-Prompt berkualitas tinggi dengan kerangka:
1. Role: Peran spesifik AI.
2. Context: Latar belakang dan situasi.
3. Task: Tugas utama secara rinci.
4. Constraints: Hal yang boleh dan dilarang dilakukan.
5. Format Output: Format hasil akhir.
Balas HANYA dengan prompt yang telah dioptimasi dalam format markdown tanpa basa-basi pembuka.`;

      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            parts: [{
              text: `${systemInstruction}\n\nUser Raw Idea: "${text}"\nTarget Role: "${role}"\nTarget Format: "${format}"`
            }]
          }]
        })
      });

      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error?.message || 'Gagal menghubungi Gemini API.');
      }

      const data = await response.json();
      const result = data.candidates?.[0]?.content?.parts?.[0]?.text;
      craftedPromptText.textContent = result || 'Gagal menghasilkan output.';
    } else {
      // Local Heuristic Synthesis (Simulasi cerdas tanpa API)
      await new Promise(r => setTimeout(r, 600));

      const simulatedCrafted = `### [OPTIMIZED MEGA-PROMPT]

**ROLE:**
Bertindaklah sebagai ${role} kelas dunia dengan pengalaman mendalam di bidang industri.

**CONTEXT:**
Saya sedang mengerjakan inisiatif berikut:
"${text}"

**TASK:**
Analisis dan kembangkan solusi komprehensif untuk kebutuhan di atas. Berikan penjelasan terstruktur, arsitektur terbaik, dan rekomendasi implementasi standar produksi.

**CONSTRAINTS:**
- Hindari penjelasan umum atau klise. Berikan insight teknis yang mendalam dan dapat langsung diaplikasikan.
- Sertakan aspek keamanan, efisiensi resource, dan skalabilitas.
- Jika ada dependensi eksternal, sebutkan versi dan justifikasinya.

**OUTPUT FORMAT:**
Sajikan dalam format: ${format}.`;

      craftedPromptText.textContent = simulatedCrafted;
    }
  } catch (error) {
    craftedPromptText.textContent = `Error: ${error.message}\n\nTips: Periksa apakah Gemini API Key Anda valid dan memiliki kuota aktif.`;
  } finally {
    craftBtn.disabled = false;
    craftBtn.innerHTML = '<span>🪄 Sulap Menjadi Prompt Profesional</span>';
  }
});

initKeyUI();
