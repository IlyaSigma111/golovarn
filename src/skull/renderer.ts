import { SkullParams } from '../skullParams'
import { ModelData } from '../types'
import {
  FaceAnimState,
  createFaceAnimState,
  updateFaceAnim,
  getEffectiveBlinkLevels,
  getPupilOffset,
  blinkLevel,
} from './faceAnim'

export interface EyeArea {
  x: number
  y: number
  w: number
  h: number
  eye_x: number
  eye_y: number
}

export interface Pupil {
  x: number
  y: number
  size: number
  char: string
  eye_x: number
  eye_y: number
  offset_x: number
  offset_y: number
}

export interface Eyebrow {
  x: number
  y: number
  width: number
  height: number
  isLeft: boolean
  /** Целевой подъём дуги у переносицы (внутренний край) */
  innerOffset: number
  /** Целевой подъём дуги у внешнего края */
  outerOffset: number
  /** Текущее сглаженное значение дуги (внутренний край) */
  curInner: number
  /** Текущее сглаженное значение дуги (внешний край) */
  curOuter: number
}

export interface FallingChar {
  x: number
  y: number
  char: string
  start_x: number
  start_y: number
  speed_y: number
  speed_x: number
  alpha: number
  progress: number
  life: number
}

export type RGB = [number, number, number]

const HEX = '0123456789ABCDEF'

function rnd(min: number, max: number): number {
  return min + Math.random() * (max - min)
}

export class SkullRenderer {
  params: SkullParams
  cols = 80
  rows = 45
  cx = 40
  cy = 22
  mask: boolean[][]
  eyeMask: boolean[][]
  grid: string[][]
  mouth_h = 0

  eye_areas: EyeArea[] = []
  eyebrows: Eyebrow[] = []
  pupils: Pupil[] = []
  eyebrow_emotion = 0
  /** Сглаженное значение эмоции (для плавных переходов мимики) */
  emotionSmooth = 0
  emotion_data = { browIntensity: 0.6, mouthIntensity: 0.8, eyeSquint: 0.4, pupilBias: 1.0 }
  chatter = false

  mouth_open = 0
  target_mouth_open = 0
  mouth_timer = 0
  mouth_target = 0
  mouth_interval = 0.15
  mouth_y = 0
  mouth_w = 0
  mouth_cx = 0
  mouth_reset_needed = false
  mouthWasOpen = false
  /** Маска лица БЕЗ выреза рта — кэш для обновления рта без полного rebuildMask. */
  private mouthBaseMask: boolean[][] | null = null
  is_playing = false
  current_amplitude = 0

  blink_state = 0
  blink_timer = 0
  is_blinking = false
  blink_interval = 3 + Math.random() * 2
  blink_duration = 0.1

  modelMode = false
  modelBrightness: number[][] | null = null
  private modelGrid: string[][] | null = null
  private modelEye: boolean[][] | null = null
  private modelMouth: boolean[][] | null = null

  /** Новый биофизический движок анимации лица */
  faceAnim: FaceAnimState = createFaceAnimState()

  offset_x = 0
  offset_y = 0
  float_timer = 0

  pupil_timer = 0
  pupil_move_interval = 120
  global_target_x = rnd(-2, 2)
  global_target_y = rnd(-2, 2)
  global_offset_x = 0
  global_offset_y = 0

  frame_count = 0

  erosion_active = false
  erosion_cells: Map<number, { eroded: boolean; progress: number; timer: number }> = new Map()
  private erodedMask = new Uint8Array(0)
  erosion_timer = 0
  erosion_interval = 0.8
  erosion_duration = 3
  erosion_max_cells = 20
  erosion_fade_speed = 0.3
  erosion_intensity = 1
  falling_chars: FallingChar[] = []
  face_cells: Array<[number, number]> = []

  setErosionIntensity(v: number) {
    this.erosion_intensity = Math.max(0.05, Math.min(1, v))
  }

  constructor(params: SkullParams) {
    this.params = params
    this.mask = Array.from({ length: this.rows }, () => Array(this.cols).fill(false))
    this.eyeMask = Array.from({ length: this.rows }, () => Array(this.cols).fill(false))
    this.grid = Array.from({ length: this.rows }, () =>
      Array.from({ length: this.cols }, () => HEX[Math.floor(Math.random() * HEX.length)]),
    )
this.buildMask()
    this.syncEmotionData()
  }

  /** Числовой ключ для Map (вместо строк "${x},${y}" — нет GC). */
  private key(x: number, y: number): number {
    return y * this.cols + x
  }

  private initFaceCells() {
    this.face_cells = []
    this.erodedMask = new Uint8Array(this.rows * this.cols)
    this.erosion_cells.clear()
    for (let y = 0; y < this.rows; y++) {
      for (let x = 0; x < this.cols; x++) {
        if (this.mask[y][x]) this.face_cells.push([x, y])
      }
    }
    for (const cell of this.face_cells) {
      const k = this.key(cell[0], cell[1])
      this.erosion_cells.set(k, { eroded: false, progress: 0, timer: 0 })
    }
  }

