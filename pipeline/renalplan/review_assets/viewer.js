const status = document.querySelector('#ct-status');
const ctImage = document.querySelector('#ct-image');
ctImage.addEventListener('error', () => {
  status.textContent = 'This CT slice could not load. Check the local bundle, choose another slice or reload the page.';
});
try {
  const [slices, record] = await Promise.all(['slices.json', 'review.json'].map(async file => {
    const response = await fetch(file); if (!response.ok) throw new Error(`Cannot read ${file}`); return response.json();
  }));
  const plane = document.querySelector('#plane'), phase = document.querySelector('#phase'), slider = document.querySelector('#slice');
  phase.querySelector('option[value="reference"]').textContent = `Reference CT (${record.inputs.referencePhaseDeclaration})`;
  const update = () => {
    const frames = slices[plane.value]; slider.max = frames.length - 1;
    slider.value = Math.min(Number(slider.value), frames.length - 1);
    const frame = frames[Number(slider.value)];
    document.querySelector('#ct-image').src = phase.value === 'excretory' ? frame.excretoryImage : frame.image;
    document.querySelector('#slice-label').textContent = `${Number(slider.value) + 1} of ${frames.length}, ${frame.coordinateMm} mm in RAS`;
    status.textContent = phase.value === 'excretory' ? 'Aligned phase: check the registration against the reference CT.' : 'Reference CT and mask boundaries.';
  };
  if (!slices.axial[0].excretoryImage) { phase.querySelector('option[value="excretory"]').remove(); phase.disabled = true; }
  slider.value = Math.floor(slices.axial.length / 2);
  plane.disabled = false; slider.disabled = false;
  phase.disabled = phase.options.length < 2;
  plane.addEventListener('change', update); phase.addEventListener('change', update); slider.addEventListener('input', update); update();
  document.querySelector('#details').textContent = `Tissue: ${record.tissueModel?.method || record.model.method}\nVessels: ${record.model.method}\nVessel source revision: ${record.model.sourceRevision}\nModel-copy offset: ${record.model.inputIntensity?.offsetAppliedToModelCopy ?? 'unadapted'}\nInput SHA-256: ${record.inputs.referenceSha256}\n${record.protocolCaveat}\n${record.model.coverage || ''}\nCollecting system: ${record.collecting.reason}\nRegistration: ${record.registration.reason || record.registration.method}`;
} catch (error) { status.textContent = `${error.message}. Check that the bundle is complete, serve it over localhost and reload.`; }

const modelStatus = document.querySelector('#model-status');
if (modelStatus.textContent.startsWith('Loading')) {
  try {
    const THREE = await import('three');
    const { GLTFLoader } = await import('./vendor/examples/jsm/loaders/GLTFLoader.js');
    const { OrbitControls } = await import('./vendor/examples/jsm/controls/OrbitControls.js');
    const canvas = document.querySelector('#model');
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    const scene = new THREE.Scene(); scene.background = new THREE.Color('#0d171d');
    const camera = new THREE.PerspectiveCamera(40, 1, .01, 20000);
    const controls = new OrbitControls(camera, canvas); controls.enableDamping = false;
    scene.add(new THREE.HemisphereLight(0xffffff, 0x445566, 2));
    const light = new THREE.DirectionalLight(0xffffff, 3); light.position.set(300, 500, 800); scene.add(light);
    const result = await new GLTFLoader().loadAsync('draft.glb'); const model = result.scene; scene.add(model);
    const box = new THREE.Box3().setFromObject(model), centre = box.getCenter(new THREE.Vector3());
    const distance = box.getSize(new THREE.Vector3()).length() * 1.5; controls.target.copy(centre);
    const render = () => renderer.render(scene, camera);
    const view = name => {
      const offset = name === 'top' ? [0, 0, distance] : name === 'side' ? [distance, 0, 0] : [0, distance, 0];
      camera.up.set(0, 0, 1); if (name === 'top') camera.up.set(0, 1, 0);
      camera.position.copy(centre).add(new THREE.Vector3(...offset)); camera.lookAt(centre); controls.update(); render();
    };
    view('front'); controls.addEventListener('change', render);
    document.querySelectorAll('[data-view]').forEach(button => button.addEventListener('click', () => view(button.dataset.view)));
    document.querySelectorAll('[data-layer]').forEach(input => input.addEventListener('change', () => {
      model.traverse(object => { if (object.name === input.dataset.layer) object.visible = input.checked; }); render();
    }));
    const resize = () => { renderer.setSize(canvas.clientWidth, canvas.clientHeight, false); camera.aspect = canvas.clientWidth / canvas.clientHeight; camera.updateProjectionMatrix(); render(); };
    new ResizeObserver(resize).observe(canvas); resize(); modelStatus.hidden = true;
    document.querySelectorAll('[data-view], [data-layer]').forEach(control => { control.disabled = false; });
  } catch (error) { modelStatus.textContent = `3D preview could not load: ${error.message}. Check the bundle files or inspect the binary masks in Slicer.`; }
}
