import React, { useEffect, useRef, useState } from 'react'
import { hub } from '../state/hub'
import { Icon } from './icons'

interface MusicTrack {
  path: string
  name: string
}

export function MusicWidget() {
  const [tracks, setTracks] = useState<MusicTrack[]>([])
  const [current, setCurrent] = useState<string | null>(null)
  const [playing, setPlaying] = useState(false)
  const [label, setLabel] = useState('Нет трека')
  const [labelColor, setLabelColor] = useState('#888888')
  const [volume, setVolume] = useState(80)
  const [selected, setSelected] = useState(-1)

  useEffect(() => {
    hub.music.onStateChange = (p) => {
      setPlaying(p)
      if (p) {
        setLabel('▶ ' + currentLabel(hub.music.currentIndex))
        setLabelColor('#00ff00')
      }
    }
    hub.music.onTrackChange = (i) => {
      setCurrent(hub.music.tracks[i]?.name ?? null)
      setLabel('▶ ' + (hub.music.tracks[i]?.name ?? ''))
      setLabelColor('#00ff00')
      setTracks(hub.music.tracks.map((t) => ({ path: t.path, name: t.name })))
    }
    return () => {
      hub.music.onStateChange = null
      hub.music.onTrackChange = null
    }
  }, [])

  const currentLabel = (i: number) => hub.music.tracks[i]?.name ?? ''

  const addTracks = async () => {
    const files = await hub.onyx?.openFiles({
      title: 'Выберите аудиофайлы',
      filters: [{ name: 'Аудио', extensions: ['mp3', 'wav', 'flac', 'ogg'] }],
    })
    if (!files?.length) return
    for (const f of files) {
      const ok = await hub.music.addTrack(f, f.split(/[\\/]/).pop() || f)
      if (ok) setTracks([...hub.music.tracks.map((t) => ({ path: t.path, name: t.name }))])
    }
  }

  const removeTrack = () => {
    if (selected < 0 || selected >= tracks.length) return
    const wasCurrent = hub.music.currentIndex === selected
    const wasLastOfList = hub.music.tracks.length === 1
    if (wasCurrent) hub.music.stop()
    hub.music.tracks.splice(selected, 1)
    if (selected < hub.music.currentIndex) hub.music.currentIndex--
    else if (selected === hub.music.currentIndex) hub.music.currentIndex = -1
    setTracks([...hub.music.tracks.map((t) => ({ path: t.path, name: t.name }))])
    setSelected(-1)
    if (wasCurrent || wasLastOfList) {
      setLabel('Нет трека')
      setLabelColor('#888888')
      setPlaying(false)
    }
  }

  const clearTracks = () => {
    hub.music.clearTracks()
    setTracks([])
    setCurrent(null)
    setSelected(-1)
    setLabel('Нет трека')
    setLabelColor('#888888')
    setPlaying(false)
  }

  const playTrack = (idx: number) => {
    hub.music.play(idx)
  }

  const playPause = () => {
    if (hub.music.currentIndex < 0) {
      if (hub.music.tracks.length > 0) hub.music.play(0)
      return
    }
    if (hub.music.isPlaying) {
      hub.music.pause()
      setPlaying(false)
      setLabel('⏸ ' + currentLabel(hub.music.currentIndex))
      setLabelColor('#ffaa00')
    } else {
      hub.music.resume()
      setPlaying(true)
      setLabel('▶ ' + currentLabel(hub.music.currentIndex))
      setLabelColor('#00ff00')
    }
  }

  const stopMusic = () => {
    hub.music.stop()
    setPlaying(false)
    setLabel('⏹ Остановлено')
    setLabelColor('#ff4444')
  }

  const changeVolume = (v: number) => {
    setVolume(v)
    hub.music.setVolume(v / 100)
  }

  return (
    <div className="mu-widget">
      <div className="mu-title"><Icon name="music" size={15} /> Музыкальный плейер</div>
      <div className="mu-list">
        {tracks.length === 0 ? (
          <div className="mu-empty">Треков нет — добавьте файлы</div>
        ) : (
          tracks.map((t, i) => (
            <div
              key={i}
              className={'mu-item' + (selected === i ? ' selected' : '') + (hub.music.currentIndex === i && playing ? ' playing' : '')}
              onClick={() => setSelected(i)}
              onDoubleClick={() => playTrack(i)}
            >
              <Icon name={hub.music.currentIndex === i && playing ? 'play' : 'music'} size={13} className="mu-note" />
              {t.name}
            </div>
          ))
        )}
      </div>
      <div className="mu-label" style={{ color: labelColor }}>{label}</div>
      <div className="mu-row">
        <button className="btn btn-sm" title="Добавить музыку" onClick={addTracks}><Icon name="folderPlus" /></button>
        <button className="btn btn-sm btn-danger" title="Удалить выбранный трек" onClick={removeTrack}><Icon name="trash" /></button>
        <button className="btn btn-sm btn-danger" title="Очистить список" onClick={clearTracks}><Icon name="close" /></button>
      </div>
      <div className="mu-row">
        <button className="btn btn-sm btn-play" title="Воспроизвести/Пауза" onClick={playPause}>
          <Icon name={playing ? 'pause' : 'play'} />
        </button>
        <button className="btn btn-sm btn-danger" title="Остановить" onClick={stopMusic}><Icon name="stop" /></button>
        <div className="mu-vol">
          <Icon name="volume" size={15} className="mu-vol-icon" />
          <input
            type="range"
            min={0}
            max={100}
            value={volume}
            onChange={(e) => changeVolume(parseInt(e.target.value, 10))}
          />
        </div>
      </div>
    </div>
  )
}
