import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const UPLOADS_DIR = path.join(__dirname, '../../public/uploads');

if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

export const uploadRouter = Router();

// POST /api/upload
// Принимает сжатый DataURL (WebP / JPEG до 100 КБ) от клиента
uploadRouter.post('/', (req, res) => {
  const { dataUrl, filename } = req.body;

  if (!dataUrl || !dataUrl.startsWith('data:image/')) {
    return res.status(400).json({ error: 'Некорректный формат изображения (ожидается dataUrl)' });
  }

  try {
    const matches = dataUrl.match(/^data:image\/([a-zA-Z0-9]+);base64,(.+)$/);
    if (!matches) {
      return res.status(400).json({ error: 'Не удалось разобрать Base64 DataURL' });
    }

    const ext = matches[1] === 'jpeg' ? 'jpg' : matches[1];
    const buffer = Buffer.from(matches[2], 'base64');

    // Ограничение: максимум 250 КБ для защиты H+ и хранилища
    if (buffer.length > 250 * 1024) {
      return res.status(413).json({ error: 'Файл слишком большой. Клиент должен был сжать фото до 100 КБ.' });
    }

    const id = crypto.randomBytes(8).toString('hex');
    const safeName = `${Date.now()}_${id}.${ext}`;
    const filePath = path.join(UPLOADS_DIR, safeName);

    fs.writeFileSync(filePath, buffer);

    const publicUrl = `/uploads/${safeName}`;
    res.json({
      success: true,
      url: publicUrl,
      size_kb: Math.round(buffer.length / 1024)
    });
  } catch (err) {
    console.error('Ошибка сохранения фото:', err);
    res.status(500).json({ error: 'Внутренняя ошибка сохранения файла' });
  }
});
