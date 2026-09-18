import { SkullRenderer, RGB } from './renderer'
import { EffectsEngine } from './effects'
import { SkullParams } from '../skullParams'
import { EffectToggles, ModelData } from '../types'
import { getEffectiveBlinkLevels } from './faceAnim'

export interface CanvasCallbacks {
  onFrame?: (bitmap: ImageBitmap) => void
}

interface Layout {
  fontSize: number
  cellW: number
  cellH: number
  startX: number
  startY: number
  width: number
  height: number
  ox: number
  oy: number
}

const CHAR_W = 1.0
const LINE_H = 1.0
const DENSITY = 1.0

export class SkullCanvas {
  canvas: HTMLCanvasElement
  ctx: CanvasRenderingContext2D
  renderer: SkullRenderer
  effects = new EffectsEngine()
  private raf = 0
  private last = 0
  isPlaying = false
  amplitude = 0
  emotion = 0
  private video: HTMLVideoElement | null = null
  private videoVisible = false
  private videoFade = 0
  private videoFadeTarget = 0
  colorEffect = false
  private cb: CanvasCallbacks = {}
  private dpr = 1
  private frameCounter = 0
  private displayCb: (() => void) | null = null
  private staticCache: HTMLCanvasElement | null = null
  private staticDirty = true
  private cacheLayoutKey = ''
  private cornerCache: HTMLCanvasElement | null = null
  private cornerCacheW = 0
  private cornerCacheH = 0
  private cornerCacheFont = 0
  private cornerCacheCellW = 0
  private cornerCacheCellH = 0
  private prevMouthOpenCorner = false
  private cornerDirty = true
  private mouthMask = new Uint8Array(0)
  private mouthNearCoords: number[] = []
  private ro: ResizeObserver | null = null
  private prevMouthOpen = false
  private _cacheFrameCount = 0
  private offscreen: OffscreenCanvas | null = null
  private offCtx: OffscreenCanvasRenderingContext2D | null = null
  headVisible = true
  // Плавная анимация головы: видимость (fade) и позиция (центр ↔ угол)
  private headFade = 1
  private headFadeTarget = 1
  private cornerAmount = 0
  private cornerAmountTarget = 0

  constructor(canvas: HTMLCanvasElement, params: SkullParams, cb: CanvasCallbacks = {}) {
    this.canvas = canvas
    this.cb = cb
    this.ctx = canvas.getContext('2d')!
    this.renderer = new SkullRenderer(params)
    this.applyIntensities(params)
    this.setupResize()
  }

  private setupResize() {
    this.ro = new ResizeObserver(() => this.handleResize())
    this.ro.observe(this.canvas)
    this.handleResize()
  }

