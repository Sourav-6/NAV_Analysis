const Database = require('better-sqlite3');
const db = new Database('./backend/data/database.sqlite', {readonly: true});
const has2012 = db.prepare("SELECT COUNT(DISTINCT schemeCode) as c FROM nav_history WHERE date LIKE '%2012'").get();
const has2013 = db.prepare("SELECT COUNT(DISTINCT schemeCode) as c FROM nav_history WHERE date LIKE '%2013'").get();
console.log('Schemes with 2012 data:', has2012.c);
console.log('Schemes with 2013 data:', has2013.c);
