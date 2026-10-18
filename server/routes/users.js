import { Router } from 'express';
import crypto from 'crypto';
import { db } from '../db.js';

export const usersRouter = Router();

// Хелпер получения пользователя по токену
export function getUserByToken(token) {
  if (!token) return null;
  const stmt = db.prepare('SELECT * FROM users WHERE auth_token = ?');
  return stmt.get(token);
}

// POST /api/users/login (быстрый вход по телефону или Telegram)
usersRouter.post('/login', (req, res) => {
  const { phone, telegram_username, display_name } = req.body;

  if (!display_name) {
    return res.status(400).json({ error: 'Имя обязательно для входа' });
  }

  const cleanPhone = (phone || '').replace(/\D/g, '');
  const cleanTg = (telegram_username || '').replace(/^@/, '').trim();

  let user = null;

  // Ищем существующего пользователя по телефону или телеграму
  if (cleanTg) {
    user = db.prepare('SELECT * FROM users WHERE telegram_username = ?').get(cleanTg);
  } else if (cleanPhone) {
    user = db.prepare('SELECT * FROM users WHERE phone = ?').get(cleanPhone);
  }

  const now = new Date().toISOString();

  if (!user) {
    // Создаем нового пользователя со статусом "basic" (Обычный дачник)
    const token = 'kol_' + crypto.randomBytes(16).toString('hex');
    const stmt = db.prepare(`
      INSERT INTO users (
        phone, telegram_username, display_name, status, inn, is_verified, auth_token, created_at, updated_at
      ) VALUES (?, ?, ?, 'basic', NULL, 0, ?, ?, ?)
    `);

    const result = stmt.run(cleanPhone || null, cleanTg || null, display_name.trim(), token, now, now);
    user = db.prepare('SELECT * FROM users WHERE id = ?').get(result.lastInsertRowid);
  } else if (!user.auth_token) {
    // Генерируем токен, если его не было
    const token = 'kol_' + crypto.randomBytes(16).toString('hex');
    db.prepare('UPDATE users SET auth_token = ?, updated_at = ? WHERE id = ?').run(token, now, user.id);
    user.auth_token = token;
  }

  res.json({
    user: {
      id: user.id,
      display_name: user.display_name,
      phone: user.phone,
      telegram_username: user.telegram_username,
      status: user.status,
      inn: user.inn,
      is_verified: Boolean(user.is_verified),
      created_at: user.created_at
    },
    token: user.auth_token
  });
});

// GET /api/users/me (текущий профиль)
usersRouter.get('/me', (req, res) => {
  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : req.query.token;

  const user = getUserByToken(token);
  if (!user) {
    return res.status(401).json({ error: 'Не авторизован' });
  }

  // Подсчитываем количество активных объявлений
  const stats = db.prepare(`
    SELECT 
      COUNT(*) AS total_listings,
      SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) AS active_listings
    FROM listings
    WHERE user_id = ?
  `).get(user.id);

  res.json({
    user: {
      id: user.id,
      display_name: user.display_name,
      phone: user.phone,
      telegram_username: user.telegram_username,
      status: user.status,
      inn: user.inn,
      is_verified: Boolean(user.is_verified),
      created_at: user.created_at
    },
    stats: {
      total_listings: stats.total_listings || 0,
      active_listings: stats.active_listings || 0
    }
  });
});

// PATCH /api/users/me (обновление профиля и смена статуса)
usersRouter.patch('/me', (req, res) => {
  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : req.body.token;

  const user = getUserByToken(token);
  if (!user) {
    return res.status(401).json({ error: 'Не авторизован' });
  }

  const { display_name, status, inn, phone, telegram_username } = req.body;
  const now = new Date().toISOString();

  // Валидация статуса
  const validStatuses = ['basic', 'pro', 'verified'];
  const newStatus = validStatuses.includes(status) ? status : user.status;
  const isVerified = newStatus === 'verified' ? 1 : (newStatus === 'pro' && inn ? 1 : 0);

  const stmt = db.prepare(`
    UPDATE users SET
      display_name = COALESCE(?, display_name),
      status = ?,
      inn = COALESCE(?, inn),
      phone = COALESCE(?, phone),
      telegram_username = COALESCE(?, telegram_username),
      is_verified = ?,
      updated_at = ?
    WHERE id = ?
  `);

  stmt.run(
    display_name ? display_name.trim() : null,
    newStatus,
    inn ? inn.trim() : null,
    phone ? phone.replace(/\D/g, '') : null,
    telegram_username ? telegram_username.replace(/^@/, '').trim() : null,
    isVerified,
    now,
    user.id
  );

  const updated = db.prepare('SELECT * FROM users WHERE id = ?').get(user.id);

  res.json({
    success: true,
    user: {
      id: updated.id,
      display_name: updated.display_name,
      phone: updated.phone,
      telegram_username: updated.telegram_username,
      status: updated.status,
      inn: updated.inn,
      is_verified: Boolean(updated.is_verified),
      updated_at: updated.updated_at
    }
  });
});

// GET /api/users/me/listings (объявления текущего пользователя)
usersRouter.get('/me/listings', (req, res) => {
  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : req.query.token;

  const user = getUserByToken(token);
  if (!user) {
    return res.status(401).json({ error: 'Не авторизован' });
  }

  const listings = db.prepare(`
    SELECT * FROM listings 
    WHERE user_id = ? 
    ORDER BY datetime(created_at) DESC
  `).all(user.id);

  res.json({
    items: listings,
    count: listings.length
  });
});
