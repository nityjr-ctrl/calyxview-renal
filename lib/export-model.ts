// GLB and STL downloads of a built kidney. Loaded only when someone clicks a
// download button. The STL stays in RAS millimetres, like Kidneys A to E; the
// GLB follows glTF's convention (metres, y-up, centred), see lib/glb.ts.

import { BufferAttribute, BufferGeometry, Mesh, MeshStandardMaterial, Scene } from 'three';
import { STLExporter } from 'three/examples/jsm/exporters/STLExporter.js';

import type { StructureMesh } from '@/lib/builder/build';
import { encodeGlb } from '@/lib/glb';

function stlScene(meshes: StructureMesh[]): Scene {
  const scene = new Scene();
  for (const mesh of meshes) {
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(mesh.positions, 3));
    geometry.setAttribute('normal', new BufferAttribute(mesh.normals, 3));
    geometry.setIndex(new BufferAttribute(mesh.indices, 1));
    const object = new Mesh(geometry, new MeshStandardMaterial());
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
  if (kind === 'glb') return new Blob([encodeGlb(meshes)], { type: 'model/gltf-binary' });
  const scene = stlScene(meshes);
  try {
    const result = new STLExporter().parse(scene, { binary: true }) as DataView;
    return new Blob([result.buffer as ArrayBuffer], { type: 'model/stl' });
  } finally {
    dispose(scene);
  }
}
