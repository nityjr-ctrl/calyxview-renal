'use client';

import { useEffect, useRef } from 'react';
import * as THREE from 'three';

export type AnatomyLayers = {
  kidney: boolean;
  tumour: boolean;
  arteries: boolean;
  veins: boolean;
  collecting: boolean;
};

export type ViewPreset = 'anterior' | 'posterior' | 'lateral' | 'superior';

type KidneySceneProps = {
  layers: AnatomyLayers;
  kidneyOpacity: number;
  marginMm: number;
  clipPercent: number;
  preset: ViewPreset;
  trainingStep?: number;
};

type SceneObjects = {
  kidney?: THREE.Mesh;
  tumour?: THREE.Group;
  arteries?: THREE.Group;
  veins?: THREE.Group;
  collecting?: THREE.Group;
  margin?: THREE.Mesh;
  clipPlane?: THREE.Mesh;
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

function tube(
  points: Array<[number, number, number]>,
  color: number,
  radius: number,
  opacity = 1,
) {
  const curve = new THREE.CatmullRomCurve3(
    points.map(([x, y, z]) => new THREE.Vector3(x, y, z)),
  );
  const geometry = new THREE.TubeGeometry(curve, 40, radius, 10, false);
  const material = new THREE.MeshPhysicalMaterial({
    color,
    emissive: color,
    emissiveIntensity: 0.08,
    roughness: 0.38,
    transparent: opacity < 1,
    opacity,
  });
  return new THREE.Mesh(geometry, material);
}

function disposeMaterial(material: THREE.Material | THREE.Material[]) {
  if (Array.isArray(material)) {
    material.forEach((item) => item.dispose());
    return;
  }
  material.dispose();
}

export function KidneyScene({
  layers,
  kidneyOpacity,
  marginMm,
  clipPercent,
  preset,
  trainingStep = -1,
}: KidneySceneProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const stateRef = useRef({
    layers,
    kidneyOpacity,
    marginMm,
    clipPercent,
    preset,
    trainingStep,
  });

  useEffect(() => {
    stateRef.current = {
      layers,
      kidneyOpacity,
      marginMm,
      clipPercent,
      preset,
      trainingStep,
    };
  }, [layers, kidneyOpacity, marginMm, clipPercent, preset, trainingStep]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 100);
    camera.position.set(0, 0.08, 8.8);

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
        '<div class="grid h-full min-h-[360px] place-items-center p-8 text-center text-xs leading-5 text-white/40">3D rendering is unavailable in this browser. The safety, import and training workflows remain accessible.</div>';
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
      'Interactive synthetic three-dimensional kidney, tumour, vessels, and collecting system',
    );
    renderer.domElement.setAttribute('role', 'img');
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

    const root = new THREE.Group();
    root.position.y = 0.34;
    root.rotation.set(-0.08, -0.42, -0.08);
    scene.add(root);

    const objects: SceneObjects = {};
    const clippingPlane = new THREE.Plane(new THREE.Vector3(-1, 0, 0), 10);
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
    kidney.castShadow = true;
    root.add(kidney);
    objects.kidney = kidney;

    const tumourGroup = new THREE.Group();
    const tumourMaterial = new THREE.MeshPhysicalMaterial({
      color: 0xf07865,
      emissive: 0x6b1d19,
      emissiveIntensity: 0.18,
      roughness: 0.3,
      clearcoat: 0.62,
    });
    const tumour = new THREE.Mesh(
      new THREE.IcosahedronGeometry(0.36, 5),
      tumourMaterial,
    );
    tumour.position.set(-0.79, 0.38, 0.36);
    tumour.scale.set(1.08, 0.92, 1);
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
    objects.tumour = tumourGroup;

    const margin = new THREE.Mesh(
      new THREE.IcosahedronGeometry(0.5, 4),
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
    objects.margin = margin;

    const arteries = new THREE.Group();
    arteries.add(
      tube(
        [
          [1.7, -0.02, 0.02],
          [1.05, -0.02, 0.02],
          [0.48, 0.02, 0.02],
          [-0.12, 0.1, 0.02],
        ],
        0xffa74f,
        0.075,
      ),
      tube(
        [
          [0.42, 0.02, 0.02],
          [0.08, 0.38, 0.06],
          [-0.35, 0.64, 0.15],
          [-0.67, 0.49, 0.28],
        ],
        0xffb45e,
        0.046,
      ),
      tube(
        [
          [0.38, 0.0, 0.0],
          [0.08, -0.36, -0.02],
          [-0.42, -0.82, 0.02],
          [-0.62, -1.08, 0.08],
        ],
        0xffb45e,
        0.043,
      ),
      tube(
        [
          [0.02, 0.39, 0.08],
          [-0.17, 0.82, -0.08],
          [-0.35, 1.15, -0.02],
        ],
        0xffbf73,
        0.032,
      ),
    );
    root.add(arteries);
    objects.arteries = arteries;

    const veins = new THREE.Group();
    veins.add(
      tube(
        [
          [1.75, -0.18, -0.08],
          [1.08, -0.16, -0.08],
          [0.52, -0.13, -0.08],
          [-0.08, -0.08, -0.02],
        ],
        0x6aaee8,
        0.088,
        0.96,
      ),
      tube(
        [
          [0.42, -0.13, -0.08],
          [0.02, 0.26, -0.1],
          [-0.44, 0.56, -0.05],
        ],
        0x7fc4f2,
        0.047,
        0.94,
      ),
      tube(
        [
          [0.41, -0.14, -0.08],
          [0.04, -0.52, -0.1],
          [-0.42, -0.86, -0.04],
        ],
        0x7fc4f2,
        0.047,
        0.94,
      ),
    );
    root.add(veins);
    objects.veins = veins;

    const collecting = new THREE.Group();
    collecting.add(
      tube(
        [
          [0.36, 0.05, -0.02],
          [0.08, -0.08, -0.01],
          [-0.16, -0.22, 0],
          [-0.26, -0.45, 0.01],
        ],
        0x8bd1d6,
        0.058,
        0.84,
      ),
      tube(
        [
          [-0.08, -0.15, 0],
          [-0.28, 0.22, 0.03],
          [-0.39, 0.62, 0.02],
        ],
        0xa5e5df,
        0.038,
        0.82,
      ),
      tube(
        [
          [-0.18, -0.26, 0],
          [-0.34, -0.63, 0.02],
          [-0.39, -0.98, 0.02],
        ],
        0xa5e5df,
        0.038,
        0.82,
      ),
      tube(
        [
          [-0.26, -0.45, 0.01],
          [-0.18, -0.94, 0.02],
          [0.02, -1.67, 0.03],
          [0.16, -2.45, 0.04],
        ],
        0x88d1d1,
        0.045,
        0.82,
      ),
    );
    root.add(collecting);
    objects.collecting = collecting;

    const planeMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(3.7, 3.7),
      new THREE.MeshBasicMaterial({
        color: 0x9df8d0,
        transparent: true,
        opacity: 0.055,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    );
    planeMesh.rotation.y = Math.PI / 2;
    planeMesh.visible = false;
    root.add(planeMesh);
    objects.clipPlane = planeMesh;

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
    let dragging = false;
    let pointerX = 0;
    let pointerY = 0;
    let lastPreset = stateRef.current.preset;
    let lastInteraction = performance.now();
    let frame = 0;
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const onPointerDown = (event: PointerEvent) => {
      dragging = true;
      pointerX = event.clientX;
      pointerY = event.clientY;
      lastInteraction = performance.now();
      renderer.domElement.setPointerCapture(event.pointerId);
      renderer.domElement.style.cursor = 'grabbing';
    };

    const onPointerMove = (event: PointerEvent) => {
      if (!dragging) return;
      const deltaX = event.clientX - pointerX;
      const deltaY = event.clientY - pointerY;
      targetRotation.x += deltaX * 0.008;
      targetRotation.y = THREE.MathUtils.clamp(
        targetRotation.y + deltaY * 0.006,
        -1.25,
        1.25,
      );
      pointerX = event.clientX;
      pointerY = event.clientY;
      lastInteraction = performance.now();
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
      lastInteraction = performance.now();
    };

    renderer.domElement.style.cursor = 'grab';
    renderer.domElement.style.touchAction = 'none';
    renderer.domElement.addEventListener('pointerdown', onPointerDown);
    renderer.domElement.addEventListener('pointermove', onPointerMove);
    renderer.domElement.addEventListener('pointerup', stopDragging);
    renderer.domElement.addEventListener('pointercancel', stopDragging);
    renderer.domElement.addEventListener('wheel', onWheel, { passive: false });

    const resize = () => {
      const width = Math.max(1, host.clientWidth);
      const height = Math.max(1, host.clientHeight);
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    };
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(host);
    resize();

    const presetRotations: Record<ViewPreset, [number, number]> = {
      anterior: [-0.42, -0.08],
      posterior: [Math.PI - 0.42, -0.08],
      lateral: [Math.PI / 2, -0.05],
      superior: [-0.18, -1.12],
    };

    const animate = () => {
      frame = requestAnimationFrame(animate);
      const current = stateRef.current;
      if (current.preset !== lastPreset) {
        const [y, x] = presetRotations[current.preset];
        targetRotation.set(y, x);
        lastPreset = current.preset;
        lastInteraction = performance.now();
      }

      if (!reducedMotion && !dragging && performance.now() - lastInteraction > 3500) {
        targetRotation.x += 0.0012;
      }

      root.rotation.y += (targetRotation.x - root.rotation.y) * 0.075;
      root.rotation.x += (targetRotation.y - root.rotation.x) * 0.075;

      objects.kidney!.visible = current.layers.kidney;
      objects.tumour!.visible = current.layers.tumour;
      objects.arteries!.visible = current.layers.arteries;
      objects.veins!.visible = current.layers.veins;
      objects.collecting!.visible = current.layers.collecting;
      kidneyMaterial.opacity = current.kidneyOpacity / 100;

      const marginScale = 0.82 + current.marginMm * 0.055;
      objects.margin!.scale.setScalar(marginScale);
      objects.margin!.visible = current.layers.tumour;

      if (current.clipPercent <= 0) {
        clippingPlane.constant = 10;
        objects.clipPlane!.visible = false;
      } else {
        const planeX = THREE.MathUtils.lerp(1.06, -0.88, current.clipPercent / 100);
        clippingPlane.constant = planeX;
        objects.clipPlane!.position.x = planeX;
        objects.clipPlane!.visible = true;
      }

      const pulse = 1 + Math.sin(performance.now() * 0.0028) * 0.025;
      tumour.scale.setScalar(
        current.trainingStep === 1 || current.trainingStep === 2 ? pulse : 1,
      );
      arteries.scale.setScalar(current.trainingStep === 2 ? pulse : 1);
      collecting.scale.setScalar(current.trainingStep === 3 ? pulse : 1);

      renderer.render(scene, camera);
    };
    animate();

    return () => {
      cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      renderer.domElement.removeEventListener('pointerdown', onPointerDown);
      renderer.domElement.removeEventListener('pointermove', onPointerMove);
      renderer.domElement.removeEventListener('pointerup', stopDragging);
      renderer.domElement.removeEventListener('pointercancel', stopDragging);
      renderer.domElement.removeEventListener('wheel', onWheel);
      scene.traverse((object) => {
        if (object instanceof THREE.Mesh) {
          object.geometry.dispose();
          disposeMaterial(object.material);
        }
      });
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, []);

  return <div ref={hostRef} className="h-full min-h-[360px] w-full" />;
}
