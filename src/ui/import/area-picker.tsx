import { useEffect, useRef, useState } from 'react';
import { Map, setWorkerUrl, type GeoJSONSource } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import mapWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';

import { areaError, type Bbox } from '../../importers/overpass';

setWorkerUrl(mapWorkerUrl);

export function AreaPicker({ bbox, onChange }: { bbox: Bbox; onChange: (bbox: Bbox) => void }) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<Map | null>(null);
  const latest = useRef({ bbox, onChange });
  useEffect(() => {
    latest.current = { bbox, onChange };
  });
  const [error, setError] = useState('');
  useEffect(() => {
    const element = container.current!;
    let instance: Map;
    try {
      instance = new Map({
        container: element,
        center: [-74.006, 40.7128],
        zoom: 14,
        boxZoom: false,
        style: {
          version: 8,
          sources: {
            osm: {
              type: 'raster',
              tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
              tileSize: 256,
              attribution: '© OpenStreetMap contributors',
            },
          },
          layers: [{ id: 'osm', type: 'raster', source: 'osm' }],
        },
      });
    } catch {
      // Map construction can fail when WebGL is unavailable.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setError('Map unavailable. Enter the bounds below.');
      return;
    }
    map.current = instance;
    instance.on('error', () =>
      setError('Map tiles unavailable. You can still enter bounds below.'),
    );
    function draw() {
      const [w, s, e, n] = latest.current.bbox;
      (instance.getSource('area') as GeoJSONSource | undefined)?.setData({
        type: 'Feature',
        properties: {},
        geometry: {
          type: 'Polygon',
          coordinates: [
            [
              [w, s],
              [e, s],
              [e, n],
              [w, n],
              [w, s],
            ],
          ],
        },
      });
    }
    instance.on('load', () => {
      instance.addSource('area', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      });
      instance.addLayer({
        id: 'area',
        type: 'fill',
        source: 'area',
        paint: { 'fill-color': '#286461', 'fill-opacity': 0.25, 'fill-outline-color': '#286461' },
      });
      draw();
    });
    let start: { lng: number; lat: number } | undefined;
    instance.on('mousedown', (event) => {
      if (!event.originalEvent.shiftKey) return;
      event.preventDefault();
      instance.dragPan.disable();
      start = event.lngLat;
    });
    instance.on('mousemove', (event) => {
      if (!start) return;
      const end = event.lngLat;
      const next: Bbox = [
        Math.min(start.lng, end.lng),
        Math.min(start.lat, end.lat),
        Math.max(start.lng, end.lng),
        Math.max(start.lat, end.lat),
      ];
      latest.current.onChange(next);
      latest.current.bbox = next;
      draw();
    });
    const finish = () => {
      start = undefined;
      instance.dragPan.enable();
    };
    window.addEventListener('mouseup', finish);
    return () => {
      window.removeEventListener('mouseup', finish);
      instance.remove();
      map.current = null;
    };
  }, []);
  useEffect(() => {
    const [w, s, e, n] = bbox;
    if (areaError(bbox)) return;
    (map.current?.getSource('area') as GeoJSONSource | undefined)?.setData({
      type: 'Feature',
      properties: {},
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [w, s],
            [e, s],
            [e, n],
            [w, n],
            [w, s],
          ],
        ],
      },
    });
  }, [bbox]);
  return (
    <section aria-label="Choose area">
      <p>Shift-drag to select an area, or enter bounds. Maximum 50 km².</p>
      <div className="import-map" ref={container} aria-label="Area map" />
      {error && <p role="status">{error}</p>}
      <div className="edit-fields">
        {['West', 'South', 'East', 'North'].map((label, i) => (
          <label className="edit-field" key={label}>
            {label}
            <input
              type="number"
              step="any"
              value={Number.isNaN(bbox[i]) ? '' : bbox[i]}
              onChange={(event) => {
                const next: Bbox = [...bbox];
                next[i] = event.target.valueAsNumber;
                onChange(next);
              }}
            />
          </label>
        ))}
      </div>
      {areaError(bbox) && <p role="alert">{areaError(bbox)}</p>}
    </section>
  );
}
