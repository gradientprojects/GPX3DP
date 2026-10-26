# Changelog

Append-only. Newest first. Never edit or remove old entries.

## 2026-10-25 — Kiran's live-site feedback: palette owns the switches, label icons, exaggeration size

Kiran exported a print from the live site and sent feedback; all of it worked locally first, pushed together afterwards.

- **Palette owns on/off (1–4).** The map showed lakes in the terrain color while the palette said Water = blue, rivers drew grey next to a visible "River color" swatch, and picking a water color did nothing until a checkbox in the Water card was ticked. Cause: color lived in the palette, on/off in the feature cards. Now Lakes, Rivers and Text have a "Same as terrain" choice in the palette that means "shaped into the terrain" (flattened lakes, grooved rivers, debossed text); any color makes the part. `paletteModel` derives `waterOwnColor`, `riverStyle` and `labelStyle`; the Lake color checkbox, the river Groove / River color choice (now Off / On) and the label Style select are gone, each card says what the palette decided. Defaults: lakes and rivers same as water, text same as terrain. Old links migrate.
- **Label placement labels (5).** "Across: Centered / Up: Centered / Align" became Position (left to right, bottom to top: an edge and the gap, or the middle and a nudge), "Put it in the middle", and Line alignment.
- **Exaggeration line (6, 7).** Its own size (`labelExagMm`, default 4 mm) instead of 0.65 x the main text raised to a computed floor; the floor, `smallSizeMm` and the note Kiran found misleading are gone. The 3D drag scales both sizes in proportion. The print check says when only this line is tight. Text is now "(Vertical exaggeration 6×)" or "(true scale)".
- **Stats lines with icons (8, 9).** Distance and climbing on their own lines, no "climbing" word, each led by an icon Kiran picked from mock-ups: a stout right arrow and twin peaks, both solid polygons at the cap height with strokes like Inter Semibold's stems. Icons are private-use characters the layout turns into polygons; they go through the same raster, print check and inlay as the letters, and show as inline SVG in the card's preview.
- Tests: the small-line tests now cover explicit sizes; a new test lays out icon lines and builds a manifold pocket and plug from them; `paletteModel` and the old-switch migration are tested. 200 tests. Checked in the browser: palette-driven parts, two icon lines and the parenthesised exaggeration line in the Underside view as a water-colored inlay.

## 2026-10-25 — Exaggeration-line note was misleading

- Kiran saw "The exaggeration line prints at 23.4 mm, the smallest that prints cleanly" at sizes where that was plainly untrue. The note compared the last build's line with the current size setting (they differ between a size change and the rebuild), and assumed the line had been raised to a clean size when it may simply have been held at the main size. It now compares against the size the label was built at and says either "prints at X mm rather than Y mm" or "stays at the main size", both ending "smaller, its letters would be too fine for a N mm nozzle".

## 2026-10-25 — Drop loaded files twice; Clear button

- Kiran dropped 6 GPX files and got 12 legs. The drop handler was registered on both the drop zone and the page body, and a drop on the zone bubbled to the body. One body listener now.
- The Rides card header has a Clear button (shown when files are loaded) that removes every file, the same path as removing the last one with ✕.

## 2026-10-25 — Palette, color label, lighter label font, map in print colors, gap-aware stats

