import express from 'express';
import compression from 'compression';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { initDatabase } from './db.js';
import { listingsRouter } from './routes/listings.js';
import { locationsRouter } from './routes/locations.js';
import { uploadRouter } from './routes/upload.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PUBLIC_DIR = path.join(__dirname, '../public');

// Инициализация БД
initDatabase();

const app = express();
const PORT = process.env.PORT || 3000;

// Gzip / Brotli компрессия для всех ответов (критично для H+!)
app.use(compression({
  threshold: 512, // сжимать всё, что больше 512 байт
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

// API Routes
app.use('/api/listings', listingsRouter);
app.use('/api', locationsRouter);
app.use('/api/upload', uploadRouter);

// Healthcheck
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'Kollektiv API',
    version: '1.0.0-prototype',
    low_bandwidth_optimized: true,
    uptime_seconds: Math.round(process.uptime()),
    timestamp: new Date().toISOString()
  });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🌾 ========================================================`);
  console.log(`🚀 [Kollektiv] Сервер запущен на http://localhost:${PORT}`);
  console.log(`📡 Оптимизация под сеть H+ / Offline-first активна.`);
  console.log(`========================================================\n`);
});
