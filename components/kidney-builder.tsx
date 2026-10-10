'use client';

// "Make a 3D kidney": the viewer's builder mode. A label map (.nii or
// .nii.gz) is read into this tab's memory and handed to a Web Worker in the
// same tab, which meshes it and scores it with renalplan's rules. Nothing is
// uploaded or stored. See lib/builder/ for the maths.

import {
  AlertTriangle,
  Check,
  Circle,
  CircleCheck,
  Download,
  FileUp,
  Info,
  LoaderCircle,
  RotateCcw,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type ChangeEvent, type KeyboardEvent } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type { SceneCase } from '@/components/reference-case-scene';
import { ApproachNotes, LayerButton, Metric } from '@/components/viewer-ui';
import type { BuildOutput, Stage, StructureMesh } from '@/lib/builder/build';
import { BROWSER_DIFFERENCES, ESTIMATE_LINE, keptPercent, reportJson, reportMarkdown } from '@/lib/builder/report';
import type { FromWorker, ToWorker } from '@/lib/builder/protocol';

const KITS23_URL = 'https://github.com/neheller/kits23';
const SLICER_URL = 'https://www.slicer.org/';
const TOTALSEG_URL = 'https://github.com/wasserth/TotalSegmentator';
/** A label map bigger than this is almost certainly not one. */
const MAX_FILE_BYTES = 1024 * 1024 * 1024;

export type BuilderStatus = 'idle' | 'running' | 'done' | 'error';

export type BuilderState = {
  status: BuilderStatus;
  stage: Stage | null;
  message: string;
  fraction: number;
  output: BuildOutput | null;
  error: string | null;
  /** Bumped for each new kidney, so per-kidney view settings can reset. */
  buildCount: number;
};

const INITIAL: BuilderState = {
  status: 'idle',
  stage: null,
  message: '',
  fraction: 0,
  output: null,
  error: null,
  buildCount: 0,
};

function replaceBand(meshes: StructureMesh[], band: StructureMesh | null): StructureMesh[] {
  const others = meshes.filter((mesh) => mesh.name !== 'margin');
  return band ? [...others, band] : others;
}

/** Owns the builder's worker. The worker starts on first use and stops with the viewer. */
export function useKidneyBuilder() {
  const [state, setState] = useState<BuilderState>(INITIAL);
  const workerRef = useRef<Worker | null>(null);
  const nextId = useRef(0);
  const buildId = useRef(-1);
  const marginId = useRef(-1);

  useEffect(
    () => () => {
      workerRef.current?.terminate();
      workerRef.current = null;
    },
    [],
  );

  const worker = useCallback(() => {
    if (workerRef.current) return workerRef.current;
    const created = new Worker(new URL('../lib/build-worker.ts', import.meta.url), { type: 'module' });
    created.onmessage = (event: MessageEvent<FromWorker>) => {
      const message = event.data;
      if (message.type === 'margin') {
        if (message.id !== marginId.current) return;
        setState((current) =>
          current.output
            ? {
                ...current,
                output: {
                  report: { ...current.output.report, planning: message.planning },
                  meshes: replaceBand(current.output.meshes, message.band),
                },
              }
            : current,
        );
        return;
      }
      if (message.type === 'error' && message.id === marginId.current) return;
      if (message.id !== buildId.current) return;
      if (message.type === 'progress') {
        setState((current) => ({ ...current, stage: message.stage, message: message.message, fraction: message.fraction }));
      } else if (message.type === 'result') {
        setState((current) => ({
          ...current,
          status: 'done',
          stage: 'done',
          message: message.output.report.scored
            ? `Done. R.E.N.A.L. ${message.output.report.renal?.label ?? ''}, PADUA ${message.output.report.padua?.total ?? ''}, built in ${(message.output.report.totalMs / 1000).toFixed(1)} s.`
            : `Done. Meshes built in ${(message.output.report.totalMs / 1000).toFixed(1)} s, but not scored.`,
          fraction: 1,
          output: message.output,
          error: null,
          buildCount: current.buildCount + 1,
        }));
      } else {
        setState((current) => ({ ...current, status: 'error', stage: null, message: '', fraction: 0, error: message.message }));
      }
    };
    created.onerror = () => {
      setState((current) => ({
        ...current,
        status: 'error',
        error: 'The builder stopped unexpectedly. The file may be too big for this device. Reload the page to try again.',
      }));
      workerRef.current?.terminate();
      workerRef.current = null;
    };
    workerRef.current = created;
    return created;
  }, []);

  const post = useCallback(
    (message: ToWorker, transfer: Transferable[] = []) => {
      worker().postMessage(message, transfer);
    },
    [worker],
  );

  const start = useCallback((message: string) => {
    nextId.current += 1;
    buildId.current = nextId.current;
    setState((current) => ({ ...current, status: 'running', stage: 'reading', message, fraction: 0.02, error: null }));
    return nextId.current;
  }, []);

  const buildSample = useCallback(
    (marginMm: number) => {
      const id = start('Making the synthetic sample');
      post({ type: 'sample', id, marginMm });
    },
    [post, start],
  );

  const buildFile = useCallback(
    async (file: File, marginMm: number) => {
      // The name is only looked at here, for its extension, and isn't kept.
      if (!/\.nii(\.gz)?$/i.test(file.name)) {
        setState((current) => ({
          ...current,
          status: 'error',
          error: 'Choose a .nii or .nii.gz label map. DICOM and other formats aren’t read here.',
        }));
        return;
      }
      if (file.size > MAX_FILE_BYTES) {
        setState((current) => ({ ...current, status: 'error', error: 'That file is over 1 GB, which is too big to be a label map.' }));
        return;
      }
      const id = start('Reading the file');
      try {
        const buffer = await file.arrayBuffer();
        if (id !== buildId.current) return;
        post({ type: 'file', id, buffer, marginMm }, [buffer]);
      } catch {
        if (id === buildId.current) {
          setState((current) => ({ ...current, status: 'error', error: 'The browser couldn’t read that file.' }));
        }
      }
    },
    [post, start],
  );

  const setMargin = useCallback(
    (marginMm: number) => {
      if (!workerRef.current) return;
      nextId.current += 1;
      marginId.current = nextId.current;
      post({ type: 'margin', id: nextId.current, marginMm });
    },
    [post],
  );

  const clear = useCallback(() => {
    buildId.current = -1;
    workerRef.current?.terminate();
    workerRef.current = null;
    setState((current) => ({ ...INITIAL, buildCount: current.buildCount + 1 }));
  }, []);

  return { state, buildSample, buildFile, setMargin, clear };
}

