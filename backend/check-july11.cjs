const Database = require('better-sqlite3');
const db = new Database('./backend/data/database.sqlite', {readonly: true});
const rows = db.prepare("SELECT s.schemeCode, s.schemeName FROM nav_history n JOIN schemes s ON n.schemeCode = s.schemeCode WHERE n.date = '11-Jul-2026' LIMIT 5").all();
console.log(JSON.stringify(rows, null, 2));
