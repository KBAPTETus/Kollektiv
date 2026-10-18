import { Router } from 'express';
import { db } from '../db.js';
import { getUserByToken } from './users.js';

export const listingsRouter = Router();

// GET /api/listings (с поддержкой фильтров, статусов пользователей и дельта-синхронизации)
listingsRouter.get('/', (req, res) => {
  const { type, category, location, search, since, user_id, status } = req.query;

  let query = `
    SELECT 
      l.*,
      COALESCE(u.display_name, l.contact_name) AS seller_name,
      COALESCE(u.status, 'basic') AS user_status,
      COALESCE(u.is_verified, 0) AS user_verified,
      u.inn AS user_inn
    FROM listings l
    LEFT JOIN users u ON l.user_id = u.id
    WHERE 1=1
  `;
  const params = [];

  // Фильтр по активным/продано
  if (status) {
    query += ' AND l.status = ?';
    params.push(status);
  } else if (!user_id) {
    // По умолчанию в ленте показываем только активные и не истекшие
    query += ` AND (l.status = 'active' OR l.status IS NULL) 
               AND (l.expires_at IS NULL OR datetime(l.expires_at) > datetime('now'))`;
  }

  if (user_id) {
    query += ' AND l.user_id = ?';
    params.push(user_id);
  }

  if (type) {
    query += ' AND l.type = ?';
    params.push(type);
  }

  if (category && category !== 'all') {
    query += ' AND l.category_id = ?';
    params.push(category);
  }

  if (location && location !== 'all') {
    query += ' AND l.location_name = ?';
    params.push(location);
  }

  if (search) {
    query += ' AND (l.title LIKE ? OR l.description LIKE ? OR l.address_detail LIKE ?)';
    const searchPattern = `%${search}%`;
    params.push(searchPattern, searchPattern, searchPattern);
  }

  // Дельта-синхронизация: запрашиваем только то, что обновилось после указанной даты
  if (since) {
    query += ' AND l.updated_at > ?';
    params.push(since);
  }

  // Ранжирование: сначала бустнутые, затем проверенные фермеры (verified), затем самозанятые (pro), затем свежие
  query += ` ORDER BY 
    l.is_boosted DESC, 
    (COALESCE(u.status, 'basic') = 'verified') DESC, 
    (COALESCE(u.status, 'basic') = 'pro') DESC, 
    datetime(l.created_at) DESC
  `;

  const stmt = db.prepare(query);
  const rows = stmt.all(...params);

  res.json({
    items: rows,
    meta: {
      count: rows.length,
      server_time: new Date().toISOString(),
      is_delta: Boolean(since)
    }
  });
});

// GET /api/listings/:id
listingsRouter.get('/:id', (req, res) => {
  const stmt = db.prepare(`
    SELECT 
      l.*,
      COALESCE(u.display_name, l.contact_name) AS seller_name,
      COALESCE(u.status, 'basic') AS user_status,
      COALESCE(u.is_verified, 0) AS user_verified,
      u.inn AS user_inn,
      u.telegram_username AS seller_telegram
    FROM listings l
    LEFT JOIN users u ON l.user_id = u.id
    WHERE l.id = ?
  `);
  const item = stmt.get(req.params.id);

  if (!item) {
    return res.status(404).json({ error: 'Объявление не найдено' });
  }

  res.json(item);
});

// GET /api/listings/:id/recommendations (Графовый движок рекомендаций)
listingsRouter.get('/:id/recommendations', (req, res) => {
  const listingId = req.params.id;
  const currentListing = db.prepare('SELECT * FROM listings WHERE id = ?').get(listingId);

  if (!currentListing) {
    return res.status(404).json({ error: 'Объявление не найдено' });
  }

  // 1. Ищем смежные категории по графу связей graph_edges
  const edgeStmt = db.prepare(`
    SELECT target_category, relation_type, label, weight
    FROM graph_edges
    WHERE source_category = ?
    ORDER BY weight DESC
    LIMIT 4
  `);
  const edges = edgeStmt.all(currentListing.category_id);

  if (!edges || edges.length === 0) {
    return res.json({ recommendations: [], graph_path: [] });
  }

  const recommendations = [];

  // 2. Для каждого ребра графа находим подходящие объявления (предпочитая то же СНТ)
  for (const edge of edges) {
    const candidateStmt = db.prepare(`
      SELECT 
        l.*,
        COALESCE(u.display_name, l.contact_name) AS seller_name,
        COALESCE(u.status, 'basic') AS user_status,
        COALESCE(u.is_verified, 0) AS user_verified
      FROM listings l
      LEFT JOIN users u ON l.user_id = u.id
      WHERE l.category_id = ? AND l.id != ? AND (l.status = 'active' OR l.status IS NULL)
      ORDER BY 
        (l.location_name = ?) DESC, 
        l.is_boosted DESC, 
        (COALESCE(u.status, 'basic') = 'verified') DESC,
        datetime(l.created_at) DESC
      LIMIT 1
    `);
    const candidate = candidateStmt.get(edge.target_category, listingId, currentListing.location_name);

    if (candidate) {
      recommendations.push({
        ...candidate,
        graph_edge: {
          relation_type: edge.relation_type,
          label: edge.label,
          weight: edge.weight
        }
      });
    }
  }

  res.json({
    source_category: currentListing.category_id,
    recommendations,
    edges_traversed: edges.length
  });
});

