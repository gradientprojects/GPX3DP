/** Steps the suggestion rounds down to (the slider goes to 10). */
const STEPS = [1, 1.5, 2, 3, 4, 5, 6, 8, 10];
/** relief cap for the suggestion, mm: mountainous areas need less exaggeration than flat ones */
export const SUGGEST_MAX_RELIEF_MM = 15;

/**
 * Suggested vertical exaggeration for a print at scale 1:`scale`, given its relief at true scale (mm).
 * max(1, (scale / 50,000)^0.6) fits the references: ETH Zurich terrain models (none at large scales, 2:1 to
 * 10:1 below 1:50,000, Europe at 1:5M 12.5:1 to 25:1) and Hubbard's 1:250,000 Knoxville sheet at 3:1.
 * Then capped so the relief stays under SUGGEST_MAX_RELIEF_MM, and rounded down to a step.
 */
export function suggestExaggeration(scale: number, relief1xMm: number): number {
  let x = Math.max(1, (scale / 50_000) ** 0.6);
  if (relief1xMm > 0) x = Math.min(x, SUGGEST_MAX_RELIEF_MM / relief1xMm);
  let pick = 1;
  for (const s of STEPS) if (s <= x + 1e-9) pick = s;
  return pick;
}
