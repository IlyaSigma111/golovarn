export class VideoPlayer {
  video: HTMLVideoElement
  isPlaying = false
  isPaused = false
  fadeProgress = 0
  private fadeTimer: number | null = null
  private path: string | null = null

  constructor() {
    this.video = document.createElement('video')
    this.video.muted = false
    this.video.loop = true
    this.video.playsInline = true
    this.video.style.display = 'none'
    document.body.appendChild(this.video)
  }

  load(path: string): boolean {
    try {
      this.path = path
      this.video.src = 'file:///' + path.replace(/\\/g, '/')
      this.video.load()
      this.isPlaying = false
      this.isPaused = false
      this.fadeProgress = 0
      return true
    } catch {
      return false
    }
  }

  play() {
    if (this.isPlaying) return
    this.isPlaying = true
    this.isPaused = false
    this.fadeProgress = 0
    this.video.play().catch(() => { /* ignore */ })
    this.startFadeLoop()
  }

  pause() {
    if (this.isPlaying) {
      this.isPaused = true
      this.isPlaying = false
      this.video.pause()
      this.stopFadeLoop()
    }
  }

  resume() {
    if (this.isPaused) {
      this.isPaused = false
      this.isPlaying = true
      this.video.play().catch(() => { /* ignore */ })
      this.startFadeLoop()
    }
  }

  stop() {
    this.isPlaying = false
    this.isPaused = false
    this.fadeProgress = 0
    this.stopFadeLoop()
    try { this.video.pause(); this.video.currentTime = 0 } catch { /* ignore */ }
  }

  get pathStr(): string | null {
    return this.path
  }

  private startFadeLoop() {
    this.stopFadeLoop()
    this.fadeTimer = window.setInterval(() => {
      if (!this.isPlaying || this.video.duration <= 0) return
      if (this.video.duration - this.video.currentTime < 0.5) {
        const near = this.video.duration - this.video.currentTime
        this.fadeProgress = Math.max(0, 1 - near / 0.5)
      } else {
        this.fadeProgress = 0
      }
      this.video.style.opacity = String(1 - this.fadeProgress)
    }, 40)
  }

  private stopFadeLoop() {
    if (this.fadeTimer !== null) {
      clearInterval(this.fadeTimer)
      this.fadeTimer = null
    }
  }
}
