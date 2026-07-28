const db = require('better-sqlite3')('data/database.sqlite');
const fs = require('fs');
const serverJs = fs.readFileSync('./scripts/server.js', 'utf8');

// We will use regex to extract resolveWeights, fetchAndParseHistories, and computeRankings
const extractFunc = (name, code) => {
  const regex = new RegExp(`function ${name}[\\s\\S]*?\\n}`);
  const match = code.match(regex);
  if (!match) return null;
  let funcBody = match[0];
  // naive extraction, might need balance braces, let's just eval the whole script carefully or use a known ending
};

// Instead of extracting, let's just write exactly the logic that fetches data and traces the lengths.
const fetchAndParseHistories = (schemesList, referenceDate) => {
  const months = { 'Jan': 0, 'Feb': 1, 'Mar': 2, 'Apr': 3, 'May': 4, 'Jun': 5, 'Jul': 6, 'Aug': 7, 'Sep': 8, 'Oct': 9, 'Nov': 10, 'Dec': 11 };
  const parsedSchemes = [];
  const refTime = referenceDate ? new Date(referenceDate).getTime() : Infinity;

  for (const s of schemesList) {
    const history = db.prepare('SELECT date, nav FROM nav_history WHERE schemeCode = ?').all(s.schemeCode);
    if (history.length < 10) continue;

    const historyParsed = history.map(h => {
      const parts = h.date.split('-');
      const dateObj = new Date(parseInt(parts[2]), months[parts[1]], parseInt(parts[0]));
      return { dateStr: h.date, dateObj, time: dateObj.getTime(), nav: h.nav };
    }).filter(h => h.time <= refTime);

    if (historyParsed.length < 10) continue;
    historyParsed.sort((a, b) => a.time - b.time);
    parsedSchemes.push({ schemeCode: s.schemeCode, schemeName: s.schemeName, history: historyParsed });
  }
  return parsedSchemes;
};

const trace = (categories) => {
  let categorySql = "SELECT schemeCode, schemeName, schemeCategory FROM schemes WHERE LOWER(schemeName) LIKE '%growth%' AND LOWER(schemeName) NOT LIKE '%idcw%' AND LOWER(schemeName) NOT LIKE '%dividend%' AND LOWER(schemeName) NOT LIKE '%institutional%' AND (LOWER(schemeName) NOT LIKE '%direct%' OR LOWER(schemeName) LIKE '%regular%')";
  
  if (categories.length > 0) {
      const catConditions = categories.map(cat => {
        const c = cat.toLowerCase();
        if (c === 'sif') return "LOWER(schemeCategory) LIKE '%specialized investment fund%'";
        const keywords = c.split(/\s+/);
        return '(' + keywords.map(kw => `LOWER(schemeCategory) LIKE '%${kw.replace(/'/g, "''")}%'`).join(' AND ') + ')';
      });
      categorySql += ` AND (${catConditions.join(' OR ')})`;
  }
  
  const schemesList = db.prepare(categorySql).all();
  console.log('Schemes List length:', schemesList.length);
  
  const parsedSchemes = fetchAndParseHistories(schemesList, null);
  console.log('Parsed Schemes length:', parsedSchemes.length);
  
  let absoluteLatestTime = 0;
  parsedSchemes.forEach(s => {
    if (s.history.length > 0) {
      const latestTime = s.history[s.history.length - 1].time;
      if (latestTime > absoluteLatestTime) absoluteLatestTime = latestTime;
    }
  });
  console.log('absoluteLatestTime:', new Date(absoluteLatestTime));
  
  const endYears = 1; // 1Y
  const T_end = new Date(absoluteLatestTime);
  const T_start = new Date(T_end);
  T_start.setFullYear(T_start.getFullYear() - endYears);
  const T_start_time = T_start.getTime();
  const startCutoff = T_start_time + 10 * 24 * 60 * 60 * 1000;
  
  const validSchemes = parsedSchemes.filter(s => s.history[0].time <= startCutoff);
  console.log('Valid Schemes length:', validSchemes.length);
  
  // generated windows
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

  for (let i = 0; i < sortedTimes.length; i += 1) {
    const windowStart = new Date(sortedTimes[i]);
    const windowEnd = new Date(windowStart);
    windowEnd.setMonth(windowEnd.getMonth() + 3); // 3M

    if (windowEnd.getTime() > absoluteLatestTime) break;
    windows.push({ start: windowStart, end: windowEnd });
  }
  
  console.log('Windows length:', windows.length);
  if (windows.length > 0) {
    console.log('Last window end:', windows[windows.length-1].end);
  }
  
  let earlyExits = 0;
  const windowResults = windows.map(() => []);

  validSchemes.forEach(s => {
    let startIdx = 0;
    let endIdx = 0;

    windows.forEach((win, wIdx) => {
      const startTime = win.start.getTime();
      const endTime = win.end.getTime();

      while (startIdx < s.history.length && s.history[startIdx].time < startTime) startIdx++;
      if (endIdx < startIdx) endIdx = startIdx;
      while (endIdx < s.history.length && s.history[endIdx].time <= endTime) endIdx++;

      const len = endIdx - startIdx;
      if (len < 10) { earlyExits++; return; }

      windowResults[wIdx].push({ schemeCode: s.schemeCode });
    });
  });
  
  console.log('Early Exits (len < 10):', earlyExits);
  
  let validW = 0;
  windowResults.forEach((winList, wIdx) => {
    const N = winList.length;
    if (N === 0) return;
    validW++;
  });
  
  console.log('Valid Windows (N > 0):', validW);
}

console.log('--- Liquid Only ---');
trace(['Liquid Fund']);

console.log('--- Liquid + SIF ---');
trace(['Liquid Fund', 'SIF']);
