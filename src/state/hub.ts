import { AudioPlayer } from '../audio/player'
import { MusicPlayer } from '../audio/music'
import { VideoPlayer } from '../video/videoPlayer'
import { ScriptManager } from '../scripts/manager'
import { SkullParams } from '../skullParams'
import { SkullCanvas } from '../skull/canvas'
import { parseModel } from '../types'
import type { EffectToggles, ModelData, ScriptData, SkullParamsData, StateMsg } from '../types'
import defaultAvatarRaw from '../assets/avatar.json?raw'

const anyOnyx = () => (window as unknown as {
  onyx?: {
    sendState: (p: StateMsg) => void
    openViz: () => Promise<number>
    openPlayer: () => Promise<number>
    openAllDisplays: () => Promise<unknown>
    listDisplays: () => Promise<unknown>
    downloadSelf: () => Promise<string | null>
    openFile: (o: { title?: string; filters?: unknown[] }) => Promise<string | null>
    openFiles: (o: { title?: string; filters?: unknown[] }) => Promise<string[]>
    saveFile: (o: { title?: string; defaultPath?: string; filters?: unknown[] }) => Promise<string | null>
    readBinary: (p: string) => Promise<ArrayBuffer | null>
  }
}).onyx

export function DEFAULT_EFFECTS(): EffectToggles {
  return {
    visualizer: false,
    particles: false,
    waves: false,
    glitch: false,
    alarm: false,
    terminal: false,
    matrix: false,
    shatter: false,
    erosion: false,
  }
}

export const EMOTION_LABELS: Array<[number, string]> = [
  [0, 'Нейтральный'],
  [1, 'Добрый'],
  [-1, 'Злой'],
]

export function emotionLabel(emotion: number): string {
  for (const [v, l] of EMOTION_LABELS) if (v === emotion) return l
  return 'Нейтрально'
}

class AppHub {
  audio = new AudioPlayer()
  music = new MusicPlayer()
  video = new VideoPlayer()
  scripts = new ScriptManager()
  params = new SkullParams()
  effects: EffectToggles = DEFAULT_EFFECTS()
  emotion = 0
  headVisible = true

  preview: SkullCanvas | null = null
  currentScript: ScriptData | null = null
  isPlaying = false
  isPaused = false
  isAutoPlaying = false
  autoPlayEnabled = true
  modelActive = true
  chatter = false
  model: ModelData | null = parseModel(defaultAvatarRaw)

  onStatus: ((s: string) => void) | null = null
  onScriptsChange: (() => void) | null = null
  onPlayStateChange: ((playing: boolean) => void) | null = null
  onParamsChange: (() => void) | null = null

  private lastAmp = 0

  aiQueue: ArrayBuffer[] = []
  isAiPlaying = false

  constructor() {
    this.audio.onAmplitude = (amp) => {
      this.lastAmp = amp
      this.pushAudio(true, amp)
    }
    // Музыкальный плеер тоже кормит визуализатор и рот живым сигналом
    this.music.onAmplitude = (amp) => {
      this.lastAmp = amp
      this.pushAudio(true, amp)
    }
    this.music.onSilence = () => {
      // Музыка остановилась/закончилась — если сценарий не играет, шлём тишину
      if (!this.isPlaying) this.pushAudio(false, 0)
    }
    this.audio.onEnded = () => {
      if (this.isAiPlaying) {
        if (this.aiQueue.length > 0) {
          this.playNextAi()
        } else {
          this.isAiPlaying = false
          this.isPlaying = false
          if (this.onPlayStateChange) this.onPlayStateChange(false)
          this.pushAudio(false, 0)
          this.status('[AI] Ответ завершён')
        }
        return
      }

      this.isPlaying = false
      this.isPaused = false
      if (this.onPlayStateChange) this.onPlayStateChange(false)
      this.status('[OK] Воспроизведение завершено')
      // Не сбрасываем эмоцию/эффекты/цвет: голова остаётся в последнем положении
      // и «ждёт команду». Между сценариями переход бесшовный — без вспышки зелёного.
      this.pushAudio(false, 0)
      if (this.autoPlayEnabled && !this.isAutoPlaying && this.scripts.scripts.length > 1) {
        this.isAutoPlaying = true
        setTimeout(() => this.playNextAuto(), 150)
      }
    }
  }

  async playAiAudioQueue() {
    if (this.isAiPlaying || this.aiQueue.length === 0) return
    this.isAiPlaying = true
    this.playNextAi()
  }

  private async playNextAi() {
    if (this.aiQueue.length === 0) {
      this.isAiPlaying = false
      return
    }
    const buf = this.aiQueue.shift()!
    await this.audio.loadFromArrayBuffer(buf)
    await this.audio.play()
    this.isPlaying = true
    if (this.onPlayStateChange) this.onPlayStateChange(true)
  }

