'use client';

// Renders a real kidney: a mesh built by the pipeline from the KiTS23 reference
// labels, loaded from a GLB rather than generated in the browser. The procedural
// scene in kidney-scene.tsx stays as the synthetic teaching model; this one
// shows what the pipeline actually produced.
//
// Lighting, interaction and camera behaviour deliberately mirror the procedural
// scene so switching between a synthetic case and a real one does not feel like
// moving to a different application.

import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

import type { ReferenceCase } from '@/lib/reference-cases';
import type { ViewPreset } from '@/components/kidney-scene';

type ReferenceCaseSceneProps = {
  referenceCase: ReferenceCase;
  visible: Record<string, boolean>;
  parenchymaOpacity: number;
  clipPercent: number;
  preset: ViewPreset;
};

type Status = 'loading' | 'ready' | 'failed';

export function ReferenceCaseScene({
  referenceCase,
  visible,
  parenchymaOpacity,
  clipPercent,
  preset,
}: ReferenceCaseSceneProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [status, setStatus] = useState<Status>('loading');

  // Live values the animation loop reads without re-running the whole effect.
  const stateRef = useRef({ visible, parenchymaOpacity, clipPercent, preset });

  useEffect(() => {
    stateRef.current = { visible, parenchymaOpacity, clipPercent, preset };
  }, [visible, parenchymaOpacity, clipPercent, preset]);

  // The parent remounts this component per case, so status starts at 'loading'
  // for each one and is only advanced from the loader's callbacks.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return undefined;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        antialias: true,
        alpha: true,
        powerPreference: 'high-performance',
      });
    } catch {
      // Match the procedural scene: report WebGL loss in the host element
      // rather than through state, so the effect stays free of setState.
      host.innerHTML =
        '<div class="grid h-full min-h-[360px] place-items-center p-8 text-center text-xs leading-5 text-white/40">3D rendering is unavailable in this browser. The measurements and safety information remain accessible.</div>';
      return undefined;
    }

    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x000000, 0);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.12;
    renderer.localClippingEnabled = true;
    host.append(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 100);
    camera.position.set(0, 0.08, 8.8);

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

    const clipPlane = new THREE.Plane(new THREE.Vector3(0, 0, -1), 0);
    const parts = new Map<string, THREE.Mesh>();
    let disposed = false;

    const loader = new GLTFLoader();
    loader.load(
      referenceCase.mesh,
      (gltf) => {
        if (disposed) return;

        const byName = new Map(referenceCase.structures.map((s) => [s.name, s]));
        gltf.scene.traverse((child) => {
          if (!(child instanceof THREE.Mesh)) return;
          const structure = byName.get(child.name);
          if (!structure) return;
          const material = new THREE.MeshPhysicalMaterial({
            color: new THREE.Color(structure.colour),
            roughness: 0.62,
            metalness: 0.02,
            clearcoat: 0.25,
            transparent: true,
            opacity: structure.opacity,
            depthWrite: structure.opacity > 0.92,
            side: THREE.DoubleSide,
            clippingPlanes: [clipPlane],
          });
          child.material = material;
          child.visible = structure.visible;
          parts.set(child.name, child);
        });

        // Frame on the kidney itself. Cases that carry surrounding context
        // (body outline, ribs, liver) would otherwise scale the kidney down to
        // nothing, since the outline is an order of magnitude larger.
        gltf.scene.updateMatrixWorld(true);
        const framing = new THREE.Box3();
        const framingNames = new Set(['parenchyma', 'tumour', 'cyst']);
        for (const [name, mesh] of parts) {
          if (framingNames.has(name)) framing.expandByObject(mesh);
        }
        const box = framing.isEmpty() ? new THREE.Box3().setFromObject(gltf.scene) : framing;
        const size = box.getSize(new THREE.Vector3());
        const centre = box.getCenter(new THREE.Vector3());
        const longest = Math.max(size.x, size.y, size.z) || 1;
        const scale = 3.4 / longest;

        // Scale first, then translate by the scaled centre, so the kidney ends
        // up at the origin whatever its position in the patient coordinates.
        gltf.scene.scale.setScalar(scale);
        gltf.scene.position.copy(centre).multiplyScalar(-scale);
        model.add(gltf.scene);

        setStatus('ready');
      },
      undefined,
      () => {
        if (!disposed) setStatus('failed');
      },
    );

    const targetRotation = new THREE.Vector2(root.rotation.y, root.rotation.x);
    let dragging = false;
    let pointerX = 0;
    let pointerY = 0;
    let lastPreset = stateRef.current.preset;
    let frame = 0;
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const onPointerDown = (event: PointerEvent) => {
      dragging = true;
      pointerX = event.clientX;
      pointerY = event.clientY;
      renderer.domElement.style.cursor = 'grabbing';
      renderer.domElement.setPointerCapture(event.pointerId);
    };

    const onPointerMove = (event: PointerEvent) => {
      if (!dragging) return;
      targetRotation.x += (event.clientX - pointerX) * 0.008;
      targetRotation.y = THREE.MathUtils.clamp(
        targetRotation.y + (event.clientY - pointerY) * 0.006,
        -1.25,
        1.25,
      );
      pointerX = event.clientX;
      pointerY = event.clientY;
    };

    const stopDragging = (event: PointerEvent) => {
      dragging = false;
      renderer.domElement.releasePointerCapture?.(event.pointerId);
      renderer.domElement.style.cursor = 'grab';
    };

    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      camera.position.z = THREE.MathUtils.clamp(
        camera.position.z + event.deltaY * 0.004,
        5.2,
        10.6,
      );
    };

    renderer.domElement.style.cursor = 'grab';
    renderer.domElement.style.touchAction = 'none';
    renderer.domElement.addEventListener('pointerdown', onPointerDown);
    renderer.domElement.addEventListener('pointermove', onPointerMove);
    renderer.domElement.addEventListener('pointerup', stopDragging);
    renderer.domElement.addEventListener('pointercancel', stopDragging);
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

    const presetRotations: Record<ViewPreset, [number, number]> = {
      anterior: [Math.PI, 0],
      posterior: [0, 0],
      lateral: [Math.PI / 2, 0],
      superior: [Math.PI, -1.1],
    };
    targetRotation.x = presetRotations.anterior[0];

    const animate = () => {
      frame = requestAnimationFrame(animate);
      const current = stateRef.current;

      if (current.preset !== lastPreset) {
        const [y, x] = presetRotations[current.preset];
        targetRotation.set(y, x);
        lastPreset = current.preset;
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

      renderer.render(scene, camera);
    };
    animate();

    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      cancelAnimationFrame(resizeFrame);
      resizeObserver.disconnect();
      renderer.domElement.removeEventListener('pointerdown', onPointerDown);
      renderer.domElement.removeEventListener('pointermove', onPointerMove);
      renderer.domElement.removeEventListener('pointerup', stopDragging);
      renderer.domElement.removeEventListener('pointercancel', stopDragging);
      renderer.domElement.removeEventListener('wheel', onWheel);
      scene.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          child.geometry.dispose();
          const material = child.material;
          if (Array.isArray(material)) material.forEach((m) => m.dispose());
          else material.dispose();
        }
      });
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [referenceCase]);

  return (
    <div className="relative h-full w-full">
      <div ref={hostRef} className="h-full w-full" />
      {status !== 'ready' ? (
        <div className="pointer-events-none absolute inset-0 grid place-items-center px-8 text-center text-xs leading-5 text-white/40">
          {status === 'loading'
            ? `Loading ${referenceCase.label}…`
            : 'This mesh could not be displayed in your browser. The measurements and safety information below are unaffected.'}
        </div>
      ) : null}
    </div>
  );
}

export default ReferenceCaseScene;
