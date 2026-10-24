# GPX3DP — Spec

Living design document. Current truth only; history goes in `CHANGELOG.md`.

**Last updated:** 2026-10-23

## Goal

A free public static web app on GitHub Pages. It turns one or more GPX files into a 3D-printable terrain model, with the route (and optionally water and markers) as separate parts for multi-color printing, or as one body for single-color printers.
- All processing runs in the browser, with no backend and no API keys.
- Benchmark: the 6-leg Silk Road Mountain Race: about 570k points, 2,100 km, a 440 x 215 km bbox. It must produce a valid 3MF in under about 30 s without running out of memory.

## Current state

- 2026-10-22: Milestones 1 to 6 are built: GPX load, ordering, crop, elevation, terrain, route, water, markers, 3MF/STL, 3D preview, URL hash, smooth outlines, layer rounding, crop suggestion, download errors. 118 unit tests.
- 2026-10-22: committed, pushed and live at https://gradientprojects.github.io/GPX3DP/ (Pages builds from Actions on every push to `main`).
- Real SRMR (6 files, 570,694 points):
  - parsed in 0.25 s; auto-order seams all under 0.7 km;
  - full build in 1.9 s at 200 mm (z8, 15 tiles, ~0.8M triangles); 3MF in 0.9 s, 6.5 MB.
- Slicer checks (CLI round trips of the real SRMR model):
  - Bambu Studio: one object, 4 named parts, slots 1 to 4, zero mesh repairs.
  - PrusaSlicer: same, and sliced to G-code using all 4 filaments.
- Small ride (~13 km area): z13, 25 tiles, 2.8 s.
- 2026-10-23: underside label built (not committed yet). 133 unit tests.
  - Death Ride (200 mm, 3 lines): builds in about 0.5 s with the label, manifold.
  - PrusaSlicer CLI: `--info` reports manifold with 2 parts; the first SLA layers show the text as gaps.
- Not verified yet: OrcaSlicer (its CLI segfaults on this Mac, even on `--help`) and slicing in the Bambu GUI. Kiran to check both in the apps.

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
- Climbing per file from `<ele>`: the sum of rises, with a 2 m hysteresis to ignore GPS jitter (`climbOf` in `gpx.ts`). Files without elevations give none. Death Ride: 3,952 m (12,966 ft); the published figure is about 15,000 ft, so this may read low against Strava. Kiran to compare.
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
- Nozzle: 0.2 / 0.4 / 0.6 / 0.8 mm (default 0.4). Used for the smoothing suggestion.
- Layer height: 0.08 to 0.28 mm (default 0.2). Feature heights are rounded to whole layers (see Solids).
- Desktop only; phone and tablet layouts are out of scope.
- Units toggle: km / mi for all displayed distances. Print dimensions are always mm.

### 3. Elevation
- Terrarium tiles: `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png`, decoded as `elev = R*256 + G + B/256 - 32768`. CORS was verified, so there's no GeoTIFF fallback.
- Zoom: the lowest z whose ground resolution is no coarser than the cell size, capped at z13 and about 64 tiles. Step down past that.
- Stitch the tiles and resample bilinearly to the output grid.
  - Cell size defaults to 0.25 mm (range 0.2 to 0.5).
  - Gaussian smoothing (radius in print mm), under Terrain > Advanced. **Auto** by default: suggested = max(nozzle / 2, cell) x (1 + (exaggeration - 1) / 9), rounded to 0.05 mm, max 1.5. It removes data noise and detail narrower than the nozzle can print. Untick Auto to set it by hand.
- Tiles are cached with the Cache API. Each download is tried 3 times.
- Download failures (`TileError`):
  - Elevation: the build stops ("Couldn't download elevation data (N of M tiles)"), with a **Retry** button on the message. A partial elevation grid would print holes or cliffs.
  - Water (tiles or TileJSON): the build goes ahead without water, with a message. The next build tries again.
  - Offline: the message says so, and the model builds by itself when the connection comes back.