// POST /api/listings (создание нового объявления с проверкой статуса автора)
listingsRouter.post('/', (req, res) => {
  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : req.body.token;

  let user = getUserByToken(token);

  const {
    title,
    description,
    type,
    category_id,
    location_name,
    address_detail,
    price,
    price_unit,
    contact_name,
    contact_phone,
    contact_telegram,
    image_url
  } = req.body;

  if (!title || !type || !location_name) {
    return res.status(400).json({
      error: 'Обязательные поля: title, type, location_name'
    });
  }

  // Если пользователя нет по токену, но передан contact_name — создаем базового
  if (!user && contact_name) {
    const cleanPhone = (contact_phone || '').replace(/\D/g, '');
    const cleanTg = (contact_telegram || '').replace(/^@/, '').trim();
    const now = new Date().toISOString();
    
    // Ищем существующего или создаем
    let existingUser = null;
    if (cleanPhone) existingUser = db.prepare('SELECT * FROM users WHERE phone = ?').get(cleanPhone);
    if (!existingUser && cleanTg) existingUser = db.prepare('SELECT * FROM users WHERE telegram_username = ?').get(cleanTg);

    if (existingUser) {
      user = existingUser;
    } else {
      const cryptoToken = 'kol_' + Math.random().toString(36).substring(2, 15);
      const insertUser = db.prepare(`
        INSERT INTO users (phone, telegram_username, display_name, status, inn, is_verified, auth_token, created_at, updated_at)
        VALUES (?, ?, ?, 'basic', NULL, 0, ?, ?, ?)
      `);
      const uRes = insertUser.run(cleanPhone || null, cleanTg || null, contact_name.trim(), cryptoToken, now, now);
      user = db.prepare('SELECT * FROM users WHERE id = ?').get(uRes.lastInsertRowid);
    }
  }

  // Проверка лимитов по статусу
  const userStatus = user ? user.status : 'basic';
  const activeCountStmt = db.prepare(`
    SELECT COUNT(*) as count FROM listings 
    WHERE user_id = ? AND (status = 'active' OR status IS NULL)
  `);
  const activeCount = user ? (activeCountStmt.get(user.id)?.count || 0) : 0;

  let ttlDays = 5;
  if (userStatus === 'basic') {
    ttlDays = type === 'goods' ? 5 : 14;
    if (activeCount >= 2) {
      return res.status(403).json({
        error: 'Достигнут лимит статуса «Обычный» (максимум 2 активных объявления). Перейдите на статус «Продвинутый» (Самозанятый/ИП) в профиле для публикации до 10 объявлений.',
        current_status: 'basic',
        limit: 2,
        active_count: activeCount
      });
    }
  } else if (userStatus === 'pro') {
    ttlDays = 30;
    if (activeCount >= 10) {
      return res.status(403).json({
        error: 'Достигнут лимит статуса «Продвинутый» (максимум 10 объявлений). Для безлимитного размещения оформите статус «Цельный» (Фермерское хозяйство / ЛПХ).',
        current_status: 'pro',
        limit: 10,
        active_count: activeCount
      });
    }
  } else if (userStatus === 'verified') {
    ttlDays = 60; // Цельный (ЛПХ / Ферма) — без ограничений
  }

  const now = new Date();
  const expiresAt = new Date(now.getTime() + ttlDays * 24 * 3600000).toISOString();
  const nowIso = now.toISOString();

  const stmt = db.prepare(`
    INSERT INTO listings (
      title, description, type, category_id, location_name, address_detail,
      price, price_unit, contact_name, contact_phone, contact_telegram,
      image_url, is_boosted, boosted_until, created_at, updated_at,
      user_id, status, expires_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, ?, ?, ?, 'active', ?)
  `);

  const result = stmt.run(
    title,
    description || '',
    type,
    category_id || (type === 'goods' ? 'eggs' : 'septic'),
    location_name,
    address_detail || '',
    Number(price) || 0,
    price_unit || (type === 'goods' ? 'руб/ед' : 'руб/услуга'),
    user?.display_name || contact_name || 'Сосед',
    user?.phone || contact_phone || '',
    user?.telegram_username || contact_telegram || '',
    image_url || '',
    nowIso,
    nowIso,
    user?.id || null,
    expiresAt
  );

  const getStmt = db.prepare(`
    SELECT 
      l.*,
      COALESCE(u.display_name, l.contact_name) AS seller_name,
      COALESCE(u.status, 'basic') AS user_status,
      COALESCE(u.is_verified, 0) AS user_verified
    FROM listings l
    LEFT JOIN users u ON l.user_id = u.id
    WHERE l.id = ?
  `);
  const created = getStmt.get(result.lastInsertRowid);

  res.status(201).json(created);
});

