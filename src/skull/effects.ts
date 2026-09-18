import { SkullRenderer } from './renderer'

export type RGB = [number, number, number]

const HEX = '0123456789ABCDEF'
const CODE_CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ'
const MATRIX_CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ'
const ALARM_SYMBOLS = ['(!)', '(!!)', '(!!!)', '!?!', '!!!']
const ALARM_PHRASES = ['[ERROR]', '!!! WARNING !!!', '!!! ALARM !!!', '[SYSTEM FAIL]', '[ATTENTION]']

function rnd(min: number, max: number): number {
  return min + Math.random() * (max - min)
}

interface CodeParticle {
  x: number; y: number; char: string; size: number
  speed_x: number; speed_y: number; phase: number; brightness: number
  flicker_speed: number; life: number; max_life: number; opacity: number
}

interface AlarmItem {
  x: number; y: number; text: string; size: number; life: number; max_life: number
  side: string; is_symbol: boolean; rotation: number; pulse: number; pulse_speed: number
  alpha: number; scale: number
}

interface TerminalLine {
  text: string; x: number; y: number; size: number; life: number; max_life: number
  alpha: number; blink: boolean; blink_timer: number; blink_speed: number
}

interface MatrixDrop {
  x: number; y: number; chars: string[]; length: number; speed: number; head: number
  brightness: number; update_interval: number; timer: number
}

interface ShatterCell { eroded: boolean; progress: number; timer: number }

interface ShatterFallingChar {
  x: number; y: number; char: string; start_x: number; start_y: number
  speed_y: number; speed_x: number; alpha: number; life: number; max_life: number
}

interface GlitchLine { y: number; height: number; offset: number; alpha: number; life: number }
interface GlitchNoise { x: number; y: number; size: number; alpha: number; life: number; r: number; g: number; b: number }

const TERMINAL_SOURCE = [
  'import os', 'import sys', 'from electron import app, BrowserWindow',
  'class MainWindow: pass', 'def __init__(self):', 'super().__init__()',
  "self.setWindowTitle('ГОЛОВА')", 'self.init_ui()', 'self.audio_player = AudioPlayer()',
  'self.video_player = VideoPlayer()', 'self.load_avatar()', 'pass',
  "if __name__ == '__main__':", 'app = QApplication(sys.argv)', 'window = MainWindow()',
  'window.show()', 'sys.exit(app.exec_())', 'import numpy as np', 'import cv2',
  'import random', 'import math', 'from PyQt5.QtCore import Qt', 'from PyQt5.QtGui import QPainter',
  'def build_mask(): pass', 'def update_mouth(): pass', 'self.cx = 40', 'self.cy = 22',
  'class SkullRenderer: pass', 'for x in range(cols):', 'self.mask[y][x] = True',
]

function colorForEffect(target: string, g: number): RGB {
  if (target === 'red') return [255, 50, 50]
  if (target === 'white') return [200, 200, 200]
  return [0, g, 0]
}

export class EffectsEngine {
  // Скорость фейдов: экспоненциальное затухание (k=dt*rate), как у головы
  // (updateHeadAnim). При rate=4 видимый спад начинается сразу и тянется
  // мягким хвостом ~1.2с — без «плато», когда эффект секунду висит ярким
  // и потом резко обрывается (так было с линейным step + ease()).
  fade_speed = 4
  intensity: Record<string, number> = {
    visualizer: 1,
    particles: 1,
    waves: 1,
    glitch: 0.6,
    alarm: 1,
    terminal: 1,
    matrix: 1,
    shatter: 1,
  }

  setIntensity(key: string, value: number) {
    const v = Math.max(0, Math.min(1, value))
    this.intensity[key] = v
    if (key === 'glitch' && this.glitch_active) this.glitch_target_intensity = v
  }

  // По умолчанию все эффекты ВЫКЛЮЧЕНЫ (current=0), чтобы при старте окна голова
  // не показывала «вспышку» включённых эффектов, а плавно их «приподымала» при запросе.
  visualizer_active = false
  visualizer_target = 0
  visualizer_current = 0
  visualizer_bars = 16
  visualizer_data: number[] = Array(16).fill(0)
  visualizer_smooth: number[] = Array(16).fill(0)
  visualizer_timer = 0

  code_particles_target = 0
  code_particles_current = 0
  code_particles: CodeParticle[] = []
  _particle_frame_counter = 0

  waves_active = false
  waves_target = 0
  waves_current = 0
  wave_timer = 0

  glitch_active = false
  glitch_target_intensity = 0
  glitch_current_intensity = 0
  glitch_timer = 0
  glitch_lines: GlitchLine[] = []
  glitch_color_shift = 0
  glitch_noise: GlitchNoise[] = []

  alarm_active = false
  alarm_current = 0
  alarm_items: AlarmItem[] = []
  alarm_timer = 0

  terminal_active = false
  terminal_current = 0
  terminal_lines: TerminalLine[] = []
  terminal_timer = 0
  terminal_max_lines = 20

  matrix_active = false
  matrix_current = 0
  matrix_drops: MatrixDrop[] = []
  matrix_timer = 0

