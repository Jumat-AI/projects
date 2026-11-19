// Manajemen Key BYOK di sessionStorage
const STORAGE_KEY = 'jumat_ai_user_key';

const apiKeyInput = document.getElementById('apiKeyInput');
const saveKeyBtn = document.getElementById('saveKeyBtn');
const clearKeyBtn = document.getElementById('clearKeyBtn');
const keyStatus = document.getElementById('keyStatus');

const promptInput = document.getElementById('promptInput');
const submitBtn = document.getElementById('submitBtn');
const outputResult = document.getElementById('outputResult');

function updateKeyUI() {
  const savedKey = sessionStorage.getItem(STORAGE_KEY);
  if (savedKey) {
    apiKeyInput.value = '••••••••••••••••••••••••';
    apiKeyInput.disabled = true;
    saveKeyBtn.style.display = 'none';
    clearKeyBtn.style.display = 'inline-block';
    keyStatus.innerHTML = '<span style="color:#10b981">✔ API Key tersimpan di memori browser ini.</span>';
  } else {
    apiKeyInput.value = '';
    apiKeyInput.disabled = false;
    saveKeyBtn.style.display = 'inline-block';
    clearKeyBtn.style.display = 'none';
    keyStatus.innerHTML = '<span style="color:#9ca3af">Belum ada API Key (opsional untuk demo lokal).</span>';
  }
}

saveKeyBtn.addEventListener('click', () => {
  const key = apiKeyInput.value.trim();
  if (!key) {
    alert('Silakan masukkan API Key Anda terlebih dahulu.');
    return;
  }
  sessionStorage.setItem(STORAGE_KEY, key);
  updateKeyUI();
});

clearKeyBtn.addEventListener('click', () => {
  sessionStorage.removeItem(STORAGE_KEY);
  updateKeyUI();
});

submitBtn.addEventListener('click', async () => {
  const prompt = promptInput.value.trim();
  if (!prompt) {
    alert('Masukkan prompt Anda terlebih dahulu.');
    return;
  }

  const apiKey = sessionStorage.getItem(STORAGE_KEY);
  outputResult.textContent = 'Memproses permintaan dengan AI...';
  submitBtn.disabled = true;

  try {
    if (apiKey) {
      // Contoh pemanggilan Gemini API langsung dari client-side
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }]
        })
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error?.message || 'Gagal memanggil API.');
      }

      const data = await response.json();
      const aiText = data.candidates?.[0]?.content?.parts?.[0]?.text || 'Tidak ada teks yang dihasilkan.';
      outputResult.textContent = aiText;
    } else {
      // Fallback demo simulasi jika belum memasukkan key
      await new Promise(r => setTimeout(r, 800));
      outputResult.textContent = `[MODE SIMULASI TANPA API KEY]\n\nPrompt Anda diterima: "${prompt}"\n\nUntuk mendapatkan respons nyata dari model AI, masukkan Gemini API Key Anda pada form di atas. API Key hanya tersimpan di peramban Anda.`;
    }
  } catch (err) {
    outputResult.textContent = `Terjadi kesalahan: ${err.message}`;
  } finally {
    submitBtn.disabled = false;
  }
});

// Inisialisasi saat halaman dibuka
updateKeyUI();
