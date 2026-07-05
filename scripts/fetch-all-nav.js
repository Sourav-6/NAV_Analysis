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

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..');
const DATA_DIR = path.join(PROJECT_ROOT, 'data');
const NAV_DIR = path.join(DATA_DIR, 'nav');
const METADATA_FILE = path.join(DATA_DIR, 'metadata.json');
const SCHEMES_FILE = path.join(DATA_DIR, 'schemes.json');
const PROGRESS_FILE = path.join(DATA_DIR, '.progress.json');

const AMFI_BASE_URL = 'https://portal.amfiindia.com/DownloadNAVHistoryReport_Po.aspx';
const DELAY_BETWEEN_REQUESTS_MS = 2500; // Be respectful to AMFI servers
const MAX_RETRIES = 3;
const YEARS_TO_FETCH = 15;

// ── Helpers ──────────────────────────────────────────────────────────────────

function ensureDirs() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(NAV_DIR)) fs.mkdirSync(NAV_DIR, { recursive: true });
}

function formatDateForAMFI(date) {
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const dd = String(date.getDate()).padStart(2, '0');
  const mmm = months[date.getMonth()];
  const yyyy = date.getFullYear();
  return `${dd}-${mmm}-${yyyy}`;
}

function formatDateForDisplay(date) {
  return date.toISOString().slice(0, 10);
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
            console.log(`    ⚠ HTTP ${res.statusCode}, retrying in 5s... (${attemptsLeft} attempts left)`);
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
            console.log(`    ⚠ Stream error, retrying... (${attemptsLeft} attempts left)`);
            setTimeout(() => makeRequest(attemptsLeft - 1), 5000);
          } else {
            reject(err);
          }
        });
      }).on('error', (err) => {
        if (attemptsLeft > 0) {
          console.log(`    ⚠ Request error: ${err.message}, retrying... (${attemptsLeft} attempts left)`);
          setTimeout(() => makeRequest(attemptsLeft - 1), 5000);
        } else {
          reject(err);
        }
      }).on('timeout', function() {
        this.destroy();
        if (attemptsLeft > 0) {
          console.log(`    ⚠ Timeout, retrying... (${attemptsLeft} attempts left)`);
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

/**
 * Parses the semicolon-delimited text from AMFI's bulk endpoint.
 * Format: Scheme Code;Scheme Name;ISIN Div Payout/ISIN Growth;ISIN Div Reinvestment;Net Asset Value;Repurchase Price;Sale Price;Date
 * 
 * Returns a Map<schemeCode, { schemeName, isin, navEntries: [{date, nav}] }>
 */
function parseAMFIData(rawText) {
  const lines = rawText.split('\n');
  const schemeMap = new Map();
  let parsedCount = 0;
  let skippedCount = 0;

  for (const line of lines) {
    const trimmed = line.trim().replace(/\r$/, '');
    
    // Skip empty lines, headers, category lines, and AMC name lines
    if (!trimmed) continue;
    if (trimmed.startsWith('Scheme Code;')) continue; // Header
    if (trimmed.startsWith('Open Ended') || trimmed.startsWith('Close Ended') || trimmed.startsWith('Interval')) continue; // Category
    if (!trimmed.includes(';')) continue; // AMC name lines or other non-data

    const parts = trimmed.split(';');
    if (parts.length < 8) continue;

    const schemeCode = parts[0].trim();
    const schemeName = parts[1].trim();
    const isin = parts[2].trim();
    const navStr = parts[4].trim();
    const dateStr = parts[7].trim();

    // Validate
    if (!schemeCode || isNaN(parseInt(schemeCode))) { skippedCount++; continue; }
    if (!navStr || navStr === 'N.A.' || navStr === '-') { skippedCount++; continue; }
    if (!dateStr) { skippedCount++; continue; }

    const nav = parseFloat(navStr);
    if (isNaN(nav)) { skippedCount++; continue; }

    if (!schemeMap.has(schemeCode)) {
      schemeMap.set(schemeCode, {
        schemeCode,
        schemeName,
        isin,
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

function mergeAndSaveSchemeData(schemeMap) {
  let newSchemes = 0;
  let updatedSchemes = 0;
  const allSchemes = [];

  for (const [schemeCode, data] of schemeMap) {
    const filePath = path.join(NAV_DIR, `${schemeCode}.json`);
    let existing = null;

    if (fs.existsSync(filePath)) {
      try {
        existing = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      } catch {
        existing = null;
      }
    }

    if (existing) {
      // Merge: add new dates that don't exist yet
      const existingDates = new Set(existing.navData.map(e => e.date));
      const newEntries = data.navEntries.filter(e => !existingDates.has(e.date));
      
      if (newEntries.length > 0) {
        existing.navData = [...existing.navData, ...newEntries];
        // Sort by date descending (newest first) — parse DD-Mon-YYYY
        existing.navData.sort((a, b) => {
          return parseDateString(b.date) - parseDateString(a.date);
        });
        fs.writeFileSync(filePath, JSON.stringify(existing));
        updatedSchemes++;
      }

      allSchemes.push({
        schemeCode: existing.schemeCode,
        schemeName: existing.schemeName,
        isin: existing.isin
      });
    } else {
      // Sort nav entries by date descending (newest first)
      data.navEntries.sort((a, b) => {
        return parseDateString(b.date) - parseDateString(a.date);
      });

      const schemeData = {
        schemeCode: data.schemeCode,
        schemeName: data.schemeName,
        isin: data.isin,
        navData: data.navEntries
      };

      fs.writeFileSync(filePath, JSON.stringify(schemeData));
      newSchemes++;

      allSchemes.push({
        schemeCode: data.schemeCode,
        schemeName: data.schemeName,
        isin: data.isin
      });
    }
  }

  return { newSchemes, updatedSchemes, allSchemes };
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

function updateMasterSchemeList(allSchemes) {
  let existingSchemes = [];
  if (fs.existsSync(SCHEMES_FILE)) {
    try {
      existingSchemes = JSON.parse(fs.readFileSync(SCHEMES_FILE, 'utf-8'));
    } catch {
      existingSchemes = [];
    }
  }

  // Merge by schemeCode
  const schemeMap = new Map();
  for (const s of existingSchemes) schemeMap.set(s.schemeCode, s);
  for (const s of allSchemes) schemeMap.set(s.schemeCode, s);

  const merged = Array.from(schemeMap.values());
  merged.sort((a, b) => a.schemeName.localeCompare(b.schemeName));
  
  fs.writeFileSync(SCHEMES_FILE, JSON.stringify(merged));
  return merged.length;
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const isUpdate = process.argv.includes('--update');
  
  console.log('');
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║           AMFI NAV Bulk Data Fetcher v1.0                   ║');
  console.log('╠══════════════════════════════════════════════════════════════╣');
  console.log(`║  Mode: ${isUpdate ? 'INCREMENTAL UPDATE' : 'FULL 5-YEAR DOWNLOAD'}                          ║`);
  console.log('╚══════════════════════════════════════════════════════════════╝');
  console.log('');

  ensureDirs();

  // Determine date range
  const endDate = new Date();
  endDate.setDate(endDate.getDate() - 1); // Yesterday (today's NAV may not be published yet)
  
  let startDate;

  if (isUpdate) {
    // Read last update timestamp
    if (!fs.existsSync(METADATA_FILE)) {
      console.log('⚠ No existing data found. Running full download instead.');
      startDate = new Date();
      startDate.setFullYear(startDate.getFullYear() - YEARS_TO_FETCH);
    } else {
      const metadata = JSON.parse(fs.readFileSync(METADATA_FILE, 'utf-8'));
      startDate = new Date(metadata.lastNavDate);
      startDate.setDate(startDate.getDate() + 1); // Day after last stored date
      
      if (startDate >= endDate) {
        console.log('✅ Data is already up to date!');
        console.log(`   Last NAV date: ${metadata.lastNavDate}`);
        return;
      }
      
      console.log(`📅 Fetching data from ${formatDateForDisplay(startDate)} to ${formatDateForDisplay(endDate)}`);
    }
  } else {
    startDate = new Date();
    startDate.setFullYear(startDate.getFullYear() - YEARS_TO_FETCH);
    console.log(`📅 Fetching ${YEARS_TO_FETCH} years of data: ${formatDateForDisplay(startDate)} → ${formatDateForDisplay(endDate)}`);
  }

  // Generate monthly chunks
  const chunks = generateMonthlyChunks(startDate, endDate);
  console.log(`📦 Total chunks to process: ${chunks.length}`);
  console.log('');

  // Load progress for resume support
  const progress = isUpdate ? { completedChunks: [], lastChunkIndex: -1 } : loadProgress();
  const startChunkIndex = progress.lastChunkIndex + 1;

  if (startChunkIndex > 0 && !isUpdate) {
    console.log(`🔄 Resuming from chunk ${startChunkIndex + 1}/${chunks.length}`);
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
    console.log(`  📥 Fetching: ${chunk.label}`);

    try {
      const url = `${AMFI_BASE_URL}?tp=1&frmdt=${formatDateForAMFI(chunk.from)}&todt=${formatDateForAMFI(chunk.to)}`;
      const rawData = await fetchUrl(url);
      
      const { schemeMap, parsedCount, skippedCount } = parseAMFIData(rawData);
      totalDataPoints += parsedCount;

      // Merge into global map
      for (const [code, data] of schemeMap) {
        if (globalSchemeMap.has(code)) {
          globalSchemeMap.get(code).navEntries.push(...data.navEntries);
        } else {
          globalSchemeMap.set(code, { ...data });
        }
      }

      console.log(`  ✅ Parsed ${parsedCount.toLocaleString()} data points from ${schemeMap.size.toLocaleString()} schemes (${skippedCount} skipped)`);

      // Save progress
      progress.lastChunkIndex = i;
      progress.completedChunks.push(chunk.label);
      if (!isUpdate) saveProgress(progress);

      // Save to disk every 6 chunks to avoid losing too much data on crash
      if ((i + 1) % 6 === 0 || i === chunks.length - 1) {
        process.stdout.write(`  💾 Saving to disk...`);
        const { newSchemes, updatedSchemes, allSchemes } = mergeAndSaveSchemeData(globalSchemeMap);
        updateMasterSchemeList(allSchemes);
        console.log(` Done (${newSchemes} new, ${updatedSchemes} updated schemes)`);
        globalSchemeMap.clear(); // Free memory after saving
      }

    } catch (err) {
      console.error(`  ❌ Failed: ${err.message}`);
      console.log(`  ⏭ Skipping chunk and continuing...`);
    }

    // Rate limiting
    if (i < chunks.length - 1) {
      await sleep(DELAY_BETWEEN_REQUESTS_MS);
    }
  }

  // Final save for any remaining data
  if (globalSchemeMap.size > 0) {
    process.stdout.write('💾 Final save to disk...');
    const { newSchemes, updatedSchemes, allSchemes } = mergeAndSaveSchemeData(globalSchemeMap);
    updateMasterSchemeList(allSchemes);
    console.log(` Done (${newSchemes} new, ${updatedSchemes} updated)`);
  }

  // Update metadata
  const navFiles = fs.readdirSync(NAV_DIR).filter(f => f.endsWith('.json'));
  const metadata = {
    lastUpdated: new Date().toISOString(),
    lastNavDate: formatDateForDisplay(endDate),
    totalSchemes: navFiles.length,
    totalDataPoints,
    dataRangeStart: formatDateForDisplay(startDate),
    dataRangeEnd: formatDateForDisplay(endDate),
    yearsOfData: YEARS_TO_FETCH
  };
  fs.writeFileSync(METADATA_FILE, JSON.stringify(metadata, null, 2));

  // Clean up progress file
  clearProgress();

  const totalTime = Math.round((Date.now() - startTime) / 1000);
  const minutes = Math.floor(totalTime / 60);
  const seconds = totalTime % 60;

  console.log('');
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║                    ✅ DOWNLOAD COMPLETE                     ║');
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
