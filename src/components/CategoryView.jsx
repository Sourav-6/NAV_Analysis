import React, { useState, useEffect } from 'react';
import { Loader2, AlertCircle, PlusCircle } from 'lucide-react';
import { getSchemesByCategory, getSchemeNavData } from '../utils/api';
import { calculateAllReturns, assignQuartilesByColumn } from '../utils/returns';

const CATEGORY_GROUPS = {
  'Equity': [
    'Large Cap', 'Mid Cap', 'Small Cap', 'Large & Mid Cap', 'Flexi Cap', 'Multi Cap', 'ELSS', 'Focused Fund', 'Value Fund', 'SIF'
  ],
  'Debt / Fixed Income': [
    'Liquid Fund', 'Overnight Fund', 'Money Market Fund', 'Short Duration Fund', 'Corporate Bond Fund', 'Dynamic Bond', 'Gilt Fund'
  ],
  'Hybrid & Other': [
    'Dynamic Asset Allocation', 'Aggressive Hybrid Fund', 'Conservative Hybrid Fund', 'Multi Asset Allocation', 'Index Funds'
  ]
};
const PERIOD_LABELS = {
  '1M': '1M', '3M': '3M', '6M': '6M', '1Y': '1Y', '3Y': '3Y', '5Y': '5Y', '10Y': '10Y',
  '1Y_AVG': '1Y Avg', '3Y_AVG': '3Y Avg', '5Y_AVG': '5Y Avg'
};

