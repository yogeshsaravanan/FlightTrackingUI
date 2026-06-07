import { useEffect, useRef } from 'react';

const EARTH_RADIUS = 6371000; // meters

export function useDeadReckoning(flights, setRenderedFlights) {
  const flightsRef = useRef(flights);
  const animationFrameId = useRef(null);
  const lastTimeRef = useRef(performance.now());

  useEffect(() => {
    flightsRef.current = flights;
  }, [flights]);

  useEffect(() => {
    const loop = (currentTime) => {
      const dt = (currentTime - lastTimeRef.current) / 1000; // Delta time in seconds
      lastTimeRef.current = currentTime;

      // Map through active flights mutation structures smoothly
      const updated = flightsRef.current.map((f) => {
        if (f.onGround || f.rawSpeedMs === 0) return f;

        const headingRad = (f.heading * Math.PI) / 180;
        const distance = f.rawSpeedMs * dt;

        const deltaLat = (distance * Math.cos(headingRad)) / EARTH_RADIUS;
        const deltaLon = (distance * Math.sin(headingRad)) / (EARTH_RADIUS * Math.cos((f.lat * Math.PI) / 180));

        return {
          ...f,
          lat: f.lat + (deltaLat * 180) / Math.PI,
          lon: f.lon + (deltaLon * 180) / Math.PI,
          altitude: f.altitude + f.vertRate * dt,
        };
      });

      flightsRef.current = updated;
      setRenderedFlights(updated);
      animationFrameId.current = requestAnimationFrame(loop);
    };

    lastTimeRef.current = performance.now();
    animationFrameId.current = requestAnimationFrame(loop);

    return () => cancelAnimationFrame(animationFrameId.current);
  }, [setRenderedFlights]);
}