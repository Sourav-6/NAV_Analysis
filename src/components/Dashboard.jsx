import React, { useState, useMemo } from 'react';
import { 
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine
} from 'recharts';
import { TrendingUp, TrendingDown, Calendar } from 'lucide-react';
import { calculateTrailingReturns } from '../utils/returns';

const Dashboard = ({ scheme, navData }) => {
  const [timeframe, setTimeframe] = useState('1Y'); // 1M, 3M, 6M, 1Y, 3Y, 5Y, 10Y, ALL
  
  const returns = useMemo(() => {
    return calculateTrailingReturns(navData);
  }, [navData]);

  const chartData = useMemo(() => {
    if (!navData || navData.length === 0) return [];
    
    // Data comes newest to oldest, we need oldest to newest for chart
    let data = [...navData].reverse();
    
    // Filter based on timeframe
    if (timeframe !== 'ALL') {
      const latestDateStr = navData[0].date; // e.g. "24-05-2023"
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
      
      data = data.filter(item => {
        const [id, im, iy] = item.date.split('-');
        const itemDate = new Date(iy, im - 1, id);
        return itemDate >= cutoffDate;
      });
    }

    // Downsample if data is too large to prevent chart lag
    if (data.length > 500) {
      const step = Math.ceil(data.length / 300);
      data = data.filter((_, i) => i % step === 0);
    }
    
    // Map to numbers for Recharts
    return data.map(item => ({
      date: item.date,
      nav: parseFloat(item.nav)
    }));
  }, [navData, timeframe]);

  if (!scheme || !navData) return null;

  const latestNav = navData[0];

  return (
    <div className="dashboard-container" style={{ marginTop: 'var(--spacing-xl)' }}>
      
      {/* Header Section */}
      <div className="glass-panel" style={{ marginBottom: 'var(--spacing-lg)' }}>
        <h2 className="text-gradient" style={{ fontSize: '1.8rem', marginBottom: '8px' }}>{scheme.schemeName}</h2>
        <div className="flex items-center gap-md" style={{ color: 'var(--text-secondary)' }}>
          <span>Code: {scheme.schemeCode}</span>
          <span>•</span>
          <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <Calendar size={16} /> Latest NAV: ₹{latestNav.nav} (as of {latestNav.date})
          </span>
        </div>
      </div>

      {/* Trailing Returns Grid */}
      <h3 style={{ marginBottom: 'var(--spacing-md)' }}>Trailing Returns (CAGR for &ge; 1Y)</h3>
      <div style={{ 
        display: 'grid', 
        gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', 
        gap: 'var(--spacing-md)',
        marginBottom: 'var(--spacing-xl)'
      }}>
        {returns && returns.map((ret) => (
          <div key={ret.label} className="glass-panel" style={{ padding: 'var(--spacing-md)', textAlign: 'center' }}>
            <div style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginBottom: '8px' }}>{ret.label}</div>
            {ret.value === 'N/A' ? (
              <div style={{ fontSize: '1.5rem', fontWeight: 600 }}>N/A</div>
            ) : (
              <div style={{ 
                fontSize: '1.5rem', 
                fontWeight: 700,
                color: ret.isPositive ? 'var(--success)' : 'var(--danger)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '4px'
              }}>
                {ret.isPositive ? <TrendingUp size={20} /> : <TrendingDown size={20} />}
                {ret.value}%
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Chart Section */}
      <div className="glass-panel flex-col gap-md">
        <div className="flex justify-between items-center" style={{ flexWrap: 'wrap', gap: '10px' }}>
          <h3>NAV History</h3>
          <div className="flex gap-sm" style={{ flexWrap: 'wrap' }}>
            {['1M', '3M', '6M', '1Y', '3Y', '5Y', '10Y', 'ALL'].map(tf => (
              <button 
                key={tf}
                className="btn"
                style={{ 
                  padding: '4px 12px', 
                  fontSize: '0.85rem',
                  background: timeframe === tf ? 'rgba(59, 130, 246, 0.2)' : 'transparent',
                  color: timeframe === tf ? 'var(--accent-primary)' : 'var(--text-secondary)',
                  border: `1px solid ${timeframe === tf ? 'var(--accent-primary)' : 'var(--panel-border)'}`
                }}
                onClick={() => setTimeframe(tf)}
              >
                {tf}
              </button>
            ))}
          </div>
        </div>
        
        <div style={{ width: '100%', height: '400px', marginTop: '16px' }}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" vertical={false} />
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
                tickFormatter={(val) => `₹${val}`}
                width={60}
              />
              <Tooltip 
                contentStyle={{ 
                  backgroundColor: 'rgba(15, 23, 42, 0.9)', 
                  border: '1px solid var(--panel-border)',
                  borderRadius: '8px',
                  backdropFilter: 'blur(8px)',
                  color: '#fff'
                }}
                itemStyle={{ color: 'var(--accent-primary)', fontWeight: 600 }}
                labelStyle={{ color: 'var(--text-secondary)', marginBottom: '4px' }}
                formatter={(value) => [`₹${value}`, 'NAV']}
              />
              <Line 
                type="monotone" 
                dataKey="nav" 
                stroke="var(--accent-primary)" 
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 6, fill: 'var(--accent-secondary)' }}
                animationDuration={1500}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

    </div>
  );
};

export default Dashboard;
