// Kollektiv — Client Engine with User Statuses, Graph Recommendations & Low-Bandwidth Optimizations

const STATE = {
  listings: [],
  categories: [],
  locations: [],
  user: null,
  token: localStorage.getItem('kollektiv_auth_token') || null,
  myListings: [],
  filters: {
    type: '',
    category: 'all',
    location: 'all',
    search: ''
  },
  lastSync: localStorage.getItem('kollektiv_last_sync') || null,
  cachedCompressedImage: null,
  activeDetailItem: null,
  connectionState: 'good' // 'good' | 'unstable' | 'offline'
};

// 1. Service Worker
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js?v=6.0')
      .then(reg => {
        reg.update();
      })
      .catch(err => console.log('SW reg fail:', err));
  });
}

// 2. Мониторинг сети (Соединение есть / Прерывает / Нет сети)
function setConnectionBadge(state) {
  STATE.connectionState = state;
  const badge = document.getElementById('networkStatus');
  const text = document.getElementById('networkStatusText');

  badge.classList.remove('status-good', 'status-unstable', 'status-offline');

  if (state === 'good') {
    badge.classList.add('status-good');
    text.textContent = 'Соединение есть';
  } else if (state === 'unstable') {
    badge.classList.add('status-unstable');
    text.textContent = 'Прерывается';
  } else {
    badge.classList.add('status-offline');
    text.textContent = 'Нет сети';
  }
}

async function probeConnectionQuality() {
  if (!navigator.onLine) {
    setConnectionBadge('offline');
    return;
  }

  const startTime = performance.now();
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 2000);

  try {
    const res = await fetch('/api/health?t=' + Date.now(), { 
      signal: controller.signal,
      cache: 'no-store'
    });
    clearTimeout(timeoutId);
    const latency = performance.now() - startTime;

    if (res.ok) {
      if (latency > 700) setConnectionBadge('unstable');
      else setConnectionBadge('good');
    } else {
      setConnectionBadge('unstable');
    }
  } catch (err) {
    clearTimeout(timeoutId);
    if (!navigator.onLine) setConnectionBadge('offline');
    else setConnectionBadge('unstable');
  }
}

window.addEventListener('online', probeConnectionQuality);
window.addEventListener('offline', () => setConnectionBadge('offline'));
setInterval(probeConnectionQuality, 15000);

// 3. Управление профилем и пользователем
async function fetchUserProfile() {
  if (!STATE.token) {
    STATE.user = null;
    updateUserHeader();
    return;
  }

  try {
    const res = await fetch('/api/users/me', {
      headers: { 'Authorization': `Bearer ${STATE.token}` }
    });

    if (res.ok) {
      const data = await res.json();
      STATE.user = data.user;
      STATE.user.stats = data.stats;
      updateUserHeader();
    } else {
      // Токен невалиден
      STATE.token = null;
      STATE.user = null;
      localStorage.removeItem('kollektiv_auth_token');
      updateUserHeader();
    }
  } catch (e) {
    console.warn('Офлайн режим: используем кэш профиля');
  }
}

function updateUserHeader() {
  const icon = document.getElementById('userProfileIcon');
  const label = document.getElementById('userProfileLabel');

  if (STATE.user) {
    const statusIcon = STATE.user.status === 'verified' ? '⭐' : (STATE.user.status === 'pro' ? '🛡️' : '🟡');
    icon.textContent = statusIcon;
    label.textContent = STATE.user.display_name.split(' ')[0];
  } else {
    icon.textContent = '👤';
    label.textContent = 'Войти';
  }
}

// 4. Сжатие фото на стороне клиента (HTML5 Canvas)
async function compressImageOnClient(file, maxWidth = 800, quality = 0.75) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = (e) => {
      const img = new Image();
      img.src = e.target.result;
      img.onload = () => {
        let width = img.width;
        let height = img.height;

        if (width > maxWidth) {
          height = Math.round((height * maxWidth) / width);
          width = maxWidth;
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

        const sizeKb = Math.round((dataUrl.length * 3/4) / 1024);
        resolve({ dataUrl, sizeKb });
      };
      img.onerror = reject;
    };
    reader.onerror = reject;
  });
}

