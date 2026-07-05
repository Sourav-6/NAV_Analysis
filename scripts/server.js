#!/usr/bin/env node

/**
 * Local NAV Data API Server
 * 
 * Serves the locally-stored NAV data to the React frontend.
 * Loads scheme metadata into memory on startup for instant responses.
 * Individual scheme NAV data is read from disk on demand.
 * 
 * Endpoints:
 *   GET /api/status              → Data freshness info
 *   GET /api/schemes             → Full master scheme list
 *   GET /api/schemes/search?q=   → Search schemes by name
 *   GET /api/schemes/category/:category → Filter by category keywords
 *   GET /api/nav/:schemeCode     → Full NAV history for a scheme
 * 
 * Usage:
 *   node scripts/server.js
 */

import express from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..');
const DATA_DIR = path.join(PROJECT_ROOT, 'data');
const NAV_DIR = path.join(DATA_DIR, 'nav');
const METADATA_FILE = path.join(DATA_DIR, 'metadata.json');
const SCHEMES_FILE = path.join(DATA_DIR, 'schemes.json');

const PORT = process.env.PORT || 3001;
const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// ── Data Loading ─────────────────────────────────────────────────────────────

let masterSchemeList = [];
let metadata = {};

function loadData() {
  console.log('📂 Loading data from disk...');
  
  if (!fs.existsSync(DATA_DIR)) {
    console.error('❌ Data directory not found. Run "npm run fetch-data" first.');
    return false;
  }

  // Load master scheme list
  if (fs.existsSync(SCHEMES_FILE)) {
    masterSchemeList = JSON.parse(fs.readFileSync(SCHEMES_FILE, 'utf-8'));
    console.log(`  ✅ Loaded ${masterSchemeList.length.toLocaleString()} schemes`);
  } else {
    console.warn('  ⚠ schemes.json not found');
  }

  // Load metadata
  if (fs.existsSync(METADATA_FILE)) {
    metadata = JSON.parse(fs.readFileSync(METADATA_FILE, 'utf-8'));
    console.log(`  ✅ Data range: ${metadata.dataRangeStart} → ${metadata.dataRangeEnd}`);
    console.log(`  ✅ Last updated: ${metadata.lastUpdated}`);
  } else {
    console.warn('  ⚠ metadata.json not found');
  }

  return true;
}

// ── API Endpoints ────────────────────────────────────────────────────────────

/**
 * GET /api/status
 * Returns data freshness information
 */
app.get('/api/status', (req, res) => {
  const navFileCount = fs.existsSync(NAV_DIR) 
    ? fs.readdirSync(NAV_DIR).filter(f => f.endsWith('.json')).length 
    : 0;

  res.json({
    status: 'ok',
    source: 'local',
    metadata: {
      ...metadata,
      schemesInMemory: masterSchemeList.length,
      navFilesOnDisk: navFileCount
    }
  });
});

/**
 * GET /api/schemes
 * Returns the full master scheme list (code + name + isin only, no NAV data)
 */
app.get('/api/schemes', (req, res) => {
  // Return in the same format as mfapi.in for compatibility
  const schemes = masterSchemeList.map(s => ({
    schemeCode: parseInt(s.schemeCode),
    schemeName: s.schemeName
  }));
  res.json(schemes);
});

/**
 * GET /api/schemes/search?q=parag+parikh
 * Search schemes by name (case-insensitive partial match)
 */
app.get('/api/schemes/search', (req, res) => {
  const query = (req.query.q || '').toLowerCase().trim();
  if (!query || query.length < 2) {
    return res.json([]);
  }

  const keywords = query.split(/\s+/);
  const results = masterSchemeList
    .filter(s => {
      const name = s.schemeName.toLowerCase();
      return keywords.every(kw => name.includes(kw));
    })
    .slice(0, 50) // Limit results
    .map(s => ({
      schemeCode: parseInt(s.schemeCode),
      schemeName: s.schemeName
    }));

  res.json(results);
});

/**
 * GET /api/schemes/category/:category
 * Returns schemes matching a category (e.g., "large cap", "mid cap")
 * Filters to Direct Growth plans only (matching existing frontend behavior)
 */
