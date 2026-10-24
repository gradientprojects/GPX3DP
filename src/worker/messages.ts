import type { CropSuggestion } from '../core/crop';
import type { LabelGeom, LabelSpec } from '../core/label';
import type { MeshReport } from '../core/validate';
import type { MarkerPin, ModelSettings, PartName } from '../core/model';
import type { Bounds, Edge } from '../core/project';
import type { Waypoint } from '../core/gpx';

export interface BuildRequest {
  type: 'build';
  id: number;
  bounds: Bounds;
  edge: Edge;
  edgeMm: number;
  cellMm: number;
  rivers: boolean;
  riverWidthMm: number;
  model: ModelSettings;
  /** route polylines in print mm (x,y interleaved) */
  routeLines: Float64Array[];
  markers: MarkerPin[];
  /** text debossed into the underside, or null */
  label: LabelSpec | null;
  /** label font id (src/fonts.ts), default inter */
  labelFont?: string;
}

export interface ExportRequest {
  type: 'export';
  id: number;
  format: '3mf' | 'stl-parts' | 'stl-merged';
  slicer: 'bambu' | 'prusa';
  plate: [number, number];
  title: string;
  description: string;
  /** file name ending, e.g. "_0p4N_0p16L" */
  suffix: string;
  colors: Partial<Record<PartName, string>>;
}

export interface ParseRequest {
  type: 'parse';
  id: number;
  files: { name: string; text: string }[];
  spikeKm: number;
}

export type ToWorker = BuildRequest | ExportRequest | ParseRequest;

export interface ParsedLeg {
  file: string;
  name: string;
  lat: Float64Array;
  lon: Float64Array;
  waypoints: Waypoint[];
  spikesRemoved: number;
  /** climbing from the file's elevations, m; null without elevations */
  climbM: number | null;
}

export interface PartMesh {
  name: PartName;
  positions: Float32Array;
  indices: Uint32Array;
  report: MeshReport;
}

export type FromWorker =
  | { type: 'progress'; id: number; stage: string; done?: number; total?: number }
  | { type: 'parsed'; id: number; legs: ParsedLeg[]; errors: string[] }
  | {
      type: 'built';
      id: number;
      parts: PartMesh[];
      widthMm: number;
      heightMm: number;
      reliefMm: number;
      maxHeightMm: number;
      elevMin: number;
      elevMax: number;
      zoom: number;
      tiles: number;
      /** tighter crop (print mm in this build's frame) with more relief, when this one is flat */
      crop: CropSuggestion | null;
      warnings: string[];
      /** underside label as built: depth (0 = none) and whether it was shrunk to fit */
      label: { depthMm: number; shrunk: boolean; dropped: string[]; box: [number, number, number, number] | null; strokeMm: number; wallMm: number | null; lineMm: number[]; scaling: LabelGeom['scaling'] | null };
      ms: number;
    }
  | { type: 'exported'; id: number; files: { name: string; data: Uint8Array }[] }
  /** network: tiles couldn't be downloaded (offer a retry) */
  | { type: 'error'; id: number; message: string; network?: boolean };
