'use client';

// Small pieces the 3D viewer's panels share: a metric tile, a layer toggle
// and the general approach and clamping notes.

import { Eye, EyeOff } from 'lucide-react';
import type { ReactNode } from 'react';

export function Metric({
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
      <p className="text-[11px] font-semibold uppercase tracking-[.1em] text-white/62">{label}</p>
      <p className="mt-1.5 font-mono text-[15px] text-white/90">{value}</p>
      {detail ? <p className="mt-1 text-[11px] leading-4 text-white/66">{detail}</p> : null}
    </div>
  );
}

export function LayerButton({
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
        active ? 'bg-white/[.045]' : 'hover:bg-white/[.03]'
      }`}
    >
      <span className="grid size-5 shrink-0 place-items-center rounded-md border border-white/10 bg-black/10">
        {active ? <Eye className="size-3 text-white/80" /> : <EyeOff className="size-3 text-white/60" />}
      </span>
      <span
        className={`size-2 shrink-0 rounded-full ${active ? '' : 'opacity-40'}`}
        style={{ backgroundColor: color }}
      />
      <span className="min-w-0 flex-1">
        <span className={`block truncate text-xs ${active ? 'text-white/85' : 'text-white/62'}`}>{label}</span>
        <span className="block text-[11px] leading-4 text-white/62">{provenance}</span>
      </span>
    </button>
  );
}

export function PlanningNote({ term, children }: { term: string; children: ReactNode }) {
  return (
    <div className="border-b border-white/6 py-2.5 last:border-b-0">
      <p className="text-xs font-medium text-white/88">{term}</p>
      <p className="mt-1 text-xs leading-5 text-white/72">{children}</p>
    </div>
  );
}

/** Approach and clamping, as general notes under every kidney's plan. */
export function ApproachNotes() {
  return (
    <>
      <p className="section-label mt-6">Approach and clamping</p>
      <p className="mt-2 text-xs leading-5 text-white/66">General, not advice for this kidney.</p>
      <div className="mt-1">
        <PlanningNote term="Transperitoneal">Room to work; the default for anterior and hilar tumours.</PlanningNote>
        <PlanningNote term="Retroperitoneal">
          Direct to the posterior surface, no bowel, less room; favoured for posterior and posterolateral tumours
          and the re-operative abdomen.
        </PlanningNote>
        <PlanningNote term="Main artery">
          Global warm ischaemia, so keep it short; find and control every artery first, accessory ones included.
        </PlanningNote>
        <PlanningNote term="Selective (segmental)">
          Ischaemia limited to the clamped territory; needs an arterial-phase map of the segmental branches to
          the tumour.
        </PlanningNote>
        <PlanningNote term="Off-clamp">
          No planned ischaemia, more bleeding at excision; suits small, largely exophytic tumours.
        </PlanningNote>
      </div>
    </>
  );
}