  async askAi(prompt: string, apiKey: string, updateText: (txt: string) => void) {
    this.status('[AI] Ожидаю ответа Gemini...')
    try {
      // Lazy load AI module
      const ai = await import('./ai')
      const res = await ai.askGemini(prompt, apiKey)
      this.setEmotion(res.emotion)
      updateText(res.text)
      this.status(`[AI] Ответ: ${res.text.slice(0, 40)}...`)
      
      const sentences = ai.splitSentences(res.text)
      for (const sentence of sentences) {
        const buf = await ai.fetchTTS(sentence)
        this.aiQueue.push(buf)
      }
      this.playAiAudioQueue()
    } catch (e: any) {
      this.status(`[ERR] ИИ: ${e.message}`)
      updateText(`Ошибка: ${e.message}`)
    }
  }

  get onyx() {
    return anyOnyx()
  }

  broadcast(msg: StateMsg) {
    try {
      this.onyx?.sendState(msg)
    } catch {
      // ignore
    }
  }

  syncBroadcast() {
    const p = this.params.data
    this.broadcast({
      kind: 'sync',
      params: this.params.toData(),
      toggles: this.effects,
      emotion: this.emotion,
      chatter: this.chatter,
      headVisible: this.headVisible,
      isPlaying: this.isPlaying,
      amplitude: this.lastAmp,
      colorEffect: (p.color_effect || p.color_effect_active) ? {
        target: p.color_effect_target,
        progress: p.color_effect_progress,
        active: p.color_effect_active,
      } : null,
    })
    if (this.modelActive) {
      this.broadcast({ kind: 'model', model: this.model })
    }
  }

  status(s: string) {
    if (this.onStatus) this.onStatus(s)
  }

  // ---------- preview wiring ----------
  setPreview(skull: SkullCanvas | null) {
    this.preview = skull
    if (skull) {
      skull.setModel(this.model)
      skull.updateParams(this.params)
      skull.applyScriptToggles(this.effects)
      skull.setEmotion(this.emotion)
      skull.setChatter(this.chatter)
      skull.setHeadVisible(this.headVisible)
      if (this.params.data.color_effect_active) {
        skull.setColorEffect(this.params.data.color_effect_target === 'green' ? 'reset' : this.params.data.color_effect_target)
      }
      if (this.video.pathStr) {
        skull.setVideoSource(this.video.video)
        this.video.play()
      }
    }
  }

  pushAudio(isPlaying: boolean, amplitude: number) {
    this.lastAmp = amplitude
    this.preview?.setAudioData(isPlaying, amplitude)
    this.broadcast({ kind: 'audio', isPlaying, amplitude })
  }

  // ---------- avatar ----------
  async loadAvatar() {
    const path = await this.onyx?.openFile({
      title: 'Выберите файл аватара',
      filters: [{ name: 'Avatar files', extensions: ['json'] }],
    })
    if (!path) return false
    const raw = await (window as unknown as { onyx?: { readText: (p: string) => Promise<string | null> } }).onyx?.readText(path)
    if (!raw) {
      this.status('[ERR] Не удалось прочитать файл')
      return false
    }
    try {
      const data = JSON.parse(raw) as Record<string, unknown>
      this.params.fromData(data)
      this.paramsSave()
      this.preview?.updateParams(this.params)
      this.broadcast({ kind: 'params', data: this.params.toData() })
      this.status('[OK] Аватар загружен')
      if (this.onParamsChange) this.onParamsChange()
      return true
    } catch {
      this.status('[ERR] Ошибка в JSON аватара')
      return false
    }
  }

  paramsSave() {
    try {
      ;(window as unknown as { onyx?: { paramsSave: (d: string) => Promise<boolean> } }).onyx?.paramsSave(this.params.toJson())
    } catch {
      // ignore
    }
  }

  // ---------- model (Головастик) ----------
  async loadModel() {
    const path = await this.onyx?.openFile({
      title: 'Загрузить модель «Головастик»',
      filters: [{ name: 'Model files', extensions: ['json'] }],
    })
    if (!path) return false
    const raw = await (window as unknown as { onyx?: { readText: (p: string) => Promise<string | null> } }).onyx?.readText(path)
    if (!raw) {
      this.status('[ERR] Не удалось прочитать файл')
      return false
    }
    const model = parseModel(raw)
    if (!model) {
      this.status('[ERR] Ошибка в JSON модели')
      return false
    }
    this.applyModel(model)
    this.status(`[OK] Модель загружена: ${baseName(path)} (${model.cols}×${model.rows})`)
    return true
  }

