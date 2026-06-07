import React from 'react';

export default function ControlPanel({ filters, setFilters, uniqueCountries, totalCount, onRefresh, loading }) {
  return (
    <div className="top-bar">
      <h1><div className="pulse-dot"></div>Radar Core</h1>
      <div className="stats">
        <span>TRACKING: <strong>{totalCount}</strong></span>
      </div>
      
      <div className="controls-group">
        {/* Status Filtering */}
        <select value={filters.status} onChange={e => setFilters(prev => ({...prev, status: e.target.value}))}>
          <option value="">All Flight Types</option>
          <option value="air">In The Air</option>
          <option value="ground">On Ground</option>
        </select>

        {/* Speed Filtering */}
        <select value={filters.minSpeed} onChange={e => setFilters(prev => ({...prev, minSpeed: Number(e.target.value)}))}>
          <option value="0">Any Speed</option>
          <option value="400">&gt; 400 km/h</option>
          <option value="800">&gt; 800 km/h (Fast)</option>
        </select>

        {/* Country Filtering */}
        <select value={filters.country} onChange={e => setFilters(prev => ({...prev, country: e.target.value}))}>
          <option value="All">All Regions</option>
          {uniqueCountries.map(c => <option key={c} value={c}>{c}</option>)}
        </select>

        <button disabled={loading} onClick={onRefresh} className="refresh-btn">
          {loading ? 'SYNCING...' : '↺ REFRESH'}
        </button>
      </div>
    </div>
  );
}