const CategoryView = ({ onSelectScheme }) => {
  const [activeTab, setActiveTab] = useState(CATEGORY_GROUPS['Equity'][0]);
  const [tableData, setTableData] = useState([]);
  const [dynamicPeriods, setDynamicPeriods] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState(null);

  useEffect(() => {
    let isMounted = true;
    
    const loadCategoryData = async () => {
      setIsLoading(true);
      setError(null);
      setTableData([]);
      setProgress(0);

      try {
        // 1. Get filtered schemes (NO limits)
        const targetSchemes = await getSchemesByCategory(activeTab);
        
        if (targetSchemes.length === 0) {
          if (isMounted) setError(`No direct growth funds found for ${activeTab}.`);
          return;
        }

        // 2. Fetch NAV data in batches to respect API limits (Batch of 15)
        const batchSize = 15;
        const schemesWithReturns = [];
        
        for (let i = 0; i < targetSchemes.length; i += batchSize) {
          if (!isMounted) return;
          
          const batch = targetSchemes.slice(i, i + batchSize);
          const promises = batch.map(async (scheme) => {
            const data = await getSchemeNavData(scheme.schemeCode);
            let returns = {};
            if (data && data.data) {
              returns = calculateAllReturns(data.data);
            }
            return { ...scheme, returns, navData: data?.data };
          });
          
          const results = await Promise.all(promises);
          schemesWithReturns.push(...results);
          
          if (isMounted) setProgress(Math.round(((i + batch.length) / targetSchemes.length) * 100));
        }

        if (!isMounted) return;

        // 3. Assign Column-based quartiles
        const processedData = assignQuartilesByColumn(schemesWithReturns);
        
        // Determine periods based on keys in the first scheme
        if (processedData.length > 0) {
           const allKeys = Object.keys(processedData[0].returns);
           
           // Only keep keys where at least ONE scheme has actual data
           const keys = allKeys.filter(k => processedData.some(scheme => scheme.returns[k] !== -Infinity));
           
           const order = ['1M', '3M', '6M', '1Y', '3Y', '5Y', '10Y'];
           const calendar = keys.filter(k => k === 'YTD' || (!isNaN(parseInt(k)) && parseInt(k) > 2000)).sort((a,b) => {
              if(a === 'YTD') return -1;
              if(b === 'YTD') return 1;
              return parseInt(b) - parseInt(a);
           });
           
           // Averages are removed as requested
           setDynamicPeriods([...order.filter(o => keys.includes(o)), ...calendar]);
        }
        
        setTableData(processedData);
        
      } catch (err) {
        if (isMounted) setError("Failed to fetch category data.");
        console.error(err);
      } finally {
        if (isMounted) setIsLoading(false);
      }
    };

    loadCategoryData();
    
    return () => { isMounted = false; };
  }, [activeTab]);

  const formatReturn = (val) => {
    if (val === -Infinity || val === undefined || isNaN(val)) return '-';
    return val.toFixed(1);
  };

  return (
    <div className="category-view" style={{ width: '100%', maxWidth: '1200px', margin: '0 auto' }}>
      
      {/* Dropdown Selector */}
      <div className="flex justify-center" style={{ marginBottom: 'var(--spacing-xl)' }}>
        <div style={{ position: 'relative', width: '300px' }}>
          <select
            value={activeTab}
            onChange={(e) => setActiveTab(e.target.value)}
            style={{
              width: '100%',
              padding: '12px 16px',
              fontSize: '1rem',
              backgroundColor: 'var(--panel-bg)',
              color: 'var(--text-primary)',
              border: '1px solid var(--panel-border)',
              borderRadius: '8px',
              outline: 'none',
              cursor: 'pointer',
              appearance: 'none',
              WebkitAppearance: 'none'
            }}
          >
            {Object.entries(CATEGORY_GROUPS).map(([groupName, categories]) => (
              <optgroup key={groupName} label={groupName} style={{ backgroundColor: 'var(--bg-color)' }}>
                {categories.map(category => (
                  <option key={category} value={category}>{category}</option>
                ))}
              </optgroup>
            ))}
          </select>
          <div style={{
            position: 'absolute',
            right: '16px',
            top: '50%',
            transform: 'translateY(-50%)',
            pointerEvents: 'none',
            color: 'var(--text-secondary)'
          }}>
            ▼
          </div>
        </div>
      </div>

      {/* Loading State */}
      {isLoading && (
        <div className="glass-panel flex-col items-center justify-center gap-md" style={{ padding: '40px' }}>
          <Loader2 size={40} style={{ animation: 'spin 1s linear infinite', color: 'var(--text-primary)' }} />
          <p style={{ color: 'var(--text-secondary)' }}>Analyzing {activeTab} schemes... {progress}%</p>
          <div style={{ width: '100%', maxWidth: '300px', height: '4px', background: 'var(--panel-border)', borderRadius: '2px', overflow: 'hidden' }}>
            <div style={{ width: `${progress}%`, height: '100%', background: 'var(--text-primary)', transition: 'width 0.3s ease' }} />
          </div>
        </div>
      )}

      {/* Error State */}
      {error && !isLoading && (
        <div className="glass-panel flex items-center gap-sm" style={{ borderLeft: '4px solid var(--danger)', color: 'var(--danger)', borderRadius: '4px 8px 8px 4px' }}>
          <AlertCircle size={24} />
          <p>{error}</p>
        </div>
      )}

      {/* Data Table */}
      {!isLoading && !error && tableData.length > 0 && (
        <div className="table-container" style={{ maxHeight: '70vh' }}>
          <table className="data-table">
            <thead>
              <tr>
                <th style={{ textAlign: 'left', left: 0, zIndex: 15, background: 'var(--panel-bg)', minWidth: '300px' }}>Fund Name ({tableData.length})</th>
                {dynamicPeriods.map(p => (
                  <th key={p} style={{ background: 'var(--panel-bg)' }}>{PERIOD_LABELS[p] || p}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {tableData.map((scheme) => (
                <tr 
                  key={scheme.schemeCode} 
                  style={{ 
                    cursor: 'pointer',
                    transition: 'transform 0.1s ease',
                  }}
                  onClick={() => onSelectScheme(scheme, scheme.navData)}
                  onMouseEnter={(e) => {
                     e.currentTarget.style.transform = 'scale(0.99)';
                     e.currentTarget.style.boxShadow = 'inset 0 0 0 2px var(--panel-border)';
                  }}
                  onMouseLeave={(e) => {
                     e.currentTarget.style.transform = 'scale(1)';
                     e.currentTarget.style.boxShadow = 'none';
                  }}
                >
                  <td 
                    className="scheme-name" 
                    title={scheme.schemeName}
                    style={{
                      backgroundColor: 'var(--panel-bg)',
                      color: 'var(--text-primary)'
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', paddingRight: '8px' }}>
                        {scheme.schemeName}
                      </span>
                      <span 
                        style={{ 
                          fontSize: '0.65rem', 
                          textTransform: 'uppercase',
                          fontWeight: 600,
                          border: `1px solid var(--text-primary)`, 
                          color: 'var(--text-primary)',
                          padding: '2px 6px', 
                          borderRadius: '10px',
                          opacity: 0.8,
                          display: 'flex',
                          alignItems: 'center',
                          gap: '2px',
                          whiteSpace: 'nowrap'
                        }}
                      >
                        <PlusCircle size={10} /> Add
                      </span>
                    </div>
                  </td>
                  {dynamicPeriods.map(p => {
                    const val = scheme.returns[p];
                    const isMissing = val === -Infinity || val === undefined || isNaN(val);
                    const q = scheme.quartiles[p] || 4; 
                    
                    return (
                      <td 
                        key={p} 
                        className={`cell-value`}
                        style={{
                          backgroundColor: isMissing ? 'transparent' : `var(--q${q}-bg-solid)`,
                          color: isMissing ? 'var(--text-secondary)' : `var(--q${q}-text)`
                        }}
                      >
                        {formatReturn(val)}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

export default CategoryView;