  shatter_active = false
  shatter_current = 0
  shatter_cells: Map<string, ShatterCell> = new Map()
  private shatteredMask = new Uint8Array(0)
  private shatterCols = 0
  shatter_timer = 0
  shatter_interval = 0.6
  shatter_falling_chars: ShatterFallingChar[] = []
  face_cells: Array<[number, number]> = []
  visualizerSkipInBg = false

  constructor() {
    this.initCodeParticles(1920, 1080)
    this.initMatrixDrops(1920, 1080)
  }

  setVisualizer(active: boolean) { this.visualizer_target = active ? 1 : 0 }
  setCodeParticles(active: boolean) { this.code_particles_target = active ? 1 : 0 }
  setWaves(active: boolean) { this.waves_target = active ? 1 : 0 }

  toggleGlitch(active: boolean, width = 1920, height = 1080) {
    if (active === this.glitch_active) return
    this.glitch_active = active
    this.glitch_target_intensity = active ? this.intensity.glitch : 0
    if (active && !this.glitch_lines.length) {
      for (let i = 0; i < 5; i++) {
        this.glitch_lines.push({
          y: Math.floor(rnd(0, height)), height: Math.floor(rnd(8, 50)),
          offset: Math.floor(rnd(-60, 60)), alpha: rnd(0.5, 1), life: rnd(0.1, 0.3),
        })
      }
    }
  }
  setGlitchIntensity(i: number) { this.glitch_target_intensity = Math.max(0, Math.min(1, i)) }

  toggleAlarm(active: boolean, width = 1920, height = 1080) {
    if (active === this.alarm_active) return
    this.alarm_active = active
    if (active) {
      this.alarm_timer = 0
      for (let i = 0; i < 8; i++) this.addAlarmItem(width, height)
    }
  }

  private addAlarmItem(width: number, height: number) {
    const left = Math.random() < 0.5
    const x = left ? Math.floor(rnd(10, width * 0.15)) : Math.floor(rnd(width * 0.85, width - 10))
    const y = Math.floor(rnd(40, height - 40))
    const isSymbol = Math.random() < 0.4
    const text = isSymbol
      ? ALARM_SYMBOLS[Math.floor(Math.random() * ALARM_SYMBOLS.length)]
      : ALARM_PHRASES[Math.floor(Math.random() * ALARM_PHRASES.length)]
    const life = rnd(0.8, 2.5)
    this.alarm_items.push({
      x, y, text, size: Math.floor(rnd(20, 50)), life, max_life: life,
      side: left ? 'left' : 'right', is_symbol: isSymbol,
      rotation: rnd(-5, 5), pulse: rnd(0, 6.28), pulse_speed: rnd(1.5, 4),
      alpha: 1, scale: 1,
    })
  }

  toggleTerminal(active: boolean, width = 1920, height = 1080) {
    if (active === this.terminal_active) return
    this.terminal_active = active
    if (active) {
      this.terminal_timer = 0
      this.terminal_lines = []
      for (let i = 0; i < 8; i++) this.addTerminalLine(width, height)
    }
  }

  private terminalSize(width: number, height: number) {
    return Math.max(11, Math.floor(Math.min(width, height) / 50))
  }

  private terminalStep(width: number, height: number) {
    return this.terminalSize(width, height) + 5
  }

  private addTerminalLine(width: number, height: number) {
    let text = TERMINAL_SOURCE[Math.floor(Math.random() * TERMINAL_SOURCE.length)]
    const prefixes = ['> ', '$ ', '# ', '>>> ', '... ']
    const prefix = prefixes[Math.floor(Math.random() * prefixes.length)]
    const r = Math.random()
    if (r < 0.15) text = 'Downloading ' + text.slice(0, 30) + '...'
    else if (r < 0.25) text = 'Installing ' + text.slice(0, 30) + '...'
    else if (r < 0.33) text = 'Collecting ' + text.slice(0, 30) + '...'
    else if (r < 0.38) text = 'Successfully installed ' + text.slice(0, 20) + '...'
    const full = prefix + text
    const size = this.terminalSize(width, height)
    const step = this.terminalStep(width, height)
    let x = Math.max(10, Math.floor(width * 0.18))
    let y = Math.floor(height * 0.3) + this.terminal_lines.length * step
    if (y > height - 48) {
      for (const line of this.terminal_lines) line.y -= step
      y = height - 48
    }
    this.terminal_lines.push({
      text: full, x, y, size,
      life: rnd(3, 6), max_life: 3, alpha: 1,
      blink: Math.random() < 0.1, blink_timer: rnd(0, 1), blink_speed: rnd(0.5, 2),
    })
    if (this.terminal_lines.length > this.terminal_max_lines) {
      this.terminal_lines.shift()
      for (const line of this.terminal_lines) line.y -= step
    }
  }

  private initMatrixDrops(width: number, height: number) {
    this.matrix_drops = []
    for (let i = 0; i < 30; i++) {
      const length = Math.floor(rnd(5, 15))
      this.matrix_drops.push({
        x: Math.floor(rnd(0, width)), y: Math.floor(rnd(-height, 0)),
        chars: Array.from({ length }, () => MATRIX_CHARS[Math.floor(Math.random() * MATRIX_CHARS.length)]),
        length, speed: rnd(0.5, 2), head: 0, brightness: rnd(0.3, 1),
        update_interval: rnd(0.05, 0.15), timer: rnd(0, 0.1),
      })
    }
  }

