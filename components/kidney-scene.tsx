'use client';

// The teaching kidney: a hand-made RIGHT kidney with a tumour, drawn in code.
// No patient data is in it.
//
// Scene axes: +x is the patient's left (so +x is medial for this right
// kidney), +y is superior and +z is anterior. One scene unit is about 39 mm,
// which makes the tumour 2.8 cm across and the kidney about 12 cm long.
//
// At the hilum the structures run front to back as vein (z about +0.24),
// artery (about +0.02) and pelvis (about -0.18). The pelvis narrows medially to
// the pelviureteric junction just outside the hilum, and the ureter runs down
// medial to the lower pole. Tube positions were checked so that different
// structures don't intersect, and so that the nearest calyx sits 3.6 mm from
// the tumour, which is the N value the lesson uses.

import { useEffect, useRef } from 'react';
import * as THREE from 'three';

export type AnatomyLayers = {
  kidney: boolean;
  tumour: boolean;
  arteries: boolean;
  veins: boolean;
  collecting: boolean;
};

/** Views named from the patient's side: 'left' looks at the patient's left side. */
export type ViewPreset = 'anterior' | 'posterior' | 'left' | 'right' | 'superior';

/** A press of a zoom button: bump nonce, and direction 1 zooms in, -1 out. */
export type ZoomRequest = { nonce: number; direction: 1 | -1 };

const NO_ZOOM: ZoomRequest = { nonce: 0, direction: 1 };

type KidneySceneProps = {
  layers: AnatomyLayers;
  kidneyOpacity: number;
  marginMm: number;
  clipPercent: number;
  preset: ViewPreset;
  /** Bump to re-apply the current preset, e.g. when its button is pressed again. */
  viewNonce?: number;
  /** Bump to snap back to the preset and the default zoom. */
  resetNonce?: number;
  /** From the zoom buttons, for keyboard users and anyone who can't pinch. */
  zoomRequest?: ZoomRequest;
  trainingStep?: number;
  /**
   * For the embedded overview preview. Vertical swipes scroll the page
   * (touch-action: pan-y), the mouse wheel only zooms with Ctrl or Cmd held,
   * and autoTurn decides whether it turns by itself.
   */
  allowPageScroll?: boolean;
  /**
   * Overview preview only: turn slowly by itself until someone touches it.
   * Switching it back on starts it turning again.
   */
  autoTurn?: boolean;
  /** Called when a touch or Ctrl-scroll stops the turning, so a control can say so. */
  onStopTurning?: () => void;
  /** Called when someone turns the model by hand. */
  onUserRotate?: () => void;
};

type Point = [number, number, number];

const MM_PER_UNIT = 38.9;
const TUMOUR_CENTRE: Point = [-0.79, 0.3, 0.36];
const TUMOUR_RADIUS = 0.36;
const CAMERA_Z = 8.8;

// Rotation targets as [root.rotation.y, root.rotation.x].
const PRESET_ROTATIONS: Record<ViewPreset, [number, number]> = {
  anterior: [-0.42, -0.08],
  posterior: [Math.PI - 0.42, -0.08],
  // +x is the patient's left, so turning by -90 degrees brings it to the camera.
  left: [-Math.PI / 2, -0.05],
  right: [Math.PI / 2, -0.05],
  // Tip the top of the kidney towards the camera; anterior ends up at the bottom.
  superior: [-0.18, 1.12],
};

function kidneyGeometry() {
  const geometry = new THREE.SphereGeometry(1, 96, 72);
  const position = geometry.attributes.position;

  for (let index = 0; index < position.count; index += 1) {
    let x = position.getX(index) * 1.08;
    const y = position.getY(index) * 1.52;
    const z = position.getZ(index) * 0.68;
    const hilum = Math.exp(-Math.pow(y / 0.62, 2));
    const medial = Math.max(0, x / 1.08);
    const depth = 1 - Math.min(0.78, Math.abs(z) / 0.68) * 0.55;

    x -= 0.57 * hilum * medial * depth;
    x -= 0.06 * Math.sin(y * 2.2);
    position.setXYZ(index, x, y, z);
  }

  geometry.computeVertexNormals();
  return geometry;
}

