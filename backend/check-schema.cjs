const Database = require('better-sqlite3');
const db = new Database('./backend/data/database.sqlite', {readonly: true});
console.log(db.prepare("PRAGMA table_info('nav_history')").all());