  toggleMatrix(active: boolean, width = 1920, height = 1080) {
    if (active === this.matrix_active) return
    this.matrix_active = active
    if (active) {
      this.matrix_timer = 0
      if (!this.matrix_drops.length) this.initMatrixDrops(width, height)
    }
  }

  toggleShatter(active: boolean, renderer: SkullRenderer | null) {
    if (active === this.shatter_active) return
    this.shatter_active = active
    if (active) {
      this.shatter_timer = 0
      this.shatter_falling_chars = []
      this.initShatterState(renderer)
    }
  }

  private initShatterState(renderer: SkullRenderer | null) {
    if (!renderer) return
    this.shatter_cells = new Map()
    this.face_cells = []
    this.shatterCols = renderer.cols
    this.shatteredMask = new Uint8Array(renderer.rows * renderer.cols)
    for (let y = 0; y < renderer.rows; y++) {
      for (let x = 0; x < renderer.cols; x++) {
        if (renderer.mask[y][x]) {
          this.face_cells.push([x, y])
          this.shatter_cells.set(`${x},${y}`, { eroded: false, progress: 0, timer: 0 })
        }
      }
    }
    if (this.face_cells.length) {
      const numInitial = Math.min(10, this.face_cells.length)
      for (let i = 0; i < numInitial; i++) {
        const cell = this.face_cells[Math.floor(Math.random() * this.face_cells.length)]
        const d = this.shatter_cells.get(`${cell[0]},${cell[1]}`)
        if (d && !d.eroded) {
          d.eroded = true
          d.progress = 0.5
          d.timer = rnd(0, 0.5)
          this.setShatteredMask(cell[0], cell[1])
          this.addShatterFallingChar(cell, renderer)
        }
      }
    }
  }

  private setShatteredMask(x: number, y: number) {
    this.shatteredMask[y * this.shatterCols + x] = 1
  }

  private addShatterFallingChar(cell: [number, number], renderer: SkullRenderer | null) {
    if (!renderer) return
    const [x, y] = cell
    if (x < 0 || x >= renderer.cols || y < 0 || y >= renderer.rows) return
    const char = renderer.grid[y][x]
    this.shatter_falling_chars.push({
      x, y, char, start_x: x, start_y: y,
      speed_y: 0.15 + Math.random() * 0.3, speed_x: rnd(-0.2, 0.2),
      alpha: 1, life: 0, max_life: rnd(1, 2.5),
    })
  }

  isShattered(x: number, y: number): boolean {
    return this.shatteredMask[y * this.shatterCols + x] === 1
  }

