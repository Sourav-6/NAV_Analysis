const Database = require('better-sqlite3');
const db = new Database('c:/Users/soura/Desktop/NAVANALYSIS/backend/data/database.sqlite');

const distinctDates = db.prepare(`
  SELECT DISTINCT nh.date 
  FROM nav_history nh
  JOIN schemes s ON nh.schemeCode = s.schemeCode
  WHERE LOWER(s.schemeCategory) NOT LIKE '%specialized%'
`).all();

const parseDateString = (dateStr) => {
  const months = { 'Jan': 0, 'Feb': 1, 'Mar': 2, 'Apr': 3, 'May': 4, 'Jun': 5, 'Jul': 6, 'Aug': 7, 'Sep': 8, 'Oct': 9, 'Nov': 10, 'Dec': 11 };
  const parts = dateStr.split('-');
  if (parts.length === 3 && months[parts[1]] !== undefined) {
    return new Date(parseInt(parts[2]), months[parts[1]], parseInt(parts[0]));
  }
  return null;
};

const sorted = distinctDates.map(d => ({ str: d.date, date: parseDateString(d.date) })).filter(x => x.date).sort((a, b) => b.date - a.date);
console.log('Latest dates after query filter:');
console.log(sorted.slice(0, 10).map(x => x.str));
