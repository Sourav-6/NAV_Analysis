const Database = require('better-sqlite3');
const db = new Database('c:/Users/soura/Desktop/NAVANALYSIS/backend/data/database.sqlite');

const rows = db.prepare(`
  SELECT nh.schemeCode, nh.date, s.schemeName, s.schemeCategory 
  FROM nav_history nh
  JOIN schemes s ON nh.schemeCode = s.schemeCode
  WHERE nh.date = '14-Jul-2026' AND LOWER(s.schemeCategory) NOT LIKE '%specialized%'
`).all();

console.log('Schemes with 14-Jul-2026 that PASSED the filter:', rows.length);
if (rows.length > 0) {
  console.log('First 5:', rows.slice(0, 5));
}