### 4. Water
- Source: OpenFreeMap vector tiles, rasterized to a water mask on the grid with two codes:
  - lake (1): `water` polygons (lakes, ponds, reservoirs, docks, sea);
  - river (2): river-class `water` polygons (wide rivers) plus, optionally, `waterway` river/canal lines at a width setting.
  - Where the two overlap, lakes win.
- Wide rivers count as rivers, not lakes: they run downhill too.
- **Lakes and sea** and **Rivers** are set separately in the Water card.
- Rivers (`riverStyle`):
  - **Off.**
  - **Groove** (default): a channel `riverDepthMm` (default 0.6, rounded to layers) below the terrain, in the terrain color.
  - **Water color**: flush with the surface, in the water part. It needs a multi-color printer, otherwise it falls back to Groove with a note.
  - Rivers are never flattened and get no texture: both styles follow the terrain downhill.
  - "Include narrow rivers" (off by default) adds the waterway lines. A note warns when they are under 2 nozzle widths.
- Mesh details:
  - The groove and the water lines are two engraved levels. Deeper gets the lower level code (`engraved` in `model.ts`), shared when the depths are equal.
  - The color layer depth is at least the groove + 0.2 mm, but only when there are grooved river cells. Without rivers nothing changes.
- Death Ride at 200 mm, narrow rivers on at 1 mm: 7,576 river cells and 4,378 lake cells. Both styles are manifold; PrusaSlicer `--info` says manifold. With Water color, PrusaSlicer counts each separate river piece as its own shell.
- Lakes and sea surface setting: `off | flat | waterlines | parallel lines`.
  - Anything except off flattens the water to the lake level (a low percentile of the elevation under each water body).
  - Waterlines: engraved lines following the shoreline at a fixed spacing, from a distance transform of the mask. This is the default texture.
  - Parallel lines: straight engraved lines at a set angle (degrees counter-clockwise from east-west, default 0).
  - Spacing, line width and depth are absolute mm.
- Water color is set separately (same as terrain / own color), so a textured water surface can stay in the terrain material on a multi-color printer.

### 5. Route
- Rasterized to a mask: `lineWidth = route_width_mm / cell_mm`, with round caps and joins.
- Styles:
  - Raised: the terrain face under the route (the route-width strip of cells), extruded straight up in z by the route height. Top = terrain + height at every corner; walls are vertical. No extra smoothing and no offset along the surface normal.
  - Flush: level with the surface; color only, so it needs the route's own color.
- Defaults: width 1.2 mm, height 1.0 mm. Absolute mm, not scaled with the print.

### 6. Markers
- Sources: automatic at leg joins, GPX `wpt`, and click-to-place on the map (add/remove).
- Kinds: start, finish, checkpoint (leg joins and click-placed pins), waypoint (GPX `wpt`).
- Leg-join markers sit where the route passes, not at the tip of a spur. Days often end up a short out-and-back spur (camp, hotel), which put the marker beside the main line.
  - `src/core/join.ts` walks back along the ending leg and forward along the next one together. Where they stay within half a route width, they are one spur.
  - A spur no longer than the marker diameter moves the marker to the spur's base. A longer shared section is real route, so the marker stays at the leg end.
  - SRMR: 4 of 5 joins had spurs of 0.25 to 1.05 mm at 200 mm wide (about 0.6 to 2.6 km).
- Shape per kind: circle / square / triangle / diamond. Defaults follow map-app convention: start circle, finish square, checkpoint triangle, waypoint diamond. Triangles point north. Start and finish are drawn 1.4x larger.
- Raised with a **flat top** at `markerHeightMm` (default 1.5) above the highest route top under the marker. The route top is the terrain + route height for a raised route, and the terrain for a flush route. Sizes are absolute mm.
- Color: same as route (default), same as terrain, or own color.
  - Same as route: the marker cells join the `route` part. With a flush route they sit on the same lowered color layer as the route, so the part has one bottom level (mixed bottom levels made the route part non-manifold).
  - Same as route without a route color, or on a single-color printer, falls back to the terrain, with a note.

