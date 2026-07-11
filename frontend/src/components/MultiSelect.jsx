import React, { useState, useEffect, useRef } from 'react';
import { Search as SearchIcon, Loader2, X } from 'lucide-react';
import { searchSchemes } from '../utils/api';

const MultiSelect = ({ selectedSchemes, onAddScheme, onRemoveScheme }) => {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [isSearching, setIsSearching] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  
  const dropdownRef = useRef(null);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setShowDropdown(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    const fetchResults = async () => {
      if (query.length < 3) {
        setResults([]);
        return;
      }
      setIsSearching(true);
      const data = await searchSchemes(query);
      setResults(data);
      setIsSearching(false);
      setShowDropdown(true);
    };

    const debounceTimer = setTimeout(fetchResults, 500);
    return () => clearTimeout(debounceTimer);
  }, [query]);

  const handleSelect = (scheme) => {
    // Only add if not already selected
    if (!selectedSchemes.find(s => s.schemeCode === scheme.schemeCode)) {
      onAddScheme(scheme);
    }
    setQuery('');
    setShowDropdown(false);
  };

  return (
    <div className="search-container" style={{ position: 'relative', width: '100%', maxWidth: '800px', margin: '0 auto' }}>
      
      {/* Selected Tags */}
      {selectedSchemes.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginBottom: '16px' }}>
          {selectedSchemes.map((scheme) => (
            <div 
              key={scheme.schemeCode}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                padding: '4px 10px',
                borderRadius: '4px',
                backgroundColor: 'var(--bg-color)',
                border: '1px solid var(--panel-border)',
                color: 'var(--text-primary)',
                fontSize: '0.85rem'
              }}
            >
              <span style={{ maxWidth: '250px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {scheme.schemeName}
              </span>
              <button 
                onClick={() => onRemoveScheme(scheme.schemeCode)}
                style={{ 
                  background: 'none', 
                  border: 'none', 
                  color: 'var(--text-secondary)', 
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  padding: '2px',
                  borderRadius: '2px'
                }}
                onMouseEnter={(e) => e.currentTarget.style.color = 'var(--text-primary)'}
                onMouseLeave={(e) => e.currentTarget.style.color = 'var(--text-secondary)'}
              >
                <X size={14} />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Search Input */}
      <div className="input-group flex items-center" style={{ position: 'relative' }}>
        <SearchIcon className="search-icon" size={18} style={{ position: 'absolute', left: '16px', color: 'var(--text-secondary)' }} />
        <input 
          type="text" 
          className="input-field" 
          placeholder="Search and select fund for analysis..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          style={{ 
            paddingLeft: '48px', 
            width: '100%', 
            height: '44px', 
            borderRadius: '6px', 
            border: '1px solid var(--panel-border)', 
            background: 'var(--bg-color)', 
            color: 'var(--text-primary)',
            fontSize: '0.9rem'
          }}
          onFocus={() => { if(results.length > 0) setShowDropdown(true); }}
        />
        {isSearching && (
          <Loader2 className="spinner" size={18} style={{ position: 'absolute', right: '16px', color: 'var(--text-secondary)', animation: 'spin 1s linear infinite' }} />
        )}
      </div>

      {/* Dropdown */}
      {showDropdown && results.length > 0 && (
        <div 
          ref={dropdownRef}
          className="glass-panel" 
          style={{ 
            position: 'absolute', 
            top: '100%', 
            left: 0, 
            right: 0, 
            marginTop: '4px', 
            padding: '4px 0',
            maxHeight: '320px', 
            overflowY: 'auto',
            zIndex: 10,
            boxShadow: '0 12px 24px rgba(0,0,0,0.5)',
            backgroundColor: 'var(--panel-bg)',
            border: '1px solid var(--panel-border)'
          }}
        >
          {results.map((scheme) => {
            const isSelected = selectedSchemes.some(s => s.schemeCode === scheme.schemeCode);
            return (
              <div 
                key={scheme.schemeCode}
                onClick={() => !isSelected && handleSelect(scheme)}
                style={{
                  padding: '10px 16px',
                  cursor: isSelected ? 'default' : 'pointer',
                  borderBottom: '1px solid var(--panel-border)',
                  transition: 'background 0.15s',
                  display: 'flex',
                  flexDirection: 'column',
                  opacity: isSelected ? 0.5 : 1
                }}
                onMouseEnter={(e) => { if (!isSelected) e.currentTarget.style.backgroundColor = 'var(--panel-border)' }}
                onMouseLeave={(e) => { if (!isSelected) e.currentTarget.style.backgroundColor = 'transparent' }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontWeight: 500, color: 'var(--text-primary)', fontSize: '0.9rem' }}>{scheme.schemeName}</span>
                  {isSelected && <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Added</span>}
                </div>
                <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '4px' }}>Code: {scheme.schemeCode}</span>
              </div>
            );
          })}
        </div>
      )}
      
      <style>{`
        @keyframes spin { 100% { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
};

export default MultiSelect;
