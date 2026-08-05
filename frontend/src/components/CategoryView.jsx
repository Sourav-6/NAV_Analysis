import React, { useState, useEffect, useRef } from 'react';
import { Loader2, AlertCircle, PlusCircle, ArrowUp, ArrowDown, ArrowUpDown, Check, ChevronDown } from 'lucide-react';
import { getSchemesByCategory, getSchemeNavData, getCategories } from '../utils/api';
import { calculateAllReturns, assignQuartilesByColumn } from '../utils/returns';

const PERIOD_LABELS = {
  '1M': '1M', '3M': '3M', '6M': '6M', '1Y': '1Y', '3Y': '3Y', '5Y': '5Y', '10Y': '10Y', '15Y': '15Y',
  '1Y_AVG': '1Y Avg', '3Y_AVG': '3Y Avg', '5Y_AVG': '5Y Avg'
};

const formatReturn = (val) => {
  if (val === undefined || val === null || val === -Infinity || isNaN(val)) return '-';
  return `${val > 0 ? '+' : ''}${val.toFixed(2)}%`;
};

const getHeatmapStyle = (value) => {
  if (value === -Infinity || value === undefined || isNaN(value)) {
    return { backgroundColor: 'transparent', color: 'var(--text-secondary)' };
  }
  
  // Cap the scaling at 40% absolute return for maximum intensity
  const maxScale = 40; 
  const absVal = Math.abs(value);
  
  // Base alpha 0.1, max 0.5 for scaling
  const alpha = Math.min(absVal / maxScale, 1) * 0.4 + 0.1;
  
  if (value >= 0) {
    return {
      backgroundColor: `rgba(var(--positive-bg-base), ${alpha})`,
      color: 'var(--positive-text)'
    };
  } else {
    return {
      backgroundColor: `rgba(var(--negative-bg-base), ${alpha})`,
      color: 'var(--negative-text)'
    };
  }
};