app.get('/api/schemes/category/:category', (req, res) => {
  const category = req.params.category.toLowerCase();
  const keywords = category.split(/\s+/);

  const results = masterSchemeList
    .filter(s => {
      const name = s.schemeName.toLowerCase();
      
      let matchesCategory = false;
      if (category === 'sif') {
        const sifKeywords = ['special', 'sector', 'business cycle', 'pharma', 'health', 'bank', 'financial', 'infra', 'consum', 'tech', 'auto', 'manufacturing', 'psu', 'esg', 'quant', 'thematic'];
        matchesCategory = sifKeywords.some(kw => name.includes(kw));
      } else {
        matchesCategory = keywords.every(kw => name.includes(kw));
      }

      const isDirect = name.includes('direct');
      const isGrowth = name.includes('growth');
      const isIDCW = name.includes('idcw') || name.includes('dividend');
      return matchesCategory && isDirect && isGrowth && !isIDCW;
    })
    .map(s => ({
      schemeCode: parseInt(s.schemeCode),
      schemeName: s.schemeName
    }));

  res.json(results);
});

/**
 * GET /api/nav/:schemeCode
 * Returns the full NAV history for a specific scheme.
 * Response format mirrors mfapi.in: { meta: {}, data: [{date, nav}] }
 */
app.get('/api/nav/:schemeCode', (req, res) => {
  const { schemeCode } = req.params;
  const filePath = path.join(NAV_DIR, `${schemeCode}.json`);

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'Scheme not found', schemeCode });
  }

  try {
    const schemeData = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    
    // Return in mfapi.in compatible format
    res.json({
      meta: {
        fund_house: '',
        scheme_type: '',
        scheme_category: '',
        scheme_code: parseInt(schemeCode),
        scheme_name: schemeData.schemeName,
        isin: schemeData.isin
      },
      data: schemeData.navData.map(entry => ({
        date: convertDateFormat(entry.date),
        nav: entry.nav
      })),
      status: 'SUCCESS'
    });
  } catch (err) {
    console.error(`Error reading NAV for ${schemeCode}:`, err.message);
    res.status(500).json({ error: 'Failed to read scheme data' });
  }
});

/**
 * GET /api/nav/:schemeCode/summary
 * Returns summary statistics without full NAV history (lighter response)
 */
app.get('/api/nav/:schemeCode/summary', (req, res) => {
  const { schemeCode } = req.params;
  const filePath = path.join(NAV_DIR, `${schemeCode}.json`);

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'Scheme not found' });
  }

  try {
    const schemeData = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    const navData = schemeData.navData;
    
    res.json({
      schemeCode: parseInt(schemeCode),
      schemeName: schemeData.schemeName,
      totalDataPoints: navData.length,
      latestNav: navData[0] || null,
      oldestNav: navData[navData.length - 1] || null
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to read scheme data' });
  }
});

/**
 * Converts date from DD-Mon-YYYY (AMFI format) to DD-MM-YYYY (mfapi.in format)
 */
function convertDateFormat(dateStr) {
  const months = { 'Jan': '01', 'Feb': '02', 'Mar': '03', 'Apr': '04', 'May': '05', 'Jun': '06', 'Jul': '07', 'Aug': '08', 'Sep': '09', 'Oct': '10', 'Nov': '11', 'Dec': '12' };
  const parts = dateStr.split('-');
  if (parts.length === 3 && months[parts[1]]) {
    return `${parts[0]}-${months[parts[1]]}-${parts[2]}`;
  }
  return dateStr; // Already in DD-MM-YYYY or unknown format
}

// ── Start Server ─────────────────────────────────────────────────────────────

const hasData = loadData();

app.listen(PORT, () => {
  console.log('');
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║         NAV Data Server Running                             ║');
  console.log('╠══════════════════════════════════════════════════════════════╣');
  console.log(`║  URL:    http://localhost:${PORT}                              ║`);
  console.log(`║  Schemes: ${String(masterSchemeList.length.toLocaleString()).padEnd(48)}║`);
  console.log('╠══════════════════════════════════════════════════════════════╣');
  console.log('║  Endpoints:                                                ║');
  console.log('║    GET /api/status                 → Data freshness        ║');
  console.log('║    GET /api/schemes                → All schemes           ║');
  console.log('║    GET /api/schemes/search?q=...   → Search schemes        ║');
  console.log('║    GET /api/schemes/category/:cat  → Filter by category    ║');
  console.log('║    GET /api/nav/:code              → NAV history           ║');
  console.log('║    GET /api/nav/:code/summary      → Quick summary         ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  
  if (!hasData) {
    console.log('');
    console.warn('⚠ No data found! Run "npm run fetch-data" to download NAV data.');
  }
  console.log('');
});
