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
import { exec } from 'child_process';
import Database from 'better-sqlite3';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..');
const DATA_DIR = path.join(PROJECT_ROOT, 'data');
const DB_PATH = path.join(DATA_DIR, 'database.sqlite');

const PORT = process.env.PORT || 3001;
const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// ── Data Loading ─────────────────────────────────────────────────────────────

let db;
let hasData = false;

function loadData() {
  console.log('📂 Connecting to SQLite database...');
  
  if (!fs.existsSync(DB_PATH)) {
    console.error('❌ Database not found. Run "npm run fetch-data" or migrate script first.');
    return false;
  }

  try {
    db = new Database(DB_PATH);
    
    // Ensure metadata table exists
    db.exec('CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT)');
    
    // Seed default ranking config if not present
    const existing = db.prepare("SELECT value FROM metadata WHERE key = 'ranking_config'").get();
    if (!existing) {
      const defaultConfig = {
        weight_rrls_avg_return: 0.25,
        weight_rrls_recent_return: 0.10,
        weight_sortino: 0.35,
        weight_mdd: 0.15,
        weight_ulcer: 0.15,
        risk_free_rate: 0.06
      };
      db.prepare("INSERT INTO metadata (key, value) VALUES ('ranking_config', ?)").run(JSON.stringify(defaultConfig));
      console.log('  ⚙️ Default ranking config seeded in database.');
    }

    const schemeCount = db.prepare('SELECT COUNT(*) as count FROM schemes').get().count;
    console.log(`  ✅ Connected. Database contains ${schemeCount.toLocaleString()} schemes.`);
    hasData = true;
    return true;
  } catch (err) {
    console.error('❌ Failed to open database:', err.message);
    return false;
  }
}

let isUpdating = false;

// ── API Endpoints ────────────────────────────────────────────────────────────

/**
 * GET /api/status
 * Returns data freshness information
 */
app.get('/api/status', (req, res) => {
  if (!db) return res.status(500).json({ error: 'Database not initialized' });

  const globalMeta = db.prepare("SELECT value FROM metadata WHERE key = 'global_metadata'").get();
  const metadata = globalMeta ? JSON.parse(globalMeta.value) : {};
  
  const schemesCount = db.prepare('SELECT COUNT(*) as c FROM schemes').get().c;
  
  const dataPoints = metadata.totalDataPoints || 0;

  res.json({
    status: 'ok',
    source: 'sqlite',
    isUpdating,
    metadata: {
      ...metadata,
      schemesInMemory: schemesCount,
      totalDataPoints: dataPoints
    }
  });
});

/**
 * GET /api/schemes
 * Returns the full master scheme list (code + name + isin only, no NAV data)
 */
app.get('/api/schemes', (req, res) => {
  if (!db) return res.json([]);
  const schemes = db.prepare('SELECT schemeCode, schemeName FROM schemes').all();
  res.json(schemes);
});

/**
 * GET /api/schemes/search?q=parag+parikh
 * Search schemes by name (case-insensitive partial match)
 */
app.get('/api/schemes/search', (req, res) => {
  const query = (req.query.q || '').toLowerCase().trim();
  if (!query || query.length < 2 || !db) {
    return res.json([]);
  }

  const keywords = query.split(/\s+/);
  
  // We can build a dynamic LIKE query
  let sql = 'SELECT schemeCode, schemeName FROM schemes WHERE 1=1';
  const params = [];
  
  for (const kw of keywords) {
    sql += ' AND LOWER(schemeName) LIKE ?';
    params.push(`%${kw}%`);
  }
  
  sql += ' LIMIT 50';
  
  const results = db.prepare(sql).all(params);
  res.json(results);
});

/**
 * GET /api/schemes/category/:category
 * Returns schemes matching a category (e.g., "large cap", "mid cap")
 * Filters to Direct Growth plans only (matching existing frontend behavior)
 */
app.post('/api/data/update', (req, res) => {
  if (isUpdating) {
    return res.status(400).json({ error: 'Update already in progress' });
  }
  isUpdating = true;
  
  exec('npm run update-data && npm run update-sif', { cwd: PROJECT_ROOT }, (error, stdout, stderr) => {
    isUpdating = false;
    if (error) {
      console.error('Update failed:', error);
    } else {
      console.log('Update finished successfully. Reloading memory...');
      loadData();
    }
  });
  
  res.json({ status: 'started' });
});

