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

const sampleListings = [
  {
    title: 'Свежие деревенские яйца (куры на зерновом откорме)',
    description: 'Всегда свежий сбор, желток ярко-оранжевый. Забирать на Центральной улице возле магазина или принесу к калитке.',
    type: 'goods',
    category_id: 'eggs',
    location_name: 'СНТ «Восход»',
    address_detail: 'ул. Центральная, уч. 48',
    price: 160,
    price_unit: 'руб/десяток',
    contact_name: 'Бабушка Анна',
    contact_phone: '+7 903 955-12-34',
    contact_telegram: '',
    image_url: 'https://images.unsplash.com/photo-1582722872445-44dc5f7e3c8f?auto=format&fit=crop&w=600&q=80',
    is_boosted: 1,
    boosted_until: '2026-10-25T23:59:59Z',
    created_at: new Date(Date.now() - 3600000 * 5).toISOString(),
    updated_at: new Date(Date.now() - 3600000 * 5).toISOString()
  },
  {
    title: 'Парное козье молоко без запаха',
    description: 'Порода зааненская, чистейшее молоко, идеально для деток и сыроварения. Утренний и вечерний удой. Банки на обмен.',
    type: 'goods',
    category_id: 'dairy',
    location_name: 'СНТ «Восход»',
    address_detail: 'ул. Лесная, уч. 112',
    price: 180,
    price_unit: 'руб/литр',
    contact_name: 'Валентина Григорьевна',
    contact_phone: '+7 952 888-45-67',
    contact_telegram: 't.me/valya_kozy',
    image_url: 'https://images.unsplash.com/photo-1527153857715-3908f2bae5e8?auto=format&fit=crop&w=600&q=80',
    is_boosted: 0,
    boosted_until: null,
    created_at: new Date(Date.now() - 3600000 * 12).toISOString(),
    updated_at: new Date(Date.now() - 3600000 * 12).toISOString()
  },
  {
    title: 'Откачка септиков и выгребных ям (шланг 35 метров)',
    description: 'Бочка 4 куба. Длинный рукав — подъедем к любому участку, забор не помнем. Быстро, аккуратно, договор на слив с Водоканалом.',
    type: 'services',
    category_id: 'septic',
    location_name: 'СНТ «Восход»',
    address_detail: 'Выезд по всем СНТ Богашевского тракта',
    price: 1800,
    price_unit: 'руб/рейс',
    contact_name: 'Михаил (ЗИЛ)',
    contact_phone: '+7 913 820-99-88',
    contact_telegram: 't.me/mikhail_septik',
    image_url: 'https://images.unsplash.com/photo-1581092160607-ee22621dd758?auto=format&fit=crop&w=600&q=80',
    is_boosted: 1,
    boosted_until: '2026-10-30T23:59:59Z',
    created_at: new Date(Date.now() - 3600000 * 2).toISOString(),
    updated_at: new Date(Date.now() - 3600000 * 2).toISOString()
  },
  {
    title: 'Вспашка огородов мотоблоком и трактором МТЗ',
    description: 'Фрезерование целины, перепашка под зиму, культивация. Ровный слой, разбиваем комья. Опыт 10 лет.',
    type: 'services',
    category_id: 'tractor',
    location_name: 'СНТ «Энергетик»',
    address_detail: 'Работаем по Кисловке, Зональному, СНТ Восход/Энергетик',
    price: 700,
    price_unit: 'руб/сотка',
    contact_name: 'Сергей Николаевич',
    contact_phone: '+7 906 199-33-22',
    contact_telegram: '',
    image_url: 'https://images.unsplash.com/photo-1592982537447-7440770cbfc9?auto=format&fit=crop&w=600&q=80',
    is_boosted: 0,
    boosted_until: null,
    created_at: new Date(Date.now() - 3600000 * 24).toISOString(),
    updated_at: new Date(Date.now() - 3600000 * 24).toISOString()
  },
  {
    title: 'Березовые колотые сухие дрова в сетках и укладкой',
    description: 'Жаркие, без гнили и трухи. Доставка на самосвале ГАЗ-53 от 2 кубов. Выгрузка включена в стоимость.',
    type: 'services',
    category_id: 'firewood',
    location_name: 'пос. Зональная Станция',
    address_detail: 'Быстрая доставка по пригороду',
    price: 2500,
    price_unit: 'руб/куб',
    contact_name: 'Иван Петрович',
    contact_phone: '+7 923 444-55-11',
    contact_telegram: 't.me/drova_tomsk',
    image_url: 'https://images.unsplash.com/photo-1542838132-92c53300491e?auto=format&fit=crop&w=600&q=80',
    is_boosted: 0,
    boosted_until: null,
    created_at: new Date(Date.now() - 3600000 * 30).toISOString(),
    updated_at: new Date(Date.now() - 3600000 * 30).toISOString()
  }
];

// Seed Locations
const insertLocation = db.prepare('INSERT OR IGNORE INTO locations (name, type, lat, lon) VALUES (?, ?, ?, ?)');
for (const loc of locations) {
  insertLocation.run(loc.name, loc.type, loc.lat, loc.lon);
}

// Seed Categories
const insertCategory = db.prepare('INSERT OR REPLACE INTO categories (id, name, icon, type) VALUES (?, ?, ?, ?)');
for (const cat of categories) {
  insertCategory.run(cat.id, cat.name, cat.icon, cat.type);
}

// Seed Listings (clean first)
db.exec('DELETE FROM listings');
const insertListing = db.prepare(`
  INSERT INTO listings (
    title, description, type, category_id, location_name, address_detail,
    price, price_unit, contact_name, contact_phone, contact_telegram,
    image_url, is_boosted, boosted_until, created_at, updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

for (const it of sampleListings) {
  insertListing.run(
    it.title, it.description, it.type, it.category_id, it.location_name, it.address_detail,
    it.price, it.price_unit, it.contact_name, it.contact_phone, it.contact_telegram,
    it.image_url, it.is_boosted, it.boosted_until, it.created_at, it.updated_at
  );
}

console.log('🌾 [Seed] Данные успешно загружены:');
console.log(`   - Локаций: ${locations.length}`);
console.log(`   - Категорий: ${categories.length}`);
console.log(`   - Тестовых объявлений: ${sampleListings.length}`);
