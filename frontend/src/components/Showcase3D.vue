<script setup lang="ts">
/**
 * Showcase3D —— three.js 只用于 AI 生成内容（角色卡片）内部的克制背景：
 * 一组缓慢漂移的柔和粒子 + 一颗缓慢浮动的低多边形星体。
 * 低透明度、低饱和度、透明通道，安静地衬托内容而不抢戏。
 */
import { onMounted, onBeforeUnmount, ref } from 'vue'
import * as THREE from 'three'

const canvEl = ref<HTMLCanvasElement | null>(null)

let renderer: THREE.WebGLRenderer | null = null
let scene: THREE.Scene | null = null
let camera: THREE.OrthographicCamera | null = null
let raf = 0
let ro: ResizeObserver | null = null

// 粒子数组（位置与漂移速度）
let velocities: Float32Array | null = null

// 配色：柔和、克制的蓝调，透明衰减
const PARTICLE_COUNT = 140
const PALETTE = ['#c9d2f5', '#e3d9f7', '#d5e6f7', '#eef0f8']

onMounted(() => {
  const canvas = canvEl.value
  if (!canvas) return

  renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true })
  renderer.setClearColor(0x000000, 0)

  scene = new THREE.Scene()
  // 正交投影更安静，避免透视畸变带来的"沉重感"
  camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 20)

  // —— 粒子星云 ——
  const pos = new Float32Array(PARTICLE_COUNT * 3)
  velocities = new Float32Array(PARTICLE_COUNT * 3)
  for (let i = 0; i < PARTICLE_COUNT; i++) {
    pos[i * 3 + 0] = (Math.random() - 0.5) * 2
    pos[i * 3 + 1] = (Math.random() - 0.5) * 1.6
    pos[i * 3 + 2] = (Math.random() - 0.5) * 1.2
    velocities![i * 3 + 0] = (Math.random() - 0.5) * 0.0008
    velocities![i * 3 + 1] = (Math.random() - 0.5) * 0.0006
    velocities![i * 3 + 2] = (Math.random() - 0.5) * 0.0004
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))

  const colors = new Float32Array(PARTICLE_COUNT * 3)
  for (let i = 0; i < PARTICLE_COUNT; i++) {
    const c = new THREE.Color(PALETTE[(Math.random() * PALETTE.length) | 0])
    colors[i * 3 + 0] = c.r
    colors[i * 3 + 1] = c.g
    colors[i * 3 + 2] = c.b
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3))

  const sizes = new Float32Array(PARTICLE_COUNT)
  for (let i = 0; i < PARTICLE_COUNT; i++) sizes[i] = 0.6 + Math.random() * 1.1
  geo.setAttribute('size', new THREE.BufferAttribute(sizes, 1))

  const mat = new THREE.PointsMaterial({
    size: 0.032,
    vertexColors: true,
    transparent: true,
    opacity: 0.32,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    sizeAttenuation: true,
  })
  const particles = new THREE.Points(geo, mat)
  scene.add(particles)

  // —— 低多边形星体：仅线框，非常淡 ——
  const icoGeo = new THREE.IcosahedronGeometry(0.5, 0)
  const icoMat = new THREE.MeshBasicMaterial({
    color: 0x7c8df0,
    wireframe: true,
    transparent: true,
    opacity: 0.18,
  })
  const ico = new THREE.Mesh(icoGeo, icoMat)
  ico.position.set(0.72, 0.5, -0.6)
  ico.scale.setScalar(0.9)
  scene.add(ico)

  // 第二颗更小、更淡的星
  const ico2Geo = new THREE.IcosahedronGeometry(0.3, 0)
  const ico2Mat = new THREE.MeshBasicMaterial({
    color: 0xa3b8f0,
    wireframe: true,
    transparent: true,
    opacity: 0.12,
  })
  const ico2 = new THREE.Mesh(ico2Geo, ico2Mat)
  ico2.position.set(-0.85, -0.42, -0.3)
  scene.add(ico2)

  function resize() {
    if (!renderer || !camera || !canvas) return
    const w = canvas.clientWidth
    const h = canvas.clientHeight
    if (!w || !h) return
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    renderer.setPixelRatio(dpr)
    renderer.setSize(w, h, false)
    const aspect = w / h
    const s = 1.15
    camera.left = -s * aspect
    camera.right = s * aspect
    camera.top = s
    camera.bottom = -s
    camera.updateProjectionMatrix()
  }
  resize()
  ro = new ResizeObserver(resize)
  ro.observe(canvas)

  let t = 0
  function tick() {
    raf = requestAnimationFrame(tick)
    t += 0.004

    // 粒子缓慢漂移 + 在范围内环绕
    const p = geo.attributes.position.array as Float32Array
    if (velocities) {
      for (let i = 0; i < PARTICLE_COUNT; i++) {
        p[i * 3 + 0] += velocities[i * 3 + 0]
        p[i * 3 + 1] += velocities[i * 3 + 1]
        p[i * 3 + 2] += velocities[i * 3 + 2]
        if (p[i * 3 + 0] > 1.1) p[i * 3 + 0] = -1.1
        if (p[i * 3 + 0] < -1.1) p[i * 3 + 0] = 1.1
        if (p[i * 3 + 1] > 0.9) p[i * 3 + 1] = -0.9
        if (p[i * 3 + 1] < -0.9) p[i * 3 + 1] = 0.9
      }
      geo.attributes.position.needsUpdate = true
    }

    // 星体柔和浮动
    ico.position.x = 0.72 + Math.sin(t) * 0.12
    ico.position.y = 0.5 + Math.cos(t * 1.3) * 0.1
    ico.rotation.x += 0.0016
    ico.rotation.y += 0.0022

    ico2.position.x = -0.85 + Math.cos(t * 0.9) * 0.1
    ico2.position.y = -0.42 + Math.sin(t * 1.1) * 0.08
    ico2.rotation.x -= 0.0011
    ico2.rotation.y += 0.0014

    // 粒子整体轻旋
    particles.rotation.z = Math.sin(t * 0.4) * 0.03

    if (renderer && scene && camera) renderer.render(scene, camera)
  }
  tick()
})

onBeforeUnmount(() => {
  cancelAnimationFrame(raf)
  ro?.disconnect()
  renderer?.dispose()
  renderer = null
  scene = null
  camera = null
  velocities = null
})
</script>

<template>
  <canvas ref="canvEl" class="showcase3d" aria-hidden="true"></canvas>
</template>

<style scoped>
.showcase3d {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
  opacity: 0.85;
}
</style>