// Kollektiv — Клиентское ядро экстремальной легковесности (Low-Bandwidth & Offline-First)

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
  lastSync: localStorage.getItem('kollektiv_last_sync') || null,
  cachedCompressedImage: null
};

// 1. Инициализация Service Worker и статуса сети
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(err => console.log('SW reg fail:', err));
  });
}

function updateOnlineStatus() {
  const badge = document.getElementById('networkStatus');
  if (navigator.onLine) {
    badge.className = 'network-badge online';
    badge.textContent = '🟢 Онлайн (H+)';
  } else {
    badge.className = 'network-badge offline';
    badge.textContent = '🟠 Оффлайн (Кэш)';
  }
}
window.addEventListener('online', updateOnlineStatus);
window.addEventListener('offline', updateOnlineStatus);

// 2. Клиентское сжатие фото через HTML5 Canvas (Превращает 5 МБ в ~35 КБ!)
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

        // Предпочитаем WebP, если поддерживается
        let dataUrl = canvas.toDataURL('image/webp', quality);
        if (!dataUrl.startsWith('data:image/webp')) {
          dataUrl = canvas.toDataURL('image/jpeg', quality);
        }

        const sizeKb = Math.round((dataUrl.length * 3) / 4 / 1024);
        console.log(`[Image Compressor] Фото сжато: ${img.width}x${img.height} -> ${width}x${height}, размер: ~${sizeKb} КБ`);
        resolve({ dataUrl, sizeKb });
      };
      img.onerror = reject;
    };
    reader.onerror = reject;
  });
}

// 3. Загрузка данных (Offline-First: сначала из LocalStorage, затем дельта из сети)
async function loadInitialData() {
  updateOnlineStatus();

  // Мгновенный рендер из локального кэша
  const cachedListings = localStorage.getItem('kollektiv_cached_listings');
  if (cachedListings) {
    try {
      STATE.listings = JSON.parse(cachedListings);
      renderListings();
      console.log(`[Cache] Мгновенно отображено ${STATE.listings.length} объявлений из кэша.`);
    } catch (e) {
      console.error('Ошибка чтения кэша', e);
    }
  }

  // Загружаем справочники
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
      renderCategoryPills();
    }
  } catch (err) {
    console.log('Справочники загружены из кэша SW или сеть недоступна');
  }

  // Фоновая синхронизация объявлений с сервером
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
    console.warn('Работаем в оффлайн-режиме, синхронизация отложена');
  }
}