  clearModel() {
    this.applyModel(null)
    this.status('[OK] Параметрический череп')
  }

  private applyModel(model: ModelData | null) {
    this.model = model
    this.modelActive = !!model
    this.preview?.setModel(model)
    this.broadcast({ kind: 'model', model })
  }

  async loadParams() {
    try {
      const json = await (window as unknown as { onyx?: { paramsLoad: () => Promise<string | null> } }).onyx?.paramsLoad()
      this.params = SkullParams.fromJson(json ?? null)
    } catch {
      // ignore
    }
  }

  // ---------- effects ----------
  resetEffects() {
    const off: EffectToggles = {
      visualizer: false, particles: false, waves: false,
      glitch: false, alarm: false, terminal: false,
      matrix: false, shatter: false, erosion: false,
    }
    this.effects = off
    this.preview?.applyScriptToggles(off)
    this.broadcast({ kind: 'effects', toggles: off })
    this.setColor('reset')
  }

  togglePause() {
    if (this.isPaused) {
      this.audio.resume()
      if (this.video.pathStr) this.video.resume()
      this.isPaused = false
      this.status('[PLAY] Продолжено')
    } else if (this.isPlaying) {
      this.audio.pause()
      if (this.video.pathStr) this.video.pause()
      this.isPaused = true
      this.status('[PAUSE] Пауза сценария')
    }
    this.broadcast({ kind: 'pause', paused: this.isPaused })
  }

  setEffect(key: keyof EffectToggles, active: boolean) {
    this.effects[key] = active
    this.preview?.setEffect(key, active)
    this.broadcast({ kind: 'effects', toggles: this.effects })
  }

  setColor(color: 'red' | 'white' | 'reset') {
    this.preview?.setColorEffect(color)
    this.broadcast({ kind: 'color', color })
    const map = { red: '[COLOR] Красный цвет применен', white: '[COLOR] Белый цвет применен', reset: '[COLOR] Цвет сброшен' }
    this.status(map[color])
  }

  setEmotion(emotion: number) {
    this.emotion = Math.max(-1, Math.min(1, emotion))
    this.preview?.setEmotion(this.emotion)
    this.broadcast({ kind: 'emotion', emotion: this.emotion })
    // Эмоции не привязаны к цвету: цвет управляется отдельно кнопками.
  }

  setChatter(v: boolean) {
    this.chatter = v
    // «Голова говорит» — живая импровизация: голова должна быть видима
    // и не застрять в цветовом эффекте из прошлого сценария.
    if (v && !this.isPlaying) {
      if (!this.headVisible) this.setHeadVisible(true)
      const p = this.params.data
      if (p.color_effect || (p.color_effect_active && p.color_effect_target !== 'green')) this.setColor('reset')
    }
    this.preview?.setChatter(v)
    this.broadcast({ kind: 'chatter', enabled: v })
  }

  setHeadVisible(v: boolean) {
    this.headVisible = v
    this.preview?.setHeadVisible(v)
    this.syncBroadcast()
  }

  setHeadScale(scale: number) {
    const s = Math.max(0.3, Math.min(3, scale))
    this.params.data.head_scale = s
    this.paramsSave()
    this.preview?.updateParams(this.params)
    this.broadcast({ kind: 'params', data: this.params.toData() })
  }

  setEffectIntensity(key: string, value: number) {
    const v = Math.max(0, Math.min(1, value))
    ;(this.params.data as unknown as Record<string, unknown>)[key + '_intensity'] = v
    this.paramsSave()
    this.preview?.setEffectIntensity(key, v)
    this.broadcast({ kind: 'params', data: this.params.toData() })
  }

  setEmotionFaceParam(key: 'emotion_brow_intensity' | 'emotion_mouth_intensity' | 'emotion_eye_squint' | 'emotion_pupil_bias', value: number) {
    const v = Math.max(0, Math.min(2, value))
    ;(this.params.data as unknown as Record<string, unknown>)[key] = v
    this.paramsSave()
    this.preview?.updateParams(this.params)
    this.broadcast({ kind: 'params', data: this.params.toData() })
    if (this.onParamsChange) this.onParamsChange()
  }

  setAnimParam(key: 'blink_enabled' | 'blink_interval' | 'blink_duration' | 'pupil_size' | 'pupil_move' | 'mouth_amp' | 'mouth_speed', value: number | boolean) {
    ;(this.params.data as unknown as Record<string, unknown>)[key] = value
    this.paramsSave()
    this.preview?.updateParams(this.params)
    this.broadcast({ kind: 'params', data: this.params.toData() })
    if (this.onParamsChange) this.onParamsChange()
  }

  resetMouth() {
    this.preview?.resetMouth()
    this.broadcast({ kind: 'resetMouth' })
  }