  private drawZone(yStart: number, yEnd: number, width: number) {
    const halfW = Math.floor(width / 2)
    for (let y = Math.max(0, yStart); y < Math.min(this.rows, yEnd); y++) {
      for (let x = Math.max(0, this.cx - halfW); x <= Math.min(this.cols - 1, this.cx + halfW); x++) {
        this.mask[y][x] = true
      }
    }
  }

  private cutEye(ex: number, ey: number, w: number, h: number) {
    const halfW = Math.max(1, Math.floor(w / 2))
    const halfH = Math.max(1, Math.floor(h / 2))
    for (let y = Math.max(0, ey - halfH); y < Math.min(this.rows, ey + halfH); y++) {
      for (let x = Math.max(0, ex - halfW); x < Math.min(this.cols, ex + halfW); x++) {
        const dx = x - ex
        const dy = y - ey
        if ((dx * dx) / (halfW * halfW) + (dy * dy) / (halfH * halfH) < 1) {
          this.mask[y][x] = false
          this.eyeMask[y][x] = true
        }
      }
    }
  }

  private drawZoneWithEyes(yStart: number, yEnd: number, width: number) {
    this.drawZone(yStart, yEnd, width)
    const p = this.params.data
    const headH = this.rows * (p.head_height / 100)
    let eyeW = Math.floor(headH * (p.eye_width / 100))
    let eyeH = Math.floor(headH * (p.eye_height / 100))
    const eyeSpacing = Math.floor(headH * (p.eye_spacing / 100))
    if (eyeW < 2) eyeW = 2
    if (eyeH < 2) eyeH = 2
    const eyeY = Math.floor((yStart + yEnd) / 2)
    const eyeXLeft = this.cx - Math.floor(eyeSpacing / 2)
    const eyeXRight = this.cx + Math.floor(eyeSpacing / 2)
    this.cutEye(eyeXLeft, eyeY, eyeW, eyeH)
    this.cutEye(eyeXRight, eyeY, eyeW, eyeH)
    this.eye_areas = []
    for (const [ex, ey] of [
      [eyeXLeft, eyeY],
      [eyeXRight, eyeY],
    ] as const) {
      this.eye_areas.push({ x: ex, y: ey, w: eyeW, h: eyeH, eye_x: ex, eye_y: ey })
    }
  }

  private cutNose(nx: number, ny: number, w: number, h: number) {
    const halfW = Math.max(1, Math.floor(w / 2))
    const halfH = Math.max(1, Math.floor(h / 2))
    for (let y = Math.max(0, ny - halfH); y < Math.min(this.rows, ny + halfH); y++) {
      for (let x = Math.max(0, nx - halfW); x < Math.min(this.cols, nx + halfW); x++) {
        const dx = Math.abs(x - nx)
        const dy = y - ny
        if (dy < 0) {
          if (dx < halfW * (0.3 + 0.7 * (1 + dy / Math.max(1, halfH)))) {
            this.mask[y][x] = false
          }
        } else if (dx < halfW * (1 - (dy / Math.max(1, halfH)) * 0.5)) {
          this.mask[y][x] = false
        }
      }
    }
  }

  private drawZoneWithNose(yStart: number, yEnd: number, width: number) {
    this.drawZone(yStart, yEnd, width)
    const p = this.params.data
    const headH = this.rows * (p.head_height / 100)
    let noseW = Math.floor(headH * (p.nose_width / 100))
    let noseH = Math.floor(headH * (p.nose_height / 100))
    if (noseW < 2) noseW = 2
    if (noseH < 2) noseH = 2
    const noseY = Math.floor((yStart + yEnd) / 2)
    this.cutNose(this.cx, noseY, noseW, noseH)
  }

  private drawZoneWithMouth(yStart: number, yEnd: number, width: number) {
    this.drawZone(yStart, yEnd, width)
    const p = this.params.data
    const headH = this.rows * (p.head_height / 100)
    this.mouth_w = Math.max(2, Math.floor(headH * (p.mouth_width / 100)))
    this.mouth_h = Math.max(1, Math.floor(headH * (p.mouth_height / 100)))
    this.mouth_y = Math.floor((yStart + yEnd) / 2)
  }

  private clearMasks() {
    for (let y = 0; y < this.rows; y++) {
      this.mask[y].fill(false)
      this.eyeMask[y].fill(false)
    }
    this.eye_areas = []
  }

