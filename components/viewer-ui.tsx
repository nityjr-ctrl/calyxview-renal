'use client';

// Shared measurement and layer controls for the viewer and builder.

import { Eye, EyeOff } from 'lucide-react';

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
      <p className="text-xs font-medium text-white/72">{label}</p>
      <p className="mt-1.5 text-lg tabular-nums text-white/90">{value}</p>
      {detail ? (
        <p className="mt-1 text-xs leading-5 text-white/72">{detail}</p>
      ) : null}
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
      className={`layer-button group flex w-full items-center gap-3 rounded px-2.5 py-2 text-left transition ${
        active ? 'bg-white/[.045]' : 'hover:bg-white/[.03]'
      }`}
    >
      <span className="grid size-5 shrink-0 place-items-center rounded-md border border-white/10 bg-black/10">
        {active ? (
          <Eye className="size-3 text-white/80" />
        ) : (
          <EyeOff className="size-3 text-white/60" />
        )}
      </span>
      <span
        className={`size-2 shrink-0 rounded-full ${active ? '' : 'opacity-40'}`}
        style={{ backgroundColor: color }}
      />
      <span className="min-w-0 flex-1">
        <span
          className={`block text-sm ${active ? 'text-white/85' : 'text-white/72'}`}
        >
          {label}
        </span>
        <span className="block text-xs leading-5 text-white/72">
          {provenance}
        </span>
      </span>
    </button>
  );
}