  handleResize() {
    const w = this.canvas.clientWidth
    const h = this.canvas.clientHeight
    if (!Number.isFinite(w) || !Number.isFinite(h) || w < 4 || h < 4) {
      this.staticDirty = true
      this.cornerDirty = true
      return
    }
    this.dpr = window.devicePixelRatio || 1
    const pw = Math.max(4, Math.floor(w * this.dpr))
    const ph = Math.max(4, Math.floor(h * this.dpr))
    if (this.canvas.width !== pw || this.canvas.height !== ph) {
      this.canvas.width = pw
      this.canvas.height = ph
    }
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0)
    this.staticDirty = true
    this.cornerDirty = true
  }

  setVideoSource(video: HTMLVideoElement | null) {
    this.video = video
    this.videoVisible = !!video
    this.videoFadeTarget = video ? 1 : 0
  }

  clearVideo() {
    this.video = null
    this.videoVisible = false
    this.videoFadeTarget = 0
  }

  setVideoVisible(v: boolean) {
    this.videoVisible = v
    this.videoFadeTarget = v ? 1 : 0
  }

  setAudioData(isPlaying: boolean, amplitude: number) {
    this.isPlaying = isPlaying
    this.amplitude = amplitude
    this.effects.setAudioData(isPlaying, amplitude)
    this.renderer.updateFromAudio(isPlaying, amplitude)
  }

  resetMouth() {
    this.renderer.resetMouth()
    this.isPlaying = false
    this.amplitude = 0
  }

  setEmotion(emotion: number) {
    this.emotion = emotion
    this.renderer.set_emotion(emotion)
  }

  setChatter(v: boolean) {
    this.renderer.setChatter(v)
  }

  setHeadVisible(v: boolean) {
    this.headVisible = v
    this.headFadeTarget = v ? 1 : 0
  }

  updateParams(params: SkullParams) {
    this.renderer.params = params
    this.renderer.rebuildMask()
    this.renderer.refreshPupils()
    this.renderer.syncEmotionData()
    this.staticDirty = true
    this.cornerDirty = true
    this.applyIntensities(params)
    this.syncColorFromParams(params)
  }

  setModel(model: ModelData | null) {
    if (model) this.renderer.loadModel(model)
    else this.renderer.clearModel()
    this.staticDirty = true
    this.cornerDirty = true
  }

  private applyIntensities(params: SkullParams) {
    const d = params.data
    this.renderer.setErosionIntensity(d.erosion_intensity)
    this.effects.setIntensity('visualizer', d.visualizer_intensity)
    this.effects.setIntensity('particles', d.particles_intensity)
    this.effects.setIntensity('waves', d.waves_intensity)
    this.effects.setIntensity('glitch', d.glitch_intensity)
    this.effects.setIntensity('alarm', d.alarm_intensity)
    this.effects.setIntensity('terminal', d.terminal_intensity)
    this.effects.setIntensity('matrix', d.matrix_intensity)
    this.effects.setIntensity('shatter', d.shatter_intensity)
  }

  setEffect(key: keyof EffectToggles, active: boolean) {
    const W = this.canvas.clientWidth || 1920
    const H = this.canvas.clientHeight || 1080
    switch (key) {
      case 'visualizer': this.effects.setVisualizer(active); break
      case 'particles': this.effects.setCodeParticles(active); break
      case 'waves': this.effects.setWaves(active); break
      case 'glitch': this.effects.toggleGlitch(active, W, H); break
      case 'alarm': this.effects.toggleAlarm(active, W, H); break
      case 'terminal': this.effects.toggleTerminal(active, W, H); break
      case 'matrix': this.effects.toggleMatrix(active, W, H); break
      case 'shatter': this.effects.toggleShatter(active, this.renderer); break
      case 'erosion': this.renderer.toggleErosion(active); break
    }
  }

  setGlitchIntensity(i: number) {
    this.effects.setGlitchIntensity(i)
  }

  setEffectIntensity(key: string, value: number) {
    if (key === 'erosion') {
      this.renderer.setErosionIntensity(value)
    } else {
      this.effects.setIntensity(key, value)
    }
  }

  applyScriptToggles(t: EffectToggles) {
    for (const key of Object.keys(t) as Array<keyof EffectToggles>) {
      this.setEffect(key, t[key])
    }
  }

  setColorEffect(color: 'red' | 'white' | 'reset') {
    const p = this.renderer.params.data
    const target = color === 'reset' ? 'green' : color
    // Уже применяем тот же цвет (эффект живёт или завершён) — не начинаем повторный свип.
    if (p.color_effect_target === target && (p.color_effect_active || p.color_effect)) return
    // Стоп для 'reset' из уже чистой зелёной головы (эффекта нет вообще) — ничего не делаем.
    if (target === 'green' && !p.color_effect && !p.color_effect_active) return
    p.previous_color = p.color_effect && p.color_effect_target !== 'green' ? p.color_effect_target : 'green'
    p.color_effect_target = target
    p.color_effect_progress = 0
    p.color_effect_active = true
    p.color_effect = true
    this.colorEffect = true
  }

  private syncColorFromParams(params: SkullParams) {
    this.colorEffect = !!params.data.color_effect
  }

  private updateColor(dt: number) {
    const p = this.renderer.params.data
    if (!p.color_effect_active) return
    p.color_effect_progress = Math.min(1, p.color_effect_progress + dt * 1.2)
    if (p.color_effect_progress >= 1) {
      p.color_effect_progress = 1
      p.color_effect_active = false
      if (p.color_effect_target === 'green') {
        p.color_effect = false
        this.colorEffect = false
      } else {
        this.colorEffect = true
      }
    }
  }

  private updateVideoFade(dt: number) {
    if (Math.abs(this.videoFadeTarget - this.videoFade) < 0.001) {
      this.videoFade = this.videoFadeTarget
      return
    }
    const rate = 3
    this.videoFade = this.videoFadeTarget > this.videoFade
      ? Math.min(this.videoFadeTarget, this.videoFade + dt * rate)
      : Math.max(this.videoFadeTarget, this.videoFade - dt * rate)
  }

  start() {
    this.last = performance.now()
    const loop = (now: number) => {
      const dt = Math.min(0.05, (now - this.last) / 1000)
      this.last = now
      try {
        this.update(dt)
        this.draw()
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('[CANVAS-LOOP]', (err as Error).stack || String(err))
      }
      this.raf = requestAnimationFrame(loop)
    }
    this.raf = requestAnimationFrame(loop)
  }

  stop() {
    cancelAnimationFrame(this.raf)
    this.ro?.disconnect()
    this.ro = null
    if (this.displayCb) this.displayCb()
  }

  private update(dt: number) {
    this.renderer.updateFrame(dt)
    this.updateColor(dt)
    this.updateVideoFade(dt)
    this.updateHeadAnim(dt)
    this.effects.update(dt, this.canvas.clientWidth || 1920, this.canvas.clientHeight || 1080, this.renderer, this.amplitude)
    if (!this.isPlaying) {
      this.renderer.updateFromAudio(false, 0, dt)
    }
  }

  // Плавное появление/исчезание головы и плавный уход в угол
  private updateHeadAnim(dt: number) {
    const k = dt * 4
    this.headFade += (this.headFadeTarget - this.headFade) * Math.min(1, k)
    if (Math.abs(this.headFade - this.headFadeTarget) < 0.001) this.headFade = this.headFadeTarget
    if (this.headFade < 0.001) {
      this.headVisible = false
    } else if (this.headFadeTarget > 0.5) {
      this.headVisible = true
    }
    const videoMode = !!(this.video && this.video.readyState >= 2 && this.videoFade > 0.005)
    this.cornerAmountTarget = videoMode && this.videoFade > 0.005 ? 1 : 0
    this.cornerAmount += (this.cornerAmountTarget - this.cornerAmount) * Math.min(1, k)
    if (Math.abs(this.cornerAmount - this.cornerAmountTarget) < 0.001) this.cornerAmount = this.cornerAmountTarget
  }

  private layout(): Layout {
    const width = this.canvas.clientWidth || 1920
    const height = this.canvas.clientHeight || 1080
    const r = this.renderer
    const scale = this.renderer.params.data.head_scale || 1
    const fitW = width / r.cols
    const fitH = height / r.rows
    const fontFloor = r.modelMode && r.cols > 200 ? 1 : 3
    const fontSize = Math.max(fontFloor, Math.floor(Math.min(fitW / CHAR_W, fitH / LINE_H) * DENSITY * scale))
    const cellW = fontSize * CHAR_W
    const cellH = fontSize * LINE_H
    const totalW = r.cols * cellW
    const totalH = r.rows * cellH
    const ox = Math.floor(r.offset_x * cellW * 0.1)
    const oy = Math.floor(r.offset_y * cellH * 0.1)
    return {
      fontSize,
      cellW,
      cellH,
      startX: (width - totalW) / 2,
      startY: (height - totalH) / 2,
      width,
      height,
      ox,
      oy,
    }
  }

  private computeMouth(r: SkullRenderer) {
    const needed = r.rows * r.cols
    if (this.mouthMask.length < needed) {
      this.mouthMask = new Uint8Array(needed)
    }
    this.mouthMask.fill(0)
    this.mouthNearCoords.length = 0

    const addArea = (x: number, y: number) => {
      if (x >= 0 && x < r.cols && y >= 0 && y < r.rows) {
        this.mouthMask[y * r.cols + x] = 1
      }
    }
    const addNear = (x: number, y: number) => {
      if (x >= 0 && x < r.cols && y >= 0 && y < r.rows) {
        const idx = y * r.cols + x
        if (this.mouthMask[idx] !== 1) {
          this.mouthMask[idx] = 2
          this.mouthNearCoords.push(x, y)
        }
      }
    }

    const w = r.mouth_w
    const cx = r.mouth_cx
    if (r.mouth_open < 0.05) {
      const halfH = Math.max(1, Math.floor(r.mouth_h / 2))
      for (let y = r.mouth_y - halfH; y <= r.mouth_y + halfH; y++) {
        for (let x = cx - Math.floor(w / 2); x < cx + Math.floor(w / 2); x++) addArea(x, y)
      }
      for (let y = r.mouth_y - halfH - 1; y <= r.mouth_y + halfH + 1; y++) {
        for (let x = cx - Math.floor(w / 2) - 1; x < cx + Math.floor(w / 2) + 1; x++) addNear(x, y)
      }
    } else {
      const openH = Math.floor(2 + r.mouth_open * 1.5)
      if (openH > 0) {
        for (let y = r.mouth_y; y < Math.min(r.rows, r.mouth_y + openH); y++) {
          const yOff = (y - r.mouth_y) / Math.max(1, openH)
          const mw = Math.floor(w * (1 - yOff * 0.15))
          for (let x = cx - Math.floor(mw / 2); x < cx + Math.floor(mw / 2); x++) addArea(x, y)
        }
      }
    }
  }

  /** Рисует непрозрачный чёрный силуэт головы, чтобы фоновые эффекты не просвечивали сквозь неё. */
  private fillHeadSilhouette(ctx: CanvasRenderingContext2D, L: Layout, r: SkullRenderer) {
    const n = r.rows * r.cols
    const hasMouth = this.mouthMask.length >= n
    ctx.fillStyle = '#000000'
    ctx.beginPath()
    for (let y = 0; y < r.rows; y++) {
      const row = r.mask[y]
      for (let x = 0; x < r.cols; x++) {
        if (row[x] || r.isInFaceHole(x, y) || (hasMouth && this.mouthMask[y * r.cols + x] === 1)) {
          ctx.rect(L.startX + L.ox + x * L.cellW - 0.25, L.startY + L.oy + y * L.cellH - 0.25, L.cellW + 0.5, L.cellH + 0.5)
        }
      }
    }
    ctx.fill()
  }

  private buildStaticCache(L: Layout) {
    const r = this.renderer
    const off = document.createElement('canvas')
    const totalW = Math.ceil(r.cols * L.cellW)
    const totalH = Math.ceil(r.rows * L.cellH)
    off.width = totalW
    off.height = totalH
    const c = off.getContext('2d')!
    // Непрозрачный силуэт головы в кэше — эффекты позади не просвечивают
    c.fillStyle = '#000000'
    c.beginPath()
    const n = r.rows * r.cols
    const hasMouth = this.mouthMask.length >= n
    for (let y = 0; y < r.rows; y++) {
      const row = r.mask[y]
      for (let x = 0; x < r.cols; x++) {
        if (row[x] || r.isInFaceHole(x, y) || (hasMouth && this.mouthMask[y * r.cols + x] === 1)) {
          c.rect(x * L.cellW - 0.25, y * L.cellH - 0.25, L.cellW + 0.5, L.cellH + 0.5)
        }
      }
    }
    c.fill()
    c.font = `${L.fontSize}px Consolas, monospace`
    c.textAlign = 'center'
    c.textBaseline = 'top'
    for (let y = 0; y < r.rows; y++) {
      for (let x = 0; x < r.cols; x++) {
        if (!r.mask[y][x]) continue
        if (r.isEroded(x, y)) continue
        if (this.effects.isShattered(x, y)) continue
        if (r.isInFaceHole(x, y)) continue
        const mVal = this.mouthMask.length >= r.rows * r.cols ? this.mouthMask[y * r.cols + x] : 0
        if (mVal === 1) continue
        const isMouthNear = mVal === 2
        const dist = Math.abs(x - r.cx) / r.cols
        let b: number
        if (r.modelBrightness) {
          b = Math.max(0, Math.min(255, Math.round(r.modelBrightness[y][x])))
        } else {
          b = r.isBorder(x, y) ? 255 : Math.floor(80 + 60 * (1 - dist))
        }
        // Закрытый рот: near-клетки стабильны → печём прямо в кэш,
        // чтобы не перерисовывать их каждый кадр живым циклом.
        c.fillStyle = isMouthNear ? 'rgb(0,150,0)' : `rgb(0,${b},0)`
        c.fillText(r.grid[y][x], x * L.cellW + L.cellW / 2, y * L.cellH)
      }
    }
    this.staticCache = off
    this.staticDirty = false
    this._cacheFrameCount = r.frame_count
  }

  /** Статический слой угловой головы (видео-режим): силуэт + все клетки, без бровей/эффектов. */
  private buildCornerCache(cornerW: number, cornerH: number, cornerX: number, cornerY: number, fontSize: number, cellW: number, cellH: number, sx: number, sy: number) {
    const r = this.renderer
    const off = document.createElement('canvas')
    off.width = cornerW
    off.height = cornerH
    const c = off.getContext('2d')!
    // Локальные координаты внутри углового кэша
    const ox = sx - cornerX
    const oy = sy - cornerY
    c.font = `${fontSize}px Consolas, monospace`
    c.textAlign = 'center'
    c.textBaseline = 'top'
    // Непрозрачный силуэт головы (не просвечивают фоновые эффекты)
    c.fillStyle = '#000000'
    c.beginPath()
    const n = r.rows * r.cols
    const hasMouth = this.mouthMask.length >= n
    for (let y = 0; y < r.rows; y++) {
      const row = r.mask[y]
      for (let x = 0; x < r.cols; x++) {
        if (row[x] || r.isInFaceHole(x, y) || (hasMouth && this.mouthMask[y * r.cols + x] === 1)) {
          c.rect(ox + x * cellW - 0.25, oy + y * cellH - 0.25, cellW + 0.5, cellH + 0.5)
        }
      }
    }
    c.fill()
    for (let y = 0; y < r.rows; y++) {
      for (let x = 0; x < r.cols; x++) {
        if (!r.mask[y][x]) continue
        if (r.isEroded(x, y)) continue
        if (this.effects.isShattered(x, y)) continue
        if (r.isEye(x, y)) continue
        const mVal = hasMouth ? this.mouthMask[y * r.cols + x] : 0
        if (mVal === 1) continue
        const isMouthNear = mVal === 2
        const char = r.grid[y][x]
        const isBorder = r.isBorder(x, y)
        let base: RGB
        if (r.modelBrightness) {
          const mb = Math.max(0, Math.min(255, Math.round(r.modelBrightness[y][x])))
          base = [0, mb, 0]
        } else if (isBorder) base = [0, 255, 0]
        else {
          const dist = Math.abs(x - r.cx) / r.cols
          const b = Math.floor(80 + 60 * (1 - dist))
          base = [0, b, 0]
        }
        // Закрытый рот: near-кольцо стабильно → печём в кэш (живой слой не нужен)
        c.fillStyle = isMouthNear ? 'rgb(0,150,0)' : `rgb(${base[0]},${base[1]},${base[2]})`
        c.fillText(char, ox + x * cellW + cellW / 2, oy + y * cellH)
      }
    }
    this.cornerCache = off
    this.cornerCacheW = cornerW
    this.cornerCacheH = cornerH
    this.cornerCacheFont = fontSize
    this.cornerCacheCellW = cellW
    this.cornerCacheCellH = cellH
    this.cornerDirty = false
  }

  private draw() {
    const ctx = this.ctx
    const width = this.canvas.clientWidth || 1920
    const height = this.canvas.clientHeight || 1080
    ctx.clearRect(0, 0, width, height)
    ctx.fillStyle = '#000000'
    ctx.fillRect(0, 0, width, height)

    const colorActive = this.colorEffect || this.renderer.params.data.color_effect_progress > 0
    const target = this.renderer.params.data.color_effect_target
    const videoMode = !!(this.video && this.video.readyState >= 2 && this.videoFade > 0.005)

    if (videoMode) {
      const vw = this.video!.videoWidth
      const vh = this.video!.videoHeight
      if (vw > 0) {
        const scale = Math.min(width / vw, height / vh)
        const dw = vw * scale
        const dh = vh * scale
        const dx = (width - dw) / 2
        const dy = (height - dh) / 2
        ctx.save()
        ctx.globalAlpha = this.videoFade
        ctx.drawImage(this.video!, dx, dy, dw, dh)
        ctx.restore()
      }
      ctx.save()
      ctx.globalAlpha = 0.6 * this.videoFade
      this.effects.drawVisualizerPublic(ctx, width, height, colorActive, target)
      ctx.restore()
      this.effects.visualizerSkipInBg = true
    }

    this.effects.drawBackgroundEffects(ctx, width, height, colorActive, target)

    if (this.headFade > 0.005) {
      const ca = this.cornerAmount
      if (ca < 0.005) {
        // Полноценная центральная голова (нет видео)
        ctx.save()
        ctx.globalAlpha = this.headFade
        this.drawSkull(ctx, width, height, colorActive, target)
        ctx.restore()
      } else if (ca > 0.995) {
        // Полноценный угол (видео активно)
        ctx.save()
        ctx.globalAlpha = this.headFade
        this.drawSkullInCorner(ctx, width, height, colorActive, target)
        ctx.restore()
      } else {
        // Плавный переход: кроссфейд от центра к углу
        ctx.save()
        ctx.globalAlpha = this.headFade * (1 - ca)
        this.drawSkull(ctx, width, height, colorActive, target)
        ctx.restore()
        ctx.save()
        ctx.globalAlpha = this.headFade * ca
        this.drawSkullInCorner(ctx, width, height, colorActive, target)
        ctx.restore()
      }
    }

    this.effects.drawShatterFallingChars(ctx, width, height, this.renderer, colorActive, target)
    this.effects.drawForeground(ctx, width, height, colorActive, target)

    this.frameCounter++
    if (this.cb.onFrame && this.frameCounter % 5 === 0) {
      try {
        if (!this.offscreen || this.offscreen.width !== this.canvas.width || this.offscreen.height !== this.canvas.height) {
          this.offscreen = new OffscreenCanvas(this.canvas.width, this.canvas.height)
          this.offCtx = this.offscreen.getContext('2d')
        }
        if (this.offCtx) {
          this.offCtx.drawImage(this.canvas, 0, 0)
          const bmp = this.offscreen.transferToImageBitmap()
          this.cb.onFrame(bmp)
        }
      } catch {
        // ignore
      }
    }
  }

  private drawSkullInCorner(ctx: CanvasRenderingContext2D, width: number, height: number, colorActive: boolean, target: string) {
    const r = this.renderer
    const cornerScale = 0.18
    const cornerW = Math.floor(width * cornerScale)
    const cornerH = Math.floor(height * cornerScale)
    const margin = 12
    const cornerX = width - cornerW - margin
    const cornerY = margin

    ctx.save()
    ctx.strokeStyle = 'rgba(0,255,0,0.4)'
    ctx.lineWidth = 1
    ctx.strokeRect(cornerX - 1, cornerY - 1, cornerW + 2, cornerH + 2)

    ctx.beginPath()
    ctx.rect(cornerX, cornerY, cornerW, cornerH)
    ctx.clip()

    const fitW = (cornerW - 8) / r.cols
    const fitH = (cornerH - 8) / r.rows
    const cornerFontSize = Math.max(1, Math.floor(Math.min(fitW / CHAR_W, fitH / LINE_H) * DENSITY))
    const cornerCellW = cornerFontSize * CHAR_W
    const cornerCellH = cornerFontSize * LINE_H
    const totalW = Math.min(r.cols * cornerCellW, cornerW - 8)
    const totalH = Math.min(r.rows * cornerCellH, cornerH - 8)
    // Плотно центрируем голову в окне: она вычислена уже вписанной, поэтому
    // sx/sy никогда не уходят за границы (не лезут за верхнюю рамку).
    const sx = cornerX + (cornerW - totalW) / 2
    const sy = cornerY + (cornerH - totalH) / 2

    ctx.font = `${cornerFontSize}px Consolas, monospace`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'top'

    this.computeMouth(r)

    const drawCellSmall = (x: number, y: number, char: string, color: string) => {
      ctx.fillStyle = color
      ctx.fillText(char, sx + x * cornerCellW + cornerCellW / 2, sy + y * cornerCellH)
    }

    // Static-кэш угловой головы: силуэт + клетки перерисовываются только при
    // изменении состояния (модель/параметры/рот/размер). При colorActive цвет
    // клеток зависит от прогресса эффекта → идём по полному пути (как в drawSkull).
    const disruptiveCorner = this.colorEffect || r.erosion_active || this.effects.shatter_active
    if (!disruptiveCorner && !colorActive) {
      const mouthOpen = r.mouth_open >= 0.05
      const cacheStale =
        this.cornerDirty ||
        !this.cornerCache ||
        this.cornerCacheW !== cornerW ||
        this.cornerCacheH !== cornerH ||
        this.cornerCacheFont !== cornerFontSize ||
        this.cornerCacheCellW !== cornerCellW ||
        this.cornerCacheCellH !== cornerCellH ||
        mouthOpen !== this.prevMouthOpenCorner
      if (cacheStale) this.buildCornerCache(cornerW, cornerH, cornerX, cornerY, cornerFontSize, cornerCellW, cornerCellH, sx, sy)
      this.prevMouthOpenCorner = mouthOpen
      ctx.drawImage(this.cornerCache!, cornerX, cornerY)
      // Живой слой рта: требуется только пока рот открыт (openH меняется каждый кадр).
      // Закрытый рот полностью запечён в кэш (силуэт + near-кольцо).
      const hasMCLive = r.mouth_open >= 0.05 && this.mouthMask.length >= r.rows * r.cols
      if (hasMCLive) {
        ctx.fillStyle = '#000000'
        ctx.beginPath()
        for (let y = 0; y < r.rows; y++) {
          for (let x = 0; x < r.cols; x++) {
            if (this.mouthMask[y * r.cols + x] === 1) {
              ctx.rect(sx + x * cornerCellW - 0.25, sy + y * cornerCellH - 0.25, cornerCellW + 0.5, cornerCellH + 0.5)
            }
          }
        }
        ctx.fill()
      }
    } else {
      // Непрозрачный силуэт головы в угловом окне — фоновые эффекты не просвечивают
      ctx.fillStyle = '#000000'
      ctx.beginPath()
      const hasMC = this.mouthMask.length >= r.rows * r.cols
      for (let y = 0; y < r.rows; y++) {
        const row = r.mask[y]
        for (let x = 0; x < r.cols; x++) {
          if (row[x] || r.isInFaceHole(x, y) || (hasMC && this.mouthMask[y * r.cols + x] === 1)) {
            ctx.rect(sx + x * cornerCellW - 0.25, sy + y * cornerCellH - 0.25, cornerCellW + 0.5, cornerCellH + 0.5)
          }
        }
      }
      ctx.fill()

      for (let y = 0; y < r.rows; y++) {
        for (let x = 0; x < r.cols; x++) {
          if (!r.mask[y][x]) continue
          if (r.isEroded(x, y)) continue
          if (this.effects.isShattered(x, y)) continue
          if (r.isEye(x, y)) continue
          if (this.mouthMask.length >= r.rows * r.cols && this.mouthMask[y * r.cols + x] !== 0) continue
          const char = r.grid[y][x]
          const isBorder = r.isBorder(x, y)
          let base: RGB
          if (r.modelBrightness) {
            const mb = Math.max(0, Math.min(255, Math.round(r.modelBrightness[y][x])))
            base = [0, mb, 0]
          } else if (isBorder) base = [0, 255, 0]
          else {
            const dist = Math.abs(x - r.cx) / r.cols
            const b = Math.floor(80 + 60 * (1 - dist))
            base = [0, b, 0]
          }
          if (colorActive) {
            const color = r.getColorForCell(x, y, base)
            drawCellSmall(x, y, char, `rgb(${color[0]},${color[1]},${color[2]})`)
          } else {
            drawCellSmall(x, y, char, `rgb(${base[0]},${base[1]},${base[2]})`)
          }
        }
      }
    }

    // brows в угловом окне — чтобы мимика была видна и при видео
    for (const eb of r.eyebrows) {
      const halfW = Math.floor(eb.width / 2)
      const browB = colorActive && target === 'red' ? 200 : 250
      const ebc: RGB = colorActive ? r.getColorForCell(eb.x, eb.y, [0, browB, 0]) : [0, 255, 0]
      const ebStyle = `rgb(${ebc[0]},${ebc[1]},${ebc[2]})`
      const browH = r.modelMode ? 2 : 1
      for (let y = eb.y; y <= eb.y + browH - 1; y++) {
        for (let x = eb.x - halfW; x <= eb.x + halfW; x++) {
          if (x < 0 || x >= r.cols || y < 0 || y >= r.rows) continue
          if (!r.mask[y][x]) continue
          if (r.isEroded(x, y) || this.effects.isShattered(x, y)) continue
          const t = eb.isLeft
            ? (x - (eb.x - halfW)) / Math.max(1, eb.width)
            : ((eb.x + halfW) - x) / Math.max(1, eb.width)
          const dy = Math.round(eb.curInner * t + eb.curOuter * (1 - t))
          const drawY = y - dy
          if (drawY < 0 || drawY >= r.rows || !r.mask[drawY][x]) continue
          drawCellSmall(x, drawY, r.grid[drawY][x], ebStyle)
        }
      }
    }

    ctx.restore()
  }

  private drawSkull(ctx: CanvasRenderingContext2D, width: number, height: number, colorActive: boolean, target: string) {
    const r = this.renderer
    const L = this.layout()
    const { fontSize, cellW, cellH, startX, startY, ox, oy } = L
    ctx.font = `${fontSize}px Consolas, monospace`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'top'

    this.computeMouth(r)

    const drawCell = (x: number, y: number, char: string, color: string) => {
      ctx.fillStyle = color
      ctx.fillText(char, startX + ox + x * cellW + cellW / 2, startY + oy + y * cellH)
    }

    const disruptive = this.colorEffect || r.erosion_active || this.effects.shatter_active

    if (disruptive) {
      this.fillHeadSilhouette(ctx, L, r)
      for (let y = 0; y < r.rows; y++) {
        for (let x = 0; x < r.cols; x++) {
          if (!r.mask[y][x]) continue
          if (r.isEroded(x, y)) continue
          if (this.effects.isShattered(x, y)) continue
          if (r.isEye(x, y)) continue
          const char = r.grid[y][x]
          const isBorder = r.isBorder(x, y)
          
          let isMouth = false
          let isMouthNear = false
          if (this.mouthMask.length >= r.rows * r.cols) {
            const mVal = this.mouthMask[y * r.cols + x]
            isMouth = mVal === 1
            isMouthNear = mVal === 2
          }

          const isEye = r.isEye(x, y)
          if (isMouth) continue
          let base: RGB
          if (isMouthNear) base = [0, 150, 0]
          else if (isEye) base = colorActive && target === 'red' ? [255, 140, 0] : [0, 255, 255]
          else if (r.modelBrightness) {
            const mb = Math.max(0, Math.min(255, Math.round(r.modelBrightness[y][x])))
            base = [0, mb, 0]
          } else if (isBorder) base = [0, 255, 0]
          else {
            const dist = Math.abs(x - r.cx) / r.cols
            const b = Math.floor(80 + 60 * (1 - dist))
            base = [0, b, 0]
          }
          if (colorActive) {
            const color = r.getColorForCell(x, y, base)
            drawCell(x, y, char, `rgb(${color[0]},${color[1]},${color[2]})`)
            continue
          }
          drawCell(x, y, char, `rgb(${base[0]},${base[1]},${base[2]})`)
        }
      }
    } else {
      const mouthOpen = r.mouth_open >= 0.05
      if (mouthOpen !== this.prevMouthOpen) this.staticDirty = true
      this.prevMouthOpen = mouthOpen
      // Твинкл HEX-символов в параметрике (renderer.updateFrame: каждая 3-я итерация)
      // меняет ~5% клеток grid — кэш должен перестраиваться синхронно, иначе узор застывает.
      if (!r.modelMode && r.frame_count - this._cacheFrameCount >= 3) this.staticDirty = true
      // Защита от рассинхрона «тело уезжает, глаза/рот на месте»: при любом изменении
      // геометрии (head_scale, сдвиг, ресайз canvas) кэш обязан пересобраться. Сравниваем
      // layout-ключ самого кэша с текущим — даже если updateParams не вызвали.
      const layoutKey = `${cellW}|${cellH}|${startX}|${startY}|${ox}|${oy}`
      if (this.cacheLayoutKey !== layoutKey) this.staticDirty = true
      if (this.staticDirty || !this.staticCache) {
        this.buildStaticCache(L)
      }
      this.cacheLayoutKey = layoutKey
      ctx.drawImage(this.staticCache!, startX + ox, startY + oy)
      if (r.mouth_open >= 0.05) {
        // Открытый рот динамичен: заливаем дыру чёрным (чтобы нижние ряды openH,
        // запечённые в кэш со старым openH, не просвечивали) и рисуем near-кольцо.
        const openH = Math.floor(2 + r.mouth_open * 1.5)
        ctx.fillStyle = '#000000'
        for (let y = r.mouth_y; y < Math.min(r.rows, r.mouth_y + openH); y++) {
          const yOff = (y - r.mouth_y) / Math.max(1, openH)
          const mw = Math.floor(r.mouth_w * (1 - yOff * 0.15))
          const x0 = Math.max(0, r.mouth_cx - Math.floor(mw / 2))
          const x1 = Math.min(r.cols, r.mouth_cx + Math.floor(mw / 2))
          ctx.fillRect(startX + ox + x0 * cellW - 0.25, startY + oy + y * cellH - 0.25, (x1 - x0) * cellW + 0.5, cellH + 0.5)
        }
        for (let i = 0; i < this.mouthNearCoords.length; i += 2) {
          const x = this.mouthNearCoords[i]
          const y = this.mouthNearCoords[i + 1]
          const mouthBase: RGB = [0, 150, 0]
          const mc = colorActive ? r.getColorForCell(x, y, mouthBase) : mouthBase
          drawCell(x, y, r.grid[y][x], `rgb(${mc[0]},${mc[1]},${mc[2]})`)
        }
      }
    }

    // falling chars (erosion)
    for (const fc of r.falling_chars) {
      const px = startX + ox + fc.x * cellW + cellW / 2
      const py = startY + oy + fc.y * cellH
      const alpha = Math.floor(255 * fc.alpha)
      let color: RGB = [0, 255, 0]
      if (colorActive) color = r.getColorForCell(Math.floor(fc.x), Math.floor(fc.y), [0, 255, 0])
      ctx.fillStyle = `rgba(${color[0]},${color[1]},${color[2]},${alpha})`
      ctx.fillText(fc.char, px, py)
    }

    // eyebrows — рисуем для параметрического черепа и для модели
    for (const eb of r.eyebrows) {
      const halfW = Math.floor(eb.width / 2)
      const ebBase: RGB = colorActive && target === 'red' ? [220, 150, 50] : [0, 250, 0]
      const ebColor = colorActive ? r.getColorForCell(eb.x, eb.y, ebBase) : ebBase
      const ebStyle = `rgb(${ebColor[0]},${ebColor[1]},${ebColor[2]})`
      const browH = r.modelMode ? 2 : 1
      for (let y = eb.y; y <= eb.y + browH - 1; y++) {
        for (let x = eb.x - halfW; x <= eb.x + halfW; x++) {
          if (x < 0 || x >= r.cols || y < 0 || y >= r.rows) continue
          if (!r.mask[y][x]) continue
          if (r.isEroded(x, y) || this.effects.isShattered(x, y)) continue
          // t: 1 = у переносицы (внутренний край), 0 = внешний край
          const t = eb.isLeft
            ? (x - (eb.x - halfW)) / Math.max(1, eb.width)
            : ((eb.x + halfW) - x) / Math.max(1, eb.width)
          const dy = Math.round(eb.curInner * t + eb.curOuter * (1 - t))
          const drawY = y - dy
          if (drawY < 0 || drawY >= r.rows || !r.mask[drawY][x]) continue
          drawCell(x, drawY, r.grid[drawY][x], ebStyle)
        }
      }
    }

    // pupils — двигаются саккадами, сужаются от злости, скрываются морганием/прищуром
    {
      const blinkLevels = getEffectiveBlinkLevels(r.faceAnim)
      const emo = r.emotionSmooth
      const squintAngry = emo < 0 ? -emo * (r.emotion_data.eyeSquint || 0) * 0.45 : 0
      for (let pIdx = 0; pIdx < r.pupils.length; pIdx++) {
        const pupil = r.pupils[pIdx]
        const eye = r.eye_areas[pIdx]
        if (!eye) continue
        const isLeftEye = eye.x < r.cx
        const avLevel = (isLeftEye ? blinkLevels.left : blinkLevels.right) + squintAngry
        if (avLevel > 0.55) continue
        const px = Math.round(pupil.x)
        const py = Math.round(pupil.y)
        const size = Math.max(1, Math.round(pupil.size * r.getEmotionPupilSizeMul()))
        for (let y = py - size; y <= py + size; y++) {
          for (let x = px - size; x <= px + size; x++) {
            if (x < 0 || x >= r.cols || y < 0 || y >= r.rows) continue
            const dx = x - px
            const dy = y - py
            if (dx * dx + dy * dy <= size * size) {
              if (r.eyeMask[y][x]) {
                const pcolor = colorActive && target === 'red' ? 'rgba(255,200,50,0.86)' : 'rgba(0,255,255,0.8)'
                drawCell(x, y, pupil.char, pcolor)
              }
            }
          }
        }
      }
    }

    // eyes (outline 'O'), with per-eye blink levels + эмоциональный прищур
    if (!r.modelMode) {
      const blinkLevels = getEffectiveBlinkLevels(r.faceAnim)
      const emo = r.emotionSmooth
      const squintAngry = emo < 0 ? -emo * (r.emotion_data.eyeSquint || 0) * 0.45 : 0
      for (let eIdx = 0; eIdx < r.eye_areas.length; eIdx++) {
        const eye = r.eye_areas[eIdx]
        const isLeftEye = eye.x < r.cx
        const eyeBlinkLevel = Math.min(1, (isLeftEye ? blinkLevels.left : blinkLevels.right) + squintAngry)
        // Полностью закрытый глаз — не рисуем
        if (eyeBlinkLevel > 0.95) continue

        const halfW = Math.max(2, Math.floor(eye.w / 2))
        const halfH = Math.max(2, Math.floor(eye.h / 2))
        // Сужение видимой области глаза при моргании (веко опускается сверху)
        const visibleRadius = halfH * (1 - eyeBlinkLevel)
        for (let y = eye.y - halfH; y < eye.y + halfH; y++) {
          for (let x = eye.x - halfW; x < eye.x + halfW; x++) {
            if (x < 0 || x >= r.cols || y < 0 || y >= r.rows) continue
            if (r.isEroded(x, y) || this.effects.isShattered(x, y)) continue
            const dx = x - eye.x
            const dy = y - eye.y
            if (dx * dx / (halfW * halfW) + dy * dy / (halfH * halfH) >= 1) continue
            // Если клетка выше линии века — скрыта
            const distFromCenter = Math.abs(dy)
            if (distFromCenter > visibleRadius + 0.5) continue
            let isEdge = false
            outer:
            for (let ddy = -1; ddy <= 1; ddy++) {
              for (let ddx = -1; ddx <= 1; ddx++) {
                if (ddx === 0 && ddy === 0) continue
                const nx = x + ddx
                const ny = y + ddy
                if (nx < 0 || nx >= r.cols || ny < 0 || ny >= r.rows) continue
                if (r.isEroded(nx, ny) || this.effects.isShattered(nx, ny)) continue
                const dx2 = nx - eye.x
                const dy2 = ny - eye.y
                if (dx2 * dx2 / (halfW * halfW) + dy2 * dy2 / (halfH * halfH) >= 1) {
                  isEdge = true
                  break outer
                }
              }
            }
            // Линия века — рисуем '─' на границе закрытия
            if (distFromCenter > visibleRadius - 0.5 && eyeBlinkLevel > 0.05) {
              const base: RGB = colorActive && target === 'red' ? [255, 140, 0] : [0, 255, 0]
              const color = colorActive ? r.getColorForCell(x, y, base) : base
              drawCell(x, y, '─', `rgb(${color[0]},${color[1]},${color[2]})`)
            } else if (isEdge) {
              const base: RGB = colorActive && target === 'red' ? [255, 140, 0] : [0, 255, 0]
              const color = colorActive ? r.getColorForCell(x, y, base) : base
              drawCell(x, y, 'O', `rgb(${color[0]},${color[1]},${color[2]})`)
            }
          }
        }
      }
    }

      // model mouth overlay — человеческая форма губ (не «кирпич»)
      if (r.modelMode && r.mouth_w > 0) {
        const halfW = Math.max(1, Math.floor(r.mouth_w / 2))
        const wf = r.faceAnim.mouth.widthFactor
        const emotion = r.emotion_data.mouthIntensity
        const emoNow = r.eyebrow_emotion
        const emoA = Math.abs(emoNow)

        // Эффективная ширина рта: слегка уже детектированной щели, улыбка шире, хмурость уже
        let effHalfW = Math.max(1, Math.round(halfW * 0.78))
        if (emoNow > 0.02) effHalfW = Math.max(effHalfW, Math.round(halfW * (0.82 + emoNow * emotion * 0.18)))
        else if (emoNow < -0.02) effHalfW = Math.max(1, Math.round(effHalfW * (1 - emoA * emotion * 0.1)))

        if (r.mouth_open <= 0.04) {
          // ─── Закрытый рот — человеческие губы ───
          // Верхняя губа ▄ (толщина в полблока), низкая тёмная линия смыкания,
          // нижняя губа ▀. Форма: дуга с провисом уголков + мимика поверх.
          const upperY = r.mouth_y - 1
          const lowerY = r.mouth_y + 1
          for (let x = r.mouth_cx - effHalfW; x <= r.mouth_cx + effHalfW; x++) {
            if (x < 0 || x >= r.cols) continue
            const distFromCenter = Math.abs(x - r.mouth_cx) / Math.max(1, effHalfW)
            // Нейтральный контур: уголки чуть опущены относительно центра
            let dy = Math.round(distFromCenter * distFromCenter * 1.2)
            if (emoA > 0.03) {
              const curve = distFromCenter * distFromCenter
              if (emoNow > 0) {
                // Улыбка: уголки поднимаются дугой
                dy -= Math.round(emoNow * emotion * curve * 3.0)
              } else {
                // Хмурость: уголки вниз + центр надут
                dy += Math.round(emoA * emotion * curve * 3.0)
                const pout = 1 - distFromCenter
                dy -= Math.round(emoA * emotion * pout * 0.8)
              }
            }
            // Уголки скругляются: градиентное затухание к крайним клеткам
            const cornerFade = distFromCenter > 0.82 ? 1 - (distFromCenter - 0.82) * 2.2 : 1
            // Верхняя губа
            const upB = Math.floor(150 * (1 - distFromCenter * 0.22) * cornerFade)
            const yUp = upperY + dy
            if (yUp >= 0 && yUp < r.rows) {
              const mc = colorActive ? r.getColorForCell(x, yUp, [0, upB, 0]) : [0, upB, 0]
              drawCell(x, yUp, '▄', `rgba(${mc[0]},${mc[1]},${mc[2]},0.95)`)
            }
            // Нижняя губа — чуть светлее и полнее
            const lowB = Math.floor(172 * (1 - distFromCenter * 0.28) * cornerFade)
            const yLow = lowerY + dy
            if (yLow >= 0 && yLow < r.rows) {
              const mc = colorActive ? r.getColorForCell(x, yLow, [0, lowB, 0]) : [0, lowB, 0]
              drawCell(x, yLow, '▀', `rgba(${mc[0]},${mc[1]},${mc[2]},0.95)`)
            }
            // Тонкий тёмный шов смыкания между губами — короче губ, чтобы
            // концы выглядели закруглёнными (уголки рта не "прямой срез")
            const ySlit = r.mouth_y + dy
            if (ySlit >= 0 && ySlit < r.rows && distFromCenter <= 0.82) {
              const mc = colorActive ? r.getColorForCell(x, ySlit, [0, 52, 0]) : [0, 52, 0]
              drawCell(x, ySlit, '─', `rgba(${mc[0]},${mc[1]},${mc[2]},0.92)`)
            }
          }
        } else {
          // ─── Открытый рот — верхняя губа, тёмная полость с глубиной, нижняя губа ───
          const rowsCount = Math.max(3, Math.ceil(r.mouth_open * 5))
          const bottomY = r.mouth_y + rowsCount - 1
          const openHalf = Math.max(1, Math.round(halfW * wf * 0.6))
          const emoCurve = emoNow > 0 ? -emoNow * emotion : emoA * emotion
          const emoSh = emoCurve * 1.2

          // Верхняя губа (▄ — верхняя половина клетки остаётся на лице беседы)
          for (let x = r.mouth_cx - openHalf; x <= r.mouth_cx + openHalf; x++) {
            if (x < 0 || x >= r.cols) continue
            const distFromCenter = Math.abs(x - r.mouth_cx) / Math.max(1, openHalf)
            const cornerFade = distFromCenter > 0.85 ? 1 - (distFromCenter - 0.85) * 1.8 : 1
            const upB = Math.floor(148 * (1 - distFromCenter * 0.2) * cornerFade)
            const yUp = r.mouth_y + Math.round(distFromCenter * distFromCenter * emoSh)
            if (yUp >= 0 && yUp < r.rows) {
              const mc = colorActive ? r.getColorForCell(x, yUp, [0, upB, 0]) : [0, upB, 0]
              drawCell(x, yUp, '▄', `rgba(${mc[0]},${mc[1]},${mc[2]},0.95)`)
            }
          }

          // Внутренняя кромка верхней губы — чуть светлее, даёт глубину
          if (rowsCount > 2) {
            for (let x = r.mouth_cx - openHalf + 1; x <= r.mouth_cx + openHalf - 1; x++) {
              if (x < 0 || x >= r.cols || r.mouth_y + 1 >= r.rows) continue
              const distFromCenter = Math.abs(x - r.mouth_cx) / Math.max(1, openHalf)
              const innerB = Math.floor(92 * (1 - distFromCenter * 0.3))
              const yIn = r.mouth_y + 1
              const mc = colorActive ? r.getColorForCell(x, yIn, [0, innerB, 0]) : [0, innerB, 0]
              drawCell(x, yIn, '─', `rgba(${mc[0]},${mc[1]},${mc[2]},0.9)`)
            }
          }

          // Тёмная полость рта (глубина, по краям овал)
          if (rowsCount > 3) {
            for (let y = r.mouth_y + 2; y < bottomY; y++) {
              const yProgress = (y - r.mouth_y) / Math.max(1, rowsCount - 1)
              const belly = 1 - Math.abs((yProgress - 0.5) * 1.9)
              const cavityHalf = Math.max(1, Math.round(openHalf * (0.42 + 0.5 * belly)))
              for (let x = r.mouth_cx - cavityHalf; x <= r.mouth_cx + cavityHalf; x++) {
                if (x < 0 || x >= r.cols || y < 0 || y >= r.rows) continue
                const distFromCenter = Math.abs(x - r.mouth_cx) / Math.max(1, cavityHalf)
                // Почти чёрная глубина с едва заметным просветом к центру
                const dim = Math.floor(18 + 26 * (1 - distFromCenter) * belly)
                const mc = colorActive ? r.getColorForCell(x, y, [0, dim, 0]) : [0, dim, 0]
                drawCell(x, y, '·', `rgba(${mc[0]},${mc[1]},${mc[2]},0.7)`)
              }
            }
          }

          // Нижняя губа (▀ — нижняя половина остаётся на подбородке)
          const lowerHalf = Math.max(1, Math.round(openHalf * 0.96))
          for (let x = r.mouth_cx - lowerHalf; x <= r.mouth_cx + lowerHalf; x++) {
            if (x < 0 || x >= r.cols) continue
            const distFromCenter = Math.abs(x - r.mouth_cx) / Math.max(1, lowerHalf)
            const cornerFade = distFromCenter > 0.85 ? 1 - (distFromCenter - 0.85) * 1.8 : 1
            const lowB = Math.floor(165 * (1 - distFromCenter * 0.26) * cornerFade)
            const yLow = bottomY + Math.round(distFromCenter * distFromCenter * emoSh)
            if (yLow >= 0 && yLow < r.rows) {
              const mc = colorActive ? r.getColorForCell(x, yLow, [0, lowB, 0]) : [0, lowB, 0]
              drawCell(x, yLow, '▀', `rgba(${mc[0]},${mc[1]},${mc[2]},0.95)`)
            }
          }
        }
      }

    // model eyes: per-eye blink with asymmetric easing + эмоциональный прищур
    if (r.modelMode) {
      const levels = getEffectiveBlinkLevels(r.faceAnim)
      const emo = r.emotionSmooth
      // Злость сужает глаза (прищур) даже без моргания
      const squintAngry = emo < 0 ? -emo * (r.emotion_data.eyeSquint || 0) * 0.45 : 0
      const effLeft = Math.min(1, levels.left + squintAngry)
      const effRight = Math.min(1, levels.right + squintAngry)
      // Only draw overlays if at least one eye is partially closed
      if (effLeft > 0.01 || effRight > 0.01) {
        const baseColor: RGB = colorActive && target === 'red' ? [255, 140, 0] : [0, 255, 0]
        for (let y = 0; y < r.rows; y++) {
          for (let x = 0; x < r.cols; x++) {
            if (!r.isEye(x, y)) continue
            if (r.isEroded(x, y) || this.effects.isShattered(x, y)) continue
            
            // Find closest eye and determine blink level
            let closestEye = r.eye_areas[0]
            if (r.eye_areas.length > 1) {
              let minDist = Infinity
              for (const e of r.eye_areas) {
                const dist = (e.x - x)**2 + (e.y - y)**2
                if (dist < minDist) { minDist = dist; closestEye = e }
              }
            }
            
            if (!closestEye) continue
            
            // Per-eye blink level
            const isLeftEye = closestEye.x < r.cx
            const eyeLevel = isLeftEye ? effLeft : effRight
            if (eyeLevel < 0.01) continue
            
            const eyeCenterY = closestEye.y
            const eyeHalfH = closestEye.h / 2
            const openRadius = eyeHalfH * (1 - eyeLevel)
            const distY = Math.abs(y - eyeCenterY)
            
            if (distY > openRadius + 0.5) {
              const sc = colorActive ? r.getColorForCell(x, y, baseColor) : baseColor
              drawCell(x, y, '█', `rgb(${sc[0]},${sc[1]},${sc[2]})`)
            } else if (distY > openRadius - 0.5) {
              const sc = colorActive ? r.getColorForCell(x, y, baseColor) : baseColor
              drawCell(x, y, '─', `rgb(${sc[0]},${sc[1]},${sc[2]})`)
            }
          }
        }
      }
    }
  }
}
