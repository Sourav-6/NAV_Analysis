const https = require('https');
const { parse, isBefore, isAfter } = require('date-fns');

const parseDate = (dateStr) => parse(dateStr, 'dd-MM-yyyy', new Date());

const calculateReturn = (currentNav, pastNav, years) => {
  const current = parseFloat(currentNav);
  const past = parseFloat(pastNav);
  if (past === 0) return 0;
  
  if (years >= 1) {
    return (Math.pow(current / past, 1 / years) - 1) * 100;
  } else {
    return ((current - past) / past) * 100;
  }
};

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

https.get('https://api.mfapi.in/mf/122639', (res) => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    const json = JSON.parse(data);
    const navData = json.data;
    
    const latestDate = parseDate(navData[0].date);
    const oldestDate = parseDate(navData[navData.length - 1].date);
    const currentYear = latestDate.getFullYear();
    const yearsToCalculate = [];
    for (let y = currentYear; y >= currentYear - 15; y--) {
      yearsToCalculate.push(y);
    }

    const res = yearsToCalculate.map(year => {
      let label = String(year);
      if (year === currentYear) label = 'YTD';

      const endOfYearDate = new Date(year, 11, 31);
      const endOfPrevYearDate = new Date(year - 1, 11, 31);

      if (isAfter(oldestDate, endOfYearDate)) {
        return { label, value: 'N/A' };
      }

      let endNavData = findClosestNav(navData, endOfYearDate);
      let startNavData = findClosestNav(navData, endOfPrevYearDate);

      if (isAfter(oldestDate, endOfPrevYearDate)) {
        startNavData = navData[navData.length - 1];
      }

      if (!endNavData || !startNavData) {
          return { label, value: 'N/A' };
      }

      const endNavDateObj = parseDate(endNavData.date);
      if (endNavDateObj.getFullYear() < year) {
        return { label, value: 'N/A' };
      }

      if (endNavData.date === startNavData.date) {
          return { label, value: 'N/A' };
      }

      const returnValue = calculateReturn(endNavData.nav, startNavData.nav, 0.5); 
      
      return {
        label,
        value: returnValue.toFixed(2),
        isPositive: returnValue >= 0,
        numericValue: returnValue
      };
    });

    console.log(res);
  });
});
