// Kollektiv — Minimalist Soft-Red Client with Slide-up Drawer & Offline-First Engine

const STATE = {
  listings: [],
  categories: [],
  locations: [],
  filters: {
    type: '',
    category: 'all',
    location: 'all',
    search: ''
  },
  tempDrawerFilters: {
    category: 'all',
    location: 'all'
  },
  lastSync: localStorage.getItem('kollektiv_last_sync') || null,
  cachedCompressedImage: null,
  activeDetailItem: null
};

// 1. Service Worker & Network Status
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(err => console.log('SW reg fail:', err));
  });
}

function updateOnlineStatus() {
  const badge = document.getElementById('networkStatus');
  if (navigator.onLine) {
    badge.innerHTML = '<span class="dot-indicator"></span><span>H+ Онлайн</span>';
  } else {
    badge.innerHTML = '<span class="dot-indicator" style="background:#f97316"></span><span>Оффлайн кэш</span>';
  }
}
window.addEventListener('online', updateOnlineStatus);
window.addEventListener('offline', updateOnlineStatus);

// 2. Client-side Image Compression (HTML5 Canvas)
async function compressImageOnClient(file, maxDim = 800, quality = 0.75) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = (event) => {
      const img = new Image();
      img.src = event.target.result;
      img.onload = () => {
        let width = img.width;
        let height = img.height;

        if (width > height && width > maxDim) {
          height = Math.round((height * maxDim) / width);
          width = maxDim;
        } else if (height > maxDim) {
          width = Math.round((width * maxDim) / height);
          height = maxDim;
        }

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);

        let dataUrl = canvas.toDataURL('image/webp', quality);
        if (!dataUrl.startsWith('data:image/webp')) {
          dataUrl = canvas.toDataURL('image/jpeg', quality);
        }

        const sizeKb = Math.round((dataUrl.length * 3) / 4 / 1024);
        resolve({ dataUrl, sizeKb });
      };
      img.onerror = reject;
    };
    reader.onerror = reject;
  });
}

// 3. Load & Synchronize Data
async function loadInitialData() {
  updateOnlineStatus();

  // Instant render from local cache
  const cachedListings = localStorage.getItem('kollektiv_cached_listings');
  if (cachedListings) {
    try {
      STATE.listings = JSON.parse(cachedListings);
      renderListings();
    } catch (e) {
      console.error('Ошибка чтения кэша', e);
    }
  }

  // Fetch справочники
  try {
    const [locsRes, catsRes] = await Promise.all([
      fetch('/api/locations'),
      fetch('/api/categories')
    ]);

    if (locsRes.ok) {
      STATE.locations = await locsRes.json();
      populateLocationsSelect();
    }
    if (catsRes.ok) {
      STATE.categories = await catsRes.json();
      renderDrawerCategories();
    }
  } catch (err) {
    console.log('Справочники загружены из кэша');
  }

  syncListingsWithServer();
}

async function syncListingsWithServer() {
  try {
    const params = new URLSearchParams();
    if (STATE.filters.type) params.set('type', STATE.filters.type);
    if (STATE.filters.category && STATE.filters.category !== 'all') params.set('category', STATE.filters.category);
    if (STATE.filters.location && STATE.filters.location !== 'all') params.set('location', STATE.filters.location);
    if (STATE.filters.search) params.set('search', STATE.filters.search);

    const res = await fetch(`/api/listings?${params.toString()}`);
    if (res.ok) {
      const data = await res.json();
      STATE.listings = data.items;
      STATE.lastSync = data.meta.server_time;
      localStorage.setItem('kollektiv_cached_listings', JSON.stringify(STATE.listings));
      localStorage.setItem('kollektiv_last_sync', STATE.lastSync);
      renderListings();
    }
  } catch (err) {
    console.warn('Оффлайн-режим активен');
  }
}