// 4. Отрисовка карточек
function renderListings() {
  const container = document.getElementById('listingsContainer');
  const countEl = document.getElementById('resultsCount');

  let filtered = STATE.listings;

  // Клиентская фильтрация для мгновенного отклика без сети
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

  countEl.textContent = `Найдено: ${filtered.length}`;

  if (filtered.length === 0) {
    container.innerHTML = `
      <div style="grid-column: 1 / -1; text-align: center; padding: 40px 16px; background: #fff; border-radius: 12px; border: 1px dashed var(--border);">
        <p style="font-size: 1.5rem; margin-bottom: 8px;">🌾</p>
        <p style="font-weight: 600;">В этом районе пока нет таких объявлений</p>
        <p style="font-size: 0.85rem; color: var(--text-muted); margin-top: 4px;">Будьте первым — разместите свое предложение прямо сейчас!</p>
      </div>
    `;
    return;
  }

  container.innerHTML = filtered.map(item => {
    const isGoods = item.type === 'goods';
    const tagClass = isGoods ? 'tag-goods' : 'tag-services';
    const tagLabel = isGoods ? '🥚 Товар (C2C)' : '🚜 Услуга (B2C/C2C)';
    const phoneClean = item.contact_phone ? item.contact_phone.replace(/[^+\d]/g, '') : '';
    const tgClean = item.contact_telegram ? item.contact_telegram.replace('@', '').replace('t.me/', '') : '';

    return `
      <article class="card ${item.is_boosted ? 'boosted' : ''}">
        ${item.is_boosted ? '<div class="boosted-ribbon">⭐ В ТОПЕ СНТ</div>' : ''}
        
        ${item.image_url ? `
          <img class="card-img" src="${item.image_url}" alt="${item.title}" loading="lazy" />
        ` : `
          <div class="card-img" style="display:flex; align-items:center; justify-content:center; font-size:2.5rem; background:#f1f5f9;">
            ${isGoods ? '🧺' : '🛠️'}
          </div>
        `}

        <div class="card-body">
          <div class="card-meta">
            <span class="card-type-tag ${tagClass}">${tagLabel}</span>
            <span>${item.contact_name}</span>
          </div>

          <h3 class="card-title">${escapeHtml(item.title)}</h3>
          
          ${item.description ? `<p class="card-desc">${escapeHtml(item.description)}</p>` : ''}

          <div class="card-location">
            📍 <strong>${escapeHtml(item.location_name)}</strong> 
            ${item.address_detail ? `• ${escapeHtml(item.address_detail)}` : ''}
          </div>

          <div class="card-price-row">
            <span class="card-price">${item.price ? `${item.price} ₽` : 'Договорная'}</span>
            <span class="card-unit">${escapeHtml(item.price_unit || '')}</span>
          </div>

          <div class="card-actions">
            ${phoneClean ? `
              <a href="tel:${phoneClean}" class="btn btn-primary">📞 Позвонить</a>
            ` : ''}

            ${tgClean ? `
              <a href="https://t.me/${tgClean}" target="_blank" class="btn btn-secondary">✈️ Написать</a>
            ` : ''}

            <button class="btn btn-boost" onclick="openBoostModal(${item.id}, '${escapeHtml(item.title)}')">
              ⚡ В ТОП (49₽)
            </button>
          </div>
        </div>
      </article>
    `;
  }).join('');
}

// 5. Построение UI фильтров
function populateLocationsSelect() {
  const sel = document.getElementById('locationFilter');
  const postSel = document.getElementById('postLocation');
  
  const optionsHtml = '<option value="all">📍 Все локации</option>' + 
    STATE.locations.map(l => `<option value="${l.name}">${l.name}</option>`).join('');

  sel.innerHTML = optionsHtml;
  postSel.innerHTML = STATE.locations.map(l => `<option value="${l.name}">${l.name}</option>`).join('');
}

function renderCategoryPills() {
  const container = document.getElementById('categoryPills');
  const postCatSel = document.getElementById('postCategory');

  let activeCats = STATE.categories;
  if (STATE.filters.type) {
    activeCats = activeCats.filter(c => c.type === STATE.filters.type);
  }

  container.innerHTML = `
    <button class="cat-pill ${STATE.filters.category === 'all' ? 'active' : ''}" onclick="selectCategory('all')">
      Все категории
    </button>
    ${activeCats.map(c => `
      <button class="cat-pill ${STATE.filters.category === c.id ? 'active' : ''}" onclick="selectCategory('${c.id}')">
        ${c.icon} ${c.name}
      </button>
    `).join('')}
  `;

  postCatSel.innerHTML = STATE.categories.map(c => `<option value="${c.id}">${c.icon} ${c.name} (${c.type === 'goods' ? 'Товар' : 'Услуга'})</option>`).join('');
}

function selectCategory(catId) {
  STATE.filters.category = catId;
  renderCategoryPills();
  renderListings();
  syncListingsWithServer();
}

// 6. Управление типами (Все / Товары / Услуги)
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', (e) => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    e.target.classList.add('active');
    STATE.filters.type = e.target.dataset.type;
    STATE.filters.category = 'all';
    renderCategoryPills();
    renderListings();
    syncListingsWithServer();
  });
});

document.getElementById('locationFilter').addEventListener('change', (e) => {
  STATE.filters.location = e.target.value;
  renderListings();
  syncListingsWithServer();
});

let searchDebounce;
document.getElementById('searchInput').addEventListener('input', (e) => {
  clearTimeout(searchDebounce);
  searchDebounce = setTimeout(() => {
    STATE.filters.search = e.target.value.trim();
    renderListings();
    syncListingsWithServer();
  }, 250);
});

