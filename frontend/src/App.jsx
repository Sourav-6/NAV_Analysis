import React, { useState, useEffect } from 'react';
import MultiSelect from './components/MultiSelect';
import ComparisonDashboard from './components/ComparisonDashboard';
import CategoryView from './components/CategoryView';
import RankingDashboard from './components/RankingDashboard';
import { Moon, Sun, RefreshCw, BarChart2, Award, Bell } from 'lucide-react';
import { getDataStatus, getNotifications, markNotificationsRead } from './utils/api';
import './index.css';

function App() {
  const [selectedSchemes, setSelectedSchemes] = useState([]);
  const [activeView, setActiveView] = useState('comparison'); // 'comparison' or 'ranking'
  const [dataStatus, setDataStatus] = useState(null);
  const [showGraph, setShowGraph] = useState(false);
  const [isSplitView, setIsSplitView] = useState(false);
  const [theme, setTheme] = useState(() => {
    const saved = localStorage.getItem('theme');
    if (saved) return saved;
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  });
  const [plan, setPlan] = useState('regular');
  const [isUpdating, setIsUpdating] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [referenceDate, setReferenceDate] = useState('');
  
  const [notifications, setNotifications] = useState([]);
  const [showNotifications, setShowNotifications] = useState(false);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('theme', theme);
  }, [theme]);


  const loadNotifications = async () => {
    const notifs = await getNotifications();
    setNotifications(notifs);
  };

  useEffect(() => {
    getDataStatus().then(status => {
      setDataStatus(status);
      if (status?.isUpdating) setIsUpdating(true);
      if (status?.isSyncing) setIsSyncing(true);
    });
    loadNotifications();
  }, []);

  const handleMarkRead = async () => {
    await markNotificationsRead();
    loadNotifications();
    setShowNotifications(false);
  };

  const handleUpdateData = async () => {
    if (isUpdating || isSyncing) return;
    setIsUpdating(true);
    try {
      await fetch('http://localhost:3001/api/data/update', { method: 'POST' });
      
      const poll = setInterval(async () => {
        try {
          const res = await fetch('http://localhost:3001/api/status');
          if (res.ok) {
            const data = await res.json();
            if (!data.isUpdating) {
              clearInterval(poll);
              window.location.reload();
            }
          }
        } catch (err) {
          console.warn('Backend unavailable, retrying...');
        }
      }, 2000);
    } catch (e) {
      console.error(e);
      setIsUpdating(false);
    }
  };

  const handleSyncData = async () => {
    if (isUpdating || isSyncing) return;
    setIsSyncing(true);
    try {
      await fetch('http://localhost:3001/api/data/sync', { method: 'POST' });
      
      const poll = setInterval(async () => {
        try {
          const res = await fetch('http://localhost:3001/api/status');
          if (res.ok) {
            const data = await res.json();
            if (!data.isSyncing) {
              clearInterval(poll);
              window.location.reload();
            }
          }
        } catch (err) {
          console.warn('Backend unavailable, retrying...');
        }
      }, 2000);
    } catch (e) {
      console.error(e);
      setIsSyncing(false);
    }
  };

  const handleAddScheme = (scheme) => {
    setSelectedSchemes(prev => {
      if (prev.some(s => s.schemeCode === scheme.schemeCode)) return prev;
      const next = [...prev, scheme];
      if (next.length === 1) setShowGraph(true);
      return next;
    });
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
        <div className="flex justify-between items-start">
          <div>
            <h1 style={{ fontSize: '2.5rem', letterSpacing: '-0.04em', marginBottom: '8px' }}>
              NAV Analytics
            </h1>
            <p style={{ color: 'var(--text-secondary)', maxWidth: '600px' }}>
              Compare performance and historical NAV data across multiple mutual funds instantly using your locally cached dataset.
            </p>
          </div>
          <div className="flex gap-sm items-center">
            <button 
              className="flex items-center justify-center gap-xs"
              style={{
                borderRadius: '8px',
                background: 'var(--panel-bg)',
                border: '1px solid var(--panel-border)',
              color: (isUpdating || isSyncing) ? 'var(--text-secondary)' : 'var(--text-primary)',
              cursor: (isUpdating || isSyncing) ? 'not-allowed' : 'pointer',
              padding: '8px 16px',
              fontSize: '0.85rem',
              transition: 'all 0.15s ease'
            }}
            onClick={handleUpdateData}
            disabled={isUpdating || isSyncing}
          >
            <RefreshCw size={16} style={{ animation: isUpdating ? 'spin 1s linear infinite' : 'none' }} />
            {isUpdating ? 'Updating...' : 'Update Data'}
          </button>
          
          <button 
            className="flex items-center gap-2"
            style={{ 
              borderRadius: '8px',
              background: 'var(--accent-color)',
              border: '1px solid var(--accent-hover)',
              color: 'var(--text-on-accent)',
              cursor: (isUpdating || isSyncing) ? 'not-allowed' : 'pointer',
              padding: '8px 16px',
              fontSize: '0.85rem',
              transition: 'all 0.15s ease',
              opacity: (isUpdating || isSyncing) ? 0.6 : 1
            }}
            onClick={handleSyncData}
            disabled={isUpdating || isSyncing}
          >
            <RefreshCw size={16} style={{ animation: isSyncing ? 'spin 1s linear infinite' : 'none' }} />
            {isSyncing ? 'Syncing...' : 'Sync NAVs'}
          </button>
            <button 
              className="flex items-center justify-center"
              style={{
                width: '40px',
                height: '40px',
                borderRadius: '50%',
                background: 'var(--panel-bg)',
                border: '1px solid var(--panel-border)',
                color: 'var(--text-primary)',
                cursor: 'pointer',
                flexShrink: 0,
                padding: 0,
                transition: 'all 0.15s ease'
              }}
              onClick={() => setTheme(t => t === 'dark' ? 'light' : 'dark')}
              title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
            >
              {theme === 'dark' ? <Sun size={20} /> : <Moon size={20} />}
            </button>
            <input 
              type="date"
              value={referenceDate}
              onChange={(e) => setReferenceDate(e.target.value)}
              title="Reference Date (Leave blank for today)"
              style={{
                borderRadius: '8px',
                background: 'var(--panel-bg)',
                border: '1px solid var(--panel-border)',
                color: 'var(--text-primary)',
                padding: '8px 12px',
                fontSize: '0.9rem',
                cursor: 'pointer'
              }}
            />
            <div style={{ position: 'relative' }}>
              <button 
                className="flex items-center justify-center"
                style={{
                  width: '40px',
                  height: '40px',
                  borderRadius: '50%',
                  background: 'var(--panel-bg)',
                  border: '1px solid var(--panel-border)',
                  color: 'var(--text-primary)',
                  cursor: 'pointer',
                  padding: 0,
                  transition: 'all 0.15s ease'
                }}
                onClick={() => setShowNotifications(!showNotifications)}
                title="Notifications"
              >
                <Bell size={18} />
                {notifications.some(n => !n.read) && (
                  <span style={{
                    position: 'absolute',
                    top: '-2px',
                    right: '-2px',
                    background: 'var(--danger)',
                    width: '10px',
                    height: '10px',
                    borderRadius: '50%',
                    border: '2px solid var(--bg-primary)'
                  }} />
                )}
              </button>
              
              {showNotifications && (
                <div style={{
                  position: 'absolute',
                  top: '100%',
                  right: '0',
                  marginTop: '8px',
                  width: '320px',
                  background: 'var(--panel-bg)',
                  border: '1px solid var(--panel-border)',
                  borderRadius: '12px',
                  boxShadow: '0 8px 32px rgba(0,0,0,0.15)',
                  zIndex: 100,
                  padding: '16px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '12px'
                }}>
                  <div className="flex justify-between items-center" style={{ borderBottom: '1px solid var(--panel-border)', paddingBottom: '8px' }}>
                    <h3 style={{ margin: 0, fontSize: '1rem' }}>Notifications</h3>
                    {notifications.some(n => !n.read) && (
                      <button 
                        onClick={handleMarkRead}
                        style={{
                          background: 'none',
                          border: 'none',
                          color: 'var(--accent-primary)',
                          fontSize: '0.8rem',
                          cursor: 'pointer',
                          fontWeight: 500
                        }}
                      >
                        Mark all as read
                      </button>
                    )}
                  </div>
                  <div style={{ maxHeight: '300px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    {notifications.length === 0 ? (
                      <div style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', textAlign: 'center', padding: '20px 0' }}>
                        No notifications
                      </div>
                    ) : (
                      [...notifications].reverse().map(n => (
                        <div key={n.id} style={{
                          padding: '12px',
                          background: n.read ? 'transparent' : 'rgba(110, 86, 207, 0.05)',
                          border: n.read ? '1px solid var(--panel-border)' : '1px solid var(--accent-primary)',
                          borderRadius: '8px',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '6px'
                        }}>
                          <div className="flex justify-between items-start">
                            <strong style={{ fontSize: '0.9rem', color: n.read ? 'var(--text-primary)' : 'var(--accent-primary)' }}>{n.title}</strong>
                            <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                              {new Date(n.date).toLocaleDateString()}
                            </span>
                          </div>
                          <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--text-secondary)' }}>{n.message}</p>
                          {n.funds && n.funds.length > 0 && (
                            <div style={{ fontSize: '0.8rem', color: 'var(--text-primary)', marginTop: '4px' }}>
                              <ul style={{ margin: 0, paddingLeft: '16px' }}>
                                {n.funds.map((f, i) => (
                                  <li key={i}>{f}</li>
                                ))}
                              </ul>
                              {n.count > 10 && (
                                <div style={{ color: 'var(--text-secondary)', marginTop: '4px' }}>
                                  + {n.count - 10} more...
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

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
                <div style={{ width: '6px', height: '6px', borderRadius: '50%', background: 'var(--danger)' }} />
                <span style={{ color: 'var(--danger)' }}>Local Server Offline</span>
              </>
            )}
          </div>
        )}

        {/* Navigation Tabs */}
        <div className="flex gap-md" style={{ marginTop: '24px', borderBottom: '1px solid var(--panel-border)', paddingBottom: '12px' }}>
          <button 
            className="flex items-center gap-xs"
            style={{
              background: 'transparent',
              border: 'none',
              color: activeView === 'comparison' ? 'var(--text-primary)' : 'var(--text-secondary)',
              cursor: 'pointer',
              fontSize: '0.95rem',
              fontWeight: 600,
              padding: '6px 12px',
              borderBottom: activeView === 'comparison' ? '2px solid var(--accent-primary)' : '2px solid transparent',
              borderRadius: '0',
              transition: 'all 0.15s ease',
              marginBottom: '-13px'
            }}
            onClick={() => setActiveView('comparison')}
          >
            <BarChart2 size={16} />
            NAV Comparison
          </button>
          <button 
            className="flex items-center gap-xs"
            style={{
              background: 'transparent',
              border: 'none',
              color: activeView === 'ranking' ? 'var(--text-primary)' : 'var(--text-secondary)',
              cursor: 'pointer',
              fontSize: '0.95rem',
              fontWeight: 600,
              padding: '6px 12px',
              borderBottom: activeView === 'ranking' ? '2px solid var(--accent-primary)' : '2px solid transparent',
              borderRadius: '0',
              transition: 'all 0.15s ease',
              marginBottom: '-13px'
            }}
            onClick={() => setActiveView('ranking')}
          >
            <Award size={16} />
            SRP Ranking
          </button>
        </div>
      </header>

      {activeView === 'comparison' ? (
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
                 <ComparisonDashboard schemes={selectedSchemes} theme={theme} referenceDate={referenceDate} />
              </div>
            )}

            <div style={{ marginTop: 'var(--spacing-xl)' }}>
              <div className="flex justify-between items-center" style={{ marginBottom: '16px' }}>
                <h2 style={{ color: 'var(--text-secondary)', fontSize: '1rem', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  {selectedSchemes.length > 0 ? 'Click below to add more schemes' : 'Click a fund below to begin analysis'}
                </h2>
                
                {/* Toggle Buttons - shown here in Split View or when graph is hidden */}
                <div className="flex gap-sm items-center">

                {selectedSchemes.length > 0 && (!showGraph || isSplitView) && (
                  <div className="flex gap-sm items-center">
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
              </div>
              
              <CategoryView onSelectScheme={handleAddScheme} plan={plan} setPlan={setPlan} referenceDate={referenceDate} />
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
              <ComparisonDashboard schemes={selectedSchemes} theme={theme} referenceDate={referenceDate} />
            </div>
          )}
        </main>
      ) : (
        <main style={{ marginTop: 'var(--spacing-xl)' }}>
          <RankingDashboard onAddScheme={handleAddScheme} selectedSchemes={selectedSchemes} plan={plan} referenceDate={referenceDate} />
        </main>
      )}
    </div>
  );
}

export default App;
