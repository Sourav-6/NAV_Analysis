import path from 'path';
import { fileURLToPath } from 'url';
import Database from 'better-sqlite3';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..');
const DATA_DIR = path.join(PROJECT_ROOT, 'data');
const DB_PATH = path.join(DATA_DIR, 'database.sqlite');

function parseDateString(dateStr) {
  const months = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };
  const parts = dateStr.split('-');
  if (parts.length !== 3) return new Date(0);
  const dd = parseInt(parts[0], 10);
  const mmm = months[parts[1]];
  const yyyy = parseInt(parts[2], 10);
  return new Date(yyyy, mmm, dd);
}

function formatDateForDisplay(date) {
  return date.toISOString().slice(0, 10);
}

function main() {
  console.log('🔍 Connecting to SQLite database to recalculate metadata...');
  
  const db = new Database(DB_PATH);
  
  const totalSchemes = db.prepare('SELECT COUNT(*) as c FROM schemes').get().c;
  const totalDataPoints = db.prepare('SELECT COUNT(*) as c FROM nav_history').get().c;
  
  console.log(`  Found ${totalSchemes} schemes and ${totalDataPoints} NAV points. Analyzing date range...`);
  
  // Extract all distinct dates to find start and end dates
  const dates = db.prepare('SELECT DISTINCT date FROM nav_history').all().map(r => r.date);
  
  let minDate = new Date(8640000000000000); // Max date possible
  let maxDate = new Date(-8640000000000000); // Min date possible
  
  dates.forEach(dateStr => {
    const date = parseDateString(dateStr);
    if (date.getTime() > 0) {
      if (date < minDate) minDate = date;
      if (date > maxDate) maxDate = date;
    }
  });

  const metadata = {
    lastUpdated: new Date().toISOString(),
    lastNavDate: formatDateForDisplay(maxDate),
    totalSchemes,
    totalDataPoints,
    dataRangeStart: formatDateForDisplay(minDate),
    dataRangeEnd: formatDateForDisplay(maxDate),
    yearsOfData: Math.round((maxDate - minDate) / (1000 * 60 * 60 * 24 * 365.25)),
    schemesInMemory: totalSchemes
  };

  db.prepare('INSERT OR REPLACE INTO metadata (key, value) VALUES (?, ?)').run('global_metadata', JSON.stringify(metadata));
  
  console.log('\n✅ SQLite Recalculation Complete!');
  console.log(JSON.stringify(metadata, null, 2));
}

main();
