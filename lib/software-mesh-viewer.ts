import * as THREE from 'three'

export type DisplayLayer = { visible: boolean; colour: string; opacity: number; framing?: boolean }
type Options = { layer(name: string): DisplayLayer | undefined; background: string; onRotate?(): void }

// Canvas 2D compatibility rendering uses the loaded mesh coordinates. It has
// no inferred anatomy, lighting textures, measurements or GPU dependency.
export function softwareMeshViewer(canvas: HTMLCanvasElement, model: THREE.Object3D, options: Options) {
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('This browser cannot create a canvas')
  model.updateMatrixWorld(true)
  const bounds = new THREE.Box3()
  model.traverse(child => {
    if (child instanceof THREE.Mesh && options.layer(child.name)?.framing !== false && options.layer(child.name)) bounds.expandByObject(child)
  })
  if (bounds.isEmpty()) bounds.setFromObject(model)
  const centre = bounds.getCenter(new THREE.Vector3())
  const scale = 1.8 / Math.max(...bounds.getSize(new THREE.Vector3()).toArray())
  const meshes: { name: string; points: Float32Array; indices: number[] }[] = []
  const point = new THREE.Vector3()
  model.traverse(child => {
    if (!(child instanceof THREE.Mesh)) return
    const pos = child.geometry.getAttribute('position')
    if (!pos) return
    const points = new Float32Array(pos.count * 3)
    for (let i = 0; i < pos.count; i++) {
      point.fromBufferAttribute(pos, i).applyMatrix4(child.matrixWorld).sub(centre).multiplyScalar(scale)
      points.set([point.x, point.z, -point.y], i * 3)
    }
    meshes.push({ name: child.name, points, indices: child.geometry.index ? Array.from(child.geometry.index.array) : Array.from({ length: pos.count }, (_, i) => i) })
  })
  let yaw = Math.PI, pitch = 0, zoom = 1, cut = 0, frame = 0, stopped = false
  const pointers = new Map<number, [number, number]>()
  let pinch = 0
  const render = () => {
    frame = 0
    if (stopped) return
    const box = canvas.getBoundingClientRect()
    canvas.width = Math.max(1, Math.round(box.width)); canvas.height = Math.max(1, Math.round(box.height))
    ctx.fillStyle = options.background; ctx.fillRect(0, 0, canvas.width, canvas.height)
    const size = Math.min(canvas.width, canvas.height) * 0.43 * zoom
    const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch)
    const faces: { vertices: number[]; depth: number; colour: string; opacity: number; shade: number }[] = []
    for (const mesh of meshes) {
      const layer = options.layer(mesh.name)
      if (!layer?.visible) continue
      const vertices = new Float32Array(mesh.points.length)
      for (let i = 0; i < vertices.length; i += 3) {
        const x = mesh.points[i], y = mesh.points[i + 1], z = mesh.points[i + 2]
        const rx = cy * x + sy * z, rz = -sy * x + cy * z
        vertices.set([rx, cp * y - sp * rz, sp * y + cp * rz], i)
      }
      for (let i = 0; i < mesh.indices.length; i += 3) {
        const a = mesh.indices[i] * 3, b = mesh.indices[i + 1] * 3, c = mesh.indices[i + 2] * 3
        const depth = (vertices[a + 2] + vertices[b + 2] + vertices[c + 2]) / 3
        if (cut > 0 && depth > 1 - cut * 0.02) continue
        const ux = vertices[b] - vertices[a], uy = vertices[b + 1] - vertices[a + 1], uz = vertices[b + 2] - vertices[a + 2]
        const vx = vertices[c] - vertices[a], vy = vertices[c + 1] - vertices[a + 1], vz = vertices[c + 2] - vertices[a + 2]
        const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx
        const light = Math.abs((-0.3 * nx + 0.5 * ny + nz) / (Math.hypot(nx, ny, nz) || 1))
        faces.push({ vertices: [vertices[a], vertices[a + 1], vertices[b], vertices[b + 1], vertices[c], vertices[c + 1]], depth, colour: layer.colour, opacity: layer.opacity, shade: 0.45 + 0.55 * light })
      }
    }
    faces.sort((a, b) => a.depth - b.depth)
    for (const face of faces) {
      const colour = new THREE.Color(face.colour).multiplyScalar(face.shade)
      ctx.fillStyle = colour.getStyle(); ctx.globalAlpha = Math.max(0.12, face.opacity)
      ctx.beginPath()
      for (let i = 0; i < 6; i += 2) {
        const x = canvas.width / 2 + face.vertices[i] * size, y = canvas.height / 2 - face.vertices[i + 1] * size
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y)
      }
      ctx.closePath(); ctx.fill()
    }
    ctx.globalAlpha = 1
    canvas.dataset.renderedFaces = String(faces.length)
    canvas.dataset.ready = 'true'
  }
  const invalidate = () => { if (!frame && !stopped) frame = requestAnimationFrame(render) }
  const down = (e: PointerEvent) => { canvas.setPointerCapture(e.pointerId); pointers.set(e.pointerId, [e.clientX, e.clientY]); pinch = 0 }
  const move = (e: PointerEvent) => {
    const prev = pointers.get(e.pointerId)
    if (!prev) return
    pointers.set(e.pointerId, [e.clientX, e.clientY])
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()]; const distance = Math.hypot(a[0] - b[0], a[1] - b[1])
      if (pinch) zoom = THREE.MathUtils.clamp(zoom * distance / pinch, 0.4, 3)
      pinch = distance
    } else { yaw += (e.clientX - prev[0]) * 0.012; pitch += (e.clientY - prev[1]) * 0.012; options.onRotate?.() }
    canvas.dataset.rotation = `${yaw},${pitch}`; invalidate()
  }
  const up = (e: PointerEvent) => { pointers.delete(e.pointerId); pinch = 0 }
  const wheel = (e: WheelEvent) => { e.preventDefault(); zoom = THREE.MathUtils.clamp(zoom * Math.exp(-e.deltaY * 0.001), 0.4, 3); invalidate() }
  const key = (e: KeyboardEvent) => {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', '+', '-', '='].includes(e.key)) return
    e.preventDefault()
    if (e.key === 'ArrowLeft') yaw -= 0.15; if (e.key === 'ArrowRight') yaw += 0.15
    if (e.key === 'ArrowUp') pitch -= 0.15; if (e.key === 'ArrowDown') pitch += 0.15
    if (['+', '='].includes(e.key)) zoom *= 1.1; if (e.key === '-') zoom /= 1.1
    canvas.dataset.rotation = `${yaw},${pitch}`; invalidate()
  }
  canvas.style.touchAction = 'none'; canvas.tabIndex = 0
  canvas.addEventListener('pointerdown', down); canvas.addEventListener('pointermove', move)
  canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', up)
  canvas.addEventListener('wheel', wheel, { passive: false }); canvas.addEventListener('keydown', key)
  const observer = new ResizeObserver(invalidate); observer.observe(canvas); invalidate()
  return {
    update: invalidate,
    view: (y: number, p: number, reset = false) => { yaw = y; pitch = p; if (reset) zoom = 1; invalidate() },
    zoom: (direction: number) => { zoom = THREE.MathUtils.clamp(zoom * (direction > 0 ? 1.15 : 1 / 1.15), 0.4, 3); invalidate() },
    cut: (value: number) => { cut = value; invalidate() },
    dispose: () => {
      stopped = true; cancelAnimationFrame(frame); observer.disconnect()
      canvas.removeEventListener('pointerdown', down); canvas.removeEventListener('pointermove', move)
      canvas.removeEventListener('pointerup', up); canvas.removeEventListener('pointercancel', up)
      canvas.removeEventListener('wheel', wheel); canvas.removeEventListener('keydown', key)
    },
  }
}
