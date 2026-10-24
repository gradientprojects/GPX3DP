# GPX3DP

Turn GPX rides into 3D-printable terrain, with the route in its own color.

**Live:** https://gradientprojects.github.io/GPX3DP/

Everything runs in your browser. Your GPX files are never uploaded. The only downloads are public elevation and map tiles.

## What it does

- **Load rides:** drop in one or more GPX files (Strava exports work). Multi-day rides are chained automatically by matching each file's end to the next file's start, and you can drag to reorder them. Isolated GPS spikes are removed.
- **Crop and size:** drag a rectangle on the map, pick your printer (or enter a custom plate), and set the print width or height in mm. The scale ("1 mm = X km") is shown, in km or mi.
- **True to scale:** heights aren't exaggerated unless you ask (Terrain > Advanced). There, a suggested factor for the map's scale is shown with sources, and you choose whether to use it. If a big area comes out flat, **Crop to the mountains** finds a tighter crop over the climbs the ride crosses.
- **Printer-aware:** set your nozzle and layer height. Smoothing follows the nozzle, and route, marker and color-layer heights round to whole layers.
- **Choose the look:**
  - Route: **raised** (stands proud) or **flush** (level with the surface, color only), with width and height in mm. These sizes stay the same however big the print is.
  - Lakes and sea: **flat**, **waterlines** (engraved lines that follow the shore) or **parallel lines**.
  - Rivers, set separately: a **groove** cut into the terrain, or **flush in the water color**. Either way they follow the terrain downhill. Narrow rivers can be added at a width you choose.
  - Markers: start, finish, leg joins, GPX waypoints and pins you click onto the map. Pick a shape for each kind (circle, square, triangle, diamond). They are flat-topped and stand a set height above the route, in the route's color by default.
  - Each element can print in the terrain's color or in **its own color** on a multi-color printer.
- **Underside label:** text pressed into the bottom, such as the ride's name, plus optional ride stats (total distance and climbing) and the vertical exaggeration. Pick one of six bold fonts and set the letter size and depth. A print check measures the thinnest strokes against your nozzle and suggests a size if they'd close up. Place it by dragging and scaling its box in the preview's Underside view, or by an edge and a gap in mm, or click Center. It's mirrored, so it reads correctly when you turn the print over.
- **Export:**
  - **3MF** with named parts (`terrain`, `route`, `water`, `markers`), each pre-assigned to its own filament. Pick the slicer so the parts load as one object:
    - *Bambu Studio / OrcaSlicer* (Bambu's `model_settings.config`)
    - *PrusaSlicer* (one mesh with named volumes)
  - **STL** per part (zip), or one single-body STL.
- **Share:** settings, crop and pins live in the URL. GPX data never does.

Every part is a closed, manifold mesh. The app checks this after each build and shows the result.

## Develop

```bash
npm install
npm run dev      # http://localhost:5173
npm test         # unit tests (Vitest)
npm run build    # type-check + production build into dist/
```

Pushing to `main` deploys to GitHub Pages (`.github/workflows/pages.yml`).

Optional local checks, which need git-ignored test data in `test-data/`:

```bash
node scripts/make-synthetic-gpx.mjs                                       # synthetic rides
SAMPLE_OUT=/tmp/out npx vitest run tests/sample-file.test.ts              # sample 3MF/STL
E2E_OUT=/tmp/out npx vitest run tests/e2e-srmr.test.ts                    # real rides + live tiles
```

### How the model is built

- The crop becomes a grid (default 0.25 mm cells). Elevation is resampled at the cell corners.
- Each cell gets a label: land, water, water line, route or marker.
- Each part is a "slab" over its cells, between two height levels, with walls wherever neighbouring cells differ.
- Parts that touch share exactly the same surface vertices, so they never overlap and each one is watertight.
- 2x2 checkerboard patterns are cleaned up first; they would otherwise make edges shared by four faces.
- Outlines are then smoothed: corners on a boundary move onto the true edge of the route, marker or shoreline. Every part moves with them, so the parts still fit together exactly.
- Code: `src/core/model.ts`, `src/core/mesh.ts`, `src/core/validate.ts`.

## Data and attribution

- Elevation: [Terrain Tiles](https://github.com/tilezen/joerd/blob/master/docs/attribution.md) (Mapzen/Tilezen via AWS Open Data; SRTM, GMTED2010, ETOPO1 and others).
- Map and water: [OpenFreeMap](https://openfreemap.org), [OpenMapTiles](https://www.openmaptiles.org/), © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors (ODbL).

The same attribution is written into every exported 3MF.