// 5. Инициализация и загрузка данных
async function loadInitialData() {
  // Полное обнуление локального хранилища клиента (чистый старт)
  if (localStorage.getItem('kollektiv_clean_v6') !== 'true') {
    localStorage.removeItem('kollektiv_cached_listings');
    localStorage.removeItem('kollektiv_auth_token');
    localStorage.removeItem('kollektiv_last_sync');
    localStorage.setItem('kollektiv_clean_v6', 'true');
    STATE.token = null;
    STATE.user = null;
    STATE.listings = [];
  }

  const cached = localStorage.getItem('kollektiv_cached_listings');
  if (cached) {
    try {
      STATE.listings = JSON.parse(cached);
      renderListings();
    } catch (e) {}
  }

  // Загружаем профиль
  await fetchUserProfile();

  try {
    const [locsRes, catsRes] = await Promise.all([
      fetch('/api/locations'),
      fetch('/api/categories')
    ]);

    if (locsRes.ok) {
      STATE.locations = await locsRes.json();
      populateLocations();
    }
    if (catsRes.ok) {
      STATE.categories = await catsRes.json();
      renderSidebarCategories();
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
      setConnectionBadge('good');
    }
  } catch (err) {
    console.warn('Сервер недоступен, работаем с оффлайн кэшем');
    if (!navigator.onLine) setConnectionBadge('offline');
    else setConnectionBadge('unstable');
  }
}

// 6. Отрисовка объявлений со статусами продавцов
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
        <p style="font-size: 2.2rem; margin-bottom: 8px;">🌾</p>
        <p class="font-slab" style="font-size: 1.2rem; font-weight: 700; margin-bottom: 6px;">Пока нет опубликованных объявлений</p>
        <p style="font-size: 0.88rem; color: var(--text-muted); margin-bottom: 16px; max-width: 440px; margin-left: auto; margin-right: auto; line-height: 1.4;">
          Каталог готов к работе. Будьте первым! Разместите продукты своего хозяйства или предложите дачные услуги соседям по СНТ.
        </p>
        <button onclick="document.getElementById('openPostBtn').click()" class="btn-contact phone" style="display: inline-flex; border-radius: var(--radius-sm); padding: 10px 24px;">
          + Опубликовать первое объявление
        </button>
      </div>
    `;
    return;
  }

  container.innerHTML = filtered.map(item => {
    const isGoods = item.type === 'goods';
    const tagClass = isGoods ? '' : 'service';
    const tagLabel = isGoods ? 'Товар' : 'Услуга';

    // Бейдж статуса продавца
    const statusPill = item.user_status === 'verified'
      ? '<span class="user-status-pill user-status-verified">⭐ Ферма ЛПХ</span>'
      : (item.user_status === 'pro'
         ? '<span class="user-status-pill user-status-pro">🛡️ Самозанятый</span>'
         : '<span class="user-status-pill user-status-basic">🟡 Сосед</span>');

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
            ${statusPill}
            <span class="card-location-tag">📍 ${escapeHtml(item.location_name)}</span>
          </div>

          <h3 class="card-title font-slab">${escapeHtml(item.title)}</h3>

          <div class="card-price-row">
            <span class="card-price font-slab">${item.price ? `${item.price} ₽` : 'Договорная'}</span>
            <span class="card-unit">${escapeHtml(item.price_unit || '')}</span>
            <span class="card-seller">${escapeHtml(item.seller_name || item.contact_name)}</span>
          </div>
        </div>
      </article>
    `;
  }).join('');
}

