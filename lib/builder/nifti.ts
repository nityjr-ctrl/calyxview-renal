// NIfTI-1 label maps, read in memory. Handles .nii and .nii.gz (gzip through
// the browser's DecompressionStream), both byte orders, the common integer
// and float types, scaling, and the sform, then qform, then pixdim rule for
// the voxel-to-RAS-millimetre affine. Nothing here touches the network.

import type { Affine, Dims } from './volume.ts';

export type NiftiVolume = {
  dims: Dims;
  /** Voxel values as numbers, after scl_slope and scl_inter. */
  data: Float64Array | Int32Array | Uint8Array | Int16Array | Uint16Array | Int8Array | Float32Array | Uint32Array;
  affine: Affine;
  /** Where the affine came from. */
  affineSource: 'sform' | 'qform' | 'pixdim';
  datatype: number;
  scale: { slope: number; intercept: number };
};

export class NiftiError extends Error {}

const GZIP = [0x1f, 0x8b];

export function isGzip(bytes: Uint8Array): boolean {
  return bytes.length > 2 && bytes[0] === GZIP[0] && bytes[1] === GZIP[1];
}

export function canGunzip(): boolean {
  return typeof DecompressionStream === 'function';
}

export async function gunzip(buffer: ArrayBuffer): Promise<ArrayBuffer> {
  if (!canGunzip()) {
    throw new NiftiError(
      'This browser can’t unzip .nii.gz files. Unzip it to .nii first (7-Zip, or gunzip on a Mac or Linux), or use a recent Chrome, Edge, Firefox or Safari.',
    );
  }
  const stream = new Blob([buffer]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Response(stream).arrayBuffer();
}

/** Unzip if needed, then parse. */
export async function readNifti(buffer: ArrayBuffer): Promise<NiftiVolume> {
  const bytes = new Uint8Array(buffer, 0, Math.min(4, buffer.byteLength));
  const raw = isGzip(bytes) ? await gunzip(buffer) : buffer;
  return parseNifti(raw);
}

const TYPES: Record<number, { name: string; bytes: number }> = {
  2: { name: 'uint8', bytes: 1 },
  4: { name: 'int16', bytes: 2 },
  8: { name: 'int32', bytes: 4 },
  16: { name: 'float32', bytes: 4 },
  64: { name: 'float64', bytes: 8 },
  256: { name: 'int8', bytes: 1 },
  512: { name: 'uint16', bytes: 2 },
  768: { name: 'uint32', bytes: 4 },
};

export function parseNifti(buffer: ArrayBuffer): NiftiVolume {
  if (buffer.byteLength < 352) throw new NiftiError('The file is too small to be a NIfTI image.');
  const view = new DataView(buffer);
  let little = true;
  const size = view.getInt32(0, true);
  if (size !== 348) {
    if (view.getInt32(0, false) === 348) little = false;
    else if (size === 540 || view.getInt32(0, false) === 540) {
      throw new NiftiError('This is a NIfTI-2 file. Save it as NIfTI-1 (.nii or .nii.gz) and try again.');
    } else {
      throw new NiftiError('This doesn’t look like a NIfTI file. The builder reads .nii and .nii.gz label maps.');
    }
  }
  const magic = String.fromCharCode(view.getUint8(344), view.getUint8(345), view.getUint8(346));
  if (magic === 'ni1') {
    throw new NiftiError('This is the two-file NIfTI form (.hdr and .img). Save it as a single .nii or .nii.gz.');
  }
  if (magic !== 'n+1') throw new NiftiError('The NIfTI header is damaged (no n+1 magic).');

  const i16 = (offset: number) => view.getInt16(offset, little);
  const f32 = (offset: number) => view.getFloat32(offset, little);
  const rank = i16(40);
  if (rank < 3 || rank > 7) throw new NiftiError(`Expected a 3D image, but the header says ${rank} dimensions.`);
  const dims: Dims = [i16(42), i16(44), i16(46)];
  for (let d = 4; d <= rank; d += 1) {
    if (i16(40 + 2 * d) > 1) throw new NiftiError('This image has more than one volume. The builder needs a single 3D label map.');
  }
  if (dims.some((value) => value < 1)) throw new NiftiError('The image size in the header is invalid.');
  const datatype = i16(70);
  const type = TYPES[datatype];
  if (!type) throw new NiftiError(`Voxel type ${datatype} isn’t supported. Use 8, 16 or 32-bit integers, or float32.`);
  const pixdim = [f32(76), f32(80), f32(84), f32(88)];
  // vox_offset feeds a slice length, so a NaN, infinite or negative value is a
  // damaged header, not "start at 352".
  const voxOffset = f32(108);
  if (!Number.isFinite(voxOffset) || voxOffset < 0 || voxOffset > buffer.byteLength) {
    throw new NiftiError('The NIfTI header is damaged (its voxel offset is invalid).');
  }
  const offset = Math.max(352, Math.round(voxOffset));
  const count = dims[0] * dims[1] * dims[2];
  if (!Number.isSafeInteger(count * type.bytes)) throw new NiftiError('The image size in the header is invalid.');
  if (offset + count * type.bytes > buffer.byteLength) {
    throw new NiftiError('The file ends before all the voxels. It may be truncated.');
  }

  const data = readVoxels(buffer, offset, count, datatype, little);
  let slope = f32(112);
  let intercept = f32(116);
  if (!Number.isFinite(slope) || slope === 0) {
    slope = 1;
    intercept = 0;
  }
  if (!Number.isFinite(intercept)) intercept = 0;
  let scaled: NiftiVolume['data'] = data;
  if (slope !== 1 || intercept !== 0) {
    const out = new Float64Array(count);
    for (let i = 0; i < count; i += 1) out[i] = data[i] * slope + intercept;
    scaled = out;
  }

  const sformCode = i16(254);
  const qformCode = i16(252);
  let affine: Affine;
  let affineSource: NiftiVolume['affineSource'];
  if (sformCode > 0) {
    affine = [];
    for (let r = 0; r < 3; r += 1) for (let c = 0; c < 4; c += 1) affine.push(f32(280 + 16 * r + 4 * c));
    affine.push(0, 0, 0, 1);
    affineSource = 'sform';
  } else if (qformCode > 0) {
    affine = qformAffine(
      [f32(256), f32(260), f32(264)],
      [f32(268), f32(272), f32(276)],
      pixdim,
    );
    affineSource = 'qform';
  } else {
    affine = [
      Math.abs(pixdim[1]) || 1, 0, 0, 0,
      0, Math.abs(pixdim[2]) || 1, 0, 0,
      0, 0, Math.abs(pixdim[3]) || 1, 0,
      0, 0, 0, 1,
    ];
    affineSource = 'pixdim';
  }
  if (affine.some((value) => !Number.isFinite(value))) throw new NiftiError('The header’s orientation is invalid.');
  if (!affineUsable(affine)) throw new NiftiError(INVALID_AFFINE);
  return { dims, data: scaled, affine, affineSource, datatype, scale: { slope, intercept } };
}

export const INVALID_AFFINE = 'This file’s orientation matrix is invalid (zero spacing).';

/**
 * Every voxel axis needs a length, and the three axes must span 3D space:
 * a zero column or a zero determinant would give zero or infinite spacing.
 */
export function affineUsable(affine: Affine): boolean {
  const column = (c: number) => Math.hypot(affine[c], affine[4 + c], affine[8 + c]);
  const lengths = [column(0), column(1), column(2)];
  if (lengths.some((length) => !(length > 1e-6))) return false;
  const det =
    affine[0] * (affine[5] * affine[10] - affine[6] * affine[9]) -
    affine[1] * (affine[4] * affine[10] - affine[6] * affine[8]) +
    affine[2] * (affine[4] * affine[9] - affine[5] * affine[8]);
  return Math.abs(det) > 1e-6 * lengths[0] * lengths[1] * lengths[2];
}

function readVoxels(buffer: ArrayBuffer, offset: number, count: number, datatype: number, little: boolean): NiftiVolume['data'] {
  const nativeLittle = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1;
  const bytes = TYPES[datatype].bytes;
  // Copy so the typed array is aligned and owns its memory.
  const slice = buffer.slice(offset, offset + count * bytes);
  if (bytes > 1 && little !== nativeLittle) {
    const raw = new Uint8Array(slice);
    for (let i = 0; i < raw.length; i += bytes) raw.subarray(i, i + bytes).reverse();
  }
  switch (datatype) {
    case 2:
      return new Uint8Array(slice);
    case 4:
      return new Int16Array(slice);
    case 8:
      return new Int32Array(slice);
    case 16:
      return new Float32Array(slice);
    case 64:
      return new Float64Array(slice);
    case 256:
      return new Int8Array(slice);
    case 512:
      return new Uint16Array(slice);
    default:
      return new Uint32Array(slice);
  }
}

/** The NIfTI-1 quaternion rule (method 2). */
export function qformAffine(quatern: number[], offset: number[], pixdim: number[]): Affine {
  const [b, c, d] = quatern;
  const a = Math.sqrt(Math.max(0, 1 - (b * b + c * c + d * d)));
  const qfac = pixdim[0] < 0 ? -1 : 1;
  const sx = Math.abs(pixdim[1]) || 1;
  const sy = Math.abs(pixdim[2]) || 1;
  const sz = (Math.abs(pixdim[3]) || 1) * qfac;
  const r11 = a * a + b * b - c * c - d * d;
  const r12 = 2 * (b * c - a * d);
  const r13 = 2 * (b * d + a * c);
  const r21 = 2 * (b * c + a * d);
  const r22 = a * a + c * c - b * b - d * d;
  const r23 = 2 * (c * d - a * b);
  const r31 = 2 * (b * d - a * c);
  const r32 = 2 * (c * d + a * b);
  const r33 = a * a + d * d - c * c - b * b;
  return [
    r11 * sx, r12 * sy, r13 * sz, offset[0],
    r21 * sx, r22 * sy, r23 * sz, offset[1],
    r31 * sx, r32 * sy, r33 * sz, offset[2],
    0, 0, 0, 1,
  ];
}

export type LabelCheck =
  | { ok: true; labels: Uint8Array; values: number[] }
  | { ok: false; reason: 'ct' | 'range' | 'empty'; message: string };

const CT_MESSAGE =
  'This looks like a CT, not an outline. The builder needs a label map, where each voxel holds a structure number (1 kidney, 2 tumour, 3 cyst). Outline the CT first with 3D Slicer or TotalSegmentator, then load the outline here.';

/**
 * Turn voxel values into a label map. A CT gives itself away with negative
 * values (air and fat in Hounsfield units), fractions, or more than 20
 * distinct values, so those are refused.
 */
export function toLabelMap(data: NiftiVolume['data']): LabelCheck {
  const seen = new Set<number>();
  for (let i = 0; i < data.length; i += 1) {
    const value = data[i];
    if (value === 0) continue;
    if (value < 0 || !Number.isInteger(value)) return { ok: false, reason: 'ct', message: CT_MESSAGE };
    if (!seen.has(value)) {
      seen.add(value);
      if (seen.size > 20) return { ok: false, reason: 'ct', message: CT_MESSAGE };
    }
  }
  if (seen.size === 0) {
    return { ok: false, reason: 'empty', message: 'Every voxel in this file is 0, so there’s nothing outlined to build.' };
  }
  const values = [...seen].sort((a, b) => a - b);
  if (values[values.length - 1] > 255) {
    return {
      ok: false,
      reason: 'range',
      message: 'Label numbers above 255 aren’t supported. Renumber the structures from 1 (1 kidney, 2 tumour, 3 cyst).',
    };
  }
  const labels = data instanceof Uint8Array ? data : Uint8Array.from(data as ArrayLike<number>);
  return { ok: true, labels, values };
}

/** A minimal NIfTI-1 writer for uint8 label maps (tests and test files). */
export function encodeNifti(labels: Uint8Array, dims: Dims, affine: Affine, pixdim: [number, number, number]): ArrayBuffer {
  const header = new ArrayBuffer(352);
  const view = new DataView(header);
  view.setInt32(0, 348, true);
  view.setInt16(40, 3, true);
  view.setInt16(42, dims[0], true);
  view.setInt16(44, dims[1], true);
  view.setInt16(46, dims[2], true);
  for (let d = 4; d <= 8; d += 1) view.setInt16(40 + 2 * d, 1, true);
  view.setInt16(70, 2, true);
  view.setInt16(72, 8, true);
  view.setFloat32(76, 1, true);
  view.setFloat32(80, pixdim[0], true);
  view.setFloat32(84, pixdim[1], true);
  view.setFloat32(88, pixdim[2], true);
  view.setFloat32(108, 352, true);
  view.setFloat32(112, 1, true);
  view.setFloat32(116, 0, true);
  view.setUint8(123, 2);
  view.setInt16(252, 0, true);
  view.setInt16(254, 2, true);
  for (let r = 0; r < 3; r += 1) for (let c = 0; c < 4; c += 1) view.setFloat32(280 + 16 * r + 4 * c, affine[r * 4 + c], true);
  view.setUint8(344, 'n'.charCodeAt(0));
  view.setUint8(345, '+'.charCodeAt(0));
  view.setUint8(346, '1'.charCodeAt(0));
  view.setUint8(347, 0);
  const out = new Uint8Array(352 + labels.length);
  out.set(new Uint8Array(header), 0);
  out.set(labels, 352);
  return out.buffer;
}
