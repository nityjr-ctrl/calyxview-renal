import { readFile, readdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
import test from 'node:test';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { ensureSurfaceNormals, orientSurfaceOutward, smoothDisplaySurface } from '../lib/surface-normals.ts';

for (const name of ['reference-a', 'reference-b', 'reference-c', 'reference-d', 'reference-e', 'urogram']) {
  test(`${name}: finite unit normals preserve every vertex and index`, async () => {
    const file = name === 'urogram' ? '../public/urogram/model.glb' : `../public/models/${name}.glb`;
    const b = await readFile(new URL(file, import.meta.url));
    const loaded = await new GLTFLoader().parseAsync(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength), '');
    let meshes = 0;
    loaded.scene.traverse(child => {
      if (!child.isMesh) return;
      meshes++;
      const g = child.geometry, positions = g.attributes.position.array.slice(), indices = g.index.array.slice();
      ensureSurfaceNormals(g);
      assert.deepEqual(g.attributes.position.array, positions);
      assert.deepEqual(g.index.array, indices);
      const n = g.attributes.normal;
      assert.equal(n.count, g.attributes.position.count);
      for (let i = 0; i < n.count; i++) assert.ok(Math.abs(Math.hypot(n.getX(i), n.getY(i), n.getZ(i)) - 1) < 1e-5);
      orientSurfaceOutward(g);
      assert.deepEqual(g.attributes.position.array,positions);
      let signed=0;
      for(let i=0;i<indices.length;i+=3){
        const before=[indices[i],indices[i+1],indices[i+2]].sort((a,b)=>a-b);
        const after=[g.index.getX(i),g.index.getX(i+1),g.index.getX(i+2)];
        assert.deepEqual([...after].sort((a,b)=>a-b),before);
        const [a,b,c]=after.map(j=>[positions[j*3],positions[j*3+1],positions[j*3+2]]);
        signed+=a[0]*(b[1]*c[2]-b[2]*c[1])+a[1]*(b[2]*c[0]-b[0]*c[2])+a[2]*(b[0]*c[1]-b[1]*c[0]);
      }
      assert.ok(signed>0,`${name}/${child.name}: outward orientation`);
      const orientedIndices=g.index.array.slice();
      if (child.name === 'parenchyma') {
        const volume = () => {
          const p=g.attributes.position;let total=0;
          for(let i=0;i<indices.length;i+=3){const a=indices[i],b=indices[i+1],c=indices[i+2];total+=p.getX(a)*(p.getY(b)*p.getZ(c)-p.getZ(b)*p.getY(c))+p.getY(a)*(p.getZ(b)*p.getX(c)-p.getX(b)*p.getZ(c))+p.getZ(a)*(p.getX(b)*p.getY(c)-p.getY(b)*p.getX(c));}
          return Math.abs(total/6);
        };
        const before=volume();smoothDisplaySurface(g);
        let max=0;
        for(let i=0;i<positions.length;i+=3)max=Math.max(max,Math.hypot(...[0,1,2].map(axis=>g.attributes.position.array[i+axis]-positions[i+axis])));
        assert.ok(max<=1.00005);assert.deepEqual(g.index.array,orientedIndices);
        const drift=Math.abs(volume()-before)/before;
        assert.ok(drift<.01,`${name} volume drift ${drift}`);
        console.log(`${name}: maximum display displacement ${max.toFixed(4)} mm; volume change ${(drift*100).toFixed(4)}%`);
      }
    });
    assert.ok(meshes >= 2);
  });
}

test('CT urogram has collecting outlines, ordered axial images and no tumour label', async () => {
  const base = new URL('../public/urogram/ct/', import.meta.url);
  const text = await readFile(new URL('slices.json', base), 'utf8');
  assert.doesNotMatch(text, /patientname|patientid|instanceuid|[a-z]:\\|\.nii|\.dcm/i);
  const d = JSON.parse(text);
  assert.equal(d.pixelMm, 1);
  assert.equal(d.slices.length, 65);
  assert.ok(d.slices.some(s => s.collecting.length));
  const files = await readdir(base);
  for (const [i,s] of d.slices.entries()) {
    assert.equal(s.tumour, undefined);
    assert.ok(files.includes(`${String(i).padStart(3,'0')}.webp`));
    if (i) assert.equal(s.z - d.slices[i-1].z, 2);
    for (const key of ['kidney','collecting']) for (const line of s[key]) for (let j=0;j<line.length;j++) assert.ok(line[j]>=0 && line[j]< (j%2 ? d.height : d.width));
  }
});