function tubeMaterial(color: number, opacity: number) {
  return new THREE.MeshPhysicalMaterial({
    color,
    emissive: color,
    emissiveIntensity: 0.08,
    roughness: 0.38,
    transparent: opacity < 1,
    opacity,
  });
}

/** A tube along a smooth curve. With endRadius it tapers linearly along its length. */
function tube(points: Point[], color: number, radius: number, opacity = 1, endRadius?: number) {
  const curve = new THREE.CatmullRomCurve3(points.map(([x, y, z]) => new THREE.Vector3(x, y, z)));
  const tubular = 48;
  const radial = 12;
  const geometry = new THREE.TubeGeometry(curve, tubular, radius, radial, false);

  if (endRadius !== undefined && endRadius !== radius) {
    // TubeGeometry lays out (tubular + 1) rings of (radial + 1) vertices, each
    // ring centred on curve.getPointAt(i / tubular). Scale each ring about its
    // centre. The radial normals stay close enough for this gentle taper.
    const position = geometry.attributes.position;
    const centre = new THREE.Vector3();
    const vertex = new THREE.Vector3();
    for (let ring = 0; ring <= tubular; ring += 1) {
      const t = ring / tubular;
      curve.getPointAt(t, centre);
      const scale = (radius + (endRadius - radius) * t) / radius;
      for (let step = 0; step <= radial; step += 1) {
        const index = ring * (radial + 1) + step;
        vertex.fromBufferAttribute(position, index).sub(centre).multiplyScalar(scale).add(centre);
        position.setXYZ(index, vertex.x, vertex.y, vertex.z);
      }
    }
    position.needsUpdate = true;
  }

  return new THREE.Mesh(geometry, tubeMaterial(color, opacity));
}

/** A small rounded cup, used for the calyces at the ends of the infundibula. */
function cup(at: Point, color: number, radius: number, opacity: number) {
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, 20, 14), tubeMaterial(color, opacity));
  mesh.position.set(...at);
  return mesh;
}

function disposeMaterial(material: THREE.Material | THREE.Material[]) {
  if (Array.isArray(material)) {
    material.forEach((item) => item.dispose());
    return;
  }
  material.dispose();
}

/** The angle equivalent to `angle` that is nearest to `target`. */
function nearestTurn(angle: number, target: number) {
  const turn = Math.PI * 2;
  return target + ((((angle - target) % turn) + turn + Math.PI) % turn) - Math.PI;
}