### 7. Solids
- Everything is one heightfield grid with per-cell region labels.
- Each part is a slab over its cell mask: bottom surface, top surface, and vertical walls where neighboring surfaces differ.
- Touching parts share identical surfaces, so they don't overlap and each is watertight.
  - Raised route: its bottom is the terrain top.
  - Flush route or own-color water: the terrain is lowered by the color-layer depth (default 0.6 mm), and that part fills back up to the surface.
- Elements set to "same as terrain" are folded into the terrain part.
- Terrain z = base_mm + (elev - elev_min) * vertical_scale, where vertical_scale = exaggeration / horizontal_scale.
  - Defaults: true scale (exaggeration 1x), base 3 mm.
  - Exaggeration (1 to 10x) sits under a collapsed **Advanced** in the Terrain card. The point of the print is the real ride, so heights are true to scale unless the user opts in.
  - **Suggested exaggeration** (`suggestExaggeration` in `src/core/exaggeration.ts`), shown under the slider after each build with a **Use Nx** button. It is never applied by itself.
    - Rule: max(1, (S / 50,000)^0.6) for a scale of 1:S. It fits ETH's ranges and Hubbard's 1:250,000 Knoxville sheet at 3:1.
    - Then it is capped so the relief stays at or under 15 mm (mountainous areas need less), and rounded down to 1, 1.5, 2, 3, 4, 5, 6, 8 or 10.
    - Death Ride 1:219,000 gives 1.5x (12.2 mm). SRMR 1:2,528,000 gives 6x.
    - Links: ETH Zurich terrain models, Wikipedia, and Räber (ICA) as the counterpoint (Imhof: exaggeration is "a falsification"). Not Esri.
  - Exports state the factor when it isn't 1x: "Vertical exaggeration Nx." is added to the 3MF description.
  - When relief comes out under 3 mm (`FLAT_RELIEF_MM`), a note suggests a tighter crop, a bigger print, or Advanced exaggeration (SRMR at 200 mm: 1.9 mm). Buttons under it:
    - **Crop to the mountains (about X mm relief)**, from `suggestCrop` in `src/core/crop.ts`. It tries windows of 1/2, 1/3 and 1/4 of the crop (same aspect), slid in quarter steps. A window must hold at least its own width of route. It takes the largest window reaching 8 mm at the same print size, else the one with the most relief. It's only offered if that beats the current relief by half again and 1 mm. SRMR: 1.9 → 5.8 mm.
    - **Bigger print (fit to plate)**, when the print isn't at the plate's maximum.
  - The readout shows "heights xN" when exaggeration is above 1.
  - The computed relief height in mm is shown.
- **Smooth outlines** (`smoothOutlines` in `model.ts`): the grid stays, but corners on a boundary between two labels move in XY onto the true outline of the higher label.
  - Route: exact, from the centerline polylines (nearest point + half the width). Markers: exact, from each shape's outline, so squares, triangles and diamonds keep sharp corners. Water and water lines: the 0.5 contour of the region's mask blurred by 1 cell.
  - Every part's vertices are keyed by corner, so all parts move together: still closed, still matching, walls still vertical. Terrain heights are sampled at the moved position.
  - Each cell is split on whichever diagonal keeps both triangles larger. A cell that would still fold has its corners pulled back (halved, then zeroed).
  - Diagonal route edge: within 0.1 cell of the true edge (the staircase was up to 0.68 cell off).
- Feature heights are rounded to whole layers before building: route height, marker height, color layer and water line depth (at least 1 layer). The inputs keep what was typed; a readout under Layer height shows the result.
- Validator: every undirected edge is used exactly twice in opposite directions, signed volume > 0, no degenerate triangles. It runs in the tests.

### 7b. Underside label
- Text debossed into the terrain part's flat bottom. Off until there is a line of text.
- Lines:
  - the typed text (several lines; the placeholder is the ride name);
  - optional **Ride stats**: total distance of all files and total climbing, in km/m or mi/ft;
  - optional **Vertical exaggeration**: "Vertical exaggeration Nx", with "(true scale)" at 1x.
