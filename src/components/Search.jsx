import React, { useState, useEffect, useRef } from 'react';
import { Search as SearchIcon, Loader2 } from 'lucide-react';
import { searchSchemes } from '../utils/api';

const Search = ({ onSelectScheme }) => {
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
    setQuery(scheme.schemeName);
    setShowDropdown(false);
    onSelectScheme(scheme);
  };

  return (
    <div className="search-container" style={{ position: 'relative', width: '100%', maxWidth: '600px', margin: '0 auto' }}>
      <div className="input-group flex items-center">
        <SearchIcon className="search-icon" size={20} style={{ position: 'absolute', left: '16px', color: 'var(--text-secondary)' }} />
        <input 
          type="text" 
          className="input-field" 
          placeholder="Search for a mutual fund (e.g. Parag Parikh Flexi Cap)..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          style={{ paddingLeft: '48px' }}
          onFocus={() => { if(results.length > 0) setShowDropdown(true); }}
        />
        {isSearching && (
          <Loader2 className="spinner" size={20} style={{ position: 'absolute', right: '16px', color: 'var(--accent-primary)', animation: 'spin 1s linear infinite' }} />
        )}
      </div>

      {showDropdown && results.length > 0 && (
        <div 
          ref={dropdownRef}
          className="glass-panel" 
          style={{ 
            position: 'absolute', 
            top: '100%', 
            left: 0, 
            right: 0, 
            marginTop: '8px', 
            padding: '8px 0',
            maxHeight: '300px', 
            overflowY: 'auto',
            zIndex: 10,
            boxShadow: '0 10px 25px rgba(0,0,0,0.5)'
          }}
        >
          {results.map((scheme) => (
            <div 
              key={scheme.schemeCode}
              onClick={() => handleSelect(scheme)}
              style={{
                padding: '12px 20px',
                cursor: 'pointer',
                borderBottom: '1px solid var(--panel-border)',
                transition: 'background 0.2s',
                display: 'flex',
                flexDirection: 'column'
              }}
              onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'rgba(59, 130, 246, 0.1)'}
              onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
            >
              <span style={{ fontWeight: 500, color: 'var(--text-primary)' }}>{scheme.schemeName}</span>
              <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Code: {scheme.schemeCode}</span>
            </div>
          ))}
        </div>
      )}
      
      <style>{`
        @keyframes spin { 100% { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
};

export default Search;
