# GPX3DP

Free public web tool (GitHub Pages) that turns GPX rides into 3D-printable terrain with the route raised or flush in its own color. Everything runs in the browser.

## Docs

- `_DOCS/SPEC.md`: living design document, the single source of truth for the current state. Update it as decisions change; erase outdated info.
- `_DOCS/CHANGELOG.md`: append-only log of decisions and changes. Never edit or remove old entries.
- Keep both current during every session, and update them before context compaction.

## Conventions

- Stack: Vite + TypeScript (no UI framework), three.js, MapLibre GL, fflate, Vitest.
- `src/core/` is pure (no DOM), so it runs in the worker and in tests. Heavy work runs in `src/worker/`.
- Feature sizes (route width/height, marker size, texture depth) are absolute mm, never scaled with the print.
- Every mesh part must pass `validateMesh` (closed 2-manifold, consistent outward winding, no degenerate triangles).
- Repo is public (`gradientprojects/GPX3DP`) so Pages works on the Free plan. Never commit GPX files; `test-data/` is git-ignored.

## Commands

- `npm run dev`: local dev server
- `npm test`: unit tests (Vitest)
- `npm run build`: type-check + production build into `dist/`
- Deploy: push to `main`; `.github/workflows/pages.yml` builds and publishes.
