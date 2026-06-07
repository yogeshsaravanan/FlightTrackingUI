import React, { useState, useEffect, useRef,useMemo, useCallback } from 'react';
import {
  MapContainer, TileLayer, Polyline,
  Circle, useMap, useMapEvents
} from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

// ─── CONSTANTS ────────────────────────────────────────────────────────────────
const EARTH_RADIUS_KM = 6371;
const CONFLICT_THRESHOLD_KM = 15;    // horizontal separation alert distance
const TRAIL_MAX_POINTS = 25;          // ring buffer size per aircraft
const DR_INTERVAL_MS = 1000 / 60;    // 60 FPS dead reckoning tick target
const VECTOR_LOOKAHEAD_S = 60;        // velocity vector: project 60 seconds ahead

// ─── ALTITUDE → COLOR ────────────────────────────────────────────────────────
function altColor(alt) {
  if (alt === null || alt === undefined || alt < 150) return '#ff4caa';  // ground / taxiing
  if (alt < 5000)  return '#ff7a4c';   // low
  if (alt < 20000) return '#ffe44c';   // mid
  if (alt < 35000) return '#4ca8ff';   // high
  return '#4cffaa';                    // cruise
}

// ─── HAVERSINE DISTANCE (km) ─────────────────────────────────────────────────
function haversineKm(lat1, lon1, lat2, lon2) {
  const toRad = d => d * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return EARTH_RADIUS_KM * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ─── PROJECT POSITION (dead reckoning) ───────────────────────────────────────
// Returns { lat, lon } extrapolated from a position using speed (kt), heading (°), and dt (seconds)
function projectPosition(lat, lon, speedKt, headingDeg, dtSeconds) {
  const speedKmh = speedKt * 1.852;
  const distKm = speedKmh * (dtSeconds / 3600);
  const hdRad = headingDeg * Math.PI / 180;
  const dLat = (distKm / EARTH_RADIUS_KM) * (180 / Math.PI);
  const dLon = (distKm / EARTH_RADIUS_KM) * (180 / Math.PI)
    / Math.cos(lat * Math.PI / 180);
  return {
    lat: lat + dLat * Math.cos(hdRad),
    lon: lon + dLon * Math.sin(hdRad),
  };
}

// ─── ROTATED SVG AIRPLANE DIVICON ─────────────────────────────────────────────
// Returns an L.divIcon with a tiny SVG airplane rotated to heading
function makeAircraftIcon(headingDeg, color, isSelected = false) {
  const size = isSelected ? 26 : 20;
  const svg = `
    <svg width="${size}" height="${size}" viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg"
         style="transform: rotate(${headingDeg}deg); overflow: visible;">
      ${isSelected ? `<circle cx="10" cy="10" r="12" fill="none" stroke="${color}" stroke-width="1" stroke-dasharray="3 2" opacity="0.6"/>` : ''}
      <polygon points="10,2 13,14 10,12 7,14" fill="${color}" opacity="0.95"/>
      <polygon points="5,9 15,9 13,11 7,11" fill="${color}" opacity="0.7"/>
      <polygon points="8,13 12,13 11,16 9,16" fill="${color}" opacity="0.5"/>
    </svg>`;
  return L.divIcon({
    html: svg,
    className: '',
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}

// ─── FADING TRAIL SEGMENTS ────────────────────────────────────────────────────
// Renders a trail as multiple short Polylines with decaying opacity
function FadingTrail({ positions, color }) {
  if (!positions || positions.length < 2) return null;
  const segments = [];
  for (let i = 1; i < positions.length; i++) {
    const opacity = (i / positions.length) * 0.7; // fade from 0 → 0.7
    segments.push(
      <Polyline
        key={i}
        positions={[positions[i - 1], positions[i]]}
        pathOptions={{ color, weight: 2, opacity, lineCap: 'round' }}
      />
    );
  }
  return <>{segments}</>;
}

// ─── VELOCITY VECTOR LINE ─────────────────────────────────────────────────────
function VelocityVector({ lat, lon, speed, heading, color }) {
  if (!speed || speed < 20) return null; // skip for parked/slow aircraft
  const projected = projectPosition(lat, lon, speed, heading, VECTOR_LOOKAHEAD_S);
  return (
    <Polyline
      positions={[[lat, lon], [projected.lat, projected.lon]]}
      pathOptions={{ color, weight: 1.5, opacity: 0.5, dashArray: '4 6' }}
    />
  );
}

// ─── CONFLICT ALERT RING ──────────────────────────────────────────────────────
function ConflictRing({ lat, lon }) {
  return (
    <Circle
      center={[lat, lon]}
      radius={CONFLICT_THRESHOLD_KM * 1000}
      pathOptions={{ color: '#ff4444', weight: 1.5, opacity: 0.8, fillOpacity: 0.05, dashArray: '5 5' }}
    />
  );
}

// ─── ZOOM WATCHER ─────────────────────────────────────────────────────────────
function ZoomWatcher({ onZoomChange }) {
  useMapEvents({ zoom: (e) => onZoomChange(e.target.getZoom()) });
  return null;
}

// ─── SHARED CANVAS RENDERER (performance) ────────────────────────────────────
// Attaches a shared L.canvas renderer to the map so all circle markers
// share one canvas context instead of creating individual ones.
function CanvasRendererSetup({ rendererRef }) {
  const map = useMap();
  useEffect(() => {
    rendererRef.current = L.canvas({ padding: 0.5 });
  }, [map]);
  return null;
}

// ─── AIRCRAFT MARKER (Leaflet Marker with DivIcon) ───────────────────────────
// We use a plain useMap + L.marker approach here so we can imperatively
// update icon/position without React re-mounting the element each tick.
function AircraftMarker({ flight, drPosition, isSelected, onSelect }) {
  const map = useMap();
  const markerRef = useRef(null);
  const onSelectRef = useRef(onSelect);

  // Keep onSelect ref fresh without triggering effects
  useEffect(() => { onSelectRef.current = onSelect; });

  const lat = drPosition?.lat ?? flight.lat;
  const lon = drPosition?.lon ?? flight.lon;
  // const color = altColor(flight.altitude);
  const color = useMemo(() => altColor(flight.altitude), [flight.altitude]);

  // Create marker on mount
  // useEffect(() => {
  //   const icon = makeAircraftIcon(flight.heading || 0, color, isSelected);
  //   const m = L.marker([lat, lon], { icon, interactive: true, zIndexOffset: isSelected ? 1000 : 0 });
  //   m.on('click', () => onSelect(flight));
  //   m.addTo(map);
  //   markerRef.current = m;
  //   return () => { m.remove(); };
  // }, []);

  useEffect(() => {
    const icon = makeAircraftIcon(0, '#4cffaa', false);
    const m = L.marker([lat, lon], { icon, interactive: true });
    m.on('click', () => onSelectRef.current(flight));
    m.addTo(map);
    markerRef.current = m;
    return () => { m.remove(); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Update position + icon imperatively — avoids React re-mount on every DR tick
  useEffect(() => {
    if (!markerRef.current) return;
    markerRef.current.setLatLng([lat, lon]);
    markerRef.current.setIcon(makeAircraftIcon(flight.heading || 0, color, isSelected));
    markerRef.current.setZIndexOffset(isSelected ? 1000 : 0);
  }, [lat, lon, flight.heading, color, isSelected]);

  return null;
}

// ─── MAIN COMPONENT ───────────────────────────────────────────────────────────
export default function FlightMap({ flights, onSelectFlight }) {
  const [activeIcao, setActiveIcao]     = useState(null);
  const [flightPath, setFlightPath]     = useState([]);
  const [zoomLevel, setZoomLevel]       = useState(5);
  const [conflicts, setConflicts]       = useState(new Set());
  const [showHeatmap, setShowHeatmap]   = useState(false);
  const [showVectors, setShowVectors]   = useState(true);
  const [showTrails, setShowTrails]     = useState(true);

  // Dead reckoning: store interpolated positions keyed by icao
  const drPositions = useRef({});         // { icao: { lat, lon } }
  const trailBuffers = useRef({});        // { icao: [[lat,lon], ...] }  ring buffer
  const lastServerSnapshot = useRef({}); // { icao: { lat, lon, speed, heading, ts } }
  const animFrameId = useRef(null);
  const lastTickTime = useRef(performance.now());
  const rendererRef = useRef(null);

  const flightsRef = useRef(flights);
  useEffect(() => { flightsRef.current = flights; }, [flights]);

  // DR loop effect — empty dep array, reads flightsRef.current inside tick()
  useEffect(() => {
    function tick(now) {
      const dt = (now - lastTickTime.current) / 1000;
      lastTickTime.current = now;

      flightsRef.current.forEach(f => {  // <-- use ref, not flights
        if (!f.speed || f.speed < 10 || !f.heading) return;
        const current = drPositions.current[f.icao] || { lat: f.lat, lon: f.lon };
        const next = projectPosition(current.lat, current.lon, f.speed, f.heading, dt);
        drPositions.current[f.icao] = next;

        if (!trailBuffers.current[f.icao]) trailBuffers.current[f.icao] = [];
        const buf = trailBuffers.current[f.icao];
        buf.push([next.lat, next.lon]);
        if (buf.length > TRAIL_MAX_POINTS) buf.shift();
      });

      animFrameId.current = requestAnimationFrame(tick);
    }
    animFrameId.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animFrameId.current);
  }, []);

  // Fetch historical path on marker click
  const handleMarkerClick = useCallback(async (flight) => {
    onSelectFlight(flight);
    setActiveIcao(flight.icao);
    try {
      const resp = await fetch(`http://localhost:8000/api/v1/flights/${flight.icao}/path`);
      if (resp.ok) {
        const pathData = await resp.json();
        setFlightPath(pathData.map(p => [p.lat, p.lng]));
      }
    } catch (err) {
      console.error('Failed to fetch historical trajectory:', err);
    }
  }, [onSelectFlight]);

  // Clear path if active flight drops from filter
  useEffect(() => {
    if (activeIcao && !flights.some(f => f.icao === activeIcao)) {
      setFlightPath([]);
      setActiveIcao(null);
    }
  }, [flights, activeIcao]);

  // Update server snapshot when new flight data arrives
  useEffect(() => {
    const now = performance.now();
    flights.forEach(f => {
      const prev = lastServerSnapshot.current[f.icao];
      // If we already have a DR position and the server corrects us, ease toward real position
      if (prev && drPositions.current[f.icao]) {
        const dr = drPositions.current[f.icao];
        drPositions.current[f.icao] = {
          lat: dr.lat * 0.7 + f.lat * 0.3, // weighted reconciliation
          lon: dr.lon * 0.7 + f.lon * 0.3,
        };
      } else {
        drPositions.current[f.icao] = { lat: f.lat, lon: f.lon };
      }
      lastServerSnapshot.current[f.icao] = { ...f, ts: now };
    });
  }, [flights]);

  // 60 FPS dead reckoning animation loop
  useEffect(() => {
    function tick(now) {
      const dt = (now - lastTickTime.current) / 1000; // seconds
      lastTickTime.current = now;

      flights.forEach(f => {
        if (!f.speed || f.speed < 10 || !f.heading) return; // skip ground/parked
        const current = drPositions.current[f.icao] || { lat: f.lat, lon: f.lon };
        const next = projectPosition(current.lat, current.lon, f.speed, f.heading, dt);
        drPositions.current[f.icao] = next;

        // Trail ring buffer
        if (!trailBuffers.current[f.icao]) trailBuffers.current[f.icao] = [];
        const buf = trailBuffers.current[f.icao];
        buf.push([next.lat, next.lon]);
        if (buf.length > TRAIL_MAX_POINTS) buf.shift();
      });

      animFrameId.current = requestAnimationFrame(tick);
    }
    animFrameId.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animFrameId.current);
  }, [flights]);

  // Conflict detection — runs on each new flight update (not every frame)
  useEffect(() => {
    const conflictSet = new Set();
    for (let i = 0; i < flights.length; i++) {
      for (let j = i + 1; j < flights.length; j++) {
        const a = flights[i], b = flights[j];
        if (Math.abs((a.altitude || 0) - (b.altitude || 0)) > 1000) continue; // vertical sep OK
        const dist = haversineKm(a.lat, a.lon, b.lat, b.lon);
        if (dist < CONFLICT_THRESHOLD_KM) {
          conflictSet.add(a.icao);
          conflictSet.add(b.icao);
        }
      }
    }
    setConflicts(conflictSet);
  }, [flights]);

  // Heatmap layer (leaflet-heat) — lazy loaded
  const mapRef = useRef(null);
  const heatLayerRef = useRef(null);
  useEffect(() => {
    if (!mapRef.current) return;
    if (showHeatmap) {
      import('leaflet.heat').then(() => {
        if (heatLayerRef.current) heatLayerRef.current.remove();
        const points = flights.map(f => [f.lat, f.lon, (f.altitude || 0) / 45000]);
        heatLayerRef.current = L.heatLayer(points, {
          radius: 25, blur: 15, maxZoom: 8,
          gradient: { 0.0: '#4cffaa', 0.4: '#4ca8ff', 0.7: '#ffe44c', 1.0: '#ff4caa' },
        }).addTo(mapRef.current);
      });
    } else {
      heatLayerRef.current?.remove();
      heatLayerRef.current = null;
    }
  }, [showHeatmap, flights]);

  const activeFlight = flights.find(f => f.icao === activeIcao);

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      {/* ─── LAYER CONTROLS ─── */}
      <div style={{
        position: 'absolute', top: 12, right: 12, zIndex: 1000,
        display: 'flex', flexDirection: 'column', gap: 6,
        background: 'rgba(8,12,16,0.85)', border: '1px solid rgba(0,200,160,0.2)',
        borderRadius: 8, padding: '10px 14px',
        fontFamily: 'monospace', fontSize: 11, color: '#6a8898',
      }}>
        <div style={{ color: '#00c8a0', marginBottom: 4, letterSpacing: 1 }}>LAYERS</div>
        {[
          ['Velocity vectors', showVectors, setShowVectors],
          ['Fading trails',    showTrails,  setShowTrails],
          ['Altitude heat',    showHeatmap, setShowHeatmap],
        ].map(([label, val, setter]) => (
          <label key={label} style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
            <input type="checkbox" checked={val} onChange={e => setter(e.target.checked)}
              style={{ accentColor: '#00c8a0' }}/>
            {label}
          </label>
        ))}
        <div style={{ marginTop: 6, borderTop: '1px solid rgba(0,200,160,0.1)', paddingTop: 6 }}>
          <span style={{ color: conflicts.size > 0 ? '#ff4444' : '#3a5060' }}>
            {conflicts.size > 0 ? `⚠ ${conflicts.size / 2 | 0} conflicts` : 'No conflicts'}
          </span>
        </div>
        <div style={{ color: '#3a5060' }}>Zoom: {zoomLevel}</div>
      </div>

      <MapContainer
        center={[20, 78]}
        zoom={5}
        preferCanvas={true}
        style={{ height: '100%', width: '100%' }}
        attributionControl={false}
        whenCreated={m => { mapRef.current = m; }}
      >
        <TileLayer url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png" />
        <ZoomWatcher onZoomChange={setZoomLevel} />
        <CanvasRendererSetup rendererRef={rendererRef} />

        {/* Historical path from DB */}
        {flightPath.length > 0 && (
          <Polyline
            positions={flightPath}
            pathOptions={{ color: '#4a9eff', weight: 2, opacity: 0.6, dashArray: '5 10' }}
          />
        )}

        {flights.map(f => {
          const drPos = drPositions.current[f.icao];
          const trail = trailBuffers.current[f.icao] || [];
          const color  = altColor(f.altitude);
          const isSelected = f.icao === activeIcao;
          const hasConflict = conflicts.has(f.icao);

          return (
            <React.Fragment key={f.icao}>
              {/* Fading trail */}
              {showTrails && <FadingTrail positions={trail} color={color} />}

              {/* Velocity vector */}
              {showVectors && (
                <VelocityVector
                  lat={drPos?.lat ?? f.lat}
                  lon={drPos?.lon ?? f.lon}
                  speed={f.velocity}
                  heading={f.heading}
                  color={color}
                />
              )}

              {/* Conflict alert ring */}
              {hasConflict && (
                <ConflictRing lat={drPos?.lat ?? f.lat} lon={drPos?.lon ?? f.lon} />
              )}

              {/* Rotated aircraft marker (imperative Leaflet, DR-updated) */}
              <AircraftMarker
                flight={f}
                drPosition={drPos}
                isSelected={isSelected}
                onSelect={handleMarkerClick}
              />
            </React.Fragment>
          );
        })}
      </MapContainer>
    </div>
  );
}