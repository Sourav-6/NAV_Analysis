const { parse, isBefore, isAfter, differenceInDays, subYears } = require('date-fns');

const parseDate = (dateStr) => parse(dateStr, 'dd-MM-yyyy', new Date(2000, 0, 1)); // Fixed time

const findClosestNav = (navData, targetDate) => {
  if (!navData || navData.length === 0) return null;
  for (let i = 0; i < navData.length; i++) {
    const navDate = parseDate(navData[i].date);
    if (isBefore(navDate, targetDate) || navDate.getTime() === targetDate.getTime()) {
      return navData[i];
    }
  }
  return navData[navData.length - 1];
};

const navData = [];
// Generate mock data from Jan 1 2010 to Dec 31 2024
let current = new Date(2010, 0, 1);
let nav = 100;
while (current <= new Date(2024, 11, 31)) {
  const d = String(current.getDate()).padStart(2, '0');
  const m = String(current.getMonth() + 1).padStart(2, '0');
  const y = current.getFullYear();
  navData.unshift({ date: `${d}-${m}-${y}`, nav: nav.toString() });
  nav += 0.1;
  current.setDate(current.getDate() + 1);
}

const latestDate = parseDate(navData[0].date);
const oldestDate = parseDate(navData[navData.length - 1].date);
const currentYear = latestDate.getFullYear();
const yearsToCalculate = [];
for (let y = currentYear; y >= currentYear - 14; y--) {
  yearsToCalculate.push(y);
}

const res = yearsToCalculate.map(year => {
  const endOfYearDate = new Date(year, 11, 31);
  const endOfPrevYearDate = new Date(year - 1, 11, 31);
  
  if (isAfter(oldestDate, endOfYearDate)) return { year, val: 'N/A 1' };
  
  let endNavData = findClosestNav(navData, endOfYearDate);
  let startNavData = findClosestNav(navData, endOfPrevYearDate);
  
  if (isAfter(oldestDate, endOfPrevYearDate)) {
    startNavData = navData[navData.length - 1];
  }
  
  if (!endNavData || !startNavData) return { year, val: 'N/A 2' };
  
  const endNavDateObj = parseDate(endNavData.date);
  if (endNavDateObj.getFullYear() < year) return { year, val: 'N/A 3' };
  if (endNavData.date === startNavData.date) return { year, val: 'N/A 4' };
  
  return { year, val: ((endNavData.nav - startNavData.nav) / startNavData.nav * 100).toFixed(2) };
});

console.log(res);
