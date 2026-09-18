export class AudioPlayer {
  private ctx: AudioContext
  private analyser: AnalyserNode
  private gain: GainNode
  private source: AudioBufferSourceNode | null = null
  private buffer: AudioBuffer | null = null
  private sampleTimer: number | null = null
  isPlaying = false
  isPaused = false
  onAmplitude: ((amp: number) => void) | null = null
  onEnded: (() => void) | null = null
  private timeDomain: Float32Array<ArrayBuffer>

  constructor() {
    this.ctx = new AudioContext()
    this.analyser = this.ctx.createAnalyser()
    this.analyser.fftSize = 1024
    this.gain = this.ctx.createGain()
    this.gain.gain.value = 1
    this.analyser.connect(this.gain)
    this.gain.connect(this.ctx.destination)
    this.timeDomain = new Float32Array(this.analyser.fftSize)
  }

  async ensureRunning() {
    if (this.ctx.state === 'suspended') {
      try { await this.ctx.resume() } catch { /* ignore */ }
    }
  }

  async loadFromArrayBuffer(buf: ArrayBuffer): Promise<boolean> {
    try {
      await this.ensureRunning()
      this.buffer = await this.ctx.decodeAudioData(buf.slice(0))
      this.isPaused = false
      this.isPlaying = false
      return true
    } catch {
      this.buffer = null
      return false
    }
  }

  async play(): Promise<void> {
    if (!this.buffer) return
    await this.ensureRunning()
    if (this.isPlaying) return
    if (this.isPaused) {
      this.isPaused = false
      this.isPlaying = true
      await this.ctx.resume()
      this.startSampling()
      return
    }
    this.stopInternal()
    const src = this.ctx.createBufferSource()
    src.buffer = this.buffer
    src.connect(this.analyser)
    src.onended = () => {
      this.isPlaying = false
      this.isPaused = false
      this.stopSampling()
      this.source = null
      if (this.onEnded) this.onEnded()
    }
    this.source = src
    src.start()
    this.isPlaying = true
    this.startSampling()
  }

  pause() {
    if (this.isPlaying && !this.isPaused) {
      this.isPaused = true
      this.isPlaying = false
      this.stopSampling()
      this.ctx.suspend()
    }
  }

  async resume() {
    if (this.isPaused) {
      this.isPaused = false
      this.isPlaying = true
      try { await this.ctx.resume() } catch { /* ignore */ }
      this.startSampling()
    }
  }

  stop() {
    this.isPlaying = false
    this.isPaused = false
    this.stopSampling()
    this.stopInternal()
  }

  private stopInternal() {
    if (this.source) {
      try { this.source.onended = null; this.source.stop() } catch { /* ignore */ }
      this.source = null
    }
  }

  private startSampling() {
    this.stopSampling()
    this.sampleTimer = window.setInterval(() => {
      if (!this.isPlaying) return
      const amp = this.getAmplitude()
      if (this.onAmplitude) this.onAmplitude(amp)
    }, 33)
  }

  private stopSampling() {
    if (this.sampleTimer !== null) {
      clearInterval(this.sampleTimer)
      this.sampleTimer = null
    }
  }

  getAmplitude(): number {
    if (!this.isPlaying) return 0
    try {
      this.analyser.getFloatTimeDomainData(this.timeDomain)
      let sum = 0
      for (let i = 0; i < this.timeDomain.length; i++) {
        sum += this.timeDomain[i] * this.timeDomain[i]
      }
      const rms = Math.sqrt(sum / this.timeDomain.length)
      return Math.min(1, rms * 3.5)
    } catch {
      return 0
    }
  }

  setVolume(v: number) {
    try { this.gain.gain.value = Math.max(0, Math.min(1, v)) } catch { /* ignore */ }
  }
}
