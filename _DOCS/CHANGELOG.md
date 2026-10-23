# Changelog

Append-only. Newest first. Never edit or remove old entries.

## 2026-10-22 — Smooth outlines, layer height, crop to the mountains, download errors

- Kiran picked from the "what next" list: smooth outlines, layer height, help for flat areas, network errors. Desktop only. Deferred: spur trimming, plinth text, README/link polish.
- Smooth outlines: boundary corners move in XY onto the true outline (exact for route and marker shapes, blurred-mask contour for water). Topology is unchanged, so parts stay closed and matching.
  - First try held corners back whenever a triangle got thin (area floor 0.05 cell²): the error only halved (worst 0.34 cell).
  - Fix: per-cell diagonal choice in `buildSlab`, plus an area floor of 1e-3 cell². Diagonal route edge now within 0.1 cell (was 0.68).
  - Terrain is sampled at the moved corner position, so surfaces stay on the terrain.
  - New fold test (upward and downward XY areas must match per part), since `validateMesh` can't see folded faces. It runs on every combination and the fuzz test.
  - SRMR 3MFs round-trip with 4 named parts and zero repairs in Bambu Studio and PrusaSlicer.
- Layer height setting (default 0.2 mm). Route height, marker height, color layer and water line depth round to whole layers (`roundToLayers`), with a readout.
- Crop to the mountains: `suggestCrop` finds a tighter window over the relief the ride crosses. SRMR 1.9 → 5.8 mm. Also a "Bigger print" button.
- Download errors: `TileError` with failure counts. Elevation stops the build with a Retry button. Water builds without water and says so. Offline waits for the connection. Tests stub `fetch`.
- Kiran raised tiled printing (split into plate-sized tiles); not planned yet.

## 2026-10-22 — Reset to defaults per field and per section

- Kiran: reset to default for each field and each pane.
- ↺ after each changed field (tooltip names the default) and a Reset button in each section header, both hidden when already at defaults.
- Built from the existing `data-k` / `data-color` / printer-type bindings, so every new setting gets a reset automatically.

## 2026-10-22 — Join markers centered on the route

- Kiran: route markers should be centered on the route (a SRMR checkpoint sat beside the line).
- Cause: not the model. The marker was exactly on the leg end, but each SRMR day ends up a short out-and-back spur to camp (0.25 to 1.05 mm at 200 mm wide).
- Fix: `joinPoint` moves a leg-join marker to the base of a spur no longer than the marker diameter. Longer shared sections (the Kiki leg retraces 20+ mm) keep the leg end. Tests in `tests/join.test.ts`.

## 2026-10-22 — Marker shapes and same-as-route color

- Kiran: markers in the route color, raised, with a user-picked shape and a flat top at a height relative to the route.
- `markerOwnColor` (bool) replaced by `markerColor`: route (default) / terrain / own. Single color or no route color falls back to terrain, with a note.
- Shape per kind (circle, square, triangle, diamond), new `waypoint` kind for GPX `wpt` (was lumped with checkpoints). Defaults: start circle, finish square, checkpoint triangle, waypoint diamond. New `stampConvex` rasterizer.
- Height is now measured above the route top (default 1.5 mm; was 3 mm above terrain).
- Validator caught a flush route + markers-in-route-color case with mixed bottom levels in the route part; fixed by putting the markers on the same color layer.
- Tests: all combinations now loop the 3 marker colors (102 + a flat-top test per shape).

## 2026-10-22 — Smoothing under Advanced, with a suggestion

- Kiran: smoothing should move under Advanced and come with a suggestion.
- Added a Nozzle setting (Printer card, default 0.4 mm).
- Smoothing has an Auto checkbox (on by default). Suggested = max(nozzle / 2, cell), a bit more when exaggerated; shown as a hint line. Defaults give 0.25 mm, same as before.
- New `tests/settings.test.ts`: suggestion values and URL hash round trip.

## 2026-10-22 — True scale by default, exaggeration under Advanced

