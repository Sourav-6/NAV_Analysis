import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Loader2, AlertCircle, Settings, Save, PlusCircle, MinusCircle, Award, Check, X, Info, Search, Trash2, Maximize2, Minimize2 } from 'lucide-react';
import { getRankingConfig, updateRankingConfig, calculateRankings, fetchHistoricalMetrics } from '../utils/api';
import { createChart, CrosshairMode, AreaSeries, LineSeries } from 'lightweight-charts';

const CATEGORY_GROUPS = [
  {
    name: 'Equity',
    options: ['Large Cap', 'Mid Cap', 'Small Cap', 'Large & Mid Cap', 'Flexi Cap', 'Multi Cap', 'ELSS', 'Focused Fund', 'Value Fund', 'Sectoral', 'SIF']
  },
  {
    name: 'Debt / Fixed Income',
    options: ['Liquid Fund', 'Overnight Fund', 'Money Market Fund', 'Short Duration Fund', 'Corporate Bond Fund', 'Dynamic Bond', 'Gilt Fund']
  },
  {
    name: 'Hybrid & Other',
    options: ['Dynamic Asset Allocation', 'Aggressive Hybrid Fund', 'Conservative Hybrid Fund', 'Multi Asset Allocation', 'Index Funds']
  }
];

const PERIOD_OPTIONS = [
  { value: '1Y', label: '1 Year' },
  { value: '3Y', label: '3 Years' },
  { value: '5Y', label: '5 Years' },
  { value: '10Y', label: '10 Years' },
  { value: '15Y', label: '15 Years' }
];

const WINDOW_OPTIONS = [
  { value: '1M', label: '1 Month', years: 1/12 },
  { value: '3M', label: '3 Months', years: 3/12 },
  { value: '1Y', label: '1 Year', years: 1 },
  { value: '3Y', label: '3 Years', years: 3 },
  { value: '5Y', label: '5 Years', years: 5 }
];

const COLORS = [
  '#ef4444', // Red
  '#3b82f6', // Blue
  '#10b981', // Green
  '#f59e0b', // Yellow/Orange
  '#8b5cf6'  // Purple
];