  // ---------- scripts ----------
  async scriptsInit() {
    await this.scripts.load()
    if (this.onScriptsChange) this.onScriptsChange()
  }

  playScript(script: ScriptData) {
    const hasAudio = !!script.audio_path
    const hasVideo = !!script.video_path

    this.currentScript = script
    this.isPaused = false
    this.applyScriptEffects(script)
    this.setEmotion(script.emotion)

    this.audio.stop()
    this.video.stop()
    this.preview?.clearVideo()

    if (hasAudio) {
      this.loadAudioFromScript(script.audio_path!)
    }
    if (hasVideo) {
      this.video.load(script.video_path!)
      if (hasAudio) {
        this.video.video.muted = true
      } else {
        this.video.video.muted = false
      }
      if (this.preview) {
        this.preview.setVideoSource(this.video.video)
        this.video.play()
      }
      this.broadcast({ kind: 'video', playing: true, path: script.video_path })
      if (!hasAudio) this.status(`[PLAY] Видео: ${baseName(script.video_path!)}`)
    } else {
      this.broadcast({ kind: 'video', playing: false, path: null })
    }

    this.resetMouth()
    if (this.onScriptsChange) this.onScriptsChange()
  }

  private async loadAudioFromScript(path: string) {
    const bin = await this.onyx?.readBinary(path)
    if (!bin) {
      this.status('[ERR] Не удалось прочитать аудио')
      return
    }
    const ok = await this.audio.loadFromArrayBuffer(bin)
    if (!ok) {
      this.status('[ERR] Не удалось декодировать аудио')
      return
    }
    setTimeout(() => {
      this.audio.play()
      this.isPlaying = true
      if (this.onPlayStateChange) this.onPlayStateChange(true)
      this.status(`[PLAY] Воспроизведение: ${baseName(path)}`)
    }, 150)
  }

stopScript() {
    this.audio.stop()
    this.isPlaying = false
    this.isPaused = false
    this.isAutoPlaying = false
    if (this.onPlayStateChange) this.onPlayStateChange(false)
    this.video.stop()
    this.preview?.clearVideo()
    this.broadcast({ kind: 'video', playing: false, path: null })
    this.status(this.currentScript ? `[STOP] Остановлен: ${this.currentScript.name}` : '[STOP] Остановлено')
    this.setEmotion(0)
    this.resetEffects()
    this.resetMouth()
    this.headVisible = true
    this.preview?.setHeadVisible(true)
    this.broadcast({ kind: 'headVisible', visible: true })
    if (this.onScriptsChange) this.onScriptsChange()
  }

  applyScriptEffects(script: ScriptData) {
    const toggles: EffectToggles = {
      visualizer: script.visualizer_enabled,
      particles: script.particles_enabled,
      waves: script.waves_enabled,
      glitch: script.glitch_enabled,
      alarm: script.alarm_enabled,
      terminal: script.terminal_enabled,
      matrix: script.matrix_enabled,
      shatter: script.shatter_enabled,
      erosion: script.erosion_enabled,
    }
    this.effects = toggles
    this.preview?.applyScriptToggles(toggles)
    this.broadcast({ kind: 'effects', toggles })
    if (script.color_effect) this.setColor(script.color_effect)
    else this.setColor('reset')
    // Применяем видимость головы из сценария
    this.headVisible = script.head_visible !== false
    this.preview?.setHeadVisible(this.headVisible)
    this.broadcast({ kind: 'headVisible', visible: this.headVisible })
  }

  playNextAuto() {
    this.isAutoPlaying = false
    if (!this.autoPlayEnabled) return
    const list = this.scripts.scripts
    if (list.length === 0) return
    const idx = list.findIndex((s) => s === this.currentScript)
    if (idx < 0) return
    const next = list[(idx + 1) % list.length]
    if (next && next !== this.currentScript) {
      this.currentScript = next
      this.playScript(next)
    }
  }

  selectScript(script: ScriptData) {
    this.currentScript = script
    if (this.onScriptsChange) this.onScriptsChange()
  }

  // ---------- windows ----------
  openViz() {
    return this.onyx?.openViz().then(() => {
      this.syncBroadcast()
    })
  }

  openPlayer() {
    return this.onyx?.openPlayer().then(() => {
      this.syncBroadcast()
    })
  }

  openAllDisplays() {
    return this.onyx?.openAllDisplays().then(() => {
      this.syncBroadcast()
    })
  }

  downloadSelf() {
    return this.onyx?.downloadSelf()
  }

  listDisplays() {
    return this.onyx?.listDisplays()
  }
}

function baseName(p: string): string {
  return p.split(/[\\/]/).pop() || p
}

export const hub = new AppHub()