// 4. Render Grid of Cards (Clickable)
function renderListings() {
  const container = document.getElementById('listingsContainer');
  const countEl = document.getElementById('resultsCount');

  let filtered = STATE.listings;

  if (STATE.filters.type) {
    filtered = filtered.filter(it => it.type === STATE.filters.type);
  }
  if (STATE.filters.category && STATE.filters.category !== 'all') {
    filtered = filtered.filter(it => it.category_id === STATE.filters.category);
  }
  if (STATE.filters.location && STATE.filters.location !== 'all') {
    filtered = filtered.filter(it => it.location_name === STATE.filters.location);
  }
  if (STATE.filters.search) {
    const q = STATE.filters.search.toLowerCase();
    filtered = filtered.filter(it => 
      it.title.toLowerCase().includes(q) || 
      (it.description && it.description.toLowerCase().includes(q)) ||
      it.location_name.toLowerCase().includes(q)
    );
  }

  countEl.textContent = `Объявлений: ${filtered.length}`;

  if (filtered.length === 0) {
    container.innerHTML = `
      <div style="grid-column: 1 / -1; text-align: center; padding: 48px 20px; background: #fff; border-radius: 14px; border: 1px dashed var(--border);">
        <p style="font-size: 2rem; margin-bottom: 8px;">🌾</p>
        <p class="font-slab" style="font-size: 1.15rem; font-weight: 700;">В этой категории пока пусто</p>
        <p style="font-size: 0.85rem; color: var(--text-muted); margin-top: 4px;">Разместите первое объявление для соседей!</p>
      </div>
    `;
    return;
  }

  container.innerHTML = filtered.map(item => {
    const isGoods = item.type === 'goods';
    const tagClass = isGoods ? '' : 'service';
    const tagLabel = isGoods ? 'Товар' : 'Услуга';

    return `
      <article class="card ${item.is_boosted ? 'boosted' : ''}" onclick="openDetailModal(${item.id})">
        ${item.is_boosted ? '<div class="card-top-tag">★ ТОП</div>' : ''}
        
        <div class="card-media">
          ${item.image_url ? `
            <img src="${item.image_url}" alt="${escapeHtml(item.title)}" loading="lazy" />
          ` : `
            <div class="card-media-placeholder">
              ${isGoods ? '🧺' : '🛠️'}
            </div>
          `}
        </div>

        <div class="card-content">
          <div class="card-type-row">
            <span class="type-pill ${tagClass}">${tagLabel}</span>
            <span class="card-location-tag">📍 ${escapeHtml(item.location_name)}</span>
          </div>

          <h3 class="card-title font-slab">${escapeHtml(item.title)}</h3>

          <div class="card-price-row">
            <span class="card-price font-slab">${item.price ? `${item.price} ₽` : 'Договорная'}</span>
            <span class="card-unit">${escapeHtml(item.price_unit || '')}</span>
            <span class="card-seller">${escapeHtml(item.contact_name)}</span>
          </div>
        </div>
      </article>
    `;
  }).join('');
}

// 5. Detail Modal View (Просмотр карточки при клике)
const detailModal = document.getElementById('detailModal');
const closeDetailBtn = document.getElementById('closeDetailBtn');

window.openDetailModal = function(id) {
  const item = STATE.listings.find(x => x.id === id);
  if (!item) return;

  STATE.activeDetailItem = item;

  document.getElementById('detailTitle').textContent = item.title;
  document.getElementById('detailPrice').textContent = item.price ? `${item.price} ₽` : 'Цена договорная';
  document.getElementById('detailUnit').textContent = item.price_unit ? `(${item.price_unit})` : '';
  document.getElementById('detailLocation').textContent = item.location_name;
  document.getElementById('detailAddress').textContent = item.address_detail ? ` • ${item.address_detail}` : '';
  document.getElementById('detailSeller').textContent = item.contact_name;
  document.getElementById('detailDescription').textContent = item.description || 'Описание не указано. Свяжитесь с продавцом для уточнения деталей.';
  
  const typeBadge = document.getElementById('detailTypeBadge');
  const isGoods = item.type === 'goods';
  typeBadge.textContent = isGoods ? '🌾 Продукт хозяйства (C2C)' : '🚜 Услуга мастера (B2C/C2C)';
  typeBadge.className = isGoods ? 'detail-type-badge' : 'detail-type-badge service';

  const mediaWrap = document.getElementById('detailMediaWrap');
  if (item.image_url) {
    mediaWrap.innerHTML = `<img src="${item.image_url}" alt="${escapeHtml(item.title)}" class="detail-hero-media" />`;
  } else {
    mediaWrap.innerHTML = `
      <div style="height: 140px; display: flex; align-items: center; justify-content: center; background: #eceae3; font-size: 3rem;">
        ${isGoods ? '🧺' : '🛠️'}
      </div>
    `;
  }

  const callBtn = document.getElementById('detailCallBtn');
  const tgBtn = document.getElementById('detailTgBtn');

  if (item.contact_phone) {
    const cleanPhone = item.contact_phone.replace(/[^+\d]/g, '');
    callBtn.href = `tel:${cleanPhone}`;
    callBtn.style.display = 'flex';
  } else {
    callBtn.style.display = 'none';
  }

  if (item.contact_telegram) {
    const cleanTg = item.contact_telegram.replace('@', '').replace('t.me/', '');
    tgBtn.href = `https://t.me/${cleanTg}`;
    tgBtn.style.display = 'flex';
  } else {
    tgBtn.style.display = 'none';
  }

  const boostBtn = document.getElementById('detailBoostBtn');
  boostBtn.onclick = () => {
    detailModal.style.display = 'none';
    openBoostModal(item.id, item.title);
  };

  detailModal.style.display = 'flex';
  document.body.style.overflow = 'hidden';
};

