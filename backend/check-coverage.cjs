const Database = require('better-sqlite3');
const db = new Database('./backend/data/database.sqlite', { readonly: true });

const total = db.prepare('SELECT COUNT(DISTINCT schemeCode) as c FROM nav_history').get().c;
console.log('Total schemes with data:', total);
console.log('');

for (let year = 2016; year <= 2026; year++) {
  const r = db.prepare("SELECT COUNT(DISTINCT schemeCode) as c FROM nav_history WHERE date LIKE ?").get(`%${year}`);
  console.log(`Schemes with ${year} data: ${r.c} / ${total} (${Math.round(r.c/total*100)}%)`);
}

console.log('');
console.log('--- Popular funds oldest dates ---');
const funds = [119598, 120505, 118989, 119071, 120381, 120596, 119716, 118278];
funds.forEach(code => {
  const name = db.prepare('SELECT schemeName FROM schemes WHERE schemeCode = ?').get(code);
  const min = db.prepare('SELECT MIN(date) as d FROM nav_history WHERE schemeCode = ?').get(code);
  const cnt = db.prepare('SELECT COUNT(*) as c FROM nav_history WHERE schemeCode = ?').get(code);
  console.log(`${code} ${(name?.schemeName || '').substring(0,45).padEnd(45)} → ${min?.d}  (${cnt.c} points)`);
});