export type KidneyBuilder = ReturnType<typeof useKidneyBuilder>;

/** The built kidney in the shape the 3D scene takes. */
export function sceneCaseFor(output: BuildOutput, buildCount: number): SceneCase {
  const label = output.report.source === 'sample' ? 'Synthetic sample' : 'Your outline';
  return {
    id: `built-${buildCount}`,
    label,
    structures: output.meshes.map((mesh) => ({
      name: mesh.name,
      label: mesh.label,
      provenance: mesh.provenance,
      colour: mesh.colour,
      opacity: mesh.opacity,
      visible: mesh.visible,
      framing: mesh.framing,
    })),
    meshData: Object.fromEntries(
      output.meshes.map((mesh) => [mesh.name, { positions: mesh.positions, normals: mesh.normals, indices: mesh.indices }]),
    ),
    description: `${label} in 3D: the kidney and tumour built in this tab from the outline`,
  };
}

// ---------------------------------------------------------------------------
// Downloads. Names never include the loaded file's name.
// ---------------------------------------------------------------------------

function save(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function stem(output: BuildOutput) {
  return output.report.source === 'sample' ? 'calyxview-renal-sample' : 'calyxview-renal-kidney';
}

async function exportModel(output: BuildOutput, visible: Record<string, boolean>, kind: 'glb' | 'stl') {
  const { modelBlob } = await import('@/lib/export-model');
  const blob = await modelBlob(
    output.meshes.filter((mesh) => visible[mesh.name] !== false),
    kind,
  );
  save(blob, `${stem(output)}.${kind}`);
}

// ---------------------------------------------------------------------------
// Controls.
// ---------------------------------------------------------------------------

const STAGES: Array<{ stage: Stage; label: string }> = [
  { stage: 'reading', label: 'Read the file' },
  { stage: 'checking', label: 'Check it’s an outline' },
  { stage: 'labelling', label: 'Find the structures' },
  { stage: 'scoring', label: 'Estimate the sinus and score' },
  { stage: 'meshing', label: 'Build the surfaces' },
];

function ProgressSteps({ state }: { state: BuilderState }) {
  const current = STAGES.findIndex((item) => item.stage === state.stage);
  const done = state.status === 'done';
  return (
    <div className="build-progress" aria-hidden="true">
      <div className="build-progress-bar">
        <span style={{ width: `${Math.round(state.fraction * 100)}%` }} />
      </div>
      <ol className="mt-3 space-y-1.5">
        {STAGES.map((item, index) => {
          const reached = done || index < current;
          const active = !done && index === current;
          return (
            <li key={item.stage} className="flex items-center gap-2 text-xs">
              {reached ? (
                <Check className="size-3.5 text-emerald-200/85" />
              ) : active ? (
                <LoaderCircle className="size-3.5 animate-spin text-emerald-200" />
              ) : (
                <Circle className="size-3 text-white/30" />
              )}
              <span className={active ? 'text-white/90' : reached ? 'text-white/75' : 'text-white/55'}>
                {active && state.message ? state.message : item.label}
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

export function BuildControls({
  builder,
  marginMm,
  setMarginMm,
  compact = false,
}: {
  builder: KidneyBuilder;
  marginMm: number;
  setMarginMm: (value: number) => void;
  compact?: boolean;
}) {
  const { state } = builder;
  const running = state.status === 'running';

  const onFile = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    // Clear the input straight away so the browser drops its reference too.
    event.target.value = '';
    // The input is disabled during a build; this also drops any change event
    // that still reaches it then.
    if (running) return;
    if (file) void builder.buildFile(file, marginMm);
  };

  return (
    <div className={compact ? 'build-controls build-controls-compact' : 'build-controls'}>
      <label htmlFor="outline-file" className="build-file-label">
        <FileUp className="size-4" aria-hidden="true" />
        {state.output ? 'Load another outline' : 'Load a label map'}
        <span className="build-file-hint">.nii or .nii.gz, 1 kidney, 2 tumour, 3 cyst</span>
      </label>
      <input
        id="outline-file"
        className="build-file-input"
        type="file"
        accept=".nii,.gz,application/gzip"
        onChange={onFile}
        disabled={running}
      />
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button
          id="try-sample"
          className="bg-emerald-300 text-[#052117] hover:bg-emerald-200"
          onClick={() => builder.buildSample(marginMm)}
          disabled={running}
          focusableWhenDisabled
        >
          {running ? <LoaderCircle className="animate-spin" /> : null}
          Try the sample
        </Button>
        {state.output && !running ? (
          <Button
            className="border-white/10 bg-white/[.035] text-white/80 hover:bg-white/8 hover:text-white"
            variant="outline"
            onClick={builder.clear}
          >
            <RotateCcw /> Clear
          </Button>
        ) : null}
      </div>
      {compact ? null : (
        <div className="mt-4">
          <div className="flex items-center justify-between text-xs text-white/75">
            <label htmlFor="build-margin">Margin round the tumour</label>
            <span className="font-mono text-white/85">{marginMm} mm</span>
          </div>
          <input
            id="build-margin"
            className="range-control mt-1 w-full"
            type="range"
            min="1"
            max="10"
            value={marginMm}
            onChange={(event) => setMarginMm(Number(event.target.value))}
          />
        </div>
      )}
      {running || state.status === 'done' ? <ProgressSteps state={state} /> : null}
      {state.status === 'error' && state.error ? (
        <p className="mt-3 flex items-start gap-2 text-xs leading-5 text-rose-200/90" role="alert">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          {state.error}
        </p>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Before anything is built: the intro in the middle, steps on the left,
// privacy on the right.
// ---------------------------------------------------------------------------

function NewTab() {
  return <span className="sr-only"> (opens in a new tab)</span>;
}

export function BuildIntro({
  builder,
  marginMm,
  setMarginMm,
}: {
  builder: KidneyBuilder;
  marginMm: number;
  setMarginMm: (value: number) => void;
}) {
  return (
    <section className="import-workspace" aria-labelledby="build-title">
      <div className="mx-auto w-full max-w-3xl px-5 py-8 sm:px-8 sm:py-10">
        <h1 id="build-title" className="max-w-xl text-2xl font-semibold tracking-[-.03em] text-white/92 sm:text-3xl">
          Make a 3D kidney from an outline
        </h1>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-white/75">
          Takes a kidney and tumour label map. Returns the 3D model, R.E.N.A.L. and PADUA by renalplan&apos;s
          rules, and the model and a report to download. Runs in this tab; nothing is uploaded.
        </p>

        <div className="mt-6 rounded-xl border border-white/9 bg-white/[.025] p-4 sm:p-5">
          <BuildControls builder={builder} marginMm={marginMm} setMarginMm={setMarginMm} />
        </div>

        <ol className="build-steps mt-6" aria-label="The three steps">
          <li>
            <span className="build-step-number">1</span>
            <div>
              <p className="text-sm font-medium text-white/88">Outline the CT. Not done here.</p>
              <p className="mt-1 text-xs leading-5 text-white/72">
                Draw the kidney and tumour on the CT with free tools:{' '}
                <a className="viewer-link" href={SLICER_URL} target="_blank" rel="noreferrer">
                  3D Slicer
                  <NewTab />
                </a>{' '}
                by hand, or{' '}
                <a className="viewer-link" href={TOTALSEG_URL} target="_blank" rel="noreferrer">
                  TotalSegmentator
                  <NewTab />
                </a>{' '}
                for the kidneys, with the tumour usually still drawn by hand. Save it as a label map: 1 kidney,
                2 tumour, 3 cyst. Any other number is meshed as its own structure.
              </p>
            </div>
          </li>
          <li>
            <span className="build-step-number">2</span>
            <div>
              <p className="text-sm font-medium text-white/88">Build the surfaces. Done here.</p>
              <p className="mt-1 text-xs leading-5 text-white/72">
                Each structure becomes a distance field, resampled to a 1 mm grid, coarser for very large
                volumes (the report says the grid used), so thick slices don&apos;t show as steps, then
                marching cubes and light smoothing. The scores use the original voxels,
                not the surfaces. With two kidneys in the file, the one nearest the tumour is scored and
                the other is shown faintly.
              </p>
            </div>
          </li>
          <li>
            <span className="build-step-number">3</span>
            <div>
              <p className="text-sm font-medium text-white/88">Score it. Done here.</p>
              <p className="mt-1 text-xs leading-5 text-white/72">
                R.E.N.A.L., PADUA and the share of kidney kept outside a margin you choose, each with the rule
                beside it. The sinus is estimated from the outline, so N, L and the PADUA pole are approximate.
              </p>
            </div>
          </li>
        </ol>

        <p className="mt-6 text-xs leading-5 text-white/72">
          For a real outline to try, the{' '}
          <a className="viewer-link" href={KITS23_URL} target="_blank" rel="noreferrer">
            KiTS23 dataset on GitHub
            <NewTab />
          </a>{' '}
          has expert kidney and tumour label maps from de-identified CTs (CC BY-NC-SA 4.0). Each case folder has a{' '}
          <code className="font-mono text-white/80">segmentation.nii.gz</code> you can load here.
        </p>

        <div className="mt-6 rounded-xl border border-amber-200/12 bg-amber-200/[.035] p-4">
          <div className="flex gap-3">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-200/80" aria-hidden="true" />
            <p className="text-xs leading-5 text-white/78">
              Not validated. The scores follow published rules but haven&apos;t been compared with
              clinicians&apos; scoring.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

export function BuildStepsSidebar() {
  return (
    <aside className="workspace-sidebar left-sidebar">
      <p className="section-label">Make a 3D kidney</p>
      <p className="mt-2 text-lg font-semibold tracking-tight text-white/90">What happens where</p>
      <ol className="mt-5 space-y-1" aria-label="Where each step happens">
        {[
          ['Outline the CT', 'Outside the browser, with 3D Slicer or TotalSegmentator'],
          ['Build the surfaces', 'In this tab'],
          ['Score it', 'In this tab'],
        ].map(([label, where], index) => (
          <li key={label} className="flex gap-3 rounded-lg px-2 py-2.5">
            <span className="grid size-5 shrink-0 place-items-center rounded-full border border-white/10 bg-white/[.035] font-mono text-[11px] text-white/70">
              {index + 1}
            </span>
            <div>
              <p className="text-xs text-white/80">{label}</p>
              <p className="mt-1 text-[11px] leading-4 text-white/62">{where}</p>
            </div>
          </li>
        ))}
      </ol>
    </aside>
  );
}

export function BuildPrivacyPanel() {
  return (
    <aside className="workspace-sidebar right-sidebar">
      <p className="section-label">What the builder does with your file</p>
      <ul className="mt-4 space-y-3">
        {[
          'Read into this tab’s memory. No upload request, no server.',
          'Nothing kept: no file name, no browser storage. Downloads are named calyxview-renal.',
          'Outlines only. Not DICOM; a file that looks like CT is refused.',
          'The NIfTI header’s free-text description is not read or copied.',
        ].map((fact) => (
          <li key={fact} className="flex gap-3">
            <CircleCheck className="mt-0.5 size-4 shrink-0 text-emerald-300/80" aria-hidden="true" />
            <p className="text-xs leading-5 text-white/85">{fact}</p>
          </li>
        ))}
      </ul>

      <div className="mt-5 rounded-xl border border-amber-200/12 bg-amber-200/[.035] p-3.5">
        <p className="text-xs font-medium text-amber-50/90">Use outlines you’re allowed to use here</p>
        <p className="mt-1.5 text-xs leading-5 text-white/75">
          Your organisation&apos;s rules on patient data apply on this computer. Use public, synthetic or
          properly de-identified outlines; removing the name from a header doesn&apos;t de-identify a scan.
        </p>
      </div>

      <div className="mt-6 border-t border-white/8 pt-5">
        <p className="section-label">What a clinical version would need</p>
        <div className="mt-4 space-y-3">
          {[
            'A locked-down store for identifiable data, and a tested de-identification process',
            'Checks on the scan protocol, with the contrast phases registered to each other',
            'Validated outlines, with the uncertainty shown and a way for an expert to correct them',
            'Vessel and collecting-system outlines, so the hilar suffix and PADUA’s collecting-system item can be scored',
            'A record of where each structure came from, and a signed clinical review',
          ].map((item) => (
            <div key={item} className="flex gap-3">
              <Circle className="mt-1 size-3 shrink-0 text-white/50" aria-hidden="true" />
              <p className="text-xs leading-5 text-white/72">{item}</p>
            </div>
          ))}
        </div>
      </div>
    </aside>
  );
}

// ---------------------------------------------------------------------------
// After a build: layers and downloads on the left, scores on the right.
// ---------------------------------------------------------------------------

const faceWords: Record<string, string> = { a: 'anterior (a)', p: 'posterior (p)', x: 'neither (x)' };
const poleWords: Record<string, string> = { superior: 'upper pole', inferior: 'lower pole', middle: 'between the poles' };

const capitalise = (value: string) => (value ? value.charAt(0).toUpperCase() + value.slice(1) : value);

/** The build's warnings, above anything they qualify. */
function Warnings({ warnings, className = '' }: { warnings: string[]; className?: string }) {
  if (!warnings.length) return null;
  return (
    <ul className={`build-warnings space-y-2 ${className}`} aria-label="Warnings">
      {warnings.map((warning) => (
        <li key={warning} className="flex gap-2 rounded-lg border border-amber-200/25 bg-amber-200/[.07] p-2.5">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-amber-200/90" aria-hidden="true" />
          <span className="text-xs font-medium leading-5 text-amber-50/95">{warning}</span>
        </li>
      ))}
    </ul>
  );
}

/** Shown in place of the last kidney's numbers while a new one builds. */
function Building() {
  return (
    <output className="mt-4 flex items-center gap-2 text-xs text-white/75">
      <LoaderCircle className="size-3.5 animate-spin" aria-hidden="true" />
      Building…
    </output>
  );
}
const pct = (fraction: number, digits = 1) => `${(fraction * 100).toFixed(digits)}%`;

export function BuiltSidebar({
  builder,
  output,
  visible,
  toggleLayer,
  kidneyOpacity,
  setKidneyOpacity,
  marginMm,
  setMarginMm,
}: {
  builder: KidneyBuilder;
  output: BuildOutput;
  visible: Record<string, boolean>;
  toggleLayer: (name: string) => void;
  kidneyOpacity: number;
  setKidneyOpacity: (value: number) => void;
  marginMm: number;
  setMarginMm: (value: number) => void;
}) {
  const { report } = output;
  const [exporting, setExporting] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  // While a new file builds, the last kidney's numbers and layers stand down.
  const building = builder.state.status === 'running';

  const run = async (kind: string, job: () => Promise<void> | void) => {
    setExporting(kind);
    setExportError(null);
    try {
      await job();
    } catch {
      setExportError('That download failed. Try again, or try another format.');
    } finally {
      setExporting(null);
    }
  };

  return (
    <aside className="workspace-sidebar left-sidebar">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="section-label">Built in this tab</p>
          <h1 className="mt-2 text-lg font-semibold tracking-tight text-white/90">
            {building ? 'New outline' : report.source === 'sample' ? 'Synthetic sample' : 'Your outline'}
          </h1>
          <p className="mt-1 text-xs leading-5 text-white/70">
            {building ? 'Building…' : `${(report.totalMs / 1000).toFixed(1)} s`}
          </p>
        </div>
      </div>

      {building ? null : <Warnings warnings={report.warnings} className="mt-4" />}

      {building ? (
        <Building />
      ) : report.renal && report.padua ? (
        <>
          <div className="mt-5 grid grid-cols-2 gap-2">
            <Metric label="R.E.N.A.L." value={report.renal.label} detail={capitalise(report.renal.complexity)} />
            <Metric label="PADUA" value={String(report.padua.total)} detail={capitalise(report.padua.complexity)} />
          </div>
          <p className="mt-2 text-[11px] leading-4 text-amber-100/80">{ESTIMATE_LINE}</p>
        </>
      ) : (
        <p className="mt-4 text-xs leading-5 text-amber-100/85">Not scored. {report.notScoredReason}</p>
      )}

      <div className="mt-6 flex items-center justify-between">
        <p className="section-label">Layers</p>
      </div>
      <div className={`mt-2 space-y-0.5 ${building ? 'pointer-events-none opacity-35' : ''}`} aria-hidden={building || undefined}>
        {output.meshes.map((mesh) => (
          <LayerButton
            key={mesh.name}
            active={visible[mesh.name] !== false}
            color={mesh.colour}
            label={mesh.label}
            provenance={mesh.provenance}
            onClick={() => toggleLayer(mesh.name)}
          />
        ))}
      </div>

      <div className="mt-5 border-t border-white/8 pt-5">
        <div className="flex items-center justify-between text-xs text-white/70">
          <label htmlFor="built-opacity">Kidney opacity</label>
          <span className="font-mono text-white/80">{kidneyOpacity}%</span>
        </div>
        <input
          id="built-opacity"
          className="range-control mt-2 w-full"
          type="range"
          min="18"
          max="100"
          value={kidneyOpacity}
          onChange={(event) => setKidneyOpacity(Number(event.target.value))}
        />
        <div className="mt-3 flex items-center justify-between text-xs text-white/70">
          <label htmlFor="built-margin">Margin</label>
          <span className="font-mono text-white/80">{marginMm} mm</span>
        </div>
        <input
          id="built-margin"
          className="range-control mt-2 w-full"
          type="range"
          min="1"
          max="10"
          value={marginMm}
          onChange={(event) => setMarginMm(Number(event.target.value))}
        />
      </div>

      <div className="mt-5 border-t border-white/8 pt-5">
        <p className="section-label">Download</p>
        <p className="mt-2 text-[11px] leading-4 text-white/62">
          The 3D files hold the layers that are switched on. GLB is metres, y-up, centred, for general viewers; STL
          is RAS millimetres.
        </p>
        <div className="mt-3 grid grid-cols-2 gap-2">
          {(
            [
              ['GLB', () => exportModel(output, visible, 'glb')],
              ['STL', () => exportModel(output, visible, 'stl')],
              ['report.json', () => save(new Blob([reportJson(report)], { type: 'application/json' }), `${stem(output)}-report.json`)],
              ['report.md', () => save(new Blob([reportMarkdown(report)], { type: 'text/markdown' }), `${stem(output)}-report.md`)],
            ] as Array<[string, () => Promise<void> | void]>
          ).map(([label, job]) => (
            <Button
              key={label}
              className="border-white/10 bg-white/[.035] text-white/80 hover:bg-white/8 hover:text-white"
              size="sm"
              variant="outline"
              disabled={exporting !== null || building}
              focusableWhenDisabled
              onClick={() => void run(label, job)}
            >
              {exporting === label ? <LoaderCircle className="animate-spin" /> : <Download />} {label}
            </Button>
          ))}
        </div>
        {exportError ? (
          <p className="mt-2 text-xs text-rose-200/90" role="alert">
            {exportError}
          </p>
        ) : null}
      </div>

      <div className="mt-5 border-t border-white/8 pt-5">
        <BuildControls builder={builder} marginMm={marginMm} setMarginMm={setMarginMm} compact />
      </div>
    </aside>
  );
}

type InspectorTab = 'source' | 'scores' | 'plan' | 'limits';

function Rule({ term, points, children }: { term: string; points: string; children: string }) {
  return (
    <div className="build-rule grid grid-cols-[1fr_auto] items-baseline gap-x-3">
      <dt className="text-xs font-medium text-white/88">{term}</dt>
      <dd className="font-mono text-xs text-emerald-100/90">{points}</dd>
      <dd className="col-span-2 mt-1 text-xs leading-5 text-white/72">{children}</dd>
    </div>
  );
}

export function BuiltInspector({
  output,
  tab,
  setTab,
  building = false,
}: {
  output: BuildOutput;
  tab: InspectorTab;
  setTab: (tab: InspectorTab) => void;
  /** A new build is running, so the last kidney's numbers are hidden. */
  building?: boolean;
}) {
  const tabs: Array<{ id: InspectorTab; label: string }> = [
    { id: 'source', label: 'About' },
    { id: 'scores', label: 'Scores' },
    { id: 'plan', label: 'Plan' },
    { id: 'limits', label: 'Limits' },
  ];
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const onTabKey = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    if (!step) return;
    event.preventDefault();
    const next = (index + step + tabs.length) % tabs.length;
    setTab(tabs[next].id);
    tabRefs.current[next]?.focus();
  };
  const { report } = output;
  const r = report.renal;
  const p = report.padua;
  const m = report.planning;
  const grid = report.grid;

  return (
    <aside className="workspace-sidebar right-sidebar">
      <div className="inspector-tabs" role="tablist" aria-label="About this kidney">
        {tabs.map((item, index) => (
          <button
            key={item.id}
            ref={(element) => {
              tabRefs.current[index] = element;
            }}
            id={`built-tab-${item.id}`}
            type="button"
            role="tab"
            aria-selected={tab === item.id}
            aria-controls="built-panel"
            tabIndex={tab === item.id ? 0 : -1}
            onClick={() => setTab(item.id)}
            onKeyDown={(event) => onTabKey(event, index)}
            className={tab === item.id ? 'inspector-tab-active' : ''}
          >
            {item.label}
          </button>
        ))}
      </div>

      <div id="built-panel" className="inspector-content" role="tabpanel" aria-labelledby={`built-tab-${tab}`}>
        {building ? <Building /> : null}
        {!building && tab === 'source' ? (
          <>
            <p className="section-label">Where this model comes from</p>
            <div className="mt-3 rounded-xl border border-emerald-200/10 bg-emerald-200/[.035] p-3.5">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-medium text-white/90">
                  {report.source === 'sample' ? 'Synthetic sample' : 'Your outline'}
                </p>
                <Badge className="border-white/10 bg-white/5 text-[11px] text-white/80" variant="outline">
                  Built here
                </Badge>
              </div>
              <p className="mt-2 text-xs leading-5 text-white/75">
                {report.source === 'sample'
                  ? 'renalplan’s test phantom, made in this tab: two ellipsoid kidneys with a sinus concavity, a 3 cm lower-pole tumour on the right kidney and a small cyst on the left. No patient data.'
                  : 'Built from the label map you loaded. The file isn’t kept.'}
              </p>
            </div>
            <dl className="definition-list mt-5">
              <div><dt>Grid used</dt><dd>{grid.workingDims.join(' x ')} voxels</dd></div>
              <div><dt>Voxel size</dt><dd>{grid.spacingMm.map((s) => s.toFixed(2)).join(' x ')} mm</dd></div>
              <div><dt>Orientation</dt><dd>{`From the ${grid.affineSource}`}</dd></div>
              <div><dt>Sampled down</dt><dd>{grid.downsampled ? `Yes, every ${grid.stride.join(', ')} voxel` : 'No'}</dd></div>
              {report.labels.map((label) => (
                <div key={label.value}>
                  <dt>{`Label ${label.value}`}</dt>
                  <dd>{`${label.name}, ${label.ml.toFixed(1)} ml`}</dd>
                </div>
              ))}
              <div>
                <dt>Surfaces</dt>
                <dd>
                  Smoothed distance field on a 1 mm grid, coarser for very large volumes (the report says the grid
                  used), marching cubes, 5 Taubin passes
                </dd>
              </div>
              <div>
                <dt>Rules</dt>
                <dd>{`${report.rulesFrom}’s rules; raw E and N can differ slightly because the browser’s hull is exact`}</dd>
              </div>
              <div><dt>Built in</dt><dd>{`${(report.totalMs / 1000).toFixed(1)} s`}</dd></div>
              <div><dt>Clinical review</dt><dd>None</dd></div>
            </dl>
            <p className="section-label mt-6">Surface against voxels</p>
            <dl className="definition-list mt-2">
              {report.meshVolumes.map((volume) => (
                <div key={volume.name}>
                  <dt>{volume.label}</dt>
                  <dd>{`${volume.meshMl.toFixed(1)} ml mesh, ${volume.voxelMl.toFixed(1)} ml voxels`}</dd>
                </div>
              ))}
            </dl>
            <p className="mt-2 text-[11px] leading-4 text-white/62">
              The surfaces are for looking at. Every score and volume elsewhere comes from the voxels.
            </p>
            <p className="mt-4 text-xs leading-5 text-white/72">
              Kidneys A to E have meshes from my CalyxView endourology project. This one came from the builder,
              in this tab. The coordinates are RAS millimetres from the file&apos;s own orientation.
            </p>
          </>
        ) : null}

        {!building && tab === 'scores' ? (
          r && p && m ? (
            <>
              <Warnings warnings={report.warnings} className="mb-3" />
              <div className="rounded-xl border border-amber-200/12 bg-amber-200/[.035] p-3">
                <p className="text-xs leading-5 text-amber-50/90">{ESTIMATE_LINE}</p>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <Metric
                  label="R.E.N.A.L."
                  value={r.label}
                  detail={`R ${r.radiusPoints}, E ${r.exophyticPoints}, N ${r.nearnessPoints}, L ${r.locationPoints}, ${r.complexity}`}
                />
                <Metric label="PADUA" value={String(p.total)} detail={capitalise(p.complexity)} />
                <Metric label="Tumour" value={`${r.radiusCm.toFixed(2)} cm`} detail="Largest diameter" />
                <Metric label="Tumour volume" value={`${m.tumourMl.toFixed(1)} ml`} />
              </div>

              <p className="section-label mt-6">R.E.N.A.L., point by point</p>
              <dl className="mt-2">
                <Rule term="R, size" points={`${r.radiusPoints}`}>
                  {`${r.radiusCm.toFixed(2)} cm largest diameter. 4 cm or less scores 1, over 4 and under 7 cm 2, 7 cm or more 3.`}
                </Rule>
                <Rule term="E, exophytic" points={`${r.exophyticPoints}`}>
                  {`${pct(r.exophyticFraction)} outside the kidney’s convex hull. 50% or more scores 1, more than 5% 2, and 5% or less counts as endophytic, 3.`}
                </Rule>
                <Rule term="N, nearness" points={`${r.nearnessPoints}`}>
                  {r.nearnessMm === null
                    ? 'No sinus could be estimated, so N is scored 1.'
                    : `${r.nearnessMm.toFixed(1)} mm to the estimated sinus. N is the distance to the collecting system or sinus: 7 mm or more scores 1, over 4 and under 7 mm 2, 4 mm or less 3.`}
                </Rule>
                <Rule term="A, face" points={r.face}>
                  {`Tumour centre ${Math.abs(r.anteriorOffsetMm).toFixed(1)} mm ${r.anteriorOffsetMm >= 0 ? 'anterior' : 'posterior'} to the kidney’s centre: ${faceWords[r.face]}. More than 5 mm either way sets a or p, otherwise x.`}
                </Rule>
                <Rule term="L, location" points={`${r.locationPoints}`}>
                  {`${capitalise(r.locationDetail)}. Entirely between the polar lines, across the axial midline, or more than half between them scores 3; entirely above or below 1; otherwise 2.`}
                </Rule>
                <Rule term="h, hilar" points="n/a">
                  Not assessed. It needs a vessel outline.
                </Rule>
              </dl>

              <p className="section-label mt-6">PADUA, item by item</p>
              <dl className="mt-2">
                <Rule term="Polar location" points={`${p.polarPoints}`}>
                  {`${capitalise(poleWords[p.polarLocation] ?? p.polarLocation)}. Between the poles (more than half between the polar lines) scores 2, upper or lower pole 1.`}
                </Rule>
                <Rule term="Exophytic rate" points={`${p.exophyticPoints}`}>
                  As E above.
                </Rule>
                <Rule term="Renal rim" points={`${p.rimPoints}`}>
                  {`${capitalise(p.rim)}. Medial (towards the sinus) scores 2, lateral 1.`}
                </Rule>
                <Rule term="Renal sinus" points={`${p.sinusPoints}`}>
                  {`${p.sinusInvolved ? 'Involved' : 'Not involved'}. Scores 2 if the tumour touches the estimated sinus, otherwise 1.`}
                </Rule>
                <Rule term="Collecting system" points={`${p.collectingPoints}`}>
                  Not assessed. It needs an excretory-phase outline, so it is scored 1 and the total can be one point low.
                </Rule>
                <Rule term="Size" points={`${p.sizePoints}`}>
                  4 cm or less scores 1, over 4 up to 7 cm 2, over 7 cm 3.
                </Rule>
              </dl>
              <p className="mt-3 text-xs leading-5 text-white/66">
                R.E.N.A.L. 4 to 6 is low complexity, 7 to 9 moderate, 10 to 12 high. PADUA 6 or 7 is low, 8 or 9
                intermediate, 10 or more high.
              </p>

              <p className="section-label mt-6">Flags</p>
              <ul className="viewer-limits mt-3">
                {report.notes.map((note) => (
                  <li key={note}>
                    <Info className="mt-0.5 size-3.5 shrink-0 text-white/60" aria-hidden="true" />
                    <span>{note}</span>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <>
              <Warnings warnings={report.warnings} className="mb-3" />
              <p className="section-label">Not scored</p>
              <p className="mt-3 text-xs leading-5 text-white/75">{report.notScoredReason}</p>
            </>
          )
        ) : null}

        {!building && tab === 'plan' ? (
          <>
            {report.flags.tumourDetached ? (
              <Warnings warnings={report.warnings.filter((w) => w.startsWith('The tumour does not touch'))} className="mb-3" />
            ) : null}
            <p className="section-label">Kidney kept</p>
            {m ? (
              <div className="mt-3 rounded-xl border border-white/8 bg-black/10 p-3.5">
                <p className="text-[11px] uppercase tracking-[.1em] text-white/66">{`At a ${m.marginMm} mm margin`}</p>
                <p className="mt-1 font-mono text-xl text-white/90">{keptPercent(m.preservedFraction, m.parenchymaRemovedMl)}</p>
                <div className="mt-3 h-1 overflow-hidden rounded-full bg-white/6">
                  <div
                    className="h-full rounded-full bg-emerald-300/70"
                    style={{ width: `${Math.round(m.preservedFraction * 100)}%` }}
                  />
                </div>
                <dl className="definition-list mt-4">
                  <div><dt>Tumour-side kidney</dt><dd>{`${m.ipsilateralKidneyMl.toFixed(1)} ml`}</dd></div>
                  <div><dt>Inside the margin</dt><dd>{`${m.parenchymaRemovedMl.toFixed(1)} ml`}</dd></div>
                  <div><dt>Kept</dt><dd>{`${m.residualIpsilateralMl.toFixed(1)} ml`}</dd></div>
                  <div><dt>Other kidney</dt><dd>{m.contralateralKidneyMl > 0 ? `${m.contralateralKidneyMl.toFixed(1)} ml` : 'Not in the file'}</dd></div>
                  <div><dt>Tumour on kidney</dt><dd>{`${m.contactSurfaceCm2.toFixed(1)} cm²`}</dd></div>
                  {m.cystMl > 0 ? <div><dt>Cyst</dt><dd>{`${m.cystMl.toFixed(1)} ml`}</dd></div> : null}
                </dl>
                <p className="mt-3 text-xs leading-5 text-white/75">
                  {`Parenchyma outside a uniform ${m.marginMm} mm band round the tumour, as a share of the tumour-side kidney. Volume, not function, and not a resection plan. Enucleation takes less; renorrhaphy and devascularised tissue take more.`}
                </p>
                <p className="mt-2 text-xs leading-5 text-white/75">The margin slider on the left reruns it.</p>
              </div>
            ) : (
              <p className="mt-3 text-xs leading-5 text-white/75">Nothing to plan without a kidney and a tumour.</p>
            )}
            <ApproachNotes />
          </>
        ) : null}

        {!building && tab === 'limits' ? (
          <>
            <p className="section-label">What this can’t tell you</p>
            <ul className="viewer-limits mt-3">
              {[
                'Step 1, outlining the CT, isn’t done here. The scores are only as good as the outline.',
                'The sinus is estimated from the outline, not seen, so N, L and the PADUA pole are approximate.',
                'There are no vessels or collecting system, so no hilar suffix, no PADUA collecting-system item, and nothing on clamping.',
                'The scores haven’t been compared with clinicians’ own scoring. It isn’t validated and it isn’t a medical device.',
                ...BROWSER_DIFFERENCES.map((item) => `Compared with renalplan: ${item.charAt(0).toLowerCase()}${item.slice(1)}`),
              ].map((item) => (
                <li key={item}>
                  <Info className="mt-0.5 size-3.5 shrink-0 text-white/60" aria-hidden="true" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </>
        ) : null}
      </div>
    </aside>
  );
}

/** One line for the viewer's status bar. */
export function builtSummary(output: BuildOutput): string {
  const { report } = output;
  const name = report.source === 'sample' ? 'Synthetic sample' : 'Your outline';
  if (!report.renal || !report.padua) return `${name}: meshes built, not scored`;
  return `${name}: R.E.N.A.L. ${report.renal.label} (${report.renal.complexity}), PADUA ${report.padua.total} (${report.padua.complexity}), tumour ${report.renal.radiusCm.toFixed(2)} cm, estimated`;
}

