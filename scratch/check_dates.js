const Database = require('better-sqlite3');
const db = new Database('c:/Users/soura/Desktop/NAVANALYSIS/backend/data/database.sqlite');

const rows14 = db.prepare("SELECT schemeCode, COUNT(*) FROM nav_history WHERE date = '14-Jul-2026' GROUP BY schemeCode").all();
console.log('Number of schemes with 14-Jul-2026 data:', rows14.length);
if (rows14.length > 0) {
  const codes = rows14.slice(0, 5).map(r => r.schemeCode);
  const names = db.prepare(`SELECT schemeCode, schemeName, schemeCategory FROM schemes WHERE schemeCode IN (${codes.join(',')})`).all();
  console.log('Sample schemes for 14-Jul-2026:', names);
}

const rows13 = db.prepare("SELECT schemeCode, COUNT(*) FROM nav_history WHERE date = '13-Jul-2026' GROUP BY schemeCode").all();
console.log('Number of schemes with 13-Jul-2026 data:', rows13.length);
if (rows13.length > 0) {
  const codes = rows13.slice(0, 5).map(r => r.schemeCode);
  const names = db.prepare(`SELECT schemeCode, schemeName, schemeCategory FROM schemes WHERE schemeCode IN (${codes.join(',')})`).all();
  console.log('Sample schemes for 13-Jul-2026:', names);
}
