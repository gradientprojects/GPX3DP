import * as maplibregl from 'maplibre-gl';
import type { GeoJSONSource, LngLatBoundsLike, MapMouseEvent } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
// MapLibre 6 loads its worker as an ES module next to its own file; let Vite bundle it instead.
import mapWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';

maplibregl.setWorkerUrl(mapWorkerUrl);
import type { Bounds } from '../core/project';

export const MAP_STYLE = 'https://tiles.openfreemap.org/styles/positron';

export interface MapPin {
  lat: number;
  lon: number;
  kind: 'start' | 'finish' | 'checkpoint' | 'waypoint' | 'manual';
  title: string;
  /** index into the manual pin list, for removal */
  manual?: number;
}

export interface MapCallbacks {
  onCrop: (b: Bounds) => void;
  onAddPin: (lat: number, lon: number) => void;
  onRemovePin: (index: number) => void;
}

const empty = { type: 'FeatureCollection', features: [] } as GeoJSON.FeatureCollection;

/** 2D map: route, editable crop rectangle (corner + move handles), and marker pins. */
export class MapView {
  map: maplibregl.Map;
  private ready: Promise<void>;
  private crop: Bounds | null = null;
  private corners: maplibregl.Marker[] = [];
  private mover: maplibregl.Marker;
  private pins: maplibregl.Marker[] = [];
  addMode = false;

