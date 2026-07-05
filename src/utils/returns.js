import { parse, subMonths, subYears, isBefore, isAfter, differenceInDays } from 'date-fns';

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

/**
 * Calculates raw returns for all periods.
 */
export const calculateAllReturns = (navData) => {
  if (!navData || navData.length === 0) return {};

  const latestData = navData[0];
  const latestDate = parseDate(latestData.date);
  const latestNav = latestData.nav;

  const periods = [
    { key: '1M', targetDate: subMonths(latestDate, 1), years: 1/12 },
    { key: '3M', targetDate: subMonths(latestDate, 3), years: 3/12 },
    { key: '6M', targetDate: subMonths(latestDate, 6), years: 6/12 },
    { key: '1Y', targetDate: subYears(latestDate, 1), years: 1 },
    { key: '3Y', targetDate: subYears(latestDate, 3), years: 3 },
    { key: '5Y', targetDate: subYears(latestDate, 5), years: 5 },
    { key: '10Y', targetDate: subYears(latestDate, 10), years: 10 },
  ];

  const results = {};
  
  periods.forEach(period => {
    results[period.key] = -Infinity; // Default to bottom if no data
    
    const pastData = findClosestNav(navData, period.targetDate);
    if (!pastData) return;
    
    const pastDate = parseDate(pastData.date);
    if (differenceInDays(period.targetDate, pastDate) > 15 && isAfter(period.targetDate, pastDate)) {
        const oldestDate = parseDate(navData[navData.length - 1].date);
        if (isBefore(period.targetDate, oldestDate)) return;
    }

    results[period.key] = calculateReturn(latestNav, pastData.nav, period.years);
  });

  // Also include Average 1-Year Rolling Returns
  const rollingReturns = calculateAverageRollingReturns(navData);
  if (rollingReturns) {
    const getVal = (label) => {
      const item = rollingReturns.find(r => r.label === label);
      return (item && item.numericValue !== null) ? item.numericValue : -Infinity;
    };
    results['1Y_AVG'] = getVal('1Y Avg');
    results['3Y_AVG'] = getVal('3Y Avg');
    results['5Y_AVG'] = getVal('5Y Avg');
  } else {
    results['1Y_AVG'] = -Infinity;
    results['3Y_AVG'] = -Infinity;
    results['5Y_AVG'] = -Infinity;
  }

  // Also include Calendar Returns
  const calendarReturns = calculateCalendarReturns(navData);
  if (calendarReturns) {
    calendarReturns.forEach(c => {
      // Use the label (e.g. '2023', 'YTD') as the key
      results[c.label] = c.numericValue !== null && c.value !== 'N/A' ? c.numericValue : -Infinity;
    });
  }

  return results;
};

export const calculateTrailingReturns = (navData) => {
  if (!navData || navData.length === 0) return null;

  const latestData = navData[0];
  const latestDate = parseDate(latestData.date);
  const latestNav = latestData.nav;

  const periods = [
    { label: '1M', targetDate: subMonths(latestDate, 1), years: 1/12 },
    { label: '3M', targetDate: subMonths(latestDate, 3), years: 3/12 },
    { label: '6M', targetDate: subMonths(latestDate, 6), years: 6/12 },
    { label: '1Y', targetDate: subYears(latestDate, 1), years: 1 },
    { label: '3Y', targetDate: subYears(latestDate, 3), years: 3 },
    { label: '5Y', targetDate: subYears(latestDate, 5), years: 5 },
    { label: '10Y', targetDate: subYears(latestDate, 10), years: 10 },
  ];

  return periods.map(period => {
    const pastData = findClosestNav(navData, period.targetDate);
    if (!pastData) return { label: period.label, value: 'N/A' };
    
    const pastDate = parseDate(pastData.date);
    if (differenceInDays(period.targetDate, pastDate) > 15 && isAfter(period.targetDate, pastDate)) {
        const oldestDate = parseDate(navData[navData.length - 1].date);
        if (isBefore(period.targetDate, oldestDate)) return { label: period.label, value: 'N/A' };
    }

    // Use exact daily precision for maximum accuracy (accounting for leap years)
    const daysBetween = differenceInDays(latestDate, pastDate);
    const exactYears = daysBetween / 365.25;

    let returnValue = 0;
    if (exactYears >= 1) {
       returnValue = (Math.pow(latestNav / pastData.nav, 1 / exactYears) - 1) * 100;
    } else {
       returnValue = ((latestNav - pastData.nav) / pastData.nav) * 100;
    }

    return {
      label: period.label,
      value: returnValue.toFixed(2),
      isPositive: returnValue >= 0,
      numericValue: returnValue
    };
  });
};

/**
 * Assigns column-independent quartiles.
 * schemes: array of objects where each has a `returns` object: { '1M': 5.2, '2023': 15.5, ... }
 * Returns the same array, but adds `quartiles` object: { '1M': 1, '2023': 4, ... }
 */