  private buildMask() {
    const p = this.params.data
    const w = this.cols
    const h = this.rows
    const headH = Math.floor((h * p.head_height) / 100)

    const zoneTopH = Math.floor((headH * p.zone_top) / 100)
    const zoneForeheadH = Math.floor((headH * p.zone_forehead) / 100)
    const zoneEyesH = Math.floor((headH * p.zone_eyes) / 100)
    const zoneNoseH = Math.floor((headH * p.zone_nose) / 100)
    const zoneMouthH = Math.floor((headH * p.zone_mouth) / 100)
    const zoneChinH = Math.floor((headH * p.zone_chin) / 100)

    const yTop = this.cy - Math.floor(headH / 2)
    const yForehead = yTop + zoneTopH
    const yEyes = yForehead + zoneForeheadH
    const yNose = yEyes + zoneEyesH
    const yMouth = yNose + zoneNoseH
    const yChin = yMouth + zoneMouthH
    const yBottom = yChin + zoneChinH

    const wTop = Math.floor((w * p.width_top) / 100)
    const wForehead = Math.floor((w * p.width_forehead) / 100)
    const wEyes = Math.floor((w * p.width_eyes) / 100)
    const wNose = Math.floor((w * p.width_nose) / 100)
    const wMouth = Math.floor((w * p.width_mouth) / 100)
    const wChin = Math.floor((w * p.width_chin) / 100)

    this.clearMasks()
    this.mouth_cx = this.cx

    this.drawZone(yTop, yForehead, wTop)
    this.drawZone(yForehead, yEyes, wForehead)
    this.drawZoneWithEyes(yEyes, yNose, wEyes)
    this.drawZoneWithNose(yNose, yMouth, wNose)
    this.drawZoneWithMouth(yMouth, yChin, wMouth)
    this.drawZone(yChin, yBottom, wChin)

    this.initPupils()
    this.buildEyebrows()
    this.initFaceCells()
  }

  private initPupils() {
    this.pupils = []
    const sizeMul = Math.max(0.3, this.params.data.pupil_size || 1)
    for (const eye of this.eye_areas) {
      this.pupils.push({
        x: eye.eye_x,
        y: eye.eye_y,
        size: Math.max(2, Math.floor(Math.min(eye.w, eye.h) / 3) * sizeMul),
        char: '●',
        eye_x: eye.eye_x,
        eye_y: eye.eye_y,
        offset_x: 0,
        offset_y: 0,
      })
    }
  }

  refreshPupils() {
    this.initPupils()
  }

  buildEyebrows() {
    this.eyebrows = []
    if (!this.eye_areas.length) return

    const scale = this.modelMode ? Math.max(1, this.rows / 40) : 1
    const browW = Math.max(4, Math.round(this.eye_areas[0].w * 1.05))
    const browH = 1
    // Бровь висит небольшим зазором над глазом — хорошо читается и с дистанции
    const gap = this.modelMode ? 3 : Math.max(2, Math.round(scale * 1.8))

    for (const eye of this.eye_areas) {
      const isLeft = eye.x < this.cx
      this.eyebrows.push({
        x: Math.round(eye.x),
        y: Math.round(eye.y - eye.h / 2 - gap),
        width: browW,
        height: browH,
        isLeft,
        innerOffset: 0,
        outerOffset: 0,
        curInner: 0,
        curOuter: 0,
      })
    }
    this.applyEmotionToBrows()
  }

  /** Пересчитывает целевые изгибы бровей под текущую эмоцию. */
  applyEmotionToBrows() {
    const emo = Math.max(-1, Math.min(1, this.eyebrow_emotion))
    const inten = this.emotion_data.browIntensity
    const scale = this.modelMode ? Math.max(1, this.rows / 40) : 1
    for (const eb of this.eyebrows) {
      if (emo > 0.02) {
        // Добрый: приподнятая арка — оба края вверх, внешний заметно выше (улыбчивая дуга)
        const lift = Math.max(1, Math.round(scale * 2.6))
        eb.innerOffset = Math.round(emo * inten * lift * 0.55)
        eb.outerOffset = Math.round(emo * inten * lift * 1.0)
      } else if (emo < -0.02) {
        // Злой: резкая V-хмурость — внутренние края вниз, внешние вверх
        const a = -emo
        const frown = Math.max(1, Math.round(scale * 2.8))
        eb.innerOffset = -Math.round(a * inten * frown)
        eb.outerOffset = Math.round(a * inten * frown * 0.35)
      } else {
        // Нейтрально: едва заметный естественный наклон дуги
        eb.innerOffset = Math.round(scale * 0.35)
        eb.outerOffset = 0
      }
    }
  }

  set_emotion(emotion: number) {
    this.eyebrow_emotion = Math.max(-1, Math.min(1, emotion))
    this.applyEmotionToBrows()
  }

  setChatter(v: boolean) {
    this.chatter = v
  }

  setEmotionData(data: { browIntensity: number; mouthIntensity: number; eyeSquint: number; pupilBias: number }) {
    this.emotion_data = data
    this.applyEmotionToBrows()
  }

  /** Читает настройки мимики из параметров (слайдеры Брови/Уголки/Прищур). */
  syncEmotionData() {
    const p = this.params.data
    this.emotion_data = {
      browIntensity: Math.max(0, Math.min(2, p.emotion_brow_intensity ?? 0.6)),
      mouthIntensity: Math.max(0, Math.min(2, p.emotion_mouth_intensity ?? 0.8)),
      eyeSquint: Math.max(0, Math.min(2, p.emotion_eye_squint ?? 0.4)),
      pupilBias: Math.max(0, Math.min(2, p.emotion_pupil_bias ?? 1.0)),
    }
    this.applyEmotionToBrows()
  }

