#!/usr/bin/env node

/**
 * AMFI SIF NAV Fetcher
 * 
 * SIFs (Specialized Investment Funds) use a separate day-by-day JSON API.
 * This script iterates through dates from a recent start date to today,
 * pulls SIF data, maps string IDs (e.g. SIF-120) to numerical ones (e.g. 990120),
 * and merges the data seamlessly into the main data/nav JSON store.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import https from 'https';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..');
const DATA_DIR = path.join(PROJECT_ROOT, 'data');
const NAV_DIR = path.join(DATA_DIR, 'nav');
const METADATA_FILE = path.join(DATA_DIR, 'metadata.json');
const SCHEMES_FILE = path.join(DATA_DIR, 'schemes.json');
const SIF_PROGRESS_FILE = path.join(DATA_DIR, '.sif-progress.json');

const SIF_API_URL = 'https://www.amfiindia.com/api/sif-nav-history?query_type=all_for_date&from_date=';
const DELAY_MS = 500; // Small delay to avoid API rate limiting
const DEFAULT_START_DATE = '2024-01-01'; // SIFs are recent, start from 2024 by default

const isUpdate = process.argv.includes('--update');

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function formatDateForAPI(date) {
  return date.toISOString().slice(0, 10);
}

function formatDateForDisplay(date) {
  return date.toISOString().slice(0, 10);
}

function convertDateToAMFIFormat(isoDateStr) {
  // Convert "2026-07-01T00:00:00.000Z" to "01-Jul-2026"
  const d = new Date(isoDateStr);
  if (isNaN(d)) return null;
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const mmm = months[d.getUTCMonth()];
  const yyyy = d.getUTCFullYear();
  return `${dd}-${mmm}-${yyyy}`;
}

function parseDateString(dateStr) {
  // Parses "03-Jul-2026" into a Date object
  const months = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };
  const parts = dateStr.split('-');
  if (parts.length !== 3) return new Date(0);
  const dd = parseInt(parts[0], 10);
  const mmm = months[parts[1]];
  const yyyy = parseInt(parts[2], 10);
  return new Date(yyyy, mmm, dd);
}

function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    https.get(url, {
      headers: {
        'User-Agent': 'NAVAnalysis/1.0 (Educational Research)',
        'Accept': 'application/json'
      },
      timeout: 30000
    }, (res) => {
      if (res.statusCode !== 200) {
        return reject(new Error(`HTTP ${res.statusCode}`));
      }
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
      res.on('error', reject);
    }).on('error', reject);
  });
}

function mapSifIdToCode(sifId) {
  // e.g., "SIF-120" -> 990120
  const match = sifId.match(/\d+/);
  if (match) {
    return parseInt(`990${match[0]}`, 10);
  }
  return null;
}

async function main() {
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║           AMFI SIF NAV Data Fetcher v1.0                    ║');
  console.log('╠══════════════════════════════════════════════════════════════╣');
  console.log(`║  Mode: ${isUpdate ? 'INCREMENTAL UPDATE' : 'FULL DOWNLOAD (from 2024)'}                          ║`);
  console.log('╚══════════════════════════════════════════════════════════════╝');
  console.log('');

  if (!fs.existsSync(NAV_DIR)) fs.mkdirSync(NAV_DIR, { recursive: true });

  const endDate = new Date();
  let startDate;

  if (isUpdate && fs.existsSync(SIF_PROGRESS_FILE)) {
    const progress = JSON.parse(fs.readFileSync(SIF_PROGRESS_FILE, 'utf-8'));
    startDate = new Date(progress.lastSifDate);
    startDate.setDate(startDate.getDate() + 1);
  } else {
    startDate = new Date(DEFAULT_START_DATE);
  }

  if (startDate >= endDate) {
    console.log('✅ SIF Data is already up to date!');
    return;
  }

  console.log(`📅 Fetching SIF data from ${formatDateForDisplay(startDate)} to ${formatDateForDisplay(endDate)}`);
  console.log(`⏱  API calls are rate-limited to 1 request per ${DELAY_MS}ms`);
  console.log('');

  let currentDate = new Date(startDate);
  const schemeMap = new Map();
  let totalDataPoints = 0;
  let successfulDays = 0;
  const maxDays = Math.ceil((endDate - startDate) / (1000 * 60 * 60 * 24));
  let currentDay = 0;

  while (currentDate <= endDate) {
    currentDay++;
    const dateStr = formatDateForAPI(currentDate);
    process.stdout.write(`  [${currentDay}/${maxDays}] 📥 Fetching ${dateStr}... `);

    try {
      const rawData = await fetchUrl(SIF_API_URL + dateStr);
      const json = JSON.parse(rawData);
      
      let dailyPoints = 0;

      if (json && Array.isArray(json.data)) {
        json.data.forEach(fundHouse => {
          fundHouse.schemes.forEach(scheme => {
            scheme.navs.forEach(navEntry => {
              const schemeCode = mapSifIdToCode(navEntry.SD_ID);
              if (!schemeCode) return;

              const amfiDate = convertDateToAMFIFormat(navEntry.hNAV_Date);
              if (!amfiDate) return;

              const navVal = parseFloat(navEntry.hNAV_Amt);
              if (isNaN(navVal)) return;

              if (!schemeMap.has(schemeCode)) {
                schemeMap.set(schemeCode, {
                  schemeCode,
                  schemeName: navEntry.NAV_Name,
                  isin: navEntry.ISIN_PO || navEntry.ISIN_RI || '',
                  schemeCategory: 'Specialized Investment Fund (SIF)',
                  navEntries: []
                });
              }

              schemeMap.get(schemeCode).navEntries.push({
                date: amfiDate,
                nav: navVal
              });

              dailyPoints++;
              totalDataPoints++;
            });
          });
        });
      }

      console.log(`✅ ${dailyPoints} records`);
      successfulDays++;
    } catch (e) {
      console.log(`❌ Failed: ${e.message}`);
    }

    currentDate.setDate(currentDate.getDate() + 1);
    await sleep(DELAY_MS);
  }

  console.log('');
  if (totalDataPoints > 0) {
    console.log(`💾 Merging ${totalDataPoints} SIF data points into local JSON store...`);
    
    let newSchemes = 0;
    let updatedSchemes = 0;
    const allSchemes = fs.existsSync(SCHEMES_FILE) ? JSON.parse(fs.readFileSync(SCHEMES_FILE, 'utf-8')) : [];
    const knownCodes = new Set(allSchemes.map(s => s.schemeCode));

    for (const [schemeCode, data] of schemeMap) {
      const filePath = path.join(NAV_DIR, `${schemeCode}.json`);
      let existing = null;

      if (fs.existsSync(filePath)) {
        try { existing = JSON.parse(fs.readFileSync(filePath, 'utf-8')); } catch (e) {}
      }

      if (existing) {
        const existingDates = new Set(existing.navData.map(e => e.date));
        const newEntries = data.navEntries.filter(e => !existingDates.has(e.date));
        
        if (newEntries.length > 0) {
          existing.navData = [...existing.navData, ...newEntries];
          existing.navData.sort((a, b) => parseDateString(b.date) - parseDateString(a.date));
          fs.writeFileSync(filePath, JSON.stringify(existing));
          updatedSchemes++;
        }
      } else {
        data.navEntries.sort((a, b) => parseDateString(b.date) - parseDateString(a.date));
        fs.writeFileSync(filePath, JSON.stringify({
          schemeCode: data.schemeCode,
          schemeName: data.schemeName,
          isin: data.isin,
          schemeCategory: data.schemeCategory,
          navData: data.navEntries
        }));
        newSchemes++;
      }

      if (!knownCodes.has(schemeCode)) {
        allSchemes.push({
          schemeCode: data.schemeCode,
          schemeName: data.schemeName,
          isin: data.isin,
          schemeCategory: data.schemeCategory
        });
        knownCodes.add(schemeCode);
      }
    }

    // Save updated master schemes list
    fs.writeFileSync(SCHEMES_FILE, JSON.stringify(allSchemes, null, 2));
    console.log(`  Done (${newSchemes} new SIFs, ${updatedSchemes} updated SIFs)`);

    // Update metadata using recalculation script for safety
    console.log('  Recalculating global metadata...');
    const { execSync } = await import('child_process');
    try {
      execSync('node scripts/recalculate-metadata.js', { stdio: 'ignore' });
      console.log('  Metadata updated successfully.');
    } catch (e) {
      console.log('  Failed to run recalculate-metadata.js automatically. Run it manually.');
    }
  }

  // Save SIF progress
  fs.writeFileSync(SIF_PROGRESS_FILE, JSON.stringify({
    lastSifDate: formatDateForAPI(endDate),
    lastUpdated: new Date().toISOString()
  }, null, 2));

  console.log('');
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║                 ✅ SIF DOWNLOAD COMPLETE                    ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
}

main().catch(console.error);