// 7. Карточка подробного просмотра с рекомендациями графа
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
  document.getElementById('detailSeller').textContent = item.seller_name || item.contact_name;
  document.getElementById('detailDescription').textContent = item.description || 'Описание не указано. Свяжитесь по контактам ниже.';
  
  // Статус продавца в модалке
  const sellerBadge = document.getElementById('detailSellerBadge');
  if (item.user_status === 'verified') {
    sellerBadge.textContent = '⭐ Проверенное ЛПХ / Ферма';
    sellerBadge.className = 'user-status-pill user-status-verified';
  } else if (item.user_status === 'pro') {
    sellerBadge.textContent = '🛡️ Самозанятый / ИП (ИНН проверен)';
    sellerBadge.className = 'user-status-pill user-status-pro';
  } else {
    sellerBadge.textContent = '🟡 Сосед по СНТ (Дачник)';
    sellerBadge.className = 'user-status-pill user-status-basic';
  }

  // Срок жизни объявления
  const expiresInfo = document.getElementById('detailExpiresInfo');
  if (item.expires_at) {
    const expDate = new Date(item.expires_at);
    expiresInfo.textContent = `Активно до ${expDate.toLocaleDateString('ru-RU')}`;
  } else {
    expiresInfo.textContent = '';
  }

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
  if (item.contact_phone) {
    callBtn.href = `tel:${item.contact_phone.replace(/[^\d+]/g, '')}`;
    callBtn.style.display = 'inline-flex';
  } else {
    callBtn.style.display = 'none';
  }

  const tgBtn = document.getElementById('detailTgBtn');
  const tgUser = item.contact_telegram || item.seller_telegram;
  if (tgUser) {
    const cleanTg = tgUser.replace(/^@/, '').replace('t.me/', '');
    tgBtn.href = `https://t.me/${cleanTg}`;
    tgBtn.style.display = 'inline-flex';
  } else {
    tgBtn.style.display = 'none';
  }

  document.getElementById('detailBoostBtn').onclick = () => {
    openBoostModal(item.id, item.title);
  };

  // Кнопка пожаловаться
  document.getElementById('detailReportBtn').onclick = () => {
    openReportModal(item.id, item.title);
  };

  // Подгружаем графовые рекомендации
  loadGraphRecommendations(item.id);

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

// 8. Подгрузка графовых рекомендаций
async function loadGraphRecommendations(listingId) {
  const section = document.getElementById('detailGraphSection');
  const container = document.getElementById('detailGraphRecsContainer');
  section.style.display = 'none';
  container.innerHTML = '';

  try {
    const res = await fetch(`/api/listings/${listingId}/recommendations`);
    if (!res.ok) return;

    const data = await res.json();
    if (!data.recommendations || data.recommendations.length === 0) return;

    container.innerHTML = data.recommendations.map(rec => {
      const edge = rec.graph_edge;
      return `
        <div class="graph-rec-card" onclick="openDetailModal(${rec.id})">
          <div class="graph-rec-badge">
            <span>🔗</span> ${escapeHtml(edge.label || 'Связанное')}
          </div>
          <div class="graph-rec-title font-slab">${escapeHtml(rec.title)}</div>
          <div class="graph-rec-meta">
            <span class="graph-rec-price">${rec.price ? `${rec.price} ₽` : 'Договорная'}</span>
            <span>📍 ${escapeHtml(rec.location_name)}</span>
          </div>
        </div>
      `;
    }).join('');

    section.style.display = 'block';
  } catch (err) {
    console.log('Графовые рекомендации временно недоступны');
  }
}

// 9. Боковая панель
const leftSidebar = document.getElementById('leftSidebar');
const sidebarBackdrop = document.getElementById('sidebarBackdrop');
const openSidebarBtn = document.getElementById('openSidebarBtn');
const closeSidebarBtn = document.getElementById('closeSidebarBtn');