- Fonts (`src/fonts.ts`, `labelFont`, default Inter): bold weights only, since thin strokes close up.
  - The six fonts: Inter Bold, Atkinson Hyperlegible Bold (best small), Nunito ExtraBold (rounded), Barlow Condensed Bold (long names), Roboto Slab Bold, JetBrains Mono Bold.
  - Licences: all OFL except Roboto Slab (Apache-2.0). Packages are fontsource 5.3.0, latin WOFF, 14 to 31 KB each.
  - The worker fetches each font the first time it's used and parses it with opentype.js. The card's text preview is shown in the chosen font (FontFace API).
  - Characters a font lacks (emoji) are left out, with a note.
- Size is the capital-letter height in mm (default 6). Lines are 1.6 x the size apart.
- Print check, measured from the built text (`thinnestPx` in `label.ts`): an area-weighted local thickness on the 0.05 mm bitmap, 5th percentile. Sharp notches and stroke tips don't count.
  - Groove: the thinnest letter stroke, which is a gap in the first layers. Wall: the thinnest plastic between strokes or inside counters, up to 2 mm.
  - **Good** when groove ≥ 2 x nozzle and wall ≥ 1.5 x nozzle. **Tight** at ≥ 1 x for both. **Too fine** below that. The readout names which limit applies.
  - It suggests the size that reaches Good (widths scale with size, rounded up to 0.5 mm). If the text was shrunk to fit, it suggests fewer lines, a condensed font or a bigger print instead.
  - Death Ride at 0.4 mm: Inter is Good from 5.5 mm (8 mm: groove 1.22, wall 0.85). Atkinson is Good at 6 mm.
- A collapsed **Tips for a clean deboss** list covers:
  - groove width;
  - elephant foot compensation;
  - smooth plate;
  - 3 to 4 layers deep;
  - bold or condensed fonts;
  - paint fill for contrast.
- Placement, per axis as read from below (`labelEdgeX` / `labelOffX`, `labelEdgeY` / `labelOffY`):
  - From left / right / bottom / top: the gap in mm between that print edge and the same side of the text box.
  - Centered: the box center's offset from the center line (0 = centered). The **Center** button centers both axes.
  - Align: **Auto** (default) follows Across: from left gives left-aligned lines, centered gives centered, from right gives right-aligned. Left / center / right override it.
  - The box stays 3 mm inside the edges, and is shrunk to fit (with a note) if it is too big.
- The text is mirrored left to right, so it reads correctly when the print is turned over.
- Depth default 0.6 mm, rounded to whole layers. It is capped at base − color layer − 0.4 mm, so the pocket never reaches a color layer (2.0 mm with the defaults); a note says when it was capped.
- Geometry (`src/core/label.ts`, `pocketBottom` in `mesh.ts`):
  - Glyph outlines are rasterized at 0.05 mm, OR'ed, and traced with marching squares into clean rings: letters counter-clockwise, islands clockwise, never touching.
  - The bottom has five pieces: a strip from the perimeter to a rectangle inset 1.5 mm; that rectangle with the letters cut out; the islands; the letter ceilings at the depth; and the walls.
  - Faces are triangulated with earcut in exact integer grid units. Two clean-ups follow:
    - `fixSlivers`: zero-area triangles are flipped with their neighbour.
    - `fixTJunctions`: a hole bridge running exactly through a vertex is split at that vertex.
- 3D preview: **Top / Underside** toggle. Underside looks up from below, tilted, with a light from below; the pocket is shaded darker (preview only).
- Dragging in the Underside view:
  - A dashed box over the text: drag it to move; drag a corner to scale (aspect kept, opposite corner fixed, size rounded to 0.5 mm, 2 to 40 mm). Orbiting still works outside the box.
  - Only the box moves during the drag. On release, each axis snaps on its own: to Centered if the box center is within 3 mm of the center line (a dashed guide shows), else to the nearer edge with the gap rounded to 0.5 mm. The fields update and the model rebuilds.

### 8. Export
- 3MF (primary): one object whose parts are `terrain`, `route`, `water` and `markers` (own-color elements only), in millimeters.
  - Placed in the middle of the chosen printer's plate (build item transform).
  - Attribution goes in the metadata.
  - Color parts get `sparse_infill_density 100%` in the Bambu config, so infill doesn't show through thin color layers.
