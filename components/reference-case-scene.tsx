'use client';

// Renders one of Kidneys A to E from its GLB, or a kidney the builder has just
// made in this tab from typed arrays. The A to E meshes came from my separate
// CalyxView endourology project, built from the KiTS23 expert outlines (see
// scripts/make-reference-cases.mjs). The hand-made kidney in kidney-scene.tsx is
// drawn in code instead.
//
// Lighting, interaction and view presets mirror the hand-made kidney's scene so
// switching between them doesn't feel like moving to a different application.

import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { ensureSurfaceNormals, orientSurfaceOutward, smoothDisplaySurface } from '@/lib/surface-normals';

import type { SlicePlane } from '@/components/ct-slices';
import type { ReferenceStructure } from '@/lib/reference-cases';
import type { ViewPreset, ZoomRequest } from '@/components/kidney-scene';

/** A surface already in memory, in RAS millimetres. */
export type MeshData = { positions: Float32Array; normals: Float32Array; indices: Uint32Array };

/** Kidneys A to E (a GLB to load) or a built kidney (meshes in memory). */
export type SceneCase = {
  id: string;
  label: string;
  structures: ReferenceStructure[];
  mesh?: string;
  meshData?: Record<string, MeshData>;
  /** Spoken description of the canvas. */
  description?: string;
};

type ReferenceCaseSceneProps = {
  referenceCase: SceneCase;
  visible: Record<string, boolean>;
  parenchymaOpacity: number;
  clipPercent: number;
  preset: ViewPreset;
  /** Bump to re-apply the current preset, e.g. when its button is pressed again. */
  viewNonce?: number;
  /** Bump to snap back to the preset and the default zoom. */
  resetNonce?: number;
  /** From the zoom buttons, for keyboard users and anyone who can't pinch. */
  zoomRequest?: ZoomRequest;
  /** Called when someone turns the model by hand. */
  onUserRotate?: () => void;
  /** The CT slice on show, drawn as a thin axial plane through the model. Null hides it. */
  slicePlane?: SlicePlane | null;
  /** Called once if the browser can't draw WebGL, so the view controls can stand down. */
  onNoWebgl?: () => void;
};

type Status = 'loading' | 'ready' | 'failed' | 'no-webgl';

const CAMERA_Z = 8.8;
const NO_ZOOM: ZoomRequest = { nonce: 0, direction: 1 };

// The GLBs are in RAS millimetres (+x patient right, +y anterior, +z superior).
// The model group turns them Y-up, which leaves posterior facing the camera
// with no further rotation. Values are [root.rotation.y, root.rotation.x].
const PRESET_ROTATIONS: Record<ViewPreset, [number, number]> = {
  anterior: [Math.PI, 0],
  posterior: [0, 0],
  // Patient's left (-x) faces the camera after a +90 degree turn.
  left: [Math.PI / 2, 0],
  right: [-Math.PI / 2, 0],
  // Tip the top towards the camera; anterior ends up at the bottom.
  superior: [Math.PI, 1.1],
};

/** The angle equivalent to `angle` that is nearest to `target`. */
function nearestTurn(angle: number, target: number) {
  const turn = Math.PI * 2;
  return target + ((((angle - target) % turn) + turn + Math.PI) % turn) - Math.PI;
}

/** A WebGL renderer, or null when the browser can't make one (WebGL off or blocked). */
function createRenderer(): THREE.WebGLRenderer | null {
  try {
    return new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      // Kept so "Save image" can read the canvas back.
      preserveDrawingBuffer: true,
      powerPreference: 'high-performance',
    });
  } catch {
    return null;
  }
}

