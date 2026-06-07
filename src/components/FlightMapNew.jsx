import React, { useState, useEffect } from 'react';
import { MapContainer, TileLayer, CircleMarker,Polyline, Popup } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';

export default function FlightMap({ flights, onSelectFlight }) {

  const [activeIcao, setActiveIcao] = useState(null);
    const [flightPath, setFlightPath] = useState([]);
  
    // Fetch flight history path lines when a user selects an aircraft
    const handleMarkerClick = async (flight) => {
      onSelectFlight(flight);
      setActiveIcao(flight.icao);
  
      try {
        const resp = await fetch(`http://localhost:8000/api/v1/flights/${flight.icao}/path`);
        if (resp.ok) {
          const pathData = await resp.json();
          // Convert array objects to Leaflet coordinates format [[lat, lon], [lat, lon]]
          setFlightPath(pathData.map(p => [p.lat, p.lng]));
        }
      } catch (err) {
        console.error("Failed to fetch historical trajectories:", err);
      }
    };
  
    // Clear path track lines if the active flight drops out of the current filter range
    useEffect(() => {
      if (activeIcao && !flights.some(f => f.icao === activeIcao)) {
        setFlightPath([]);
        setActiveIcao(null);
      }
    }, [flights, activeIcao]);
  const getMarkerColor = (alt) => {
    if (alt > 10000) return '#4cffaa';
    if (alt > 5000) return '#ffe44c';
    return '#ff7a4c';
  };

  return (
    <div className="map-container-wrapper">
      <MapContainer 
        center={[20, 78]} 
        zoom={5} 
        preferCanvas={true} // High-Performance Option: Draws directly to Canvas instead of SVG DOM
        style={{ height: '100%', width: '100%' }}
        attributionControl={false}
      >
        <TileLayer url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png" />
        {flightPath.length > 0 && (
                  <Polyline 
                    positions={flightPath} 
                    pathOptions={{
                      color: '#4a9eff', 
                      weight: 3, 
                      opacity: 0.7,
                      dashArray: '5, 10' // Stylized radar dash trail look
                    }} 
                  />
                )}
        {flights.map((f) => (
          <CircleMarker
            key={f.icao}
            center={[f.lat, f.lon]}
            radius={5}
            pathOptions={{
              color: getMarkerColor(f.altitude),
              fillColor: getMarkerColor(f.altitude),
              fillOpacity: 0.8,
              weight: 1
            }}
            eventHandlers={{
              click: () => handleMarkerClick(f)
            }}
          />
        ))}
      </MapContainer>
    </div>
  );
}