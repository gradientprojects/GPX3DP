import { describe, expect, it } from 'vitest';
import { DEFAULTS, fromHash, paletteKeyFor, resolveColors, roundToLayers, suggestedSmoothMm, toHash, toLayers } from '../src/settings';

describe('palette', () => {
  it('resolves lakes, rivers, text and markers through the palette', () => {
    const s = { ...structuredClone(DEFAULTS), colors: { terrain: '#111111', water: '#222222', route: '#333333', lakes: '#444444', rivers: '#555555', text: '#666666' } };
    expect(resolveColors(s)).toEqual({ terrain: '#111111', water: '#222222', route: '#333333', lakes: '#222222', rivers: '#222222', text: '#222222', markers: '#333333' });
    const own = { ...s, lakesColor: 'own' as const, riversColor: 'own' as const, textColor: 'route' as const, markerColor: 'text' as const };
    expect(resolveColors(own)).toMatchObject({ lakes: '#444444', rivers: '#555555', text: '#333333', markers: '#333333' });
    expect(paletteKeyFor(own, 'markers')).toBe('route');
    expect(paletteKeyFor(s, 'rivers')).toBe('water');
    // a single-color printer prints everything in the terrain color
    expect(new Set(Object.values(resolveColors({ ...own, multiColor: false }))).size).toBe(1);
  });
  it('loads links from before the palette', () => {
    const old = btoa(JSON.stringify({ colors: { terrain: '#010101', route: '#020202', water: '#030303', markers: '#040404' }, markerColor: 'own' }));
    const s = fromHash('#s=' + old.replace(/=+$/, ''));
    expect(s.colors).toEqual({ ...DEFAULTS.colors, terrain: '#010101', route: '#020202', water: '#030303' });
    expect(s.markerColor).toBe('route');
  });
});

describe('suggestedSmoothMm', () => {
  it('is half the nozzle, at least one cell', () => {
    expect(suggestedSmoothMm({ nozzleMm: 0.4, cellMm: 0.25, exaggeration: 1 })).toBe(0.25);
    expect(suggestedSmoothMm({ nozzleMm: 0.6, cellMm: 0.25, exaggeration: 1 })).toBe(0.3);
    expect(suggestedSmoothMm({ nozzleMm: 0.2, cellMm: 0.2, exaggeration: 1 })).toBe(0.2);
  });
  it('grows with exaggeration and stays in the slider range', () => {
    expect(suggestedSmoothMm({ nozzleMm: 0.4, cellMm: 0.25, exaggeration: 10 })).toBe(0.5);
    expect(suggestedSmoothMm({ nozzleMm: 0.8, cellMm: 0.5, exaggeration: 10 })).toBeLessThanOrEqual(1.5);
  });
});

describe('roundToLayers', () => {
  it('rounds feature heights to whole layers, at least one', () => {
    const m = roundToLayers({ ...DEFAULTS, routeHeightMm: 1.05, markerHeightMm: 1.5, colorDepthMm: 0.05, waterLineDepthMm: 0.4 }, 0.2);
    expect([m.routeHeightMm, m.markerHeightMm, m.colorDepthMm, m.waterLineDepthMm]).toEqual([1, 1.6, 0.2, 0.4]);
    expect(roundToLayers(DEFAULTS, 0.12).routeHeightMm).toBe(0.96);
    expect(toLayers(1, 0.2)).toBe(5);
  });
});

describe('URL hash', () => {
  it('round-trips changed settings and drops defaults', () => {
    expect(toHash(DEFAULTS)).toBe('');
    const s = { ...structuredClone(DEFAULTS), nozzleMm: 0.6, smoothAuto: false, exaggeration: 2 };
    expect(fromHash('#' + toHash(s))).toEqual(s);
  });
});