  constructor(el: HTMLElement, private cb: MapCallbacks) {
    this.map = new maplibregl.Map({
      container: el,
      style: MAP_STYLE,
      center: [10, 30],
      zoom: 1.5,
      attributionControl: { compact: true },
    });
    this.map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    this.ready = new Promise((res) => this.map.on('load', () => res()));
    this.ready.then(() => {
      const m = this.map;
      m.addSource('route', { type: 'geojson', data: empty });
      m.addSource('crop', { type: 'geojson', data: empty });
      m.addLayer({ id: 'crop-shade', type: 'fill', source: 'crop', filter: ['==', ['get', 'role'], 'outside'], paint: { 'fill-color': '#000', 'fill-opacity': 0.25 } });
      m.addLayer({ id: 'crop-line', type: 'line', source: 'crop', filter: ['==', ['get', 'role'], 'box'], paint: { 'line-color': '#d23a2a', 'line-width': 2 } });
      m.addLayer({ id: 'route-casing', type: 'line', source: 'route', layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': '#fff', 'line-width': 5 } });
      m.addLayer({ id: 'route', type: 'line', source: 'route', layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': '#d23a2a', 'line-width': 2.5 } });
    });

    for (let i = 0; i < 4; i++) {
      const el = document.createElement('div');
      el.className = 'crop-handle';
      el.title = 'Drag to resize the crop';
      this.corners.push(new maplibregl.Marker({ element: el }).setLngLat([0, 0]));
      // corners: 0 SW, 1 SE, 2 NE, 3 NW; the opposite corner stays put
      this.dragHandle(el, (start, p) => {
        const b = { ...start.b };
        if (i === 0 || i === 3) b.west = p.lng;
        else b.east = p.lng;
        if (i === 0 || i === 1) b.south = p.lat;
        else b.north = p.lat;
        return {
          west: Math.min(b.west, b.east),
          east: Math.max(b.west, b.east),
          south: Math.min(b.south, b.north),
          north: Math.max(b.south, b.north),
        };
      });
    }
    const mv = document.createElement('div');
    mv.className = 'crop-move';
    mv.textContent = '✥';
    mv.title = 'Drag to move the crop';
    this.mover = new maplibregl.Marker({ element: mv }).setLngLat([0, 0]);
    this.dragHandle(mv, (start, p) => {
      const dx = p.lng - start.lng, dy = p.lat - start.lat, b = start.b;
      return { west: b.west + dx, east: b.east + dx, south: b.south + dy, north: b.north + dy };
    });

    this.map.on('click', (e: MapMouseEvent) => {
      if (this.addMode) this.cb.onAddPin(e.lngLat.lat, e.lngLat.lng);
    });
  }

  /**
   * Pointer-capture dragging for crop handles. (MapLibre's marker drag only ends on a map
   * mouseup, so a release elsewhere left the crop uncommitted.)
   */
  private dragHandle(el: HTMLElement, next: (start: { lng: number; lat: number; b: Bounds }, p: { lng: number; lat: number }) => Bounds) {
    let start: { lng: number; lat: number; b: Bounds } | null = null;
    const at = (e: PointerEvent) => {
      const r = this.map.getContainer().getBoundingClientRect();
      return this.map.unproject([e.clientX - r.left, e.clientY - r.top]);
    };
    // Window listeners, not pointer capture: the handle element can be re-inserted mid-drag.
    const move = (e: PointerEvent) => {
      if (start) this.setCrop(next(start, at(e)));
    };
    const end = (e: PointerEvent) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
      if (!start) return;
      const b = next(start, at(e));
      start = null;
      this.setCrop(b);
      this.cb.onCrop(b);
    };
    el.addEventListener('pointerdown', (e) => {
      if (!this.crop || e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      start = { ...at(e), b: { ...this.crop } };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', end);
      window.addEventListener('pointercancel', end);
    });
  }

  async setRoute(lines: [number, number][][]) {
    await this.ready;
    (this.map.getSource('route') as GeoJSONSource).setData({
      type: 'FeatureCollection',
      features: lines.map((coords) => ({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: coords } })),
    });
  }

  async setCrop(b: Bounds | null) {
    this.crop = b ? { ...b } : null;
    await this.ready;
    const src = this.map.getSource('crop') as GeoJSONSource;
    if (!b) {
      src.setData(empty);
      this.corners.forEach((c) => c.remove());
      this.mover.remove();
      return;
    }
    const ring = [[b.west, b.south], [b.east, b.south], [b.east, b.north], [b.west, b.north], [b.west, b.south]];
    src.setData({
      type: 'FeatureCollection',
      features: [
        { type: 'Feature', properties: { role: 'box' }, geometry: { type: 'LineString', coordinates: ring } },
        {
          type: 'Feature',
          properties: { role: 'outside' },
          geometry: { type: 'Polygon', coordinates: [[[-180, -85], [180, -85], [180, 85], [-180, 85], [-180, -85]], ring.slice().reverse()] },
        },
      ],
    });
    const pos: [number, number][] = [[b.west, b.south], [b.east, b.south], [b.east, b.north], [b.west, b.north]];
    this.corners.forEach((c, i) => {
      c.setLngLat(pos[i]);
      if (!c.getElement().isConnected) c.addTo(this.map);
    });
    this.mover.setLngLat([(b.west + b.east) / 2, (b.south + b.north) / 2]);
    if (!this.mover.getElement().isConnected) this.mover.addTo(this.map);
  }

  async setPins(pins: MapPin[]) {
    await this.ready;
    this.pins.forEach((p) => p.remove());
    this.pins = pins.map((p) => {
      const el = document.createElement('div');
      el.className = `pin ${p.kind}`;
      el.title = p.manual !== undefined ? `${p.title} (click to remove)` : p.title;
      if (p.manual !== undefined)
        el.addEventListener('click', (e) => {
          e.stopPropagation();
          this.cb.onRemovePin(p.manual!);
        });
      return new maplibregl.Marker({ element: el }).setLngLat([p.lon, p.lat]).addTo(this.map);
    });
  }

  setAddMode(on: boolean) {
    this.addMode = on;
    this.map.getContainer().classList.toggle('map-add-mode', on);
  }

  private pendingFit: Bounds | null = null;

  /** Fit the view to `b`; while the map is hidden (zero size) the fit waits for `resize()`. */
  async fit(b: Bounds) {
    await this.ready;
    if (!this.map.getContainer().clientWidth) {
      this.pendingFit = b;
      return;
    }
    this.map.fitBounds([[b.west, b.south], [b.east, b.north]] as LngLatBoundsLike, { padding: 40, duration: 0 });
  }

  resize() {
    this.map.resize();
    if (this.pendingFit && this.map.getContainer().clientWidth) {
      const b = this.pendingFit;
      this.pendingFit = null;
      this.fit(b);
    }
  }
}
