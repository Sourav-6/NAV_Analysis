#!/usr/bin/env node

/**
 * AMFI NAV Bulk Data Fetcher
 * 
 * Downloads historical NAV data for ALL mutual fund schemes from AMFI India's
 * bulk download endpoint. Data is stored locally as JSON files for fast analysis.
 * 
 * Usage:
 *   node scripts/fetch-all-nav.js          # Full 5-year download
 *   node scripts/fetch-all-nav.js --update  # Incremental update (new data only)
 * 
 * Data source: https://portal.amfiindia.com/DownloadNAVHistoryReport_Po.aspx
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import https from 'https';
import http from 'http';
import Database from 'better-sqlite3';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..');
const DATA_DIR = path.join(PROJECT_ROOT, 'data');
const DB_PATH = path.join(DATA_DIR, 'database.sqlite');
const PROGRESS_FILE = path.join(DATA_DIR, '.progress.json');
const INWARD_CSV = path.join(DATA_DIR, 'inward.csv');
const CONFIRMED_CSV = path.join(DATA_DIR, 'confirmed.csv');

let db;

const AMFI_BASE_URL = 'https://portal.amfiindia.com/DownloadNAVHistoryReport_Po.aspx';
const DELAY_BETWEEN_REQUESTS_MS = 2500; // Be respectful to AMFI servers
const MAX_RETRIES = 3;
const YEARS_TO_FETCH = 15;

// ── Helpers ──────────────────────────────────────────────────────────────────

function ensureDirs() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!db) {
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.exec(`
      CREATE TABLE IF NOT EXISTS schemes (
        schemeCode INTEGER PRIMARY KEY,
        schemeName TEXT NOT NULL,
        isin TEXT,
        schemeCategory TEXT,
        mainCategory TEXT,
        subCategory TEXT,
        commission TEXT
      );
      CREATE TABLE IF NOT EXISTS nav_history (
        schemeCode INTEGER,
        date TEXT NOT NULL,
        nav REAL NOT NULL,
        PRIMARY KEY (schemeCode, date)
      ) WITHOUT ROWID;
      CREATE TABLE IF NOT EXISTS metadata (
        key TEXT PRIMARY KEY,
        value TEXT
      );
    `);
  }
}

function formatDateForAMFI(date) {
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const dd = String(date.getDate()).padStart(2, '0');
  const mmm = months[date.getMonth()];
  const yyyy = date.getFullYear();
  return `${dd}-${mmm}-${yyyy}`;
}

function formatDateForDisplay(date) {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Fetches data from a URL. Returns the raw text body.
 */
function fetchUrl(url, retries = MAX_RETRIES) {
  return new Promise((resolve, reject) => {
    const protocol = url.startsWith('https') ? https : http;
    
    const makeRequest = (attemptsLeft) => {
      protocol.get(url, { 
        headers: { 
          'User-Agent': 'NAVAnalysis/1.0 (Educational Research)',
          'Accept': 'text/plain, text/csv, */*'
        },
        timeout: 120000 // 2 minute timeout
      }, (res) => {
        // Handle redirects
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          fetchUrl(res.headers.location, attemptsLeft).then(resolve).catch(reject);
          return;
        }

        if (res.statusCode !== 200) {
          if (attemptsLeft > 0) {
            console.log(`     HTTP ${res.statusCode}, retrying in 5s... (${attemptsLeft} attempts left)`);
            setTimeout(() => makeRequest(attemptsLeft - 1), 5000);
            return;
          }
          reject(new Error(`HTTP ${res.statusCode} for ${url}`));
          return;
        }

        const chunks = [];
        res.on('data', chunk => chunks.push(chunk));
        res.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
        res.on('error', (err) => {
          if (attemptsLeft > 0) {
            console.log(`     Stream error, retrying... (${attemptsLeft} attempts left)`);
            setTimeout(() => makeRequest(attemptsLeft - 1), 5000);
          } else {
            reject(err);
          }
        });
      }).on('error', (err) => {
        if (attemptsLeft > 0) {
          console.log(`     Request error: ${err.message}, retrying... (${attemptsLeft} attempts left)`);
          setTimeout(() => makeRequest(attemptsLeft - 1), 5000);
        } else {
          reject(err);
        }
      }).on('timeout', function() {
        this.destroy();
        if (attemptsLeft > 0) {
          console.log(`     Timeout, retrying... (${attemptsLeft} attempts left)`);
          setTimeout(() => makeRequest(attemptsLeft - 1), 5000);
        } else {
          reject(new Error(`Timeout for ${url}`));
        }
      });
    };

    makeRequest(retries);
  });
}

