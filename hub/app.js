let allProjects = [];
let currentFilter = 'all';
let currentSearch = '';

const projectGrid = document.getElementById('projectGrid');
const emptyState = document.getElementById('emptyState');
const projectCount = document.getElementById('projectCount');
const searchInput = document.getElementById('searchInput');
const filterChips = document.getElementById('filterChips');

async function loadProjects() {
  try {
    const res = await fetch('projects.json');
    if (!res.ok) throw new Error('Gagal memuat katalog');
    allProjects = await res.json();
    render();
  } catch (err) {
    console.error(err);
    projectCount.textContent = 'Gagal memuat daftar proyek.';
  }
}

function getAiTypeBadgeClass(type) {
  switch (type) {
    case 'byok': return 'badge-byok';
    case 'client-side': return 'badge-client-side';
    case 'utility': return 'badge-utility';
    case 'external-backend': return 'badge-external-backend';
    default: return 'badge-utility';
  }
}

function getAiTypeLabel(type) {
  switch (type) {
    case 'byok': return 'BYOK';
    case 'client-side': return 'Client-Side AI';
    case 'utility': return 'Utility Tool';
    case 'external-backend': return 'External Backend';
    default: return type;
  }
}

function render() {
  const filtered = allProjects.filter(item => {
    const matchFilter = currentFilter === 'all' || item.ai_type === currentFilter;
    const query = currentSearch.toLowerCase();
    const matchSearch = !query ||
      item.title.toLowerCase().includes(query) ||
      item.description.toLowerCase().includes(query) ||
      item.author.name.toLowerCase().includes(query) ||
      (Array.isArray(item.tags) && item.tags.some(t => t.toLowerCase().includes(query)));

    return matchFilter && matchSearch;
  });

  projectCount.textContent = `Menampilkan ${filtered.length} dari ${allProjects.length} proyek komunitas`;

  if (filtered.length === 0) {
    projectGrid.innerHTML = '';
    emptyState.style.display = 'block';
    return;
  }

  emptyState.style.display = 'none';
  projectGrid.innerHTML = filtered.map(item => {
    const tagsHtml = (item.tags || []).map(tag => `<span class="tag-badge">#${tag}</span>`).join('');
    const avatarUrl = item.author.avatar || `https://github.com/${item.author.github}.png`;

    return `
      <article class="project-card">
        <div class="card-top">
          <div class="card-header-row">
            <span class="badge-ai-type ${getAiTypeBadgeClass(item.ai_type)}">
              ${getAiTypeLabel(item.ai_type)}
            </span>
            <small style="color:#6b7280; font-size:0.75rem;">v${item.version || '1.0'}</small>
          </div>
          <h3 class="card-title">${item.title}</h3>
          <p class="card-desc">${item.description}</p>
          <div class="tags-row">${tagsHtml}</div>
        </div>

        <div class="card-footer">
          <div class="author-info">
            <img src="${avatarUrl}" alt="${item.author.name}" class="author-avatar" onerror="this.src='https://github.com/identicons/default.png'">
            <span class="author-name">${item.author.name}</span>
          </div>
          <a href="/${item.slug}/" class="btn-open">
            Buka Project →
          </a>
        </div>
      </article>
    `;
  }).join('');
}

// Event Listeners
searchInput.addEventListener('input', (e) => {
  currentSearch = e.target.value.trim();
  render();
});

filterChips.addEventListener('click', (e) => {
  const btn = e.target.closest('.chip');
  if (!btn) return;

  filterChips.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
  btn.classList.add('active');

  currentFilter = btn.dataset.filter;
  render();
});

// Load catalog on page load
loadProjects();
