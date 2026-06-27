import React, { useState, useEffect, useMemo } from 'react';
import ControlPanel from './components/ControlPanel';
import FlightMap from './components/FlightMap';
import InfoPanel from './components/InfoPanel';
import { useDeadReckoning } from './hooks/useDeadReckoning';
import './index.css';

export default function App() {
  const [flights, setFlights] = useState([]);
  const [renderedFlights, setRenderedFlights] = useState([]);
  const [selectedFlight, setSelectedFlight] = useState(null);
  const [loading, setLoading] = useState(false);
  const [filters, setFilters] = useState({ status: '', minSpeed: 0, country: 'All' });
  const fetchFlights = async () => {
    setLoading(true);
    try {
      const query = new URLSearchParams();
      if (filters.status) query.append('status', filters.status);
      if (filters.minSpeed) query.append('minSpeed', filters.minSpeed);
      if (filters.country) query.append('country', filters.country);

      const resp = await fetch(`http://localhost:8000/api/v1/flights?${query.toString()}`);
      // const resp = await fetch(`http://localhost:8000/api/v1/flights/history`);
      const data = await resp.json();
      setFlights(data);
    } catch (err) {
      console.error("API error shielded gracefully:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchFlights();
  }, [filters]); // Re-fetches immediately from backend shield cache when filter configurations alter

  // Execute continuous frame position matrix modifications
  useDeadReckoning(flights, setRenderedFlights);

  const uniqueCountries = useMemo(() => {
    const countries = flights.map(f => f.country);
    return [...new Set(countries)].sort();
  }, [flights]);

  return (
    <div className="tracker-root">
      <ControlPanel 
        filters={filters} 
        setFilters={setFilters} 
        uniqueCountries={uniqueCountries} 
        totalCount={renderedFlights.length}
        onRefresh={fetchFlights}
        loading={loading}
      />
      <div className="workspace">
        <FlightMap flights={renderedFlights} onSelectFlight={setSelectedFlight} />
        <InfoPanel flight={selectedFlight} onClose={() => setSelectedFlight(null)} />
      </div>
    </div>
  );
}