import React, { useState, useEffect, useMemo } from 'react';
import { Loader2, AlertCircle, Settings, Save, PlusCircle, Award, Check } from 'lucide-react';
import { getRankingConfig, updateRankingConfig, calculateRankings } from '../utils/api';

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

const RankingDashboard = ({ onAddScheme, selectedSchemes = [], plan }) => {
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
  
  // UI Controls
  const [isConfigOpen, setIsConfigOpen] = useState(false);
  const [addedCodes, setAddedCodes] = useState(new Set());

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
      config
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
  }, [categories, analysisPeriod, rollingWindow, localPlan]);

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
                  <th style={{ textAlign: 'left', minWidth: '250px' }}>Fund Name</th>
                  <th style={{ textAlign: 'center' }}>Period Return</th>
                  <th style={{ textAlign: 'center' }}>Overall Score</th>
                  <th style={{ textAlign: 'center' }}>Daily Leadership</th>
                  <th style={{ textAlign: 'center' }}>Recent Leadership</th>
                  <th style={{ textAlign: 'center' }}>Rolling Sortino</th>
                  <th style={{ textAlign: 'center' }}>Rolling Max DD</th>
                  <th style={{ textAlign: 'center' }}>Rolling Ulcer</th>
                  <th style={{ width: '100px', textAlign: 'center' }}>Action</th>
                </tr>
              </thead>
              <tbody>
                {rankedFunds.map((fund, idx) => {
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
                      
                      {/* Sub-scores mapping to quartile classes */}
                      <td style={{ textAlign: 'center' }}>
                        <span className={`quartile-badge ${getPercentileClass(fund.dailyLeadership)}`}>
                          {fund.dailyLeadership.toFixed(1)}
                        </span>
                      </td>
                      <td style={{ textAlign: 'center' }}>
                        <span className={`quartile-badge ${getPercentileClass(fund.recentLeadership)}`}>
                          {fund.recentLeadership.toFixed(1)}
                        </span>
                      </td>
                      <td style={{ textAlign: 'center' }}>
                        <span className={`quartile-badge ${getPercentileClass(fund.sortinoScore)}`}>
                          {fund.sortinoScore.toFixed(1)}
                        </span>
                      </td>
                      <td style={{ textAlign: 'center' }}>
                        <span className={`quartile-badge ${getPercentileClass(fund.mddScore)}`}>
                          {fund.mddScore.toFixed(1)}
                        </span>
                      </td>
                      <td style={{ textAlign: 'center' }}>
                        <span className={`quartile-badge ${getPercentileClass(fund.ulcerScore)}`}>
                          {fund.ulcerScore.toFixed(1)}
                        </span>
                      </td>
                      
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
    </div>
  );
};

export default RankingDashboard;