export const assignQuartilesByColumn = (schemes) => {
  if (!schemes || schemes.length === 0) return [];
  
  // Dynamically get all available return keys from the first scheme
  const periods = Object.keys(schemes[0]?.returns || {});
  
  // Initialize quartiles object for each scheme
  schemes.forEach(s => s.quartiles = {});

  periods.forEach(period => {
    // Extract valid returns for this column
    const validValues = schemes
      .map((s, index) => ({ index, val: s.returns[period] }))
      .filter(item => item.val !== -Infinity && item.val !== undefined && !isNaN(item.val));
      
    // Sort descending
    validValues.sort((a, b) => b.val - a.val);
    
    const total = validValues.length;
    
    validValues.forEach((item, sortedIndex) => {
      const percentile = (sortedIndex + 1) / total;
      let q = 4;
      if (percentile <= 0.25) q = 1;
      else if (percentile <= 0.50) q = 2;
      else if (percentile <= 0.75) q = 3;
      
      schemes[item.index].quartiles[period] = q;
    });

    // Assign Q4 for any scheme that didn't have valid data for this period
    schemes.forEach(s => {
      if (s.returns[period] === -Infinity || s.returns[period] === undefined || isNaN(s.returns[period])) {
         s.quartiles[period] = 4;
      }
    });
  });
  
  // Sort overall list by 1Y return descending for better readability
  schemes.sort((a, b) => (b.returns['1Y'] || -Infinity) - (a.returns['1Y'] || -Infinity));

  // Assign overall quartile based on the sorted 1Y return rank
  const totalSchemes = schemes.length;
  schemes.forEach((scheme, index) => {
    const percentile = (index + 1) / totalSchemes;
    let q = 4;
    if (percentile <= 0.25) q = 1;
    else if (percentile <= 0.50) q = 2;
    else if (percentile <= 0.75) q = 3;
    scheme.overallQuartile = q;
  });

  return schemes;
};

/**
 * Calculates the average 1-year rolling return over the specified total periods (1Y, 3Y, 5Y).
 * This measures consistency by calculating daily 1-year returns and averaging them.
 */
export const calculateAverageRollingReturns = (navData) => {
  if (!navData || navData.length === 0) return null;

  const calculateAvgRolling = (totalYears, windowYears) => {
    const latestDate = parseDate(navData[0].date);
    const oldestAllowedEnd = subYears(latestDate, totalYears - windowYears);
    
    let sum = 0;
    let count = 0;
    
    // Two-pointer approach for O(N) performance
    let j = 0;

    for (let i = 0; i < navData.length; i++) {
      const endDate = parseDate(navData[i].date);
      // Only process endpoints within our observation window
      if (isBefore(endDate, oldestAllowedEnd)) break;

      const targetStartDate = subYears(endDate, windowYears);
      
      // Advance j until navData[j] is <= targetStartDate
      while (j < navData.length) {
        const pastDateObj = parseDate(navData[j].date);
        if (isBefore(pastDateObj, targetStartDate) || pastDateObj.getTime() === targetStartDate.getTime()) {
          break;
        }
        j++;
      }
      
      if (j < navData.length) {
        // Difference check (don't use dates too far off - e.g. gap of > 15 days)
        const pastDateObj = parseDate(navData[j].date);
        if (differenceInDays(targetStartDate, pastDateObj) <= 15) {
          const ret = calculateReturn(navData[i].nav, navData[j].nav, windowYears);
          sum += ret;
          count++;
        }
      }
    }

    if (count === 0) return null;
    return sum / count;
  };

  return [
    { label: '1Y Avg', value: calculateAvgRolling(1, 1) },
    { label: '3Y Avg', value: calculateAvgRolling(3, 1) },
    { label: '5Y Avg', value: calculateAvgRolling(5, 1) }
  ].map(item => ({
    label: item.label,
    value: item.value !== null ? item.value.toFixed(2) : 'N/A',
    isPositive: item.value !== null && item.value >= 0,
    numericValue: item.value
  }));
};

/**
 * Calculates calendar year-wise returns (e.g., YTD, 2023, 2022).
 */
export const calculateCalendarReturns = (navData) => {
  if (!navData || navData.length === 0) return [];
  
  const latestDate = parseDate(navData[0].date);
  const oldestDate = parseDate(navData[navData.length - 1].date);
  
  const currentYear = latestDate.getFullYear();
  const yearsToCalculate = [];
  // Calculate exactly down to 2013
  for (let y = currentYear; y >= 2013; y--) {
    yearsToCalculate.push(y);
  }

  return yearsToCalculate.map(year => {
    let label = String(year);
    if (year === currentYear) label = 'YTD';

    const endOfYearDate = new Date(year, 11, 31);
    const endOfPrevYearDate = new Date(year - 1, 11, 31);

    // If the fund started after this year ended, it didn't exist in this year.
    if (isAfter(oldestDate, endOfYearDate)) {
      return { label, value: 'N/A' };
    }

    // Find the end NAV for this year
    let endNavData = findClosestNav(navData, endOfYearDate);
    // Find the start NAV for this year (end of previous year)
    let startNavData = findClosestNav(navData, endOfPrevYearDate);

    // If end of previous year is before fund inception, use inception NAV
    if (isAfter(oldestDate, endOfPrevYearDate)) {
      startNavData = navData[navData.length - 1];
    }

    if (!endNavData || !startNavData) {
        return { label, value: 'N/A' };
    }

    const endNavDateObj = parseDate(endNavData.date);
    if (endNavDateObj.getFullYear() < year) {
      // The closest NAV is from a previous year, meaning no data for this year
      return { label, value: 'N/A' };
    }

    // Check if both dates are the same (happens if fund started exactly on the end NAV date)
    if (endNavData.date === startNavData.date) {
        return { label, value: 'N/A' };
    }

    // Calendar returns are absolute point-to-point percentage (not annualized CAGR)
    const returnValue = calculateReturn(endNavData.nav, startNavData.nav, 0.5); 
    
    return {
      label,
      value: returnValue.toFixed(2),
      isPositive: returnValue >= 0,
      numericValue: returnValue
    };
  });
};
