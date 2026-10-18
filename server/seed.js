import { db, initDatabase } from './db.js';

initDatabase();

const locations = [
  { name: 'СНТ «Восход»', type: 'СНТ', lat: 56.452, lon: 84.978 },
  { name: 'СНТ «Энергетик»', type: 'СНТ', lat: 56.461, lon: 84.992 },
  { name: 'СНТ «Кедр»', type: 'СНТ', lat: 56.440, lon: 84.960 },
  { name: 'пос. Зональная Станция', type: 'Поселок', lat: 56.415, lon: 85.002 },
  { name: 'дер. Кисловка', type: 'Деревня', lat: 56.438, lon: 84.885 },
  { name: 'пос. Апрель', type: 'Поселок', lat: 56.398, lon: 85.018 }
];

const categories = [
  // Товары (Goods)
  { id: 'dairy', name: 'Молоко и сыр', icon: '🥛', type: 'goods' },
  { id: 'eggs', name: 'Яйца домашние', icon: '🥚', type: 'goods' },
  { id: 'meat', name: 'Мясо и птица', icon: '🍗', type: 'goods' },
  { id: 'honey', name: 'Мёд и пасека', icon: '🍯', type: 'goods' },
  { id: 'berries', name: 'Овощи и ягоды', icon: '🍓', type: 'goods' },
  { id: 'plants', name: 'Рассада и саженцы', icon: '🌱', type: 'goods' },

  // Услуги (Services)
  { id: 'septic', name: 'Ассенизатор (ЖБО)', icon: '🚛', type: 'services' },
  { id: 'tractor', name: 'Трактор и вспашка', icon: '🚜', type: 'services' },
  { id: 'firewood', name: 'Дрова и уголь', icon: '🪵', type: 'services' },
  { id: 'mowing', name: 'Покос травы и спил', icon: '🌿', type: 'services' },
  { id: 'electric', name: 'Электрик и насосы', icon: '⚡', type: 'services' },
  { id: 'cargo', name: 'Грузоперевозки / Газель', icon: '📦', type: 'services' }
];

// 1. Справочник локаций (СНТ и поселки)
const insertLocation = db.prepare('INSERT OR IGNORE INTO locations (name, type, lat, lon) VALUES (?, ?, ?, ?)');
for (const loc of locations) {
  insertLocation.run(loc.name, loc.type, loc.lat, loc.lon);
}

// 2. Справочник категорий
const insertCategory = db.prepare('INSERT OR REPLACE INTO categories (id, name, icon, type) VALUES (?, ?, ?, ?)');
for (const cat of categories) {
  insertCategory.run(cat.id, cat.name, cat.icon, cat.type);
}

// 3. Полное обнуление динамических данных (чистый ноль карточек, пользователей и жалоб)
db.exec(`
  DELETE FROM listings;
  DELETE FROM users;
  DELETE FROM reports;
  DELETE FROM sqlite_sequence WHERE name IN ('listings', 'users', 'reports');
`);

// 4. Граф загородных потребностей (механика и логика рекомендаций)
const graphEdges = [
  // Молоко и сыр
  { source: 'dairy', target: 'eggs', type: 'complement', label: 'Фермерская корзина', weight: 0.95 },
  { source: 'dairy', target: 'honey', type: 'complement', label: 'Свежий утренний сбор', weight: 0.85 },
  { source: 'dairy', target: 'berries', type: 'complement', label: 'Ягоды к творогу', weight: 0.80 },

  // Яйца
  { source: 'eggs', target: 'dairy', type: 'complement', label: 'Фермерская корзина', weight: 0.95 },
  { source: 'eggs', target: 'meat', type: 'complement', label: 'Птицеводство', weight: 0.85 },
  { source: 'eggs', target: 'honey', type: 'complement', label: 'Домашние сладости', weight: 0.75 },

  // Трактор / вспашка
  { source: 'tractor', target: 'plants', type: 'lifecycle', label: 'Посадочный цикл', weight: 0.95 },
  { source: 'tractor', target: 'cargo', type: 'tool', label: 'Вывоз грунта / урожая', weight: 0.85 },
  { source: 'tractor', target: 'septic', type: 'seasonal', label: 'Подготовка участка', weight: 0.80 },

  // Рассада и саженцы
  { source: 'plants', target: 'tractor', type: 'tool', label: 'Вспашка под посадку', weight: 0.95 },
  { source: 'plants', target: 'berries', type: 'lifecycle', label: 'Урожай и уход', weight: 0.90 },
  { source: 'plants', target: 'honey', type: 'complement', label: 'Опыление и пасека', weight: 0.70 },

  // Ассенизатор (ЖБО)
  { source: 'septic', target: 'firewood', type: 'seasonal', label: 'Осенняя подготовка дома', weight: 0.90 },
  { source: 'septic', target: 'electric', type: 'tool', label: 'Обслуживание насосов', weight: 0.85 },
  { source: 'septic', target: 'tractor', type: 'tool', label: 'Земляные работы', weight: 0.75 },

  // Дрова
  { source: 'firewood', target: 'septic', type: 'seasonal', label: 'Консервация к зиме', weight: 0.90 },
  { source: 'firewood', target: 'mowing', type: 'seasonal', label: 'Распил и спил деревьев', weight: 0.85 },
  { source: 'firewood', target: 'honey', type: 'complement', label: 'Всё для бани', weight: 0.80 },

  // Мёд
  { source: 'honey', target: 'dairy', type: 'complement', label: 'Мёд с парным молоком', weight: 0.90 },
  { source: 'honey', target: 'berries', type: 'complement', label: 'Сладкий стол', weight: 0.85 },
  { source: 'honey', target: 'firewood', type: 'complement', label: 'Чай после бани', weight: 0.80 },

  // Покос травы
  { source: 'mowing', target: 'tractor', type: 'tool', label: 'Культивация целины', weight: 0.90 },
  { source: 'mowing', target: 'cargo', type: 'tool', label: 'Вывоз скошенной травы', weight: 0.85 }
];

db.exec('DELETE FROM graph_edges');
const insertEdge = db.prepare(`
  INSERT OR REPLACE INTO graph_edges (source_category, target_category, relation_type, label, weight)
  VALUES (?, ?, ?, ?, ?)
`);

for (const edge of graphEdges) {
  insertEdge.run(edge.source, edge.target, edge.type, edge.label, edge.weight);
}

console.log('🌾 [Reset] База данных очищена под чистый ноль:');
console.log(`   - Объявлений (Listings): 0`);
console.log(`   - Пользователей (Users): 0`);
console.log(`   - Жалоб (Reports): 0`);
console.log(`   - Локаций в каталоге: ${locations.length}`);
console.log(`   - Категорий: ${categories.length}`);
console.log(`   - Графовых связей движка: ${graphEdges.length}`);
