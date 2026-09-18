export interface SkullParamsData {
  head_height: number
  width_top: number
  width_forehead: number
  width_eyes: number
  width_nose: number
  width_mouth: number
  width_chin: number
  zone_top: number
  zone_forehead: number
  zone_eyes: number
  zone_nose: number
  zone_mouth: number
  zone_chin: number
  eye_width: number
  eye_height: number
  eye_spacing: number
  nose_width: number
  nose_height: number
  mouth_width: number
  mouth_height: number
  color_effect: boolean
  color_effect_progress: number
  color_effect_active: boolean
  color_effect_target: 'red' | 'white' | 'green'
  previous_color: 'red' | 'white' | 'green'
  head_scale: number
  visualizer_intensity: number
  particles_intensity: number
  waves_intensity: number
  glitch_intensity: number
  alarm_intensity: number
  terminal_intensity: number
  matrix_intensity: number
  shatter_intensity: number
  erosion_intensity: number
  blink_enabled: boolean
  blink_interval: number
  blink_duration: number
  pupil_size: number
  pupil_move: boolean
  mouth_amp: number
  mouth_speed: number
  emotion_brow_intensity: number
  emotion_mouth_intensity: number
  emotion_eye_squint: number
  emotion_pupil_bias: number
}

export interface ScriptData {
  name: string
  audio_path: string | null
  video_path: string | null
  emotion: number
  head_visible: boolean
  erosion_enabled: boolean
  glitch_enabled: boolean
  alarm_enabled: boolean
  terminal_enabled: boolean
  matrix_enabled: boolean
  shatter_enabled: boolean
  visualizer_enabled: boolean
  particles_enabled: boolean
  waves_enabled: boolean
  color_effect: 'red' | 'white' | null
}

export interface EffectToggles {
  visualizer: boolean
  particles: boolean
  waves: boolean
  glitch: boolean
  alarm: boolean
  terminal: boolean
  matrix: boolean
  shatter: boolean
  erosion: boolean
}

export interface ModelData {
  rows: number
  cols: number
  mode: 'free' | 'face'
  grid_char: string[][]
  grid_brightness: number[][]
  is_eye: boolean[][]
  is_mouth: boolean[][]
}

export function parseModel(text: string): ModelData | null {
  try {
    const d = JSON.parse(text) as Record<string, unknown>
    if (!d || typeof d.rows !== 'number' || typeof d.cols !== 'number') return null
    const rows = Math.max(1, Math.min(1500, Math.floor(d.rows)))
    const cols = Math.max(1, Math.min(1500, Math.floor(d.cols)))
    const g = d.grid_char as unknown
    const b = d.grid_brightness as unknown
    const e = d.is_eye as unknown
    const m = d.is_mouth as unknown
    if (!Array.isArray(g) || g.length !== rows || !Array.isArray(g[0]) || (g[0] as unknown[]).length !== cols) return null
    const grid_char: string[][] = []
    const grid_brightness: number[][] = []
    const is_eye: boolean[][] = []
    const is_mouth: boolean[][] = []
    for (let y = 0; y < rows; y++) {
      const gr: string[] = []
      const br: number[] = []
      const ey: boolean[] = []
      const mo: boolean[] = []
      for (let x = 0; x < cols; x++) {
        const c = (g[y] as unknown[])[x]
        gr.push(typeof c === 'string' && (c as string).length > 0 ? (c as string)[0] : ' ')
        const bb = b && Array.isArray(b) && Array.isArray((b as unknown[][])[y]) ? Number(((b as unknown[][])[y] as unknown[])[x]) : 255
        br.push(Number.isFinite(bb) ? Math.max(0, Math.min(255, Math.round(bb))) : 255)
        ey.push(!!(e && Array.isArray(e) && e[y] && (e[y] as unknown[])[x]))
        mo.push(!!(m && Array.isArray(m) && m[y] && (m[y] as unknown[])[x]))
      }
      grid_char.push(gr)
      grid_brightness.push(br)
      is_eye.push(ey)
      is_mouth.push(mo)
    }
    return { rows, cols, grid_char, grid_brightness, is_eye, is_mouth, mode: d.mode === 'face' ? 'face' : 'free' }
  } catch {
    return null
  }
}

export type StateMsg =
  | { kind: 'sync'; params: SkullParamsData; toggles: EffectToggles; emotion: number; chatter: boolean; headVisible: boolean; isPlaying: boolean; amplitude: number; colorEffect: { target: 'red' | 'white' | 'green'; progress: number; active: boolean } | null }
  | { kind: 'params'; data: SkullParamsData }
  | { kind: 'audio'; isPlaying: boolean; amplitude: number }
  | { kind: 'emotion'; emotion: number }
  | { kind: 'chatter'; enabled: boolean }
  | { kind: 'effects'; toggles: EffectToggles }
  | { kind: 'color'; color: 'red' | 'white' | 'reset' }
  | { kind: 'pause'; paused: boolean }
  | { kind: 'resetMouth' }
  | { kind: 'headVisible'; visible: boolean }
  | { kind: 'video'; playing: boolean; path: string | null }
  | { kind: 'model'; model: ModelData | null }
