import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { softwareMeshViewer } from '@/lib/software-mesh-viewer';
import { siteAsset } from '@/lib/site-assets';
import type { SceneCase } from './reference-case-scene';
import type { ViewPreset, ZoomRequest } from './kidney-scene';

const views: Record<ViewPreset, [number, number]> = {
  anterior: [Math.PI, 0], posterior: [0, 0], left: [Math.PI / 2, 0], right: [-Math.PI / 2, 0], superior: [0, Math.PI / 2],
};

export function SoftwareCaseScene(props: {
  referenceCase: SceneCase; visible: Record<string, boolean>; parenchymaOpacity: number;
  clipPercent: number; preset: ViewPreset; viewNonce: number; resetNonce: number;
  zoomRequest: ZoomRequest; onUserRotate?: () => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const viewer = useRef<ReturnType<typeof softwareMeshViewer> | null>(null);
  const live = useRef(props);
  useEffect(() => { live.current = props; });
  const [status, setStatus] = useState('Loading compatibility view…');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setStatus('Loading compatibility view…');
      let model: THREE.Object3D;
      if (props.referenceCase.mesh) model = (await new GLTFLoader().loadAsync(siteAsset(props.referenceCase.mesh))).scene;
      else {
        const group = new THREE.Group();
        for (const [name, data] of Object.entries(props.referenceCase.meshData ?? {})) {
          const geometry = new THREE.BufferGeometry();
          geometry.setAttribute('position', new THREE.BufferAttribute(data.positions, 3)); geometry.setIndex(new THREE.BufferAttribute(data.indices, 1));
          const mesh = new THREE.Mesh(geometry); mesh.name = name; group.add(mesh);
        }
        model = group;
      }
      if (cancelled || !canvas.current) return;
      viewer.current = softwareMeshViewer(canvas.current, model, {
        background: '#071710', onRotate: () => live.current.onUserRotate?.(),
        layer: name => {
          const structure = live.current.referenceCase.structures.find(s => s.name === name);
          return structure ? { colour: structure.colour, visible: live.current.visible[name] ?? structure.visible, opacity: name === 'parenchyma' ? live.current.parenchymaOpacity : structure.opacity, framing: structure.framing } : undefined;
        },
      });
      viewer.current.view(...views[live.current.preset], true);
      setStatus('');
    };
    load().catch(() => { if (!cancelled) setStatus('The model could not load. Check your connection and retry.'); });
    return () => { cancelled = true; viewer.current?.dispose(); viewer.current = null; };
  }, [props.referenceCase, attempt]);
  useEffect(() => { viewer.current?.update(); viewer.current?.cut(props.clipPercent); }, [props.visible, props.parenchymaOpacity, props.clipPercent]);
  useEffect(() => { viewer.current?.view(...views[props.preset], true); }, [props.preset, props.viewNonce, props.resetNonce]);
  useEffect(() => { if (props.zoomRequest.nonce) viewer.current?.zoom(props.zoomRequest.direction); }, [props.zoomRequest]);
  return <div className="software-case-view">
    <canvas ref={canvas} id="renal-3d-canvas" data-testid="software-model" aria-label={`${props.referenceCase.label}, rotatable 3D compatibility view`} />
    <p className="software-view-note">Compatibility view · same mesh, simplified shading. Drag to turn; pinch or use the zoom buttons. CT slices remain in the CT tab.</p>
    {status && <output className="software-view-status">{status}{status.includes('retry') && <button type="button" onClick={() => setAttempt(a => a + 1)}>Retry model</button>}</output>}
  </div>;
}
