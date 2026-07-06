import React, { useState, useEffect, useMemo, useRef } from 'react';
import { createChart, CrosshairMode, LineSeries } from 'lightweight-charts';
import { Loader2 } from 'lucide-react';
import { getSchemeNavData } from '../utils/api';
import { calculateAverageRollingReturns, calculateCalendarReturns } from '../utils/returns';

const COLORS = [
  '#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#06b6d4',
];

const ComparisonDashboard = ({ schemes, theme = 'dark' }) => {
  const [navDataMap, setNavDataMap] = useState({});
  const [isLoading, setIsLoading] = useState(false);
  const [timeframe, setTimeframe] = useState('ALL'); 
  const [isIndexed, setIsIndexed] = useState(true);

  const chartContainerRef = useRef(null);
  const tooltipRef = useRef(null);
  const chartInstance = useRef(null);
  const seriesMap = useRef({});

  useEffect(() => {
    const fetchAllData = async () => {
      setIsLoading(true);
      const dataMap = {};
      const fetchPromises = schemes.map(async (scheme) => {
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
    if (schemes.length > 0) fetchAllData();
  }, [schemes]);

  const { seriesData, mergedDataMap } = useMemo(() => {
    if (Object.keys(navDataMap).length === 0) return { seriesData: {}, mergedDataMap: {} };

    const monthMap = { Jan: '01', Feb: '02', Mar: '03', Apr: '04', May: '05', Jun: '06', Jul: '07', Aug: '08', Sep: '09', Oct: '10', Nov: '11', Dec: '12' };

    const allDatesSet = new Set();
    Object.values(navDataMap).forEach(navArray => {
      if (!Array.isArray(navArray)) return;
      navArray.forEach(item => {
        if (item && item.date) allDatesSet.add(item.date);
      });
    });

    const sortedDates = Array.from(allDatesSet).sort((a, b) => {
      const [ad, am, ay] = a.split('-');
      const [bd, bm, by] = b.split('-');
      const amNum = parseInt(monthMap[am] || am, 10) - 1;
      const bmNum = parseInt(monthMap[bm] || bm, 10) - 1;
      return new Date(ay, amNum, ad) - new Date(by, bmNum, bd);
    });

    const schemeDateMaps = {};
    schemes.forEach(scheme => {
      const code = String(scheme.schemeCode);
      const navArray = navDataMap[code] || [];
      const map = {};
      navArray.forEach(item => {
        map[item.date] = parseFloat(item.nav);
      });
      schemeDateMaps[code] = map;
    });

    let mergedData = sortedDates.map(dateStr => {
      const [d, m, y] = dateStr.split('-');
      const monthStr = monthMap[m] || m.padStart(2, '0');
      const time = `${y}-${monthStr}-${d.padStart(2, '0')}`;
      
      const point = { originalDate: dateStr, time };
      schemes.forEach(scheme => {
        const nav = schemeDateMaps[scheme.schemeCode]?.[dateStr];
        if (nav !== undefined) point[String(scheme.schemeCode)] = nav;
      });
      return point;
    });

    // Timeframe filtering
    const now = new Date();
    let cutoffDate = new Date(0);
    if (timeframe === '1M') cutoffDate = new Date(now.getFullYear(), now.getMonth() - 1, now.getDate());
    if (timeframe === '3M') cutoffDate = new Date(now.getFullYear(), now.getMonth() - 3, now.getDate());
    if (timeframe === '6M') cutoffDate = new Date(now.getFullYear(), now.getMonth() - 6, now.getDate());
    if (timeframe === '1Y') cutoffDate = new Date(now.getFullYear() - 1, now.getMonth(), now.getDate());
    if (timeframe === '3Y') cutoffDate = new Date(now.getFullYear() - 3, now.getMonth(), now.getDate());
    if (timeframe === '5Y') cutoffDate = new Date(now.getFullYear() - 5, now.getMonth(), now.getDate());
    if (timeframe === '10Y') cutoffDate = new Date(now.getFullYear() - 10, now.getMonth(), now.getDate());

    if (timeframe !== 'ALL') {
      mergedData = mergedData.filter(item => {
        const [iy, im, id] = item.time.split('-');
        return new Date(iy, parseInt(im, 10) - 1, id) >= cutoffDate;
      });
    }

    if (isIndexed && mergedData.length > 0) {
      const firstNavs = {};
      schemes.forEach(scheme => {
        const code = String(scheme.schemeCode);
        for (let i = 0; i < mergedData.length; i++) {
          if (mergedData[i][code] !== undefined) {
            firstNavs[code] = mergedData[i][code];
            break;
          }
        }
      });

      mergedData = mergedData.map(point => {
        const newPoint = { ...point };
        schemes.forEach(scheme => {
          const code = String(scheme.schemeCode);
          if (point[code] !== undefined && firstNavs[code]) {
            newPoint[code] = parseFloat(((point[code] / firstNavs[code]) * 100).toFixed(2));
            newPoint[`${code}_raw`] = point[code];
          }
        });
        return newPoint;
      });
    }

    const sData = {};
    schemes.forEach(scheme => {
      sData[String(scheme.schemeCode)] = [];
    });

    const mDataMap = {};
    
    // Process mergedData into mDataMap (deduplicated by time)
    mergedData.forEach(point => {
      if (!mDataMap[point.time]) {
        mDataMap[point.time] = { time: point.time, originalDate: point.originalDate };
      }
      
      schemes.forEach(scheme => {
        const code = String(scheme.schemeCode);
        if (point[code] !== undefined && !isNaN(point[code]) && isFinite(point[code])) {
          mDataMap[point.time][code] = point[code];
          mDataMap[point.time][`${code}_raw`] = point[`${code}_raw`];
        }
      });
    });

    // Extract sorted time keys to guarantee strictly ascending order
    const uniqueTimes = Object.keys(mDataMap).sort();
    
    uniqueTimes.forEach(time => {
      const point = mDataMap[time];
      schemes.forEach(scheme => {
        const code = String(scheme.schemeCode);
        if (point[code] !== undefined) {
          sData[code].push({ 
            time: time, 
            value: point[code], 
            originalValue: point[`${code}_raw`] || point[code] 
          });
        }
      });
    });

    return { seriesData: sData, mergedDataMap: mDataMap };
  }, [schemes, navDataMap, timeframe, isIndexed]);

  useEffect(() => {
    if (!chartContainerRef.current || schemes.length === 0 || Object.keys(seriesData).length === 0) return;

    // Check that at least one scheme has data points
    const hasAnyData = schemes.some(s => {
      const d = seriesData[String(s.schemeCode)];
      return d && d.length > 0;
    });
    if (!hasAnyData) return;

    try {
      if (chartInstance.current) {
        chartInstance.current.remove();
        chartInstance.current = null;
        seriesMap.current = {};
      }
    } catch (e) {
      chartInstance.current = null;
      seriesMap.current = {};
    }

    const isDark = theme === 'dark';

    let chart;
    try {
      chart = createChart(chartContainerRef.current, {
        layout: {
          background: { type: 'solid', color: 'transparent' },
          textColor: isDark ? '#888888' : '#6b7280',
          attributionLogo: false,
        },
        grid: {
          vertLines: { color: isDark ? '#1f1f1f' : '#e5e7eb' },
          horzLines: { color: isDark ? '#1f1f1f' : '#e5e7eb' },
        },
        crosshair: {
          mode: CrosshairMode.Magnet,
        },
        rightPriceScale: {
          borderColor: isDark ? '#1f1f1f' : '#e5e7eb',
          scaleMargins: { top: 0.1, bottom: 0.1 },
        },
        timeScale: {
          borderColor: isDark ? '#1f1f1f' : '#e5e7eb',
          timeVisible: true,
        },
        autoSize: true,
      });
      chartInstance.current = chart;
      seriesMap.current = {};

      schemes.forEach((scheme, index) => {
        const code = String(scheme.schemeCode);
        const data = seriesData[code];
        if (data && data.length > 0) {
          const series = chart.addSeries(LineSeries, {
            color: COLORS[index % COLORS.length],
            lineWidth: 2,
            crosshairMarkerVisible: true,
          });
          series.setData(data);
          seriesMap.current[code] = series;
        }
      });

      chart.timeScale().fitContent();

      // Custom Tooltip Logic
      chart.subscribeCrosshairMove(param => {
        const tooltip = tooltipRef.current;
        if (!tooltip || !chartContainerRef.current) return;

        if (
          param.point === undefined ||
          !param.time ||
          param.point.x < 0 ||
          param.point.x > chartContainerRef.current.clientWidth ||
          param.point.y < 0 ||
          param.point.y > chartContainerRef.current.clientHeight
        ) {
          tooltip.style.display = 'none';
          return;
        }

        const dateStr = param.time;
        const dataPoint = mergedDataMap[dateStr];
        if (!dataPoint) return;

        let html = `<div style="font-weight:600; margin-bottom:8px; border-bottom:1px solid var(--panel-border); padding-bottom:4px; color:var(--text-primary);">${dataPoint.originalDate}</div>`;
        
        schemes.forEach((scheme, index) => {
          const code = String(scheme.schemeCode);
          const val = dataPoint[code];
          const rawVal = dataPoint[`${code}_raw`] || val;
          
          if (val !== undefined) {
            const color = COLORS[index % COLORS.length];
            const displayVal = isIndexed ? `₹${rawVal}` : `₹${val}`;
            html += `<div style="display:flex; justify-content:space-between; gap:16px; font-size:13px; margin-bottom:4px;">
              <span style="color:${color}">${scheme.schemeName}</span>
              <span style="font-weight:600">${displayVal}</span>
            </div>`;
          }
        });

        tooltip.innerHTML = html;
        tooltip.style.display = 'block';

        const y = param.point.y;
        let x = param.point.x + 15;
        if (x > chartContainerRef.current.clientWidth - 200) {
          x = param.point.x - 215;
        }
        
        tooltip.style.left = x + 'px';
        tooltip.style.top = y + 'px';
      });
    } catch (e) {
      console.error('Chart creation error:', e);
    }

    return () => {
      try {
        if (chartInstance.current) {
          chartInstance.current.remove();
          chartInstance.current = null;
          seriesMap.current = {};
        }
      } catch (e) {
        chartInstance.current = null;
        seriesMap.current = {};
      }
    };
  }, [seriesData, mergedDataMap, schemes, isIndexed, theme]);

  const rollingStats = useMemo(() => {
    if (Object.keys(navDataMap).length === 0) return [];
    return schemes.map(scheme => ({
      scheme, stats: calculateAverageRollingReturns(navDataMap[scheme.schemeCode])
    }));
  }, [navDataMap, schemes]);

  const calendarStats = useMemo(() => {
    if (Object.keys(navDataMap).length === 0) return [];
    return schemes.map(scheme => ({
      scheme, stats: calculateCalendarReturns(navDataMap[scheme.schemeCode])
    }));
  }, [navDataMap, schemes]);

  const allCalendarYears = useMemo(() => {
    if (calendarStats.length === 0) return [];
    const years = new Set();
    calendarStats.forEach(item => {
      if (item.stats) item.stats.forEach(s => years.add(s.label));
    });
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
      <div className="glass-panel flex-col gap-md" style={{ position: 'relative', minHeight: '500px', padding: '16px' }}>
        
        {isLoading && (
          <div style={{ 
            position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, 
            background: 'rgba(10, 10, 10, 0.8)', 
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
                  padding: '4px 12px', fontSize: '0.85rem',
                  background: isIndexed ? 'var(--panel-border-hover)' : 'transparent',
                  color: isIndexed ? 'var(--text-primary)' : 'var(--text-secondary)',
                  border: 'none', borderRadius: '4px'
                }}
                onClick={() => setIsIndexed(true)}
              >
                Indexed (Base 100)
              </button>
              <button 
                className="btn"
                style={{ 
                  padding: '4px 12px', fontSize: '0.85rem',
                  background: !isIndexed ? 'var(--panel-border-hover)' : 'transparent',
                  color: !isIndexed ? 'var(--text-primary)' : 'var(--text-secondary)',
                  border: 'none', borderRadius: '4px'
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
                  padding: '4px 10px', fontSize: '0.85rem',
                  background: timeframe === tf ? 'var(--panel-border-hover)' : 'transparent',
                  color: timeframe === tf ? 'var(--text-primary)' : 'var(--text-secondary)',
                  border: 'none', borderRadius: '4px'
                }}
                onClick={() => setTimeframe(tf)}
              >
                {tf}
              </button>
            ))}
          </div>
        </div>
        
        {/* TradingView Lightweight Chart Container */}
        <div style={{ position: 'relative', width: '100%', height: '450px', marginTop: '16px' }}>
          <div ref={chartContainerRef} style={{ width: '100%', height: '100%' }} />
          
          {/* Custom HTML Tooltip */}
          <div 
            ref={tooltipRef}
            style={{
              position: 'absolute',
              display: 'none',
              padding: '12px',
              backgroundColor: 'var(--panel-bg)',
              border: '1px solid var(--panel-border)',
              borderRadius: '6px',
              color: 'var(--text-primary)',
              zIndex: 100,
              pointerEvents: 'none',
              boxShadow: theme === 'dark' ? '0 4px 12px rgba(0,0,0,0.5)' : '0 4px 12px rgba(0,0,0,0.1)',
              minWidth: '200px'
            }}
          />
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
                      <td key={stat.label} style={{ color: stat.isPositive ? 'var(--success)' : 'var(--danger)', fontWeight: 500 }}>
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
                    if (!stat || stat.value === 'N/A') return <td key={yearLabel} style={{ color: 'var(--text-secondary)' }}>-</td>;
                    return (
                      <td key={yearLabel} style={{ color: stat.isPositive ? 'var(--success)' : 'var(--danger)', fontWeight: 500 }}>
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

