const https = require('https');
const { parse, isBefore, isAfter } = require('date-fns');

const parseDate = (dateStr) => parse(dateStr, 'dd-MM-yyyy', new Date(2000, 0, 1));

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

https.get('https://api.mfapi.in/api/v1/122639', (res) => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    const json = JSON.parse(data);
    const navData = json.data;
    
    const latestDate = parseDate(navData[0].date);
    const oldestDate = parseDate(navData[navData.length - 1].date);
    const currentYear = latestDate.getFullYear();
    const yearsToCalculate = [];
    for (let y = currentYear; y >= currentYear - 12; y--) {
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
  });
});
