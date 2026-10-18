import { Router } from 'express';
import { db } from '../db.js';

export const locationsRouter = Router();

locationsRouter.get('/locations', (req, res) => {
  const stmt = db.prepare('SELECT * FROM locations ORDER BY name ASC');
  const rows = stmt.all();
  res.json(rows);
});

locationsRouter.get('/categories', (req, res) => {
  const stmt = db.prepare('SELECT * FROM categories ORDER BY name ASC');
  const rows = stmt.all();
  res.json(rows);
});
