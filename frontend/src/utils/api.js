/**
 * API Utility Layer
 * 
 * Connects strictly to the local NAV data server (localhost:3001) for fast, cached data.
 * All data is officially sourced from AMFI.
 */

const LOCAL_API = 'http://localhost:3001/api';

let _dataStatus = null;

/**
 * Check if local data server is available and cache the result.
 */
let _lastCheck = 0;
async function fetchLocalStatus() {
  const now = Date.now();
  if (_dataStatus !== null && now - _lastCheck < 30000) return true;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2000);
    const res = await fetch(`${LOCAL_API}/status`, { signal: controller.signal });
    clearTimeout(timeout);
    
    if (res.ok) {
      _dataStatus = await res.json();
      _lastCheck = now;
      return true;
    }
  } catch {
    // Server is down
  }
  return false;
}

/**
 * Returns data source status info.
 * { source: 'local', metadata: {...} | null }
 */
export const getDataStatus = async () => {
  const isUp = await fetchLocalStatus();
  if (isUp && _dataStatus) {
    return {
      source: 'local',
      metadata: _dataStatus.metadata,
      isUpdating: _dataStatus.isUpdating
    };
  }
  return { source: 'offline', metadata: null, isUpdating: false };
};

// ── Scheme List ──────────────────────────────────────────────────────────────

// Cache the master scheme list to avoid fetching 37k items repeatedly
let masterSchemeList = null;

export const fetchAllSchemes = async () => {
  if (masterSchemeList) return masterSchemeList;
  
  try {
    const isUp = await fetchLocalStatus();
    const url = `${LOCAL_API}/schemes`;
    
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
export const getSchemesByCategory = async (category, plan = 'direct') => { // 'Large Cap', 'Mid Cap', 'Small Cap'
  try {
    const isUp = await fetchLocalStatus();
    
    if (isUp) {
      // Use the server's category endpoint (already filters Direct Growth)
      const response = await fetch(`${LOCAL_API}/schemes/category/${encodeURIComponent(category)}?plan=${encodeURIComponent(plan)}`);
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
    const schemeCat = (scheme.schemeCategory || '').toLowerCase();
    
    const normalizedCategory = category.toLowerCase();
    
    let matchesCategory = false;
    if (normalizedCategory === 'large cap') {
      matchesCategory = schemeCat.includes('large') && schemeCat.includes('cap') && !schemeCat.includes('mid');
    } else if (normalizedCategory === 'mid cap') {
      matchesCategory = schemeCat.includes('mid') && schemeCat.includes('cap') && !schemeCat.includes('large');
    } else if (normalizedCategory === 'sif') {
      const sifKeywords = ['special', 'sector', 'business cycle', 'pharma', 'health', 'bank', 'financial', 'infra', 'consum', 'tech', 'auto', 'manufacturing', 'psu', 'esg', 'quant', 'thematic'];
      matchesCategory = sifKeywords.some(kw => name.includes(kw) || schemeCat.includes(kw));
    } else {
      matchesCategory = keywords.every(kw => schemeCat.includes(kw));
    }
    
    // We only want Direct or Regular Growth plans to avoid clutter
    const isDirect = name.includes('direct');
    const isGrowth = name.includes('growth');
    const isIDCW = name.includes('idcw') || name.includes('dividend');
    
    const planMatches = plan === 'direct' ? isDirect : (!isDirect || name.includes('regular'));
    
    // Some sanity filters to remove edge cases
    return matchesCategory && planMatches && isGrowth && !isIDCW;
  });
};

/**
 * Search schemes by name (for search component)
 */
export const searchSchemes = async (query) => {
  try {
    const isUp = await fetchLocalStatus();
    if (isUp) {
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
 * Uses local AMFI server strictly.
 */
export const getSchemeNavData = async (schemeCode) => {
  try {
    const url = `${LOCAL_API}/nav/${schemeCode}`;
    const response = await fetch(url);
    if (!response.ok) return null;
    const data = await response.json();
    return data;
  } catch (error) {
    return null;
  }
};

// ── SRP Ranking Engine ───────────────────────────────────────────────────────

/**
 * Fetches the current algorithm weights and risk-free rate
 */
export const getRankingConfig = async () => {
  try {
    const response = await fetch(`${LOCAL_API}/ranking/config`);
    if (!response.ok) throw new Error('Failed to fetch config');
    return await response.json();
  } catch (error) {
    console.error('Error fetching ranking config:', error);
    return null;
  }
};

/**
 * Updates the algorithm weights and risk-free rate
 */
export const updateRankingConfig = async (config) => {
  try {
    const response = await fetch(`${LOCAL_API}/ranking/config`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(config)
    });
    if (!response.ok) throw new Error('Failed to update config');
    return await response.json();
  } catch (error) {
    console.error('Error updating ranking config:', error);
    return null;
  }
};

/**
 * Calculates rankings based on selected parameters
 */
export const calculateRankings = async (params) => {
  try {
    const response = await fetch(`${LOCAL_API}/ranking/calculate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params)
    });
    if (!response.ok) throw new Error('Failed to calculate rankings');
    return await response.json();
  } catch (error) {
    console.error('Error calculating rankings:', error);
    return [];
  }
};

/**
 * Calculates rankings for a specific set of user-selected scheme codes
 * @param {Object} params - { schemeCodes: number[], analysisPeriod: string, rollingWindow: string, config?: object }
 */
export const calculateSelectedRankings = async (params) => {
  try {
    const response = await fetch(`${LOCAL_API}/ranking/calculate-selected`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params)
    });
    if (!response.ok) throw new Error('Failed to calculate selected rankings');
    return await response.json();
  } catch (error) {
    console.error('Error calculating selected rankings:', error);
    return [];
  }
};
