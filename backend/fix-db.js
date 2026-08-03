import Database from 'better-sqlite3';
const db = new Database('./data/database.sqlite');
try {
  db.exec('ALTER TABLE schemes ADD COLUMN mainCategory TEXT');
  console.log('Added mainCategory');
} catch (e) {
  console.error(e.message);
}
try {
  db.exec('ALTER TABLE schemes ADD COLUMN subCategory TEXT');
  console.log('Added subCategory');
} catch (e) {
  console.error(e.message);
}
console.log(db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='schemes'").get());