- **Ride stats skip recording gaps.** Comparing the SRMR legs with Strava: the app read 1,243 mi / 113,553 ft against Strava's 1,170 mi / 81,915 ft, while the two day rides matched within 3%. The multi-day files have the Garmin off and on again 30 to 80 times per leg; the app counted the straight line across each gap and the barometer reset after it. Stationary jitter was tested first and explained nothing. Now a step over max(100 m, 20 x median spacing) is a gap: no distance, no climb across it. SRMR: 1,184 mi / 81,094 ft. Death Ride unchanged.
- **Label font.** Kiran's Bambu preview of the test coupons showed Inter Bold far too heavy at every size. Picture of Inter 400 / 500 / 600 / 700 at 4, 5.5, 7 mm; Kiran chose a lighter weight. Default is now Inter Semibold at 5.5 mm, with Medium and Bold selectable. Print check limits changed to groove ≥ 1.5 and wall ≥ 1.75 nozzle widths (the walls between strokes were what closed up). Tips updated: elephant-foot compensation widens letters, so lower it if the text prints fat. Two label tests were adjusted: the drag-prediction tolerance is 0.2 mm (the small line now sits at a wall-driven floor), and with a 0.6 mm nozzle the exaggeration line legitimately cannot shrink below the main size (Inter's near-touching letters).
- **Color palette** (Kiran): a Colors card at the top with Terrain, Water, Lakes, Rivers, Route and Text, where Lakes / Rivers / Text can follow Water (Text also Route) or have their own color. Multi / single color radios moved here from the Printer card. Feature cards keep the on/off ("Route color (own part)", "Lake color (own part)", river style, marker color, label style) and show the resolved color; editing a swatch there writes back to the palette entry it comes from. Markers pick a palette color (Route / Terrain / Water / Text); no separate marker color. Single color: everything folds into the terrain, swatches show the terrain color.
  - Parts are now `terrain`, `text`, `route`, `lakes`, `rivers`, `markers` (the `water` part split). The 3MF gives same-colored parts one filament slot.
  - Old share links: 4-key `colors` and `markerColor: "own"` load with the new defaults (own → Route).