function openSidebar() {
  leftSidebar.classList.add('open');
  sidebarBackdrop.classList.add('open');
  document.body.style.overflow = 'hidden';
}

function closeSidebar() {
  leftSidebar.classList.remove('open');
  sidebarBackdrop.classList.remove('open');
  document.body.style.overflow = '';
}

openSidebarBtn.addEventListener('click', openSidebar);
closeSidebarBtn.addEventListener('click', closeSidebar);
sidebarBackdrop.addEventListener('click', closeSidebar);
document.getElementById('mobileFilterTriggerBtn').addEventListener('click', openSidebar);

function renderSidebarCategories() {
  const list = document.getElementById('sidebarCategoryList');
  let html = `
    <li>
      <button class="sidebar-nav-item ${STATE.filters.category === 'all' ? 'active' : ''}" data-cat="all">
        <span>🌟</span> Все категории
      </button>
    </li>
  `;

  for (const cat of STATE.categories) {
    const isActive = STATE.filters.category === cat.id;
    html += `
      <li>
        <button class="sidebar-nav-item ${isActive ? 'active' : ''}" data-cat="${cat.id}">
          <span>${cat.icon}</span> ${escapeHtml(cat.name)}
        </button>
      </li>
    `;
  }

  list.innerHTML = html;

  list.querySelectorAll('.sidebar-nav-item').forEach(btn => {
    btn.addEventListener('click', () => {
      list.querySelectorAll('.sidebar-nav-item').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      STATE.filters.category = btn.getAttribute('data-cat');
      syncListingsWithServer();
      if (window.innerWidth <= 840) closeSidebar();
    });
  });
}

function populateLocations() {
  const sidebarSelect = document.getElementById('sidebarLocationSelect');
  const postSelect = document.getElementById('postLocation');

  sidebarSelect.innerHTML = '<option value="all">📍 Все СНТ и посёлки</option>';
  postSelect.innerHTML = '';

  for (const loc of STATE.locations) {
    const opt = document.createElement('option');
    opt.value = loc.name;
    opt.textContent = `📍 ${loc.name} (${loc.type})`;
    sidebarSelect.appendChild(opt);

    const postOpt = document.createElement('option');
    postOpt.value = loc.name;
    postOpt.textContent = `📍 ${loc.name}`;
    postSelect.appendChild(postOpt);
  }

  sidebarSelect.value = STATE.filters.location;
}

document.getElementById('sidebarLocationSelect').addEventListener('change', (e) => {
  STATE.filters.location = e.target.value;
  syncListingsWithServer();
});

// Поиск
let searchTimer = null;
document.getElementById('searchInput').addEventListener('input', (e) => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    STATE.filters.search = e.target.value.trim();
    syncListingsWithServer();
  }, 250);
});

// Быстрые теги (Товары / Услуги)
document.querySelectorAll('.filter-tag').forEach(tag => {
  tag.addEventListener('click', () => {
    document.querySelectorAll('.filter-tag').forEach(t => t.classList.remove('active'));
    tag.classList.add('active');
    STATE.filters.type = tag.getAttribute('data-type');
    syncListingsWithServer();
  });
});

// 10. Модальное окно профиля / Авторизация / Мои объявления
const userModal = document.getElementById('userModal');
const userProfileBtn = document.getElementById('userProfileBtn');
const closeUserBtn = document.getElementById('closeUserBtn');

userProfileBtn.addEventListener('click', () => {
  renderUserModal();
  userModal.style.display = 'flex';
  document.body.style.overflow = 'hidden';
});

function closeUser() {
  userModal.style.display = 'none';
  document.body.style.overflow = '';
}
closeUserBtn.addEventListener('click', closeUser);
userModal.addEventListener('click', (e) => {
  if (e.target === userModal) closeUser();
});

