# Changelog

Append-only. Newest first. Never edit or remove old entries.

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
