/**
 * API Utility Layer
 * 
 * Connects to the local NAV data server (localhost:3001) for fast, cached data.
 * Falls back to the live mfapi.in API if the local server is unavailable.
 */

const LOCAL_API = 'http://localhost:3001/api';
const LIVE_API = 'https://api.mfapi.in';

let _useLocal = null; // null = not checked yet, true/false = cached result
let _dataStatus = null;

/**
 * Check if local data server is available and cache the result.
 * Re-checks every 30 seconds in case the server starts/stops.
 */
let _lastCheck = 0;
async function isLocalAvailable() {
  const now = Date.now();
  if (_useLocal !== null && now - _lastCheck < 30000) return _useLocal;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2000);
    const res = await fetch(`${LOCAL_API}/status`, { signal: controller.signal });
    clearTimeout(timeout);
    
    if (res.ok) {
      _dataStatus = await res.json();
      _useLocal = true;
    } else {
      _useLocal = false;
    }
  } catch {
    _useLocal = false;
  }
  _lastCheck = now;
  return _useLocal;
}

/**
 * Returns data source status info.
 * { source: 'local' | 'live', metadata: {...} | null }
 */
export const getDataStatus = async () => {
  const local = await isLocalAvailable();
  if (local && _dataStatus) {
    return {
      source: 'local',
      metadata: _dataStatus.metadata
    };
  }
  return { source: 'live', metadata: null };
};

// ── Scheme List ──────────────────────────────────────────────────────────────

// Cache the master scheme list to avoid fetching 37k items repeatedly
let masterSchemeList = null;

export const fetchAllSchemes = async () => {
  if (masterSchemeList) return masterSchemeList;
  
  try {
    const local = await isLocalAvailable();
    const url = local ? `${LOCAL_API}/schemes` : `${LIVE_API}/mf`;
    
    const response = await fetch(url);
    if (!response.ok) throw new Error('Failed to fetch master scheme list');
    const data = await response.json();
    masterSchemeList = data;
    return masterSchemeList;
  } catch (error) {
    console.error("Error fetching all schemes:", error);
    return [];
  }
};

/**
 * Returns filtered list of schemes for a given category.
 * Enforces "Direct" and "Growth" to remove duplicate variants.
 */
export const getSchemesByCategory = async (category) => { // 'Large Cap', 'Mid Cap', 'Small Cap'
  try {
    const local = await isLocalAvailable();
    
    if (local) {
      // Use the server's category endpoint (already filters Direct Growth)
      const response = await fetch(`${LOCAL_API}/schemes/category/${encodeURIComponent(category)}`);
      if (response.ok) return await response.json();
    }
  } catch {
    // Fall through to manual filtering
  }

  // Fallback: filter locally from full list
  const allSchemes = await fetchAllSchemes();
  const keywords = category.toLowerCase().split(' ');

  return allSchemes.filter(scheme => {
    const name = scheme.schemeName.toLowerCase();
    
    // Must contain both 'large' and 'cap' (for example)
    const matchesCategory = keywords.every(kw => name.includes(kw));
    
    // We only want Direct Growth plans to avoid clutter
    const isDirect = name.includes('direct');
    const isGrowth = name.includes('growth');
    const isIDCW = name.includes('idcw') || name.includes('dividend');
    
    // Some sanity filters to remove edge cases
    return matchesCategory && isDirect && isGrowth && !isIDCW;
  });
};

/**
 * Search schemes by name (for search component)
 */
export const searchSchemes = async (query) => {
  try {
    const local = await isLocalAvailable();
    
    if (local) {
      const response = await fetch(`${LOCAL_API}/schemes/search?q=${encodeURIComponent(query)}`);
      if (response.ok) return await response.json();
    }
  } catch {
    // Fall through to manual search
  }

  // Fallback: search locally from full list
  const allSchemes = await fetchAllSchemes();
  const keywords = query.toLowerCase().split(/\s+/);
  
  return allSchemes
    .filter(s => {
      const name = s.schemeName.toLowerCase();
      return keywords.every(kw => name.includes(kw));
    })
    .slice(0, 50);
};

// ── NAV Data ─────────────────────────────────────────────────────────────────

/**
 * Fetches NAV data for a specific scheme code.
 * Uses local server if available, falls back to mfapi.in.
 */
export const getSchemeNavData = async (schemeCode) => {
  try {
    const local = await isLocalAvailable();
    const url = local 
      ? `${LOCAL_API}/nav/${schemeCode}` 
      : `${LIVE_API}/mf/${schemeCode}`;
    
    const response = await fetch(url);
    if (!response.ok) return null;
    const data = await response.json();
    return data;
  } catch (error) {
    return null;
  }
};