  private initCodeParticles(width: number, height: number) {
    this.code_particles = []
    const baseSize = Math.max(14, Math.min(width, height) / 50)
    for (let i = 0; i < 25; i++) {
      this.code_particles.push({
        x: rnd(0, width), y: rnd(0, height), char: CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)],
        size: baseSize + rnd(-3, 8), speed_x: rnd(-0.8, 0.8), speed_y: rnd(-0.8, 0.8),
        phase: rnd(0, 6.28), brightness: rnd(0.6, 1), flicker_speed: rnd(0.015, 0.04),
        life: rnd(0, 1), max_life: rnd(5, 12), opacity: rnd(0.7, 1),
      })
    }
    const baseSmall = Math.max(10, Math.min(width, height) / 70)
    for (let i = 0; i < 8; i++) {
      this.code_particles.push({
        x: rnd(0, width), y: rnd(0, height), char: CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)],
        size: baseSmall + rnd(-2, 4), speed_x: rnd(-0.2, 0.2), speed_y: rnd(-0.2, 0.2),
        phase: rnd(0, 6.28), brightness: rnd(0.2, 0.5), flicker_speed: rnd(0.003, 0.008),
        life: rnd(0, 1), max_life: rnd(15, 30), opacity: rnd(0.2, 0.4),
      })
    }
  }

  setAudioData(isPlaying: boolean, amplitude: number) {
    if (isPlaying && amplitude > 0.001) {
      for (let i = 0; i < this.visualizer_bars; i++) {
        const freq = (i / this.visualizer_bars) * 3.14
        const base = amplitude * (0.5 + 0.5 * Math.sin(freq + this.visualizer_timer * 0.1))
        this.visualizer_data[i] = Math.min(1, base + Math.random() * amplitude * 0.2)
      }
    } else {
      for (let i = 0; i < this.visualizer_bars; i++) this.visualizer_data[i] *= 0.96
    }
    this.visualizer_timer += 0.01
  }

  updateFades(dt: number) {
    this.waves_current = this.step(this.waves_current, this.waves_target, dt)
    this.code_particles_current = this.step(this.code_particles_current, this.code_particles_target, dt)
    this.visualizer_current = this.step(this.visualizer_current, this.visualizer_target, dt)
  }

  // Экспоненциальное приближение к target, как у головы (updateHeadAnim):
  // k = dt*rate. Быстрый спад в начале, мягкий хвост в конце — без «залипания»
  // на яркости в начале fade-out и без резкого обрыва в финале.
  private step(cur: number, target: number, dt: number, rate = this.fade_speed): number {
    if (Math.abs(cur - target) < 0.001) return target
    const k = Math.min(1, dt * rate)
    return cur + (target - cur) * k
  }

  // Smoothstep: плавные концы у появления и исчезания (без рывка в 0 и без
  // «залипания» на полной яркости). Применяется на этапе отрисовки.
  private ease(t: number): number {
    const v = Math.max(0, Math.min(1, t))
    return v * v * (3 - 2 * v)
  }

  update(dt: number, width: number, height: number, renderer: SkullRenderer | null, amplitude: number) {
    this.updateFades(dt)

    // Движение частиц-символов гейтится по плавному current (как и отрисовка),
    // а не по code_particles_active — иначе флаг, выставленный только в false,
    // навсегда «парализует» символы (см. setCodeParticles).
    if (this.code_particles_current > 0.01) {
      this._particle_frame_counter++
      if (this._particle_frame_counter % 2 === 0) {
        this._particle_frame_counter = 0
        this.updateCodeParticles(width, height, amplitude)
      }
    }

    this.updateGlitch(dt, width, height)
    this.updateAlarm(dt, width, height)
    this.updateTerminal(dt, width, height)
    this.updateMatrix(dt, width, height)
    this.updateShatter(dt, width, height, renderer)
  }

  private updateCodeParticles(width: number, height: number, amplitude: number) {
    if (!this.code_particles.length || this.code_particles_current < 0.01) return
    const movementFactor = Math.max(0.02, amplitude * 1.5)
    for (const p of this.code_particles) {
      p.x += p.speed_x + movementFactor * (0.5 - Math.random()) * 0.8
      p.y += p.speed_y + movementFactor * (0.5 - Math.random()) * 0.8
      if (p.x < -20) p.x = width + 20
      else if (p.x > width + 20) p.x = -20
      if (p.y < -20) p.y = height + 20
      else if (p.y > height + 20) p.y = -20
      p.phase += p.flicker_speed
      p.life += 0.008
      if (p.life > p.max_life) {
        p.life = 0
        p.max_life = rnd(5, 12)
        p.char = CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]
        p.x = rnd(0, width)
        p.y = rnd(0, height)
        if (Math.random() > 0.3) {
          p.speed_x = rnd(-0.8, 0.8)
          p.speed_y = rnd(-0.8, 0.8)
        } else {
          p.speed_x = rnd(-0.3, 0.3)
          p.speed_y = rnd(-0.3, 0.3)
        }
      }
    }
  }

  private updateGlitch(dt: number, width: number, height: number) {
    if (Math.abs(this.glitch_current_intensity - this.glitch_target_intensity) > 0.001) {
      this.glitch_current_intensity = this.step(this.glitch_current_intensity, this.glitch_target_intensity, dt)
    } else {
      this.glitch_current_intensity = this.glitch_target_intensity
    }
    if (this.glitch_current_intensity < 0.01) {
      this.glitch_lines = []
      this.glitch_noise = []
      return
    }
    this.glitch_timer += dt
    if (Math.random() < 0.04 * this.glitch_current_intensity * 3) {
      this.glitch_current_intensity = Math.min(1, this.glitch_current_intensity + rnd(0.05, 0.15))
    }
    if (Math.random() < 0.01) {
      this.glitch_current_intensity = Math.max(0, this.glitch_current_intensity - rnd(0.02, 0.08))
    }
    if (Math.random() < 0.25 * this.glitch_current_intensity) {
      this.glitch_lines.push({
        y: Math.floor(rnd(0, height)), height: Math.floor(rnd(8, 60)),
        offset: Math.floor(rnd(-80, 80)), alpha: rnd(0.5, 1), life: rnd(0.08, 0.25),
      })
    }
    for (let i = this.glitch_lines.length - 1; i >= 0; i--) {
      this.glitch_lines[i].life -= dt
      if (this.glitch_lines[i].life <= 0) this.glitch_lines.splice(i, 1)
    }
    if (Math.random() < 0.04 * this.glitch_current_intensity) {
      this.glitch_color_shift = Math.floor(rnd(-50, 50))
    } else {
      this.glitch_color_shift = Math.floor(this.glitch_color_shift * 0.9)
    }
    if (Math.random() < 0.08 * this.glitch_current_intensity) {
      const n = Math.floor(60 * this.glitch_current_intensity)
      for (let i = 0; i < n; i++) {
        this.glitch_noise.push({
          x: Math.floor(rnd(0, width)), y: Math.floor(rnd(0, height)),
          size: Math.floor(rnd(4, 16)), alpha: rnd(0.3, 0.9), life: rnd(0.03, 0.12),
          r: Math.floor(rnd(0, 255)), g: Math.floor(rnd(0, 255)), b: Math.floor(rnd(0, 255)),
        })
      }
    }
    for (let i = this.glitch_noise.length - 1; i >= 0; i--) {
      this.glitch_noise[i].life -= dt
      if (this.glitch_noise[i].life <= 0) this.glitch_noise.splice(i, 1)
    }
  }

  private updateAlarm(dt: number, width: number, height: number) {
    this.alarm_current = this.step(this.alarm_current, this.alarm_active ? 0.7 : 0, dt)
    if (this.alarm_current < 0.005) {
      this.alarm_items = []
      return
    }
    if (this.alarm_active) {
      this.alarm_timer += dt
      if (this.alarm_timer > 0.25) {
        this.alarm_timer = 0
        if (this.alarm_items.length < 25) {
          this.addAlarmItem(width, height)
          if (Math.random() < 0.3) this.addAlarmItem(width, height)
        }
      }
    }
    for (let i = this.alarm_items.length - 1; i >= 0; i--) {
      const item = this.alarm_items[i]
      item.life -= dt
      item.pulse += dt * item.pulse_speed
      if (item.life < 0.3) item.alpha = Math.max(0, item.life / 0.3)
      item.scale = 1 + 0.1 * Math.sin(item.pulse)
      if (item.life <= 0) this.alarm_items.splice(i, 1)
    }
  }

  private updateTerminal(dt: number, width: number, height: number) {
    this.terminal_current = this.step(this.terminal_current, this.terminal_active ? 1 : 0, dt)
    if (this.terminal_current < 0.005) {
      this.terminal_lines = []
      return
    }
    if (this.terminal_active) {
      this.terminal_timer += dt
      if (this.terminal_timer > 0.4) {
        this.terminal_timer = 0
        if (this.terminal_lines.length < this.terminal_max_lines) {
          this.addTerminalLine(width, height)
          if (Math.random() < 0.2) this.addTerminalLine(width, height)
        }
      }
    }
    for (let i = this.terminal_lines.length - 1; i >= 0; i--) {
      const line = this.terminal_lines[i]
      line.life -= dt
      line.blink_timer += dt * line.blink_speed
      if (line.life < 0.5) line.alpha = Math.max(0, line.life / 0.5)
      if (line.life <= 0) {
        this.terminal_lines.splice(i, 1)
        for (const l of this.terminal_lines) l.y -= this.terminalStep(width, height)
      }
    }
  }

  private updateMatrix(dt: number, width: number, height: number) {
    this.matrix_current = this.step(this.matrix_current, this.matrix_active ? 1 : 0, dt)
    if (this.matrix_current < 0.005) {
      this.matrix_drops = []
      return
    }
    if (!this.matrix_active || !this.matrix_drops.length) return
    this.matrix_timer += dt
    for (const drop of this.matrix_drops) {
      drop.y += drop.speed
      drop.timer += dt
      if (drop.timer > drop.update_interval) {
        drop.timer = 0
        for (let i = 0; i < drop.chars.length; i++) {
          if (Math.random() < 0.3) drop.chars[i] = MATRIX_CHARS[Math.floor(Math.random() * MATRIX_CHARS.length)]
        }
      }
      if (drop.y > height + 50) {
        drop.y = Math.floor(rnd(-100, -20))
        drop.x = Math.floor(rnd(0, width))
        drop.length = Math.floor(rnd(5, 15))
        drop.chars = Array.from({ length: drop.length }, () => MATRIX_CHARS[Math.floor(Math.random() * MATRIX_CHARS.length)])
        drop.speed = rnd(0.5, 2)
        drop.brightness = rnd(0.3, 1)
      }
    }
  }

  private updateShatter(dt: number, width: number, height: number, renderer: SkullRenderer | null) {
    this.shatter_current = this.step(this.shatter_current, this.shatter_active ? 1 : 0, dt)
    if (this.shatter_current < 0.005) {
      this.shatter_cells = new Map()
      this.shatteredMask.fill(0)
      this.shatter_falling_chars = []
      return
    }
    if (!this.shatter_active || !renderer || !this.face_cells.length) return
    this.shatter_timer += dt
    let erodedCount = 0
    for (const d of this.shatter_cells.values()) if (d.eroded) erodedCount++
    const total = this.face_cells.length
    if (erodedCount < total && this.shatter_timer > this.shatter_interval) {
      this.shatter_timer = 0
      const remaining = total - erodedCount
      const numNew = Math.min(1, Math.max(1, Math.floor(remaining / 40) + 1))
      const available = this.face_cells.filter((c) => {
        const d = this.shatter_cells.get(`${c[0]},${c[1]}`)
        return !d?.eroded
      })
      for (let i = 0; i < numNew && available.length; i++) {
        const cell = available.splice(Math.floor(Math.random() * available.length), 1)[0]
        const d = this.shatter_cells.get(`${cell[0]},${cell[1]}`)!
        d.eroded = true
        d.progress = 0
        d.timer = 0
        this.setShatteredMask(cell[0], cell[1])
        this.addShatterFallingChar(cell, renderer)
      }
    }
    for (let i = this.shatter_falling_chars.length - 1; i >= 0; i--) {
      const fc = this.shatter_falling_chars[i]
      fc.y += fc.speed_y
      fc.x += fc.speed_x
      fc.speed_y += 0.015
      fc.life += dt
      if (fc.life > fc.max_life) fc.alpha = Math.max(0, fc.alpha - 0.02)
      if (fc.y > renderer.rows + 50 || fc.alpha <= 0) this.shatter_falling_chars.splice(i, 1)
    }
  }

  // ===== DRAWING =====

  drawBackgroundEffects(ctx: CanvasRenderingContext2D, width: number, height: number, colorEffect: boolean, target: string) {
    if (!this.visualizerSkipInBg) this.drawVisualizer(ctx, width, height, colorEffect, target)
    this.visualizerSkipInBg = false
    this.drawWaves(ctx, width, height, 0, colorEffect, target)
    this.drawCodeParticles(ctx, width, height, colorEffect, target)
    this.drawTerminal(ctx, width, height, colorEffect, target)
    this.drawMatrix(ctx, width, height, colorEffect, target)
  }

  drawVisualizerPublic(ctx: CanvasRenderingContext2D, width: number, height: number, colorEffect: boolean, target: string) {
    this.drawVisualizer(ctx, width, height, colorEffect, target)
  }

  drawForeground(ctx: CanvasRenderingContext2D, width: number, height: number, colorEffect: boolean, target: string) {
    this.drawAlarm(ctx, width, height, colorEffect, target)
    this.drawGlitch(ctx, width, height)
  }

  private getVisualizerColor(value: number, colorEffect: boolean, target: string): string {
    if (colorEffect) {
      if (target === 'red') return `rgba(${Math.floor(200 + 55 * value)},${Math.floor(50 * (1 - value))},${Math.floor(50 * (1 - value))},0.78)`
      if (target === 'white') {
        const b = Math.floor(150 + 105 * value)
        return `rgba(${b},${b},${b},0.78)`
      }
    }
    return `rgba(0,${Math.floor(150 + 105 * value)},0,0.78)`
  }

  private drawVisualizer(ctx: CanvasRenderingContext2D, width: number, height: number, colorEffect: boolean, target: string) {
    if (this.visualizer_current < 0.01) return
    const fadeAlpha = this.visualizer_current * this.intensity.visualizer
    if (fadeAlpha < 0.01) return
    ctx.save()
    ctx.globalAlpha = fadeAlpha
    for (let i = 0; i < this.visualizer_smooth.length; i++) {
      this.visualizer_smooth[i] += (this.visualizer_data[i] - this.visualizer_smooth[i]) * 0.25
    }
    const gap = 2
    const barWidth = Math.max(2, width / this.visualizer_smooth.length - gap)
    const maxHeight = height * 0.25
    const centerY = Math.floor(height * 0.83)
    for (let i = 0; i < this.visualizer_smooth.length; i++) {
      const value = this.visualizer_smooth[i]
      if (value < 0.01) continue
      const barH = value * maxHeight
      const x = Math.floor(i * (barWidth + gap) + gap / 2)
      const y = Math.floor(centerY - barH)
      ctx.fillStyle = this.getVisualizerColor(value, colorEffect, target)
      ctx.fillRect(x, y, Math.floor(barWidth), Math.floor(barH))
    }
    ctx.restore()
  }

  private drawWaves(ctx: CanvasRenderingContext2D, width: number, height: number, amplitude: number, colorEffect: boolean, target: string) {
    if (this.waves_current < 0.01) return
    const fadeAlpha = this.waves_current * this.intensity.waves
    if (fadeAlpha < 0.01) return
    this.wave_timer += 0.025
    const yBase = height * 0.5
    const [r, g, b] = colorEffect ? colorForEffect(target, 200) : [0, 200, 100]
    const params = [
      { freq: 0.012, amp: 18, pm: 0.5, alpha: 80, yo: -20 },
      { freq: 0.018, amp: 14, pm: 0.8, alpha: 60, yo: 0 },
      { freq: 0.025, amp: 10, pm: 1.2, alpha: 40, yo: 20 },
    ]
    ctx.save()
    ctx.globalAlpha = fadeAlpha
    ctx.lineWidth = 1
    for (const p of params) {
      const amp = p.amp + amplitude * 60
      const phase = this.wave_timer * p.pm
      ctx.strokeStyle = `rgba(${r},${g},${b},${p.alpha / 255})`
      ctx.beginPath()
      const step = 5
      for (let x = 0; x <= width; x += step) {
        const y = yBase + p.yo + Math.sin(x * p.freq + phase) * amp + amplitude * 15
        if (x === 0) ctx.moveTo(x, y)
        else ctx.lineTo(x, y)
      }
      ctx.stroke()
    }
    ctx.restore()
  }

  private drawCodeParticles(ctx: CanvasRenderingContext2D, width: number, height: number, colorEffect: boolean, target: string) {
    if (!this.code_particles.length || this.code_particles_current < 0.01) return
    const fadeAlpha = this.code_particles_current * this.intensity.particles
    if (fadeAlpha < 0.01) return
    const [r, g, b] = colorEffect ? colorForEffect(target, 255) : [0, 255, 80]
    ctx.save()
    ctx.globalAlpha = fadeAlpha
    ctx.textBaseline = 'alphabetic'
    for (const p of this.code_particles) {
      const flicker = 0.5 + 0.5 * Math.sin(p.phase)
      const lifeFactor = Math.min(1, p.life * 2) * Math.min(1, (p.max_life - p.life) * 2)
      const brightness = Math.floor(50 + 200 * p.brightness * flicker * lifeFactor)
      const opacity = (100 + 150 * p.opacity * flicker * lifeFactor) / 255
      const size = Math.floor(p.size * (0.85 + 0.15 * flicker))
      ctx.font = `${size}px Consolas, monospace`
      const cr = Math.min(255, Math.floor((r * brightness) / 100))
      const cg = Math.min(255, Math.floor((g * brightness) / 100))
      const cb = Math.min(255, Math.floor((b * brightness) / 100))
      ctx.fillStyle = `rgba(${cr},${cg},${cb},${opacity.toFixed(3)})`
      ctx.fillText(p.char, p.x, p.y)
      if (brightness > 150 && p.size > 15) {
        ctx.fillStyle = `rgba(${Math.floor(cr / 2)},${Math.floor(cg / 2)},${Math.floor(cb / 2)},${(opacity / 5).toFixed(3)})`
        for (const [dx, dy] of [[-1, -1], [-1, 1], [1, -1], [1, 1]] as const) {
          ctx.fillText(p.char, p.x + dx, p.y + dy)
        }
      }
    }
    ctx.restore()
  }

  private drawTerminal(ctx: CanvasRenderingContext2D, width: number, height: number, colorEffect: boolean, target: string) {
    if (!this.terminal_lines.length || this.terminal_current < 0.01) return
    const fadeAlpha = this.terminal_current * 0.6 * this.intensity.terminal
    if (fadeAlpha < 0.01) return
    const [r, g, b] = colorEffect ? colorForEffect(target, 255) : [0, 255, 0]
    ctx.save()
    ctx.globalAlpha = fadeAlpha
    ctx.textBaseline = 'alphabetic'
    for (const line of this.terminal_lines) {
      const alpha = (130 * line.alpha) / 255
      if (line.blink && Math.sin(line.blink_timer) < 0) continue
      ctx.font = `${line.size}px Consolas, monospace`
      ctx.fillStyle = `rgba(0,0,0,${Math.min(0.4, alpha / 2).toFixed(3)})`
      ctx.fillText(line.text, line.x + 1, line.y + 1)
      ctx.fillStyle = `rgba(${r},${g},${b},${alpha.toFixed(3)})`
      ctx.fillText(line.text, line.x, line.y)
    }
    ctx.restore()
  }

  private drawMatrix(ctx: CanvasRenderingContext2D, width: number, height: number, colorEffect: boolean, target: string) {
    if (!this.matrix_drops.length || this.matrix_current < 0.01) return
    const fadeAlpha = this.matrix_current * this.intensity.matrix
    if (fadeAlpha < 0.01) return
    const [r, g, b] = colorEffect ? colorForEffect(target, 255) : [0, 255, 0]
    ctx.save()
    ctx.globalAlpha = fadeAlpha
    ctx.textBaseline = 'alphabetic'
    ctx.font = '12px Consolas, monospace'
    for (const drop of this.matrix_drops) {
      for (let i = 0; i < drop.chars.length; i++) {
        const yPos = drop.y - i * 14
        const brightness = drop.brightness * (1 - (i / drop.length) * 0.7)
        const alpha = brightness
        let cr = Math.floor(r * brightness)
        let cg = Math.floor(g * brightness)
        let cb = Math.floor(b * brightness)
        let ca = alpha
        if (i === 0) {
          cr = Math.min(255, cr + 50)
          cg = Math.min(255, cg + 50)
          cb = Math.min(255, cb + 50)
          ca = Math.min(1, alpha + 50 / 255)
        }
        ctx.fillStyle = `rgba(${cr},${cg},${cb},${ca.toFixed(3)})`
        ctx.fillText(drop.chars[i], Math.floor(drop.x), Math.floor(yPos))
      }
    }
    ctx.restore()
  }

  private drawAlarm(ctx: CanvasRenderingContext2D, width: number, height: number, colorEffect: boolean, target: string) {
    if (!this.alarm_items.length || this.alarm_current < 0.01) return
    const fadeAlpha = this.alarm_current * 0.6 * this.intensity.alarm
    if (fadeAlpha < 0.01) return
    let cr = 255, cg = 0, cb = 0
    if (colorEffect) {
      if (target === 'red') [cr, cg, cb] = [255, 50, 50]
      else if (target === 'white') [cr, cg, cb] = [200, 200, 200]
      else [cr, cg, cb] = [255, 0, 0]
    }
    ctx.save()
    ctx.globalAlpha = fadeAlpha
    ctx.textBaseline = 'alphabetic'
    for (const item of this.alarm_items) {
      const size = Math.floor(item.size * item.scale)
      const alpha = (180 * item.alpha) / 255
      ctx.save()
      ctx.translate(item.x, item.y)
      ctx.rotate((item.rotation * Math.PI) / 180)
      ctx.font = `bold ${size}px ${item.is_symbol ? 'Arial' : 'Courier New, monospace'}`
      ctx.fillStyle = `rgba(0,0,0,${Math.min(0.47, alpha / 2).toFixed(3)})`
      ctx.fillText(item.text, -2, -2)
      ctx.fillText(item.text, 2, 2)
      ctx.fillStyle = `rgba(${cr},${cg},${cb},${alpha.toFixed(3)})`
      ctx.fillText(item.text, 0, 0)
      ctx.restore()
    }
    ctx.restore()
  }

  private drawGlitch(ctx: CanvasRenderingContext2D, width: number, height: number) {
    const intensity = this.glitch_current_intensity * this.intensity.glitch
    if (intensity < 0.01) return
    ctx.save()
    ctx.globalAlpha = intensity
    for (const line of this.glitch_lines) {
      const y = line.y
      const h = line.height
      const offset = line.offset
      const la = line.alpha
      if (offset !== 0) {
        ctx.strokeStyle = `rgba(0,255,0,${(200 * la / 255 / 2).toFixed(3)})`
        ctx.lineWidth = 1
        ctx.beginPath()
        ctx.moveTo(0, y); ctx.lineTo(width, y)
        ctx.moveTo(0, y + h); ctx.lineTo(width, y + h)
        ctx.stroke()
        ctx.fillStyle = `rgba(0,255,0,${(50 * 0.12 * la / 255).toFixed(3)})`
        ctx.fillRect(Math.max(0, offset), y, width - Math.abs(offset), h)
        if (Math.random() < 0.2) {
          ctx.fillStyle = `rgba(255,0,255,${(40 * 0.08 / 255).toFixed(3)})`
          ctx.fillRect(Math.max(0, Math.floor(offset / 2)), y + Math.floor(rnd(-5, 5)), width - Math.abs(Math.floor(offset / 2)), Math.floor(h / 2))
        }
      }
    }
    if (Math.abs(this.glitch_color_shift) > 5) {
      const strips = Math.min(60, Math.floor(width / 16))
      for (let i = 0; i < strips; i++) {
        const x = Math.floor(rnd(0, width - 4))
        const y = Math.floor(rnd(0, height))
        ctx.fillStyle = `rgba(255,0,0,${(150 * 0.08 / 255).toFixed(3)})`
        ctx.fillRect(x, y, Math.floor(rnd(1, 4)), Math.floor(rnd(4, 20)))
      }
      for (let i = 0; i < strips * 0.7; i++) {
        const x = Math.floor(rnd(0, width - 4))
        const y = Math.floor(rnd(0, height))
        ctx.fillStyle = `rgba(0,0,255,${(120 * 0.08 / 255).toFixed(3)})`
        ctx.fillRect(x, y, Math.floor(rnd(1, 4)), Math.floor(rnd(4, 16)))
      }
      for (let i = 0; i < strips * 0.5; i++) {
        const x = Math.floor(rnd(0, width - 4))
        const y = Math.floor(rnd(0, height))
        ctx.fillStyle = `rgba(0,255,0,${(80 * 0.08 / 255).toFixed(3)})`
        ctx.fillRect(x, y, Math.floor(rnd(1, 3)), Math.floor(rnd(4, 12)))
      }
    }
    for (const noise of this.glitch_noise) {
      ctx.fillStyle = `rgba(${noise.r},${noise.g},${noise.b},${(noise.alpha).toFixed(3)})`
      ctx.fillRect(Math.floor(noise.x), Math.floor(noise.y), noise.size, noise.size)
    }
    {
      const n = Math.floor(150)
      const g = (150 * 0.04 / 255)
      for (let i = 0; i < n; i++) {
        ctx.fillStyle = `rgba(${Math.floor(rnd(0, 255))},${Math.floor(rnd(0, 255))},${Math.floor(rnd(0, 255))},${g.toFixed(3)})`
        ctx.fillRect(Math.floor(rnd(0, width)), Math.floor(rnd(0, height)), Math.floor(rnd(2, 6)), Math.floor(rnd(2, 6)))
      }
    }
    if (Math.random() < 0.015) {
      ctx.fillStyle = `rgba(255,255,255,${(80 * 0.12 / 255).toFixed(3)})`
      ctx.fillRect(0, 0, width, height)
    }
    if (Math.random() < 0.02) {
      const yStart = Math.floor(rnd(0, height))
      for (let i = 0; i < 3; i++) {
        const y = yStart + i * Math.floor(rnd(20, 60))
        ctx.fillStyle = `rgba(${Math.floor(rnd(0, 255))},${Math.floor(rnd(0, 255))},${Math.floor(rnd(0, 255))},${(100 * 0.06 / 255).toFixed(3)})`
        ctx.fillRect(0, y, width, Math.floor(rnd(2, 8)))
      }
    }
    ctx.restore()
  }

  drawShatterFallingChars(ctx: CanvasRenderingContext2D, width: number, height: number, renderer: SkullRenderer, colorEffect: boolean, target: string) {
    if (!this.shatter_falling_chars.length) return
    const fadeAlpha = this.shatter_current * this.intensity.shatter
    if (fadeAlpha < 0.01) return
    const cellX = width / renderer.cols
    const cellY = height / renderer.rows
    const scale = renderer.params?.data?.head_scale || 1
    const cellSize = Math.min(cellX, cellY) * scale * 0.85
    const fontSize = Math.max(7, Math.floor(cellSize * 0.85))
    const totalW = renderer.cols * cellSize
    const totalH = renderer.rows * cellSize
    const startX = (width - totalW) / 2
    const startY = (height - totalH) / 2
    const [r, g, b] = colorEffect ? colorForEffect(target, 255) : [0, 255, 0]
    ctx.save()
    ctx.globalAlpha = fadeAlpha
    ctx.font = `${fontSize}px Consolas, monospace`
    ctx.textBaseline = 'alphabetic'
    for (const fc of this.shatter_falling_chars) {
      const px = startX + fc.x * cellSize + cellSize / 2 - fontSize / 3
      const py = startY + fc.y * cellSize + cellSize / 2 + fontSize / 3
      ctx.fillStyle = `rgba(${r},${g},${b},${fc.alpha.toFixed(3)})`
      ctx.fillText(fc.char, px, py)
    }
    ctx.restore()
  }
}
