import React, { useEffect, useRef, useState } from 'react'
import { SkullCanvas } from '../skull/canvas'
import { SkullParams } from '../skullParams'
import type { StateMsg } from '../types'

const onyx = (window as unknown as { onyx: any }).onyx

export function VizPage() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const skullRef = useRef<SkullCanvas | null>(null)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const [full, setFull] = useState(false)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const skull = new SkullCanvas(canvas, new SkullParams())
    skullRef.current = skull
    // Не запускаем рендер сразу: ждём первый 'sync' И 'model', чтобы окно
    // открывалось сразу с реальной головой и параметрами, а не с дефолтной.
    let started = false
    let gotSync = false
    let gotModel = false
    const tryStart = () => {
      if (started || !gotSync || !gotModel) return
      started = true
      skull.start()
    }
    // Фолбэк на всякий случай (например, сообщения не пришли из старых версий)
    const fallback = window.setTimeout(() => {
      gotSync = true
      gotModel = true
      tryStart()
    }, 1500)

    const offState = onyx.onState((msg: StateMsg) => {
      const s = skullRef.current
      if (!s) return
      switch (msg.kind) {
        case 'sync': {
          const p = SkullParams.fromJson(null)
          p.fromData(msg.params as unknown as Record<string, unknown>)
          s.updateParams(p)
          s.applyScriptToggles(msg.toggles)
          s.setEmotion(msg.emotion)
          s.setChatter(msg.chatter)
          s.setAudioData(msg.isPlaying, msg.amplitude)
          if (msg.colorEffect) {
            const pd = s.renderer.params.data
            pd.color_effect_target = msg.colorEffect.target
            pd.color_effect_progress = msg.colorEffect.progress
            pd.color_effect_active = msg.colorEffect.active
            pd.color_effect = true
            s.colorEffect = true
          } else {
            const pd = s.renderer.params.data
            pd.color_effect = false
            pd.color_effect_active = false
            pd.color_effect_progress = 0
            s.colorEffect = false
          }
          s.setHeadVisible(msg.headVisible)
          gotSync = true
          tryStart()
          break
        }
        case 'params': {
          const p = SkullParams.fromJson(null)
          p.fromData(msg.data as unknown as Record<string, unknown>)
          s.updateParams(p)
          break
        }
        case 'emotion':
          s.setEmotion(msg.emotion)
          break
        case 'chatter':
          s.setChatter(msg.enabled)
          break
        case 'effects':
          s.applyScriptToggles(msg.toggles)
          break
        case 'color':
          s.setColorEffect(msg.color)
          break
        case 'pause':
          if (videoRef.current) {
            if (msg.paused) videoRef.current.pause()
            else videoRef.current.play().catch(() => {})
          }
          break
        case 'resetMouth':
          s.resetMouth()
          break
        case 'headVisible':
          s.setHeadVisible(msg.visible)
          break
        case 'video':
          s.clearVideo()
          if (videoRef.current) {
            videoRef.current.pause()
            videoRef.current.src = ''
            videoRef.current = null
          }
          if (msg.playing && msg.path) {
            const v = document.createElement('video')
            v.src = 'file:///' + msg.path.replace(/\\/g, '/')
            v.muted = false
            v.autoplay = true
            v.loop = true
            v.play().catch(() => {})
            videoRef.current = v
            s.setVideoSource(v)
          }
          break
        case 'audio':
          s.setAudioData(msg.isPlaying, msg.amplitude)
          if (videoRef.current && msg.isPlaying) {
            videoRef.current.muted = true
          }
          break
        case 'model':
          s.setModel(msg.model)
          gotModel = true
          tryStart()
          break
        }
    })

    onyx.childReady()

    return () => {
      window.clearTimeout(fallback)
      offState()
      skull.stop()
      skullRef.current = null
      if (videoRef.current) {
        videoRef.current.pause()
        videoRef.current.src = ''
        videoRef.current.load()
        videoRef.current = null
      }
    }
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'f' || e.key === 'F' || e.key === 'а' || e.key === 'А') {
        onyx.fullscreen().then(setFull)
      }
      if (e.key === 'Escape') {
        if (full) {
          onyx.fullscreen(false).then(setFull)
        } else {
          onyx.closeChild()
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
    }
  }, [full])

  return (
    <div className="viz-root">
      <canvas ref={canvasRef} className="viz-canvas" />
    </div>
  )
}
