'use client';

// The CT panel for Kidneys A to E: cropped, windowed axial slices of the
// KiTS23 CT round the tumour-bearing kidney, with the KiTS expert outlines
// drawn over them. scripts/make-ct-slices.py makes the images and slices.json.
// Only these crops are published, not the CT volumes or the label maps.

import { Crosshair, PenLine } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

type Polyline = number[];

export type CtSlice = {
  /** Height of the slab's centre in the 3D model's frame, mm. */
  z: number;
  kidney?: Polyline[];
  tumour?: Polyline[];
  cyst?: Polyline[];
  collecting?: Polyline[];
};

export type CtSliceSet = {
  version: number;
  width: number;
  height: number;
  pixelMm: number;
  sliceMm: number;
  window: { level: number; width: number };
  /** Model-frame x of image column 0 (the patient's right); x falls to the right. */
  xLeftMm: number;
  /** Model-frame y of image row 0 (anterior); y falls downwards. */
  yTopMm: number;
  tumourSlice: number;
  slices: CtSlice[];
};

/** Where the axial plane sits in the 3D model, in the model's millimetres. */
export type SlicePlane = { xMin: number; xMax: number; yMin: number; yMax: number; z: number };

type LoadState = { caseId: string; status: 'ready'; data: CtSliceSet } | { caseId: string; status: 'failed' };

const OUTLINE_COLOURS = {
  kidney: '#c4aa8c',
  tumour: '#d85c60',
  cyst: '#8fb8d8',
  collecting: '#5ad2e2',
} as const;

// One request per kidney for the whole visit.
const requests = new Map<string, Promise<CtSliceSet>>();

function ctFolder(caseId: string) {
  if (caseId === 'urogram') return '/urogram/ct/';
  return `/ct/${caseId}/`;
}

export function sliceUrl(caseId: string, index: number) {
  return `${ctFolder(caseId)}${String(index).padStart(3, '0')}.webp`;
}

export function keyImageUrl(caseId: string) {
  return `${ctFolder(caseId)}key.webp`;
}

function loadSlices(caseId: string): Promise<CtSliceSet> {
  let request = requests.get(caseId);
  if (!request) {
    request = fetch(`${ctFolder(caseId)}slices.json`).then((response) => {
      if (!response.ok) throw new Error(`CT slices: ${response.status}`);
      return response.json() as Promise<CtSliceSet>;
    });
    // Let a failed request be tried again next time.
    request.catch(() => requests.delete(caseId));
    requests.set(caseId, request);
  }
  return request;
}

/** The slice set for a kidney, fetched once and only when wanted. */
export function useCtSlices(caseId: string | null, wanted: boolean) {
  const [state, setState] = useState<LoadState | null>(null);

  useEffect(() => {
    if (!caseId || !wanted) return undefined;
    let live = true;
    loadSlices(caseId).then(
      (data) => {
        if (live) setState({ caseId, status: 'ready', data });
      },
      () => {
        if (live) setState({ caseId, status: 'failed' });
      },
    );
    return () => {
      live = false;
    };
  }, [caseId, wanted]);

  if (!caseId || !wanted) return { status: 'idle' as const, data: null };
  if (!state || state.caseId !== caseId) return { status: 'loading' as const, data: null };
  return state.status === 'ready' ? { status: 'ready' as const, data: state.data } : { status: 'failed' as const, data: null };
}

export function slicePlaneFor(data: CtSliceSet, index: number): SlicePlane {
  const slice = data.slices[Math.min(Math.max(index, 0), data.slices.length - 1)];
  return {
    xMin: data.xLeftMm - data.width * data.pixelMm,
    xMax: data.xLeftMm,
    yMin: data.yTopMm - data.height * data.pixelMm,
    yMax: data.yTopMm,
    z: slice.z,
  };
}

function points(line: Polyline) {
  let out = '';
  for (let i = 0; i + 1 < line.length; i += 2) out += `${line[i]},${line[i + 1]} `;
  return out;
}