const CategoryView = ({ onSelectScheme, plan, setPlan, referenceDate }) => {
  const [categoryGroups, setCategoryGroups] = useState({});
  const [activeTabs, setActiveTabs] = useState([]);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const dropdownRef = useRef(null);
  const [tableData, setTableData] = useState([]);
  const [dynamicPeriods, setDynamicPeriods] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState(null);
  const [sortConfig, setSortConfig] = useState({ key: '1Y', direction: 'desc' });

  const handleSort = (key) => {
    let direction = 'desc';
    if (sortConfig.key === key && sortConfig.direction === 'desc') {
      direction = 'asc';
    }
    setSortConfig({ key, direction });
  };

  useEffect(() => {
    let isMounted = true;
    const fetchCategories = async () => {
      const cats = await getCategories();
      if (isMounted) {
        setCategoryGroups(cats);
        // Default to first subcategory of the first main category
        const firstMain = Object.keys(cats)[0];
        if (firstMain && cats[firstMain] && cats[firstMain].length > 0) {
          setActiveTabs([cats[firstMain][0]]);
        }
      }
    };
    fetchCategories();

    const handleClickOutside = (event) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setIsDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      isMounted = false;
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  useEffect(() => {
    let isMounted = true;
    
    const loadCategoryData = async () => {
      if (activeTabs.length === 0) {
        setTableData([]);
        return;
      }
      setIsLoading(true);
      setError(null);
      setTableData([]);
      setProgress(0);

      try {
        // 1. Get filtered schemes (NO limits)
        const schemePromises = activeTabs.map(tab => getSchemesByCategory(tab, plan));
        const resultsArray = await Promise.all(schemePromises);
        
        const targetSchemesMap = new Map();
        resultsArray.flat().forEach(scheme => {
          targetSchemesMap.set(scheme.schemeCode, scheme);
        });
        const targetSchemes = Array.from(targetSchemesMap.values());
        
        if (targetSchemes.length === 0) {
          if (isMounted) setError(`No ${plan} growth funds found for the selected categories.`);
          return;
        }

        // 2. Fetch NAV data in batches to respect API limits (Batch of 15)
        const batchSize = 15;
        const schemesWithReturns = [];
        
        for (let i = 0; i < targetSchemes.length; i += batchSize) {
          if (!isMounted) return;
          
          const batch = targetSchemes.slice(i, i + batchSize);
          const promises = batch.map(async (scheme) => {
            const data = await getSchemeNavData(scheme.schemeCode, referenceDate);
            let returns = {};
            if (data && data.data) {
              returns = calculateAllReturns(data.data, referenceDate);
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
           
           const order = ['1M', '3M', '6M', '1Y', '3Y', '5Y', '10Y', '15Y'];
           const calendar = keys.filter(k => k === 'YTD' || (!isNaN(parseInt(k)) && parseInt(k) > 2000)).sort((a,b) => {
              if(a === 'YTD') return -1;
              if(b === 'YTD') return 1;
              return parseInt(b) - parseInt(a);
           });
           
           const finalPeriods = [...order.filter(o => keys.includes(o)), ...calendar];
           setDynamicPeriods(finalPeriods);
           
           setSortConfig(currentSort => {
             if (currentSort.key !== 'schemeName' && !finalPeriods.includes(currentSort.key)) {
               return { key: finalPeriods[0] || 'schemeName', direction: 'desc' };
             }
             return currentSort;
           });
        }
        
        setTableData(processedData);
        
      } catch (err) {
        if (isMounted) setError("Failed to fetch category data: " + (err.message || err));
        console.error("DEBUG loadCategoryData error:", err);
        fetch('http://localhost:3001/api/log', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: err.message, stack: err.stack }) }).catch(() => {});
      } finally {
        if (isMounted) setIsLoading(false);
      }
    };

    loadCategoryData();
    
    return () => { isMounted = false; };
  }, [activeTabs, plan, referenceDate]);

  const toggleTab = (cat) => {
    setActiveTabs(prev => prev.includes(cat) ? prev.filter(t => t !== cat) : [...prev, cat]);
  };

  const toggleGroup = (groupOptions) => {
    const allSelected = groupOptions.every(opt => activeTabs.includes(opt));
    if (allSelected) {
      const next = activeTabs.filter(c => !groupOptions.includes(c));
      if (next.length > 0) setActiveTabs(next);
    } else {
      setActiveTabs(prev => {
        const next = new Set(prev);
        groupOptions.forEach(opt => next.add(opt));
        return Array.from(next);
      });
    }
  };

  const toggleAllCategories = () => {
    const allOptions = Object.values(categoryGroups).flat();
    const allSelected = allOptions.every(opt => activeTabs.includes(opt));
    if (allSelected) {
      setActiveTabs([allOptions[0]]);
    } else {
      setActiveTabs(allOptions);
    }
  };

  const sortedData = [...tableData].sort((a, b) => {
    if (sortConfig.key === 'schemeName') {
      return sortConfig.direction === 'asc' 
        ? a.schemeName.localeCompare(b.schemeName)
        : b.schemeName.localeCompare(a.schemeName);
    }
    if (sortConfig.key === 'commission') {
      const valA = parseFloat(a.commission) || 0;
      const valB = parseFloat(b.commission) || 0;
      return sortConfig.direction === 'asc' ? valA - valB : valB - valA;
    }
    const valA = a.returns[sortConfig.key];
    const valB = b.returns[sortConfig.key];
    const hasA = valA !== undefined && valA !== -Infinity && !isNaN(valA);
    const hasB = valB !== undefined && valB !== -Infinity && !isNaN(valB);
    if (!hasA && !hasB) return 0;
    if (!hasA) return 1;
    if (!hasB) return -1;
    return sortConfig.direction === 'asc' ? valA - valB : valB - valA;
  });

  return (
    <div className="category-view" style={{ width: '100%', maxWidth: '1200px', margin: '0 auto' }}>
      
      {/* Controls Row */}
      <div className="flex justify-center items-center gap-xl" style={{ marginBottom: 'var(--spacing-xl)', flexWrap: 'wrap' }}>
        
        {/* Dropdown Selector */}
        <div className="multi-select-container" style={{ width: '300px' }} ref={dropdownRef}>
          <div className="multi-select-header" onClick={() => setIsDropdownOpen(!isDropdownOpen)}>
            <span>
              {activeTabs.length === 0 ? 'Select Category' : 
               activeTabs.length === 1 ? activeTabs[0] : 
               `${activeTabs.length} Categories Selected`}
            </span>
            <ChevronDown size={16} style={{ transform: isDropdownOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }} />
          </div>
          
          {isDropdownOpen && (
            <div className="multi-select-dropdown">
              <button
                onClick={toggleAllCategories}
                style={{ width: '100%', background: 'var(--panel-bg)', border: '1px solid var(--panel-border)', padding: '6px', borderRadius: '4px', cursor: 'pointer', fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '4px' }}
              >
                {Object.values(categoryGroups).flat().every(opt => activeTabs.includes(opt)) ? 'Deselect All' : 'Select All'}
              </button>
              {Object.entries(categoryGroups).map(([groupName, categories]) => {
                const allSelected = categories.every(opt => activeTabs.includes(opt));
                const someSelected = categories.some(opt => activeTabs.includes(opt));
                return (
                  <div key={groupName} style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginBottom: '8px' }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', padding: '6px 4px 2px 4px', borderBottom: '1px solid var(--panel-border)', cursor: 'pointer' }}>
                      <input 
                        type="checkbox" 
                        checked={allSelected} 
                        ref={el => { if (el) el.indeterminate = someSelected && !allSelected; }}
                        onChange={() => toggleGroup(categories)} 
                        style={{ cursor: 'pointer' }}
                      />
                      {groupName}
                    </label>
                    {categories.map(category => {
                      const isSelected = activeTabs.includes(category);
                      return (
                        <div 
                          key={category} 
                          className={`multi-select-option ${isSelected ? 'selected' : ''}`}
                          onClick={() => {
                            if (isSelected) {
                              if (activeTabs.length > 1) {
                                setActiveTabs(prev => prev.filter(t => t !== category));
                              }
                            } else {
                              setActiveTabs(prev => [...prev, category]);
                            }
                          }}
                        >
                          <div className="multi-select-checkbox">
                            {isSelected && <Check size={14} strokeWidth={3} />}
                          </div>
                          <span className="multi-select-label">{category}</span>
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Plan Toggle */}
        <div style={{
          display: 'flex',
          background: 'var(--panel-bg)',
          border: '1px solid var(--panel-border)',
          borderRadius: '8px',
          padding: '4px'
        }}>
          <button 
            style={{
              background: plan === 'regular' ? 'var(--panel-border)' : 'transparent',
              color: plan === 'regular' ? 'var(--text-primary)' : 'var(--text-secondary)',
              border: 'none',
              borderRadius: '6px',
              padding: '10px 20px',
              cursor: 'pointer',
              fontSize: '0.9rem',
              fontWeight: plan === 'regular' ? 500 : 400,
              transition: 'all 0.15s ease'
            }}
            onClick={() => setPlan && setPlan('regular')}
          >
            Regular
          </button>
          <button 
            style={{
              background: plan === 'direct' ? 'var(--panel-border)' : 'transparent',
              color: plan === 'direct' ? 'var(--text-primary)' : 'var(--text-secondary)',
              border: 'none',
              borderRadius: '6px',
              padding: '10px 20px',
              cursor: 'pointer',
              fontSize: '0.9rem',
              fontWeight: plan === 'direct' ? 500 : 400,
              transition: 'all 0.15s ease'
            }}
            onClick={() => setPlan && setPlan('direct')}
          >
            Direct
          </button>
        </div>
      </div>

      {/* Loading State */}
      {isLoading && (
        <div className="glass-panel flex-col items-center justify-center gap-md" style={{ padding: '40px' }}>
          <Loader2 size={40} style={{ animation: 'spin 1s linear infinite', color: 'var(--text-primary)' }} />
          <p style={{ color: 'var(--text-secondary)' }}>Analyzing {activeTabs.length} categories... {progress}%</p>
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
        <div className="glass-panel" style={{ padding: 0, overflow: 'hidden', width: '100%' }}>
          <div className="table-container" style={{ maxHeight: 'none', height: 'auto', overflowX: 'auto', border: 'none', borderRadius: 0 }}>
            <table className="data-table" style={{ minWidth: '100%' }}>
            <thead>
              <tr>
                <th 
                  className={`sortable-header ${sortConfig.key === 'schemeName' ? 'active' : ''}`}
                  style={{ textAlign: 'left', left: 0, zIndex: 15, background: 'var(--panel-bg)', minWidth: '300px' }}
                  onClick={() => handleSort('schemeName')}
                >
                  <div className="sortable-header-content">
                    <span>Fund Name ({tableData.length})</span>
                    <span className="sort-icon">
                      {sortConfig.key === 'schemeName' ? (
                        sortConfig.direction === 'asc' ? <ArrowUp size={16} /> : <ArrowDown size={16} />
                      ) : (
                        <ArrowUpDown size={16} />
                      )}
                    </span>
                  </div>
                </th>
                <th 
                  className={`sortable-header ${sortConfig.key === 'commission' ? 'active' : ''}`}
                  style={{ background: 'var(--panel-bg)', minWidth: '70px', padding: '0 8px' }}
                  onClick={() => handleSort('commission')}
                >
                  <div className="sortable-header-content">
                    <span>Commission</span>
                    <span className="sort-icon">
                      {sortConfig.key === 'commission' ? (
                        sortConfig.direction === 'asc' ? <ArrowUp size={16} /> : <ArrowDown size={16} />
                      ) : (
                        <ArrowUpDown size={16} />
                      )}
                    </span>
                  </div>
                </th>
                {dynamicPeriods.map(p => (
                  <th 
                    key={p} 
                    className={`sortable-header ${sortConfig.key === p ? 'active' : ''}`}
                    style={{ background: 'var(--panel-bg)' }}
                    onClick={() => handleSort(p)}
                  >
                    <div className="sortable-header-content">
                      <span>{PERIOD_LABELS[p] || p}</span>
                      <span className="sort-icon">
                        {sortConfig.key === p ? (
                          sortConfig.direction === 'asc' ? <ArrowUp size={16} /> : <ArrowDown size={16} />
                        ) : (
                          <ArrowUpDown size={16} />
                        )}
                      </span>
                    </div>
                  </th>
                ))}
                {/* Filler column to absorb remaining width */}
                <th style={{ width: '100%', background: 'var(--panel-bg)', borderBottom: '1px solid var(--panel-border)' }}></th>
              </tr>
            </thead>
            <tbody>
              {sortedData.map((scheme) => (
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
                  <td 
                    className="cell-value"
                    style={{
                      backgroundColor: 'var(--panel-bg)',
                      color: 'var(--text-secondary)',
                      fontSize: '0.8rem',
                      fontWeight: 500
                    }}
                  >
                    {scheme.commission && scheme.commission !== 'OFF' ? (scheme.commission.includes('%') ? scheme.commission : `${scheme.commission}%`) : '-'}
                  </td>
                  {dynamicPeriods.map(p => {
                    const val = scheme.returns[p];
                    const isMissing = val === -Infinity || val === undefined || isNaN(val);
                    const heatmapStyle = getHeatmapStyle(val);
                    
                    return (
                      <td 
                        key={p} 
                        className={`cell-value`}
                        style={heatmapStyle}
                      >
                        {formatReturn(val)}
                      </td>
                    );
                  })}
                  {/* Filler cell */}
                  <td style={{ width: '100%' }}></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        </div>
      )}
    </div>
  );
};

export default CategoryView;