  /** Множитель размера зрачка под эмоцию (злость — зрачок сужается). */
  getEmotionPupilSizeMul(): number {
    const e = this.eyebrow_emotion
    if (e < 0) {
      return Math.max(0.5, 1 - (-e) * this.emotion_data.pupilBias * 0.5)
    }
    return 1 + e * this.emotion_data.pupilBias * 0.12
  }

  /** Принадлежит ли клетка глазнице/рту (непрозрачные «дыры» лица). */
  isInFaceHole(x: number, y: number): boolean {
    for (const e of this.eye_areas) {
      const rx = Math.max(1, e.w / 2 + 0.5)
      const ry = Math.max(1, e.h / 2 + 0.3)
      const dx = (x - Math.round(e.x)) / rx
      const dy = (y - Math.round(e.y)) / ry
      if (dx * dx + dy * dy <= 1.15) return true
    }
    if (this.mouth_w > 0) {
      const rx = this.mouth_w / 2 + 0.5
      const ry = Math.max(2, this.mouth_h + 1) / 2
      const dx = (x - Math.round(this.mouth_cx)) / rx
      const dy = (y - Math.round(this.mouth_y)) / ry
      if (dx * dx + dy * dy <= 1.15) return true
    }
    return false
  }

  rebuildMask() {
    if (this.modelMode) this.reapplyModelMask()
    else this.buildMask()
    this.syncBaseMask()
  }

  /** Синхронный кэш базовой маски (без выреза рта) для дешёвого восстановления. */
  private syncBaseMask() {
    if (
      !this.mouthBaseMask ||
      this.mouthBaseMask.length !== this.rows ||
      (this.mouthBaseMask[0] && this.mouthBaseMask[0].length !== this.cols)
    ) {
      this.mouthBaseMask = Array.from({ length: this.rows }, () => Array(this.cols).fill(false))
    }
    for (let y = 0; y < this.rows; y++) {
      const src = this.mask[y]
      const dst = this.mouthBaseMask[y]
      for (let x = 0; x < this.cols; x++) dst[x] = src[x]
    }
  }

  /** Base mask derived from the loaded model (does not touch eyes/pupils/brows). */
  private reapplyModelMask() {
    if (!this.modelGrid || !this.modelBrightness) return
    for (let y = 0; y < this.rows; y++) {
      for (let x = 0; x < this.cols; x++) {
        this.mask[y][x] = !!(
          this.modelGrid[y]?.[x] !== undefined &&
          this.modelGrid[y][x] !== ' ' &&
          this.modelBrightness[y][x] > 0
        )
      }
    }
  }

  loadModel(model: ModelData) {
    const rows = Math.max(1, Math.min(1500, model.rows))
    const cols = Math.max(1, Math.min(1500, model.cols))
    this.rows = rows
    this.cols = cols
    this.cx = Math.floor(cols / 2)
    this.cy = Math.floor(rows / 2)
    this.modelMode = true
    this.modelGrid = model.grid_char.map((r) => r.slice())
    this.modelEye = model.is_eye.map((r) => r.slice())
    this.modelMouth = model.is_mouth.map((r) => r.slice())
    this.modelBrightness = model.grid_brightness.map((r) => r.slice())
    this.grid = this.modelGrid.map((r) => r.slice())
    this.mask = Array.from({ length: rows }, () => Array(cols).fill(false))
    this.eyeMask = Array.from({ length: rows }, () => Array(cols).fill(false))
    this.reapplyModelMask()

    const eyes = this.detectModelEyes()
    this.eyeMask = eyes.eyeMask
    this.eye_areas = eyes.eye_areas

    const mouth = this.detectModelMouth()
    this.mouth_y = mouth.y
    this.mouth_w = mouth.w
    this.mouth_cx = mouth.cx
    this.mouth_h = mouth.h

    this.initPupils()
    this.buildEyebrows()
    this.initFaceCells()
    this.syncBaseMask()

    this.mouth_open = 0
    this.target_mouth_open = 0
    this.mouth_timer = 0
    this.mouth_reset_needed = false
    this.mouthWasOpen = false
    this.is_playing = false
    this.current_amplitude = 0
    this.blink_timer = 0
    this.is_blinking = false
    this.blink_interval = Math.max(0.2, this.params.data.blink_interval || 3)
    this.blink_duration = Math.max(0.03, this.params.data.blink_duration || 0.2)
    this.float_timer = 0
    this.faceAnim = createFaceAnimState()
    this.syncEmotionData()
    this.toggleErosion(false)
  }

  clearModel() {
    this.modelMode = false
    this.modelGrid = null
    this.modelEye = null
    this.modelMouth = null
    this.modelBrightness = null
    this.rows = 45
    this.cols = 80
    this.cx = 40
    this.cy = 22
    this.grid = Array.from({ length: this.rows }, () =>
      Array.from({ length: this.cols }, () => HEX[Math.floor(Math.random() * HEX.length)]),
    )
    this.mask = Array.from({ length: this.rows }, () => Array(this.cols).fill(false))
    this.eyeMask = Array.from({ length: this.rows }, () => Array(this.cols).fill(false))
    this.mouthBaseMask = null
    this.blink_duration = Math.max(0.03, this.params.data.blink_duration || 0.2)
    this.blink_interval = Math.max(0.2, this.params.data.blink_interval || 3)
    this.blink_timer = 0
    this.is_blinking = false
    this.faceAnim = createFaceAnimState()
    this.rebuildMask()
  }

