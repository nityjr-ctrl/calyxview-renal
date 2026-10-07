// Messages between the viewer and the builder's Web Worker.

import type { BuildOutput, Stage, StructureMesh } from './build.ts';
import type { Planning } from './nephrometry.ts';

export type ToWorker =
  | { type: 'sample'; id: number; marginMm: number }
  | { type: 'file'; id: number; buffer: ArrayBuffer; marginMm: number }
  | { type: 'margin'; id: number; marginMm: number };

export type FromWorker =
  | { type: 'progress'; id: number; stage: Stage; message: string; fraction: number }
  | { type: 'result'; id: number; output: BuildOutput }
  | { type: 'margin'; id: number; planning: Planning; band: StructureMesh | null }
  | { type: 'error'; id: number; message: string };

export function meshBuffers(meshes: StructureMesh[]): ArrayBuffer[] {
  const buffers: ArrayBuffer[] = [];
  for (const mesh of meshes) {
    for (const array of [mesh.positions, mesh.normals, mesh.indices]) {
      if (array.buffer instanceof ArrayBuffer && !buffers.includes(array.buffer)) buffers.push(array.buffer);
    }
  }
  return buffers;
}