app.get('/api/schemes/category/:category', (req, res) => {
  if (!db) return res.json([]);
  
  const category = req.params.category.toLowerCase();
  const plan = (req.query.plan || 'direct').toLowerCase();
  const keywords = category.split(/\s+/);

  let sql = "SELECT schemeCode, schemeName FROM schemes WHERE LOWER(schemeName) LIKE '%growth%' AND LOWER(schemeName) NOT LIKE '%idcw%' AND LOWER(schemeName) NOT LIKE '%dividend%'";
  
  if (plan === 'direct') {
    sql += " AND LOWER(schemeName) LIKE '%direct%'";
  } else {
    // Regular plan logic
    sql += " AND (LOWER(schemeName) NOT LIKE '%direct%' OR LOWER(schemeName) LIKE '%regular%')";
  }

  if (category === 'sif') {
    sql += " AND LOWER(schemeCategory) LIKE '%specialized investment fund%'";
  } else if (category === 'large cap') {
    sql += " AND LOWER(schemeCategory) LIKE '%large%' AND LOWER(schemeCategory) LIKE '%cap%' AND LOWER(schemeCategory) NOT LIKE '%mid%'";
  } else if (category === 'mid cap') {
    sql += " AND LOWER(schemeCategory) LIKE '%mid%' AND LOWER(schemeCategory) LIKE '%cap%' AND LOWER(schemeCategory) NOT LIKE '%large%'";
  } else {
    for (const kw of keywords) {
      sql += ` AND LOWER(schemeCategory) LIKE '%${kw.replace(/'/g, "''")}%'`;
    }
  }

  const results = db.prepare(sql).all();
  res.json(results);
});

/**
 * GET /api/nav/:schemeCode
 * Returns the full NAV history for a specific scheme.
 * Response format: { meta: {}, data: [{date, nav}] }
 */