// PATCH /api/listings/:id/status (изменение статуса: 'sold', 'active' или продление 'renew')
listingsRouter.patch('/:id/status', (req, res) => {
  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : req.body.token;

  const user = getUserByToken(token);
  const { status, action } = req.body;
  const id = req.params.id;

  const item = db.prepare('SELECT * FROM listings WHERE id = ?').get(id);
  if (!item) {
    return res.status(404).json({ error: 'Объявление не найдено' });
  }

  // Если у объявления есть владелец, только он может менять статус
  if (item.user_id && (!user || user.id !== item.user_id)) {
    return res.status(403).json({ error: 'У вас нет прав на управление этим объявлением' });
  }

  const now = new Date();
  const nowIso = now.toISOString();

  if (action === 'renew') {
    // Продление срока жизни
    const days = user?.status === 'verified' ? 60 : (user?.status === 'pro' ? 30 : 5);
    const newExpiresAt = new Date(now.getTime() + days * 24 * 3600000).toISOString();
    
    db.prepare(`
      UPDATE listings 
      SET status = 'active', expires_at = ?, updated_at = ?
      WHERE id = ?
    `).run(newExpiresAt, nowIso, id);

    return res.json({
      success: true,
      message: `Объявление успешно продлено на ${days} дней!`,
      expires_at: newExpiresAt
    });
  }

  // Установка статуса 'sold' или 'active'
  const newStatus = status === 'sold' ? 'sold' : 'active';
  db.prepare(`
    UPDATE listings 
    SET status = ?, updated_at = ?
    WHERE id = ?
  `).run(newStatus, nowIso, id);

  res.json({
    success: true,
    message: newStatus === 'sold' ? 'Объявление помечено как «Продано».' : 'Объявление снова активно.',
    status: newStatus
  });
});

// POST /api/listings/:id/boost (Оплата буста / закрепления)
listingsRouter.post('/:id/boost', (req, res) => {
  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : req.body.token;
  const user = getUserByToken(token);

  const id = req.params.id;
  const days = Number(req.body.days) || 7;

  // Проверка статуса: только Pro и Verified могут бустить
  if (user && user.status === 'basic') {
    return res.status(403).json({
      error: 'Платное продвижение доступно для самозанятых мастеров и проверенных хозяйств. Пожалуйста, подтвердите статус «Продвинутый» в профиле.',
      require_pro: true
    });
  }

  const boostUntil = new Date(Date.now() + days * 24 * 3600000).toISOString();
  const now = new Date().toISOString();

  const stmt = db.prepare(`
    UPDATE listings 
    SET is_boosted = 1, boosted_until = ?, updated_at = ?
    WHERE id = ?
  `);

  stmt.run(boostUntil, now, id);

  res.json({
    success: true,
    message: `Объявление #${id} успешно поднято в ТОП района на ${days} дней!`,
    boosted_until: boostUntil,
    receipt: {
      provider: 'Плательщик НПД (Самозанятый)',
      service: 'Услуга продвижения объявления в каталоге Kollektiv',
      amount_rub: 49,
      tax_rate: '4%',
      status: 'Оплачено (Тестовый режим эквайринга)'
    }
  });
});
