import express from 'express';
import compression from 'compression';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import rateLimit from 'express-rate-limit';
import { initDatabase } from './db.js';
import { listingsRouter } from './routes/listings.js';
import { locationsRouter } from './routes/locations.js';
import { uploadRouter } from './routes/upload.js';
import { usersRouter } from './routes/users.js';
import { reportsRouter } from './routes/reports.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PUBLIC_DIR = path.join(__dirname, '../public');

// Инициализация БД
initDatabase();

const app = express();
const PORT = process.env.PORT || 3000;

// Gzip / Brotli компрессия для всех ответов (критично для H+!)
app.use(compression({
  threshold: 512,
  level: 6
}));

app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

// Статические файлы (отключаем жесткий кэш для прототипа)
app.use(express.static(PUBLIC_DIR, {
  maxAge: 0,
  etag: false,
  setHeaders: (res) => {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
  }
}));

// Защита от спама и DoS-атак (Rate Limiters)
const uploadLimiter = rateLimit({
  windowMs: 10 * 60 * 1000, // 10 минут
  max: 15, // максимум 15 загрузок фото
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Превышен лимит загрузки изображений. Защита от спама: подождите несколько минут.' }
});

const reportLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: 'Слишком много жалоб с вашего адреса. Подождите 15 минут.' }
});

// API Routes
app.use('/api/listings', listingsRouter);
app.use('/api', locationsRouter);
app.use('/api/upload', uploadLimiter, uploadRouter);
app.use('/api/users', usersRouter);
app.use('/api/reports', reportLimiter, reportsRouter);

// Healthcheck
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'Kollektiv API',
    version: '1.1.0-alpha',
    low_bandwidth_optimized: true,
    features: ['graph_recommendations', 'user_statuses', 'rate_limiting', 'offline_first'],
    uptime_seconds: Math.round(process.uptime()),
    timestamp: new Date().toISOString()
  });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🌾 ========================================================`);
  console.log(`🚀 [Kollektiv] Сервер запущен на http://localhost:${PORT}`);
  console.log(`📡 Оптимизация под сеть H+ / Offline-first активна.`);
  console.log(`🛡️ Rate limiting и система статусов пользователей включены.`);
  console.log(`========================================================\n`);
});