  /** Explicit is_eye cells, or auto-detected enclosed holes in the face. */
  private detectModelEyes(): { eyeMask: boolean[][]; eye_areas: EyeArea[] } {
    const eyeMask = Array.from({ length: this.rows }, () => Array(this.cols).fill(false))
    const eye_areas: EyeArea[] = []
    if (this.modelEye) {
      let explicit = 0
      for (let y = 0; y < this.rows; y++) for (let x = 0; x < this.cols; x++) if (this.modelEye[y][x]) explicit++
      if (explicit > 0) {
        for (let y = 0; y < this.rows; y++) for (let x = 0; x < this.cols; x++) if (this.modelEye[y][x]) eyeMask[y][x] = true
        for (const comp of this.findComponents(eyeMask)) {
          const b = comp.b
          const cx = (b.minX + b.maxX + 1) / 2
          const cy = (b.minY + b.maxY + 1) / 2
          eye_areas.push({ x: cx, y: cy, w: b.maxX - b.minX + 1, h: b.maxY - b.minY + 1, eye_x: cx, eye_y: cy })
        }
        return { eyeMask, eye_areas }
      }
    }
    // auto-detect: the two topmost enclosed holes = eyes
    const holes = this.findEnclosedHoles()
    holes.sort((a, b) => a.y - b.y || b.area - a.area)
    for (const h of holes.slice(0, 2)) {
      for (const [x, y] of h.cells) eyeMask[y][x] = true
      eye_areas.push({ x: h.cx, y: h.cy, w: h.w, h: h.h, eye_x: h.cx, eye_y: h.cy })
    }
    return { eyeMask, eye_areas }
  }

  /** Explicit is_mouth cells, or the widest enclosed hole below the eyes (upper 60% of the lower half) = mouth. */
  private detectModelMouth(): { y: number; w: number; h: number; cx: number } {
    if (this.modelMouth) {
      let explicit = 0
      for (let y = 0; y < this.rows; y++) for (let x = 0; x < this.cols; x++) if (this.modelMouth[y][x]) explicit++
      if (explicit > 0) {
        let minX = Infinity
        let maxX = -1
        let minY = Infinity
        let maxY = -1
        for (let y = 0; y < this.rows; y++) {
          for (let x = 0; x < this.cols; x++) {
            if (!this.modelMouth[y][x]) continue
            if (x < minX) minX = x
            if (x > maxX) maxX = x
            if (y < minY) minY = y
            if (y > maxY) maxY = y
          }
        }
        const w = maxX - minX + 1
        const h = maxY - minY + 1
        if (w >= 1) {
          return { y: Math.round((minY + maxY) / 2), w, h, cx: Math.round((minX + maxX) / 2) }
        }
      }
    }
    const holes = this.findEnclosedHoles()
    const eyeBottom = this.eye_areas.reduce((m, e) => Math.max(m, e.y + e.h / 2), 0)
    const lowerBound = this.cy + Math.floor((this.rows - this.cy) * 0.6)
    let best = { y: 0, w: 0, h: 0, cx: this.cx }
    for (const h of holes) {
      if (h.y < eyeBottom + 1) continue
      if (h.y > lowerBound) continue
      if (h.w > best.w) best = { y: Math.round(h.cy), w: h.w, h: h.h, cx: Math.round(h.cx) }
    }
    if (best.w < 3) return { y: 0, w: 0, h: 0, cx: this.cx }
    return best
  }