- No single 3MF layout works in both slicer families, so there is a **Slicer** setting. It defaults from the printer preset (Prusa printers → PrusaSlicer).
  - Bambu Studio / Orca: one mesh object per part, grouped under a parent with `<components>`, plus `Metadata/model_settings.config` with part names and filament slots. Bambu ignores 3MF object names without that file. Never claim `Application=BambuStudio`: Bambu then expects a full project.
  - PrusaSlicer: one mesh object holding all parts, with `Metadata/Slic3r_PE_model.config` volumes by triangle range (names and extruders). PrusaSlicer turns `<components>` into separate objects.
  - A hybrid (components layout + Slic3r_PE config) was tested and does not work in PrusaSlicer.
- STL (fallback): one file per part plus a merged single-body file.
- No STEP.

### 9. UI
- Left panel:
  - files and leg order;
  - printer (preset, type, slicer, nozzle, layer height);
  - crop edge length and units;
  - base, Advanced (smoothing with Auto, exaggeration);
  - route (style, width, height, color);
  - water (surface, texture, color);
  - markers (sources, shape per kind, size, height above route, color);
  - underside label (text, stats, exaggeration, font, size with print check, depth, Across / Up, Center, align, tips).
- 2D map with the route and an editable crop rectangle, and the 3D three.js preview with orbit controls, part colors and dimensions.
- Builds never switch the view. A build that finishes while the map is showing puts a dot on the **3D preview** tab, cleared when it is opened. Only "Add pins on map" switches (to the map), since you click it.
- Progress per stage: parsing, tiles N of M, meshing, exporting.
- Settings, crop and manual markers are stored in the URL hash.
- Reset to defaults:
  - A small ↺ after each setting appears only when it differs from the default. Its tooltip names the default.
  - A **Reset** button in each section header appears when anything in the section differs. The Crop section's reset also clears a dragged crop.
  - Resets fire the normal input event, so linked settings follow (a printer preset sets the plate and slicer).
  - Manual pins are kept; "Clear my pins" removes them. Smoothing set by Auto doesn't count as changed.
- Attribution: Terrarium sources (Mapzen/AWS), © OpenStreetMap contributors, OpenFreeMap / OpenMapTiles.

## Decisions

- Public repo: the Free plan can't serve Pages from a private repo.
- Inlay route style was dropped. Flush needs a multi-color printer.
- Water color is independent of water texture (e.g. textured water in terrain color, red route on AMS).
- No STEP export: a terrain mesh as STEP would be about 1 GB, slow to import, and has no filament slots.
- Text goes on the underside (debossed), not on a plinth. No crop shapes other than rectangle.
- Label text is traced from a raster rather than meshed from the font outlines directly: overlapping and touching contours merge cleanly, so the pocket is always a valid set of rings.

- Route rasterizing uses a pure-TS capsule stamp instead of a canvas, so it is deterministic and testable in Node. Water polygons use an even-odd scanline fill, clipped per tile.
- Legs whose seam is under 2 km are joined into one line. Bigger gaps are left open.
- Crop handles use their own pointer dragging on window listeners. MapLibre's marker drag only ends on a map mouseup, and the handles are re-inserted mid-drag.
- MapLibre 6 needs its worker bundled by Vite (`?worker&url` + `setWorkerUrl`).

## Test data

- `test-data/srmr/`: Kiran's 6 real SRMR files (git-ignored; zips also kept in the project root, git-ignored).
- `test-data/synthetic/`: from `scripts/make-synthetic-gpx.mjs`.

## Open questions

- OrcaSlicer: confirm in the app that the Bambu-layout 3MF opens with named parts.
- Bambu Studio GUI: confirm it slices with the parts on separate filaments.
- "Crop to the mountains" can pick a window where the route runs along one edge (SRMR does). Prefer windows with the route nearer the middle?
- On hold (Kiran, 2026-10-23): tiled print. Set an overall size and a maximum tile size; the app scales and splits the print into plate-sized tiles. Open choices: joints, tile labels, markers at seams, export format.
- Deferred: trimming short end-of-day spurs from the route itself, README screenshot and link-preview polish.