// 7. Форма создания объявления
const postModal = document.getElementById('postModal');
const postForm = document.getElementById('postForm');
const fileInput = document.getElementById('postPhoto');
const previewBox = document.getElementById('imgPreview');

document.getElementById('openPostBtn').addEventListener('click', () => {
  postModal.style.display = 'flex';
});

document.getElementById('closePostBtn').addEventListener('click', () => {
  postModal.style.display = 'none';
});

fileInput.addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;

  previewBox.innerHTML = '<span style="font-size:0.8rem; color:var(--text-muted);">Сжатие фото на устройстве...</span>';
  try {
    const { dataUrl, sizeKb } = await compressImageOnClient(file, 800, 0.75);
    STATE.cachedCompressedImage = dataUrl;
    previewBox.innerHTML = `<img src="${dataUrl}" alt="Превью" /><span style="position:absolute; bottom:4px; right:4px; background:rgba(0,0,0,0.6); color:#fff; font-size:0.7rem; padding:2px 4px; border-radius:4px;">${sizeKb} КБ</span>`;
    previewBox.style.position = 'relative';
  } catch (err) {
    previewBox.innerHTML = '<span style="color:#ef4444; font-size:0.8rem;">Ошибка сжатия</span>';
  }
});

postForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const submitBtn = postForm.querySelector('button[type="submit"]');
  submitBtn.disabled = true;
  submitBtn.textContent = 'Публикация...';

  try {
    let finalImageUrl = '';

    // 1. Загрузка легковесного сжатого фото (если выбрано)
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

    // 2. Отправка данных объявления
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
      postModal.style.display = 'none';
      postForm.reset();
      previewBox.innerHTML = '<span style="font-size:0.8rem; color:var(--text-muted);">Фото не выбрано (опционально)</span>';
      STATE.cachedCompressedImage = null;
      alert('🎉 Ваше объявление успешно опубликовано в Kollektiv!');
    } else {
      alert('Ошибка при сохранении объявления');
    }
  } catch (err) {
    alert('Сетевая ошибка при публикации. Проверьте соединение.');
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = 'Опубликовать объявление';
  }
});

// 8. Модальное окно буста (симуляция эквайринга самозанятого)
const boostModal = document.getElementById('boostModal');
let targetBoostId = null;

window.openBoostModal = function(id, title) {
  targetBoostId = id;
  document.getElementById('boostItemTitle').textContent = title;
  document.getElementById('boostReceiptBox').style.display = 'none';
  document.getElementById('boostPayBtn').style.display = 'block';
  boostModal.style.display = 'flex';
};

document.getElementById('closeBoostBtn').addEventListener('click', () => {
  boostModal.style.display = 'none';
});

document.getElementById('boostPayBtn').addEventListener('click', async () => {
  const btn = document.getElementById('boostPayBtn');
  btn.disabled = true;
  btn.textContent = 'Обработка платежа СБП...';

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
        <div style="background:#f0fdf4; border:1px solid #bbf7d0; padding:12px; border-radius:8px; font-size:0.85rem;">
          <p style="font-weight:700; color:#166534; margin-bottom:4px;">✅ Оплата 49 ₽ успешно проведена!</p>
          <p><strong>Услуга:</strong> ${data.receipt.service}</p>
          <p><strong>Исполнитель:</strong> ${data.receipt.provider}</p>
          <p><strong>Срок в ТОПе:</strong> до ${new Date(data.boosted_until).toLocaleDateString()}</p>
          <p style="font-size:0.75rem; color:#4b5563; margin-top:6px;">Электронный чек сформирован в системе «Мой налог».</p>
        </div>
      `;
      // Обновляем локальное состояние
      const item = STATE.listings.find(x => x.id === targetBoostId);
      if (item) item.is_boosted = 1;
      localStorage.setItem('kollektiv_cached_listings', JSON.stringify(STATE.listings));
      renderListings();
    }
  } catch (e) {
    alert('Сбой платежного шлюза');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Оплатить 49 ₽ через СБП';
  }
});

// Утилиты
function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Старт
loadInitialData();