  private findComponents(grid: boolean[][]): Array<{ cells: Array<[number, number]>; b: { minX: number; maxX: number; minY: number; maxY: number } }> {
    const seen = new Set<string>()
    const out: Array<{ cells: Array<[number, number]>; b: { minX: number; maxX: number; minY: number; maxY: number } }> = []
    for (let y = 0; y < this.rows; y++) {
      for (let x = 0; x < this.cols; x++) {
        if (!grid[y][x]) continue
        const k = `${x},${y}`
        if (seen.has(k)) continue
        const q: Array<[number, number]> = [[x, y]]
        seen.add(k)
        const cells: Array<[number, number]> = []
        let b = { minX: x, maxX: x, minY: y, maxY: y }
        while (q.length) {
          const [cx2, cy2] = q.pop()!
          cells.push([cx2, cy2])
          if (cx2 < b.minX) b.minX = cx2
          if (cx2 > b.maxX) b.maxX = cx2
          if (cy2 < b.minY) b.minY = cy2
          if (cy2 > b.maxY) b.maxY = cy2
          for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const nx = cx2 + dx
            const ny = cy2 + dy
            if (nx < 0 || nx >= this.cols || ny < 0 || ny >= this.rows) continue
            if (!grid[ny][nx]) continue
            const kk = `${nx},${ny}`
            if (seen.has(kk)) continue
            seen.add(kk)
            q.push([nx, ny])
          }
        }
        out.push({ cells, b })
      }
    }
    return out
  }

  /** Enclosed (not touching the face bbox border) empty regions, area >= 4. */
  private findEnclosedHoles(): Array<{ cells: Array<[number, number]>; x: number; y: number; w: number; h: number; cx: number; cy: number; area: number }> {
    let minX = Infinity
    let maxX = -1
    let minY = Infinity
    let maxY = -1
    for (let y = 0; y < this.rows; y++) {
      for (let x = 0; x < this.cols; x++) {
        if (this.mask[y][x]) {
          if (x < minX) minX = x
          if (x > maxX) maxX = x
          if (y < minY) minY = y
          if (y > maxY) maxY = y
        }
      }
    }
    if (maxX < 0) return []
    const seen = new Set<string>()
    const out: Array<{ cells: Array<[number, number]>; x: number; y: number; w: number; h: number; cx: number; cy: number; area: number }> = []
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        if (this.mask[y][x]) continue
        const k = `${x},${y}`
        if (seen.has(k)) continue
        const q: Array<[number, number]> = [[x, y]]
        seen.add(k)
        const cells: Array<[number, number]> = []
        let touches = false
        let b = { minX: x, maxX: x, minY: y, maxY: y }
        let area = 0
        while (q.length) {
          const [cx2, cy2] = q.pop()!
          cells.push([cx2, cy2])
          area++
          if (cx2 === minX || cx2 === maxX || cy2 === minY || cy2 === maxY) touches = true
          if (cx2 < b.minX) b.minX = cx2
          if (cx2 > b.maxX) b.maxX = cx2
          if (cy2 < b.minY) b.minY = cy2
          if (cy2 > b.maxY) b.maxY = cy2
          for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const nx = cx2 + dx
            const ny = cy2 + dy
            if (nx < minX || nx > maxX || ny < minY || ny > maxY) continue
            if (this.mask[ny][nx]) continue
            const kk = `${nx},${ny}`
            if (seen.has(kk)) continue
            seen.add(kk)
            q.push([nx, ny])
          }
        }
        if (touches) continue
        if (area < 4) continue
        out.push({
          cells,
          x: b.minX,
          y: b.minY,
          w: b.maxX - b.minX + 1,
          h: b.maxY - b.minY + 1,
          cx: (b.minX + b.maxX + 1) / 2,
          cy: (b.minY + b.maxY + 1) / 2,
          area,
        })
      }
    }
    return out
  }

  resetMouth() {
    this.mouth_open = 0
    this.target_mouth_open = 0
    this.is_playing = false
    this.current_amplitude = 0
    this.mouth_timer = 0
    this.mouth_target = 0
    this.mouth_reset_needed = false
    this.rebuildMask()
  }

  private updatePupils(_dt: number) {
    // Зрачки теперь управляются через faceAnim.saccade (саккады + дрейф + тремор)
    const offset = getPupilOffset(this.faceAnim.saccade)
    this.global_offset_x = offset.x
    this.global_offset_y = offset.y
    for (const p of this.pupils) {
      p.x = p.eye_x + offset.x
      p.y = p.eye_y + offset.y
    }
  }

  private updateBlink(dt: number) {
    const p = this.params.data
    const baseInterval = Math.max(0.2, p.blink_interval || 3)
    const baseDuration = Math.max(0.03, p.blink_duration || 0.2)

    // Делегируем новому биофизическому движку
    // faceAnim.blink обновляется в updateFaceAnim(), здесь синхронизируем старые поля
    // для обратной совместимости с canvas.ts
    const bl = blinkLevel(this.faceAnim.blink)
    this.blink_state = bl
    this.is_blinking = bl > 0.01
  }

  private updateMouth(dt: number) {
    let fullRebuild = false
    if (this.mouth_reset_needed) {
      this.mouth_reset_needed = false
      this.mouth_open = 0
      this.target_mouth_open = 0
      this.faceAnim.mouth.openness = 0
      this.faceAnim.mouth.velocity = 0
      this.faceAnim.mouth.target = 0
      fullRebuild = true
    }

    // Рот теперь управляется через faceAnim.mouth (spring/damping + idle breathing)
    // Синхронизируем старые поля для обратной совместимости
    this.mouth_open = this.faceAnim.mouth.openness
    this.target_mouth_open = this.faceAnim.mouth.target

    // Восстанавливаем базовую маску только при переходе открыт⇄закрыт,
    // а не каждый кадр при открытом рте (это убивало эрозию и грузило GC).
    // Гистерезис: открываемся выше 0.05 (совпадает с draw/paint порогом),
    // держим открытым до просадки ниже 0.03 — idle breathing (≤0.025) не триггерит ребуилд.
    const nowOpen = this.mouthWasOpen
      ? this.mouth_open > 0.03
      : this.mouth_open > 0.05
    const wasOpen = this.mouthWasOpen
    if (nowOpen !== wasOpen) fullRebuild = true
    this.mouthWasOpen = nowOpen

    if (fullRebuild) {
      this.rebuildMask()
    } else if (nowOpen && this.mouthBaseMask) {
      // Рот остался открытым: восстановить чистую (базовую) маску из кэша,
      // чтобы перерезать дыру рта под текущую ширину без полного пересборa.
      for (let y = 0; y < this.rows; y++) {
        const src = this.mouthBaseMask[y]
        const dst = this.mask[y]
        for (let x = 0; x < this.cols; x++) dst[x] = src[x]
      }
    }

    // when closed after being open, mask is left restored (base) — cut nothing.
    if (this.mouth_open > 0.05 && nowOpen) {
      const wf = this.faceAnim.mouth.widthFactor
      const openH = Math.floor(2 + this.mouth_open * 1.5)
      if (openH > 0) {
        for (let y = this.mouth_y; y < Math.min(this.rows, this.mouth_y + openH); y++) {
          const yOffset = (y - this.mouth_y) / Math.max(1, openH)
          // Адаптивная ширина: widthFactor растёт при широком открытии
          const widthScale = wf * (1 - yOffset * 0.15)
          const mw = Math.floor(this.mouth_w * widthScale)
          for (let x = this.mouth_cx - Math.floor(mw / 2); x < this.mouth_cx + Math.floor(mw / 2); x++) {
            if (x >= 0 && x < this.cols && y >= 0 && y < this.rows) this.mask[y][x] = false
          }
        }
      }
    }
  }

  private updateFloat(dt: number) {
    this.float_timer += dt
    this.offset_x = Math.sin(this.float_timer * 0.15) * 3
    this.offset_y = Math.cos(this.float_timer * 0.12) * 2
  }

  updateFromAudio(isPlaying: boolean, amplitude = 0, dt = 0.016) {
    if (isPlaying && !this.is_playing) this.mouth_reset_needed = true
    this.is_playing = isPlaying
    this.current_amplitude = amplitude
  }

  isBorder(x: number, y: number): boolean {
    if (y < 0 || y >= this.rows || x < 0 || x >= this.cols || !this.mask[y][x]) return false
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue
        const nx = x + dx
        const ny = y + dy
        if (nx >= 0 && nx < this.cols && ny >= 0 && ny < this.rows && !this.mask[ny][nx]) return true
      }
    }
    return false
  }

  isEye(x: number, y: number): boolean {
    return !!this.eyeMask[y]?.[x]
  }

  getColorForCell(x: number, y: number, base: RGB): RGB {
    const p = this.params.data
    if (!p.color_effect && !p.color_effect_active) return base
    if (p.color_effect_progress <= 0) return this.shade(p.color_effect_target || 'green', base[1] || 100)
    const stepSize = 3
    const groupY = Math.floor(y / stepSize)
    const rowProgress = groupY / Math.max(1, this.rows / stepSize)
    const progress = p.color_effect_progress
    const brightness = base[1] > 0 ? base[1] : 100
    const b = Math.min(255, Math.max(0, brightness))
    if (progress >= 1) return this.shade(p.color_effect_target, b)
    if (rowProgress > progress) return this.shade(p.previous_color, b)
    return this.shade(p.color_effect_target, b)
  }

  private shade(state: 'red' | 'white' | 'green', b: number): RGB {
    if (state === 'red') return [Math.floor((255 * b) / 255), 0, 0]
    if (state === 'white') return [b, b, b]
    return [0, b, 0]
  }

  updateFrame(dt = 0.016) {
    this.frame_count++
    
    // Единый тик биофизического движка анимации лица
    const p = this.params.data
    updateFaceAnim(this.faceAnim, dt, {
      blinkEnabled: p.blink_enabled !== false,
      blinkInterval: Math.max(0.2, p.blink_interval || 3),
      blinkDuration: Math.max(0.03, p.blink_duration || 0.2),
      pupilMove: p.pupil_move !== false,
      pupilScale: Math.max(0.3, p.pupil_size || 1),
      isPlaying: this.is_playing,
      amplitude: this.current_amplitude,
      mouthAmp: Math.max(0, p.mouth_amp || 1),
      mouthSpeed: Math.max(0.2, p.mouth_speed || 1),
      chatter: this.chatter,
    })

    // Синхронизация старых полей
    this.updateBlink(dt)
    this.updateFloat(dt)
    this.updateMouth(dt)
    this.updatePupils(dt)

    // Сглаживание эмоции и дуг бровей (плавные переходы мимики)
    const emoK = this.modelMode ? 1 - Math.pow(0.02, dt) : 1 - Math.pow(0.05, dt)
    this.emotionSmooth += (this.eyebrow_emotion - this.emotionSmooth) * Math.max(0, Math.min(1, emoK))
    for (const eb of this.eyebrows) {
      const k = 1 - Math.pow(0.0008, dt)
      eb.curInner += (eb.innerOffset - eb.curInner) * Math.max(0, Math.min(1, k))
      eb.curOuter += (eb.outerOffset - eb.curOuter) * Math.max(0, Math.min(1, k))
    }

    this.updateErosion(dt)
    this.updateFallingChars(dt)
    if (!this.modelMode && this.frame_count % 3 === 0) {
      for (let y = 0; y < this.rows; y++) {
        for (let x = 0; x < this.cols; x++) {
          if (this.mask[y][x] && Math.random() < 0.05) {
            this.grid[y][x] = HEX[Math.floor(Math.random() * HEX.length)]
          }
        }
      }
    }
  }

  toggleErosion(active: boolean) {
    if (active && !this.erosion_active) {
      this.erosion_active = true
      this.erosion_timer = 0
      for (const cell of this.erosion_cells.values()) {
        cell.eroded = false
        cell.progress = 0
        cell.timer = 0
      }
      this.erodedMask.fill(0)
      this.falling_chars = []
      for (let i = 0; i < Math.min(5, this.face_cells.length); i++) {
        const cell = this.face_cells[Math.floor(Math.random() * this.face_cells.length)]
        const d = this.erosion_cells.get(this.key(cell[0], cell[1]))
        if (d) {
          d.eroded = true
          d.progress = 0.5
          d.timer = rnd(0, this.erosion_duration)
          this.erodedMask[cell[1] * this.cols + cell[0]] = 1
        }
      }
    } else if (!active && this.erosion_active) {
      for (const cell of this.erosion_cells.values()) {
        cell.eroded = false
        cell.progress = 0
        cell.timer = 0
      }
      this.erodedMask.fill(0)
      this.falling_chars = []
      this.erosion_active = false
    }
  }

  private updateErosion(dt: number) {
    if (!this.erosion_active || !this.face_cells.length) return
    this.erosion_timer += dt
    if (this.erosion_timer >= this.erosion_interval / this.erosion_intensity) {
      this.erosion_timer = 0
      let erodedCount = 0
      for (const d of this.erosion_cells.values()) if (d.eroded) erodedCount++
      if (erodedCount < this.erosion_max_cells) {
        const available = this.face_cells.filter((c) => {
          const d = this.erosion_cells.get(this.key(c[0], c[1]))
          return d ? !d.eroded : true
        })
        if (available.length) {
          const numNew = Math.min(Math.floor(rnd(1, 3) * this.erosion_intensity), available.length, this.erosion_max_cells - erodedCount)
          for (let i = 0; i < numNew; i++) {
            const cell = available.splice(Math.floor(Math.random() * available.length), 1)[0]
            const d = this.erosion_cells.get(this.key(cell[0], cell[1]))!
            d.eroded = true
            d.progress = 0
            d.timer = 0
          }
        }
      }
    }
    for (const [k, d] of this.erosion_cells) {
      if (!d.eroded) continue
      const x = k % this.cols
      const y = Math.floor(k / this.cols)
      if (d.progress < 1) {
        const prev = d.progress
        d.progress = Math.min(1, d.progress + this.erosion_fade_speed * dt)
        if (d.progress >= 0.3 && prev < 0.3) this.erodedMask[y * this.cols + x] = 1
        if (d.progress >= 0.5 && prev < 0.5) {
          if (x >= 0 && x < this.cols && y >= 0 && y < this.rows) {
            this.falling_chars.push({
              x, y, char: this.grid[y][x], start_x: x, start_y: y,
              speed_y: (0.15 + Math.random() * 0.3) * this.erosion_intensity,
              speed_x: rnd(-0.2, 0.2),
              alpha: 1, progress: 0, life: 0,
            })
          }
        }
      }
      d.timer += dt
      if (d.timer >= this.erosion_duration) {
        d.progress = Math.max(0, d.progress - this.erosion_fade_speed * dt * 1.5)
        if (d.progress <= 0.3) this.erodedMask[y * this.cols + x] = 0
        if (d.progress <= 0) {
          d.eroded = false
          d.timer = 0
        }
      }
    }
    if (Math.random() < 0.03) {
      let erodedCount = 0
      for (const d of this.erosion_cells.values()) if (d.eroded) erodedCount++
      if (erodedCount < this.erosion_max_cells) {
        const available = this.face_cells.filter((c) => {
          const d = this.erosion_cells.get(this.key(c[0], c[1]))
          return d ? !d.eroded : true
        })
        if (available.length) {
          const cell = available[Math.floor(Math.random() * available.length)]
          const d = this.erosion_cells.get(this.key(cell[0], cell[1]))!
          d.eroded = true
          d.progress = rnd(0, 0.3)
          d.timer = 0
        }
      }
    }
  }

  private updateFallingChars(dt: number) {
    for (let i = this.falling_chars.length - 1; i >= 0; i--) {
      const fc = this.falling_chars[i]
      fc.y += fc.speed_y
      fc.x += fc.speed_x
      fc.speed_y += 0.008
      fc.progress += dt
      fc.life += dt
      if (fc.life > 0.6) fc.alpha = Math.max(0, fc.alpha - 0.02)
      // dissolve before reaching the bottom edge of the head
      if (fc.y > this.rows - 3 || fc.alpha <= 0) this.falling_chars.splice(i, 1)
    }
  }

  isEroded(x: number, y: number): boolean {
    return this.erodedMask[y * this.cols + x] === 1
  }
}