export function KidneyScene({
  layers,
  kidneyOpacity,
  marginMm,
  clipPercent,
  preset,
  viewNonce = 0,
  resetNonce = 0,
  zoomRequest = NO_ZOOM,
  trainingStep = -1,
  allowPageScroll = false,
  autoTurn = false,
  onStopTurning,
  onUserRotate,
}: KidneySceneProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const stateRef = useRef({
    layers,
    kidneyOpacity,
    marginMm,
    clipPercent,
    preset,
    viewNonce,
    resetNonce,
    zoomRequest,
    trainingStep,
  });
  const onUserRotateRef = useRef(onUserRotate);
  const allowPageScrollRef = useRef(allowPageScroll);
  const autoTurnRef = useRef(autoTurn);
  const onStopTurningRef = useRef(onStopTurning);

  useEffect(() => {
    stateRef.current = {
      layers,
      kidneyOpacity,
      marginMm,
      clipPercent,
      preset,
      viewNonce,
      resetNonce,
      zoomRequest,
      trainingStep,
    };
  }, [layers, kidneyOpacity, marginMm, clipPercent, preset, viewNonce, resetNonce, zoomRequest, trainingStep]);

  useEffect(() => {
    onUserRotateRef.current = onUserRotate;
  }, [onUserRotate]);

  useEffect(() => {
    allowPageScrollRef.current = allowPageScroll;
  }, [allowPageScroll]);

  useEffect(() => {
    autoTurnRef.current = autoTurn;
  }, [autoTurn]);

  useEffect(() => {
    onStopTurningRef.current = onStopTurning;
  }, [onStopTurning]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 100);
    camera.position.set(0, 0.08, CAMERA_Z);

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        antialias: true,
        alpha: true,
        preserveDrawingBuffer: true,
        powerPreference: 'high-performance',
      });
    } catch {
      host.innerHTML =
        '<div class="grid h-full min-h-[300px] place-items-center p-8 text-center text-sm leading-6 text-white/70">Your browser can’t show 3D here. The rest of the page still works.</div>';
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x000000, 0);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.12;
    renderer.localClippingEnabled = true;
    renderer.domElement.id = 'renal-3d-canvas';
    renderer.domElement.setAttribute(
      'aria-label',
      'The teaching kidney in 3D: a hand-made right kidney with a tumour, arteries, veins and a collecting system',
    );
    renderer.domElement.setAttribute('role', 'img');
    renderer.domElement.style.display = 'block';
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
    host.appendChild(renderer.domElement);

    const hemi = new THREE.HemisphereLight(0xc8ffe9, 0x06110e, 2.1);
    scene.add(hemi);
    const key = new THREE.DirectionalLight(0xb9ffe0, 5.2);
    key.position.set(-3, 4, 5);
    scene.add(key);
    const rim = new THREE.PointLight(0x4ecda0, 15, 10);
    rim.position.set(3, -1, -3);
    scene.add(rim);
    const warm = new THREE.PointLight(0xffa46c, 7, 8);
    warm.position.set(-3, 1.5, 2.5);
    scene.add(warm);

    // Start in whatever view is selected, so a remount (switching back from a
    // KiTS kidney, say) doesn't show a different view from the one the toolbar says.
    const root = new THREE.Group();
    root.position.y = 0.34;
    const [startY, startX] = PRESET_ROTATIONS[stateRef.current.preset];
    root.rotation.set(startX, startY, -0.08);
    scene.add(root);

    // The cutaway is a world-space plane facing the camera. It peels the
    // kidney away from the side nearest you, whatever the view, and leaves the
    // tumour, vessels and collecting system in place.
    const clippingPlane = new THREE.Plane(new THREE.Vector3(0, 0, -1), 10);
    const kidneyMaterial = new THREE.MeshPhysicalMaterial({
      color: 0x69b895,
      roughness: 0.34,
      metalness: 0.02,
      transparent: true,
      opacity: 0.72,
      clearcoat: 0.55,
      clearcoatRoughness: 0.42,
      side: THREE.DoubleSide,
      clippingPlanes: [clippingPlane],
    });
    const kidney = new THREE.Mesh(kidneyGeometry(), kidneyMaterial);
    // Draw the see-through kidney after the structures inside it, so they show
    // through it rather than being painted over it.
    kidney.renderOrder = 1;
    root.add(kidney);

    // Tumour on the lateral edge, between the polar lines, bulging from the
    // anterior face. About 37% of it sits outside the kidney.
    const tumourGroup = new THREE.Group();
    const tumour = new THREE.Mesh(
      new THREE.IcosahedronGeometry(TUMOUR_RADIUS, 5),
      new THREE.MeshPhysicalMaterial({
        color: 0xf07865,
        emissive: 0x6b1d19,
        emissiveIntensity: 0.18,
        roughness: 0.3,
        clearcoat: 0.62,
      }),
    );
    tumour.position.set(...TUMOUR_CENTRE);
    tumourGroup.add(tumour);

    const tumourCore = new THREE.Mesh(
      new THREE.IcosahedronGeometry(0.22, 3),
      new THREE.MeshBasicMaterial({
        color: 0xffb19b,
        transparent: true,
        opacity: 0.18,
        wireframe: true,
      }),
    );
    tumourCore.position.copy(tumour.position);
    tumourGroup.add(tumourCore);
    root.add(tumourGroup);

    // Margin shell: the tumour radius plus the chosen margin, to scale.
    const margin = new THREE.Mesh(
      new THREE.IcosahedronGeometry(1, 4),
      new THREE.MeshBasicMaterial({
        color: 0xffc3ae,
        transparent: true,
        opacity: 0.16,
        wireframe: true,
        depthWrite: false,
      }),
    );
    margin.position.copy(tumour.position);
    root.add(margin);

    const arteries = new THREE.Group();
    arteries.add(
      // Main renal artery, between the vein in front and the pelvis behind.
      tube([[1.7, 0.03, 0.02], [1.05, 0.04, 0.02], [0.5, 0.07, 0.02], [-0.08, 0.14, 0.02]], 0xffa74f, 0.075),
      // Segmental branch that feeds the tumour.
      tube([[0.46, 0.07, 0.02], [0.12, 0.36, 0.1], [-0.33, 0.52, 0.2], [-0.66, 0.4, 0.3]], 0xffb45e, 0.046),
      // Lower-pole branch.
      tube([[0.42, 0.07, 0.02], [0.12, -0.32, 0.04], [-0.38, -0.8, 0.06], [-0.6, -1.06, 0.08]], 0xffb45e, 0.043),
      // Upper-pole branch.
      tube([[0.1, 0.34, 0.09], [-0.1, 0.78, 0.02], [-0.3, 1.12, -0.02]], 0xffbf73, 0.032),
    );
    root.add(arteries);

    const veins = new THREE.Group();
    veins.add(
      // Main renal vein, the most anterior structure at the hilum.
      tube([[1.75, -0.12, 0.25], [1.08, -0.1, 0.25], [0.52, -0.06, 0.23], [-0.02, -0.04, 0.2]], 0x6aaee8, 0.088, 0.96),
      tube([[0.44, -0.05, 0.23], [0.22, 0.4, 0.3], [-0.02, 0.86, 0.22], [-0.2, 1.12, 0.14]], 0x7fc4f2, 0.047, 0.94),
      tube([[0.42, -0.06, 0.23], [0.18, -0.52, 0.24], [-0.2, -0.98, 0.18]], 0x7fc4f2, 0.047, 0.94),
    );
    root.add(veins);

    const collecting = new THREE.Group();
    const calyxColour = 0xa5e5df;
    collecting.add(
      // Renal pelvis, the most posterior hilar structure. Wide in the sinus,
      // narrowing medially to the pelviureteric junction just outside the hilum.
      tube([[0.02, -0.08, -0.17], [0.3, -0.18, -0.19], [0.6, -0.36, -0.19], [0.86, -0.58, -0.17]], 0x8bd1d6, 0.12, 0.84, 0.045),
      // Upper and lower infundibula, each ending in a calyx.
      tube([[0.06, -0.08, -0.17], [-0.16, 0.34, -0.13], [-0.32, 0.88, -0.1]], calyxColour, 0.038, 0.82),
      cup([-0.32, 0.88, -0.1], calyxColour, 0.05, 0.82),
      tube([[0, -0.14, -0.17], [-0.2, -0.56, -0.13], [-0.34, -0.98, -0.1]], calyxColour, 0.038, 0.82),
      cup([-0.34, -0.98, -0.1], calyxColour, 0.05, 0.82),
      // A calyx reaching towards the tumour. Its cup stops 3.6 mm short of it.
      tube([[-0.14, 0.26, -0.14], [-0.28, 0.27, -0.04], [-0.395, 0.266, 0.052]], calyxColour, 0.034, 0.82),
      cup([-0.395, 0.266, 0.052], calyxColour, 0.05, 0.82),
      // Ureter, running down medial to the lower pole.
      tube([[0.86, -0.58, -0.17], [0.97, -0.95, -0.18], [1.03, -1.67, -0.2], [1.05, -2.45, -0.22]], 0x88d1d1, 0.045, 0.82),
    );
    root.add(collecting);

    const floorRing = new THREE.Mesh(
      new THREE.RingGeometry(1.9, 1.92, 96),
      new THREE.MeshBasicMaterial({
        color: 0x6dd6ad,
        transparent: true,
        opacity: 0.1,
        side: THREE.DoubleSide,
      }),
    );
    floorRing.rotation.x = -Math.PI / 2;
    floorRing.position.y = -1.72;
    scene.add(floorRing);

    const targetRotation = new THREE.Vector2(root.rotation.y, root.rotation.x);
    const pointers = new Map<number, { x: number; y: number }>();
    let dragging = false;
    let pointerX = 0;
    let pointerY = 0;
    let pinchDistance = 0;
    let touched = false;
    let lastAutoTurn = autoTurnRef.current;
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

    // A touch stops the preview turning. Tell the page, so its button says so.
    const stopTurning = () => {
      if (touched) return;
      touched = true;
      if (autoTurnRef.current) onStopTurningRef.current?.();
    };

    const onPointerDown = (event: PointerEvent) => {
      stopTurning();
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
        // Carry on turning with the finger that is still down, without a jump.
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
      // In the overview preview a plain wheel scrolls the page.
      if (allowPageScrollRef.current && !(event.ctrlKey || event.metaKey)) return;
      event.preventDefault();
      stopTurning();
      zoomBy(event.deltaY * 0.004);
    };

    renderer.domElement.style.cursor = 'grab';
    renderer.domElement.style.touchAction = allowPageScrollRef.current ? 'pan-y' : 'none';
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
        renderer.setSize(width, height, false);
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
      });
    };
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(host);
    resize();

    // Don't draw frames nobody can see, such as the overview preview once the
    // reader has scrolled past it.
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
      // Take the short way round, however far the model was spun by hand.
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

      // Only the overview preview turns by itself, and only until someone
      // touches it or switches it off. The viewer holds still so the view
      // buttons stay true. Switching it back on clears the touch.
      const autoTurnNow = autoTurnRef.current;
      if (autoTurnNow && !lastAutoTurn) touched = false;
      lastAutoTurn = autoTurnNow;
      if (allowPageScrollRef.current && autoTurnNow && !reducedMotion && !touched && !dragging) {
        targetRotation.x += 0.0012;
      }

      const ease = reducedMotion ? 1 : 0.075;
      root.rotation.y += (targetRotation.x - root.rotation.y) * ease;
      root.rotation.x += (targetRotation.y - root.rotation.x) * ease;

      kidney.visible = current.layers.kidney;
      tumourGroup.visible = current.layers.tumour;
      arteries.visible = current.layers.arteries;
      veins.visible = current.layers.veins;
      collecting.visible = current.layers.collecting;
      kidneyMaterial.opacity = current.kidneyOpacity / 100;
      kidneyMaterial.depthWrite = kidneyMaterial.opacity > 0.92;

      margin.scale.setScalar(TUMOUR_RADIUS + current.marginMm / MM_PER_UNIT);
      margin.visible = current.layers.tumour;

      clippingPlane.constant =
        current.clipPercent <= 0 ? 10 : THREE.MathUtils.lerp(1.25, -0.95, current.clipPercent / 100);

      // Lesson steps: 1 tumour, 2 arteries, 3 collecting system, 4 tumour.
      const pulse = reducedMotion ? 1 : 1 + Math.sin(performance.now() * 0.0028) * 0.025;
      tumour.scale.setScalar(current.trainingStep === 1 || current.trainingStep === 4 ? pulse : 1);
      arteries.scale.setScalar(current.trainingStep === 2 ? pulse : 1);
      collecting.scale.setScalar(current.trainingStep === 3 ? pulse : 1);

      renderer.render(scene, camera);
    };
    animate();

    return () => {
      cancelAnimationFrame(frame);
      cancelAnimationFrame(resizeFrame);
      resizeObserver.disconnect();
      renderer.domElement.removeEventListener('pointerdown', onPointerDown);
      renderer.domElement.removeEventListener('pointermove', onPointerMove);
      renderer.domElement.removeEventListener('pointerup', stopPointer);
      renderer.domElement.removeEventListener('pointercancel', stopPointer);
      renderer.domElement.removeEventListener('wheel', onWheel);
      scene.traverse((object) => {
        if (object instanceof THREE.Mesh) {
          object.geometry.dispose();
          disposeMaterial(object.material);
        }
      });
      visibility?.disconnect();
      renderer.dispose();
      // dispose() doesn't release the WebGL context, and browsers cap how many
      // stay alive, so let it go now rather than at garbage collection.
      renderer.forceContextLoss();
      renderer.domElement.remove();
    };
  }, []);

  return <div ref={hostRef} className="h-full min-h-[300px] min-w-0 w-full overflow-hidden" />;
}
