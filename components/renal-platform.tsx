'use client';

import {
  Activity,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Box,
  Check,
  Download,
  Focus,
  Info,
  Layers3,
  LockKeyhole,
  MousePointer2,
  RotateCcw,
  ShieldAlert,
  SlidersHorizontal,
  Sparkles,
  Wand2,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import {
  useCallback,
  useMemo,
  useRef,
  useState,
  useEffect,
  lazy,
  Suspense,
  type Dispatch,
  type KeyboardEvent,
  type ReactNode,
  type SetStateAction,
} from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type { AnatomyLayers, ViewPreset, ZoomRequest } from '@/components/kidney-scene';
import type { SceneCase } from '@/components/reference-case-scene';
import {
  BuildIntro,
  BuildPrivacyPanel,
  BuildStepsSidebar,
  BuiltInspector,
  BuiltSidebar,
  builtSummary,
  sceneCaseFor,
  useKidneyBuilder,
} from '@/components/kidney-builder';
import { ApproachNotes, LayerButton, Metric } from '@/components/viewer-ui';
import { referenceCases, type ReferenceCase } from '@/lib/reference-cases';

export type WorkspaceMode = 'plan' | 'build' | 'learn';
type InspectorTab = 'source' | 'scores' | 'plan' | 'limits';

/** The hand-made teaching kidney. Every other case id is one of Kidneys A to E. */
const TEACHING_CASE_ID = 'synthetic';
const BUILD_HASH = '#workspace/build';

const NO_ZOOM: ZoomRequest = { nonce: 0, direction: 1 };

const ALL_LAYERS: AnatomyLayers = {
  kidney: true,
  tumour: true,
  arteries: true,
  veins: true,
  collecting: true,
};

const ReferenceCaseScene = lazy(() =>
  import('@/components/reference-case-scene').then((module) => ({
    default: module.ReferenceCaseScene,
  })),
);

const KidneyScene = lazy(() =>
  import('@/components/kidney-scene').then((module) => ({
    default: module.KidneyScene,
  })),
);

const layerConfig: Array<{ key: keyof AnatomyLayers; label: string; color: string }> = [
  { key: 'kidney', label: 'Kidney', color: '#72c9a5' },
  { key: 'tumour', label: 'Tumour', color: '#ef7d69' },
  { key: 'arteries', label: 'Arteries', color: '#ffb45e' },
  { key: 'veins', label: 'Veins', color: '#76bff0' },
  { key: 'collecting', label: 'Collecting system', color: '#9bded7' },
];

const viewButtons: Array<{ preset: ViewPreset; short: string; label: string }> = [
  { preset: 'anterior', short: 'Ant', label: 'view from the front (anterior)' },
  { preset: 'posterior', short: 'Post', label: 'view from the back (posterior)' },
  { preset: 'left', short: 'L', label: 'view from the patient’s left' },
  { preset: 'right', short: 'R', label: 'view from the patient’s right' },
  { preset: 'superior', short: 'Sup', label: 'view from above (superior)' },
];

// What the corner axes show for each view: up, to the right, and towards you.
const orientation: Record<ViewPreset, { up: string; right: string; toward: string; words: string }> = {
  anterior: {
    up: 'S',
    right: 'L',
    toward: 'A',
    words: 'Superior is up, the patient’s left is to the right, and anterior faces you.',
  },
  posterior: {
    up: 'S',
    right: 'R',
    toward: 'P',
    words: 'Superior is up, the patient’s right is to the right, and posterior faces you.',
  },
  left: {
    up: 'S',
    right: 'P',
    toward: 'L',
    words: 'Superior is up, posterior is to the right, and the patient’s left faces you.',
  },
  right: {
    up: 'S',
    right: 'A',
    toward: 'R',
    words: 'Superior is up, anterior is to the right, and the patient’s right faces you.',
  },
  superior: {
    up: 'P',
    right: 'L',
    toward: 'S',
    words: 'Posterior is up, the patient’s left is to the right, and superior faces you.',
  },
};

const trainingSteps = [
  {
    title: 'The hilum',
    short: 'Hilum',
    instruction:
      'Press L to look from the patient’s left, straight into the hilum of this right kidney. Anterior is now on the left of the screen. Blue is the renal vein, amber the artery, pale teal the pelvis.',
    question: 'Which structure is most anterior at the hilum?',
    options: ['The renal artery', 'The renal vein', 'The renal pelvis', 'The ureter'],
    correct: 1,
    rationale:
      'Anterior to posterior the usual order is vein, artery, pelvis, so the renal vein is the first hilar structure you meet from the front.',
  },
  {
    title: 'Where the tumour is',
    short: 'Tumour',
    instruction:
      'Press Ant for the anterior view, then R for the patient’s right. This is a right kidney, so R shows its lateral border.',
    question: 'Where is the tumour?',
    options: [
      'Upper pole, medial, posterior face',
      'Between the poles, lateral, anterior face',
      'Lower pole, lateral, posterior face',
      'Between the poles, at the hilum',
    ],
    correct: 1,
    rationale:
      'It sits on the lateral border, entirely between the polar lines, and bulges from the anterior face. In R.E.N.A.L. terms that’s L 3 with the a suffix.',
  },
  {
    title: 'Blood supply',
    short: 'Blood supply',
    instruction:
      'Follow the amber branch from the hilum to the tumour. If the parenchyma is in the way, drag Cutaway under the model to peel it back from the front.',
    question: 'What would you want from the imaging before planning selective clamping?',
    options: [
      'An excretory phase showing the calyces',
      'An arterial phase showing the segmental branches',
      'A venous phase showing the renal vein tributaries',
      'The tumour diameter and depth',
    ],
    correct: 1,
    rationale:
      'Selective (segmental) clamping stops flow only in the branches supplying the tumour, so you need to know which branches those are. That needs an arterial phase. The branches in this model are drawn by hand.',
  },
  {
    title: 'Nearness',
    short: 'Nearness',
    instruction:
      'Drag Cutaway about halfway, then press Sup to look down from above. Note how close the calyx (pale teal) comes to the tumour: 3.6 mm in this model.',
    question: 'The tumour is 3.6 mm from the collecting system. What does N score?',
    options: ['N 1', 'N 2', 'N 3', 'It depends on the tumour size'],
    correct: 2,
    rationale:
      'N scores 1 at 7 mm or more, 2 between 4 and 7 mm, and 3 at 4 mm or less, so 3.6 mm is N 3. At that distance a breach of the collecting system needing repair is more likely.',
  },
  {
    title: 'Putting a score together',
    short: 'Score',
    instruction:
      'This tumour: 2.8 cm, less than half exophytic, 3.6 mm from the collecting system, entirely between the polar lines, anterior.',
    question: 'What’s its R.E.N.A.L. score?',
    options: ['6a, low complexity', '9a, moderate complexity', '9p, moderate complexity', '11a, high complexity'],
    correct: 1,
    rationale:
      'R 1 (4 cm or less), E 2 (under 50% exophytic), N 3 (4 mm or less) and L 3 (entirely between the polar lines) make 9. It’s anterior, so 9a. Totals of 7 to 9 are moderate complexity. The pipeline does the same sum for Kidneys A to E.',
  },
];

const faceNames: Record<string, string> = {
  a: 'Anterior (a)',
  p: 'Posterior (p)',
  x: 'Neither (x)',
};

const poleNames: Record<string, string> = {
  superior: 'Upper pole',
  inferior: 'Lower pole',
  middle: 'Between the poles',
};

function capitalise(value: string) {
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : value;
}

function percent(fraction: number) {
  return `${Math.round(fraction * 100)}%`;
}

/** Whole percent, or one decimal between 0 and 10%, as in the pipeline table, so 0.025 reads 2.5%. */
function share(fraction: number) {
  const value = fraction * 100;
  return `${value.toFixed(value > 0 && value < 10 ? 1 : 0)}%`;
}

function caseSummary(activeCase: ReferenceCase | null) {
  if (!activeCase) return 'Teaching kidney: example R.E.N.A.L. 9a (moderate), tumour 2.8 cm';
  const { nephrometry: n } = activeCase;
  return `${activeCase.label}: R.E.N.A.L. ${n.renalLabel} (${n.renalComplexity}), PADUA ${n.paduaTotal} (${n.paduaComplexity}), tumour ${n.diameterCm.toFixed(1)} cm`;
}

function ModeButton({
  active,
  icon,
  label,
  onClick,
}: {
  active: boolean;
  icon: ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      className={`flex h-8 items-center gap-2 rounded-lg px-3 text-xs font-medium transition ${
        active
          ? 'bg-white/10 text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,.04)]'
          : 'text-white/70 hover:bg-white/5 hover:text-white'
      }`}
    >
      {icon}
      {label}
    </button>
  );
}

function CaseSidebar({
  mode,
  activeCase,
  referenceVisible,
  setReferenceVisible,
  layers,
  setLayers,
  kidneyOpacity,
  setKidneyOpacity,
  trainingStep,
  answers,
}: {
  mode: WorkspaceMode;
  activeCase: ReferenceCase | null;
  referenceVisible: Record<string, boolean>;
  setReferenceVisible: (name: string, value?: boolean) => void;
  layers: AnatomyLayers;
  setLayers: Dispatch<SetStateAction<AnatomyLayers>>;
  kidneyOpacity: number;
  setKidneyOpacity: (value: number) => void;
  trainingStep: number;
  answers: Record<number, number>;
}) {
  if (mode === 'learn') {
    const completed = Object.keys(answers).length;
    return (
      <aside className="workspace-sidebar left-sidebar">
        <p className="section-label">The lesson</p>
        <h1 className="mt-2 text-lg font-semibold tracking-tight text-white/90">Small renal mass basics</h1>
        <p className="mt-2 text-xs leading-5 text-white/70">
          Five questions on the teaching kidney, the only model here with vessels and a collecting system.
        </p>

        <div className="mt-5 h-1.5 overflow-hidden rounded-full bg-white/6">
          <div
            className="h-full rounded-full bg-sky-300 transition-[width] duration-500"
            style={{ width: `${(completed / trainingSteps.length) * 100}%` }}
          />
        </div>
        <p className="mt-2 text-[11px] text-white/66">
          {completed} of {trainingSteps.length} answered. Answers aren’t saved.
        </p>

        <ol className="mt-5 space-y-1">
          {trainingSteps.map((step, index) => {
            const answered = answers[index] !== undefined;
            const current = index === trainingStep;
            return (
              <li
                key={step.title}
                aria-current={current ? 'step' : undefined}
                className={`flex items-center gap-3 rounded-lg px-2.5 py-2.5 ${current ? 'bg-white/6' : ''}`}
              >
                <span
                  className={`grid size-5 place-items-center rounded-full border ${
                    answered
                      ? 'border-emerald-300/25 bg-emerald-300/12 text-emerald-200'
                      : current
                        ? 'border-sky-300/30 bg-sky-300/10 text-sky-200'
                        : 'border-white/10 text-white/62'
                  }`}
                >
                  {answered ? <Check className="size-3" /> : <span className="font-mono text-[11px]">{index + 1}</span>}
                </span>
                <span className={`text-xs ${current ? 'text-white/90' : 'text-white/66'}`}>{step.title}</span>
              </li>
            );
          })}
        </ol>
      </aside>
    );
  }

  const isolate = () => {
    if (activeCase) setReferenceVisible('parenchyma', false);
    else setLayers({ ...ALL_LAYERS, kidney: false });
  };

  return (
    <aside className="workspace-sidebar left-sidebar">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="section-label">{activeCase ? 'KiTS23 kidney' : 'Hand-made model'}</p>
          <h1 className="mt-2 text-lg font-semibold tracking-tight text-white/90">
            {activeCase ? activeCase.label : 'The teaching kidney'}
          </h1>
          <p className="mt-1 text-xs leading-5 text-white/70">
            {activeCase ? 'De-identified CT, KiTS expert outlines' : 'A right kidney with a tumour, made in code'}
          </p>
        </div>
        <span className="status-dot mt-1" aria-hidden="true" />
      </div>

      <div className="mt-5 grid grid-cols-2 gap-2">
        <Metric
          label="R.E.N.A.L."
          value={activeCase ? activeCase.nephrometry.renalLabel : '9a'}
          detail={activeCase ? capitalise(activeCase.nephrometry.renalComplexity) : 'Example'}
        />
        <Metric
          label="PADUA"
          value={activeCase ? String(activeCase.nephrometry.paduaTotal) : 'Not scored'}
          detail={activeCase ? capitalise(activeCase.nephrometry.paduaComplexity) : 'Teaching kidney'}
        />
      </div>

      <div className="mt-6 flex items-center justify-between">
        <p className="section-label">Layers</p>
        <Layers3 className="size-3.5 text-white/60" aria-hidden="true" />
      </div>
      <div className="mt-2 space-y-0.5">
        {activeCase
          ? activeCase.structures.map((structure) => (
              <LayerButton
                key={structure.name}
                active={referenceVisible[structure.name] !== false}
                color={structure.colour}
                label={structure.label}
                provenance={structure.provenance}
                onClick={() => setReferenceVisible(structure.name)}
              />
            ))
          : layerConfig.map((layer) => (
              <LayerButton
                key={layer.key}
                active={layers[layer.key]}
                color={layer.color}
                label={layer.label}
                provenance="Hand-made"
                onClick={() => setLayers((current) => ({ ...current, [layer.key]: !current[layer.key] }))}
              />
            ))}
      </div>

      <div className="mt-5 border-t border-white/8 pt-5">
        <div className="flex items-center justify-between text-xs text-white/70">
          <label htmlFor="kidney-opacity">Kidney opacity</label>
          <span className="font-mono text-white/80">{kidneyOpacity}%</span>
        </div>
        <input
          id="kidney-opacity"
          className="range-control mt-2 w-full"
          type="range"
          min="18"
          max="100"
          value={kidneyOpacity}
          onChange={(event) => setKidneyOpacity(Number(event.target.value))}
        />
        <div className="mt-3 flex gap-2">
          <Button
            className="flex-1 border-white/10 bg-white/[.035] text-white/80 hover:bg-white/8 hover:text-white"
            size="sm"
            variant="outline"
            onClick={() => setKidneyOpacity(34)}
          >
            <Sparkles /> Ghost
          </Button>
          <Button
            className="flex-1 border-white/10 bg-white/[.035] text-white/80 hover:bg-white/8 hover:text-white"
            size="sm"
            variant="outline"
            onClick={isolate}
          >
            <Focus /> Hide kidney
          </Button>
        </div>
      </div>
    </aside>
  );
}

function ViewToolbar({
  preset,
  choosePreset,
  resetView,
  onSnapshot,
}: {
  preset: ViewPreset;
  choosePreset: (preset: ViewPreset) => void;
  resetView: () => void;
  onSnapshot: () => void;
}) {
  return (
    <div className="viewer-toolbar">
      <fieldset className="flex items-center gap-1" aria-label="Views">
        {viewButtons.map((item) => (
          <button
            key={item.preset}
            type="button"
            onClick={() => choosePreset(item.preset)}
            aria-pressed={preset === item.preset}
            aria-label={`${item.short}, ${item.label}`}
            title={item.label.charAt(0).toUpperCase() + item.label.slice(1)}
            className={`view-button ${preset === item.preset ? 'view-button-active' : ''}`}
          >
            {item.short}
          </button>
        ))}
      </fieldset>
      <div className="ml-1 h-5 w-px bg-white/10" />
      <button type="button" className="icon-button" onClick={resetView} aria-label="Reset view" title="Reset view">
        <RotateCcw className="size-4" />
      </button>
      <button
        type="button"
        className="icon-button"
        onClick={onSnapshot}
        aria-label="Save an image of this view"
        title="Save an image of this view"
      >
        <Download className="size-4" />
      </button>
    </div>
  );
}

function CasePicker({
  caseId,
  chooseCase,
}: {
  caseId: string;
  chooseCase: (id: string) => void;
}) {
  return (
    <fieldset className="case-switcher-group">
      <legend className="sr-only">Choose a kidney</legend>
      <span className="case-switcher-group-label" aria-hidden="true">Kidney</span>
      <button
        type="button"
        aria-pressed={caseId === TEACHING_CASE_ID}
        onClick={() => chooseCase(TEACHING_CASE_ID)}
        title="The teaching kidney"
      >
        Teaching
      </button>
      {referenceCases.map((item) => {
        const letter = item.label.replace(/^Kidney\s+/, '');
        return (
          <button
            key={item.id}
            type="button"
            aria-pressed={caseId === item.id}
            aria-label={`${item.label}, KiTS23`}
            title={`${item.label}, KiTS23`}
            onClick={() => chooseCase(item.id)}
          >
            {letter}
          </button>
        );
      })}
    </fieldset>
  );
}

function ModelWorkspace({
  mode,
  activeCase,
  builtCase,
  builtVisible,
  builtLine,
  caseId,
  chooseCase,
  referenceVisible,
  layers,
  kidneyOpacity,
  marginMm,
  setMarginMm,
  clipPercent,
  setClipPercent,
  preset,
  choosePreset,
  resetView,
  viewNonce,
  resetNonce,
  zoomRequest,
  zoom,
  handRotated,
  onUserRotate,
  trainingStep,
}: {
  mode: WorkspaceMode;
  activeCase: ReferenceCase | null;
  builtCase: SceneCase | null;
  builtVisible: Record<string, boolean>;
  builtLine: string;
  caseId: string;
  chooseCase: (id: string) => void;
  referenceVisible: Record<string, boolean>;
  layers: AnatomyLayers;
  kidneyOpacity: number;
  marginMm: number;
  setMarginMm: (value: number) => void;
  clipPercent: number;
  setClipPercent: (value: number) => void;
  preset: ViewPreset;
  choosePreset: (value: ViewPreset) => void;
  resetView: () => void;
  viewNonce: number;
  resetNonce: number;
  zoomRequest: ZoomRequest;
  zoom: (direction: 1 | -1) => void;
  handRotated: boolean;
  onUserRotate: () => void;
  trainingStep: number;
}) {
  const building = mode === 'build' && builtCase !== null;
  const sceneCase: SceneCase | null = building ? builtCase : activeCase;
  const visible = building ? builtVisible : referenceVisible;

  const snapshot = () => {
    const canvas = document.getElementById('renal-3d-canvas') as HTMLCanvasElement | null;
    if (!canvas) return;
    const name = building
      ? 'built-kidney'
      : activeCase
        ? activeCase.label.toLowerCase().replace(/\s+/g, '-')
        : 'teaching-kidney';
    const anchor = document.createElement('a');
    // The canvas is transparent, so paint the viewer's background behind the
    // model. Otherwise image viewers show the pale kidney on white.
    const out = document.createElement('canvas');
    out.width = canvas.width;
    out.height = canvas.height;
    const context = out.getContext('2d');
    if (context) {
      context.fillStyle = '#05120e';
      context.fillRect(0, 0, out.width, out.height);
      context.drawImage(canvas, 0, 0);
    }
    anchor.href = (context ? out : canvas).toDataURL('image/png');
    anchor.download = `calyxview-renal-${name}.png`;
    anchor.click();
  };

  const axes = orientation[preset];
  const modelName = sceneCase ? sceneCase.label : 'Teaching kidney';
  const showMargin = building || (!activeCase && mode !== 'build');

  return (
    <section id="model-workspace" tabIndex={-1} className="model-workspace" aria-label={`${modelName}, 3D model`}>
      <div className="viewer-topbar">
        {mode === 'plan' ? (
          <CasePicker caseId={caseId} chooseCase={chooseCase} />
        ) : building ? (
          <p className="flex items-center gap-2 text-xs text-white/75">
            <Wand2 className="size-3.5" aria-hidden="true" />
            {modelName}
            <span className="hidden text-white/66 sm:inline">(built in this tab)</span>
          </p>
        ) : (
          <p className="flex items-center gap-2 text-xs text-white/75">
            <Box className="size-3.5" aria-hidden="true" />
            Teaching kidney
            <span className="hidden text-white/66 sm:inline">(the lesson always uses it)</span>
          </p>
        )}
        <div className="hidden shrink-0 items-center gap-2 text-xs text-white/66 lg:flex">
          <MousePointer2 className="size-3" aria-hidden="true" />
          Drag to turn it. Scroll or pinch to zoom.
        </div>
      </div>

      <div className="volume-grid relative min-h-0 flex-1 overflow-hidden">
        <Suspense
          fallback={
            <div className="grid h-full min-h-[300px] place-items-center text-center text-sm text-white/70">
              Loading the 3D view…
            </div>
          }
        >
          {sceneCase ? (
            <ReferenceCaseScene
              key={sceneCase.id}
              referenceCase={sceneCase}
              visible={visible}
              parenchymaOpacity={kidneyOpacity}
              clipPercent={clipPercent}
              preset={preset}
              viewNonce={viewNonce}
              resetNonce={resetNonce}
              zoomRequest={zoomRequest}
              onUserRotate={onUserRotate}
            />
          ) : (
            <KidneyScene
              layers={layers}
              kidneyOpacity={kidneyOpacity}
              marginMm={marginMm}
              clipPercent={clipPercent}
              preset={preset}
              viewNonce={viewNonce}
              resetNonce={resetNonce}
              zoomRequest={zoomRequest}
              onUserRotate={onUserRotate}
              trainingStep={mode === 'learn' ? trainingStep : -1}
            />
          )}
        </Suspense>

        <ViewToolbar preset={preset} choosePreset={choosePreset} resetView={resetView} onSnapshot={snapshot} />

        <div className="viewer-chips">
          <div className="viewer-chip">
            <span className="size-1.5 rounded-full bg-emerald-300" aria-hidden="true" />
            {building ? 'Built from an outline' : activeCase ? 'KiTS expert outlines' : 'Hand-made model'}
          </div>
          <div className="viewer-chip">
            <LockKeyhole className="size-3" aria-hidden="true" />
            {building ? 'Nothing uploaded' : activeCase ? 'De-identified public data' : 'No patient data'}
          </div>
        </div>

        {mode === 'learn' ? (
          <output className="training-hotspot">
            <span className="hotspot-pulse" />
            <span className="text-xs text-white/85">{`Step ${trainingStep + 1}: ${trainingSteps[trainingStep].short}`}</span>
          </output>
        ) : null}

        {handRotated ? null : (
          <div className="orientation-axis" title={axes.words}>
            <span className="sr-only">{`View axes. ${axes.words}`}</span>
            <span className="axis-y" aria-hidden="true">{axes.up}</span>
            <span className="axis-x" aria-hidden="true">{axes.right}</span>
            <span className="axis-z" aria-hidden="true">{axes.toward}</span>
            <span className="axis-core" aria-hidden="true" />
          </div>
        )}

        <div className="viewer-controls">
          <div className="flex items-center gap-2">
            <SlidersHorizontal className="size-3.5 text-white/66" aria-hidden="true" />
            <label htmlFor="clip-plane" className="text-xs text-white/75">Cutaway</label>
            <input
              id="clip-plane"
              type="range"
              min="0"
              max="100"
              value={clipPercent}
              onChange={(event) => setClipPercent(Number(event.target.value))}
              className="range-control w-28 sm:w-36"
            />
            <span className="w-9 text-right font-mono text-xs text-white/75">{clipPercent}%</span>
          </div>
          {/* Buttons as well as the wheel and pinch, for keyboard users and anyone who can't pinch. */}
          <div className="flex items-center gap-1">
            <button type="button" className="icon-button" onClick={() => zoom(1)} aria-label="Zoom in" title="Zoom in">
              <ZoomIn className="size-4" aria-hidden="true" />
            </button>
            <button type="button" className="icon-button" onClick={() => zoom(-1)} aria-label="Zoom out" title="Zoom out">
              <ZoomOut className="size-4" aria-hidden="true" />
            </button>
          </div>
          {showMargin ? (
            <div className="viewer-margin flex items-center gap-2">
              <label htmlFor="margin-inline" className="text-xs text-white/75">Margin</label>
              <input
                id="margin-inline"
                type="range"
                min="1"
                max="10"
                value={marginMm}
                onChange={(event) => setMarginMm(Number(event.target.value))}
                className="range-control w-20"
              />
              <span className="w-11 text-right font-mono text-xs text-white/75">{marginMm} mm</span>
            </div>
          ) : null}
        </div>
      </div>

      <div className="viewer-statusbar">
        {mode === 'learn' ? (
          <>
            <p>{`Lesson step ${trainingStep + 1} of ${trainingSteps.length}: ${trainingSteps[trainingStep].title}`}</p>
            {/* A button, not a #hash link: the site uses the hash to decide which view to show. */}
            <button
              type="button"
              className="viewer-jump"
              onClick={() => {
                const panel = document.getElementById('lesson-panel');
                const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
                panel?.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
                panel?.querySelector<HTMLElement>('#lesson-question')?.focus({ preventScroll: true });
              }}
            >
              Question below <ArrowDown className="size-3" aria-hidden="true" />
            </button>
          </>
        ) : (
          <p>{building ? builtLine : caseSummary(activeCase)}</p>
        )}
      </div>
    </section>
  );
}

function PlanningInspector({
  tab,
  setTab,
  activeCase,
  marginMm,
  setMarginMm,
}: {
  tab: InspectorTab;
  setTab: (tab: InspectorTab) => void;
  activeCase: ReferenceCase | null;
  marginMm: number;
  setMarginMm: (value: number) => void;
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

  const n = activeCase?.nephrometry;

  return (
    <aside className="workspace-sidebar right-sidebar">
      <div className="inspector-tabs" role="tablist" aria-label="About this kidney">
        {tabs.map((item, index) => (
          <button
            key={item.id}
            ref={(element) => {
              tabRefs.current[index] = element;
            }}
            id={`inspector-tab-${item.id}`}
            type="button"
            role="tab"
            aria-selected={tab === item.id}
            aria-controls="inspector-panel"
            tabIndex={tab === item.id ? 0 : -1}
            onClick={() => setTab(item.id)}
            onKeyDown={(event) => onTabKey(event, index)}
            className={tab === item.id ? 'inspector-tab-active' : ''}
          >
            {item.label}
          </button>
        ))}
      </div>

      <div
        id="inspector-panel"
        className="inspector-content"
        role="tabpanel"
        aria-labelledby={`inspector-tab-${tab}`}
      >
        {tab === 'source' ? (
          activeCase ? (
            <>
              <p className="section-label">Where this model comes from</p>
              <div className="mt-3 rounded-xl border border-emerald-200/10 bg-emerald-200/[.035] p-3.5">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-medium text-white/90">{activeCase.label}</p>
                  <Badge className="border-white/10 bg-white/5 text-[11px] text-white/80" variant="outline">
                    KiTS23
                  </Badge>
                </div>
                <p className="mt-2 text-xs leading-5 text-white/75">
                  From a de-identified CT of a real patient in the public KiTS23 dataset. Only the 3D model and
                  the numbers come to your browser, not the CT.
                </p>
              </div>
              <dl className="definition-list mt-5">
                <div>
                  <dt>Source</dt>
                  <dd>
                    <a className="viewer-link" href="https://github.com/neheller/kits23" target="_blank" rel="noreferrer">
                      KiTS23
                      <span className="sr-only"> (opens in a new tab)</span>
                    </a>
                    {', '}
                    <a
                      className="viewer-link"
                      href="https://creativecommons.org/licenses/by-nc-sa/4.0/"
                      target="_blank"
                      rel="noreferrer"
                    >
                      CC BY-NC-SA 4.0
                      <span className="sr-only"> (opens in a new tab)</span>
                    </a>
                  </dd>
                </div>
                <div><dt>Kidney and tumour</dt><dd>KiTS expert outlines</dd></div>
                {activeCase.structures.some((s) => s.name === 'cyst') ? (
                  <div><dt>Cyst</dt><dd>KiTS expert outline</dd></div>
                ) : null}
                <div><dt>3D model</dt><dd>My CalyxView endourology project</dd></div>
                <div><dt>Scores</dt><dd>renalplan, from the outlines</dd></div>
                <div><dt>Pipeline run</dt><dd>{`${Math.round(activeCase.runtimeSeconds)} s on a CPU`}</dd></div>
                <div><dt>Clinical review</dt><dd>None yet</dd></div>
              </dl>
              <p className="mt-4 text-xs leading-5 text-white/72">
                The mesh came from the mesh step of my separate CalyxView endourology project (not public yet),
                built from the same KiTS23 outlines. KiTS23 is licensed non-commercial share-alike, and the
                meshes carry the same terms.
              </p>
              {activeCase.structures.some((s) => s.provenance.startsWith('TotalSegmentator')) ? (
                <p className="mt-3 text-xs leading-5 text-white/72">
                  The ribs, psoas, colon, spleen, liver and body outline in this file aren’t KiTS labels. They’re
                  outlines of the same CT from{' '}
                  <a
                    className="viewer-link"
                    href="https://github.com/wasserth/TotalSegmentator"
                    target="_blank"
                    rel="noreferrer"
                  >
                    TotalSegmentator
                    <span className="sr-only"> (opens in a new tab)</span>
                  </a>{' '}
                  (Wasserthal et al., Radiology: AI 2023), an AI model. Nobody has checked them, so they start
                  hidden.
                </p>
              ) : null}
              {activeCase.structures.some((s) => s.name === 'cyst' && !s.framing) ? (
                <p className="mt-3 text-xs leading-5 text-white/72">
                  The cyst belongs to the contralateral kidney, which isn’t in this file. That’s why it starts
                  hidden and sits away from this kidney when you show it.
                </p>
              ) : null}
            </>
          ) : (
            <>
              <p className="section-label">Where this model comes from</p>
              <div className="mt-3 rounded-xl border border-emerald-200/10 bg-emerald-200/[.035] p-3.5">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-medium text-white/90">The teaching kidney</p>
                  <Badge className="border-white/10 bg-white/5 text-[11px] text-white/80" variant="outline">
                    Hand-made
                  </Badge>
                </div>
                <p className="mt-2 text-xs leading-5 text-white/75">
                  I built this right kidney in code to teach with: a tumour, arteries, veins and a collecting
                  system. It isn’t from a scan, and there’s no patient data in it.
                </p>
              </div>
              <dl className="definition-list mt-5">
                <div><dt>Source</dt><dd>Made in code</dd></div>
                <div><dt>Side</dt><dd>Right kidney</dd></div>
                <div><dt>Imaging</dt><dd>None</dd></div>
                <div><dt>Scale</dt><dd>Roughly life-size, about 12 cm long</dd></div>
              </dl>
            </>
          )
        ) : null}

        {tab === 'scores' ? (
          activeCase && n ? (
            <>
              <p className="section-label">Computed from the KiTS23 outlines</p>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <Metric
                  label="R.E.N.A.L."
                  value={n.renalLabel}
                  detail={`R ${n.renalPoints.r}, E ${n.renalPoints.e}, N ${n.renalPoints.n}, L ${n.renalPoints.l}, ${n.renalComplexity}`}
                />
                <Metric label="PADUA" value={String(n.paduaTotal)} detail={capitalise(n.paduaComplexity)} />
                <Metric label="Tumour" value={`${n.diameterCm.toFixed(1)} cm`} detail="Largest diameter. R: 4 cm or less scores 1" />
                <Metric label="Tumour volume" value={`${n.tumourMl.toFixed(1)} ml`} />
                <Metric
                  label="Exophytic"
                  value={share(n.exophyticFraction)}
                  detail="E: 50% or more scores 1; 5% or less counts as endophytic, 3"
                />
                <Metric
                  label="To sinus"
                  value={`${n.nearnessMm.toFixed(1)} mm`}
                  detail="N: to the estimated sinus; 4 mm or less scores 3"
                />
              </div>
              <dl className="definition-list mt-5">
                <div><dt>Location (L)</dt><dd>{capitalise(n.locationDetail)}</dd></div>
                <div><dt>Pole (PADUA)</dt><dd>{poleNames[n.polarLocation] ?? capitalise(n.polarLocation)}</dd></div>
                <div><dt>Face</dt><dd>{faceNames[n.face] ?? n.face}</dd></div>
                <div><dt>Rim (PADUA)</dt><dd>{capitalise(n.rim)}</dd></div>
                <div><dt>Renal sinus (PADUA)</dt><dd>{n.paduaSinusInvolved ? 'Involved' : 'Not involved'}</dd></div>
                <div>
                  <dt>Hilar (h)</dt>
                  <dd>{n.hilarAssessed ? (n.hilar ? 'Yes' : 'No') : 'Not assessed, no vessel outline'}</dd>
                </div>
                <div>
                  <dt>Collecting system (PADUA)</dt>
                  <dd>{n.collectingAssessed ? 'Assessed' : 'Not assessed'}</dd>
                </div>
              </dl>
              <div className="mt-5 rounded-xl border border-white/8 bg-white/[.025] p-3.5">
                <p className="text-xs leading-5 text-white/75">
                  renalplan scored these from the KiTS23 outlines, not from the mesh on screen. KiTS doesn’t
                  outline the renal sinus, so it’s estimated from the kidney outline. L and the PADUA pole are
                  measured against planes across the kidney’s own long axis, placed from that estimate, so
                  they’re approximate. For the PADUA pole a tumour counts as between the poles only if more
                  than half of it lies between the polar lines.
                  {n.collectingAssessed
                    ? null
                    : ' With no collecting-system outline, PADUA’s collecting-system item defaulted to 1 point, so the PADUA total can be one point low.'}
                </p>
                {activeCase.caseNotes.map((note) => (
                  <p key={note} className="mt-2 text-xs leading-5 text-white/75">{note}</p>
                ))}
              </div>
            </>
          ) : (
            <>
              <p className="section-label">Example numbers</p>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <Metric label="R.E.N.A.L." value="9a" detail="R 1, E 2, N 3, L 3, example" />
                <Metric label="Tumour" value="2.8 cm" detail="4 cm or less, so R 1" />
                <Metric label="Exophytic" value="37%" detail="Under 50%, so E 2" />
                <Metric label="Collecting" value="3.6 mm" detail="4 mm or less, so N 3" />
              </div>
              <dl className="definition-list mt-5">
                <div><dt>Location (L)</dt><dd>Entirely between the polar lines, L 3</dd></div>
                <div><dt>Face</dt><dd>Anterior (a)</dd></div>
                <div><dt>Rim</dt><dd>Lateral</dd></div>
                <div><dt>Hilar (h)</dt><dd>No</dd></div>
              </dl>
              <div className="mt-5 rounded-xl border border-white/8 bg-white/[.025] p-3.5">
                <p className="text-xs leading-5 text-white/75">
                  I set these numbers to match the model, and the score adds up from them. Pick one of Kidneys A
                  to E for scores the pipeline computed, or make your own kidney from an outline.
                </p>
              </div>
            </>
          )
        ) : null}

        {tab === 'plan' ? (
          <>
            <p className="section-label">Kidney kept</p>
            {activeCase && n ? (
              <div className="mt-3 rounded-xl border border-white/8 bg-black/10 p-3.5">
                <p className="text-[11px] uppercase tracking-[.1em] text-white/66">Kept at a 5 mm margin</p>
                <p className="mt-1 font-mono text-xl text-white/90">{percent(n.preservedFraction)}</p>
                <div className="mt-3 h-1 overflow-hidden rounded-full bg-white/6">
                  <div
                    className="h-full rounded-full bg-emerald-300/70"
                    style={{ width: `${Math.round(n.preservedFraction * 100)}%` }}
                  />
                </div>
                <p className="mt-3 text-xs leading-5 text-white/75">
                  The share of this kidney outside a uniform 5 mm band round the tumour, from renalplan. Real
                  partial nephrectomies usually lose more, through the renorrhaphy and devascularised tissue, so
                  expect the real figure to be lower.
                </p>
                <p className="mt-2 text-xs leading-5 text-white/75">
                  The pipeline only ran a 5 mm margin, so there’s no margin slider for this kidney.
                </p>
              </div>
            ) : (
              <div className="mt-3 rounded-xl border border-white/8 bg-black/10 p-3.5">
                <div className="flex items-center justify-between">
                  <label htmlFor="margin-panel" className="control-label">Margin</label>
                  <span className="font-mono text-xs text-emerald-100/85">{marginMm} mm</span>
                </div>
                <input
                  id="margin-panel"
                  type="range"
                  min="1"
                  max="10"
                  value={marginMm}
                  onChange={(event) => setMarginMm(Number(event.target.value))}
                  className="range-control mt-2 w-full"
                />
                <p className="mt-3 text-xs leading-5 text-white/75">
                  The slider redraws the shell round the tumour, to scale. The teaching kidney has no volume
                  calculation, so there’s no kept-kidney figure for it.
                </p>
              </div>
            )}
            <ApproachNotes />
          </>
        ) : null}

        {tab === 'limits' ? (
          <>
            <p className="section-label">What this can’t tell you</p>
            <ul className="viewer-limits mt-3">
              {(activeCase
                ? [
                    'There are no vessels or collecting system in this model, because KiTS doesn’t outline them. So it says nothing about clamping or how close the calyces are.',
                    'Nobody has compared these scores with clinicians’ own scoring yet. That’s the first study I’d like to do.',
                    'It can’t export a plan.',
                  ]
                : [
                    'Everything in it, including the measurements, is made up to teach with.',
                    'The vessels and collecting system are drawn by hand, not taken from a scan.',
                    'It can’t export a plan.',
                  ]
              ).map((item) => (
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

function TrainingPanel({
  step,
  setStep,
  answers,
  setAnswers,
}: {
  step: number;
  setStep: (value: number) => void;
  answers: Record<number, number>;
  setAnswers: Dispatch<SetStateAction<Record<number, number>>>;
}) {
  const lesson = trainingSteps[step];
  const selected = answers[step];
  const answered = selected !== undefined;
  const lastStep = step === trainingSteps.length - 1;
  const score = Object.entries(answers).filter(([index, value]) => trainingSteps[Number(index)].correct === value).length;
  const questionRef = useRef<HTMLParagraphElement>(null);

  // The button just pressed can end up disabled or removed on the new step,
  // which drops focus. Move it to the new question once React has drawn it.
  const goToStep = (next: number) => {
    setStep(next);
    requestAnimationFrame(() => questionRef.current?.focus());
  };

  return (
    <aside className="workspace-sidebar right-sidebar" id="lesson-panel">
      <div className="flex items-center justify-between">
        <p className="section-label">The lesson</p>
        <span className="font-mono text-xs text-white/66">
          {step + 1} of {trainingSteps.length}
        </span>
      </div>
      <h2 className="mt-3 text-lg font-semibold tracking-tight text-white/90">{lesson.title}</h2>
      <p className="mt-2 text-xs leading-5 text-white/75">{lesson.instruction}</p>

      <div className="mt-5 border-t border-white/8 pt-5">
        <p id="lesson-question" ref={questionRef} tabIndex={-1} className="text-sm font-medium leading-5 text-white/88 outline-none">
          {lesson.question}
        </p>
        <fieldset className="mt-3 min-w-0 space-y-2" aria-labelledby="lesson-question">
          {lesson.options.map((option, index) => {
            const isSelected = selected === index;
            const isCorrect = answered && index === lesson.correct;
            const isWrong = answered && isSelected && index !== lesson.correct;
            return (
              <button
                key={option}
                type="button"
                // aria-disabled, not disabled, so focus stays on the button after answering.
                aria-disabled={answered}
                aria-pressed={isSelected}
                onClick={() => {
                  if (!answered) setAnswers((current) => ({ ...current, [step]: index }));
                }}
                className={`answer-option ${isCorrect ? 'answer-correct' : ''} ${isWrong ? 'answer-wrong' : ''}`}
              >
                <span className="grid size-5 shrink-0 place-items-center rounded-full border border-white/15 font-mono text-[11px]">
                  {isCorrect ? <Check className="size-3" aria-hidden="true" /> : String.fromCharCode(65 + index)}
                </span>
                <span>{option}</span>
              </button>
            );
          })}
        </fieldset>
      </div>

      {/* Always in the page, so screen readers announce the feedback when it's filled in. */}
      <output
        className={
          answered
            ? `mt-4 block rounded-xl border p-3.5 ${selected === lesson.correct ? 'border-emerald-200/10 bg-emerald-200/[.035]' : 'border-amber-200/10 bg-amber-200/[.03]'}`
            : 'sr-only'
        }
      >
        {answered ? (
          <>
            <span className="block text-xs font-semibold text-white/85">
              {selected === lesson.correct ? 'Right' : 'Not quite'}
            </span>
            <span className="mt-2 block text-xs leading-5 text-white/75">{lesson.rationale}</span>
          </>
        ) : null}
      </output>

      <div className="mt-5 flex gap-2">
        <Button
          className="border-white/10 bg-white/[.035] text-white/80 hover:bg-white/8 hover:text-white"
          variant="outline"
          disabled={step === 0}
          onClick={() => goToStep(Math.max(0, step - 1))}
        >
          Previous
        </Button>
        {lastStep ? null : (
          <Button
            className="flex-1 bg-sky-300 text-[#061b1c] hover:bg-sky-200"
            disabled={!answered}
            onClick={() => goToStep(step + 1)}
          >
            Next question <ArrowRight />
          </Button>
        )}
      </div>

      <p className="mt-4 text-[11px] text-white/62">{`Score so far: ${score} of ${Object.keys(answers).length} answered`}</p>

      {lastStep && answered ? (
        <div className="mt-4 rounded-xl border border-white/8 bg-white/[.025] p-3.5">
          <p className="text-xs leading-5 text-white/80">
            {`You got ${score} of ${trainingSteps.length}. If a question is wrong or too easy, tell me.`}
          </p>
          <Button
            className="mt-3 w-full text-white/75 hover:bg-white/5 hover:text-white"
            variant="ghost"
            onClick={() => {
              setAnswers({});
              goToStep(0);
            }}
          >
            <RotateCcw /> Start again
          </Button>
        </div>
      ) : null}
    </aside>
  );
}

function DisclaimerDialog({ onClose }: { onClose: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    const previousFocus = document.activeElement as HTMLElement | null;
    if (!dialog) return undefined;
    dialog.showModal();

    return () => {
      if (dialog.open) dialog.close();
      previousFocus?.focus();
    };
  }, []);

  return (
    <dialog
      ref={dialogRef}
      className="disclaimer-dialog"
      aria-labelledby="disclaimer-title"
      aria-describedby="disclaimer-description"
      aria-modal="true"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          onClose();
        }
      }}
    >
      <div>
        <div className="flex items-start justify-between gap-5">
          <div className="grid size-10 place-items-center rounded-xl border border-amber-200/10 bg-amber-200/[.04] text-amber-200/80">
            <ShieldAlert className="size-5" aria-hidden="true" />
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Close">
            <X className="size-4" />
          </button>
        </div>
        <p className="mt-5 text-xs font-semibold text-amber-100/85">Research and teaching prototype</p>
        <h2 id="disclaimer-title" className="mt-2 text-2xl font-semibold tracking-[-.03em] text-white/92">
          Not for patient care
        </h2>
        <div id="disclaimer-description">
          <p className="mt-4 text-sm leading-6 text-white/78">
            This hasn’t been clinically validated and it isn’t a medical device. It has no UKCA or CE mark and
            isn’t FDA cleared. Don’t use it to diagnose, plan or guide treatment for a real patient. The anatomy
            and the numbers may be incomplete or wrong.
          </p>
          <p className="mt-3 text-sm leading-6 text-white/78">
            It’s for teaching and research: the teaching kidney, the five de-identified KiTS23 kidneys A to E,
            and kidneys built in this tab from an outline you load. Those are built on your computer, and
            nothing is uploaded.
          </p>
        </div>
        <Button className="mt-6 w-full bg-emerald-300 text-[#052117] hover:bg-emerald-200" onClick={onClose}>
          OK
        </Button>
      </div>
    </dialog>
  );
}

/**
 * Keep the viewer's mode in this history entry, so Back, Forward and reload
 * reopen the screen the reader left. The overview reads it back.
 */
function rememberMode(mode: WorkspaceMode, hash?: string) {
  if (!window.location.hash.startsWith('#workspace')) return;
  window.history.replaceState(
    { ...(window.history.state as Record<string, unknown> | null), mode },
    '',
    hash ?? window.location.hash,
  );
}

function knownCaseId(id: string | undefined) {
  return id && referenceCases.some((item) => item.id === id) ? id : TEACHING_CASE_ID;
}

function caseHash(id: string) {
  return id === TEACHING_CASE_ID ? '#workspace' : `#workspace/${id}`;
}

export function RenalPlatform({
  onExit,
  initialMode = 'plan',
  initialCaseId = TEACHING_CASE_ID,
  startWithSample = false,
}: {
  onExit?: () => void;
  initialMode?: WorkspaceMode;
  /** 'synthetic' for the teaching kidney, or a KiTS23 kidney id such as 'reference-a'. */
  initialCaseId?: string;
  /** Build the synthetic sample as soon as the builder opens. */
  startWithSample?: boolean;
}) {
  const [mode, setMode] = useState<WorkspaceMode>(initialMode);
  const [layers, setLayers] = useState<AnatomyLayers>(ALL_LAYERS);
  // The lesson always runs on the teaching kidney.
  const [caseId, setCaseId] = useState<string>(() =>
    initialMode === 'learn' ? TEACHING_CASE_ID : knownCaseId(initialCaseId),
  );
  const activeCase = useMemo(
    () => referenceCases.find((item) => item.id === caseId) ?? null,
    [caseId],
  );
  // Visibility is stored per case, so each case falls back to its own defaults
  // and remembers what you toggled if you come back to it.
  const [visibleByCase, setVisibleByCase] = useState<Record<string, Record<string, boolean>>>({});
  const referenceVisible = useMemo(() => {
    if (!activeCase) return {};
    const defaults = Object.fromEntries(
      activeCase.structures.map((structure) => [structure.name, structure.visible]),
    );
    return { ...defaults, ...visibleByCase[activeCase.id] };
  }, [activeCase, visibleByCase]);
  const setReferenceVisible = useCallback(
    (name: string, value?: boolean) => {
      if (!activeCase) return;
      setVisibleByCase((current) => {
        const defaults = Object.fromEntries(
          activeCase.structures.map((structure) => [structure.name, structure.visible]),
        );
        const now = { ...defaults, ...current[activeCase.id] };
        return { ...current, [activeCase.id]: { ...now, [name]: value ?? !now[name] } };
      });
    },
    [activeCase],
  );

  const [kidneyOpacity, setKidneyOpacity] = useState(72);
  const [marginMm, setMarginMm] = useState(5);
  const [clipPercent, setClipPercent] = useState(0);
  const [preset, setPreset] = useState<ViewPreset>('anterior');
  const [viewNonce, setViewNonce] = useState(0);
  const [resetNonce, setResetNonce] = useState(0);
  const [handRotated, setHandRotated] = useState(false);
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>('scores');
  const [builtTab, setBuiltTab] = useState<InspectorTab>('scores');
  const [trainingStep, setTrainingStep] = useState(0);
  const [answers, setAnswers] = useState<Record<number, number>>({});
  const [showDisclaimer, setShowDisclaimer] = useState(false);
  const [zoomRequest, setZoomRequest] = useState<ZoomRequest>(NO_ZOOM);
  const shellRef = useRef<HTMLDivElement>(null);

  // The builder. Its kidney lives in this component's memory and the worker's, nowhere else.
  const builder = useKidneyBuilder();
  const { output: builtOutput, buildCount } = builder.state;
  const [builtOverrides, setBuiltOverrides] = useState<{ build: number; values: Record<string, boolean> }>({
    build: -1,
    values: {},
  });
  const builtCase = useMemo(() => (builtOutput ? sceneCaseFor(builtOutput, buildCount) : null), [builtOutput, buildCount]);
  const builtVisible = useMemo(() => {
    const defaults = Object.fromEntries((builtOutput?.meshes ?? []).map((mesh) => [mesh.name, mesh.visible]));
    return builtOverrides.build === buildCount ? { ...defaults, ...builtOverrides.values } : defaults;
  }, [builtOutput, buildCount, builtOverrides]);
  const toggleBuiltLayer = useCallback(
    (name: string) => {
      setBuiltOverrides((current) => {
        const values = current.build === buildCount ? current.values : {};
        const now = name in values ? values[name] : builtVisible[name] !== false;
        return { build: buildCount, values: { ...values, [name]: !now } };
      });
    },
    [buildCount, builtVisible],
  );

  useEffect(() => {
    // The button that opened the viewer has gone, so start keyboard and screen reader users here.
    shellRef.current?.focus({ preventScroll: true });
  }, []);

  // "Try the sample" on the overview opens the builder and starts it straight away.
  const sampleStarted = useRef(false);
  const { buildSample } = builder;
  useEffect(() => {
    if (!startWithSample || initialMode !== 'build' || sampleStarted.current) return undefined;
    // Marked inside the frame: StrictMode cancels the first frame and runs the effect again.
    const frame = requestAnimationFrame(() => {
      sampleStarted.current = true;
      buildSample(5);
    });
    return () => cancelAnimationFrame(frame);
  }, [startWithSample, initialMode, buildSample]);

  // A new margin re-runs only the margin step in the worker, after the slider settles.
  const builtMargin = builtOutput?.report.planning?.marginMm;
  const { setMargin } = builder;
  useEffect(() => {
    if (builtMargin === undefined || builtMargin === marginMm) return undefined;
    const timer = window.setTimeout(() => setMargin(marginMm), 180);
    return () => window.clearTimeout(timer);
  }, [builtMargin, marginMm, setMargin]);

  // When a kidney arrives the controls that started it may have gone. Carry on from the model.
  useEffect(() => {
    if (buildCount === 0) return;
    const active = document.activeElement;
    if (!active || active === document.body || !document.contains(active)) {
      document.getElementById('model-workspace')?.focus({ preventScroll: true });
    }
  }, [buildCount]);

  const choosePreset = useCallback((next: ViewPreset) => {
    setPreset(next);
    setViewNonce((value) => value + 1);
    setHandRotated(false);
  }, []);

  const resetView = useCallback(() => {
    setPreset('anterior');
    setResetNonce((value) => value + 1);
    setHandRotated(false);
  }, []);

  const onUserRotate = useCallback(() => setHandRotated(true), []);

  const zoom = useCallback((direction: 1 | -1) => {
    setZoomRequest((current) => ({ nonce: current.nonce + 1, direction }));
  }, []);

  const chooseCase = useCallback((id: string) => {
    setCaseId(id);
    // The new scene starts in the selected view, so the axes are right again.
    setHandRotated(false);
    // Keep the address in step, so a reload or a shared link opens the same kidney.
    // replaceState keeps history.state (the overview's close button needs it) and
    // fires no hashchange.
    const hash = caseHash(id);
    if (window.location.hash.startsWith('#workspace') && window.location.hash !== hash) {
      window.history.replaceState(window.history.state, '', hash);
    }
  }, []);

  const changeMode = (next: WorkspaceMode) => {
    rememberMode(next, next === 'build' ? BUILD_HASH : caseHash(next === 'learn' ? TEACHING_CASE_ID : caseId));
    if (next === 'learn') {
      // The lesson needs the teaching kidney's vessels and collecting system.
      chooseCase(TEACHING_CASE_ID);
      setLayers(ALL_LAYERS);
    }
    setHandRotated(false);
    setMode(next);
  };

  const building = mode === 'build';
  const announcement =
    building && builder.state.status !== 'idle' && builder.state.status !== 'error' ? builder.state.message : '';

  return (
    <div ref={shellRef} tabIndex={-1} className="app-shell" id="workspace-top">
      <header className="app-header">
        <div className="flex min-w-0 items-center gap-3">
          <button
            type="button"
            className="brand-mark"
            onClick={onExit}
            aria-label={onExit ? 'Back to the CalyxView Renal overview' : 'CalyxView Renal'}
          >
            {onExit ? <ArrowLeft className="size-4" /> : <Activity className="size-4" />}
          </button>
          <div className="min-w-0">
            <div className="flex items-baseline gap-2">
              <span className="truncate text-sm font-semibold tracking-[-.025em] text-white/92 sm:text-base">
                CalyxView Renal
              </span>
              <span className="shrink-0 text-[11px] font-medium uppercase tracking-[.12em] text-emerald-200/85">
                3D viewer
              </span>
            </div>
            <p className="hidden text-xs text-white/66 sm:block">Partial nephrectomy research prototype</p>
          </div>
        </div>

        <nav className="mode-nav" aria-label="Viewer modes">
          <ModeButton active={building} icon={<Wand2 className="size-3.5" />} label="Make a 3D kidney" onClick={() => changeMode('build')} />
          <ModeButton active={mode === 'plan'} icon={<Box className="size-3.5" />} label="Kidneys" onClick={() => changeMode('plan')} />
          <ModeButton active={mode === 'learn'} icon={<BookOpen className="size-3.5" />} label="Lesson" onClick={() => changeMode('learn')} />
        </nav>

        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={() => setShowDisclaimer(true)}
            className="research-chip"
            aria-label="Research and teaching info: what this prototype is and isn’t for"
          >
            <ShieldAlert className="size-3.5" aria-hidden="true" />
            <span className="hidden sm:inline">Research and teaching</span>
            <span className="sm:hidden">Info</span>
          </button>
          {onExit ? (
            <button
              type="button"
              className="case-switcher overview-return"
              onClick={onExit}
              aria-label="Back to the overview"
            >
              <ArrowLeft className="size-3" aria-hidden="true" />
              <span className="hidden sm:inline">Overview</span>
            </button>
          ) : null}
        </div>
      </header>

      <div className="safety-ribbon" role="note">
        <span className="font-semibold">Research and teaching prototype. Not for patient care.</span>
        <button type="button" onClick={() => setShowDisclaimer(true)}>Details</button>
      </div>

      <main className="workspace-grid">
        {building ? (
          builtOutput ? (
            <BuiltSidebar
              builder={builder}
              output={builtOutput}
              visible={builtVisible}
              toggleLayer={toggleBuiltLayer}
              kidneyOpacity={kidneyOpacity}
              setKidneyOpacity={setKidneyOpacity}
              marginMm={marginMm}
              setMarginMm={setMarginMm}
            />
          ) : (
            <BuildStepsSidebar />
          )
        ) : (
          <CaseSidebar
            mode={mode}
            activeCase={activeCase}
            referenceVisible={referenceVisible}
            setReferenceVisible={setReferenceVisible}
            layers={layers}
            setLayers={setLayers}
            kidneyOpacity={kidneyOpacity}
            setKidneyOpacity={setKidneyOpacity}
            trainingStep={trainingStep}
            answers={answers}
          />
        )}

        {building && !builtOutput ? (
          <BuildIntro builder={builder} marginMm={marginMm} setMarginMm={setMarginMm} />
        ) : (
          <ModelWorkspace
            mode={mode}
            activeCase={activeCase}
            builtCase={builtCase}
            builtVisible={builtVisible}
            builtLine={builtOutput ? builtSummary(builtOutput) : ''}
            caseId={caseId}
            chooseCase={chooseCase}
            referenceVisible={referenceVisible}
            layers={layers}
            kidneyOpacity={kidneyOpacity}
            marginMm={marginMm}
            setMarginMm={setMarginMm}
            clipPercent={clipPercent}
            setClipPercent={setClipPercent}
            preset={preset}
            choosePreset={choosePreset}
            resetView={resetView}
            viewNonce={viewNonce}
            resetNonce={resetNonce}
            zoomRequest={zoomRequest}
            zoom={zoom}
            handRotated={handRotated}
            onUserRotate={onUserRotate}
            trainingStep={trainingStep}
          />
        )}

        {mode === 'plan' ? (
          <PlanningInspector
            tab={inspectorTab}
            setTab={setInspectorTab}
            activeCase={activeCase}
            marginMm={marginMm}
            setMarginMm={setMarginMm}
          />
        ) : building ? (
          builtOutput ? (
            <BuiltInspector output={builtOutput} tab={builtTab} setTab={setBuiltTab} />
          ) : (
            <BuildPrivacyPanel />
          )
        ) : (
          <TrainingPanel step={trainingStep} setStep={setTrainingStep} answers={answers} setAnswers={setAnswers} />
        )}
      </main>

      {/* Always in the page, so screen readers hear each step of a build. */}
      <output className="sr-only" aria-live="polite">
        {announcement}
      </output>

      {showDisclaimer ? <DisclaimerDialog onClose={() => setShowDisclaimer(false)} /> : null}
    </div>
  );
}