function closeDetail() {
  detailModal.style.display = 'none';
  document.body.style.overflow = '';
}
closeDetailBtn.addEventListener('click', closeDetail);
detailModal.addEventListener('click', (e) => {
  if (e.target === detailModal) closeDetail();
});

// 6. Шторка категорий и фильтров (Filter Drawer)
const filterDrawer = document.getElementById('filterDrawer');
const openDrawerBtn = document.getElementById('openDrawerBtn');
const closeDrawerBtn = document.getElementById('closeDrawerBtn');
const applyDrawerBtn = document.getElementById('applyDrawerBtn');
const resetDrawerBtn = document.getElementById('resetDrawerBtn');
const drawerLocSelect = document.getElementById('drawerLocationSelect');
const drawerCatsContainer = document.getElementById('drawerCategoriesContainer');

function openDrawer() {
  STATE.tempDrawerFilters.category = STATE.filters.category;
  STATE.tempDrawerFilters.location = STATE.filters.location;
  drawerLocSelect.value = STATE.filters.location;
  renderDrawerCategories();
  filterDrawer.style.display = 'flex';
  document.body.style.overflow = 'hidden';
}

function closeDrawer() {
  filterDrawer.style.display = 'none';
  document.body.style.overflow = '';
}

openDrawerBtn.addEventListener('click', openDrawer);
closeDrawerBtn.addEventListener('click', closeDrawer);
filterDrawer.addEventListener('click', (e) => {
  if (e.target === filterDrawer) closeDrawer();
});

function renderDrawerCategories() {
  let activeCats = STATE.categories;
  if (STATE.filters.type) {
    activeCats = activeCats.filter(c => c.type === STATE.filters.type);
  }

  drawerCatsContainer.innerHTML = `
    <button class="chip-btn ${STATE.tempDrawerFilters.category === 'all' ? 'active' : ''}" onclick="selectTempCategory('all')">
      Все категории
    </button>
    ${activeCats.map(c => `
      <button class="chip-btn ${STATE.tempDrawerFilters.category === c.id ? 'active' : ''}" onclick="selectTempCategory('${c.id}')">
        ${c.icon} ${c.name}
      </button>
    `).join('')}
  `;
}

window.selectTempCategory = function(catId) {
  STATE.tempDrawerFilters.category = catId;
  renderDrawerCategories();
};

drawerLocSelect.addEventListener('change', (e) => {
  STATE.tempDrawerFilters.location = e.target.value;
});

applyDrawerBtn.addEventListener('click', () => {
  STATE.filters.category = STATE.tempDrawerFilters.category;
  STATE.filters.location = STATE.tempDrawerFilters.location;
  updateFilterBadges();
  renderListings();
  syncListingsWithServer();
  closeDrawer();
});

resetDrawerBtn.addEventListener('click', () => {
  STATE.tempDrawerFilters.category = 'all';
  STATE.tempDrawerFilters.location = 'all';
  drawerLocSelect.value = 'all';
  renderDrawerCategories();
  STATE.filters.category = 'all';
  STATE.filters.location = 'all';
  updateFilterBadges();
  renderListings();
  syncListingsWithServer();
  closeDrawer();
});

