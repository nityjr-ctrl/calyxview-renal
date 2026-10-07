// GLB and STL downloads of a built kidney. Loaded only when someone clicks a
// download button. Vertices stay in RAS millimetres, like Kidneys A to E.

import { BufferAttribute, BufferGeometry, Color, Mesh, MeshStandardMaterial, Scene } from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { STLExporter } from 'three/examples/jsm/exporters/STLExporter.js';

import type { StructureMesh } from '@/lib/builder/build';

function sceneOf(meshes: StructureMesh[]): Scene {
  const scene = new Scene();
  for (const mesh of meshes) {
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(mesh.positions, 3));
    geometry.setAttribute('normal', new BufferAttribute(mesh.normals, 3));
    geometry.setIndex(new BufferAttribute(mesh.indices, 1));
    const material = new MeshStandardMaterial({
      color: new Color(mesh.colour),
      transparent: mesh.opacity < 1,
      opacity: mesh.opacity,
      roughness: 0.6,
    });
    const object = new Mesh(geometry, material);
    object.name = mesh.name;
    scene.add(object);
  }
  return scene;
}

function dispose(scene: Scene) {
  scene.traverse((child) => {
    if (child instanceof Mesh) {
      child.geometry.dispose();
      (child.material as MeshStandardMaterial).dispose();
    }
  });
}

export async function modelBlob(meshes: StructureMesh[], kind: 'glb' | 'stl'): Promise<Blob> {
  const scene = sceneOf(meshes);
  try {
    if (kind === 'glb') {
      const result = await new GLTFExporter().parseAsync(scene, { binary: true });
      return new Blob([result as ArrayBuffer], { type: 'model/gltf-binary' });
    }
    const result = new STLExporter().parse(scene, { binary: true }) as DataView;
    return new Blob([result.buffer as ArrayBuffer], { type: 'model/stl' });
  } finally {
    dispose(scene);
  }
}
