import React, { useState, useEffect, useMemo } from 'react';
import { Loader2, AlertCircle, Settings, Save, PlusCircle, Award, Check } from 'lucide-react';
import { getRankingConfig, updateRankingConfig, calculateRankings } from '../utils/api';

const CATEGORY_OPTIONS = [
  'Large Cap',
  'Mid Cap',
  'Small Cap',
  'Flexi Cap',
  'SIF'
];

const PERIOD_OPTIONS = [
  { value: '1Y', label: '1 Year' },
  { value: '3Y', label: '3 Years' },
  { value: '5Y', label: '5 Years' },
  { value: '10Y', label: '10 Years' }
];

const WINDOW_OPTIONS = [
  { value: '1M', label: '1 Month', years: 1/12 },
  { value: '3M', label: '3 Months', years: 3/12 },
  { value: '1Y', label: '1 Year', years: 1 },
  { value: '3Y', label: '3 Years', years: 3 },
  { value: '5Y', label: '5 Years', years: 5 }
];

const RankingDashboard = ({ onAddScheme, selectedSchemes = [], plan }) => {
  const [category, setCategory] = useState(CATEGORY_OPTIONS[0]);
  const [analysisPeriod, setAnalysisPeriod] = useState('3Y');
  const [rollingWindow, setRollingWindow] = useState('1Y');
  
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
  const handleCalculate = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await calculateRankings({
        category,
        plan,
        analysisPeriod,
        rollingWindow,
        // Send config overrides in body
        config
      });
      setRankedFunds(data);
    } catch (err) {
      console.error(err);
      setError('Failed to compute fund rankings. Please ensure NAV history data is fully synced.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    handleCalculate();
  }, [category, plan, analysisPeriod, rollingWindow]);

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
      // Re-trigger calculation
      handleCalculate();
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
          <div className="flex-col gap-xs">
            <span style={{ fontSize: '0.75rem', fontWeight: 500, color: 'var(--text-secondary)', textTransform: 'uppercase' }}>Category</span>
            <select 
              value={category}
              onChange={(e) => setCategory(e.target.value)}
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
              {CATEGORY_OPTIONS.map(opt => (
                <option key={opt} value={opt}>{opt}</option>
              ))}
            </select>
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
