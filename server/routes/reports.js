import { Router } from 'express';
import { db } from '../db.js';

export const reportsRouter = Router();

// POST /api/reports (подача жалобы на объявление)
reportsRouter.post('/', (req, res) => {
  const { listing_id, reporter_info, reason } = req.body;

  if (!listing_id || !reason) {
    return res.status(400).json({ error: 'listing_id и reason обязательны' });
  }

  // Проверяем, существует ли объявление
  const listing = db.prepare('SELECT id, title FROM listings WHERE id = ?').get(listing_id);
  if (!listing) {
    return res.status(404).json({ error: 'Объявление не найдено' });
  }

  const now = new Date().toISOString();
  const stmt = db.prepare(`
    INSERT INTO reports (listing_id, reporter_info, reason, status, created_at)
    VALUES (?, ?, ?, 'pending', ?)
  `);

  stmt.run(listing_id, reporter_info || 'Анонимный сосед', reason.trim(), now);

  res.json({
    success: true,
    message: 'Жалоба принята. Администратор проверит карточку на соответствие 112-ФЗ и правилам платформы.',
    listing_id: Number(listing_id)
  });
});

// GET /api/reports (просмотр жалоб для модерации)
reportsRouter.get('/', (req, res) => {
  const secret = req.query.admin_key;
  if (secret !== 'kollektiv_admin_2026') {
    return res.status(403).json({ error: 'Доступ только для администратора' });
  }

  const rows = db.prepare(`
    SELECT r.*, l.title, l.contact_phone, l.contact_name
    FROM reports r
    LEFT JOIN listings l ON r.listing_id = l.id
    ORDER BY datetime(r.created_at) DESC
  `).all();

  res.json({ reports: rows });
});