function mm(value: number) {
  return value.toLocaleString('en-GB', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

export function CtPanel({
  caseId,
  label,
  status,
  data,
  index,
  setIndex,
  outlines,
  setOutlines,
  sourceLabel = 'KiTS23 CT, axial',
  focusLabel = 'Go to the tumour',
}: {
  caseId: string;
  label: string;
  status: 'idle' | 'loading' | 'ready' | 'failed';
  data: CtSliceSet | null;
  index: number;
  setIndex: (value: number) => void;
  outlines: boolean;
  setOutlines: (value: boolean) => void;
  sourceLabel?: string;
  focusLabel?: string;
}) {
  const stageRef = useRef<HTMLDivElement>(null);
  const count = data?.slices.length ?? 0;
  const current = count ? Math.min(Math.max(index, 0), count - 1) : 0;

  // The wheel scrubs while the pointer is over the image. React's onWheel is
  // passive, so this listener is added by hand to stop the panel scrolling too.
  const wheelState = useRef({ current, count, setIndex, carry: 0 });
  useEffect(() => {
    wheelState.current = { ...wheelState.current, current, count, setIndex };
  }, [current, count, setIndex]);
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return undefined;
    const onWheel = (event: WheelEvent) => {
      const live = wheelState.current;
      if (!live.count) return;
      event.preventDefault();
      // Trackpads send many small deltas; step once per ~60 px of travel.
      live.carry += event.deltaMode === 0 ? event.deltaY : event.deltaY * 40;
      const steps = Math.trunc(live.carry / 60) || (Math.abs(event.deltaY) >= 60 ? Math.sign(event.deltaY) : 0);
      if (!steps) return;
      live.carry = 0;
      // Wheel up moves up the body (towards the head).
      const next = Math.min(Math.max(live.current - steps, 0), live.count - 1);
      if (next !== live.current) live.setIndex(next);
    };
    stage.addEventListener('wheel', onWheel, { passive: false });
    return () => stage.removeEventListener('wheel', onWheel);
  }, [status]);

  // Keep the neighbours warm so scrubbing doesn't flicker. The rest load when shown.
  useEffect(() => {
    if (!count) return;
    for (const near of [current - 1, current + 1, current - 2, current + 2]) {
      if (near < 0 || near >= count) continue;
      const image = new Image();
      image.decoding = 'async';
      image.src = sliceUrl(caseId, near);
    }
  }, [caseId, current, count]);

  if (status === 'failed') {
    return (
      <p className="mt-3 text-xs leading-5 text-white/75">
        The CT slices could not load. Reload the page to try again.
      </p>
    );
  }

  const slice = data?.slices[current];
  const hasCyst = Boolean(slice?.cyst?.length);
  const outlined = ['kidney', slice?.tumour?.length ? 'tumour' : null, hasCyst ? 'cyst' : null, slice?.collecting?.length ? 'collecting system' : null].filter(Boolean);
  const outlineWords = outlined.length > 1 ? `${outlined.slice(0, -1).join(', ')} and ${outlined.at(-1)}` : 'kidney';
  const alt = data
    ? `CT slice ${current + 1} of ${count} through ${label}${outlines ? `, ${outlineWords} outlined` : ''}`
    : '';

  return (
    <div className="ct-panel">
      <div className="flex items-center justify-between gap-2">
        <p className="section-label">{sourceLabel}</p>
        <button
          type="button"
          className="ct-chip"
          aria-pressed={outlines}
          onClick={() => setOutlines(!outlines)}
          title="Show or hide the source outlines"
        >
          <PenLine className="size-3" aria-hidden="true" />
          Outlines
        </button>
      </div>

      {/* The wheel scrubs over the image; the slider below takes the keyboard. */}
      <div
        ref={stageRef}
        className="ct-stage"
        style={data ? { aspectRatio: `${data.width} / ${data.height}` } : undefined}
      >
        {data && slice ? (
          <>
            {/* oxlint-disable-next-line next/no-img-element -- Vite serves these local slices directly. */}
            <img src={sliceUrl(caseId, current)} alt={alt} width={data.width} height={data.height} draggable={false} />
            {outlines ? (
              <svg viewBox={`0 0 ${data.width} ${data.height}`} aria-hidden="true" preserveAspectRatio="none">
                {(['kidney', 'cyst', 'tumour', 'collecting'] as const).map((name) =>
                  (slice[name] ?? []).map((line, n) => (
                    <polygon
                      // Outlines never reorder within a slice, so the index is a stable key.
                      key={`${name}-${n}`}
                      points={points(line)}
                      fill="none"
                      stroke={OUTLINE_COLOURS[name]}
                      strokeOpacity={name === 'kidney' ? 0.8 : 1}
                      strokeWidth={name === 'tumour' ? 1.6 : 1.3}
                      strokeLinejoin="round"
                      vectorEffect="non-scaling-stroke"
                    />
                  )),
                )}
              </svg>
            ) : null}
            <span className="ct-orient ct-orient-top" aria-hidden="true">A</span>
            <span className="ct-orient ct-orient-left" aria-hidden="true">R</span>
            <span className="ct-orient ct-orient-right" aria-hidden="true">L</span>
          </>
        ) : (
          <span className="ct-loading">Loading the CT…</span>
        )}
      </div>

      {/* Arrow keys move one slab (up is towards the head); Page Up and Page Down move five. */}
      <input
        className="range-control mt-2 w-full"
        type="range"
        min="0"
        max={Math.max(0, count - 1)}
        value={current}
        disabled={!count}
        onChange={(event) => setIndex(Number(event.target.value))}
        onKeyDown={(event) => {
          if (!count || (event.key !== 'PageUp' && event.key !== 'PageDown')) return;
          event.preventDefault();
          setIndex(Math.min(Math.max(current + (event.key === 'PageUp' ? 5 : -5), 0), count - 1));
        }}
        aria-label={`CT slice through ${label}`}
        aria-valuetext={count ? `Slice ${current + 1} of ${count}` : 'Loading'}
      />

      <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
        <output className="font-mono text-[11px] text-white/78" aria-live="off">
          {slice ? `Slice ${current + 1} of ${count}, z = ${mm(slice.z)} mm` : 'Loading'}
        </output>
        <button
          type="button"
          className="ct-chip"
          disabled={!data}
          onClick={() => data && setIndex(data.tumourSlice)}
        >
          <Crosshair className="size-3" aria-hidden="true" />
          {focusLabel}
        </button>
      </div>

      {data ? (
        <>
          <ul className="ct-legend" aria-label="Outline colours">
            <li><span style={{ background: OUTLINE_COLOURS.kidney }} />Kidney</li>
            {data.slices.some((s) => s.tumour?.length) ? <li><span style={{ background: OUTLINE_COLOURS.tumour }} />Tumour</li> : null}
            {data.slices.some((s) => s.collecting?.length) ? <li><span style={{ background: OUTLINE_COLOURS.collecting }} />Collecting system</li> : null}
            {data.slices.some((s) => s.cyst?.length) ? (
              <li><span style={{ background: OUTLINE_COLOURS.cyst }} />Cyst</li>
            ) : null}
          </ul>
          <p className="mt-2 text-[11px] leading-4 text-white/66">
            {`Window level ${data.window.level}, width ${data.window.width} HU; ${mm(data.sliceMm)} mm slice spacing, seen from the feet. The pale plane through the 3D model is this slice.`}
          </p>
        </>
      ) : null}
    </div>
  );
}
