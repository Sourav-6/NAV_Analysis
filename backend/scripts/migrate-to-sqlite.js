import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import Database from 'better-sqlite3';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..');
const DATA_DIR = path.join(PROJECT_ROOT, 'data');
const NAV_DIR = path.join(DATA_DIR, 'nav');
const SCHEMES_FILE = path.join(DATA_DIR, 'schemes.json');
const METADATA_FILE = path.join(DATA_DIR, 'metadata.json');
const PROGRESS_FILE = path.join(DATA_DIR, '.progress.json');
const SIF_PROGRESS_FILE = path.join(DATA_DIR, '.sif-progress.json');

const DB_PATH = path.join(DATA_DIR, 'database.sqlite');

console.log('╔══════════════════════════════════════════════════════════════╗');
console.log('║           SQLite Database Migration Script                   ║');
console.log('╚══════════════════════════════════════════════════════════════╝');
console.log('');

// 1. Initialize Database
if (fs.existsSync(DB_PATH)) {
  console.log(`⚠️ Database ${DB_PATH} already exists. Deleting...`);
  fs.unlinkSync(DB_PATH);
}

console.log('🛠 Creating new SQLite database...');
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

// 2. Create Schema
db.exec(`
  CREATE TABLE schemes (
    schemeCode INTEGER PRIMARY KEY,
    schemeName TEXT NOT NULL,
    isin TEXT,
    schemeCategory TEXT
  );

  CREATE TABLE nav_history (
    schemeCode INTEGER,
    date TEXT NOT NULL,
    nav REAL NOT NULL,
    PRIMARY KEY (schemeCode, date)
  ) WITHOUT ROWID;

  CREATE TABLE metadata (
    key TEXT PRIMARY KEY,
    value TEXT
  );
`);
console.log('✅ Schema created successfully.');

// 3. Migrate Schemes
console.log('📦 Migrating schemes...');
let totalSchemes = 0;
if (fs.existsSync(SCHEMES_FILE)) {
  const schemes = JSON.parse(fs.readFileSync(SCHEMES_FILE, 'utf-8'));
  const insertScheme = db.prepare('INSERT OR IGNORE INTO schemes (schemeCode, schemeName, isin, schemeCategory) VALUES (?, ?, ?, ?)');
  
  const insertManySchemes = db.transaction((schemesArray) => {
    for (const s of schemesArray) {
      insertScheme.run(parseInt(s.schemeCode), s.schemeName, s.isin || '', s.schemeCategory || '');
    }
  });
  
  insertManySchemes(schemes);
  totalSchemes = schemes.length;
  console.log(`✅ Migrated ${totalSchemes} schemes.`);
} else {
  console.log('⚠️ schemes.json not found!');
}

// 4. Migrate NAV Data
console.log('📈 Migrating NAV history...');
if (fs.existsSync(NAV_DIR)) {
  const files = fs.readdirSync(NAV_DIR).filter(f => f.endsWith('.json'));
  console.log(`Found ${files.length} scheme NAV files to process.`);
  
  const insertNav = db.prepare('INSERT OR IGNORE INTO nav_history (schemeCode, date, nav) VALUES (?, ?, ?)');
  const insertManyNavs = db.transaction((schemeCode, navDataArray) => {
    for (const entry of navDataArray) {
      insertNav.run(schemeCode, entry.date, entry.nav);
    }
  });

  let processed = 0;
  let totalDataPoints = 0;
  const startTime = Date.now();

  for (const file of files) {
    const schemeCode = parseInt(file.replace('.json', ''));
    if (isNaN(schemeCode)) continue;

    try {
      const data = JSON.parse(fs.readFileSync(path.join(NAV_DIR, file), 'utf-8'));
      if (data.navData && Array.isArray(data.navData)) {
        insertManyNavs(schemeCode, data.navData);
        totalDataPoints += data.navData.length;
      }
    } catch (err) {
      console.error(`Error processing ${file}:`, err);
    }

    processed++;
    if (processed % 1000 === 0) {
      process.stdout.write(`  [${processed}/${files.length}] Migrated NAV data... \r`);
    }
  }
  console.log(`\n✅ Migrated ${totalDataPoints.toLocaleString()} total NAV data points.`);
  console.log(`⏱ Time taken: ${((Date.now() - startTime) / 1000).toFixed(2)}s`);
} else {
  console.log('⚠️ data/nav directory not found!');
}

// 5. Migrate Metadata
console.log('📝 Migrating metadata...');
const insertMeta = db.prepare('INSERT OR REPLACE INTO metadata (key, value) VALUES (?, ?)');
const insertManyMeta = db.transaction((entries) => {
  for (const [k, v] of Object.entries(entries)) {
    insertMeta.run(k, JSON.stringify(v));
  }
});

const metadataEntries = {};

if (fs.existsSync(METADATA_FILE)) {
  const md = JSON.parse(fs.readFileSync(METADATA_FILE, 'utf-8'));
  metadataEntries['global_metadata'] = md;
}

if (fs.existsSync(PROGRESS_FILE)) {
  const pg = JSON.parse(fs.readFileSync(PROGRESS_FILE, 'utf-8'));
  metadataEntries['nav_progress'] = pg;
}

if (fs.existsSync(SIF_PROGRESS_FILE)) {
  const spg = JSON.parse(fs.readFileSync(SIF_PROGRESS_FILE, 'utf-8'));
  metadataEntries['sif_progress'] = spg;
}

insertManyMeta(metadataEntries);
console.log('✅ Migrated metadata successfully.');

console.log('');
console.log('🎉 Migration Complete! Your data is now in SQLite.');
