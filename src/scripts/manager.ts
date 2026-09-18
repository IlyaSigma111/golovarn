import { ScriptData } from '../types'

const onyx = () => (window as unknown as {
  onyx?: {
    scriptsLoad: () => Promise<string | null>
    scriptsSave: (d: string) => Promise<boolean>
  }
}).onyx

function defaults(name: string): ScriptData {
  return {
    name,
    audio_path: null,
    video_path: null,
    emotion: 0,
    head_visible: true,
    erosion_enabled: false,
    glitch_enabled: false,
    alarm_enabled: false,
    terminal_enabled: false,
    matrix_enabled: false,
    shatter_enabled: false,
    visualizer_enabled: true,
    particles_enabled: true,
    waves_enabled: true,
    color_effect: null,
  }
}

export class ScriptManager {
  scripts: ScriptData[] = []
  loaded = false

  async load() {
    const api = onyx()
    if (!api) return
    try {
      const raw = await api.scriptsLoad()
      if (raw) {
        const data = JSON.parse(raw) as ScriptData[]
        this.scripts = Array.isArray(data) ? data : []
      }
    } catch {
      this.scripts = []
    }
    this.loaded = true
  }

  async save(): Promise<boolean> {
    const api = onyx()
    if (!api) return false
    return api.scriptsSave(JSON.stringify(this.scripts, null, 2))
  }

  create(name: string): ScriptData {
    const script = defaults(name || 'Новый сценарий')
    this.scripts.push(script)
    this.save()
    return script
  }

  remove(index: number) {
    if (index >= 0 && index < this.scripts.length) {
      this.scripts.splice(index, 1)
      this.save()
    }
  }

  rename(index: number, name: string): ScriptData | null {
    const n = (name || '').trim()
    const script = this.scripts[index]
    if (!script || !n || n === script.name) return script
    script.name = n
    this.save()
    return script
  }

  duplicate(index: number): ScriptData | null {
    const src = this.scripts[index]
    if (!src) return null
    const copy: ScriptData = { ...src, name: src.name + ' (копия)' }
    this.scripts.push(copy)
    this.save()
    return copy
  }

  get(index: number): ScriptData | null {
    return this.scripts[index] ?? null
  }

  toEffectToggles(s: ScriptData) {
    return {
      visualizer: s.visualizer_enabled,
      particles: s.particles_enabled,
      waves: s.waves_enabled,
      glitch: s.glitch_enabled,
      alarm: s.alarm_enabled,
      terminal: s.terminal_enabled,
      matrix: s.matrix_enabled,
      shatter: s.shatter_enabled,
      erosion: s.erosion_enabled,
    }
  }
}
