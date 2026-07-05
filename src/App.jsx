import React, { useState, useEffect } from 'react';
import MultiSelect from './components/MultiSelect';
import ComparisonDashboard from './components/ComparisonDashboard';
import CategoryView from './components/CategoryView';
import { ArrowLeft, Database, Cloud, Clock } from 'lucide-react';
import { getDataStatus } from './utils/api';
import './index.css';

function App() {
  const [selectedSchemes, setSelectedSchemes] = useState([]);
  const [dataStatus, setDataStatus] = useState(null);
  const [showGraph, setShowGraph] = useState(false);
  const [isSplitView, setIsSplitView] = useState(true);

  useEffect(() => {
    getDataStatus().then(setDataStatus);
  }, []);

  const handleAddScheme = (scheme) => {
    setSelectedSchemes(prev => [...prev, scheme]);
    // Automatically show graph when first scheme is added, if desired
    if (selectedSchemes.length === 0) setShowGraph(true);
  };

  const handleRemoveScheme = (schemeCode) => {
    setSelectedSchemes(prev => {
      const next = prev.filter(s => s.schemeCode !== schemeCode);
      if (next.length === 0) setShowGraph(false);
      return next;
    });
  };

  return (
    <div className="container">
      <header style={{ marginBottom: 'var(--spacing-xl)', borderBottom: '1px solid var(--panel-border)', paddingBottom: '24px' }}>
        <h1 style={{ fontSize: '2.5rem', letterSpacing: '-0.04em', marginBottom: '8px' }}>
          NAV Analytics
        </h1>
        <p style={{ color: 'var(--text-secondary)', maxWidth: '600px' }}>
          Compare performance and historical NAV data across multiple mutual funds instantly using your locally cached dataset.
        </p>

        {/* Data Source Status Badge */}
        {dataStatus && (
          <div className="data-status-badge" style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '8px',
            marginTop: '16px',
            padding: '4px 0',
            fontSize: '0.75rem',
            fontWeight: 500,
            color: dataStatus.source === 'local' 
              ? 'var(--success)' 
              : 'var(--text-primary)'
          }}>
            {dataStatus.source === 'local' ? (
              <>
                <div style={{ width: '6px', height: '6px', borderRadius: '50%', background: 'var(--success)' }} />
                <span style={{ color: 'var(--text-primary)' }}>Local Data</span>
                {dataStatus.metadata && (
                  <>
                    <span style={{ opacity: 0.3, color: 'var(--text-primary)' }}>|</span>
                    <span style={{ color: 'var(--text-secondary)' }}>{dataStatus.metadata.totalSchemes?.toLocaleString()} schemes</span>
                    <span style={{ opacity: 0.3, color: 'var(--text-primary)' }}>|</span>
                    <span style={{ color: 'var(--text-secondary)' }}>Updated {dataStatus.metadata.lastNavDate}</span>
                  </>
                )}
              </>
            ) : (
              <>
                <div style={{ width: '6px', height: '6px', borderRadius: '50%', background: 'var(--brand-blue)' }} />
                <span style={{ color: 'var(--text-primary)' }}>Live API (mfapi.in)</span>
              </>
            )}
          </div>
        )}
      </header>

      <main style={{ 
        display: (showGraph && selectedSchemes.length > 0 && isSplitView) ? 'grid' : 'block',
        gridTemplateColumns: (showGraph && selectedSchemes.length > 0 && isSplitView) ? '1fr 45%' : '1fr',
        gap: 'var(--spacing-xl)',
        alignItems: 'start'
      }}>
        {/* Left Column: Search & Selection (or Top Area in Full View) */}
        <div style={{ width: '100%' }}>
          <MultiSelect 
            selectedSchemes={selectedSchemes}
            onAddScheme={handleAddScheme}
            onRemoveScheme={handleRemoveScheme}
          />
          
          {/* If Full View and Graph is showing, we render the graph right below the search bar */}
          {showGraph && selectedSchemes.length > 0 && !isSplitView && (
            <div style={{ width: '100%', marginTop: 'var(--spacing-xl)' }}>
               <div className="flex justify-between items-center" style={{ marginBottom: '16px' }}>
                 <h2 style={{ fontSize: '1.25rem' }}>Comparison</h2>
                 <div className="flex gap-sm">
                   <button 
                     className="btn"
                     style={{
                       border: '1px solid var(--panel-border)',
                       background: 'transparent',
                       color: 'var(--text-primary)',
                       padding: '6px 14px',
                       borderRadius: '6px',
                       fontSize: '0.8rem'
                     }}
                     onClick={() => setIsSplitView(true)}
                   >
                     Split View
                   </button>
                   <button 
                     className="btn"
                     style={{
                       border: '1px solid var(--panel-border)',
                       background: 'var(--panel-border)',
                       color: 'var(--text-primary)',
                       padding: '6px 14px',
                       borderRadius: '6px',
                       fontSize: '0.8rem'
                     }}
                     onClick={() => setShowGraph(false)}
                   >
                     Hide
                   </button>
                 </div>
               </div>
               <ComparisonDashboard schemes={selectedSchemes} />
            </div>
          )}

          <div style={{ marginTop: 'var(--spacing-xl)' }}>
            <div className="flex justify-between items-center" style={{ marginBottom: '16px' }}>
              <h2 style={{ color: 'var(--text-secondary)', fontSize: '1rem', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                {selectedSchemes.length > 0 ? 'Click below to add more schemes' : 'Click a fund below to begin analysis'}
              </h2>
              
              {/* Toggle Buttons - shown here in Split View or when graph is hidden */}
              {selectedSchemes.length > 0 && (!showGraph || isSplitView) && (
                <div className="flex gap-sm">
                  {showGraph && (
                    <button 
                      className="btn"
                      style={{
                        border: '1px solid var(--panel-border)',
                        background: 'transparent',
                        color: 'var(--text-primary)',
                        padding: '6px 14px',
                        borderRadius: '6px',
                        fontSize: '0.8rem'
                      }}
                      onClick={() => setIsSplitView(false)}
                    >
                      Full View
                    </button>
                  )}
                  <button 
                    className="btn"
                    style={{
                      border: '1px solid var(--panel-border)',
                      background: showGraph ? 'var(--panel-border)' : 'transparent',
                      color: showGraph ? 'var(--text-primary)' : 'var(--text-secondary)',
                      padding: '6px 14px',
                      borderRadius: '6px',
                      fontSize: '0.8rem'
                    }}
                    onClick={() => setShowGraph(!showGraph)}
                  >
                    {showGraph ? 'Hide Graph' : 'Show Graph'}
                  </button>
                </div>
              )}
            </div>
            
            <CategoryView onSelectScheme={handleAddScheme} />
          </div>
        </div>

        {/* Right Column: Graph Dashboard (Only in Split View) */}
        {showGraph && selectedSchemes.length > 0 && isSplitView && (
          <div style={{ width: '100%', position: 'sticky', top: '24px' }}>
            <div className="flex justify-between items-center" style={{ marginBottom: '16px' }}>
              <h2 style={{ fontSize: '1.25rem' }}>
                Comparison
              </h2>
            </div>
            <ComparisonDashboard schemes={selectedSchemes} />
          </div>
        )}
      </main>
    </div>
  );
}

export default App;