async function renderUserModal() {
  const guestBox = document.getElementById('authGuestBox');
  const profileBox = document.getElementById('authProfileBox');

  if (!STATE.user) {
    guestBox.style.display = 'block';
    profileBox.style.display = 'none';
    return;
  }

  guestBox.style.display = 'none';
  profileBox.style.display = 'block';

  document.getElementById('profileName').textContent = STATE.user.display_name;
  document.getElementById('profileContact').textContent = STATE.user.phone ? `Тел: +${STATE.user.phone}` : (STATE.user.telegram_username ? `@${STATE.user.telegram_username}` : '');

  const badge = document.getElementById('profileStatusBadge');
  if (STATE.user.status === 'verified') {
    badge.textContent = '⭐ Цельный (ЛПХ)';
    badge.className = 'user-status-pill user-status-verified';
  } else if (STATE.user.status === 'pro') {
    badge.textContent = '🛡️ Продвинутый (Самозанятый)';
    badge.className = 'user-status-pill user-status-pro';
  } else {
    badge.textContent = '🟡 Обычный (Дачник)';
    badge.className = 'user-status-pill user-status-basic';
  }

  const statusSelect = document.getElementById('profileStatusSelect');
  statusSelect.value = STATE.user.status;

  const innField = document.getElementById('profileInnField');
  const innInput = document.getElementById('profileInnInput');
  innField.style.display = (STATE.user.status === 'pro') ? 'block' : 'none';
  innInput.value = STATE.user.inn || '';

  statusSelect.onchange = () => {
    innField.style.display = (statusSelect.value === 'pro') ? 'block' : 'none';
  };

  // Загружаем мои объявления
  loadMyListings();
}

async function loadMyListings() {
  const container = document.getElementById('myListingsContainer');
  const countEl = document.getElementById('myListingsCount');
  container.innerHTML = '<div style="font-size:0.8rem; color:var(--text-muted);">Загрузка...</div>';

  try {
    const res = await fetch('/api/users/me/listings', {
      headers: { 'Authorization': `Bearer ${STATE.token}` }
    });

    if (res.ok) {
      const data = await res.json();
      STATE.myListings = data.items;
      countEl.textContent = `Всего: ${data.count}`;

      if (data.items.length === 0) {
        container.innerHTML = '<div style="font-size:0.8rem; color:var(--text-muted); padding:8px 0;">У вас пока нет объявлений.</div>';
        return;
      }

      container.innerHTML = data.items.map(it => {
        const isSold = it.status === 'sold';
        return `
          <div class="my-listing-item" style="${isSold ? 'opacity: 0.65;' : ''}">
            <div class="my-listing-header">
              <span>${escapeHtml(it.title)}</span>
              <span style="font-size: 0.72rem; color: ${isSold ? '#ef4444' : '#16a34a'}; font-weight:700;">
                ${isSold ? '● Продано' : '● Активно'}
              </span>
            </div>
            <div style="font-size: 0.75rem; color: var(--text-muted);">
              ${it.price ? `${it.price} ₽` : 'Договорная'} • ${it.location_name}
            </div>
            <div class="my-listing-actions">
              <button class="btn-action-sm" onclick="toggleListingSold(${it.id}, '${isSold ? 'active' : 'sold'}')">
                ${isSold ? '🔄 Возобновить' : '✅ Продано'}
              </button>
              <button class="btn-action-sm" onclick="renewListing(${it.id})">
                🔄 Продлить
              </button>
              <button class="btn-action-sm" onclick="openBoostModal(${it.id}, '${escapeHtml(it.title)}')">
                ⚡ В ТОП (49 ₽)
              </button>
            </div>
          </div>
        `;
      }).join('');
    }
  } catch (e) {
    container.innerHTML = '<div style="font-size:0.8rem; color:#ef4444;">Ошибка загрузки объявлений.</div>';
  }
}

