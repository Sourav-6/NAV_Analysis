import React, { useState, useEffect, useMemo } from 'react';
import { 
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend
} from 'recharts';
import { Loader2 } from 'lucide-react';
import { getSchemeNavData } from '../utils/api';
import { calculateAverageRollingReturns, calculateCalendarReturns } from '../utils/returns';

// A palette of distinct colors for multiple lines
const COLORS = [
  '#3b82f6', // blue
  '#10b981', // green
  '#f59e0b', // yellow/orange
  '#ef4444', // red
  '#8b5cf6', // purple
  '#ec4899', // pink
  '#06b6d4', // cyan
];

const ComparisonDashboard = ({ schemes }) => {
  const [navDataMap, setNavDataMap] = useState({});
  const [isLoading, setIsLoading] = useState(false);
  const [timeframe, setTimeframe] = useState('1Y'); // 1M, 3M, 6M, 1Y, 3Y, 5Y, 10Y, ALL
  const [isIndexed, setIsIndexed] = useState(true);

  useEffect(() => {
    const fetchAllData = async () => {
      setIsLoading(true);
      const dataMap = {};
      
      // Fetch data concurrently for all selected schemes
      const fetchPromises = schemes.map(async (scheme) => {
        // Only fetch if we don't already have it
        if (!navDataMap[scheme.schemeCode]) {
          const data = await getSchemeNavData(scheme.schemeCode);
          if (data && data.data) {
            dataMap[scheme.schemeCode] = data.data;
          }
        } else {
          dataMap[scheme.schemeCode] = navDataMap[scheme.schemeCode];
        }
      });

      await Promise.all(fetchPromises);
      setNavDataMap(prev => ({ ...prev, ...dataMap }));
      setIsLoading(false);
    };

    if (schemes.length > 0) {
      fetchAllData();
    }
  }, [schemes]); // We want this to run when schemes array changes

  const chartData = useMemo(() => {
    if (Object.keys(navDataMap).length === 0) return [];
    
    // 1. Collect all unique dates across all fetched schemes
    const allDatesSet = new Set();
    Object.values(navDataMap).forEach(navArray => {
      navArray.forEach(item => allDatesSet.add(item.date));
    });

    // 2. Sort dates oldest to newest (since raw data is newest first)
    // Parse to Date object for proper sorting
    const sortedDates = Array.from(allDatesSet).sort((a, b) => {
      const [ad, am, ay] = a.split('-');
      const [bd, bm, by] = b.split('-');
      const dateA = new Date(ay, am - 1, ad);
      const dateB = new Date(by, bm - 1, bd);
      return dateA - dateB;
    });

    // 3. Build unified data array: [ { date: '01-01', code1: 10, code2: 12 }, ... ]
    // To do this efficiently, create maps for each scheme's data keyed by date
    const schemeDateMaps = {};
    Object.entries(navDataMap).forEach(([code, navArray]) => {
      const dateMap = {};
      navArray.forEach(item => {
        dateMap[item.date] = parseFloat(item.nav);
      });
      schemeDateMaps[code] = dateMap;
    });

    let mergedData = sortedDates.map(date => {
      const point = { date };
      schemes.forEach(scheme => {
        const dateMap = schemeDateMaps[scheme.schemeCode];
        if (dateMap) {
          const nav = dateMap[date];
          if (nav !== undefined) {
            point[String(scheme.schemeCode)] = nav;
          }
        }
      });
      return point;
    });

    // 4. Filter by timeframe
    if (timeframe !== 'ALL' && mergedData.length > 0) {
      // Find the absolute latest date in the entire dataset
      const latestDateStr = mergedData[mergedData.length - 1].date;
      const [d, m, y] = latestDateStr.split('-');
      const latestDate = new Date(y, m - 1, d);
      
      let cutoffDate = new Date(latestDate);
      if (timeframe === '1M') cutoffDate.setMonth(cutoffDate.getMonth() - 1);
      if (timeframe === '3M') cutoffDate.setMonth(cutoffDate.getMonth() - 3);
      if (timeframe === '6M') cutoffDate.setMonth(cutoffDate.getMonth() - 6);
      if (timeframe === '1Y') cutoffDate.setFullYear(cutoffDate.getFullYear() - 1);
      if (timeframe === '3Y') cutoffDate.setFullYear(cutoffDate.getFullYear() - 3);
      if (timeframe === '5Y') cutoffDate.setFullYear(cutoffDate.getFullYear() - 5);
      if (timeframe === '10Y') cutoffDate.setFullYear(cutoffDate.getFullYear() - 10);
      
      mergedData = mergedData.filter(item => {
        const [id, im, iy] = item.date.split('-');
        const itemDate = new Date(iy, im - 1, id);
        return itemDate >= cutoffDate;
      });
    }

    // 4.5. Index to 100 for Comparison
    if (isIndexed && mergedData.length > 0) {
      const firstNavs = {};
      mergedData.forEach(point => {
        schemes.forEach(scheme => {
          const code = String(scheme.schemeCode);
          if (point[code] !== undefined && firstNavs[code] === undefined) {
            firstNavs[code] = point[code];
          }
        });
      });

      mergedData = mergedData.map(point => {
        const newPoint = { date: point.date };
        schemes.forEach(scheme => {
          const code = String(scheme.schemeCode);
          if (point[code] !== undefined && firstNavs[code] !== undefined && firstNavs[code] !== 0) {
            newPoint[code] = parseFloat(((point[code] / firstNavs[code]) * 100).toFixed(2));
            newPoint[`${code}_raw`] = point[code];
          }
        });
        return newPoint;
      });
    }

    // 5. Downsample if too large to prevent chart lag (especially with multiple lines)
    if (mergedData.length > 300) {
      const step = Math.ceil(mergedData.length / 250);
      mergedData = mergedData.filter((_, i) => i % step === 0);
    }

    return mergedData;
  }, [navDataMap, schemes, timeframe, isIndexed]);

  const rollingStats = useMemo(() => {
    if (Object.keys(navDataMap).length === 0) return [];
    
    return schemes.map(scheme => {
      const navData = navDataMap[scheme.schemeCode];
      const stats = calculateAverageRollingReturns(navData);
      return {
        scheme,
        stats
      };
    });
  }, [navDataMap, schemes]);

  const calendarStats = useMemo(() => {
    if (Object.keys(navDataMap).length === 0) return [];
    
    return schemes.map(scheme => {
      const navData = navDataMap[scheme.schemeCode];
      const stats = calculateCalendarReturns(navData);
      return {
        scheme,
        stats
      };
    });
  }, [navDataMap, schemes]);

  const allCalendarYears = useMemo(() => {
    if (calendarStats.length === 0) return [];
    const years = new Set();
    calendarStats.forEach(item => {
      if (item.stats) item.stats.forEach(s => years.add(s.label));
    });
    // Sort descending (YTD first, then 2023, 2022...)
    return Array.from(years).sort((a, b) => {
      if (a === 'YTD') return -1;
      if (b === 'YTD') return 1;
      return parseInt(b) - parseInt(a);
    });
  }, [calendarStats]);

  if (schemes.length === 0) return null;

  return (
    <div className="dashboard-container" style={{ marginTop: 'var(--spacing-xl)' }}>
      {/* Chart Section */}
      <div className="glass-panel flex-col gap-md" style={{ position: 'relative', minHeight: '500px' }}>
        
        {isLoading && (
          <div style={{ 
            position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, 
            background: 'rgba(15, 23, 42, 0.7)', 
            backdropFilter: 'blur(4px)',
            display: 'flex', justifyContent: 'center', alignItems: 'center',
            zIndex: 10, borderRadius: 'inherit'
          }}>
            <Loader2 className="spinner" size={40} style={{ color: 'var(--accent-primary)', animation: 'spin 1s linear infinite' }} />
          </div>
        )}

        <div className="flex justify-between items-center" style={{ flexWrap: 'wrap', gap: '16px' }}>
          <div className="flex items-center gap-md" style={{ flexWrap: 'wrap' }}>
            <h3 style={{ fontSize: '1.1rem', fontWeight: 500 }}>NAV Comparison</h3>
            <div className="flex gap-sm" style={{ background: 'var(--bg-color)', padding: '4px', borderRadius: '6px', border: '1px solid var(--panel-border)' }}>
              <button 
                className="btn"
                style={{ 
                  padding: '4px 12px', 
                  fontSize: '0.85rem',
                  background: isIndexed ? 'var(--panel-border-hover)' : 'transparent',
                  color: isIndexed ? 'var(--text-primary)' : 'var(--text-secondary)',
                  border: 'none',
                  borderRadius: '4px'
                }}
                onClick={() => setIsIndexed(true)}
              >
                Indexed (Base 100)
              </button>
              <button 
                className="btn"
                style={{ 
                  padding: '4px 12px', 
                  fontSize: '0.85rem',
                  background: !isIndexed ? 'var(--panel-border-hover)' : 'transparent',
                  color: !isIndexed ? 'var(--text-primary)' : 'var(--text-secondary)',
                  border: 'none',
                  borderRadius: '4px'
                }}
                onClick={() => setIsIndexed(false)}
              >
                Raw NAV
              </button>
            </div>
          </div>
          <div className="flex gap-sm" style={{ flexWrap: 'wrap', background: 'var(--bg-color)', padding: '4px', borderRadius: '6px', border: '1px solid var(--panel-border)' }}>
            {['1M', '3M', '6M', '1Y', '3Y', '5Y', '10Y', 'ALL'].map(tf => (
              <button 
                key={tf}
                className="btn"
                style={{ 
                  padding: '4px 10px', 
                  fontSize: '0.85rem',
                  background: timeframe === tf ? 'var(--panel-border-hover)' : 'transparent',
                  color: timeframe === tf ? 'var(--text-primary)' : 'var(--text-secondary)',
                  border: 'none',
                  borderRadius: '4px'
                }}
                onClick={() => setTimeframe(tf)}
              >
                {tf}
              </button>
            ))}
          </div>
        </div>
        
        <div style={{ width: '100%', height: '450px', marginTop: '16px' }}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--panel-border)" vertical={false} />
              <XAxis 
                dataKey="date" 
                stroke="var(--text-secondary)" 
                tick={{ fill: 'var(--text-secondary)', fontSize: 12 }}
                tickMargin={10}
                minTickGap={30}
              />
              <YAxis 
                domain={['auto', 'auto']} 
                stroke="var(--text-secondary)" 
                tick={{ fill: 'var(--text-secondary)', fontSize: 12 }}
                tickFormatter={(val) => isIndexed ? val : `₹${val}`}
                width={60}
              />
              <Tooltip 
                contentStyle={{ 
                  backgroundColor: 'var(--bg-color)', 
                  border: '1px solid var(--panel-border)',
                  borderRadius: '6px',
                  color: 'var(--text-primary)',
                  boxShadow: '0 8px 24px rgba(0, 0, 0, 0.5)'
                }}
                labelStyle={{ color: 'var(--text-secondary)', marginBottom: '8px', fontWeight: 500, borderBottom: '1px solid var(--panel-border)', paddingBottom: '4px' }}
                formatter={(value, name, props) => {
                  const scheme = schemes.find(s => String(s.schemeCode) === String(name));
                  const displayValue = isIndexed && props.payload[`${name}_raw`] ? props.payload[`${name}_raw`] : value;
                  return [`₹${displayValue}`, scheme ? scheme.schemeName : name];
                }}
              />
              <Legend 
                wrapperStyle={{ paddingTop: '20px' }}
                formatter={(value) => {
                  const scheme = schemes.find(s => String(s.schemeCode) === String(value));
                  return <span style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>{scheme ? scheme.schemeName : value}</span>;
                }}
              />
              {schemes.map((scheme, index) => (
                <Line 
                  key={scheme.schemeCode}
                  type="monotone" 
                  dataKey={String(scheme.schemeCode)} 
                  name={scheme.schemeCode.toString()}
                  stroke={COLORS[index % COLORS.length]} 
                  strokeWidth={2}
                  dot={false}
                  activeDot={{ r: 6, fill: COLORS[index % COLORS.length], stroke: '#fff', strokeWidth: 2 }}
                  animationDuration={1000}
                  connectNulls={true} // Important if one fund launched later than another
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Average 1-Year Rolling Returns Table */}
      {rollingStats.length > 0 && (
        <div className="table-container" style={{ marginTop: 'var(--spacing-xl)' }}>
          <div style={{ padding: '16px', borderBottom: '1px solid var(--panel-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h3 style={{ fontSize: '1rem', fontWeight: 500 }}>Average 1-Year Rolling Returns</h3>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Calculated from daily step intervals</span>
          </div>
          <table className="data-table">
            <thead>
              <tr>
                <th style={{ textAlign: 'left' }}>Fund Name</th>
                <th>1Y Avg Return</th>
                <th>3Y Avg Return</th>
                <th>5Y Avg Return</th>
              </tr>
            </thead>
            <tbody>
              {rollingStats.map(({ scheme, stats }, idx) => (
                <tr key={scheme.schemeCode}>
                  <td className="scheme-name" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <div style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: COLORS[idx % COLORS.length] }} />
                    {scheme.schemeName}
                  </td>
                  {stats ? (
                    stats.map(stat => (
                      <td 
                        key={stat.label} 
                        style={{ color: stat.isPositive ? 'var(--success)' : 'var(--danger)', fontWeight: 500 }}
                      >
                        {stat.value !== 'N/A' ? `${stat.value}%` : '-'}
                      </td>
                    ))
                  ) : (
                    <td colSpan={3} style={{ color: 'var(--text-secondary)', textAlign: 'center' }}>Data not available</td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Calendar Year Returns Table */}
      {allCalendarYears.length > 0 && (
        <div className="table-container" style={{ marginTop: 'var(--spacing-xl)' }}>
          <div style={{ padding: '16px', borderBottom: '1px solid var(--panel-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h3 style={{ fontSize: '1rem', fontWeight: 500 }}>Calendar Year Returns</h3>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Year-by-year absolute performance</span>
          </div>
          <table className="data-table">
            <thead>
              <tr>
                <th style={{ textAlign: 'left' }}>Fund Name</th>
                {allCalendarYears.map(year => (
                  <th key={year}>{year}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {calendarStats.map(({ scheme, stats }, idx) => (
                <tr key={scheme.schemeCode}>
                  <td className="scheme-name" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <div style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: COLORS[idx % COLORS.length] }} />
                    {scheme.schemeName}
                  </td>
                  {allCalendarYears.map(yearLabel => {
                    const stat = stats ? stats.find(s => s.label === yearLabel) : null;
                    if (!stat || stat.value === 'N/A') {
                      return <td key={yearLabel} style={{ color: 'var(--text-secondary)' }}>-</td>;
                    }
                    return (
                      <td 
                        key={yearLabel} 
                        style={{ color: stat.isPositive ? 'var(--success)' : 'var(--danger)', fontWeight: 500 }}
                      >
                        {stat.value}%
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      
      
      <style>{`
        @keyframes spin { 100% { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
};

export default ComparisonDashboard;