const RankingDashboard = ({ onAddScheme, selectedSchemes = [], plan, referenceDate }) => {
  const [categories, setCategories] = useState([CATEGORY_GROUPS[0].options[0]]);
  const [isCategoryOpen, setIsCategoryOpen] = useState(false);
  const [analysisPeriod, setAnalysisPeriod] = useState('3Y');
  const [rollingWindow, setRollingWindow] = useState('1Y');
  const [localPlan, setLocalPlan] = useState(plan || 'direct');
  
  // Sync with prop if it changes externally
  useEffect(() => {
    if (plan) setLocalPlan(plan);
  }, [plan]);
  
  // Algorithm configuration (weights and risk-free rate)
  const [config, setConfig] = useState({
    weight_rrls_avg_return: 0.25,
    weight_rrls_recent_return: 0.10,
    weight_sortino: 0.35,
    weight_mdd: 0.15,
    weight_ulcer: 0.15,
    risk_free_rate: 0.06
  });

  const [rankedFunds, setRankedFunds] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isSavingConfig, setIsSavingConfig] = useState(false);
  const [error, setError] = useState(null);
  
  const [sortConfig, setSortConfig] = useState({ key: 'overallScore', direction: 'desc' });
  
  // UI Controls
  const [isConfigOpen, setIsConfigOpen] = useState(false);
  const [addedCodes, setAddedCodes] = useState(new Set());

  // Ulcer Index History Modal States
  const [activeMetric, setActiveMetric] = useState(null);
  const [selectedMetricFunds, setSelectedMetricFunds] = useState([]); // Array of { schemeCode, schemeName }
  const [metricHistoryData, setMetricHistoryData] = useState({});
  const [isMetricLoading, setIsMetricLoading] = useState(false);
  const [metricTimeframe, setMetricTimeframe] = useState('ALL');
  const [isMetricSelectOpen, setIsMetricSelectOpen] = useState(false);
  const [metricSearchQuery, setMetricSearchQuery] = useState('');
  const [metricChartHeight, setMetricChartHeight] = useState(420);
  const [isStatsCollapsed, setIsStatsCollapsed] = useState(false);
  const [isMetricFullView, setIsMetricFullView] = useState(false);
  const [isMetricFullViewFundsOpen, setIsMetricFullViewFundsOpen] = useState(false);
  const metricDropdownRef = useRef(null);

  // Close ulcer dropdown on click outside
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (metricDropdownRef.current && !metricDropdownRef.current.contains(e.target)) {
        setIsMetricSelectOpen(false);
      }
    };
    if (isMetricSelectOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isMetricSelectOpen]);

  // Close modal or dropdown on Escape key
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        if (isMetricSelectOpen) {
          setIsMetricSelectOpen(false);
        } else if (selectedMetricFunds.length > 0) {
          setSelectedMetricFunds([]);
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isMetricSelectOpen, selectedMetricFunds]);

  // Compute valid window options based on active Analysis Period
  const validWindowOptions = useMemo(() => {
    const apYears = parseInt(analysisPeriod);
    return WINDOW_OPTIONS.filter(opt => opt.years <= apYears);
  }, [analysisPeriod]);

  // Adjust rolling window if the selected window exceeds the new analysis period
  useEffect(() => {
    const apYears = parseInt(analysisPeriod);
    const selectedOpt = WINDOW_OPTIONS.find(opt => opt.value === rollingWindow);
    
    if (selectedOpt && selectedOpt.years > apYears) {
      // Fallback to highest valid window option
      const validOpts = WINDOW_OPTIONS.filter(opt => opt.years <= apYears);
      if (validOpts.length > 0) {
        setRollingWindow(validOpts[validOpts.length - 1].value);
      }
    }
  }, [analysisPeriod, rollingWindow]);

  // Load configuration from database on mount
  useEffect(() => {
    getRankingConfig().then(savedConfig => {
      if (savedConfig) {
        setConfig(savedConfig);
      }
    });
  }, []);

  // Sync addedCodes with selectedSchemes prop
  useEffect(() => {
    if (Array.isArray(selectedSchemes)) {
      setAddedCodes(new Set(selectedSchemes.map(s => s.schemeCode)));
    }
  }, [selectedSchemes]);

  // Calculate rankings when inputs or saved configs change
  // Uses a request counter to prevent stale responses from overwriting newer ones
  const requestIdRef = React.useRef(0);

  useEffect(() => {
    const currentRequestId = ++requestIdRef.current;
    setIsLoading(true);
    setError(null);

    calculateRankings({
      categories,
      plan: localPlan,
      analysisPeriod,
      rollingWindow,
      config,
      referenceDate
    }).then(data => {
      // Only update if this is still the latest request
      if (currentRequestId === requestIdRef.current) {
        setRankedFunds(data);
        setIsLoading(false);
      }
    }).catch(err => {
      if (currentRequestId === requestIdRef.current) {
        console.error(err);
        setError('Failed to compute fund rankings. Please ensure NAV history data is fully synced.');
        setIsLoading(false);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [categories, analysisPeriod, rollingWindow, localPlan, referenceDate]);

  const sortedFunds = useMemo(() => {
    let sortableItems = [...rankedFunds];
    if (sortConfig.key) {
      sortableItems.sort((a, b) => {
        if (a[sortConfig.key] < b[sortConfig.key]) {
          return sortConfig.direction === 'asc' ? -1 : 1;
        }
        if (a[sortConfig.key] > b[sortConfig.key]) {
          return sortConfig.direction === 'asc' ? 1 : -1;
        }
        return 0;
      });
    }
    return sortableItems;
  }, [rankedFunds, sortConfig]);

  const requestSort = (key) => {
    let direction = 'desc';
    if (sortConfig.key === key && sortConfig.direction === 'desc') {
      direction = 'asc';
    }
    setSortConfig({ key, direction });
  };

  const getColorForScore = (score) => {
    const hue = (score / 100) * 120; // 0 is Red, 120 is Green
    return `hsl(${hue}, 70%, 40%)`;
  };

  const getMetricTitle = (metric) => {
    switch (metric) {
      case 'dailyLeadership': return 'Rolling Daily Leadership';
      case 'recentLeadership': return 'Rolling Recent Leadership';
      case 'sortinoScore': return 'Rolling Sortino Ratio';
      case 'mddScore': return 'Rolling Maximum Drawdown';
      case 'ulcerScore': return 'Rolling Ulcer Index (Drawdown Distress)';
      default: return 'Rolling Metric';
    }
  };

  const renderMetricCell = (fund, metricKey, title) => (
    <td style={{ textAlign: 'center' }}>
      <span 
        onClick={() => {
          setActiveMetric(metricKey);
          setSelectedMetricFunds([{ schemeCode: fund.schemeCode, schemeName: fund.schemeName }]);
        }}
        title={`Click to view ${title} chart`}
        style={{ 
          display: 'inline-block', 
          padding: '4px 8px', 
          borderRadius: '4px', 
          color: '#fff', 
          fontWeight: 600, 
          fontSize: '0.85rem', 
          backgroundColor: getColorForScore(fund[metricKey]),
          cursor: 'pointer',
          transition: 'all 0.15s ease',
          userSelect: 'none'
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.transform = 'scale(1.05)';
          e.currentTarget.style.boxShadow = `0 0 8px ${getColorForScore(fund[metricKey]).replace('hsl', 'hsla').replace(')', ', 0.4)')}`;
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.transform = 'scale(1)';
          e.currentTarget.style.boxShadow = 'none';
        }}
      >
        {fund[metricKey].toFixed(1)}
      </span>
    </td>
  );

  // Fetch rolling historical metrics when funds are selected for deep analysis
  useEffect(() => {
    if (!selectedMetricFunds || selectedMetricFunds.length === 0 || !activeMetric) {
      setMetricHistoryData({});
      setMetricTimeframe('ALL');
      return;
    }
    
    setIsMetricLoading(true);
    
    fetchHistoricalMetrics({
      categories,
      plan: localPlan,
      analysisPeriod,
      rollingWindow,
      referenceDate,
      schemeCodes: selectedMetricFunds.map(f => f.schemeCode)
    }).then(results => {
      const newHistoryData = {};
      selectedMetricFunds.forEach(fund => {
        if (results[fund.schemeCode]) {
          newHistoryData[fund.schemeCode] = results[fund.schemeCode].map(entry => {
            const parts = entry.date.split('-');
            const timeStr = `${parts[2]}-${parts[1]}-${parts[0]}`;
            
            let val = 0;
            if (activeMetric === 'dailyLeadership' || activeMetric === 'recentLeadership') val = entry.p_return;
            else if (activeMetric === 'sortinoScore') val = entry.p_sortino;
            else if (activeMetric === 'mddScore') val = entry.p_mdd;
            else if (activeMetric === 'ulcerScore') val = entry.p_ulcer;
            
            return {
              time: timeStr,
              value: val
            };
          });
        }
      });
      setMetricHistoryData(newHistoryData);
    }).catch(err => {
      console.error('Error fetching historical metrics:', err);
    }).finally(() => {
      setIsMetricLoading(false);
    });
  }, [selectedMetricFunds, activeMetric, categories, localPlan, analysisPeriod, rollingWindow, referenceDate]);

  const TIMEFRAME_VALUES = useMemo(() => ({
    '1M': 1/12, '3M': 3/12, '6M': 6/12, '1Y': 1, '3Y': 3, '5Y': 5, '10Y': 10
  }), []);

  const availableTimeframes = useMemo(() => {
    const maxYears = parseInt(analysisPeriod);
    return ['1M', '3M', '6M', '1Y', '3Y', '5Y', '10Y', 'ALL'].filter(tf => {
      if (tf === 'ALL') return true;
      return TIMEFRAME_VALUES[tf] <= maxYears;
    });
  }, [analysisPeriod, TIMEFRAME_VALUES]);

  const filteredUlcerData = useMemo(() => {
    if (!metricHistoryData || Object.keys(metricHistoryData).length === 0) return {};
    
    const result = {};
    const primaryFund = selectedMetricFunds[0];
    if (!primaryFund || !metricHistoryData[primaryFund.schemeCode] || metricHistoryData[primaryFund.schemeCode].length === 0) return {};

    const primaryHistory = metricHistoryData[primaryFund.schemeCode];
    const latestTimeStr = primaryHistory[primaryHistory.length - 1].time;
    const parts = latestTimeStr.split('-');
    const latestDate = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
    
    let cutoffDate = new Date(latestDate);
    if (metricTimeframe === '1M') cutoffDate.setMonth(cutoffDate.getMonth() - 1);
    else if (metricTimeframe === '3M') cutoffDate.setMonth(cutoffDate.getMonth() - 3);
    else if (metricTimeframe === '6M') cutoffDate.setMonth(cutoffDate.getMonth() - 6);
    else if (metricTimeframe === '1Y') cutoffDate.setFullYear(cutoffDate.getFullYear() - 1);
    else if (metricTimeframe === '3Y') cutoffDate.setFullYear(cutoffDate.getFullYear() - 3);
    else if (metricTimeframe === '5Y') cutoffDate.setFullYear(cutoffDate.getFullYear() - 5);
    else if (metricTimeframe === '10Y') cutoffDate.setFullYear(cutoffDate.getFullYear() - 10);
    
    selectedMetricFunds.forEach(fund => {
      const history = metricHistoryData[fund.schemeCode] || [];
      if (metricTimeframe === 'ALL') {
        result[fund.schemeCode] = history;
      } else {
        result[fund.schemeCode] = history.filter(item => {
          const iparts = item.time.split('-');
          const itemDate = new Date(parseInt(iparts[0]), parseInt(iparts[1]) - 1, parseInt(iparts[2]));
          return itemDate >= cutoffDate;
        });
      }
    });

    return result;
  }, [metricHistoryData, metricTimeframe, selectedMetricFunds]);

  const mergedUlcerDataMap = useMemo(() => {
    const map = {};
    Object.keys(filteredUlcerData).forEach(schemeCode => {
      filteredUlcerData[schemeCode].forEach(item => {
        const timeStr = item.time;
        if (!map[timeStr]) map[timeStr] = { originalDate: timeStr };
        map[timeStr][schemeCode] = item.value;
      });
    });
    return map;
  }, [filteredUlcerData]);

  const ulcerStats = useMemo(() => {
    const stats = {};
    selectedMetricFunds.forEach(fund => {
      const data = filteredUlcerData[fund.schemeCode] || [];
      if (data.length === 0) {
        stats[fund.schemeCode] = { latest: 0, average: 0, max: 0 };
        return;
      }
      const latest = data[data.length - 1].value;
      const sum = data.reduce((acc, curr) => acc + curr.value, 0);
      const average = sum / data.length;
      const max = Math.max(...data.map(h => h.value));
      stats[fund.schemeCode] = { latest, average, max };
    });
    return stats;
  }, [filteredUlcerData, selectedMetricFunds]);

  // TradingView Lightweight Chart Container references
  const ulcerChartRef = useRef(null);
  const ulcerChartInstance = useRef(null);
  const ulcerSeriesMap = useRef({});

  useEffect(() => {
    if (!selectedMetricFunds || selectedMetricFunds.length === 0 || !ulcerChartRef.current) return;
    
    // Make sure we have at least some data before rendering
    const hasData = selectedMetricFunds.some(f => filteredUlcerData[f.schemeCode] && filteredUlcerData[f.schemeCode].length > 0);
    if (!hasData) return;

    let chart = null;
    let resizeObserver = null;

    const timer = setTimeout(() => {
      if (!ulcerChartRef.current) return;

      const isDark = document.documentElement.getAttribute('data-theme') === 'dark';

      try {
        if (ulcerChartInstance.current) {
          ulcerChartInstance.current.remove();
          ulcerChartInstance.current = null;
          ulcerSeriesMap.current = {};
        }
      } catch(e) {}

      try {
        chart = createChart(ulcerChartRef.current, {
          autoSize: true,
          layout: {
            background: { type: 'solid', color: 'transparent' },
            textColor: isDark ? '#a3a3a3' : '#6b7280',
            attributionLogo: false,
          },
          grid: {
            vertLines: { color: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)' },
            horzLines: { color: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)' },
          },
          crosshair: {
            mode: CrosshairMode.Magnet,
          },
          rightPriceScale: {
            borderColor: isDark ? '#262626' : '#e5e7eb',
            scaleMargins: { top: 0.1, bottom: 0.1 },
          },
          timeScale: {
            borderColor: isDark ? '#262626' : '#e5e7eb',
            timeVisible: true,
          },
        });

        ulcerChartInstance.current = chart;
        ulcerSeriesMap.current = {};

        selectedMetricFunds.forEach((fund, index) => {
          const rawData = filteredUlcerData[fund.schemeCode];
          if (!rawData || rawData.length === 0) return;

          const color = COLORS[index % COLORS.length];

          // Use LineSeries for multiple funds
          const series = chart.addSeries(LineSeries, {
            color: color,
            lineWidth: 2,
            crosshairMarkerVisible: true,
            priceFormat: {
              type: 'custom',
              formatter: (price) => `${price.toFixed(2)}`,
            },
          });

          const uniqueDataMap = new Map();
          rawData.forEach(item => {
            uniqueDataMap.set(item.time, item.value);
          });

          const formattedData = Array.from(uniqueDataMap.entries()).map(([time, value]) => ({
            time,
            value
          }));

          formattedData.sort((a, b) => a.time.localeCompare(b.time));
          series.setData(formattedData);
          ulcerSeriesMap.current[fund.schemeCode] = series;
        });

        // Tooltip logic
        let tooltip = document.getElementById('ulcer-tooltip');
        if (!tooltip) {
          tooltip = document.createElement('div');
          tooltip.id = 'ulcer-tooltip';
          tooltip.style.position = 'absolute';
          tooltip.style.display = 'none';
          tooltip.style.padding = '8px';
          tooltip.style.boxSizing = 'border-box';
          tooltip.style.fontSize = '12px';
          tooltip.style.textAlign = 'left';
          tooltip.style.zIndex = '1000';
          tooltip.style.pointerEvents = 'none';
          tooltip.style.border = '1px solid var(--panel-border)';
          tooltip.style.boxShadow = '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)';
          tooltip.style.borderRadius = '8px';
          tooltip.style.backgroundColor = isDark ? '#1a1a1a' : '#ffffff';
          tooltip.style.color = isDark ? '#e5e5e5' : '#111827';
          ulcerChartRef.current.appendChild(tooltip);
        }

        chart.subscribeCrosshairMove(param => {
          if (
            param.point === undefined ||
            !param.time ||
            param.point.x < 0 ||
            param.point.x > ulcerChartRef.current.clientWidth ||
            param.point.y < 0 ||
            param.point.y > ulcerChartRef.current.clientHeight
          ) {
            tooltip.style.display = 'none';
            return;
          }

          const dateStr = param.time;
          const dataPoint = mergedUlcerDataMap[dateStr];
          if (!dataPoint) return;

          let html = `<div style="font-weight:600; margin-bottom:8px; border-bottom:1px solid var(--panel-border); padding-bottom:4px; color:var(--text-primary);">${dataPoint.originalDate}</div>`;
          
          selectedMetricFunds.forEach((fund, index) => {
            const val = dataPoint[fund.schemeCode];
            if (val !== undefined) {
              const color = COLORS[index % COLORS.length];
              html += `<div style="display:flex; justify-content:space-between; gap:16px; font-size:13px; margin-bottom:4px;">
                <span style="color:${color}">${fund.schemeName}</span>
                <span style="font-weight:600">${val.toFixed(2)}</span>
              </div>`;
            }
          });

          tooltip.innerHTML = html;
          tooltip.style.display = 'block';

          const y = param.point.y;
          let x = param.point.x + 15;
          if (x > ulcerChartRef.current.clientWidth - 200) {
            x = param.point.x - 215;
          }
          
          tooltip.style.left = x + 'px';
          tooltip.style.top = y + 'px';
        });

        // Explicitly fit content to frame at initial load
        chart.timeScale().fitContent();
      } catch (err) {
        console.error('Error creating ulcer index lightweight chart:', err);
      }
    }, 50);

    return () => {
      clearTimeout(timer);
      if (resizeObserver) {
        resizeObserver.disconnect();
      }
      const tooltip = document.getElementById('ulcer-tooltip');
      if (tooltip) tooltip.remove();

      if (ulcerChartInstance.current) {
        try {
          ulcerChartInstance.current.remove();
        } catch (e) {}
        ulcerChartInstance.current = null;
        ulcerSeriesMap.current = {};
      }
    };
  }, [selectedMetricFunds, filteredUlcerData, metricChartHeight, isMetricFullView]);

  // Update weights in the database
  const handleSaveConfig = async (e) => {
    e.preventDefault();
    setIsSavingConfig(true);
    try {
      const sum = (
        config.weight_rrls_avg_return +
        config.weight_rrls_recent_return +
        config.weight_sortino +
        config.weight_mdd +
        config.weight_ulcer
      );
      
      // Allow +/- 0.001 margin for float precision
      if (Math.abs(sum - 1.0) > 0.001) {
        alert(`All weights must sum exactly to 100% (currently ${(sum * 100).toFixed(1)}%).`);
        return;
      }

      await updateRankingConfig(config);
      setIsConfigOpen(false);
      // Re-trigger calculation by bumping the request counter
      requestIdRef.current++;
      const currentRequestId = ++requestIdRef.current;
      setIsLoading(true);
      setError(null);
      calculateRankings({ categories, plan: localPlan, analysisPeriod, rollingWindow, config })
        .then(data => { if (currentRequestId === requestIdRef.current) { setRankedFunds(data); setIsLoading(false); } })
        .catch(err => { if (currentRequestId === requestIdRef.current) { console.error(err); setError('Failed to compute fund rankings.'); setIsLoading(false); } });
    } catch (err) {
      console.error(err);
      alert('Failed to save configuration.');
    } finally {
      setIsSavingConfig(false);
    }
  };

  const handleWeightChange = (key, val) => {
    setConfig(prev => ({
      ...prev,
      [key]: parseFloat(val) || 0
    }));
  };

  const toggleCategory = (cat) => {
    if (categories.includes(cat)) {
      if (categories.length > 1) { // prevent empty selection
        setCategories(categories.filter(c => c !== cat));
      }
    } else {
      setCategories([...categories, cat]);
    }
  };

  // Helper for rendering percentile badges
  const getPercentileClass = (score) => {
    if (score >= 75) return 'q1';
    if (score >= 50) return 'q2';
    if (score >= 25) return 'q3';
    return 'q4';
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-xl)', width: '100%' }}>
      {/* Parameters panel */}
      <div className="glass-panel" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 'var(--spacing-md)', flexWrap: 'wrap' }}>
        <div className="flex gap-md" style={{ flexWrap: 'wrap', alignItems: 'center' }}>
          {/* Category Dropdown */}
          <div className="flex-col gap-xs" style={{ position: 'relative', zIndex: 50 }}>
            <span style={{ fontSize: '0.75rem', fontWeight: 500, color: 'var(--text-secondary)', textTransform: 'uppercase' }}>Category</span>
            <button 
              onClick={() => setIsCategoryOpen(!isCategoryOpen)}
              style={{
                background: 'var(--bg-color)',
                border: '1px solid var(--panel-border)',
                color: 'var(--text-primary)',
                padding: '8px 16px',
                borderRadius: '6px',
                fontSize: '0.9rem',
                cursor: 'pointer',
                outline: 'none',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                minWidth: '160px',
                justifyContent: 'space-between',
                whiteSpace: 'nowrap'
              }}
            >
              {categories.length === 1 ? categories[0] : `${categories.length} Categories`}
              <span style={{ fontSize: '0.7rem' }}>▼</span>
            </button>
            {isCategoryOpen && (
              <>
                <div 
                  style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 9998 }} 
                  onClick={() => setIsCategoryOpen(false)}
                />
                <div style={{
                  position: 'absolute',
                  top: '100%',
                  left: 0,
                  marginTop: '4px',
                  background: 'var(--bg-color)',
                  border: '1px solid var(--panel-border)',
                  borderRadius: '6px',
                  padding: '8px',
                  zIndex: 9999,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '6px',
                  maxHeight: '300px',
                  overflowY: 'auto',
                  minWidth: '220px',
                  boxShadow: '0 4px 12px rgba(0,0,0,0.2)'
                }}>
                  {CATEGORY_GROUPS.map(group => (
                    <div key={group.name} style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                      <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', padding: '6px 4px 2px 4px', borderBottom: '1px solid var(--panel-border)' }}>
                        {group.name}
                      </div>
                      {group.options.map(opt => (
                        <label key={opt} style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.9rem', color: 'var(--text-primary)', cursor: 'pointer', padding: '4px', whiteSpace: 'nowrap' }}>
                          <input 
                            type="checkbox" 
                            checked={categories.includes(opt)} 
                            onChange={() => toggleCategory(opt)} 
                            style={{ cursor: 'pointer' }}
                          />
                          {opt}
                        </label>
                      ))}
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>

          {/* Analysis Period Dropdown */}
          <div className="flex-col gap-xs">
            <span style={{ fontSize: '0.75rem', fontWeight: 500, color: 'var(--text-secondary)', textTransform: 'uppercase' }}>Analysis Period</span>
            <select 
              value={analysisPeriod}
              onChange={(e) => setAnalysisPeriod(e.target.value)}
              style={{
                background: 'var(--bg-color)',
                border: '1px solid var(--panel-border)',
                color: 'var(--text-primary)',
                padding: '8px 16px',
                borderRadius: '6px',
                fontSize: '0.9rem',
                cursor: 'pointer',
                outline: 'none'
              }}
            >
              {PERIOD_OPTIONS.map(opt => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>

          {/* Rolling Window Dropdown */}
          <div className="flex-col gap-xs">
            <span style={{ fontSize: '0.75rem', fontWeight: 500, color: 'var(--text-secondary)', textTransform: 'uppercase' }}>Rolling Window</span>
            <select 
              value={rollingWindow}
              onChange={(e) => setRollingWindow(e.target.value)}
              style={{
                background: 'var(--bg-color)',
                border: '1px solid var(--panel-border)',
                color: 'var(--text-primary)',
                padding: '8px 16px',
                borderRadius: '6px',
                fontSize: '0.9rem',
                cursor: 'pointer',
                outline: 'none'
              }}
            >
              {validWindowOptions.map(opt => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>
          
          {/* Plan Toggle */}
          <div className="flex-col gap-xs">
            <span style={{ fontSize: '0.75rem', fontWeight: 500, color: 'var(--text-secondary)', textTransform: 'uppercase' }}>Plan</span>
            <div style={{ display: 'flex', background: 'var(--bg-color)', border: '1px solid var(--panel-border)', borderRadius: '6px', padding: '2px', height: '100%', minHeight: '35px' }}>
              <button
                onClick={() => setLocalPlan('direct')}
                style={{
                  flex: 1, padding: '4px 16px', border: 'none', outline: 'none', cursor: 'pointer', fontSize: '0.9rem',
                  background: localPlan === 'direct' ? 'var(--panel-bg)' : 'transparent',
                  color: localPlan === 'direct' ? 'var(--text-primary)' : 'var(--text-secondary)',
                  fontWeight: localPlan === 'direct' ? 500 : 400,
                  borderRadius: '4px',
                  boxShadow: localPlan === 'direct' ? '0 1px 2px rgba(0,0,0,0.05)' : 'none',
                  transition: 'all 0.2s ease',
                  display: 'flex', alignItems: 'center', justifyContent: 'center'
                }}
              >
                Direct
              </button>
              <button
                onClick={() => setLocalPlan('regular')}
                style={{
                  flex: 1, padding: '4px 16px', border: 'none', outline: 'none', cursor: 'pointer', fontSize: '0.9rem',
                  background: localPlan === 'regular' ? 'var(--panel-bg)' : 'transparent',
                  color: localPlan === 'regular' ? 'var(--text-primary)' : 'var(--text-secondary)',
                  fontWeight: localPlan === 'regular' ? 500 : 400,
                  borderRadius: '4px',
                  boxShadow: localPlan === 'regular' ? '0 1px 2px rgba(0,0,0,0.05)' : 'none',
                  transition: 'all 0.2s ease',
                  display: 'flex', alignItems: 'center', justifyContent: 'center'
                }}
              >
                Regular
              </button>
            </div>
          </div>
        </div>

        {/* Configure Weights Button */}
        <button 
          className="btn flex items-center gap-xs"
          style={{
            background: isConfigOpen ? 'var(--panel-border-hover)' : 'var(--panel-bg)',
            border: '1px solid var(--panel-border)',
            color: 'var(--text-primary)',
            padding: '10px 16px',
            borderRadius: '6px',
            cursor: 'pointer',
            fontWeight: 500,
            fontSize: '0.85rem'
          }}
          onClick={() => setIsConfigOpen(!isConfigOpen)}
        >
          <Settings size={16} />
          Adjust Weights
        </button>
      </div>

      {/* Adjust Weights Dialog / Panel */}
      {isConfigOpen && (
        <form onSubmit={handleSaveConfig} className="glass-panel" style={{ borderLeft: '4px solid var(--accent-primary)', display: 'flex', flexDirection: 'column', gap: 'var(--spacing-md)' }}>
          <h4 style={{ fontSize: '1rem', fontWeight: 600 }}>Algorithm Weight Allocation (Must sum to 100%)</h4>
          
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 'var(--spacing-md)' }}>
            <div className="flex-col gap-xs">
              <label style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Daily Leadership Score (%)</label>
              <input 
                type="number" step="1" min="0" max="100"
                value={Math.round(config.weight_rrls_avg_return * 100)}
                onChange={(e) => handleWeightChange('weight_rrls_avg_return', parseFloat(e.target.value) / 100)}
                style={{ background: 'var(--bg-color)', border: '1px solid var(--panel-border)', color: 'var(--text-primary)', padding: '8px', borderRadius: '6px' }}
              />
            </div>
            
            <div className="flex-col gap-xs">
              <label style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Recent Daily Leadership (%)</label>
              <input 
                type="number" step="1" min="0" max="100"
                value={Math.round(config.weight_rrls_recent_return * 100)}
                onChange={(e) => handleWeightChange('weight_rrls_recent_return', parseFloat(e.target.value) / 100)}
                style={{ background: 'var(--bg-color)', border: '1px solid var(--panel-border)', color: 'var(--text-primary)', padding: '8px', borderRadius: '6px' }}
              />
            </div>
            
            <div className="flex-col gap-xs">
              <label style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Rolling Sortino Score (%)</label>
              <input 
                type="number" step="1" min="0" max="100"
                value={Math.round(config.weight_sortino * 100)}
                onChange={(e) => handleWeightChange('weight_sortino', parseFloat(e.target.value) / 100)}
                style={{ background: 'var(--bg-color)', border: '1px solid var(--panel-border)', color: 'var(--text-primary)', padding: '8px', borderRadius: '6px' }}
              />
            </div>
            
            <div className="flex-col gap-xs">
              <label style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Rolling Max Drawdown (%)</label>
              <input 
                type="number" step="1" min="0" max="100"
                value={Math.round(config.weight_mdd * 100)}
                onChange={(e) => handleWeightChange('weight_mdd', parseFloat(e.target.value) / 100)}
                style={{ background: 'var(--bg-color)', border: '1px solid var(--panel-border)', color: 'var(--text-primary)', padding: '8px', borderRadius: '6px' }}
              />
            </div>
            
            <div className="flex-col gap-xs">
              <label style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Rolling Ulcer Index (%)</label>
              <input 
                type="number" step="1" min="0" max="100"
                value={Math.round(config.weight_ulcer * 100)}
                onChange={(e) => handleWeightChange('weight_ulcer', parseFloat(e.target.value) / 100)}
                style={{ background: 'var(--bg-color)', border: '1px solid var(--panel-border)', color: 'var(--text-primary)', padding: '8px', borderRadius: '6px' }}
              />
            </div>

            <div className="flex-col gap-xs">
              <label style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Risk-Free Rate (Annualized %)</label>
              <input 
                type="number" step="0.5" min="0" max="20"
                value={config.risk_free_rate * 100}
                onChange={(e) => handleWeightChange('risk_free_rate', parseFloat(e.target.value) / 100)}
                style={{ background: 'var(--bg-color)', border: '1px solid var(--panel-border)', color: 'var(--text-primary)', padding: '8px', borderRadius: '6px' }}
              />
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--spacing-sm)', marginTop: '8px' }}>
            <button 
              type="button" 
              className="btn" 
              style={{ background: 'transparent', border: '1px solid var(--panel-border)', padding: '8px 16px', borderRadius: '6px', cursor: 'pointer' }}
              onClick={() => setIsConfigOpen(false)}
            >
              Cancel
            </button>
            <button 
              type="submit" 
              className="btn flex items-center gap-xs" 
              disabled={isSavingConfig}
              style={{ background: 'var(--accent-primary)', color: 'var(--bg-color)', border: 'none', padding: '8px 20px', borderRadius: '6px', cursor: 'pointer', fontWeight: 600 }}
            >
              {isSavingConfig ? (
                <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} />
              ) : (
                <Save size={16} />
              )}
              Save Configuration
            </button>
          </div>
        </form>
      )}

      {/* Main Ranking View */}
      {isLoading ? (
        <div className="glass-panel flex-col items-center justify-center gap-md" style={{ padding: '60px 0' }}>
          <Loader2 size={40} style={{ animation: 'spin 1s linear infinite', color: 'var(--accent-primary)' }} />
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.95rem' }}>Computing rolling window percentiles... (This scans millions of data points)</p>
        </div>
      ) : error ? (
        <div className="glass-panel flex items-center gap-sm" style={{ borderLeft: '4px solid var(--danger)', color: 'var(--danger)' }}>
          <AlertCircle size={24} />
          <p>{error}</p>
        </div>
      ) : rankedFunds.length === 0 ? (
        <div className="glass-panel text-center" style={{ padding: '40px 0', color: 'var(--text-secondary)' }}>
          No funds in this category have complete historical NAV data covering the selected {analysisPeriod} Analysis Period.
        </div>
      ) : (
        <div className="glass-panel" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ padding: '16px 24px', borderBottom: '1px solid var(--panel-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <h3 style={{ fontSize: '1.1rem', fontWeight: 600 }}>SRP Ranking ({rankedFunds.length} Funds)</h3>
              <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '2px' }}>
                Sorted by Overall Score descending based on weights (RRLS Avg: {Math.round(config.weight_rrls_avg_return*100)}% | RRLS Recent: {Math.round(config.weight_rrls_recent_return*100)}% | Sortino: {Math.round(config.weight_sortino*100)}% | MDD: {Math.round(config.weight_mdd*100)}% | Ulcer: {Math.round(config.weight_ulcer*100)}%)
              </p>
            </div>
          </div>
          
          <div className="table-container" style={{ overflowX: 'auto' }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th style={{ width: '60px', textAlign: 'center' }}>Rank</th>
                  <th style={{ textAlign: 'left', minWidth: '250px', cursor: 'pointer' }} onClick={() => requestSort('schemeName')}>Fund Name {sortConfig.key === 'schemeName' ? (sortConfig.direction === 'asc' ? '↑' : '↓') : ''}</th>
                  <th style={{ textAlign: 'center', cursor: 'pointer' }} onClick={() => requestSort('analysisPeriodReturn')}>Period Return {sortConfig.key === 'analysisPeriodReturn' ? (sortConfig.direction === 'asc' ? '↑' : '↓') : ''}</th>
                  <th style={{ textAlign: 'center', cursor: 'pointer' }} onClick={() => requestSort('overallScore')}>Overall Score {sortConfig.key === 'overallScore' ? (sortConfig.direction === 'asc' ? '↑' : '↓') : ''}</th>
                  <th style={{ textAlign: 'center', cursor: 'pointer' }} onClick={() => requestSort('dailyLeadership')}>Daily Leadership {sortConfig.key === 'dailyLeadership' ? (sortConfig.direction === 'asc' ? '↑' : '↓') : ''}</th>
                  <th style={{ textAlign: 'center', cursor: 'pointer' }} onClick={() => requestSort('recentLeadership')}>Recent Leadership {sortConfig.key === 'recentLeadership' ? (sortConfig.direction === 'asc' ? '↑' : '↓') : ''}</th>
                  <th style={{ textAlign: 'center', cursor: 'pointer' }} onClick={() => requestSort('sortinoScore')}>Rolling Sortino {sortConfig.key === 'sortinoScore' ? (sortConfig.direction === 'asc' ? '↑' : '↓') : ''}</th>
                  <th style={{ textAlign: 'center', cursor: 'pointer' }} onClick={() => requestSort('mddScore')}>Rolling Max DD {sortConfig.key === 'mddScore' ? (sortConfig.direction === 'asc' ? '↑' : '↓') : ''}</th>
                  <th style={{ textAlign: 'center', cursor: 'pointer' }} onClick={() => requestSort('ulcerScore')}>Rolling Ulcer {sortConfig.key === 'ulcerScore' ? (sortConfig.direction === 'asc' ? '↑' : '↓') : ''}</th>
                  <th style={{ width: '100px', textAlign: 'center' }}>Action</th>
                </tr>
              </thead>
              <tbody>
                {sortedFunds.map((fund, idx) => {
                  const isAdded = addedCodes.has(fund.schemeCode);
                  const isTopRanked = idx < 3;
                  return (
                    <tr key={fund.schemeCode}>
                      <td style={{ textAlign: 'center', fontWeight: 600 }}>
                        {isTopRanked ? (
                          <div style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', color: idx === 0 ? '#d4af37' : idx === 1 ? '#c0c0c0' : '#cd7f32' }}>
                            <Award size={16} />
                            {idx + 1}
                          </div>
                        ) : (
                          idx + 1
                        )}
                      </td>
                      <td className="scheme-name" style={{ textAlign: 'left', fontWeight: 500 }}>
                        {fund.schemeName}
                      </td>
                      <td style={{ textAlign: 'center', fontWeight: 600, color: fund.analysisPeriodReturn >= 0 ? 'var(--success)' : 'var(--danger)' }}>
                        {fund.analysisPeriodReturn?.toFixed(2)}%
                      </td>
                      <td style={{ textAlign: 'center', fontWeight: 700, fontSize: '0.95rem', color: 'var(--brand-blue)' }}>
                        {fund.overallScore.toFixed(1)}
                      </td>
                      
                      {/* Sub-scores mapping to color gradients */}
                      {renderMetricCell(fund, 'dailyLeadership', 'Daily Leadership')}
                      {renderMetricCell(fund, 'recentLeadership', 'Recent Leadership')}
                      {renderMetricCell(fund, 'sortinoScore', 'Sortino Ratio')}
                      {renderMetricCell(fund, 'mddScore', 'Maximum Drawdown')}
                      {renderMetricCell(fund, 'ulcerScore', 'Ulcer Index')}
                      
                      <td style={{ textAlign: 'center' }}>
                        <button
                          className={`add-scheme-btn ${isAdded ? 'added' : ''}`}
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: '4px',
                            background: isAdded ? 'var(--panel-border)' : 'var(--panel-bg)',
                            color: isAdded ? 'var(--text-secondary)' : 'var(--text-primary)',
                            border: '1px solid var(--panel-border)',
                            padding: '6px 12px',
                            borderRadius: '6px',
                            cursor: isAdded ? 'default' : 'pointer',
                            fontSize: '0.75rem',
                            fontWeight: 500,
                            transition: 'all 0.15s ease',
                            width: '90px'
                          }}
                          onClick={() => {
                            if (!isAdded) {
                              onAddScheme({
                                schemeCode: fund.schemeCode,
                                schemeName: fund.schemeName
                              });
                            }
                          }}
                          disabled={isAdded}
                        >
                          {isAdded ? (
                            <>
                              <Check size={12} />
                              Added
                            </>
                          ) : (
                            <>
                              <PlusCircle size={12} />
                              Compare
                            </>
                          )}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Rolling Ulcer Index Historical Modal */}
      {selectedMetricFunds.length > 0 && (
        <div 
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setSelectedMetricFunds([]);
            }
          }}
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.75)',
            backdropFilter: 'blur(8px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 99999,
            padding: '16px'
          }}>
          <div className="glass-panel" style={{
            width: '100%',
            maxWidth: isMetricFullView ? '98vw' : '960px',
            height: isMetricFullView ? '96vh' : 'auto',
            maxHeight: isMetricFullView ? '96vh' : '92vh',
            background: 'var(--panel-bg)',
            border: '1px solid var(--panel-border)',
            borderRadius: '16px',
            boxShadow: '0 20px 40px rgba(0, 0, 0, 0.4)',
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column',
            position: 'relative',
            transition: 'all 0.25s ease'
          }}>
            {/* Modal Header - Sticky at top */}
            {!isMetricFullView && (
            <div style={{
              padding: '16px 24px',
              borderBottom: '1px solid var(--panel-border)',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'flex-start',
              position: 'sticky',
              top: 0,
              zIndex: 100,
              background: 'var(--panel-bg)',
              flexShrink: 0
            }}>
              <div>
                <h2 style={{ fontSize: '1.25rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <Award style={{ color: 'var(--accent-primary)' }} size={22} />
                  {getMetricTitle(activeMetric)} over Time
                </h2>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginTop: '12px', flexWrap: 'wrap' }}>
                  <div style={{ position: 'relative' }} ref={metricDropdownRef}>
                    <button 
                      onClick={() => setIsMetricSelectOpen(!isMetricSelectOpen)}
                      style={{
                        background: 'var(--bg-color)',
                        border: '1px solid var(--panel-border)',
                        color: 'var(--text-primary)',
                        padding: '6px 12px',
                        borderRadius: '6px',
                        fontSize: '0.85rem',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px'
                      }}
                    >
                      <PlusCircle size={14} /> Add Fund to Compare ({selectedMetricFunds.length}/5)
                    </button>
                    {isMetricSelectOpen && (
                      <div style={{
                        position: 'absolute',
                        top: '100%',
                        left: 0,
                        marginTop: '4px',
                        background: 'var(--panel-bg)',
                        border: '1px solid var(--panel-border)',
                        borderRadius: '10px',
                        boxShadow: '0 10px 25px rgba(0,0,0,0.3)',
                        zIndex: 100000,
                        width: '360px',
                        maxHeight: '320px',
                        overflowY: 'auto'
                      }}>
                        {/* Search Input Box */}
                        <div style={{
                          padding: '8px 12px',
                          borderBottom: '1px solid var(--panel-border)',
                          position: 'sticky',
                          top: 0,
                          background: 'var(--panel-bg)',
                          zIndex: 2
                        }}>
                          <div style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '8px',
                            background: 'var(--bg-color)',
                            padding: '6px 10px',
                            borderRadius: '6px',
                            border: '1px solid var(--panel-border)'
                          }}>
                            <Search size={14} style={{ color: 'var(--text-secondary)' }} />
                            <input 
                              type="text"
                              placeholder="Search fund name..."
                              value={metricSearchQuery}
                              onChange={(e) => setMetricSearchQuery(e.target.value)}
                              style={{
                                background: 'none',
                                border: 'none',
                                color: 'var(--text-primary)',
                                fontSize: '0.8rem',
                                width: '100%',
                                outline: 'none'
                              }}
                            />
                            {metricSearchQuery && (
                              <X size={14} style={{ cursor: 'pointer', color: 'var(--text-secondary)' }} onClick={() => setMetricSearchQuery('')} />
                            )}
                          </div>
                        </div>

                        {/* Filtered Funds List */}
                        {rankedFunds
                          .filter(fund => fund.schemeName.toLowerCase().includes(metricSearchQuery.toLowerCase()))
                          .map(fund => {
                            const isSelected = selectedMetricFunds.some(s => s.schemeCode === fund.schemeCode);
                            return (
                              <div 
                                key={fund.schemeCode}
                                onClick={() => {
                                  if (isSelected) {
                                    setSelectedMetricFunds(prev => prev.filter(s => s.schemeCode !== fund.schemeCode));
                                  } else {
                                    if (selectedMetricFunds.length < 5) {
                                      setSelectedMetricFunds(prev => [...prev, { schemeCode: fund.schemeCode, schemeName: fund.schemeName }]);
                                    }
                                  }
                                }}
                                style={{
                                  padding: '10px 16px',
                                  cursor: selectedMetricFunds.length >= 5 && !isSelected ? 'not-allowed' : 'pointer',
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'space-between',
                                  borderBottom: '1px solid var(--panel-border)',
                                  background: isSelected ? 'var(--panel-border)' : 'transparent',
                                  opacity: selectedMetricFunds.length >= 5 && !isSelected ? 0.5 : 1
                                }}
                              >
                                <span style={{ fontSize: '0.8rem', fontWeight: isSelected ? 600 : 400 }}>{fund.schemeName}</span>
                                {isSelected && <Check size={14} style={{ color: 'var(--accent-primary)' }} />}
                              </div>
                            );
                          })}
                      </div>
                    )}
                  </div>

                  {/* Full View Button trigger when multiple funds are selected */}
                  {selectedMetricFunds.length > 1 && (
                    <button
                      onClick={() => setIsMetricFullView(!isMetricFullView)}
                      style={{
                        background: isMetricFullView ? 'var(--accent-primary)' : 'linear-gradient(135deg, rgba(59, 130, 246, 0.12), rgba(239, 68, 68, 0.12))',
                        border: '1px solid var(--accent-primary)',
                        color: isMetricFullView ? '#ffffff' : 'var(--text-primary)',
                        padding: '6px 12px',
                        borderRadius: '6px',
                        fontSize: '0.82rem',
                        fontWeight: 600,
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px'
                      }}
                    >
                      {isMetricFullView ? <Minimize2 size={14} /> : <Maximize2 size={14} style={{ color: 'var(--accent-primary)' }} />}
                      {isMetricFullView ? 'Exit Full View' : `Full View (${selectedMetricFunds.length} Funds)`}
                    </button>
                  )}

                  <span style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
                    ({analysisPeriod} Analysis, {rollingWindow} Rolling Window)
                  </span>
                </div>

                {/* Selected Active Fund Badges */}
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginTop: '12px' }}>
                  {selectedMetricFunds.map((fund, idx) => {
                    const color = COLORS[idx % COLORS.length];
                    return (
                      <div key={fund.schemeCode} style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px',
                        background: 'var(--panel-border)',
                        padding: '4px 10px',
                        borderRadius: '20px',
                        fontSize: '0.78rem',
                        fontWeight: 500,
                        color: 'var(--text-primary)',
                        border: `1px solid ${color}60`
                      }}>
                        <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: color }} />
                        <span>{fund.schemeName}</span>
                        {selectedMetricFunds.length > 1 && (
                          <button
                            title="Remove fund"
                            onClick={() => setSelectedMetricFunds(prev => prev.filter(s => s.schemeCode !== fund.schemeCode))}
                            style={{
                              background: 'none',
                              border: 'none',
                              color: 'var(--text-secondary)',
                              cursor: 'pointer',
                              display: 'flex',
                              alignItems: 'center',
                              padding: '2px',
                              marginLeft: '2px'
                            }}
                          >
                            <X size={13} />
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <button
                  onClick={() => setIsMetricFullView(!isMetricFullView)}
                  title={isMetricFullView ? "Exit Full View" : "Full Screen View"}
                  style={{
                    background: isMetricFullView ? 'var(--accent-primary)' : 'var(--panel-border)',
                    border: '1px solid var(--panel-border)',
                    color: isMetricFullView ? '#ffffff' : 'var(--text-primary)',
                    padding: '6px 12px',
                    borderRadius: '8px',
                    fontSize: '0.82rem',
                    fontWeight: 600,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    whiteSpace: 'nowrap'
                  }}
                >
                  {isMetricFullView ? (
                    <>
                      <Minimize2 size={16} /> Exit Full View
                    </>
                  ) : (
                    <>
                      <Maximize2 size={16} /> Full View
                    </>
                  )}
                </button>

                <button 
                  onClick={() => {
                    setIsMetricFullView(false);
                    setSelectedMetricFunds([]);
                  }}
                  title="Close modal (Esc)"
                  style={{
                    background: 'none',
                    border: 'none',
                    color: 'var(--text-secondary)',
                    cursor: 'pointer',
                    padding: '6px',
                    borderRadius: '50%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    transition: 'background 0.2s'
                  }}
                  onMouseEnter={(e) => e.currentTarget.style.background = 'var(--panel-border)'}
                  onMouseLeave={(e) => e.currentTarget.style.background = 'none'}
                >
                  <X size={22} />
                </button>
              </div>
            </div>
            )}

            {/* Modal Content Body - Scrollable */}
            <div style={{ padding: isMetricFullView ? '0' : '20px 24px', display: 'flex', flexDirection: 'column', gap: isMetricFullView ? '0' : '16px', flex: 1, overflowY: 'auto' }}>
              {isMetricLoading ? (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', flex: 1, minHeight: '300px', gap: '12px' }}>
                  <Loader2 size={40} style={{ animation: 'spin 1s linear infinite', color: 'var(--accent-primary)' }} />
                  <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>Computing rolling drawdowns...</p>
                </div>
              ) : Object.keys(metricHistoryData).length === 0 ? (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 1, minHeight: '300px', color: 'var(--text-secondary)' }}>
                  No rolling data available for the selected period.
                </div>
              ) : (
                <>
                  {/* Graph Layout & Height Controls Bar */}
                  {!isMetricFullView && (
                  <div style={{
                    display: 'flex',
                    justify: 'flex-end',
                    alignItems: 'center',
                    background: 'var(--panel-border)',
                    padding: '6px 12px',
                    borderRadius: '8px',
                    gap: '12px'
                  }}>
                    <button
                      onClick={() => setIsStatsCollapsed(!isStatsCollapsed)}
                      style={{
                        padding: '4px 12px',
                        fontSize: '0.75rem',
                        background: isStatsCollapsed ? 'var(--accent-primary)' : 'var(--panel-bg)',
                        color: isStatsCollapsed ? '#ffffff' : 'var(--text-primary)',
                        border: '1px solid var(--panel-border)',
                        borderRadius: '4px',
                        cursor: 'pointer',
                        fontWeight: 600
                      }}
                    >
                      {isStatsCollapsed ? 'Show Stats Table' : 'Hide Stats Table (Max Graph)'}
                    </button>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '4px', background: 'var(--panel-bg)', padding: '2px 4px', borderRadius: '6px', border: '1px solid var(--panel-border)' }}>
                      <span style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', padding: '0 4px' }}>Chart Height:</span>
                      {[
                        { label: 'Compact', value: 300 },
                        { label: 'Normal', value: 420 },
                        { label: 'Tall', value: 540 }
                      ].map(h => (
                        <button
                          key={h.value}
                          onClick={() => setMetricChartHeight(h.value)}
                          style={{
                            padding: '3px 8px',
                            fontSize: '0.72rem',
                            background: metricChartHeight === h.value ? 'var(--panel-border)' : 'transparent',
                            color: metricChartHeight === h.value ? 'var(--text-primary)' : 'var(--text-secondary)',
                            border: 'none',
                            borderRadius: '4px',
                            cursor: 'pointer',
                            fontWeight: metricChartHeight === h.value ? 600 : 400
                          }}
                        >
                          {h.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  )}

                  {/* Collapsible Stats Summary Grid */}
                  {(!isStatsCollapsed && !isMetricFullView) && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr repeat(3, 110px) 36px', gap: '16px', padding: '0 16px', color: 'var(--text-secondary)', fontSize: '0.7rem', textTransform: 'uppercase', fontWeight: 600 }}>
                        <div>Fund</div>
                        <div style={{ textAlign: 'right' }}>Latest UI</div>
                        <div style={{ textAlign: 'right' }}>Average UI</div>
                        <div style={{ textAlign: 'right' }}>Max UI</div>
                        <div></div>
                      </div>
                      {selectedMetricFunds.map((fund, idx) => {
                        const stats = ulcerStats[fund.schemeCode] || { latest: 0, average: 0, max: 0 };
                        const color = COLORS[idx % COLORS.length];
                        return (
                          <div key={fund.schemeCode} style={{
                            background: 'var(--panel-border)',
                            padding: '10px 16px',
                            borderRadius: '8px',
                            display: 'grid',
                            gridTemplateColumns: '1fr repeat(3, 110px) 36px',
                            gap: '16px',
                            alignItems: 'center'
                          }}>
                            <div style={{ fontSize: '0.82rem', fontWeight: 600, color: color, display: 'flex', alignItems: 'center', gap: '8px' }}>
                              <span style={{ width: '10px', height: '10px', borderRadius: '50%', background: color, flexShrink: 0 }} />
                              <span>{fund.schemeName}</span>
                            </div>
                            <div style={{ fontSize: '1.05rem', fontWeight: 700, textAlign: 'right', color: 'var(--text-primary)' }}>
                              {stats.latest.toFixed(2)}
                            </div>
                            <div style={{ fontSize: '1.05rem', fontWeight: 700, textAlign: 'right', color: 'var(--text-primary)' }}>
                              {stats.average.toFixed(2)}
                            </div>
                            <div style={{ fontSize: '1.05rem', fontWeight: 700, textAlign: 'right', color: 'var(--danger)' }}>
                              {stats.max.toFixed(2)}
                            </div>
                            <div>
                              {selectedMetricFunds.length > 1 && (
                                <button 
                                  title="Remove fund from comparison"
                                  onClick={() => setSelectedMetricFunds(prev => prev.filter(s => s.schemeCode !== fund.schemeCode))}
                                  style={{
                                    background: 'rgba(239, 68, 68, 0.1)',
                                    border: '1px solid rgba(239, 68, 68, 0.2)',
                                    color: '#ef4444',
                                    borderRadius: '6px',
                                    padding: '6px',
                                    cursor: 'pointer',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    marginLeft: 'auto'
                                  }}
                                >
                                  <Trash2 size={13} />
                                </button>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {/* Timeframe Buttons Row */}
                  {!isMetricFullView && (
                  <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', marginTop: '10px' }}>
                    <div className="flex gap-sm" style={{ background: 'var(--panel-border)', padding: '4px', borderRadius: '6px', border: '1px solid var(--panel-border)' }}>
                      {availableTimeframes.map(tf => (
                        <button 
                          key={tf}
                          className="btn"
                          style={{ 
                            padding: '4px 10px', fontSize: '0.8rem',
                            background: metricTimeframe === tf ? 'var(--panel-bg)' : 'transparent',
                            color: metricTimeframe === tf ? 'var(--text-primary)' : 'var(--text-secondary)',
                            border: 'none', borderRadius: '4px',
                            cursor: 'pointer',
                            fontWeight: metricTimeframe === tf ? 600 : 400
                          }}
                          onClick={() => setMetricTimeframe(tf)}
                        >
                          {tf}
                        </button>
                      ))}
                    </div>
                  </div>
                  )}

                  {/* Lightweight Chart Container */}
                  <div style={{ 
                    height: isMetricFullView ? '100%' : `${metricChartHeight}px`, 
                    flex: isMetricFullView ? 1 : 'none',
                    width: '100%', 
                    position: 'relative', 
                    transition: 'all 0.2s ease' 
                  }}>
                    {isMetricFullView && (
                      <>
                        
                        {/* Manage Funds Toggle Button */}
                        <button
                          onClick={() => setIsMetricFullViewFundsOpen(!isMetricFullViewFundsOpen)}
                          style={{
                            position: 'absolute',
                            top: '16px',
                            left: '16px',
                            zIndex: 10000,
                            background: isMetricFullViewFundsOpen ? 'var(--accent-primary)' : 'rgba(0, 0, 0, 0.65)',
                            backdropFilter: 'blur(4px)',
                            color: '#fff',
                            border: isMetricFullViewFundsOpen ? '1px solid var(--accent-primary)' : '1px solid rgba(255, 255, 255, 0.2)',
                            padding: '8px 16px',
                            borderRadius: '8px',
                            fontSize: '0.85rem',
                            fontWeight: 600,
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '6px',
                            boxShadow: '0 4px 12px rgba(0,0,0,0.3)'
                          }}
                        >
                          <Settings size={16} /> Manage Funds
                        </button>

                        {/* Floating Add Fund Search & Badges */}
                        {isMetricFullViewFundsOpen && (
                        <div style={{
                          position: 'absolute',
                          top: '64px',
                          left: '16px',
                          zIndex: 10000,
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '8px',
                          background: 'rgba(0, 0, 0, 0.65)',
                          backdropFilter: 'blur(6px)',
                          padding: '12px',
                          borderRadius: '12px',
                          border: '1px solid rgba(255, 255, 255, 0.15)',
                          maxWidth: '80%',
                          boxShadow: '0 8px 24px rgba(0,0,0,0.4)'
                        }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginTop: '0', flexWrap: 'wrap' }}>
                  <div style={{ position: 'relative' }} ref={metricDropdownRef}>
                    <button 
                      onClick={() => setIsMetricSelectOpen(!isMetricSelectOpen)}
                      style={{
                        background: 'var(--bg-color)',
                        border: '1px solid var(--panel-border)',
                        color: 'var(--text-primary)',
                        padding: '6px 12px',
                        borderRadius: '6px',
                        fontSize: '0.85rem',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px'
                      }}
                    >
                      <PlusCircle size={14} /> Add Fund to Compare ({selectedMetricFunds.length}/5)
                    </button>
                    {isMetricSelectOpen && (
                      <div style={{
                        position: 'absolute',
                        top: '100%',
                        left: 0,
                        marginTop: '4px',
                        background: 'var(--panel-bg)',
                        border: '1px solid var(--panel-border)',
                        borderRadius: '10px',
                        boxShadow: '0 10px 25px rgba(0,0,0,0.3)',
                        zIndex: 100000,
                        width: '360px',
                        maxHeight: '320px',
                        overflowY: 'auto'
                      }}>
                        {/* Search Input Box */}
                        <div style={{
                          padding: '8px 12px',
                          borderBottom: '1px solid var(--panel-border)',
                          position: 'sticky',
                          top: 0,
                          background: 'var(--panel-bg)',
                          zIndex: 2
                        }}>
                          <div style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '8px',
                            background: 'var(--bg-color)',
                            padding: '6px 10px',
                            borderRadius: '6px',
                            border: '1px solid var(--panel-border)'
                          }}>
                            <Search size={14} style={{ color: 'var(--text-secondary)' }} />
                            <input 
                              type="text"
                              placeholder="Search fund name..."
                              value={metricSearchQuery}
                              onChange={(e) => setMetricSearchQuery(e.target.value)}
                              style={{
                                background: 'none',
                                border: 'none',
                                color: 'var(--text-primary)',
                                fontSize: '0.8rem',
                                width: '100%',
                                outline: 'none'
                              }}
                            />
                            {metricSearchQuery && (
                              <X size={14} style={{ cursor: 'pointer', color: 'var(--text-secondary)' }} onClick={() => setMetricSearchQuery('')} />
                            )}
                          </div>
                        </div>

                        {/* Filtered Funds List */}
                        {rankedFunds
                          .filter(fund => fund.schemeName.toLowerCase().includes(metricSearchQuery.toLowerCase()))
                          .map(fund => {
                            const isSelected = selectedMetricFunds.some(s => s.schemeCode === fund.schemeCode);
                            return (
                              <div 
                                key={fund.schemeCode}
                                onClick={() => {
                                  if (isSelected) {
                                    setSelectedMetricFunds(prev => prev.filter(s => s.schemeCode !== fund.schemeCode));
                                  } else {
                                    if (selectedMetricFunds.length < 5) {
                                      setSelectedMetricFunds(prev => [...prev, { schemeCode: fund.schemeCode, schemeName: fund.schemeName }]);
                                    }
                                  }
                                }}
                                style={{
                                  padding: '10px 16px',
                                  cursor: selectedMetricFunds.length >= 5 && !isSelected ? 'not-allowed' : 'pointer',
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'space-between',
                                  borderBottom: '1px solid var(--panel-border)',
                                  background: isSelected ? 'var(--panel-border)' : 'transparent',
                                  opacity: selectedMetricFunds.length >= 5 && !isSelected ? 0.5 : 1
                                }}
                              >
                                <span style={{ fontSize: '0.8rem', fontWeight: isSelected ? 600 : 400 }}>{fund.schemeName}</span>
                                {isSelected && <Check size={14} style={{ color: 'var(--accent-primary)' }} />}
                              </div>
                            );
                          })}
                      </div>
                    )}
                  </div>

                  {/* Full View Button trigger when multiple funds are selected */}
                  {selectedMetricFunds.length > 1 && (
                    <button
                      onClick={() => setIsMetricFullView(!isMetricFullView)}
                      style={{
                        background: isMetricFullView ? 'var(--accent-primary)' : 'linear-gradient(135deg, rgba(59, 130, 246, 0.12), rgba(239, 68, 68, 0.12))',
                        border: '1px solid var(--accent-primary)',
                        color: isMetricFullView ? '#ffffff' : 'var(--text-primary)',
                        padding: '6px 12px',
                        borderRadius: '6px',
                        fontSize: '0.82rem',
                        fontWeight: 600,
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px'
                      }}
                    >
                      {isMetricFullView ? <Minimize2 size={14} /> : <Maximize2 size={14} style={{ color: 'var(--accent-primary)' }} />}
                      {isMetricFullView ? 'Exit Full View' : `Full View (${selectedMetricFunds.length} Funds)`}
                    </button>
                  )}

                  <span style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
                    ({analysisPeriod} Analysis, {rollingWindow} Rolling Window)
                  </span>
                </div>

                {/* Selected Active Fund Badges */}
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginTop: '0' }}>
                  {selectedMetricFunds.map((fund, idx) => {
                    const color = COLORS[idx % COLORS.length];
                    return (
                      <div key={fund.schemeCode} style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px',
                        background: 'var(--panel-border)',
                        padding: '4px 10px',
                        borderRadius: '20px',
                        fontSize: '0.78rem',
                        fontWeight: 500,
                        color: 'var(--text-primary)',
                        border: `1px solid ${color}60`
                      }}>
                        <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: color }} />
                        <span>{fund.schemeName}</span>
                        {selectedMetricFunds.length > 1 && (
                          <button
                            title="Remove fund"
                            onClick={() => setSelectedMetricFunds(prev => prev.filter(s => s.schemeCode !== fund.schemeCode))}
                            style={{
                              background: 'none',
                              border: 'none',
                              color: 'var(--text-secondary)',
                              cursor: 'pointer',
                              display: 'flex',
                              alignItems: 'center',
                              padding: '2px',
                              marginLeft: '2px'
                            }}
                          >
                            <X size={13} />
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
              )}

              {/* Floating Exit Button */}
              <button
                onClick={() => setIsMetricFullView(false)}
                          style={{
                            position: 'absolute',
                            top: '16px',
                            right: '16px',
                            zIndex: 10000,
                            background: 'rgba(0, 0, 0, 0.6)',
                            backdropFilter: 'blur(4px)',
                            color: '#fff',
                            border: '1px solid rgba(255, 255, 255, 0.2)',
                            padding: '8px 16px',
                            borderRadius: '8px',
                            fontSize: '0.85rem',
                            fontWeight: 600,
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '6px',
                            boxShadow: '0 4px 12px rgba(0,0,0,0.3)'
                          }}
                        >
                          <Minimize2 size={16} /> Exit Full View
                        </button>

                        {/* Floating Timeframe Presets */}
                        <div style={{
                          position: 'absolute',
                          bottom: '24px',
                          left: '50%',
                          transform: 'translateX(-50%)',
                          zIndex: 10000,
                          display: 'flex',
                          background: 'rgba(0, 0, 0, 0.65)',
                          backdropFilter: 'blur(6px)',
                          padding: '6px',
                          borderRadius: '10px',
                          border: '1px solid rgba(255, 255, 255, 0.15)',
                          boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
                          gap: '2px'
                        }}>
                          {availableTimeframes.map(tf => (
                            <button 
                              key={tf}
                              style={{ 
                                padding: '6px 14px', 
                                fontSize: '0.85rem',
                                background: metricTimeframe === tf ? 'rgba(255, 255, 255, 0.25)' : 'transparent',
                                color: metricTimeframe === tf ? '#ffffff' : 'rgba(255,255,255,0.7)',
                                border: 'none', 
                                borderRadius: '6px',
                                cursor: 'pointer',
                                fontWeight: metricTimeframe === tf ? 600 : 500,
                                transition: 'all 0.2s ease',
                                whiteSpace: 'nowrap'
                              }}
                              onMouseEnter={(e) => {
                                if (metricTimeframe !== tf) e.currentTarget.style.background = 'rgba(255, 255, 255, 0.1)';
                              }}
                              onMouseLeave={(e) => {
                                if (metricTimeframe !== tf) e.currentTarget.style.background = 'transparent';
                              }}
                              onClick={() => setMetricTimeframe(tf)}
                            >
                              {tf}
                            </button>
                          ))}
                        </div>
                      </>
                    )}
                    <div ref={ulcerChartRef} style={{ width: '100%', height: '100%' }} />
                  </div>
                  
                  {/* Modal Footer Controls */}
                  {!isMetricFullView && (
                  <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', marginTop: '12px' }}>
                    <button
                      onClick={() => setSelectedMetricFunds([])}
                      style={{
                        background: 'var(--panel-border)',
                        color: 'var(--text-primary)',
                        border: '1px solid var(--panel-border)',
                        padding: '8px 18px',
                        borderRadius: '8px',
                        fontSize: '0.85rem',
                        fontWeight: 600,
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px'
                      }}
                    >
                      <X size={16} /> Close Analysis
                    </button>
                  </div>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default RankingDashboard;