window.toggleListingSold = async function(id, newStatus) {
  try {
    const res = await fetch(`/api/listings/${id}/status`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${STATE.token}`
      },
      body: JSON.stringify({ status: newStatus })
    });

    if (res.ok) {
      loadMyListings();
      syncListingsWithServer();
    }
  } catch (e) {
    alert('Сбой сети');
  }
};

window.renewListing = async function(id) {
  try {
    const res = await fetch(`/api/listings/${id}/status`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${STATE.token}`
      },
      body: JSON.stringify({ action: 'renew' })
    });

    if (res.ok) {
      const data = await res.json();
      alert(data.message);
      loadMyListings();
      syncListingsWithServer();
    }
  } catch (e) {
    alert('Сбой сети');
  }
};

// Вход через форму
document.getElementById('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = document.getElementById('loginName').value.trim();
  const contact = document.getElementById('loginContact').value.trim();

  const isTg = contact.startsWith('@');
  const payload = {
    display_name: name,
    phone: isTg ? '' : contact,
    telegram_username: isTg ? contact : ''
  };

  try {
    const res = await fetch('/api/users/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (res.ok) {
      const data = await res.json();
      STATE.token = data.token;
      STATE.user = data.user;
      localStorage.setItem('kollektiv_auth_token', data.token);
      updateUserHeader();
      renderUserModal();
      syncListingsWithServer();
    }
  } catch (e) {
    alert('Сетевая ошибка при входе');
  }
});

