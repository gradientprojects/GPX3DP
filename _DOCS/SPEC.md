# GPX3DP — Spec

Living design document. Current truth only; history goes in `CHANGELOG.md`.

**Last updated:** 2026-10-22

## Goal

A free public static web app on GitHub Pages. It turns one or more GPX files into a 3D-printable terrain model, with the route (and optionally water and markers) as separate parts for multi-color printing, or as one body for single-color printers.
- All processing runs in the browser, with no backend and no API keys.
- Benchmark: the 6-leg Silk Road Mountain Race: about 570k points, 2,100 km, a 440 x 215 km bbox. It must produce a valid 3MF in under about 30 s without running out of memory.

## Current state

- Project created 2026-10-22. Nothing built yet.

## Constraints

- Static site, deployed to Pages by a GitHub Actions workflow. Public repo `gradientprojects/GPX3DP`.
- The only network requests are public tiles:
  - elevation: AWS Terrarium;
  - basemap and water: OpenFreeMap vector tiles.
- GPX data never leaves the browser.
- Heavy work (tile decode, meshing, export) runs in a Web Worker.
- Stack: Vite + TypeScript, three.js (preview), MapLibre GL (2D map + crop), fflate (3MF zip), simplify-js, @mapbox/vector-tile + pbf, Vitest. No UI framework.

## Pipeline

### 1. GPX input
- Multiple files by drag-drop or picker. Fast scan of `trkpt` lat/lon (and optional ele) and `wpt`.
- Don't rely on `<time>`; Strava exports often lack it.
- Auto-order legs by matching ends to starts (haversine) and minimizing the total seam distance. Exact search for 8 legs or fewer, greedy beyond that. The order is shown and can be reordered by drag.
- Spike filter: drop isolated A -> far -> A jumps of more than N km. Keep one-way gaps (dropouts), which print as straight lines.
- Simplify each leg to about 0.1 mm at print scale.

### 2. Crop, projection, scale
- Web Mercator meters, scaled by cos(center latitude), so print mm match true ground distance.
- The crop is a rectangle drawn and dragged on the 2D map. The default is the route bbox + 5% margin. Rectangle is the only shape.
- Scale: the user types the mm length of one crop edge (width or height). The other edge follows the aspect ratio.
  - Shown as "1 mm = X km" (or mi).
  - Capped by the printer's plate size minus an edge margin. "Fit to plate" sets the largest size.
- Printer presets: Bambu A1 mini, A1, P1S/P1P/X1C, H2D; Prusa MK4, Core One, MINI; Creality Ender-3, K1; Voron 350; Custom.
- Printer type: single color or multi-color.
- Units toggle: km / mi for all displayed distances. Print dimensions are always mm.

### 3. Elevation
- Terrarium tiles: `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png`, decoded as `elev = R*256 + G + B/256 - 32768`. CORS was verified, so there's no GeoTIFF fallback.
- Zoom: the lowest z whose ground resolution is no coarser than the cell size, capped at z13 and about 64 tiles. Step down past that.
- Stitch the tiles and resample bilinearly to the output grid.
  - Cell size defaults to 0.25 mm (range 0.2 to 0.5).
  - Optional Gaussian smoothing, σ = 1 cell by default.
- Tiles are cached with the Cache API.

### 4. Water
- Source: OpenFreeMap vector tiles, `water` polygons, plus optional `waterway` lines at a width setting. Rasterized to a water mask on the grid.
- Surface setting: `off | flat | waterlines | parallel lines`.
  - Anything except off flattens the water to the lake level (a low percentile of the elevation under each water body).
  - Waterlines: engraved lines following the shoreline at a fixed spacing, from a distance transform of the mask. This is the default texture.
  - Parallel lines: straight engraved lines.
  - Spacing, line width and depth are absolute mm.
- Water color is set separately (same as terrain / own color), so a textured water surface can stay in the terrain material on a multi-color printer.

### 5. Route
- Rasterized to a mask: `lineWidth = route_width_mm / cell_mm`, with round caps and joins.
- Styles:
  - Raised: top = more-smoothed terrain + height, clamped above the terrain.
  - Flush: level with the surface; color only, so it needs the route's own color.
- Defaults: width 1.2 mm, height 1.0 mm. Absolute mm, not scaled with the print.

### 6. Markers
- Sources: automatic at leg joins, GPX `wpt`, and click-to-place on the map (add/remove).
- Start and finish are styled differently. Small pillars, sized in absolute mm.

### 7. Solids
- Everything is one heightfield grid with per-cell region labels.
- Each part is a slab over its cell mask: bottom surface, top surface, and vertical walls where neighboring surfaces differ.
- Touching parts share identical surfaces, so they don't overlap and each is watertight.
  - Raised route: its bottom is the terrain top.
  - Flush route or own-color water: the terrain is lowered by the color-layer depth (default 0.6 mm), and that part fills back up to the surface.
- Elements set to "same as terrain" are folded into the terrain part.
- Terrain z = base_mm + (elev - elev_min) * vertical_scale, where vertical_scale = exaggeration / horizontal_scale.
  - Defaults: exaggeration 3x (range 1 to 10), base 3 mm.
  - The computed relief height in mm is shown.
- Walls are stair-stepped at cell resolution. Smoothing them with marching squares is a later goal.
- Validator: every undirected edge is used exactly twice in opposite directions, signed volume > 0, no degenerate triangles. It runs in the tests.

### 8. Export
- 3MF (primary): one object whose parts are `terrain`, `route`, `water` and `markers` (own-color elements only), in millimeters.
  - Includes `Metadata/model_settings.config` (Bambu Studio / Orca), with part names and a different filament slot per part.
  - Includes `Metadata/Slic3r_PE_model.config` (PrusaSlicer volume names).
  - Attribution goes in the metadata.
- STL (fallback): one file per part plus a merged single-body file.
- No STEP.

### 9. UI
- Left panel:
  - files and leg order;
  - printer (preset, type);
  - crop edge length and units;
  - exaggeration, base, smoothing;
  - route (style, width, height, color);
  - water (surface, texture, color);
  - markers (color, size).
- 2D map with the route and an editable crop rectangle, and the 3D three.js preview with orbit controls, part colors and dimensions.
- Progress per stage: parsing, tiles N of M, meshing, exporting.
- Settings, crop and manual markers are stored in the URL hash.
- Attribution: Terrarium sources (Mapzen/AWS), © OpenStreetMap contributors, OpenFreeMap / OpenMapTiles.

## Decisions

- Public repo: the Free plan can't serve Pages from a private repo.
- Inlay route style was dropped. Flush needs a multi-color printer.
- Water color is independent of water texture (e.g. textured water in terrain color, red route on AMS).
- No STEP export: a terrain mesh as STEP would be about 1 GB, slow to import, and has no filament slots.
- Plinth text is deferred. No crop shapes other than rectangle.

## Open questions

- Real SRMR + local test GPX go in `test-data/` (git-ignored). Until then, synthetic tracks are used.
- Confirm that Bambu Studio / Orca / PrusaSlicer show part names and filament slots from the 3MF.
