'use client';

import {
  Activity,
  AlertTriangle,
  ArrowRight,
  BarChart3,
  BookOpen,
  Box,
  Check,
  ChevronDown,
  Circle,
  CircleCheck,
  ClipboardCheck,
  Download,
  Eye,
  EyeOff,
  FileCheck,
  FileStack,
  FileUp,
  Focus,
  GraduationCap,
  Info,
  Layers3,
  LoaderCircle,
  LockKeyhole,
  MousePointer2,
  RotateCcw,
  ScanLine,
  ShieldAlert,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Target,
  Trash2,
  UploadCloud,
  X,
} from 'lucide-react';
import {
  useMemo,
  useRef,
  useState,
  lazy,
  Suspense,
  type DragEvent,
  type ChangeEvent,
} from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type { AnatomyLayers, ViewPreset } from '@/components/kidney-scene';
import {
  PROTOTYPE_STAGES,
  createLocalStudyManifest,
  type LocalStudyManifest,
} from '@/lib/prototype-pipeline';

type WorkspaceMode = 'plan' | 'import' | 'learn';
type InspectorTab = 'source' | 'anatomy' | 'plan' | 'qa';

const KidneyScene = lazy(() =>
  import('@/components/kidney-scene').then((module) => ({
    default: module.KidneyScene,
  })),
);

const layerConfig: Array<{
  key: keyof AnatomyLayers;
  label: string;
  provenance: 'Source' | 'Derived' | 'Simulated';
  color: string;
}> = [
  { key: 'kidney', label: 'Kidney parenchyma', provenance: 'Simulated', color: '#72c9a5' },
  { key: 'tumour', label: 'Renal mass', provenance: 'Simulated', color: '#ef7d69' },
  { key: 'arteries', label: 'Arterial tree', provenance: 'Simulated', color: '#ffb45e' },
  { key: 'veins', label: 'Venous tree', provenance: 'Simulated', color: '#76bff0' },
  { key: 'collecting', label: 'Collecting system', provenance: 'Simulated', color: '#9bded7' },
];

const trainingSteps = [
  {
    title: 'Orient the kidney',
    short: 'Orientation',
    instruction: 'Use the view presets and the hilum to establish anterior, posterior and lateral orientation.',
    question: 'Which landmark best identifies the medial renal border in this synthetic model?',
    options: ['The tumour capsule', 'The vascular hilum', 'The upper pole', 'The resection margin'],
    correct: 1,
    rationale:
      'The renal vessels and collecting system converge at the hilum on the medial border. Orientation comes before interpreting tumour relationships.',
  },
  {
    title: 'Localise the mass',
    short: 'Tumour',
    instruction: 'Rotate the model and isolate the coral lesion. Judge polarity and surface involvement.',
    question: 'How is the synthetic lesion best described?',
    options: ['Upper-pole hilar', 'Lower-pole central', 'Interpolar lateral', 'Medial lower-pole'],
    correct: 2,
    rationale:
      'The model places the lesion on the lateral interpolar surface. This is an illustrative anatomy label, not a patient-specific interpretation.',
  },
  {
    title: 'Trace the blood supply',
    short: 'Vessels',
    instruction: 'Ghost the kidney and follow the amber branch towards the lesion.',
    question: 'Which control would support a selective-clamp discussion in a future validated system?',
    options: ['Tumour diameter alone', 'Segmental arterial branch mapping', 'Kidney opacity only', 'Collecting-system colour'],
    correct: 1,
    rationale:
      'A reviewed, patient-specific arterial tree could support branch-level planning. The branch shown here is synthetic and cannot guide a real operation.',
  },
  {
    title: 'Inspect the collecting system',
    short: 'Collecting system',
    instruction: 'Keep the pale-blue system visible and examine its proximity to the planned margin.',
    question: 'Why must this relationship be reviewed before finalising a resection plan?',
    options: ['It sets CT window width', 'It indicates patient age', 'It may affect entry/repair considerations', 'It determines scan anonymisation'],
    correct: 2,
    rationale:
      'Collecting-system proximity may affect surgical considerations, but only verified clinical imaging and qualified judgement can establish that relationship.',
  },
  {
    title: 'Build an illustrative plan',
    short: 'Plan',
    instruction: 'Choose an approach, explore a margin and review all unverified assumptions.',
    question: 'What is the correct status of the plan generated in this prototype?',
    options: ['Clinically approved', 'Ready for theatre', 'Educational simulation only', 'Radiologist verified'],
    correct: 2,
    rationale:
      'Every structure, measurement and planning control in this demo is simulated. It must never be used for patient care.',
  },
];