// Сохранение статуса профиля
document.getElementById('saveStatusBtn').addEventListener('click', async () => {
  const newStatus = document.getElementById('profileStatusSelect').value;
  const inn = document.getElementById('profileInnInput').value.trim();

  try {
    const res = await fetch('/api/users/me', {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${STATE.token}`
      },
      body: JSON.stringify({ status: newStatus, inn })
    });

    if (res.ok) {
      const data = await res.json();
      STATE.user = data.user;
      alert('Статус аккаунта успешно обновлен!');
      renderUserModal();
      updateUserHeader();
      syncListingsWithServer();
    }
  } catch (e) {
    alert('Сбой сохранения статуса');
  }
});

// Выход
document.getElementById('logoutBtn').addEventListener('click', () => {
  STATE.token = null;
  STATE.user = null;
  localStorage.removeItem('kollektiv_auth_token');
  updateUserHeader();
  renderUserModal();
  syncListingsWithServer();
});

// 11. Модальное окно подачи жалобы (Модерация контента)
const reportModal = document.getElementById('reportModal');
const closeReportBtn = document.getElementById('closeReportBtn');
let targetReportListingId = null;

window.openReportModal = function(listingId, title) {
  targetReportListingId = listingId;
  reportModal.style.display = 'flex';
  document.body.style.overflow = 'hidden';
};

function closeReport() {
  reportModal.style.display = 'none';
  document.body.style.overflow = '';
}
closeReportBtn.addEventListener('click', closeReport);
reportModal.addEventListener('click', (e) => {
  if (e.target === reportModal) closeReport();
});

document.getElementById('reportForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const reason = document.getElementById('reportReason').value;
  const comment = document.getElementById('reportComment').value.trim();
  const reporter = STATE.user ? STATE.user.display_name : 'Анонимный сосед';

  try {
    const res = await fetch('/api/reports', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        listing_id: targetReportListingId,
        reason: `${reason}${comment ? ': ' + comment : ''}`,
        reporter_info: reporter
      })
    });

    if (res.ok) {
      const data = await res.json();
      alert(data.message);
      closeReport();
      document.getElementById('reportForm').reset();
    }
  } catch (e) {
    alert('Сбой отправки жалобы');
  }
});

// 12. Создание объявления
const postModal = document.getElementById('postModal');
const postForm = document.getElementById('postForm');
const fileInput = document.getElementById('postPhoto');
const previewBox = document.getElementById('imgPreview');

document.getElementById('openPostBtn').addEventListener('click', () => {
  updatePostStatusNotice();
  populatePostCategories();
  postModal.style.display = 'flex';
  document.body.style.overflow = 'hidden';
});

function updatePostStatusNotice() {
  const notice = document.getElementById('postStatusNotice');
  if (STATE.user) {
    const st = STATE.user.status;
    const limit = st === 'verified' ? 'Безлимитно' : (st === 'pro' ? 'до 10' : 'до 2');
    const ttl = st === 'verified' ? '60 дней' : (st === 'pro' ? '30 дней' : '5 дней');
    const badge = st === 'verified' ? '⭐ Цельный (ЛПХ)' : (st === 'pro' ? '🛡️ Самозанятый / ИП' : '🟡 Обычный (Дачник)');

    notice.innerHTML = `
      Вы публикуете как <strong>${escapeHtml(STATE.user.display_name)}</strong> [${badge}].<br>
      Лимит объявлений: <strong>${limit}</strong>. Срок показа: <strong>${ttl}</strong>.
    `;
    document.getElementById('postName').value = STATE.user.display_name;
    if (STATE.user.phone) document.getElementById('postPhone').value = '+' + STATE.user.phone;
    if (STATE.user.telegram_username) document.getElementById('postTelegram').value = '@' + STATE.user.telegram_username;
  } else {
    notice.innerHTML = `
      Вы публикуете как <strong>Гость</strong> (статус «Обычный», лимит 2 объявления, 5 дней). 
      <a href="#" onclick="closePost(); userProfileBtn.click();" style="color:var(--red); font-weight:700;">Войдите в профиль</a> для расширения лимитов.
    `;
  }
}

function populatePostCategories() {
  const catSelect = document.getElementById('postCategory');
  const type = document.getElementById('postType').value;
  catSelect.innerHTML = '';

  const filtered = STATE.categories.filter(c => c.type === type);
  for (const c of filtered) {
    const opt = document.createElement('option');
    opt.value = c.id;
    opt.textContent = `${c.icon} ${c.name}`;
    catSelect.appendChild(opt);
  }
}
document.getElementById('postType').addEventListener('change', populatePostCategories);

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

  previewBox.innerHTML = '<span style="color:var(--red);">Сжатие фото прямо в браузере...</span>';
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
      image_url: finalImageUrl,
      token: STATE.token
    };

    const headers = { 'Content-Type': 'application/json' };
    if (STATE.token) headers['Authorization'] = `Bearer ${STATE.token}`;

    const res = await fetch('/api/listings', {
      method: 'POST',
      headers,
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
      const errData = await res.json();
      alert(errData.error || 'Ошибка при сохранении объявления');
    }
  } catch (err) {
    alert('Сетевой сбой. Пожалуйста, повторите.');
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = 'Опубликовать бесплатно';
  }
});

// 13. Boost Modal (Платный буст)
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
    const headers = { 'Content-Type': 'application/json' };
    if (STATE.token) headers['Authorization'] = `Bearer ${STATE.token}`;

    const res = await fetch(`/api/listings/${targetBoostId}/boost`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ days: 7 })
    });

    if (res.ok) {
      const data = await res.json();
      btn.style.display = 'none';
      const receiptBox = document.getElementById('boostReceiptBox');
      receiptBox.style.display = 'block';
      receiptBox.innerHTML = `
        <div style="background:#fef2f2; border:1px solid #fee2e2; padding:14px; border-radius:8px; font-size:0.85rem;">
          <p class="font-slab" style="font-weight:700; color:var(--red); font-size:1rem; margin-bottom:4px;">★ Оплата 49 ₽ проведена успешно</p>
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
    } else {
      const err = await res.json();
      alert(err.error || 'Сбой платежа');
    }
  } catch (e) {
    alert('Сбой платежа');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Оплатить 49 ₽ через СБП';
  }
});

// Escape key
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    closeDetail();
    closeSidebar();
    closePost();
    closeBoost();
    closeUser();
    closeReport();
  }
});

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Start
loadInitialData();