function updateFilterBadges() {
  const locLabel = document.getElementById('currentLocationLabel');
  const catLabel = document.getElementById('currentCategoryLabel');
  const badge = document.getElementById('activeFilterBadge');

  locLabel.textContent = STATE.filters.location === 'all' ? 'Все СНТ' : STATE.filters.location;

  if (STATE.filters.category === 'all') {
    catLabel.textContent = 'Все';
  } else {
    const cat = STATE.categories.find(c => c.id === STATE.filters.category);
    catLabel.textContent = cat ? `${cat.icon} ${cat.name}` : STATE.filters.category;
  }

  let activeCount = 0;
  if (STATE.filters.location !== 'all') activeCount++;
  if (STATE.filters.category !== 'all') activeCount++;

  if (activeCount > 0) {
    badge.textContent = activeCount;
    badge.style.display = 'inline-block';
  } else {
    badge.style.display = 'none';
  }
}

function populateLocationsSelect() {
  const postSel = document.getElementById('postLocation');
  const postCatSel = document.getElementById('postCategory');

  drawerLocSelect.innerHTML = '<option value="all">📍 Все локации и СНТ</option>' + 
    STATE.locations.map(l => `<option value="${l.name}">${l.name}</option>`).join('');

  postSel.innerHTML = STATE.locations.map(l => `<option value="${l.name}">${l.name}</option>`).join('');
  postCatSel.innerHTML = STATE.categories.map(c => `<option value="${c.id}">${c.icon} ${c.name} (${c.type === 'goods' ? 'Товар' : 'Услуга'})</option>`).join('');
}

// Quick Type Segmented Pills
document.querySelectorAll('.segment-item').forEach(btn => {
  btn.addEventListener('click', (e) => {
    document.querySelectorAll('.segment-item').forEach(b => b.classList.remove('active'));
    e.target.classList.add('active');
    STATE.filters.type = e.target.dataset.type;
    STATE.filters.category = 'all';
    STATE.tempDrawerFilters.category = 'all';
    updateFilterBadges();
    renderDrawerCategories();
    renderListings();
    syncListingsWithServer();
  });
});

let searchDebounce;
document.getElementById('searchInput').addEventListener('input', (e) => {
  clearTimeout(searchDebounce);
  searchDebounce = setTimeout(() => {
    STATE.filters.search = e.target.value.trim();
    renderListings();
    syncListingsWithServer();
  }, 220);
});

// 7. Post Modal
const postModal = document.getElementById('postModal');
const postForm = document.getElementById('postForm');
const fileInput = document.getElementById('postPhoto');
const previewBox = document.getElementById('imgPreview');

document.getElementById('openPostBtn').addEventListener('click', () => {
  postModal.style.display = 'flex';
  document.body.style.overflow = 'hidden';
});

function closePost() {
  postModal.style.display = 'none';
  document.body.style.overflow = '';
}
document.getElementById('closePostBtn').addEventListener('click', closePost);
postModal.addEventListener('click', (e) => {
  if (e.target === postModal) closePost();
});

fileInput.addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;

  previewBox.innerHTML = '<span style="color:var(--header-red);">Сжатие фото прямо в браузере...</span>';
  try {
    const { dataUrl, sizeKb } = await compressImageOnClient(file, 800, 0.75);
    STATE.cachedCompressedImage = dataUrl;
    previewBox.innerHTML = `
      <div style="margin-top:6px; display:flex; align-items:center; gap:8px;">
        <img src="${dataUrl}" style="width:60px; height:60px; object-fit:cover; border-radius:6px; border:1px solid var(--border);" />
        <span style="font-size:0.75rem; color:#16a34a; font-weight:600;">✓ Сжато до ${sizeKb} КБ (Готово к H+)</span>
      </div>
    `;
  } catch (err) {
    previewBox.innerHTML = '<span style="color:#ef4444;">Ошибка сжатия</span>';
  }
});

postForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const submitBtn = postForm.querySelector('button[type="submit"]');
  submitBtn.disabled = true;
  submitBtn.textContent = 'Публикация...';

  try {
    let finalImageUrl = '';

    if (STATE.cachedCompressedImage) {
      const upRes = await fetch('/api/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dataUrl: STATE.cachedCompressedImage })
      });
      if (upRes.ok) {
        const upData = await upRes.json();
        finalImageUrl = upData.url;
      }
    }

    const payload = {
      title: document.getElementById('postTitle').value.trim(),
      type: document.getElementById('postType').value,
      category_id: document.getElementById('postCategory').value,
      price: Number(document.getElementById('postPrice').value) || 0,
      price_unit: document.getElementById('postUnit').value.trim(),
      location_name: document.getElementById('postLocation').value,
      address_detail: document.getElementById('postAddress').value.trim(),
      description: document.getElementById('postDescription').value.trim(),
      contact_name: document.getElementById('postName').value.trim(),
      contact_phone: document.getElementById('postPhone').value.trim(),
      contact_telegram: document.getElementById('postTelegram').value.trim(),
      image_url: finalImageUrl
    };

    const res = await fetch('/api/listings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (res.ok) {
      const created = await res.json();
      STATE.listings.unshift(created);
      localStorage.setItem('kollektiv_cached_listings', JSON.stringify(STATE.listings));
      renderListings();
      closePost();
      postForm.reset();
      previewBox.innerHTML = 'Фото не выбрано (опционально)';
      STATE.cachedCompressedImage = null;
      openDetailModal(created.id);
    } else {
      alert('Ошибка при сохранении объявления');
    }
  } catch (err) {
    alert('Сетевой сбой. Пожалуйста, повторите.');
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = 'Опубликовать бесплатно';
  }
});

// 8. Boost Modal
const boostModal = document.getElementById('boostModal');
let targetBoostId = null;

window.openBoostModal = function(id, title) {
  targetBoostId = id;
  document.getElementById('boostItemTitle').textContent = title;
  document.getElementById('boostReceiptBox').style.display = 'none';
  document.getElementById('boostPayBtn').style.display = 'block';
  boostModal.style.display = 'flex';
  document.body.style.overflow = 'hidden';
};

function closeBoost() {
  boostModal.style.display = 'none';
  document.body.style.overflow = '';
}
document.getElementById('closeBoostBtn').addEventListener('click', closeBoost);
boostModal.addEventListener('click', (e) => {
  if (e.target === boostModal) closeBoost();
});

document.getElementById('boostPayBtn').addEventListener('click', async () => {
  const btn = document.getElementById('boostPayBtn');
  btn.disabled = true;
  btn.textContent = 'Связь с банком (СБП)...';

  try {
    const res = await fetch(`/api/listings/${targetBoostId}/boost`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ days: 7 })
    });

    if (res.ok) {
      const data = await res.json();
      btn.style.display = 'none';
      const receiptBox = document.getElementById('boostReceiptBox');
      receiptBox.style.display = 'block';
      receiptBox.innerHTML = `
        <div style="background:#fef2f2; border:1px solid #fee2e2; padding:14px; border-radius:8px; font-size:0.85rem;">
          <p class="font-slab" style="font-weight:700; color:var(--header-red); font-size:1rem; margin-bottom:4px;">★ Оплата 49 ₽ проведена успешно</p>
          <p><strong>Услуга:</strong> ${data.receipt.service}</p>
          <p><strong>Исполнитель:</strong> ${data.receipt.provider}</p>
          <p><strong>Закрепление в ТОПе:</strong> до ${new Date(data.boosted_until).toLocaleDateString()}</p>
          <p style="font-size:0.75rem; color:#78716c; margin-top:8px;">Электронный чек сформирован в системе «Мой налог» (422-ФЗ).</p>
        </div>
      `;
      const item = STATE.listings.find(x => x.id === targetBoostId);
      if (item) item.is_boosted = 1;
      localStorage.setItem('kollektiv_cached_listings', JSON.stringify(STATE.listings));
      renderListings();
    }
  } catch (e) {
    alert('Сбой платежа');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Оплатить 49 ₽ через СБП';
  }
});

// Escape key closes modals
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    closeDetail();
    closeDrawer();
    closePost();
    closeBoost();
  }
});

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Start
loadInitialData();