export function ReferenceCaseScene({
  referenceCase,
  visible,
  parenchymaOpacity,
  clipPercent,
  preset,
  viewNonce = 0,
  resetNonce = 0,
  zoomRequest = NO_ZOOM,
  onUserRotate,
  slicePlane = null,
  onNoWebgl,
}: ReferenceCaseSceneProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [status, setStatus] = useState<Status>('loading');
  const [progress, setProgress] = useState<number | null>(null);

  // Live values the animation loop reads without re-running the whole effect.
  const stateRef = useRef({ visible, parenchymaOpacity, clipPercent, preset, viewNonce, resetNonce, zoomRequest, slicePlane });
  const onUserRotateRef = useRef(onUserRotate);

  useEffect(() => {
    stateRef.current = { visible, parenchymaOpacity, clipPercent, preset, viewNonce, resetNonce, zoomRequest, slicePlane };
  }, [visible, parenchymaOpacity, clipPercent, preset, viewNonce, resetNonce, zoomRequest, slicePlane]);

  useEffect(() => {
    onUserRotateRef.current = onUserRotate;
  }, [onUserRotate]);

  const onNoWebglRef = useRef(onNoWebgl);
  useEffect(() => {
    onNoWebglRef.current = onNoWebgl;
  }, [onNoWebgl]);
  useEffect(() => {
    if (status === 'no-webgl') onNoWebglRef.current?.();
  }, [status]);

  // The parent remounts this component per case, so status starts at 'loading'
  // for each one and is only advanced from the loader's callbacks, or to no-webgl.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return undefined;

    const renderer = createRenderer();
    if (!renderer) {
      // No WebGL. The overlay below says so, in place of the loading message.
      // Set from a frame callback, like the loader's, not in the effect body.
      const noWebglFrame = requestAnimationFrame(() => setStatus('no-webgl'));
      return () => cancelAnimationFrame(noWebglFrame);
    }

    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x000000, 0);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.12;
    renderer.localClippingEnabled = true;
    renderer.domElement.id = 'renal-3d-canvas';
    renderer.domElement.setAttribute('role', 'img');
    renderer.domElement.setAttribute(
      'aria-label',
      referenceCase.description ?? `${referenceCase.label} in 3D: the kidney and tumour from the KiTS23 expert outlines`,
    );
    renderer.domElement.style.display = 'block';
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
    host.append(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 100);
    camera.position.set(0, 0.08, CAMERA_Z);

    const hemi = new THREE.HemisphereLight(0xc8ffe9, 0x06110e, 2.1);
    scene.add(hemi);
    const key = new THREE.DirectionalLight(0xb9ffe0, 5.2);
    key.position.set(3.4, 4.2, 5.6);
    scene.add(key);
    const rim = new THREE.PointLight(0x4ecda0, 15, 10);
    rim.position.set(-4.2, 1.4, -3.4);
    scene.add(rim);
    const warm = new THREE.PointLight(0xffa46c, 7, 8);
    warm.position.set(2.6, -2.4, 2.8);
    scene.add(warm);

    // Anatomical axes are RAS, so superior runs along +Z. Three.js is Y-up,
    // hence the quarter turn; presets then rotate around that upright axis.
    const root = new THREE.Group();
    const model = new THREE.Group();
    model.rotation.x = -Math.PI / 2;
    root.add(model);
    scene.add(root);
    const [startY, startX] = PRESET_ROTATIONS[stateRef.current.preset];
    root.rotation.set(startX, startY, 0);

    // The cutaway is a world-space plane facing the camera, so it always peels
    // the model away from the side nearest you.
    const clipPlane = new THREE.Plane(new THREE.Vector3(0, 0, -1), 0);
    const parts = new Map<string, THREE.Mesh>();
    let disposed = false;

    // The CT slice on show: one unit square in the model's own millimetres
    // (RAS, so its normal is superior), scaled to the crop and moved up and
    // down. It lives inside the loaded model, so it shares its framing.
    const planeGeometry = new THREE.PlaneGeometry(1, 1);
    const planeMaterial = new THREE.MeshBasicMaterial({
      color: 0xbff5e3,
      transparent: true,
      opacity: 0.16,
      depthWrite: false,
      side: THREE.DoubleSide,
      clippingPlanes: [clipPlane],
    });
    const planeEdgeGeometry = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(-0.5, -0.5, 0),
      new THREE.Vector3(0.5, -0.5, 0),
      new THREE.Vector3(0.5, 0.5, 0),
      new THREE.Vector3(-0.5, 0.5, 0),
    ]);
    const planeEdgeMaterial = new THREE.LineBasicMaterial({
      color: 0xd6fff0,
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
      clippingPlanes: [clipPlane],
    });
    const slice = new THREE.Group();
    const sliceFill = new THREE.Mesh(planeGeometry, planeMaterial);
    sliceFill.renderOrder = 3;
    const sliceEdge = new THREE.LineLoop(planeEdgeGeometry, planeEdgeMaterial);
    sliceEdge.renderOrder = 3;
    slice.add(sliceFill, sliceEdge);
    slice.visible = false;
    let sliceSize = '';

    // Colour, frame and show the model, whichever way it arrived.
    const install = (loaded: THREE.Object3D) => {
      if (disposed) return;

      const byName = new Map(referenceCase.structures.map((s) => [s.name, s]));
      loaded.traverse((child) => {
        if (!(child instanceof THREE.Mesh)) return;
        const structure = byName.get(child.name);
        if (!structure) return;
        ensureSurfaceNormals(child.geometry);
        orientSurfaceOutward(child.geometry);
        // Only the broad kidney envelope is smoothed; small lumen branches stay exact.
        if (referenceCase.mesh && child.name === 'parenchyma') smoothDisplaySurface(child.geometry);
        const material = new THREE.MeshPhysicalMaterial({
          color: new THREE.Color(structure.colour),
          roughness: 0.62,
          metalness: 0.02,
          clearcoat: 0.25,
          transparent: true,
          opacity: structure.opacity,
          depthWrite: structure.opacity > 0.92,
          side: THREE.FrontSide,
          clippingPlanes: [clipPlane],
        });
        child.material = material;
        child.visible = structure.visible;
        // Outer shells last, so what's inside shows through them.
        child.renderOrder =
          child.name === 'skin' ? 2 : child.name === 'parenchyma' || child.name === 'contralateral' || child.name === 'margin' ? 1 : 0;
        parts.set(child.name, child);
      });

      // Frame on the kidney and tumour. Surrounding organs, and a cyst that
      // belongs to the other kidney, would otherwise shrink the kidney on
      // screen. The data marks which structures to frame on.
      loaded.updateMatrixWorld(true);
      const framing = new THREE.Box3();
      for (const structure of referenceCase.structures) {
        const mesh = parts.get(structure.name);
        if (mesh && structure.framing) framing.expandByObject(mesh);
      }
      const box = framing.isEmpty() ? new THREE.Box3().setFromObject(loaded) : framing;
      const size = box.getSize(new THREE.Vector3());
      const centre = box.getCenter(new THREE.Vector3());
      const longest = Math.max(size.x, size.y, size.z) || 1;
      const scale = 3.4 / longest;

      // Scale first, then translate by the scaled centre, so the kidney ends
      // up at the origin whatever its position in the patient coordinates.
      loaded.scale.setScalar(scale);
      loaded.position.copy(centre).multiplyScalar(-scale);
      // Added after framing, so the plane never changes the camera's box.
      loaded.add(slice);
      model.add(loaded);

      setStatus('ready');
    };

    let installFrame = 0;
    const { meshData } = referenceCase;
    if (meshData) {
      const group = new THREE.Group();
      for (const structure of referenceCase.structures) {
        const data = meshData[structure.name];
        if (!data) continue;
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(data.positions, 3));
        geometry.setAttribute('normal', new THREE.BufferAttribute(data.normals, 3));
        geometry.setIndex(new THREE.BufferAttribute(data.indices, 1));
        const mesh = new THREE.Mesh(geometry);
        mesh.name = structure.name;
        group.add(mesh);
      }
      // From a frame callback, like the loader's, not in the effect body.
      installFrame = requestAnimationFrame(() => install(group));
    } else if (referenceCase.mesh) {
      const loader = new GLTFLoader();
      loader.load(
        referenceCase.mesh,
        (gltf) => install(gltf.scene),
        (event) => {
          if (disposed || !event.lengthComputable || !event.total) return;
          setProgress(Math.min(99, Math.round((event.loaded / event.total) * 20) * 5));
        },
        () => {
          if (!disposed) setStatus('failed');
        },
      );
    }

    const targetRotation = new THREE.Vector2(root.rotation.y, root.rotation.x);
    const pointers = new Map<number, { x: number; y: number }>();
    let dragging = false;
    let pointerX = 0;
    let pointerY = 0;
    let pinchDistance = 0;
    let reportedThisDrag = false;
    let lastPreset = stateRef.current.preset;
    let lastViewNonce = stateRef.current.viewNonce;
    let lastResetNonce = stateRef.current.resetNonce;
    let lastZoomNonce = stateRef.current.zoomRequest.nonce;
    let frame = 0;
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const pinchSpan = () => {
      const [a, b] = [...pointers.values()];
      return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
    };

    const zoomBy = (delta: number) => {
      camera.position.z = THREE.MathUtils.clamp(camera.position.z + delta, 5.2, 10.6);
    };

    const onPointerDown = (event: PointerEvent) => {
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      renderer.domElement.setPointerCapture?.(event.pointerId);
      if (pointers.size === 2) {
        dragging = false;
        pinchDistance = pinchSpan();
        return;
      }
      dragging = true;
      reportedThisDrag = false;
      pointerX = event.clientX;
      pointerY = event.clientY;
      renderer.domElement.style.cursor = 'grabbing';
    };

    const onPointerMove = (event: PointerEvent) => {
      if (!pointers.has(event.pointerId)) return;
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (pointers.size >= 2) {
        const span = pinchSpan();
        if (pinchDistance > 0) zoomBy((pinchDistance - span) * 0.012);
        pinchDistance = span;
        return;
      }
      if (!dragging) return;
      const deltaX = event.clientX - pointerX;
      const deltaY = event.clientY - pointerY;
      targetRotation.x += deltaX * 0.008;
      targetRotation.y = THREE.MathUtils.clamp(targetRotation.y + deltaY * 0.006, -1.25, 1.25);
      pointerX = event.clientX;
      pointerY = event.clientY;
      if (!reportedThisDrag && (deltaX !== 0 || deltaY !== 0)) {
        reportedThisDrag = true;
        onUserRotateRef.current?.();
      }
    };

    const stopPointer = (event: PointerEvent) => {
      pointers.delete(event.pointerId);
      renderer.domElement.releasePointerCapture?.(event.pointerId);
      if (pointers.size < 2) pinchDistance = 0;
      if (pointers.size === 1) {
        const [remaining] = [...pointers.values()];
        pointerX = remaining.x;
        pointerY = remaining.y;
        dragging = true;
        return;
      }
      if (pointers.size === 0) {
        dragging = false;
        renderer.domElement.style.cursor = 'grab';
      }
    };

    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      zoomBy(event.deltaY * 0.004);
    };

    renderer.domElement.style.cursor = 'grab';
    renderer.domElement.style.touchAction = 'none';
    renderer.domElement.addEventListener('pointerdown', onPointerDown);
    renderer.domElement.addEventListener('pointermove', onPointerMove);
    renderer.domElement.addEventListener('pointerup', stopPointer);
    renderer.domElement.addEventListener('pointercancel', stopPointer);
    renderer.domElement.addEventListener('wheel', onWheel, { passive: false });

    let resizeFrame = 0;
    let renderWidth = 0;
    let renderHeight = 0;
    const resize = () => {
      cancelAnimationFrame(resizeFrame);
      resizeFrame = requestAnimationFrame(() => {
        const width = Math.max(1, host.clientWidth);
        const height = Math.max(1, host.clientHeight);
        if (width === renderWidth && height === renderHeight) return;
        renderWidth = width;
        renderHeight = height;
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
        renderer.setSize(width, height, false);
      });
    };
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(host);
    resize();

    // Don't draw frames nobody can see, such as when a phone has scrolled down
    // to the panels under the model. The hand-made kidney's scene does the same.
    let onScreen = true;
    const visibility =
      typeof IntersectionObserver === 'undefined'
        ? null
        : new IntersectionObserver(([entry]) => {
            onScreen = entry.isIntersecting;
          });
    visibility?.observe(host);

    const applyPreset = (name: ViewPreset) => {
      const [y, x] = PRESET_ROTATIONS[name];
      root.rotation.y = nearestTurn(root.rotation.y, y);
      targetRotation.set(y, x);
    };

    const animate = () => {
      frame = requestAnimationFrame(animate);
      if (!onScreen) return;
      const current = stateRef.current;

      if (current.resetNonce !== lastResetNonce) {
        lastResetNonce = current.resetNonce;
        camera.position.z = CAMERA_Z;
        applyPreset(current.preset);
        lastPreset = current.preset;
        lastViewNonce = current.viewNonce;
      } else if (current.preset !== lastPreset || current.viewNonce !== lastViewNonce) {
        applyPreset(current.preset);
        lastPreset = current.preset;
        lastViewNonce = current.viewNonce;
      }
      if (current.zoomRequest.nonce !== lastZoomNonce) {
        lastZoomNonce = current.zoomRequest.nonce;
        zoomBy(-0.9 * current.zoomRequest.direction);
      }

      const ease = reducedMotion ? 1 : 0.12;
      root.rotation.y += (targetRotation.x - root.rotation.y) * ease;
      root.rotation.x += (targetRotation.y - root.rotation.x) * ease;

      for (const [name, mesh] of parts) {
        mesh.visible = current.visible[name] !== false;
        const material = mesh.material as THREE.MeshPhysicalMaterial;
        if (name === 'parenchyma') {
          material.opacity = THREE.MathUtils.clamp(current.parenchymaOpacity / 100, 0.05, 1);
          material.depthWrite = material.opacity > 0.92;
        }
      }

      // The cutaway sweeps a plane through the model along the view axis.
      clipPlane.constant = 2.6 - (current.clipPercent / 100) * 5.2;

      const plane = current.slicePlane;
      slice.visible = plane !== null;
      if (plane) {
        const size = `${plane.xMin},${plane.xMax},${plane.yMin},${plane.yMax}`;
        if (size !== sliceSize) {
          sliceSize = size;
          slice.scale.set(plane.xMax - plane.xMin, plane.yMax - plane.yMin, 1);
        }
        slice.position.set((plane.xMin + plane.xMax) / 2, (plane.yMin + plane.yMax) / 2, plane.z);
      }

      renderer.render(scene, camera);
    };
    animate();

    return () => {
      disposed = true;
      cancelAnimationFrame(installFrame);
      cancelAnimationFrame(frame);
      cancelAnimationFrame(resizeFrame);
      resizeObserver.disconnect();
      visibility?.disconnect();
      renderer.domElement.removeEventListener('pointerdown', onPointerDown);
      renderer.domElement.removeEventListener('pointermove', onPointerMove);
      renderer.domElement.removeEventListener('pointerup', stopPointer);
      renderer.domElement.removeEventListener('pointercancel', stopPointer);
      renderer.domElement.removeEventListener('wheel', onWheel);
      planeEdgeGeometry.dispose();
      planeEdgeMaterial.dispose();
      // The fill is a Mesh, so the traverse below disposes it, unless it was never added.
      if (!slice.parent) {
        planeGeometry.dispose();
        planeMaterial.dispose();
      }
      scene.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          child.geometry.dispose();
          const material = child.material;
          if (Array.isArray(material)) material.forEach((m) => m.dispose());
          else material.dispose();
        }
      });
      renderer.dispose();
      // dispose() doesn't release the WebGL context, and browsers cap how many
      // stay alive, so let it go now rather than at garbage collection.
      renderer.forceContextLoss();
      renderer.domElement.remove();
    };
  }, [referenceCase]);

  return (
    <div className="relative h-full w-full">
      <div ref={hostRef} className="h-full w-full" />
      {status !== 'ready' ? (
        <output className="pointer-events-none absolute inset-0 grid place-items-center px-8 text-center text-sm leading-6 text-white/72">
          {status === 'loading' ? (
            <span>
              {`Loading ${referenceCase.label}`}
              {/* The percentage is for sighted readers; announcing every 5% is noise. */}
              <span aria-hidden="true">{progress !== null ? `, ${progress}%` : ''}</span>…
            </span>
          ) : status === 'no-webgl' ? (
            'Your browser can’t show 3D here. The scores and the rest of the page still work.'
          ) : (
            'This kidney didn’t load. Try reloading the page, and tell me if it keeps happening.'
          )}
        </output>
      ) : null}
    </div>
  );
}

export default ReferenceCaseScene;