app.get('/api/nav/:schemeCode', (req, res) => {
  if (!db) return res.status(500).json({ error: 'Database not ready' });
  const schemeCode = parseInt(req.params.schemeCode);

  const schemeMeta = db.prepare('SELECT * FROM schemes WHERE schemeCode = ?').get(schemeCode);
  if (!schemeMeta) {
    return res.status(404).json({ error: 'Scheme not found', schemeCode });
  }

  try {
    const navHistory = db.prepare('SELECT date, nav FROM nav_history WHERE schemeCode = ?').all(schemeCode);
    
    // Sort in memory since SQLite dates are in DD-Mon-YYYY format and don't sort alphabetically
    const months = { 'Jan': '01', 'Feb': '02', 'Mar': '03', 'Apr': '04', 'May': '05', 'Jun': '06', 'Jul': '07', 'Aug': '08', 'Sep': '09', 'Oct': '10', 'Nov': '11', 'Dec': '12' };
    
    navHistory.sort((a, b) => {
      const partsA = a.date.split('-');
      const partsB = b.date.split('-');
      const dateA = new Date(`${partsA[2]}-${months[partsA[1]]}-${partsA[0]}`);
      const dateB = new Date(`${partsB[2]}-${months[partsB[1]]}-${partsB[0]}`);
      return dateB.getTime() - dateA.getTime();
    });
    res.json({
      meta: {
        fund_house: '',
        scheme_type: '',
        scheme_category: schemeMeta.schemeCategory || '',
        scheme_code: schemeCode,
        scheme_name: schemeMeta.schemeName,
        isin: schemeMeta.isin || ''
      },
      data: navHistory.map(entry => ({
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
  if (!db) return res.status(500).json({ error: 'Database not ready' });
  const schemeCode = parseInt(req.params.schemeCode);

  const schemeMeta = db.prepare('SELECT * FROM schemes WHERE schemeCode = ?').get(schemeCode);
  if (!schemeMeta) {
    return res.status(404).json({ error: 'Scheme not found' });
  }

  try {
    const navHistory = db.prepare('SELECT date, nav FROM nav_history WHERE schemeCode = ?').all(schemeCode);
    
    // Sort in memory
    const months = { 'Jan': '01', 'Feb': '02', 'Mar': '03', 'Apr': '04', 'May': '05', 'Jun': '06', 'Jul': '07', 'Aug': '08', 'Sep': '09', 'Oct': '10', 'Nov': '11', 'Dec': '12' };
    navHistory.sort((a, b) => {
      const partsA = a.date.split('-');
      const partsB = b.date.split('-');
      const dateA = new Date(`${partsA[2]}-${months[partsA[1]]}-${partsA[0]}`);
      const dateB = new Date(`${partsB[2]}-${months[partsB[1]]}-${partsB[0]}`);
      return dateB.getTime() - dateA.getTime();
    });

    const latest = navHistory.length > 0 ? navHistory[0] : null;
    const oldest = navHistory.length > 0 ? navHistory[navHistory.length - 1] : null;

    let maxNav = -Infinity;
    let minNav = Infinity;
    navHistory.forEach(entry => {
      if (entry.nav > maxNav) maxNav = entry.nav;
      if (entry.nav < minNav) minNav = entry.nav;
    });

    res.json({
      schemeCode: schemeCode,
      schemeName: schemeMeta.schemeName,
      totalDataPoints: navHistory.length,
      latestNav: latest,
      oldestNav: oldest,
      maxNav: maxNav === -Infinity ? null : maxNav,
      minNav: minNav === Infinity ? null : minNav
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to read scheme data' });
  }
});

// ── Fund Ranking Engine Endpoints ───────────────────────────────────────────

/**
 * GET /api/ranking/config
 * Returns the current weights and risk-free rate for the selection algorithm
 */
app.get('/api/ranking/config', (req, res) => {
  if (!db) return res.status(500).json({ error: 'Database not ready' });
  try {
    const row = db.prepare("SELECT value FROM metadata WHERE key = 'ranking_config'").get();
    if (row) {
      res.json(JSON.parse(row.value));
    } else {
      res.status(404).json({ error: 'Ranking config not found' });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/ranking/config
 * Updates the weights and risk-free rate in the database
 */
app.post('/api/ranking/config', (req, res) => {
  if (!db) return res.status(500).json({ error: 'Database not ready' });
  const {
    weight_rrls_avg_return,
    weight_rrls_recent_return,
    weight_sortino,
    weight_mdd,
    weight_ulcer,
    risk_free_rate
  } = req.body;

  try {
    const newConfig = {
      weight_rrls_avg_return: parseFloat(weight_rrls_avg_return),
      weight_rrls_recent_return: parseFloat(weight_rrls_recent_return),
      weight_sortino: parseFloat(weight_sortino),
      weight_mdd: parseFloat(weight_mdd),
      weight_ulcer: parseFloat(weight_ulcer),
      risk_free_rate: parseFloat(risk_free_rate)
    };

    db.prepare("INSERT OR REPLACE INTO metadata (key, value) VALUES ('ranking_config', ?)").run(JSON.stringify(newConfig));
    res.json({ status: 'success', config: newConfig });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/ranking/calculate
 * Runs the mutual fund selection algorithm inside a category
 */
app.post('/api/ranking/calculate', (req, res) => {
  if (!db) return res.status(500).json({ error: 'Database not ready' });

  const category = (req.body.category || '').toLowerCase();
  const plan = (req.body.plan || 'direct').toLowerCase();
  const analysisPeriod = req.body.analysisPeriod || '3Y'; // '1Y', '3Y', '5Y', '10Y'
  const rollingWindow = req.body.rollingWindow || '1Y'; // '1M', '3M', '1Y', '3Y'

  try {
    // 1. Fetch config from database
    const configRow = db.prepare("SELECT value FROM metadata WHERE key = 'ranking_config'").get();
    const config = configRow ? JSON.parse(configRow.value) : {
      weight_rrls_avg_return: 0.25,
      weight_rrls_recent_return: 0.10,
      weight_sortino: 0.35,
      weight_mdd: 0.15,
      weight_ulcer: 0.15,
      risk_free_rate: 0.06
    };

    // Allow request to override config dynamically
    const w_rrls_avg = req.body.config?.weight_rrls_avg_return !== undefined ? parseFloat(req.body.config.weight_rrls_avg_return) : config.weight_rrls_avg_return;
    const w_rrls_recent = req.body.config?.weight_rrls_recent_return !== undefined ? parseFloat(req.body.config.weight_rrls_recent_return) : config.weight_rrls_recent_return;
    const w_sortino = req.body.config?.weight_sortino !== undefined ? parseFloat(req.body.config.weight_sortino) : config.weight_sortino;
    const w_mdd = req.body.config?.weight_mdd !== undefined ? parseFloat(req.body.config.weight_mdd) : config.weight_mdd;
    const w_ulcer = req.body.config?.weight_ulcer !== undefined ? parseFloat(req.body.config.weight_ulcer) : config.weight_ulcer;
    const rfr = req.body.config?.risk_free_rate !== undefined ? parseFloat(req.body.config.risk_free_rate) : config.risk_free_rate;

    // 2. Query schemes in this category & plan
    const keywords = category.split(/\s+/);
    let categorySql = "SELECT schemeCode, schemeName, schemeCategory FROM schemes WHERE LOWER(schemeName) LIKE '%growth%' AND LOWER(schemeName) NOT LIKE '%idcw%' AND LOWER(schemeName) NOT LIKE '%dividend%'";
    
    if (plan === 'direct') {
      categorySql += " AND LOWER(schemeName) LIKE '%direct%'";
    } else {
      categorySql += " AND (LOWER(schemeName) NOT LIKE '%direct%' OR LOWER(schemeName) LIKE '%regular%')";
    }

    if (category === 'sif') {
      categorySql += " AND LOWER(schemeCategory) LIKE '%specialized investment fund%'";
    } else if (category === 'large cap') {
      categorySql += " AND LOWER(schemeCategory) LIKE '%large%' AND LOWER(schemeCategory) LIKE '%cap%' AND LOWER(schemeCategory) NOT LIKE '%mid%'";
    } else if (category === 'mid cap') {
      categorySql += " AND LOWER(schemeCategory) LIKE '%mid%' AND LOWER(schemeCategory) LIKE '%cap%' AND LOWER(schemeCategory) NOT LIKE '%large%'";
    } else {
      for (const kw of keywords) {
        categorySql += ` AND LOWER(schemeCategory) LIKE '%${kw.replace(/'/g, "''")}%'`;
      }
    }

    const schemesList = db.prepare(categorySql).all();
    if (schemesList.length === 0) {
      return res.json([]);
    }

    // 3. Fetch full NAV histories for each scheme and parse dates
    const months = { 'Jan': 0, 'Feb': 1, 'Mar': 2, 'Apr': 3, 'May': 4, 'Jun': 5, 'Jul': 6, 'Aug': 7, 'Sep': 8, 'Oct': 9, 'Nov': 10, 'Dec': 11 };
    const parsedSchemes = [];
    let absoluteLatestTime = 0;

    for (const s of schemesList) {
      const history = db.prepare('SELECT date, nav FROM nav_history WHERE schemeCode = ?').all(s.schemeCode);
      if (history.length < 10) continue; // Skip schemes with virtually no data

      // Map and sort ascending
      const historyParsed = history.map(h => {
        const parts = h.date.split('-');
        const dateObj = new Date(parseInt(parts[2]), months[parts[1]], parseInt(parts[0]));
        return {
          dateStr: h.date,
          dateObj,
          time: dateObj.getTime(),
          nav: h.nav
        };
      });

      historyParsed.sort((a, b) => a.time - b.time);

      if (historyParsed.length > 0) {
        const latestTime = historyParsed[historyParsed.length - 1].time;
        if (latestTime > absoluteLatestTime) absoluteLatestTime = latestTime;
      }

      parsedSchemes.push({
        schemeCode: s.schemeCode,
        schemeName: s.schemeName,
        schemeCategory: s.schemeCategory,
        history: historyParsed
      });
    }

    if (parsedSchemes.length === 0 || absoluteLatestTime === 0) {
      return res.json([]);
    }

    // 4. Filter for complete history
    const endYears = parseInt(analysisPeriod);
    const T_end = new Date(absoluteLatestTime);
    const T_start = new Date(T_end);
    T_start.setFullYear(T_start.getFullYear() - endYears);
    const T_start_time = T_start.getTime();

    // 10-day buffer to account for holidays/weekend offsets at start
    const startCutoff = T_start_time + 10 * 24 * 60 * 60 * 1000;

    const validSchemes = parsedSchemes.filter(s => {
      return s.history[0].time <= startCutoff;
    });

    if (validSchemes.length === 0) {
      return res.json([]);
    }

    // 5. Generate sliding windows
    // Slide by weekly intervals (5 trading days) to keep execution under 100ms
    // while maintaining near-perfect ranking integrity.
    
    // Extract unique trading dates from all schemes in range
    const allDatesMap = new Map();
    validSchemes.forEach(s => {
      s.history.forEach(h => {
        if (h.time >= T_start_time && h.time <= absoluteLatestTime) {
          allDatesMap.set(h.time, h.dateObj);
        }
      });
    });

    const sortedTimes = Array.from(allDatesMap.keys()).sort((a, b) => a - b);
    const windows = [];

    for (let i = 0; i < sortedTimes.length; i += 5) {
      const windowStart = new Date(sortedTimes[i]);
      const windowEnd = new Date(windowStart);

      // Parse rolling window
      const val = parseInt(rollingWindow);
      if (rollingWindow.endsWith('M')) {
        windowEnd.setMonth(windowEnd.getMonth() + val);
      } else if (rollingWindow.endsWith('Y')) {
        windowEnd.setFullYear(windowEnd.getFullYear() + val);
      }

      if (windowEnd.getTime() > absoluteLatestTime) break;
      windows.push({ start: windowStart, end: windowEnd });
    }

    if (windows.length === 0) {
      return res.json([]);
    }

    // 6. Calculate raw metrics for each scheme per window
    const windowResults = windows.map(() => []);

    validSchemes.forEach(s => {
      // Create a fast pointer to slide along windows
      let startIdx = 0;
      let endIdx = 0;

      windows.forEach((win, wIdx) => {
        const startTime = win.start.getTime();
        const endTime = win.end.getTime();

        // Advance startIdx to window start
        while (startIdx < s.history.length && s.history[startIdx].time < startTime) {
          startIdx++;
        }

        // Advance endIdx to window end
        if (endIdx < startIdx) endIdx = startIdx;
        while (endIdx < s.history.length && s.history[endIdx].time <= endTime) {
          endIdx++;
        }

        // The window points are s.history[startIdx ... (endIdx - 1)]
        const len = endIdx - startIdx;
        if (len < 10) return; // Skip if less than 10 data points in window

        const firstNav = s.history[startIdx].nav;
        const lastNav = s.history[endIdx - 1].nav;
        const retVal = (lastNav / firstNav) - 1;

        // Downside deviation & MDD / UI
        let peak = -Infinity;
        let maxDD = 0;
        let sumSqDD = 0;
        let sumSqNeg = 0;

        for (let k = startIdx; k < endIdx; k++) {
          const nav = s.history[k].nav;
          if (nav > peak) peak = nav;
          const dd = (nav - peak) / peak;
          if (dd < maxDD) maxDD = dd;
          sumSqDD += dd * dd;

          if (k > startIdx) {
            const r = (nav / s.history[k - 1].nav) - 1;
            if (r < 0) sumSqNeg += r * r;
          }
        }

        const downsideDevDaily = Math.sqrt(sumSqNeg / (len - 1 || 1));
        const downsideDevAnn = downsideDevDaily * Math.sqrt(250);

        // Annualized return (CAGR)
        const R_ann = (1 + retVal) ** (250 / len) - 1;

        // Sortino
        const sortino = downsideDevAnn > 0.000001 ? (R_ann - rfr) / downsideDevAnn : 0;
        const ui = Math.sqrt(sumSqDD / len);

        windowResults[wIdx].push({
          schemeCode: s.schemeCode,
          ret: retVal,
          sortino,
          mdd: maxDD,
          ui
        });
      });
    });

    // 7. Calculate Percentile Ranks for each window
    const fundWindowScores = {};
    validSchemes.forEach(s => {
      fundWindowScores[s.schemeCode] = [];
    });

    windowResults.forEach(winList => {
      const N = winList.length;
      if (N === 0) return;

      // Rank returns (descending)
      winList.sort((a, b) => b.ret - a.ret);
      const returnRanks = {};
      winList.forEach((item, idx) => {
        returnRanks[item.schemeCode] = idx + 1;
      });

      // Rank Sortino (descending)
      winList.sort((a, b) => b.sortino - a.sortino);
      const sortinoRanks = {};
      winList.forEach((item, idx) => {
        sortinoRanks[item.schemeCode] = idx + 1;
      });

      // Rank MDD (descending, since closer to 0 is better, e.g. -0.05 is better than -0.30)
      winList.sort((a, b) => b.mdd - a.mdd);
      const mddRanks = {};
      winList.forEach((item, idx) => {
        mddRanks[item.schemeCode] = idx + 1;
      });

      // Rank Ulcer Index (ascending, lower is better)
      winList.sort((a, b) => a.ui - b.ui);
      const uiRanks = {};
      winList.forEach((item, idx) => {
        uiRanks[item.schemeCode] = idx + 1;
      });

      // Map back to percentiles
      winList.forEach(item => {
        const code = item.schemeCode;
        const p_return = N > 1 ? 100 * (N - returnRanks[code]) / (N - 1) : 100;
        const p_sortino = N > 1 ? 100 * (N - sortinoRanks[code]) / (N - 1) : 100;
        const p_mdd = N > 1 ? 100 * (N - mddRanks[code]) / (N - 1) : 100;
        const p_ulcer = N > 1 ? 100 * (N - uiRanks[code]) / (N - 1) : 100;

        fundWindowScores[code].push({
          p_return,
          p_sortino,
          p_mdd,
          p_ulcer
        });
      });
    });

    // 8. Aggregate percentiles for each fund
    const rankedFunds = validSchemes.map(s => {
      const scores = fundWindowScores[s.schemeCode];
      if (scores.length === 0) {
        return {
          schemeCode: s.schemeCode,
          schemeName: s.schemeName,
          overallScore: 0,
          dailyLeadership: 0,
          recentLeadership: 0,
          sortinoScore: 0,
          mddScore: 0,
          ulcerScore: 0
        };
      }

      let sumReturn = 0;
      let sumSortino = 0;
      let sumMdd = 0;
      let sumUlcer = 0;

      scores.forEach(sc => {
        sumReturn += sc.p_return;
        sumSortino += sc.p_sortino;
        sumMdd += sc.p_mdd;
        sumUlcer += sc.p_ulcer;
      });

      const totalWindows = scores.length;
      const dailyLeadership = sumReturn / totalWindows;
      const sortinoScore = sumSortino / totalWindows;
      const mddScore = sumMdd / totalWindows;
      const ulcerScore = sumUlcer / totalWindows;

      // Recent leadership (latest 20% of windows)
      const recentCount = Math.max(1, Math.round(totalWindows * 0.2));
      let sumRecentReturn = 0;
      for (let i = totalWindows - recentCount; i < totalWindows; i++) {
        sumRecentReturn += scores[i].p_return;
      }
      const recentLeadership = sumRecentReturn / recentCount;

      // Weighted overall score
      const overallScore = (
        w_rrls_avg * dailyLeadership +
        w_rrls_recent * recentLeadership +
        w_sortino * sortinoScore +
        w_mdd * mddScore +
        w_ulcer * ulcerScore
      );

      return {
        schemeCode: s.schemeCode,
        schemeName: s.schemeName,
        overallScore: parseFloat(overallScore.toFixed(2)),
        dailyLeadership: parseFloat(dailyLeadership.toFixed(2)),
        recentLeadership: parseFloat(recentLeadership.toFixed(2)),
        sortinoScore: parseFloat(sortinoScore.toFixed(2)),
        mddScore: parseFloat(mddScore.toFixed(2)),
        ulcerScore: parseFloat(ulcerScore.toFixed(2))
      };
    });

    // Sort by overall score descending
    rankedFunds.sort((a, b) => b.overallScore - a.overallScore);

    res.json(rankedFunds);
  } catch (err) {
    console.error('Error calculating fund rankings:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * Converts date from DD-Mon-YYYY (AMFI format) to DD-MM-YYYY (Frontend format)
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

const isDataLoaded = loadData();

app.listen(PORT, () => {
  console.log('');
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║         NAV Data Server Running                             ║');
  console.log('╠══════════════════════════════════════════════════════════════╣');
  console.log(`║  URL:    http://localhost:${PORT}                              ║`);
  const schemesCount = db ? db.prepare('SELECT COUNT(*) as c FROM schemes').get().c : 0;
  console.log(`║  Schemes: ${String(schemesCount.toLocaleString()).padEnd(48)}║`);
  console.log('╠══════════════════════════════════════════════════════════════╣');
  console.log('║  Endpoints:                                                ║');
  console.log('║    GET /api/status                 → Data freshness        ║');
  console.log('║    GET /api/schemes                → All schemes           ║');
  console.log('║    GET /api/schemes/search?q=...   → Search schemes        ║');
  console.log('║    GET /api/schemes/category/:cat  → Filter by category    ║');
  console.log('║    GET /api/nav/:code              → NAV history           ║');
  console.log('║    GET /api/nav/:code/summary      → Quick summary         ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  
  if (!isDataLoaded) {
    console.log('');
    console.warn('⚠ No data found! Run "npm run fetch-data" to download NAV data.');
  }
  console.log('');
  console.log('');
});

// Keep process alive just in case
setInterval(() => {}, 1000 * 60 * 60);