// ── AMFI Data Parsing ────────────────────────────────────────────────────────

// ── CSV Management ─────────────────────────────────────────────────────────────

function loadCSVMap(filepath) {
  const map = new Map();
  if (!fs.existsSync(filepath)) return map;
  const content = fs.readFileSync(filepath, 'utf-8');
  const lines = content.split(/\r?\n/).filter(l => l.trim());
  if (lines.length <= 1) return map;
  
  const headers = lines[0].split(',').map(h => h.trim());
  
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    const values = [];
    let inQuotes = false;
    let currentValue = '';
    for (let char of line) {
      if (char === '"') inQuotes = !inQuotes;
      else if (char === ',' && !inQuotes) { values.push(currentValue); currentValue = ''; }
      else currentValue += char;
    }
    values.push(currentValue);
    
    const obj = {};
    headers.forEach((h, idx) => {
      let val = values[idx] || '';
      if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
      obj[h] = val.trim();
    });
    if (obj['Scheme Code']) {
      map.set(obj['Scheme Code'], obj);
    }
  }
  return map;
}

function saveCSVLists(allDiscoveredSchemes) {
  const inwardMap = loadCSVMap(INWARD_CSV);
  const confirmedMap = loadCSVMap(CONFIRMED_CSV);

  // 1. Check inwardMap for manually edited flags and move them to confirmedMap
  for (const [code, obj] of inwardMap.entries()) {
    let flag = obj['Flag']?.trim().toUpperCase() || '';
    let comm = obj['Commission']?.trim().toUpperCase() || '';
    
    // Auto-correct if user accidentally typed TRUE in Commission instead of Flag
    if (flag === '' && (comm === 'TRUE' || comm === 'ON' || comm === 'Y' || comm === '1')) {
      obj['Flag'] = 'TRUE';
      flag = 'TRUE';
    }

    if (flag !== '' || (comm !== '' && comm !== 'OFF' && comm !== 'FALSE')) { 
      confirmedMap.set(code, obj);
      inwardMap.delete(code);
    }
  }

  const extractCategories = (schemeName, amfiCategoryStr) => {
    const cat = (amfiCategoryStr || '').toLowerCase();
    const name = (schemeName || '').toLowerCase();

    let main = 'Other';
    let sub = 'Other';

    if (name.includes('specialized investment fund') || name.includes('sif ') || name.endsWith(' sif')) {
      return { main: 'Sectoral & Speciality', sub: 'SIF' };
    }

    if (cat.includes('debt') || cat.includes('income') || cat.includes('money market') || cat.includes('gilt') || cat.includes('liquid')) {
      main = 'Debt / Fixed Income';
      if (cat.includes('banking') || cat.includes('psu') || name.includes('banking & psu') || name.includes('banking and psu')) sub = 'Banking and PSU Fund';
      else if (cat.includes('corporate bond') || name.includes('corporate bond')) sub = 'Corporate Bond Fund';
      else if (cat.includes('credit risk') || name.includes('credit risk')) sub = 'Credit Risk Fund';
      else if (cat.includes('dynamic bond') || cat.includes('dynamic term')) sub = 'Dynamic Bond';
      else if (cat.includes('gilt')) sub = 'Gilt Fund';
      else if (cat.includes('liquid')) sub = 'Liquid Fund';
      else if (cat.includes('low duration')) sub = 'Low Duration Fund';
      else if (cat.includes('money market')) sub = 'Money Market Fund';
      else if (cat.includes('overnight')) sub = 'Overnight Fund';
      else if (cat.includes('short duration') || cat.includes('short term')) sub = 'Short Duration Fund';
      else sub = 'Other';
      return { main, sub };
    }

    if (cat.includes('sectoral') || cat.includes('thematic')) {
      main = 'Sectoral & Speciality';
      sub = 'Sectoral';
      return { main, sub };
    }

    if (cat.includes('hybrid') || cat.includes('arbitrage') || cat.includes('index') || cat.includes('etf') || cat.includes('solution')) {
      main = 'Hybrid & Index';
      if (cat.includes('aggressive')) sub = 'Aggressive Hybrid Fund';
      else if (cat.includes('arbitrage')) sub = 'Arbitrage Fund';
      else if (cat.includes('conservative')) sub = 'Conservative Hybrid Fund';
      else if (cat.includes('dynamic asset') || cat.includes('balanced advantage')) sub = 'Dynamic Asset Allocation';
      else if (cat.includes('multi asset')) sub = 'Multi Asset Allocation';
      else if (cat.includes('index') || cat.includes('etf')) sub = 'Index Funds';
      else if (cat.includes('solution') || cat.includes('children') || cat.includes('retirement')) sub = 'Solution Oriented';
      else sub = 'Other';
      return { main, sub };
    }

    if (cat.includes('equity')) {
      main = 'Diversified Equity';
      if (cat.includes('large & mid') || cat.includes('large and mid')) sub = 'Large Cap';
      else if (cat.includes('large cap') || (name.includes('large cap') && !name.includes('mid'))) sub = 'Large Cap';
      else if (cat.includes('mid cap') || (name.includes('mid cap') && !name.includes('large'))) sub = 'Mid Cap';
      else if (cat.includes('small cap') || name.includes('small cap')) sub = 'Small Cap';
      else if (cat.includes('flexi cap') || cat.includes('flexicap') || name.includes('flexi cap')) sub = 'Flexi Cap';
      else if (cat.includes('multi cap') || cat.includes('multicap') || name.includes('multi cap')) sub = 'Multi Cap';
      else if (cat.includes('focused') || name.includes('focused')) sub = 'Focused Fund';
      else if (cat.includes('elss') || name.includes('elss') || name.includes('tax saver')) sub = 'ELSS';
      else if (cat.includes('value') || cat.includes('contra') || name.includes('value') || name.includes('contra')) sub = 'Value Fund';
      else sub = 'Other';
      return { main, sub };
    }

    return { main, sub };
  };

  // 2. Process newly discovered schemes
  for (const [code, scheme] of allDiscoveredSchemes) {
    if (confirmedMap.has(code)) {
      // already confirmed, keep it
    } else if (inwardMap.has(code)) {
      // keep existing inward properties (including manual changes)
      // Auto-fill Main Category and Sub Category if they are blank
      const existing = inwardMap.get(code);
      if (!existing['Main Category'] || !existing['Sub Category']) {
        const { main, sub } = extractCategories(scheme.schemeName, scheme.schemeCategory);
        if (!existing['Main Category']) existing['Main Category'] = main;
        if (!existing['Sub Category']) existing['Sub Category'] = sub;
      }
    } else {
      // NEW scheme! add to inward
      const { main, sub } = extractCategories(scheme.schemeName, scheme.schemeCategory);
      inwardMap.set(code, {
        'Scheme Code': code,
        'Scheme Name': scheme.schemeName,
        'Scheme Category': scheme.schemeCategory,
        'Classification': scheme.classification,
        'Main Category': main,
        'Sub Category': sub,
        'Flag': '', // Explicitly empty for inward file
        'Commission': 'OFF'
      });
    }
  }
  
  const headers = ['Scheme Code', 'Scheme Name', 'Scheme Category', 'Classification', 'Main Category', 'Sub Category', 'Flag', 'Commission'];
  
  const escape = (str) => {
    if (str == null) return '';
    const s = String(str);
    if (s.includes(',') || s.includes('"') || s.includes('\n')) {
      return '"' + s.replace(/"/g, '""') + '"';
    }
    return s;
  };

  const saveMapToCSV = (mapToSave, filepath) => {
    const lines = [headers.join(',')];
    const sortedArr = Array.from(mapToSave.values()).sort((a, b) => {
      if (a['Scheme Category'] !== b['Scheme Category']) {
         return String(a['Scheme Category']).localeCompare(String(b['Scheme Category']));
      }
      return String(a['Scheme Name']).localeCompare(String(b['Scheme Name']));
    });
    
    for (const obj of sortedArr) {
      lines.push(headers.map(h => escape(obj[h])).join(','));
    }
    fs.writeFileSync(filepath, lines.join('\n'));
  };

  saveMapToCSV(inwardMap, INWARD_CSV);
  saveMapToCSV(confirmedMap, CONFIRMED_CSV);
  
  // Return a map of ONLY the TRUE/ON flags from confirmedMap
  const validConfirmedMap = new Map();
  for (const [code, obj] of confirmedMap.entries()) {
    let flag = obj['Flag']?.trim().toUpperCase() || '';
    let comm = obj['Commission']?.trim().toUpperCase() || '';
    
    // Auto-correct for existing corruptions where Flag is empty but Commission is TRUE
    if (flag === '' && (comm === 'TRUE' || comm === 'ON' || comm === 'Y' || comm === '1')) {
      obj['Flag'] = 'TRUE';
      flag = 'TRUE';
    }
    // Auto-correct if Flag got shifted (e.g. contains Category name) but Commission is TRUE
    if (flag !== 'TRUE' && flag !== 'Y' && flag !== '1' && flag !== 'ON' && flag !== 'FALSE' && flag !== 'OFF' && flag !== '') {
       if (comm === 'TRUE' || comm === 'ON' || comm === 'Y' || comm === '1') {
         obj['Flag'] = 'TRUE';
         flag = 'TRUE';
       }
    }

    if (flag === 'TRUE' || flag === 'Y' || flag === '1' || flag === 'ON') {
      validConfirmedMap.set(code, obj);
    }
  }

  return validConfirmedMap;
}

async function preSyncCSV() {
  console.log(' Syncing scheme list from AMFI (Generating inward.csv/confirmed.csv)...');
  const d = new Date();
  d.setDate(d.getDate() - 3); // 3 days ago to be safe
  const dateStr = formatDateForAMFI(d);
  const url = `${AMFI_BASE_URL}?tp=1&frmdt=${dateStr}&todt=${dateStr}`;
  const rawData = await fetchUrl(url);
  
  const allDiscoveredSchemes = new Map();
  const lines = rawData.split('\n');
  let currentCategory = 'Unknown';
  
  for (const line of lines) {
    const trimmed = line.trim().replace(/\r$/, '');
    if (!trimmed) continue;
    if (trimmed.startsWith('Scheme Code;')) continue;
    if (trimmed.startsWith('Open Ended') || trimmed.startsWith('Close Ended') || trimmed.startsWith('Interval')) {
      currentCategory = trimmed;
      continue;
    }
    if (!trimmed.includes(';')) continue;

    const parts = trimmed.split(';');
    if (parts.length < 8) continue;

    const schemeCode = parts[0].trim();
    const schemeName = parts[1].trim();
    
    if (!schemeCode || isNaN(parseInt(schemeCode))) continue;

    const nameLower = schemeName.toLowerCase();
    const isDirect = nameLower.includes('direct');
    const isInstitutional = nameLower.includes('institutional') || nameLower.includes('inst');
    const classification = isDirect ? 'Direct' : (isInstitutional ? 'Institutional' : 'Regular');
    
    const isGrowth = nameLower.includes('growth');
    const isIDCW = nameLower.includes('idcw') || nameLower.includes('dividend');
    const passesAutoCheck = isGrowth && !isIDCW && !isInstitutional;
    
    allDiscoveredSchemes.set(schemeCode, {
      schemeCode,
      schemeName,
      schemeCategory: currentCategory,
      classification,
      autoFlag: passesAutoCheck
    });
  }
  
  const confirmedMap = saveCSVLists(allDiscoveredSchemes);
  console.log(` CSV Sync complete. Found ${allDiscoveredSchemes.size} total schemes, ${confirmedMap.size} confirmed.`);
  return confirmedMap;
}

// ── AMFI Data Parsing ────────────────────────────────────────────────────────

/**
 * Parses the semicolon-delimited text from AMFI's bulk endpoint.
 * Format: Scheme Code;Scheme Name;ISIN Div Payout/ISIN Growth;ISIN Div Reinvestment;Net Asset Value;Repurchase Price;Sale Price;Date
 * 
 * Returns a Map<schemeCode, { schemeName, isin, navEntries: [{date, nav}] }>
 */
function parseAMFIData(rawText, confirmedMap) {
  const lines = rawText.split('\n');
  const schemeMap = new Map();
  let parsedCount = 0;
  let skippedCount = 0;
  let currentCategory = 'Unknown';

  for (const line of lines) {
    const trimmed = line.trim().replace(/\r$/, '');
    
    // Skip empty lines, headers
    if (!trimmed) continue;
    if (trimmed.startsWith('Scheme Code;')) continue; // Header

    // Check if it's a category header
    if (trimmed.startsWith('Open Ended') || trimmed.startsWith('Close Ended') || trimmed.startsWith('Interval')) {
      currentCategory = trimmed;
      continue;
    }
    
    // Skip AMC name lines or other non-data
    if (!trimmed.includes(';')) continue;

    const parts = trimmed.split(';');
    if (parts.length < 8) continue;

    const schemeCode = parts[0].trim();
    const schemeName = parts[1].trim();
    const isin = parts[2].trim();
    const navStr = parts[4].trim();
    const dateStr = parts[7].trim();

    // Validate
    if (!schemeCode || isNaN(parseInt(schemeCode))) { skippedCount++; continue; }
    
    // Only process funds that are in the confirmed map (TRUE/ON flag)
    if (!confirmedMap.has(schemeCode)) { skippedCount++; continue; }
    
    if (!navStr || navStr === 'N.A.' || navStr === '-') { skippedCount++; continue; }
    if (!dateStr) { skippedCount++; continue; }

    const nav = parseFloat(navStr);
    if (isNaN(nav)) { skippedCount++; continue; }

    if (!schemeMap.has(schemeCode)) {
      schemeMap.set(schemeCode, {
        schemeCode,
        schemeName,
        isin,
        schemeCategory: currentCategory,
        navEntries: []
      });
    }

    schemeMap.get(schemeCode).navEntries.push({ date: dateStr, nav: navStr });
    parsedCount++;
  }

  return { schemeMap, parsedCount, skippedCount };
}

// ── Monthly Chunk Generation ─────────────────────────────────────────────────

function generateMonthlyChunks(startDate, endDate) {
  const chunks = [];
  let current = new Date(startDate);

  while (current < endDate) {
    const chunkEnd = new Date(current);
    chunkEnd.setMonth(chunkEnd.getMonth() + 1);
    chunkEnd.setDate(0); // Last day of the current month
    
    if (chunkEnd > endDate) {
      chunkEnd.setTime(endDate.getTime());
    }

    chunks.push({
      from: new Date(current),
      to: new Date(chunkEnd),
      label: `${formatDateForAMFI(current)} → ${formatDateForAMFI(chunkEnd)}`
    });

    // Move to 1st of next month
    current.setMonth(current.getMonth() + 1);
    current.setDate(1);
  }

  return chunks;
}

// ── Progress Management ──────────────────────────────────────────────────────

function loadProgress() {
  if (fs.existsSync(PROGRESS_FILE)) {
    return JSON.parse(fs.readFileSync(PROGRESS_FILE, 'utf-8'));
  }
  return { completedChunks: [], lastChunkIndex: -1 };
}

function saveProgress(progress) {
  fs.writeFileSync(PROGRESS_FILE, JSON.stringify(progress, null, 2));
}

function clearProgress() {
  if (fs.existsSync(PROGRESS_FILE)) fs.unlinkSync(PROGRESS_FILE);
}

// ── Merge NAV data into existing scheme files ────────────────────────────────

function mergeAndSaveSchemeData(schemeMap, confirmedMap) {
  let newSchemes = 0;
  let updatedSchemes = 0;
  
  const insertScheme = db.prepare('INSERT OR IGNORE INTO schemes (schemeCode, schemeName, isin, schemeCategory, mainCategory, subCategory, commission) VALUES (?, ?, ?, ?, ?, ?, ?)');
  const updateScheme = db.prepare('UPDATE schemes SET mainCategory = ?, subCategory = ?, commission = ? WHERE schemeCode = ?');
  const insertNav = db.prepare('INSERT OR IGNORE INTO nav_history (schemeCode, date, nav) VALUES (?, ?, ?)');
  const checkSchemeExists = db.prepare('SELECT 1 FROM schemes WHERE schemeCode = ?');
  
  const insertMany = db.transaction((schemesData) => {
    for (const [schemeCode, data] of schemesData) {
      const parsedCode = parseInt(schemeCode);
      const csvObj = confirmedMap.get(schemeCode);
      const mainCategory = csvObj ? csvObj['Main Category'] || '' : '';
      const subCategory = csvObj ? csvObj['Sub Category'] || '' : '';
      const commission = csvObj ? csvObj['Commission'] || '' : '';
      
      const exists = checkSchemeExists.get(parsedCode);
      if (exists) {
        updateScheme.run(mainCategory, subCategory, commission, parsedCode);
        updatedSchemes++;
      } else {
        insertScheme.run(parsedCode, data.schemeName, data.isin || '', data.schemeCategory || '', mainCategory, subCategory, commission);
        newSchemes++;
      }
      
      for (const entry of data.navEntries) {
        insertNav.run(parsedCode, entry.date, parseFloat(entry.nav));
      }
    }
  });

  insertMany(schemeMap);

  return { newSchemes, updatedSchemes };
}

/**
 * Parse date strings in DD-Mon-YYYY format to a timestamp for sorting.
 */
function parseDateString(dateStr) {
  const months = { 'Jan': 0, 'Feb': 1, 'Mar': 2, 'Apr': 3, 'May': 4, 'Jun': 5, 'Jul': 6, 'Aug': 7, 'Sep': 8, 'Oct': 9, 'Nov': 10, 'Dec': 11 };
  // Try DD-Mon-YYYY format first
  const parts = dateStr.split('-');
  if (parts.length === 3 && months[parts[1]] !== undefined) {
    return new Date(parseInt(parts[2]), months[parts[1]], parseInt(parts[0])).getTime();
  }
  // Fallback: try DD-MM-YYYY
  if (parts.length === 3) {
    return new Date(parseInt(parts[2]), parseInt(parts[1]) - 1, parseInt(parts[0])).getTime();
  }
  return 0;
}

// ── Update Master Schemes List ───────────────────────────────────────────────

function updateMasterSchemeList() {
  // Master list is updated dynamically through the DB during mergeAndSaveSchemeData
  return db.prepare('SELECT COUNT(*) as c FROM schemes').get().c;
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const isUpdate = process.argv.includes('--update');
  const isCsvOnly = process.argv.includes('--csv-only');
  const isNavOnly = process.argv.includes('--nav-only');
  
  console.log('');
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║           AMFI NAV Bulk Data Fetcher v1.0                   ║');
  console.log('╠══════════════════════════════════════════════════════════════╣');
  console.log(`║  Mode: ${isUpdate ? 'INCREMENTAL UPDATE' : 'FULL 5-YEAR DOWNLOAD'}                          ║`);
  console.log('╚══════════════════════════════════════════════════════════════╝');
  console.log('');

  ensureDirs();
  let confirmedMap;
  
  if (!isNavOnly) {
    confirmedMap = await preSyncCSV();
  } else {
    // If nav-only, we skip AMFI discovery and just load the existing confirmed.csv
    console.log('️ Skipping AMFI list discovery (--nav-only flag). Reading local confirmed.csv...');
    const rawMap = loadCSVMap(CONFIRMED_CSV);
    confirmedMap = new Map();
    for (const [code, obj] of rawMap.entries()) {
      const flag = obj['Flag']?.trim().toUpperCase() || '';
      if (flag === 'TRUE' || flag === 'Y' || flag === '1' || flag === 'ON') {
        confirmedMap.set(code, obj);
      }
    }
    console.log(` Loaded ${confirmedMap.size} confirmed schemes from disk.`);
  }

  // Cleanup Database: Explicitly delete schemes (and their NAV data) that are NOT in the valid confirmed map
  console.log(' Cleaning up database: removing non-confirmed/false flag schemes...');
  const activeCodes = Array.from(confirmedMap.keys()).map(c => parseInt(c)).join(',');
  let deletedNav = 0;
  let deletedSchemes = 0;
  if (activeCodes.length > 0) {
    const navRes = db.prepare(`DELETE FROM nav_history WHERE schemeCode NOT IN (${activeCodes})`).run();
    const schemeRes = db.prepare(`DELETE FROM schemes WHERE schemeCode NOT IN (${activeCodes})`).run();
    deletedNav = navRes.changes;
    deletedSchemes = schemeRes.changes;
  } else {
    // If NO active codes, delete EVERYTHING
    const navRes = db.prepare('DELETE FROM nav_history').run();
    const schemeRes = db.prepare('DELETE FROM schemes').run();
    deletedNav = navRes.changes;
    deletedSchemes = schemeRes.changes;
  }
  console.log(`   Deleted ${deletedSchemes} schemes and ${deletedNav} NAV records.`);

  if (isCsvOnly) {
    console.log('\n CSV Update only requested. Exiting without fetching NAV data.');
    process.exit(0);
  }

  // Determine date range
  const endDate = new Date(); // Fetch up to today to get the most recent data (if published)
  
  let startDate;

  // Detect if any confirmed schemes are completely missing from the database
  let needsFullDownload = false;
  if (isUpdate && activeCodes.length > 0) {
    const counts = db.prepare(`SELECT schemeCode, COUNT(nav) as c FROM nav_history WHERE schemeCode IN (${activeCodes}) GROUP BY schemeCode`).all();
    const existingCodes = new Set(counts.map(row => row.schemeCode));
    for (const codeStr of confirmedMap.keys()) {
      if (!existingCodes.has(parseInt(codeStr))) {
        needsFullDownload = true;
        console.log(`️ Detected newly added scheme (${codeStr}) with no historical data! Forcing full 15-year download.`);
        break;
      }
    }
  }

  if (isUpdate && !needsFullDownload) {
    // Read last update timestamp
    const metaRecord = db ? db.prepare("SELECT value FROM metadata WHERE key = 'global_metadata'").get() : null;
    
    if (!metaRecord) {
      console.log(' No existing data found. Running full download instead.');
      startDate = new Date();
      startDate.setFullYear(startDate.getFullYear() - YEARS_TO_FETCH);
    } else {
      const metadata = JSON.parse(metaRecord.value);
      // Use the lastNavDate stored in metadata, which was properly calculated using javascript date parsing
      if (metadata.lastNavDate) {
        startDate = new Date(metadata.lastNavDate);
      } else {
        startDate = new Date();
        startDate.setFullYear(startDate.getFullYear() - YEARS_TO_FETCH);
      }
      // Go back 3 days to fill any gaps from late-published NAVs
      startDate.setDate(startDate.getDate() - 3);
      
      if (startDate >= endDate) {
        console.log(' Data is already up to date!');
        console.log(`   Last NAV date: ${metadata.lastNavDate}`);
        return;
      }
      
      console.log(` Fetching data from ${formatDateForDisplay(startDate)} to ${formatDateForDisplay(endDate)}`);
    }
  } else {
    startDate = new Date();
    startDate.setFullYear(startDate.getFullYear() - YEARS_TO_FETCH);
    console.log(` Fetching ${YEARS_TO_FETCH} years of data: ${formatDateForDisplay(startDate)} → ${formatDateForDisplay(endDate)}`);
  }

  // Generate monthly chunks
  const chunks = generateMonthlyChunks(startDate, endDate);
  console.log(` Total chunks to process: ${chunks.length}`);
  console.log('');

  // Load progress for resume support
  const progress = isUpdate ? { completedChunks: [], lastChunkIndex: -1 } : loadProgress();
  const startChunkIndex = progress.lastChunkIndex + 1;

  if (startChunkIndex > 0 && !isUpdate) {
    console.log(` Resuming from chunk ${startChunkIndex + 1}/${chunks.length}`);
  }

  // Accumulated scheme data across all chunks
  const globalSchemeMap = new Map();
  let totalDataPoints = 0;
  const startTime = Date.now();

  for (let i = startChunkIndex; i < chunks.length; i++) {
    const chunk = chunks[i];
    const chunkNum = i + 1;
    const elapsed = Date.now() - startTime;
    const chunksProcessed = i - startChunkIndex;
    const avgTimePerChunk = chunksProcessed > 0 ? elapsed / chunksProcessed : 30000;
    const remainingChunks = chunks.length - i;
    const etaMs = remainingChunks * avgTimePerChunk;
    const etaMin = Math.ceil(etaMs / 60000);

    // Progress bar
    const pct = Math.round((i / chunks.length) * 100);
    const barLen = 30;
    const filled = Math.round((i / chunks.length) * barLen);
    const bar = '█'.repeat(filled) + '░'.repeat(barLen - filled);

    console.log(`[${bar}] ${pct}% | Chunk ${chunkNum}/${chunks.length} | ETA: ${etaMin} min`);
    console.log(`   Fetching: ${chunk.label}`);

    try {
      const url = `${AMFI_BASE_URL}?tp=1&frmdt=${formatDateForAMFI(chunk.from)}&todt=${formatDateForAMFI(chunk.to)}`;
      const rawData = await fetchUrl(url);
      
      const { schemeMap, parsedCount, skippedCount } = parseAMFIData(rawData, confirmedMap);
      totalDataPoints += parsedCount;

      // Merge into global map
      for (const [code, data] of schemeMap) {
        if (globalSchemeMap.has(code)) {
          globalSchemeMap.get(code).navEntries.push(...data.navEntries);
        } else {
          globalSchemeMap.set(code, { ...data });
        }
      }

      console.log(`   Parsed ${parsedCount.toLocaleString()} data points from ${schemeMap.size.toLocaleString()} schemes (${skippedCount} skipped)`);

      // Save progress
      progress.lastChunkIndex = i;
      progress.completedChunks.push(chunk.label);
      if (!isUpdate) saveProgress(progress);

      // Save to disk every 6 chunks to avoid losing too much data on crash
      if ((i + 1) % 6 === 0 || i === chunks.length - 1) {
        process.stdout.write(`   Saving to database...`);
        const { newSchemes, updatedSchemes } = mergeAndSaveSchemeData(globalSchemeMap, confirmedMap);
        console.log(` Done (${newSchemes} new, ${updatedSchemes} updated schemes)`);
        globalSchemeMap.clear(); // Free memory after saving
      }

    } catch (err) {
      console.error(`   Failed: ${err.message}`);
      console.log(`   Skipping chunk and continuing...`);
    }

    // Rate limiting
    if (i < chunks.length - 1) {
      await sleep(DELAY_BETWEEN_REQUESTS_MS);
    }
  }

  // Final save for any remaining data
  if (globalSchemeMap.size > 0) {
    process.stdout.write(' Final save to disk...');
    const { newSchemes, updatedSchemes, allSchemes } = mergeAndSaveSchemeData(globalSchemeMap, confirmedMap);
    updateMasterSchemeList(allSchemes);
    console.log(` Done (${newSchemes} new, ${updatedSchemes} updated)`);
  }

  // Update metadata
  // Update metadata
  // Count final schemes in DB
  const navFilesLength = db.prepare('SELECT COUNT(*) as c FROM schemes').get().c;

  let existingMetadata = {
    totalDataPoints: 0,
    dataRangeStart: formatDateForDisplay(startDate),
    dataRangeEnd: formatDateForDisplay(endDate)
  };
  
  const metaRecord = db.prepare("SELECT value FROM metadata WHERE key = 'global_metadata'").get();
  if (metaRecord) {
    try {
      existingMetadata = JSON.parse(metaRecord.value);
    } catch (e) {
      // ignore
    }
  }

  const newTotalDataPoints = isUpdate 
    ? (existingMetadata.totalDataPoints || 0) + totalDataPoints
    : totalDataPoints;

  const newStartDate = isUpdate && existingMetadata.dataRangeStart
    ? existingMetadata.dataRangeStart
    : formatDateForDisplay(startDate);

  // Determine the true latest NAV date from the database by parsing the date strings
  let actualLastNavDate;
  
  process.stdout.write('\n Calculating true metadata (this takes a few seconds)...');
  const distinctDates = db.prepare(`
    SELECT DISTINCT nh.date 
    FROM nav_history nh
    JOIN schemes s ON nh.schemeCode = s.schemeCode
    WHERE LOWER(s.schemeCategory) NOT LIKE '%specialized%'
  `).all();
  let maxTimestamp = -8640000000000000;
  
  distinctDates.forEach(r => {
    const d = parseDateString(r.date);
    if (d > 0 && d > maxTimestamp) {
      maxTimestamp = d;
    }
  });

  const maxDate = new Date(maxTimestamp);

  if (maxTimestamp > -8640000000000000) {
    actualLastNavDate = formatDateForDisplay(maxDate);
  } else {
    actualLastNavDate = formatDateForDisplay(endDate);
  }
  console.log(' Done');

  const newEndDate = actualLastNavDate;

  const metadata = {
    lastUpdated: new Date().toISOString(),
    lastNavDate: actualLastNavDate,
    totalSchemes: navFilesLength,
    totalDataPoints: newTotalDataPoints,
    dataRangeStart: newStartDate,
    dataRangeEnd: newEndDate,
    yearsOfData: YEARS_TO_FETCH
  };
  
  db.prepare('INSERT OR REPLACE INTO metadata (key, value) VALUES (?, ?)').run('global_metadata', JSON.stringify(metadata));

  // Clean up progress file
  clearProgress();

  const totalTime = Math.round((Date.now() - startTime) / 1000);
  const minutes = Math.floor(totalTime / 60);
  const seconds = totalTime % 60;

  console.log('');
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║                     DOWNLOAD COMPLETE                     ║');
  console.log('╠══════════════════════════════════════════════════════════════╣');
  console.log(`║  Total schemes:     ${String(metadata.totalSchemes).padEnd(38)}║`);
  console.log(`║  Data points:       ${String(totalDataPoints.toLocaleString()).padEnd(38)}║`);
  console.log(`║  Time taken:        ${String(`${minutes}m ${seconds}s`).padEnd(38)}║`);
  console.log(`║  Data directory:    ./data/                                 ║`);
  console.log('╚══════════════════════════════════════════════════════════════╝');
  console.log('');
  console.log('Next steps:');
  console.log('  1. Start the local server:  npm run server');
  console.log('  2. Start the React app:     npm run dev');
  console.log('  3. Or both at once:         npm run dev:full');
  console.log('');
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
