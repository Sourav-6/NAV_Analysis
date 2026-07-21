import React, { useState, useEffect, useMemo, useRef } from 'react';
import { createChart, CrosshairMode, LineSeries } from 'lightweight-charts';
import { Loader2, Award, ChevronDown, ChevronUp } from 'lucide-react';
import { getSchemeNavData, calculateSelectedRankings, getRankingConfig } from '../utils/api';
import { calculateCalendarReturns, calculateTrailingReturns } from '../utils/returns';

const COLORS = [
  '#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#06b6d4',
];

const RANK_PERIOD_OPTIONS = [
  { value: '1Y', label: '1 Year' },
  { value: '3Y', label: '3 Years' },
  { value: '5Y', label: '5 Years' },
  { value: '10Y', label: '10 Years' }
];

const RANK_WINDOW_OPTIONS = [
  { value: '1M', label: '1 Month', years: 1/12 },
  { value: '3M', label: '3 Months', years: 3/12 },
  { value: '1Y', label: '1 Year', years: 1 },
  { value: '3Y', label: '3 Years', years: 3 },
  { value: '5Y', label: '5 Years', years: 5 }
];

/**
 * Sub-component for SRP Ranking analysis within the comparison view.
 * Ranks only the user-selected schemes against each other.
 */
const RankingAnalysis = ({
  schemes, analysisPeriod, setAnalysisPeriod,
  rollingWindow, setRollingWindow,
  rankedFunds, setRankedFunds,
  isLoading, setIsLoading,
  error, setError,
  config, setConfig,
  referenceDate
}) => {
  // Load config on mount
  useEffect(() => {
    getRankingConfig().then(cfg => {
      if (cfg) setConfig(cfg);
    });
  }, []);

  // Valid window options based on analysis period
  const validWindowOptions = useMemo(() => {
    const apYears = parseInt(analysisPeriod);
    return RANK_WINDOW_OPTIONS.filter(opt => opt.years <= apYears);
  }, [analysisPeriod]);

  // Auto-adjust rolling window if it exceeds the analysis period
  useEffect(() => {
    const apYears = parseInt(analysisPeriod);
    const selectedOpt = RANK_WINDOW_OPTIONS.find(opt => opt.value === rollingWindow);
    if (selectedOpt && selectedOpt.years > apYears) {
      const validOpts = RANK_WINDOW_OPTIONS.filter(opt => opt.years <= apYears);
      if (validOpts.length > 0) {
        setRollingWindow(validOpts[validOpts.length - 1].value);
      }
    }
  }, [analysisPeriod, rollingWindow]);

  // Calculate rankings when schemes or parameters change
  useEffect(() => {
    if (schemes.length < 2) return;

    const fetchRankings = async () => {
      setIsLoading(true);
      setError(null);
      try {
        const schemeCodes = schemes.map(s => s.schemeCode);
        const data = await calculateSelectedRankings({
          schemeCodes,
          analysisPeriod,
          rollingWindow,
          config: config || undefined,
          referenceDate
        });
        setRankedFunds(data);
      } catch (err) {
        console.error(err);
        setError('Failed to compute rankings for selected schemes.');
      } finally {
        setIsLoading(false);
      }
    };

    fetchRankings();
  }, [schemes.length, analysisPeriod, rollingWindow, config, referenceDate]);

  const getPercentileClass = (score) => {
    if (score >= 75) return 'q1';
    if (score >= 50) return 'q2';
    if (score >= 25) return 'q3';
    return 'q4';
  };

  return (
    <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
      {/* Controls Row */}
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: '16px', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <span style={{ fontSize: '0.7rem', fontWeight: 500, color: 'var(--text-secondary)', textTransform: 'uppercase' }}>Analysis Period</span>
          <select
            value={analysisPeriod}
            onChange={(e) => setAnalysisPeriod(e.target.value)}
            style={{
              background: 'var(--bg-color)',
              border: '1px solid var(--panel-border)',
              color: 'var(--text-primary)',
              padding: '6px 12px',
              borderRadius: '6px',
              fontSize: '0.85rem',
              cursor: 'pointer',
              outline: 'none'
            }}
          >
            {RANK_PERIOD_OPTIONS.map(opt => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <span style={{ fontSize: '0.7rem', fontWeight: 500, color: 'var(--text-secondary)', textTransform: 'uppercase' }}>Rolling Window</span>
          <select
            value={rollingWindow}
            onChange={(e) => setRollingWindow(e.target.value)}
            style={{
              background: 'var(--bg-color)',
              border: '1px solid var(--panel-border)',
              color: 'var(--text-primary)',
              padding: '6px 12px',
              borderRadius: '6px',
              fontSize: '0.85rem',
              cursor: 'pointer',
              outline: 'none'
            }}
          >
            {validWindowOptions.map(opt => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>

        <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', paddingBottom: '8px' }}>
          Ranking {schemes.length} funds against each other
        </span>
      </div>

      {/* Results */}
      {isLoading ? (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '12px', padding: '40px 0' }}>
          <Loader2 size={24} style={{ animation: 'spin 1s linear infinite', color: 'var(--accent-primary)' }} />
          <span style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>Computing rolling window rankings...</span>
        </div>
      ) : error ? (
        <div style={{ padding: '16px', color: 'var(--danger)', fontSize: '0.9rem' }}>
          {error}
        </div>
      ) : rankedFunds.length === 0 ? (
        <div style={{ padding: '24px', textAlign: 'center', color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
          No ranking data available. The selected funds may not have enough historical data for the chosen {analysisPeriod} analysis period.
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table className="data-table">
            <thead>
              <tr>
                <th style={{ width: '50px', textAlign: 'center' }}>Rank</th>
                <th style={{ textAlign: 'left', minWidth: '200px' }}>Fund Name</th>
                <th style={{ textAlign: 'center' }}>Period Return</th>
                <th style={{ textAlign: 'center' }}>Overall</th>
                <th style={{ textAlign: 'center' }}>Daily Lead.</th>
                <th style={{ textAlign: 'center' }}>Recent Lead.</th>
                <th style={{ textAlign: 'center' }}>Sortino</th>
                <th style={{ textAlign: 'center' }}>Max DD</th>
                <th style={{ textAlign: 'center' }}>Ulcer</th>
              </tr>
            </thead>
            <tbody>
              {rankedFunds.map((fund, idx) => {
                const schemeIdx = schemes.findIndex(s => String(s.schemeCode) === String(fund.schemeCode));
                const color = schemeIdx >= 0 ? COLORS[schemeIdx % COLORS.length] : 'var(--text-primary)';
                const isTopRanked = idx < 3;

                return (
                  <tr key={fund.schemeCode}>
                    <td style={{ textAlign: 'center', fontWeight: 600 }}>
                      {isTopRanked ? (
                        <div style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', color: idx === 0 ? '#d4af37' : idx === 1 ? '#c0c0c0' : '#cd7f32' }}>
                          <Award size={14} />
                          {idx + 1}
                        </div>
                      ) : (
                        idx + 1
                      )}
                    </td>
                    <td className="scheme-name" style={{ textAlign: 'left', fontWeight: 500 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <div style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: color, flexShrink: 0 }} />
                        {fund.schemeName}
                      </div>
                    </td>
                    <td style={{ textAlign: 'center', fontWeight: 600, color: fund.analysisPeriodReturn >= 0 ? 'var(--success)' : 'var(--danger)' }}>
                      {fund.analysisPeriodReturn?.toFixed(2)}%
                    </td>
                    <td style={{ textAlign: 'center', fontWeight: 700, color: 'var(--brand-blue, var(--accent-primary))' }}>
                      {fund.overallScore.toFixed(1)}
                    </td>
                    <td style={{ textAlign: 'center' }}>
                      <span className={`quartile-badge ${getPercentileClass(fund.dailyLeadership)}`}>{fund.dailyLeadership.toFixed(1)}</span>
                    </td>
                    <td style={{ textAlign: 'center' }}>
                      <span className={`quartile-badge ${getPercentileClass(fund.recentLeadership)}`}>{fund.recentLeadership.toFixed(1)}</span>
                    </td>
                    <td style={{ textAlign: 'center' }}>
                      <span className={`quartile-badge ${getPercentileClass(fund.sortinoScore)}`}>{fund.sortinoScore.toFixed(1)}</span>
                    </td>
                    <td style={{ textAlign: 'center' }}>
                      <span className={`quartile-badge ${getPercentileClass(fund.mddScore)}`}>{fund.mddScore.toFixed(1)}</span>
                    </td>
                    <td style={{ textAlign: 'center' }}>
                      <span className={`quartile-badge ${getPercentileClass(fund.ulcerScore)}`}>{fund.ulcerScore.toFixed(1)}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

const ComparisonDashboard = ({ schemes, theme = 'dark', referenceDate }) => {
  const [navDataMap, setNavDataMap] = useState({});
  const [isLoading, setIsLoading] = useState(false);
  const [timeframe, setTimeframe] = useState('ALL'); 
  const [isIndexed, setIsIndexed] = useState(true);
  const [viewMode, setViewMode] = useState('chart'); // 'chart' or 'table'

  // SRP Ranking state
  const [showRanking, setShowRanking] = useState(false);
  const [rankAnalysisPeriod, setRankAnalysisPeriod] = useState('3Y');
  const [rankRollingWindow, setRankRollingWindow] = useState('1Y');
  const [rankedFunds, setRankedFunds] = useState([]);
  const [isRankingLoading, setIsRankingLoading] = useState(false);
  const [rankingError, setRankingError] = useState(null);
  const [rankingConfig, setRankingConfig] = useState(null);

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
          const data = await getSchemeNavData(scheme.schemeCode, referenceDate);
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

    const uniqueSchemesMap = new Map();
    schemes.forEach(s => uniqueSchemesMap.set(String(s.schemeCode), s));
    const uniqueSchemes = Array.from(uniqueSchemesMap.values());

    const schemeDateMaps = {};
    uniqueSchemes.forEach(scheme => {
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
      uniqueSchemes.forEach(scheme => {
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
      uniqueSchemes.forEach(scheme => {
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
        uniqueSchemes.forEach(scheme => {
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
    uniqueSchemes.forEach(scheme => {
      sData[String(scheme.schemeCode)] = [];
    });

    const mDataMap = {};
    
    // Process mergedData into mDataMap (deduplicated by time)
    mergedData.forEach(point => {
      if (!mDataMap[point.time]) {
        mDataMap[point.time] = { time: point.time, originalDate: point.originalDate };
      }
      
      uniqueSchemes.forEach(scheme => {
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
      uniqueSchemes.forEach(scheme => {
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
    const uniqueSchemesMap = new Map();
    schemes.forEach(s => uniqueSchemesMap.set(String(s.schemeCode), s));
    const uniqueSchemes = Array.from(uniqueSchemesMap.values());

    const hasAnyData = uniqueSchemes.some(s => {
      const d = seriesData[String(s.schemeCode)];
      return d && d.length > 0;
    });
    if (!hasAnyData) return;

    if (viewMode === 'table') return; // Skip drawing chart if in table mode

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

      uniqueSchemes.forEach((scheme, index) => {
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
        
        uniqueSchemes.forEach((scheme, index) => {
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

  const trailingStats = useMemo(() => {
    if (Object.keys(navDataMap).length === 0) return [];
    return schemes.map(scheme => ({
      scheme, stats: calculateTrailingReturns(navDataMap[scheme.schemeCode])
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
            <div className="flex gap-sm" style={{ background: 'var(--bg-color)', padding: '4px', borderRadius: '6px', border: '1px solid var(--panel-border)' }}>
              <button 
                className="btn"
                style={{ 
                  padding: '4px 12px', fontSize: '0.85rem',
                  background: viewMode === 'chart' ? 'var(--panel-border-hover)' : 'transparent',
                  color: viewMode === 'chart' ? 'var(--text-primary)' : 'var(--text-secondary)',
                  border: 'none', borderRadius: '4px'
                }}
                onClick={() => setViewMode('chart')}
              >
                Chart
              </button>
              <button 
                className="btn"
                style={{ 
                  padding: '4px 12px', fontSize: '0.85rem',
                  background: viewMode === 'table' ? 'var(--panel-border-hover)' : 'transparent',
                  color: viewMode === 'table' ? 'var(--text-primary)' : 'var(--text-secondary)',
                  border: 'none', borderRadius: '4px'
                }}
                onClick={() => setViewMode('table')}
              >
                Table
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
        
        {/* TradingView Lightweight Chart Container OR Data Table */}
        <div style={{ position: 'relative', width: '100%', height: '450px', marginTop: '16px' }}>
          {viewMode === 'chart' ? (
            <>
              <div ref={chartContainerRef} style={{ width: '100%', height: '100%' }} />
              
              {/* Custom HTML Tooltip */}
              <div 
                ref={tooltipRef}
                style={{
                  position: 'absolute', display: 'none', padding: '12px',
                  backgroundColor: 'var(--panel-bg)', border: '1px solid var(--panel-border)',
                  borderRadius: '6px', color: 'var(--text-primary)', zIndex: 100, pointerEvents: 'none',
                  boxShadow: theme === 'dark' ? '0 4px 12px rgba(0,0,0,0.5)' : '0 4px 12px rgba(0,0,0,0.1)',
                  minWidth: '200px'
                }}
              />
            </>
          ) : (
            <div className="table-container" style={{ height: '100%', overflowY: 'auto', border: '1px solid var(--panel-border)', borderRadius: '8px' }}>
              <table className="data-table" style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead style={{ position: 'sticky', top: 0, zIndex: 10, background: 'var(--panel-bg)' }}>
                  <tr>
                    <th style={{ textAlign: 'left', padding: '12px' }}>Date</th>
                    {Array.from(new Map(schemes.map(s => [String(s.schemeCode), s])).values()).map((scheme, idx) => (
                      <th key={scheme.schemeCode} style={{ padding: '12px', color: COLORS[idx % COLORS.length] }}>
                        {scheme.schemeName}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {Object.keys(mergedDataMap).sort().reverse().map(time => {
                    const point = mergedDataMap[time];
                    const uniqueSchemes = Array.from(new Map(schemes.map(s => [String(s.schemeCode), s])).values());
                    
                    // Only show rows where at least one scheme has data
                    if (!uniqueSchemes.some(s => point[String(s.schemeCode)] !== undefined)) return null;

                    return (
                      <tr key={time} style={{ borderBottom: '1px solid var(--panel-border)' }}>
                        <td style={{ padding: '12px', whiteSpace: 'nowrap', fontWeight: 500 }}>{point.originalDate}</td>
                        {uniqueSchemes.map(scheme => {
                          const code = String(scheme.schemeCode);
                          const val = point[code];
                          const rawVal = point[`${code}_raw`] || val;
                          const displayVal = isIndexed ? (val !== undefined ? val.toFixed(2) : '-') : (val !== undefined ? rawVal.toFixed(4) : '-');
                          return (
                            <td key={code} style={{ padding: '12px', textAlign: 'center' }}>
                              {displayVal}
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Trailing Returns Table */}
      {trailingStats.length > 0 && (
        <div className="table-container" style={{ marginTop: 'var(--spacing-xl)' }}>
          <div style={{ padding: '16px', borderBottom: '1px solid var(--panel-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h3 style={{ fontSize: '1rem', fontWeight: 500 }}>Trailing Returns</h3>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Point-to-point performance</span>
          </div>
          <table className="data-table">
            <thead>
              <tr>
                <th style={{ textAlign: 'left' }}>Fund Name</th>
                {['1M', '3M', '6M', '1Y', '3Y', '5Y', '10Y', '15Y'].map(period => (
                  <th key={period}>{period}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {trailingStats.map(({ scheme, stats }, idx) => (
                <tr key={scheme.schemeCode}>
                  <td className="scheme-name" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <div style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: COLORS[idx % COLORS.length] }} />
                    {scheme.schemeName}
                  </td>
                  {['1M', '3M', '6M', '1Y', '3Y', '5Y', '10Y', '15Y'].map(periodLabel => {
                    const stat = stats ? stats.find(s => s.label === periodLabel) : null;
                    if (!stat || stat.value === 'N/A') return <td key={periodLabel} style={{ color: 'var(--text-secondary)' }}>-</td>;
                    return (
                      <td key={periodLabel} style={{ color: stat.isPositive ? 'var(--success)' : 'var(--danger)', fontWeight: 500 }}>
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

      {/* SRP Ranking Section */}
      <div className="table-container" style={{ marginTop: 'var(--spacing-xl)' }}>
        <button
          onClick={() => {
            if (!showRanking && schemes.length >= 2) {
              setShowRanking(true);
            } else {
              setShowRanking(!showRanking);
            }
          }}
          disabled={schemes.length < 2}
          style={{
            width: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '16px',
            background: 'transparent',
            border: 'none',
            borderBottom: showRanking ? '1px solid var(--panel-border)' : 'none',
            color: schemes.length < 2 ? 'var(--text-secondary)' : 'var(--text-primary)',
            cursor: schemes.length < 2 ? 'not-allowed' : 'pointer',
            fontSize: '1rem',
            fontWeight: 500,
            transition: 'all 0.15s ease'
          }}
          title={schemes.length < 2 ? 'Select at least 2 schemes to rank' : 'SRP Ranking — rank these funds against each other'}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Award size={18} style={{ color: showRanking ? 'var(--accent-primary)' : 'currentColor' }} />
            <span>SRP Ranking</span>
            {schemes.length < 2 && (
              <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', fontWeight: 400 }}>(Select ≥ 2 schemes)</span>
            )}
          </div>
          {showRanking ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
        </button>

        {showRanking && schemes.length >= 2 && (
          <RankingAnalysis
            schemes={schemes}
            analysisPeriod={rankAnalysisPeriod}
            setAnalysisPeriod={setRankAnalysisPeriod}
            rollingWindow={rankRollingWindow}
            setRollingWindow={setRankRollingWindow}
            rankedFunds={rankedFunds}
            setRankedFunds={setRankedFunds}
            isLoading={isRankingLoading}
            setIsLoading={setIsRankingLoading}
            error={rankingError}
            setError={setRankingError}
            config={rankingConfig}
            setConfig={setRankingConfig}
          />
        )}
      </div>
      
      <style>{`
        @keyframes spin { 100% { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
};

export default ComparisonDashboard;

