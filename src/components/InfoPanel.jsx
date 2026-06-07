import React from 'react';

export default function InfoPanel({ flight, onClose }) {
  if (!flight) return null;
  return (
    <div className="info-panel show">
      <button className="close-btn" onClick={onClose}>×</button>
      <h3>{flight.callsign}</h3>
      <div className="row"><span>Origin Country</span><span>{flight.country}</span></div>
      <div className="row"><span>Altitude</span><span className="green">{flight.altitude.toLocaleString()} m</span></div>
      <div className="row"><span>Speed</span><span>{flight.speed} km/h</span></div>
      <div className="row"><span>Heading</span><span>{flight.heading}°</span></div>
      <div className="row"><span>On Ground</span><span>{flight.onGround ? 'YES' : 'NO'}</span></div>
    </div>
  );
}