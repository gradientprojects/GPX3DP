export interface PrinterPreset {
  id: string;
  name: string;
  /** usable plate, mm */
  x: number;
  y: number;
}

export const PRINTERS: PrinterPreset[] = [
  { id: 'a1mini', name: 'Bambu Lab A1 mini', x: 180, y: 180 },
  { id: 'a1', name: 'Bambu Lab A1', x: 256, y: 256 },
  { id: 'x1', name: 'Bambu Lab P1S / P1P / X1C / P2S', x: 256, y: 256 },
  { id: 'h2d', name: 'Bambu Lab H2D (both nozzles)', x: 325, y: 320 },
  { id: 'mk4', name: 'Prusa MK4 / MK4S', x: 250, y: 210 },
  { id: 'core1', name: 'Prusa Core One', x: 250, y: 220 },
  { id: 'mini', name: 'Prusa MINI+', x: 180, y: 180 },
  { id: 'xl', name: 'Prusa XL', x: 360, y: 360 },
  { id: 'ender3', name: 'Creality Ender-3 V3 / K1 / K1C', x: 220, y: 220 },
  { id: 'k1max', name: 'Creality K1 Max', x: 300, y: 300 },
  { id: 'voron350', name: 'Voron 2.4 (350)', x: 350, y: 350 },
  { id: 'custom', name: 'Custom', x: 200, y: 200 },
];

/** Space kept free around the print on the plate. */
export const PLATE_MARGIN_MM = 5;

/**
 * Largest print (aspect = width / height) that fits the plate in either orientation.
 * Returns the width and height in mm.
 */
export function fitToPlate(aspect: number, plateX: number, plateY: number): { w: number; h: number } {
  const px = Math.max(10, plateX - 2 * PLATE_MARGIN_MM);
  const py = Math.max(10, plateY - 2 * PLATE_MARGIN_MM);
  const a = Math.min(px, py * aspect); // as placed
  const b = Math.min(py, px * aspect); // rotated 90 degrees
  const w = Math.max(a, b);
  return { w, h: w / aspect };
}