- Kiran: exaggerating the mountains defeats the purpose. Compared other tools: TouchTerrain defaults to 2x (and has a target-relief-mm mode), Terrain2STL 0.5 to 4x; all keep the control on.
- Decision: default exaggeration 1x (was 3x). The slider moved into a collapsed Advanced section of the Terrain card, with a line saying it makes climbs look steeper.
- A note appears when relief is under 3 mm (SRMR at 200 mm: 1.9 mm), pointing at a smaller crop, a bigger print, or Advanced.
- Rejected: an auto relief-height target (it is exaggeration by another name).

## 2026-10-22 — Raised route is a straight z extrusion

- Kiran: the raised route should be the face under it, split at route width and extruded straight up in z.
- Was: top = max(more-smoothed terrain, terrain) + height, so it didn't follow the face exactly.
- Now: top = terrain + route height at every corner, with vertical walls. A test checks every route corner on a tilted slope.
- Tried and dropped the same day: a level-across-the-width top with a 0.2 mm clearance. Not what was asked.

## 2026-10-22 — Milestones 1 to 5 built

- Vite + TS app with a Pages workflow; deps three, maplibre-gl, fflate, @mapbox/vector-tile, pbf. simplify-js was dropped for a typed-array Douglas-Peucker.
- Core (pure, tested):
  - GPX regex scan, leg ordering (exact up to 8 legs), spike filter, projection, printer presets / fit to plate, Terrarium zoom choice;
  - rasterizers (capsule, even-odd fill, EDT, blur);
  - slab mesh builder, model assembly, validator, 3MF/STL export.
- Mesh approach: per-cell labels and level codes; parts share surface vertices; vertical faces are split at every level on the corner line; 2x2 checkerboards are cleaned up.
  - Fuzz and all-combination tests pass the validator.
  - A test proves the validator catches checkerboards.
- 3MF slicer findings (CLI round trips):
  - Bambu needs `model_settings.config`.
  - PrusaSlicer splits `<components>` into separate objects, so it gets its own single-mesh layout with `Slic3r_PE_model.config`.
  - Added a Slicer setting, defaulted from the printer.
  - The OrcaSlicer 2.0.0 CLI segfaults on any input (even `--help`), so it was removed from checks; each run had popped a crash dialog.
- Worker: tile fetch with Cache API, OpenFreeMap water, build, export. Build logic is in `src/worker/build.ts` so a Node e2e test can run it.
- UI: panel with all settings, MapLibre map with crop handles and pins, three.js preview, progress, URL hash, km/mi.
- Fixed while testing in the browser:
  - MapLibre 6 worker failed to load under Vite.
  - The map fit was lost while the map tab was hidden.
  - Crop drags didn't commit (moved to window pointer listeners).
  - The export card covered the settings.
  - The 3D camera didn't re-frame when the size changed.
- Real SRMR: 570,694 points, 1.9 s build, 6.5 MB 3MF.
  - Bambu and PrusaSlicer both load 4 named parts on separate slots with zero repairs.
  - PrusaSlicer sliced it to G-code using all 4 filaments.

## 2026-10-22 — Project created

- Standard setup: `CLAUDE.md`, `_DOCS/SPEC.md`, `_DOCS/CHANGELOG.md`.
- Base spec pasted by Kiran, extended in planning:
  - Public free tool. Public repo so Pages works on the Free plan.
  - Rectangular crop on a 2D map. Scale is set by the mm length of one crop edge. Feature sizes stay in absolute mm.
  - Printer presets cap the print size. Single-color vs multi-color printer.
  - Per-element color (route, water, markers): same as terrain or own color.
  - Route styles: raised or flush. Inlay was dropped.
  - Water from OpenFreeMap vector tiles. Surface: off / flat / waterlines / parallel lines. Water color is set separately.
  - Markers at leg joins, from GPX waypoints, and placed by click.
  - km/mi units. Settings shared in the URL hash.
  - 3MF is primary, with Bambu/Orca and PrusaSlicer name metadata. STL is the fallback. No STEP (mesh-as-STEP is huge and slow).
- Verified CORS: Terrarium tiles (S3) and OpenFreeMap both send `Access-Control-Allow-Origin: *`, so the GeoTIFF fallback was dropped.