function formatBytes(value: number) {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  if (value < 1024 * 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} MB`;
  return `${(value / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function ModeButton({
  active,
  icon,
  label,
  onClick,
}: {
  active: boolean;
  icon: React.ReactNode;
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
          : 'text-white/46 hover:bg-white/5 hover:text-white/72'
      }`}
    >
      {icon}
      {label}
    </button>
  );
}

function LayerButton({
  active,
  color,
  label,
  provenance,
  onClick,
}: {
  active: boolean;
  color: string;
  label: string;
  provenance: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`group flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left transition ${
        active ? 'bg-white/[.045]' : 'opacity-45 hover:opacity-75'
      }`}
    >
      <span className="grid size-5 shrink-0 place-items-center rounded-md border border-white/10 bg-black/10">
        {active ? <Eye className="size-3 text-white/72" /> : <EyeOff className="size-3 text-white/42" />}
      </span>
      <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: color }} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-xs text-white/70">{label}</span>
        <span className="block text-[9px] uppercase tracking-[.12em] text-white/25">{provenance}</span>
      </span>
    </button>
  );
}

function Metric({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail?: string;
}) {
  return (
    <div className="metric-card">
      <p className="text-[9px] font-semibold uppercase tracking-[.13em] text-white/30">{label}</p>
      <p className="mt-1.5 font-mono text-[15px] text-white/82">{value}</p>
      {detail ? <p className="mt-1 text-[10px] text-white/30">{detail}</p> : null}
    </div>
  );
}

function CaseSidebar({
  mode,
  layers,
  setLayers,
  kidneyOpacity,
  setKidneyOpacity,
  trainingStep,
  answers,
  importedManifest,
}: {
  mode: WorkspaceMode;
  layers: AnatomyLayers;
  setLayers: React.Dispatch<React.SetStateAction<AnatomyLayers>>;
  kidneyOpacity: number;
  setKidneyOpacity: (value: number) => void;
  trainingStep: number;
  answers: Record<number, number>;
  importedManifest: LocalStudyManifest | null;
}) {
  if (mode === 'import') {
    return (
      <aside className="workspace-sidebar left-sidebar">
        <p className="section-label">Safe intake path</p>
        <h1 className="mt-2 text-lg font-semibold tracking-tight text-white/90">Local DICOM preflight</h1>
        <p className="mt-2 text-xs leading-5 text-white/40">
          A transparent prototype flow that never uploads, stores or segments selected files.
        </p>

        <ol className="mt-6 space-y-1" aria-label="Prototype intake stages">
          {PROTOTYPE_STAGES.map((stage, index) => (
            <li key={stage.id} className="flex gap-3 rounded-lg px-2 py-2.5">
              <span className="grid size-5 shrink-0 place-items-center rounded-full border border-white/10 bg-white/[.035] font-mono text-[9px] text-white/48">
                {index + 1}
              </span>
              <div>
                <p className="text-xs text-white/66">{stage.label}</p>
                <p className="mt-1 text-[10px] leading-4 text-white/28">
                  {index < 3 ? 'Local demonstration' : 'Synthetic output'}
                </p>
              </div>
            </li>
          ))}
        </ol>

        <div className="mt-5 border-t border-white/8 pt-5">
          <div className="flex items-center gap-2 text-xs text-emerald-100/80">
            <LockKeyhole className="size-3.5" />
            Zero-transfer prototype
          </div>
          <p className="mt-2 text-[10px] leading-4 text-white/34">
            {importedManifest
              ? `${importedManifest.fileCount} file handles were counted locally; names and contents were not retained.`
              : 'No file content is read, transmitted or retained by this site.'}
          </p>
        </div>
      </aside>
    );
  }

  if (mode === 'learn') {
    const completed = Object.keys(answers).length;
    return (
      <aside className="workspace-sidebar left-sidebar">
        <div className="flex items-center justify-between">
          <p className="section-label">Guided module</p>
          <Badge className="border-sky-300/12 bg-sky-300/8 text-sky-100/70" variant="outline">
            Foundations
          </Badge>
        </div>
        <h1 className="mt-2 text-lg font-semibold tracking-tight text-white/90">Renal mass orientation</h1>
        <p className="mt-2 text-xs leading-5 text-white/40">Five steps • Synthetic case • Session only</p>

        <div className="mt-5 h-1.5 overflow-hidden rounded-full bg-white/6">
          <div
            className="h-full rounded-full bg-sky-300 transition-[width] duration-500"
            style={{ width: `${(completed / trainingSteps.length) * 100}%` }}
          />
        </div>
        <p className="mt-2 text-[10px] text-white/30">{completed} of {trainingSteps.length} checks answered</p>

        <ol className="mt-5 space-y-1">
          {trainingSteps.map((step, index) => {
            const answered = answers[index] !== undefined;
            const current = index === trainingStep;
            return (
              <li
                key={step.title}
                className={`flex items-center gap-3 rounded-lg px-2.5 py-2.5 ${current ? 'bg-white/6' : ''}`}
              >
                <span
                  className={`grid size-5 place-items-center rounded-full border ${
                    answered
                      ? 'border-emerald-300/25 bg-emerald-300/12 text-emerald-200'
                      : current
                        ? 'border-sky-300/30 bg-sky-300/10 text-sky-200'
                        : 'border-white/10 text-white/25'
                  }`}
                >
                  {answered ? <Check className="size-3" /> : <span className="font-mono text-[9px]">{index + 1}</span>}
                </span>
                <span className={`text-xs ${current ? 'text-white/80' : 'text-white/42'}`}>{step.short}</span>
              </li>
            );
          })}
        </ol>

        <div className="mt-5 rounded-xl border border-sky-200/10 bg-sky-200/[.035] p-3.5">
          <div className="flex items-center gap-2 text-xs text-sky-100/78">
            <GraduationCap className="size-3.5" />
            Training boundary
          </div>
          <p className="mt-2 text-[10px] leading-4 text-white/36">
            General education only. This does not replace supervised surgical training, credentialing or local protocols.
          </p>
        </div>
      </aside>
    );
  }

  return (
    <aside className="workspace-sidebar left-sidebar">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="section-label">Case workspace</p>
          <h1 className="mt-2 text-lg font-semibold tracking-tight text-white/90">Left renal mass</h1>
          <p className="mt-1 text-xs text-white/38">CVR-SYN-001 • Synthetic adult anatomy</p>
        </div>
        <span className="status-dot" title="Synthetic case ready" />
      </div>

      <div className="mt-5 grid grid-cols-2 gap-2">
        <Metric label="Laterality" value="LEFT" />
        <Metric label="Complexity" value="MOD" />
      </div>

      <div className="mt-4 rounded-xl border border-emerald-200/10 bg-emerald-200/[.035] p-3.5">
        <div className="flex items-center gap-2 text-xs text-emerald-100/80">
          <ShieldCheck className="size-3.5" />
          Provenance explicit
        </div>
        <p className="mt-2 text-[10px] leading-4 text-white/34">
          Built-in procedural teaching model. No patient scan and no AI segmentation.
        </p>
      </div>

      <div className="mt-6 flex items-center justify-between">
        <p className="section-label">Anatomy layers</p>
        <Layers3 className="size-3.5 text-white/30" />
      </div>
      <div className="mt-2 space-y-0.5">
        {layerConfig.map((layer) => (
          <LayerButton
            key={layer.key}
            active={layers[layer.key]}
            color={layer.color}
            label={layer.label}
            provenance={layer.provenance}
            onClick={() => setLayers((current) => ({ ...current, [layer.key]: !current[layer.key] }))}
          />
        ))}
      </div>

      <div className="mt-5 border-t border-white/8 pt-5">
        <div className="flex items-center justify-between text-[10px] text-white/42">
          <label htmlFor="kidney-opacity">Kidney opacity</label>
          <span className="font-mono text-white/56">{kidneyOpacity}%</span>
        </div>
        <input
          id="kidney-opacity"
          className="range-control mt-3 w-full"
          type="range"
          min="18"
          max="100"
          value={kidneyOpacity}
          onChange={(event) => setKidneyOpacity(Number(event.target.value))}
        />
        <div className="mt-3 flex gap-2">
          <Button
            className="flex-1 border-white/10 bg-white/[.035] text-white/60 hover:bg-white/8 hover:text-white"
            size="sm"
            variant="outline"
            onClick={() => setKidneyOpacity(34)}
          >
            <Sparkles /> Ghost
          </Button>
          <Button
            className="flex-1 border-white/10 bg-white/[.035] text-white/60 hover:bg-white/8 hover:text-white"
            size="sm"
            variant="outline"
            onClick={() => setLayers({ kidney: false, tumour: true, arteries: true, veins: true, collecting: true })}
          >
            <Focus /> Isolate
          </Button>
        </div>
      </div>
    </aside>
  );
}

function ViewToolbar({
  preset,
  setPreset,
  onSnapshot,
}: {
  preset: ViewPreset;
  setPreset: (preset: ViewPreset) => void;
  onSnapshot: () => void;
}) {
  return (
    <div className="viewer-toolbar">
      <fieldset className="flex items-center gap-1" aria-label="Anatomy view presets">
        {(['anterior', 'posterior', 'lateral', 'superior'] as ViewPreset[]).map((item) => (
          <button
            key={item}
            type="button"
            onClick={() => setPreset(item)}
            aria-pressed={preset === item}
            className={`view-button ${preset === item ? 'view-button-active' : ''}`}
          >
            {item.slice(0, 3).toUpperCase()}
          </button>
        ))}
      </fieldset>
      <div className="ml-1 h-5 w-px bg-white/8" />
      <button type="button" className="icon-button" onClick={() => setPreset('anterior')} aria-label="Reset anatomy view">
        <RotateCcw className="size-3.5" />
      </button>
      <button type="button" className="icon-button" onClick={onSnapshot} aria-label="Download plan snapshot">
        <Download className="size-3.5" />
      </button>
    </div>
  );
}

function ModelWorkspace({
  mode,
  layers,
  kidneyOpacity,
  marginMm,
  setMarginMm,
  clipPercent,
  setClipPercent,
  preset,
  setPreset,
  trainingStep,
}: {
  mode: WorkspaceMode;
  layers: AnatomyLayers;
  kidneyOpacity: number;
  marginMm: number;
  setMarginMm: (value: number) => void;
  clipPercent: number;
  setClipPercent: (value: number) => void;
  preset: ViewPreset;
  setPreset: (value: ViewPreset) => void;
  trainingStep: number;
}) {
  const snapshot = () => {
    const canvas = document.getElementById('renal-3d-canvas') as HTMLCanvasElement | null;
    if (!canvas) return;
    const anchor = document.createElement('a');
    anchor.href = canvas.toDataURL('image/png');
    anchor.download = 'calyxview-renal-synthetic-plan.png';
    anchor.click();
  };

  return (
    <section className="model-workspace" aria-label="Interactive synthetic kidney model">
      <div className="viewer-topbar">
        <div className="flex items-center gap-2 text-xs text-white/52">
          <Box className="size-3.5" />
          Interactive anatomy
          <Badge className="border-emerald-200/10 bg-emerald-200/[.045] text-[9px] uppercase tracking-[.1em] text-emerald-100/65" variant="outline">
            Synthetic
          </Badge>
        </div>
        <div className="hidden items-center gap-2 text-[10px] text-white/32 sm:flex">
          <MousePointer2 className="size-3" />
          Drag to rotate • Scroll to zoom
        </div>
      </div>

      <div className="volume-grid relative min-h-0 flex-1 overflow-hidden">
        <Suspense
          fallback={
            <div className="grid h-full min-h-[360px] place-items-center text-center text-xs text-white/34">
              Preparing the synthetic anatomy…
            </div>
          }
        >
          <KidneyScene
            layers={layers}
            kidneyOpacity={kidneyOpacity}
            marginMm={marginMm}
            clipPercent={clipPercent}
            preset={preset}
            trainingStep={mode === 'learn' ? trainingStep : -1}
          />
        </Suspense>

        <ViewToolbar preset={preset} setPreset={setPreset} onSnapshot={snapshot} />

        <div className="absolute left-4 top-4 flex flex-col gap-1.5">
          <div className="viewer-chip">
            <span className="size-1.5 rounded-full bg-emerald-300" />
            SIMULATED OUTPUT
          </div>
          <div className="viewer-chip text-white/35">
            <LockKeyhole className="size-3" />
            No patient data
          </div>
        </div>

        {mode === 'learn' ? (
          <output className="training-hotspot">
            <span className="hotspot-pulse" />
            <div>
              <p className="text-[9px] font-semibold uppercase tracking-[.12em] text-sky-200/70">Step {trainingStep + 1}</p>
              <p className="mt-0.5 text-xs text-white/78">{trainingSteps[trainingStep].short} focus</p>
            </div>
          </output>
        ) : null}

        <div className="orientation-axis" aria-hidden="true">
          <span className="axis-y">S</span>
          <span className="axis-x">L</span>
          <span className="axis-z">A</span>
          <span className="axis-core" />
        </div>

        <div className="viewer-controls">
          <div className="flex items-center gap-2">
            <SlidersHorizontal className="size-3.5 text-white/42" />
            <label htmlFor="clip-plane" className="text-[10px] text-white/46">Cutaway</label>
          </div>
          <input
            id="clip-plane"
            type="range"
            min="0"
            max="100"
            value={clipPercent}
            onChange={(event) => setClipPercent(Number(event.target.value))}
            className="range-control w-28 sm:w-36"
          />
          <span className="w-8 text-right font-mono text-[10px] text-white/48">{clipPercent}%</span>
          <div className="mx-1 h-4 w-px bg-white/8" />
          <label htmlFor="margin-inline" className="text-[10px] text-white/46">Margin</label>
          <input
            id="margin-inline"
            type="range"
            min="1"
            max="10"
            value={marginMm}
            onChange={(event) => setMarginMm(Number(event.target.value))}
            className="range-control w-20"
          />
          <span className="w-9 text-right font-mono text-[10px] text-white/48">{marginMm} mm</span>
        </div>
      </div>

      <div className="viewer-statusbar">
        <p>
          <strong>Research & education prototype.</strong> Anatomy, measurements and planning controls are illustrative and may be wrong.
        </p>
        <span className="hidden font-mono text-[9px] text-white/24 sm:inline">CVR/SYN/001 · WEBGL</span>
      </div>
    </section>
  );
}

function PlanningInspector({
  tab,
  setTab,
  marginMm,
  setMarginMm,
  approach,
  setApproach,
  clamp,
  setClamp,
}: {
  tab: InspectorTab;
  setTab: (tab: InspectorTab) => void;
  marginMm: number;
  setMarginMm: (value: number) => void;
  approach: 'transperitoneal' | 'retroperitoneal';
  setApproach: (value: 'transperitoneal' | 'retroperitoneal') => void;
  clamp: 'selective' | 'main' | 'none';
  setClamp: (value: 'selective' | 'main' | 'none') => void;
}) {
  const illustrativeResidual = Math.max(71, 90.2 - marginMm * 0.86).toFixed(1);
  const tabs: InspectorTab[] = ['source', 'anatomy', 'plan', 'qa'];

  return (
    <aside className="workspace-sidebar right-sidebar">
      <div className="inspector-tabs" role="tablist" aria-label="Case inspector">
        {tabs.map((item) => (
          <button
            key={item}
            type="button"
            role="tab"
            aria-selected={tab === item}
            onClick={() => setTab(item)}
            className={tab === item ? 'inspector-tab-active' : ''}
          >
            {item}
          </button>
        ))}
      </div>

      {tab === 'source' ? (
        <div className="inspector-content">
          <p className="section-label">Model provenance</p>
          <div className="mt-3 rounded-xl border border-emerald-200/10 bg-emerald-200/[.035] p-3.5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-xs text-white/72">
                <Sparkles className="size-3.5 text-emerald-200" />
                Procedural anatomy
              </div>
              <Badge className="bg-white/5 text-[9px] text-white/48" variant="outline">SIMULATED</Badge>
            </div>
            <p className="mt-3 text-[11px] leading-5 text-white/38">
              Generated in-browser from authored geometry. It is not reconstructed from CT and contains no patient information.
            </p>
          </div>

          <dl className="definition-list mt-5">
            <div><dt>Source</dt><dd>Synthetic case v1</dd></div>
            <div><dt>Imaging</dt><dd>None</dd></div>
            <div><dt>Segmentation</dt><dd>Not performed</dd></div>
            <div><dt>Clinical review</dt><dd>Not applicable</dd></div>
            <div><dt>Coordinate scale</dt><dd>Illustrative</dd></div>
          </dl>

          <div className="mt-5 border-t border-white/8 pt-5">
            <p className="section-label">Future source states</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {['Source CT', 'Model-derived', 'Human-corrected', 'Verified'].map((item) => (
                <span key={item} className="rounded-md border border-white/8 px-2 py-1 text-[9px] text-white/28">{item}</span>
              ))}
            </div>
            <p className="mt-3 text-[10px] leading-4 text-white/30">These states are shown for integration design only and are not active in the prototype.</p>
          </div>
        </div>
      ) : null}

      {tab === 'anatomy' ? (
        <div className="inspector-content">
          <p className="section-label">Illustrative measurements</p>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <Metric label="Tumour" value="2.8 cm" detail="Max diameter" />
            <Metric label="R.E.N.A.L." value="7a" detail="Illustrative" />
            <Metric label="Artery" value="4.2 mm" detail="Nearest branch" />
            <Metric label="Collecting" value="3.6 mm" detail="Nearest point" />
          </div>
          <div className="mt-5 rounded-xl border border-amber-200/10 bg-amber-200/[.03] p-3.5">
            <div className="flex items-center gap-2 text-xs text-amber-100/72">
              <Info className="size-3.5" />
              Example values only
            </div>
            <p className="mt-2 text-[10px] leading-4 text-white/34">
              These numbers are hard-coded to demonstrate layout. They are not calculated from geometry or imaging.
            </p>
          </div>
          <dl className="definition-list mt-5">
            <div><dt>Polarity</dt><dd>Interpolar</dd></div>
            <div><dt>Surface</dt><dd>Lateral</dd></div>
            <div><dt>Exophytic</dt><dd>~45% example</dd></div>
            <div><dt>Hilar contact</dt><dd>Not shown</dd></div>
          </dl>
        </div>
      ) : null}

      {tab === 'plan' ? (
        <div className="inspector-content">
          <p className="section-label">Illustrative planning controls</p>

          <fieldset className="mt-4">
            <legend className="control-label">Approach discussion</legend>
            <div className="segmented-control mt-2">
              {(['transperitoneal', 'retroperitoneal'] as const).map((item) => (
                <button key={item} type="button" aria-pressed={approach === item} onClick={() => setApproach(item)}>
                  {item === 'transperitoneal' ? 'Trans' : 'Retro'}
                </button>
              ))}
            </div>
          </fieldset>

          <fieldset className="mt-5">
            <legend className="control-label">Clamp scenario</legend>
            <div className="mt-2 grid grid-cols-3 gap-1.5">
              {(['selective', 'main', 'none'] as const).map((item) => (
                <button
                  key={item}
                  type="button"
                  aria-pressed={clamp === item}
                  onClick={() => setClamp(item)}
                  className={`choice-chip ${clamp === item ? 'choice-chip-active' : ''}`}
                >
                  {item}
                </button>
              ))}
            </div>
          </fieldset>

          <div className="mt-5 border-t border-white/8 pt-5">
            <div className="flex items-center justify-between">
              <label htmlFor="margin-panel" className="control-label">Exploration margin</label>
              <span className="font-mono text-xs text-emerald-100/72">{marginMm} mm</span>
            </div>
            <input
              id="margin-panel"
              type="range"
              min="1"
              max="10"
              value={marginMm}
              onChange={(event) => setMarginMm(Number(event.target.value))}
              className="range-control mt-3 w-full"
            />
            <div className="mt-4 rounded-xl border border-white/8 bg-black/10 p-3.5">
              <div className="flex items-end justify-between">
                <div>
                  <p className="text-[9px] uppercase tracking-[.12em] text-white/30">Residual volume</p>
                  <p className="mt-1 font-mono text-xl text-white/82">{illustrativeResidual}%</p>
                </div>
                <BarChart3 className="size-5 text-emerald-200/55" />
              </div>
              <div className="mt-3 h-1 overflow-hidden rounded-full bg-white/6">
                <div className="h-full rounded-full bg-emerald-300/70" style={{ width: `${illustrativeResidual}%` }} />
              </div>
              <p className="mt-2 text-[9px] text-white/25">Formula-driven illustration — not a volumetric calculation</p>
            </div>
          </div>

          <Button className="mt-5 w-full bg-emerald-300 text-[#052117] hover:bg-emerald-200" disabled>
            <ClipboardCheck /> Clinical sign-off unavailable
          </Button>
        </div>
      ) : null}

      {tab === 'qa' ? (
        <div className="inspector-content">
          <p className="section-label">Prototype quality gate</p>
          <div className="mt-4 space-y-2">
            {[
              ['Synthetic provenance visible', true],
              ['Research-use boundary visible', true],
              ['Layer state labelled', true],
              ['Patient identifiers present', false],
              ['Clinical verification available', false],
            ].map(([label, pass]) => (
              <div key={String(label)} className="flex items-center gap-3 rounded-lg border border-white/7 bg-white/[.025] px-3 py-2.5">
                {pass ? <CircleCheck className="size-4 text-emerald-300/75" /> : <Circle className="size-4 text-white/18" />}
                <span className="text-[11px] text-white/54">{label}</span>
              </div>
            ))}
          </div>
          <div className="mt-5 rounded-xl border border-rose-300/12 bg-rose-300/[.035] p-3.5">
            <div className="flex items-center gap-2 text-xs text-rose-100/72">
              <ShieldAlert className="size-3.5" />
              Fail closed
            </div>
            <p className="mt-2 text-[10px] leading-4 text-white/34">
              Export to a clinical plan is intentionally unavailable. A future pipeline must require expert review and verified provenance.
            </p>
          </div>
        </div>
      ) : null}
    </aside>
  );
}

function ImportWorkspace({
  consent,
  setConsent,
  manifest,
  onFiles,
  clearFiles,
  processingStep,
  processing,
  complete,
  runPreflight,
  continueToDemo,
  uploadError,
}: {
  consent: boolean;
  setConsent: (value: boolean) => void;
  manifest: LocalStudyManifest | null;
  onFiles: (files: File[]) => void;
  clearFiles: () => void;
  processingStep: number;
  processing: boolean;
  complete: boolean;
  runPreflight: () => void;
  continueToDemo: () => void;
  uploadError: string | null;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  const selectFiles = (event: ChangeEvent<HTMLInputElement>) => {
    onFiles(Array.from(event.target.files ?? []));
    event.target.value = '';
  };

  const dropFiles = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    onFiles(Array.from(event.dataTransfer.files));
  };

  return (
    <section className="import-workspace">
      <div className="mx-auto w-full max-w-3xl px-5 py-8 sm:px-8 sm:py-10">
        <div className="flex items-start justify-between gap-5">
          <div>
            <Badge className="border-emerald-200/10 bg-emerald-200/[.04] text-[9px] uppercase tracking-[.12em] text-emerald-100/70" variant="outline">
              Local-only prototype
            </Badge>
            <h1 className="mt-4 max-w-xl text-2xl font-semibold tracking-[-.03em] text-white/92 sm:text-3xl">Bring a DICOM study to the privacy gate</h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-white/42">
              Demonstrate the intake workflow without sending the selected files anywhere. The final 3D anatomy always remains the built-in synthetic case.
            </p>
          </div>
          <div className="hidden size-12 place-items-center rounded-2xl border border-white/8 bg-white/[.035] text-emerald-200/72 sm:grid">
            <FileUp className="size-5" />
          </div>
        </div>

        <div className="mt-7 rounded-xl border border-amber-200/12 bg-amber-200/[.035] p-4">
          <div className="flex gap-3">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-200/72" />
            <div>
              <p className="text-xs font-medium text-amber-50/76">Removing a patient name is not enough</p>
              <p className="mt-1.5 text-[11px] leading-5 text-white/38">
                DICOM can contain identifiers in metadata, private fields, overlays, embedded documents and pixels. Use only synthetic data or data de-identified under your organisation’s approved process.
              </p>
            </div>
          </div>
        </div>

        <label className="mt-5 flex cursor-pointer items-start gap-3 rounded-xl border border-white/8 bg-white/[.02] p-4">
          <input
            type="checkbox"
            checked={consent}
            onChange={(event) => setConsent(event.target.checked)}
            className="mt-0.5 size-4 accent-emerald-400"
          />
          <span className="text-[11px] leading-5 text-white/50">
            I confirm that these files are synthetic or institutionally de-identified, that I am authorised to use them, and that I will not use this prototype for patient care.
          </span>
        </label>

        {!manifest ? (
          <div
            className={`drop-zone mt-5 ${consent ? 'drop-zone-ready' : 'drop-zone-disabled'}`}
            onDragOver={(event) => event.preventDefault()}
            onDrop={dropFiles}
          >
            <input
              ref={inputRef}
              type="file"
              multiple
              accept=".dcm,.dicom,application/dicom"
              className="sr-only"
              onChange={selectFiles}
              disabled={!consent}
              aria-label="Choose de-identified DICOM files"
            />
            <div className="grid size-12 place-items-center rounded-2xl border border-white/8 bg-white/[.035] text-white/54">
              <UploadCloud className="size-5" />
            </div>
            <h2 className="mt-4 text-sm font-medium text-white/72">Drop anonymised DICOM files here</h2>
            <p className="mt-1.5 text-[11px] text-white/32">.dcm or .dicom • Multiple files supported • Contents never read</p>
            <Button
              className="mt-5 border-white/10 bg-white/6 text-white/70 hover:bg-white/10 hover:text-white"
              variant="outline"
              disabled={!consent}
              onClick={() => inputRef.current?.click()}
            >
              <FileStack /> Choose files
            </Button>
            {!consent ? <p className="mt-3 text-[10px] text-amber-100/45">Confirm the safety statement to enable file selection.</p> : null}
          </div>
        ) : (
          <div className="mt-5 overflow-hidden rounded-xl border border-white/9 bg-white/[.025]">
            <div className="flex items-center justify-between border-b border-white/8 px-4 py-3">
              <div className="flex items-center gap-2 text-xs text-white/64">
                <FileCheck className="size-4 text-emerald-200/72" />
                Local inventory created
              </div>
              <button type="button" onClick={clearFiles} className="flex items-center gap-1.5 text-[10px] text-white/34 hover:text-white/62">
                <Trash2 className="size-3" /> Clear
              </button>
            </div>
            <div className="grid grid-cols-2 gap-px bg-white/6 sm:grid-cols-4">
              {[
                ['Selected', `${manifest.fileCount}`],
                ['DICOM-like', `${manifest.dicomLikeCount}`],
                ['Other files', `${manifest.otherFileCount}`],
                ['Total size', formatBytes(manifest.totalBytes)],
              ].map(([label, value]) => (
                <div key={label} className="bg-[#0a1a16] p-4">
                  <p className="text-[9px] uppercase tracking-[.12em] text-white/28">{label}</p>
                  <p className="mt-1.5 font-mono text-sm text-white/72">{value}</p>
                </div>
              ))}
            </div>

            <div className="p-4">
              <div className="space-y-2">
                {PROTOTYPE_STAGES.map((stage, index) => {
                  const active = processing && processingStep === index;
                  const done = complete || processingStep > index;
                  return (
                    <div key={stage.id} className="flex items-start gap-3 rounded-lg px-2 py-2">
                      <span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full border border-white/10 bg-white/[.025]">
                        {active ? <LoaderCircle className="size-3 animate-spin text-emerald-200" /> : done ? <Check className="size-3 text-emerald-200/72" /> : <Circle className="size-2.5 text-white/16" />}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-3">
                          <p className="text-[11px] text-white/58">{stage.label}</p>
                          <span className="text-[9px] uppercase tracking-[.1em] text-white/22">{index < 3 ? 'Local demo' : 'Synthetic'}</span>
                        </div>
                        {active ? <p className="mt-1 text-[10px] text-white/30">{stage.prototypeBehaviour}</p> : null}
                      </div>
                    </div>
                  );
                })}
              </div>

              {complete ? (
                <div className="mt-4 rounded-xl border border-emerald-200/10 bg-emerald-200/[.035] p-4">
                  <div className="flex items-center gap-2 text-xs text-emerald-100/76">
                    <CircleCheck className="size-4" />
                    Demonstration complete
                  </div>
                  <p className="mt-2 text-[10px] leading-4 text-white/36">
                    No CT segmentation was performed. Continue to the built-in synthetic result to explore the intended planning experience.
                  </p>
                  <Button className="mt-4 bg-emerald-300 text-[#052117] hover:bg-emerald-200" onClick={continueToDemo}>
                    Open synthetic 3D result <ArrowRight />
                  </Button>
                </div>
              ) : (
                <Button
                  className="mt-4 w-full bg-emerald-300 text-[#052117] hover:bg-emerald-200"
                  onClick={runPreflight}
                  disabled={processing}
                >
                  {processing ? <LoaderCircle className="animate-spin" /> : <ScanLine />}
                  {processing ? 'Running simulated pipeline…' : 'Run local preflight demo'}
                </Button>
              )}
            </div>
          </div>
        )}

        {uploadError ? (
          <p className="mt-3 flex items-center gap-2 text-[11px] text-rose-200/70" role="alert">
            <AlertTriangle className="size-3.5" /> {uploadError}
          </p>
        ) : null}

        <div className="mt-5 flex items-center gap-2 text-[10px] text-white/26">
          <LockKeyhole className="size-3" />
          Selected file handles are discarded when cleared, replaced, or this tab closes.
        </div>
      </div>
    </section>
  );
}

function ImportSafetyPanel() {
  return (
    <aside className="workspace-sidebar right-sidebar">
      <p className="section-label">What this prototype does</p>
      <div className="mt-4 space-y-3">
        {[
          ['Counts files locally', 'Only file count, extension totals and byte size are summarised.'],
          ['Keeps content on device', 'No FileReader, upload endpoint or cloud storage is used.'],
          ['Loads synthetic anatomy', 'The displayed kidney is authored geometry, not a scan result.'],
        ].map(([title, body]) => (
          <div key={title} className="flex gap-3">
            <CircleCheck className="mt-0.5 size-4 shrink-0 text-emerald-300/70" />
            <div>
              <p className="text-[11px] text-white/62">{title}</p>
              <p className="mt-1 text-[10px] leading-4 text-white/30">{body}</p>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-6 border-t border-white/8 pt-5">
        <p className="section-label">What production needs</p>
        <div className="mt-4 space-y-3">
          {[
            'Isolated PHI quarantine and validated de-identification',
            'Protocol QC, multi-phase registration and fail-closed checks',
            'Validated segmentation with uncertainty and human correction',
            'DICOM SEG / mesh provenance and audited clinical review',
          ].map((item) => (
            <div key={item} className="flex gap-3">
              <Circle className="mt-0.5 size-3.5 shrink-0 text-white/18" />
              <p className="text-[10px] leading-4 text-white/35">{item}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-6 rounded-xl border border-rose-300/10 bg-rose-300/[.03] p-3.5">
        <div className="flex items-center gap-2 text-xs text-rose-100/70">
          <ShieldAlert className="size-3.5" />
          Not an anonymiser
        </div>
        <p className="mt-2 text-[10px] leading-4 text-white/34">
          This interface does not inspect metadata, private fields or burned-in pixels and cannot certify that a study is de-identified.
        </p>
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
  setAnswers: React.Dispatch<React.SetStateAction<Record<number, number>>>;
}) {
  const lesson = trainingSteps[step];
  const selected = answers[step];
  const answered = selected !== undefined;
  const score = Object.entries(answers).filter(([index, value]) => trainingSteps[Number(index)].correct === value).length;

  return (
    <aside className="workspace-sidebar right-sidebar">
      <div className="flex items-center justify-between">
        <p className="section-label">Guided review</p>
        <span className="font-mono text-[10px] text-white/32">{String(step + 1).padStart(2, '0')} / {String(trainingSteps.length).padStart(2, '0')}</span>
      </div>
      <h2 className="mt-3 text-lg font-semibold tracking-tight text-white/86">{lesson.title}</h2>
      <p className="mt-2 text-[11px] leading-5 text-white/40">{lesson.instruction}</p>

      <div className="mt-5 border-t border-white/8 pt-5">
        <p className="text-xs font-medium leading-5 text-white/64">{lesson.question}</p>
        <div className="mt-3 space-y-2">
          {lesson.options.map((option, index) => {
            const isSelected = selected === index;
            const isCorrect = answered && index === lesson.correct;
            const isWrong = answered && isSelected && index !== lesson.correct;
            return (
              <button
                key={option}
                type="button"
                disabled={answered}
                onClick={() => setAnswers((current) => ({ ...current, [step]: index }))}
                className={`answer-option ${isCorrect ? 'answer-correct' : ''} ${isWrong ? 'answer-wrong' : ''}`}
              >
                <span className="grid size-5 shrink-0 place-items-center rounded-full border border-white/10 font-mono text-[9px]">
                  {isCorrect ? <Check className="size-3" /> : String.fromCharCode(65 + index)}
                </span>
                <span>{option}</span>
              </button>
            );
          })}
        </div>
      </div>

      {answered ? (
        <div className={`mt-4 rounded-xl border p-3.5 ${selected === lesson.correct ? 'border-emerald-200/10 bg-emerald-200/[.035]' : 'border-amber-200/10 bg-amber-200/[.03]'}`}>
          <p className="text-[10px] font-semibold uppercase tracking-[.11em] text-white/52">
            {selected === lesson.correct ? 'Correct' : 'Review the rationale'}
          </p>
          <p className="mt-2 text-[10px] leading-4 text-white/38">{lesson.rationale}</p>
        </div>
      ) : null}

      <div className="mt-5 flex gap-2">
        <Button
          className="border-white/10 bg-white/[.035] text-white/50 hover:bg-white/8 hover:text-white"
          variant="outline"
          disabled={step === 0}
          onClick={() => setStep(Math.max(0, step - 1))}
        >
          Previous
        </Button>
        <Button
          className="flex-1 bg-sky-300 text-[#061b1c] hover:bg-sky-200"
          disabled={!answered}
          onClick={() => {
            if (step < trainingSteps.length - 1) setStep(step + 1);
          }}
        >
          {step === trainingSteps.length - 1 ? `Score ${score}/${trainingSteps.length}` : 'Next step'}
          {step < trainingSteps.length - 1 ? <ArrowRight /> : <Target />}
        </Button>
      </div>

      {step === trainingSteps.length - 1 && answered ? (
        <Button
          className="mt-2 w-full text-white/40 hover:bg-white/5 hover:text-white/65"
          variant="ghost"
          onClick={() => {
            setAnswers({});
            setStep(0);
          }}
        >
          <RotateCcw /> Restart module
        </Button>
      ) : null}

      <div className="mt-6 border-t border-white/8 pt-5">
        <div className="flex items-center justify-between text-[10px] text-white/30">
          <span>Confidence</span>
          <span>Self-reflection</span>
        </div>
        <div className="mt-3 grid grid-cols-3 gap-1.5">
          {['Low', 'Medium', 'High'].map((item) => (
            <button key={item} type="button" className="choice-chip">{item}</button>
          ))}
        </div>
      </div>
    </aside>
  );
}

function DisclaimerDialog({ onClose }: { onClose: () => void }) {
  return (
    <div className="dialog-backdrop">
      <dialog
        open
        className="disclaimer-dialog"
        aria-labelledby="disclaimer-title"
      >
        <div className="flex items-start justify-between gap-5">
          <div className="grid size-10 place-items-center rounded-xl border border-amber-200/10 bg-amber-200/[.04] text-amber-200/75">
            <ShieldAlert className="size-5" />
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Close safety information">
            <X className="size-4" />
          </button>
        </div>
        <p className="mt-5 text-[10px] font-semibold uppercase tracking-[.14em] text-amber-100/55">Research & education prototype</p>
        <h2 id="disclaimer-title" className="mt-2 text-2xl font-semibold tracking-[-.03em] text-white/92">Not for patient care</h2>
        <p className="mt-4 text-sm leading-6 text-white/48">
          This demonstration has not been clinically validated or authorised for clinical use. It is not FDA cleared or approved and is not UKCA/CE marked as a medical device.
        </p>
        <p className="mt-3 text-sm leading-6 text-white/48">
          Do not use it for diagnosis, treatment, patient management, real-world surgical planning or intraoperative guidance. Anatomy, measurements and workflow outputs may be incomplete or wrong. Use approved clinical imaging systems and qualified clinical judgement for every patient-care decision.
        </p>
        <div className="mt-5 grid gap-2 sm:grid-cols-2">
          <div className="rounded-xl border border-emerald-200/10 bg-emerald-200/[.03] p-3.5">
            <p className="text-[10px] font-semibold uppercase tracking-[.11em] text-emerald-100/60">Designed for</p>
            <p className="mt-2 text-[11px] leading-5 text-white/42">Interface exploration, workflow design and general education with synthetic anatomy.</p>
          </div>
          <div className="rounded-xl border border-rose-200/10 bg-rose-200/[.03] p-3.5">
            <p className="text-[10px] font-semibold uppercase tracking-[.11em] text-rose-100/60">Never use for</p>
            <p className="mt-2 text-[11px] leading-5 text-white/42">Diagnosis, patient-specific planning, treatment selection, consent or surgical guidance.</p>
          </div>
        </div>
        <Button className="mt-6 w-full bg-emerald-300 text-[#052117] hover:bg-emerald-200" onClick={onClose}>
          I understand the prototype boundary
        </Button>
      </dialog>
    </div>
  );
}

export function RenalPlatform() {
  const [mode, setMode] = useState<WorkspaceMode>('plan');
  const [layers, setLayers] = useState<AnatomyLayers>({
    kidney: true,
    tumour: true,
    arteries: true,
    veins: true,
    collecting: true,
  });
  const [kidneyOpacity, setKidneyOpacity] = useState(72);
  const [marginMm, setMarginMm] = useState(5);
  const [clipPercent, setClipPercent] = useState(0);
  const [preset, setPreset] = useState<ViewPreset>('anterior');
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>('anatomy');
  const [approach, setApproach] = useState<'transperitoneal' | 'retroperitoneal'>('transperitoneal');
  const [clamp, setClamp] = useState<'selective' | 'main' | 'none'>('selective');
  const [trainingStep, setTrainingStep] = useState(0);
  const [answers, setAnswers] = useState<Record<number, number>>({});
  const [consent, setConsent] = useState(false);
  const [manifest, setManifest] = useState<LocalStudyManifest | null>(null);
  const [processingStep, setProcessingStep] = useState(-1);
  const [processing, setProcessing] = useState(false);
  const [complete, setComplete] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [showDisclaimer, setShowDisclaimer] = useState(false);
  const [demoNotice, setDemoNotice] = useState(false);

  const caseLabel = useMemo(() => {
    if (mode === 'import') return 'Local intake';
    if (mode === 'learn') return `Training · ${trainingSteps[trainingStep].short}`;
    return 'Synthetic case · CVR-SYN-001';
  }, [mode, trainingStep]);

  const onFiles = (files: File[]) => {
    setUploadError(null);
    if (!consent) {
      setUploadError('Confirm the safety statement before selecting files.');
      return;
    }
    if (files.length === 0) {
      setUploadError('No files were selected.');
      return;
    }
    if (files.length > 1200) {
      setUploadError('For this browser demo, select no more than 1,200 files at once.');
      return;
    }
    setManifest(createLocalStudyManifest(files));
    setProcessingStep(-1);
    setComplete(false);
  };

  const clearFiles = () => {
    setManifest(null);
    setProcessingStep(-1);
    setProcessing(false);
    setComplete(false);
    setUploadError(null);
  };

  const runPreflight = async () => {
    if (!manifest || processing) return;
    setProcessing(true);
    setComplete(false);
    for (let index = 0; index < PROTOTYPE_STAGES.length; index += 1) {
      setProcessingStep(index);
      await new Promise((resolve) => window.setTimeout(resolve, 520));
    }
    setProcessingStep(PROTOTYPE_STAGES.length);
    setProcessing(false);
    setComplete(true);
  };

  const continueToDemo = () => {
    setDemoNotice(true);
    setMode('plan');
    setInspectorTab('source');
    window.setTimeout(() => setDemoNotice(false), 5200);
  };

  return (
    <main className="app-shell">
      <header className="app-header">
        <div className="flex min-w-0 items-center gap-3">
          <div className="brand-mark"><Activity className="size-4" /></div>
          <div className="min-w-0">
            <div className="flex items-baseline gap-2">
              <span className="truncate text-sm font-semibold tracking-[-.025em] text-white/92 sm:text-base">CalyxView</span>
              <span className="text-[10px] font-medium uppercase tracking-[.14em] text-emerald-200/62">Renal Lab</span>
            </div>
            <p className="hidden text-[9px] uppercase tracking-[.14em] text-white/24 sm:block">Partial nephrectomy planning concept</p>
          </div>
        </div>

        <nav className="mode-nav" aria-label="Primary workspace">
          <ModeButton active={mode === 'plan'} icon={<Box className="size-3.5" />} label="Plan" onClick={() => setMode('plan')} />
          <ModeButton active={mode === 'import'} icon={<FileUp className="size-3.5" />} label="Import" onClick={() => setMode('import')} />
          <ModeButton active={mode === 'learn'} icon={<BookOpen className="size-3.5" />} label="Learn" onClick={() => setMode('learn')} />
        </nav>

        <div className="flex items-center justify-end gap-2">
          <button type="button" onClick={() => setShowDisclaimer(true)} className="research-chip">
            <ShieldAlert className="size-3" />
            <span className="hidden sm:inline">Research & education</span>
            <span className="sm:hidden">R&D</span>
          </button>
          <button type="button" className="case-switcher" onClick={() => setMode('plan')}>
            <span className="hidden max-w-44 truncate sm:block">{caseLabel}</span>
            <span className="sm:hidden">Case</span>
            <ChevronDown className="size-3" />
          </button>
        </div>
      </header>

      <div className="safety-ribbon" role="note">
        <span className="font-semibold">RESEARCH & EDUCATION PROTOTYPE — NOT FOR PATIENT CARE</span>
        <button type="button" onClick={() => setShowDisclaimer(true)}>Read safety boundary</button>
      </div>

      <div className="workspace-grid">
        <CaseSidebar
          mode={mode}
          layers={layers}
          setLayers={setLayers}
          kidneyOpacity={kidneyOpacity}
          setKidneyOpacity={setKidneyOpacity}
          trainingStep={trainingStep}
          answers={answers}
          importedManifest={manifest}
        />

        {mode === 'import' ? (
          <ImportWorkspace
            consent={consent}
            setConsent={setConsent}
            manifest={manifest}
            onFiles={onFiles}
            clearFiles={clearFiles}
            processingStep={processingStep}
            processing={processing}
            complete={complete}
            runPreflight={runPreflight}
            continueToDemo={continueToDemo}
            uploadError={uploadError}
          />
        ) : (
          <ModelWorkspace
            mode={mode}
            layers={layers}
            kidneyOpacity={kidneyOpacity}
            marginMm={marginMm}
            setMarginMm={setMarginMm}
            clipPercent={clipPercent}
            setClipPercent={setClipPercent}
            preset={preset}
            setPreset={setPreset}
            trainingStep={trainingStep}
          />
        )}

        {mode === 'plan' ? (
          <PlanningInspector
            tab={inspectorTab}
            setTab={setInspectorTab}
            marginMm={marginMm}
            setMarginMm={setMarginMm}
            approach={approach}
            setApproach={setApproach}
            clamp={clamp}
            setClamp={setClamp}
          />
        ) : mode === 'import' ? (
          <ImportSafetyPanel />
        ) : (
          <TrainingPanel step={trainingStep} setStep={setTrainingStep} answers={answers} setAnswers={setAnswers} />
        )}
      </div>

      {demoNotice ? (
        <output className="toast-notice">
          <CircleCheck className="size-4 text-emerald-200" />
          <div>
            <p className="text-xs text-white/78">Synthetic result opened</p>
            <p className="mt-0.5 text-[10px] text-white/34">No anatomy was generated from the selected files.</p>
          </div>
        </output>
      ) : null}

      {showDisclaimer ? <DisclaimerDialog onClose={() => setShowDisclaimer(false)} /> : null}
    </main>
  );
}
