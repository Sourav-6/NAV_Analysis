const Database = require('better-sqlite3');
const db = new Database('c:/Users/soura/Desktop/NAVANALYSIS/backend/data/database.sqlite');

const history = db.prepare("SELECT date, nav FROM nav_history WHERE schemeCode = 100033").all();

const parseDateString = (dateStr) => {
  const months = { 'Jan': 0, 'Feb': 1, 'Mar': 2, 'Apr': 3, 'May': 4, 'Jun': 5, 'Jul': 6, 'Aug': 7, 'Sep': 8, 'Oct': 9, 'Nov': 10, 'Dec': 11 };
  const parts = dateStr.split('-');
  if (parts.length === 3 && months[parts[1]] !== undefined) {
    return new Date(parseInt(parts[2]), months[parts[1]], parseInt(parts[0]));
  }
  return null;
};

const sorted = history.map(h => ({ dateStr: h.date, nav: h.nav, date: parseDateString(h.date) })).filter(x => x.date).sort((a, b) => b.date - a.date);

console.log('Latest 10 dates for 100033:');
console.log(sorted.slice(0, 10).map(x => `${x.dateStr}: ${x.nav}`));