- **Color label**: label style "Text color" builds a `text` part that fills the pocket exactly (same vertices as the terrain's pocket). Default text color is the water color (Kiran). A single-color printer debosses instead. The merged STL export folds it (and color rivers) into the terrain, which it had not done for color rivers before.
- **Map in print colors** (Kiran, so the effect of a color change and which rivers are included show without a rebuild): lakes, river areas and narrow rivers as layers on the base map's vector source with the build's filters, the crop tinted in the terrain color, and the route and rivers drawn at their print width (a 0.4 mm river is a hairline on the map, as it will be on the print). Split view (map beside 3D) is queued as a later task; a map painted onto the 3D terrain was dropped as too much for the benefit.
- Verified: 201 unit tests, Death Ride with every colored feature (6 manifold parts) sliced by the Bambu CLI at 150 mm (its headless bed refuses 200 mm), the page in the browser: palette, feature swatches, single-color fold, share link round trip, section reset, 3D underside with the blue inlay, map with blue lakes and 0.4 mm green rivers.

## 2026-10-25 — Checks answered, test coupons

- Climb: Strava says 13,045 ft for the Death Ride, the app 12,966 (0.6% apart). The ~15,000 ft published figure was the outlier; `CLIMB_HYSTERESIS_M` stays at 2 m.
- Bambu Studio app (Kiran): the 3MF opens as "geometry only" with the parts correctly labeled as one multi-part object. Kiran: focus on Bambu; other slicers later.
- Built the test coupons offered on 2026-10-23 (`scripts/make-coupon.test.ts`, run with `scripts/coupon.config.ts`): three flat tiles with the underside label at 4, 5.5 and 7 mm and river grooves at 0.6, 0.8 and 1.2 mm.
  - First try used the full three-line label on a 3 mm base: tiles up to 146 mm long. Cut to two short lines on a 2 mm base (51 to 82 mm).
  - Rated Tight / Good / Good at 0.4 mm, so the print shows whether the limits match reality. Bambu CLI slices it. Kiran will print it.
  - Kiran asked if layer height matters: the script hadn't rounded depths to whole layers as the app does (0.6 mm is 3.75 layers at 0.16). Fixed; `LAYER=` picks the layer height, and files for 0.16 and 0.2 were built.

## 2026-10-23 — UI feedback layer on the dev server

- Kiran wanted to give live feedback on elements and copy in the browser pane. Built a reusable tool, `~/.claude/skills/ui-feedback/` (a page overlay plus a dev-only Vite plugin), with GPX3DP as the first user.
- `vite.config.ts` loads the plugin from the home folder when it exists; it is dev-only (`apply: 'serve'`) and skipped where it isn't installed (CI, other machines). The live site is unchanged.

## 2026-10-23 — Live print rating while scaling the label

- Kiran asked how dragging below the minimum size is handled. Before this: only a 2 to 40 mm clamp on release, and the print check said Too fine after the rebuild.
- Chosen: a live warning, not a hard stop. While scaling, the box turns green, amber or red and shows the size it would set. Small text is still allowed on purpose.
- `labelWidthsAt` predicts the widths at a new size from the last build.
  - First version: the readout said "tight" at 3 mm while the card said "Too fine". The exaggeration line has thinner walls than the title, and the readout only looked at the title.
  - Second version: the per-line minimum ran thinner than the card. The card's check is a percentile over the whole label, so a small line counts less. Fixed by calibrating to the measured widths at the built size.
  - Tests: predicted vs. rebuilt widths at 3, 4.5, 9 and 5 mm from 6 and 10 mm builds, all within 0.1 mm.
- Checked in the browser before the calibration (colors and tag switch while dragging). After it, the pane stopped painting frames, so only the unit tests cover the final numbers.

## 2026-10-23 — Smaller exaggeration line, print settings in file names, label drag hint

- Kiran, after trying the live site:
  - Exaggeration line: now prints smaller than the main text (0.65x), but never below the size that rates Good for the nozzle. Its size comes from measuring that line at full size.
    - At the default 6 mm Inter with a 0.4 mm nozzle it only drops to 5.7 mm, and a note says so.
    - Lines of different sizes are spaced by both sizes.
  - Export file names end with the nozzle and layer height the model was built for, e.g. `_0p4N_0p16L`.
  - Drag box: it works, in the 3D preview's Underside view after a build. Kiran was most likely in Top view. Added a **Drag it in 3D** button and a hint line to the Label card.
- Tests: small line size and printable floor at 0.4 and 0.6 mm nozzles, index mapping when empty lines are dropped, every font manifold with a small line, `printSuffix`. Checked in the browser on the Death Ride: overlay, button and the three file names.
- A cloud session was requested for this work, then withdrawn (the laptop stayed open).

## 2026-10-23 — Pages workflow actions on Node 24

- GitHub warned that the deploy's actions target Node 20 (deprecated). Bumped to releases that run on Node 24: checkout v7, setup-node v7, upload-pages-artifact v5 (uses upload-artifact v7), deploy-pages v5.

## 2026-10-23 — Rivers separate from lakes, suggested exaggeration

- Kiran: "do 1, 2, 4, hold on 3". Tiled printing is on hold.
- Rivers (from 2026-10-22: toggle rivers and lakes separately, allow a grooved river):
  - Decided in planning (approved by Kiran):
    - wide rivers mapped as areas count as rivers;
    - river styles are Off / Groove (default) / Water color;
    - narrow river lines stay opt-in.
  - The water mask now has lake and river codes. Only lakes are flattened; rivers follow the terrain downhill.
  - Groove depth is a setting (0.6 mm, rounded to layers). Water color falls back to Groove on single-color printers.
  - Bug while building: the new level code broke every mesh until `NUM_CODES` in `mesh.ts` went from 6 to 7.
  - Side effect caught by the label test: the groove raised the color layer to 0.8 mm on every model. Now it does so only when grooved rivers exist.
  - Tests: 36 river combinations, groove depth and downhill, lakes still flat. Death Ride with live tiles: both styles manifold, also in PrusaSlicer.
- Suggested exaggeration (from 2026-10-22):
  - A hint with a **Use** button under Terrain > Advanced, using the rule agreed in planning. It is never applied by itself.
  - Links to ETH, Wikipedia and Räber.
  - The 3MF description states the factor when it isn't 1x.
  - Death Ride 1.5x, SRMR 6x.

## 2026-10-23 — No automatic jump to the 3D preview

- Kiran (from 2026-10-22): the view should be the user's choice. Builds no longer switch to the 3D preview. A dot on the tab shows that a new model is ready while the map is showing.
- Kiran: next, lakes vs rivers with grooved rivers, and the suggested exaggeration. Tiled printing is on hold.

## 2026-10-23 — Label fonts and print check

- Kiran: offer font selection and sizing tips for good deboss prints.
- Six bold fonts, each loaded only when picked: Inter, Atkinson Hyperlegible, Nunito ExtraBold, Barlow Condensed, Roboto Slab, JetBrains Mono. The card preview shows the chosen font.
- Print check replaces the "letters under 10x the nozzle" warning. Letter height was the wrong measure: what matters is the width of the strokes (grooves that first-layer squish closes) and of the plastic between them.
  - Measured from the traced bitmap: Good, Tight or Too fine, which limit applies, and the size that reaches Good.
  - First version counted ridge pixels; sharp notches (where a bowl meets a stem) gave false 0.05 mm walls. Switched to area-weighted local thickness.
- Collapsed tips list: elephant foot compensation, smooth plate, depth, font choice, paint fill.

## 2026-10-23 — Underside label: drag, scale, edge offsets

- Kiran: drag and scale a bounding box of the text, center it if wanted, or set it as an offset from chosen edges, handled per axis.
- Position changed from X/Y % sliders to an edge plus a gap in mm per axis (from left / centered / from right, from bottom / centered / from top). Old `labelX` / `labelY` in shared URLs are ignored.
- Align gains **Auto** (the new default), which follows the Across edge.
- Center button. In the Underside view a dashed box can be dragged and scaled; on release each axis snaps to centered (within 3 mm) or the nearer edge.
- Bug found while testing in the browser: a 5 mm centered Death Ride label left 3 open edges. Earcut had run a hole bridge exactly through a ring vertex (a T-junction), which `fixSlivers` doesn't see.
  - Fix: `fixTJunctions` splits any edge used once that isn't on the face boundary.
  - Regression test added; it fails without the fix.
  - A sweep of 12 sizes x 4 placements on the real print size is all manifold.

## 2026-10-22 — Underside label and climbing

- Kiran: a debossed label on the underside, with typed text and optional ride stats (all files combined) and vertical exaggeration lines. Size, position and alignment adjustable, and shown in the preview.
- Built with opentype.js (Inter Bold) and earcut. Text is rasterized and traced into clean rings, and the flat bottom gets a pocket. Mirrored so it reads from below. Depth is capped under the color layers.
- GPX `<ele>` is now read, for climbing (2 m hysteresis). Death Ride: 12,966 ft, against a published ~15,000 ft; Kiran to compare with Strava.
- 3D preview gets a Top / Underside toggle.
- Fixed while building:
  - earcut zero-area slivers (`fixSlivers`);
  - float noise on the real-size model, fixed by triangulating in exact grid units (18 flipped edges, build 13 s down to 4.6 s);
  - emoji rendered as empty boxes, now left out with a note;
  - text invisible in the preview, fixed with a tilted camera, a light from below and darker pocket shading.
- Exaggeration references settled: link ETH Zurich and Wikipedia, plus Räber (ICA) as the counterpoint; not Esri. The term is "Vertical exaggeration".

## 2026-10-22 — Live on Pages, parallel water line angle

- Pushed and enabled GitHub Pages (built by Actions). Live at https://gradientprojects.github.io/GPX3DP/.
- Kiran: choose the angle of the parallel water lines. New `waterLineAngleDeg` (default 0 = east-west, as before), shown only for Parallel lines. Mesh tests at 30, 45, 90 and 135 degrees.
- Kiran asked for, to plan next: no automatic jump to the 3D preview; lakes and rivers styled separately, with a grooved river option; tiled printing.

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
