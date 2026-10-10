import { useState } from 'react';
import { ReferenceCaseScene, type SceneCase } from './reference-case-scene';
import { CtPanel, slicePlaneFor, useCtSlices } from './ct-slices';
import type { ViewPreset } from './kidney-scene';
import './urogram.css';

const urogram: SceneCase = {
  id: 'urogram', label: 'CT urogram', mesh: '/urogram/model.glb',
  description: 'Left kidney and separately segmented contrast-filled collecting system from an excretory-phase CT. Automatic outlines awaiting expert review.',
  structures: [
    { name: 'parenchyma', label: 'Kidney', provenance: 'Automatic kidney outline', colour: '#c29a7f', opacity: .18, visible: true, framing: true },
    { name: 'collecting', label: 'Collecting system', provenance: 'Contrast-supported lumen', colour: '#5ad2e2', opacity: 1, visible: true, framing: false },
  ],
};

export function UrogramWorkspace({ onExit }: { onExit: () => void }) {
  const ct = useCtSlices('urogram', true);
  const [chosenSlice, setSlice] = useState<number | null>(null);
  const index = chosenSlice ?? ct.data?.tumourSlice ?? 0;
  const [outlines, setOutlines] = useState(true);
  const [visible, setVisible] = useState<Record<string, boolean>>({ parenchyma: true, collecting: true });
  const [opacity, setOpacity] = useState(18);
  const [preset, setPreset] = useState<ViewPreset>('posterior');
  const [reset, setReset] = useState(0);
  const [zoom, setZoom] = useState({ nonce: 0, direction: 1 as 1 | -1 });
  return <main className="urogram-workspace">
    <header><button className="atlas-button atlas-button-outline" onClick={onExit}>Back to cases</button><div><p className="atlas-kicker">CT-derived anatomy</p><h1>The collecting system</h1></div><span>Research candidate · Expert review pending</span></header>
    <div className="urogram-layout">
      <section className="urogram-controls" aria-label="Model controls">
        <h2>Left kidney · Excretory phase</h2>
        <p>The blue surface follows contrast visible in the collecting system. Unopacified branches are omitted.</p>
        {urogram.structures.map(s => <label key={s.name}><input type="checkbox" checked={visible[s.name]} onChange={e => setVisible({ ...visible, [s.name]: e.target.checked })}/>{s.label}</label>)}
        <label>Kidney opacity: {opacity}%<input type="range" min="5" max="100" value={opacity} onChange={e => setOpacity(Number(e.target.value))}/></label>
        <label>View<select value={preset} onChange={e => setPreset(e.target.value as ViewPreset)}>{(['posterior', 'anterior', 'left', 'right', 'superior'] as const).map(v => <option key={v}>{v}</option>)}</select></label>
        <div className="urogram-buttons"><button onClick={() => setZoom({ nonce: zoom.nonce + 1, direction: 1 })}>Zoom in</button><button onClick={() => setZoom({ nonce: zoom.nonce + 1, direction: -1 })}>Zoom out</button><button onClick={() => setReset(reset + 1)}>Reset view</button></div>
        <p>Drag to rotate. Hide the kidney to inspect the lumen alone.</p>
        <h2>What this case supports</h2><p>Separate kidney and collecting-system masks in the same CT coordinate frame. No filled gaps, invented branches or tumour scores.</p>
        <p>Automatic lumen candidate, threshold 350 to 1800 HU. This shows opacified lumen, not its wall. Slice-by-slice expert review remains pending. Kidney display smoothing is limited to 1 mm; the lumen surface and CT outlines are unsmoothed.</p>
        <p><a href="https://www.cancerimagingarchive.net/collection/tcga-blca/">TCGA Research Network / TCIA</a> · <a href="https://doi.org/10.7937/K9/TCIA.2016.8LNG8XDR">Dataset citation</a> · <a href="https://creativecommons.org/licenses/by/3.0/">CC BY 3.0</a>. Cropped, windowed CT and derived surfaces.</p>
      </section>
      <section className="urogram-model" aria-label="Interactive CT-derived model"><ReferenceCaseScene referenceCase={urogram} visible={visible} parenchymaOpacity={opacity} clipPercent={0} preset={preset} resetNonce={reset} zoomRequest={zoom} slicePlane={ct.data ? slicePlaneFor(ct.data, index) : null}/></section>
      <section className="urogram-ct" aria-label="Source CT comparison"><h2>Check against the CT</h2><CtPanel caseId="urogram" label="the left collecting system" sourceLabel="TCIA CT urogram, axial" focusLabel="Go to collecting system" status={ct.status} data={ct.data} index={index} setIndex={setSlice} outlines={outlines} setOutlines={setOutlines}/><p>Scroll over the scan or use the slider. Blue outlines and the blue 3D surface come from the same mask, resampled on a 1 mm grid.</p></section>
    </div>
  </main>;
}
