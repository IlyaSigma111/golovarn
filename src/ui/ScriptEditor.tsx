import React, { useState } from 'react'
import type { ScriptData } from '../types'
import { hub } from '../state/hub'
import { EMOTION_LABELS } from '../state/hub'
import { Icon, EMOTION_ICONS } from './icons'

export function ScriptEditor({ initial, onClose }: { initial: ScriptData; onClose: (result: ScriptData | null) => void }) {
  const [name, setName] = useState(initial.name)
  const [audioPath, setAudioPath] = useState<string | null>(initial.audio_path)
  const [videoPath, setVideoPath] = useState<string | null>(initial.video_path)
  const [emotionIdx, setEmotionIdx] = useState(
    Math.max(0, EMOTION_LABELS.findIndex(([v]) => v === initial.emotion))
  )
  const [headVisible, setHeadVisible] = useState(initial.head_visible !== false)
  const [toggles, setToggles] = useState({
    erosion: initial.erosion_enabled,
    glitch: initial.glitch_enabled,
    alarm: initial.alarm_enabled,
    terminal: initial.terminal_enabled,
    matrix: initial.matrix_enabled,
    shatter: initial.shatter_enabled,
    visualizer: initial.visualizer_enabled,
    particles: initial.particles_enabled,
    waves: initial.waves_enabled,
  })
  const [colorIdx, setColorIdx] = useState(() => {
    if (initial.color_effect === 'red') return 1
    if (initial.color_effect === 'white') return 2
    return 0
  })
  const [error, setError] = useState('')

  const pickAudio = async () => {
    const p = await hub.onyx?.openFile({
      title: 'Выберите аудиофайл',
      filters: [{ name: 'Аудио', extensions: ['wav', 'mp3', 'flac', 'ogg'] }],
    })
    if (p) setAudioPath(p)
  }

  const pickVideo = async () => {
    const p = await hub.onyx?.openFile({
      title: 'Выберите видеофайл',
      filters: [{ name: 'Видео', extensions: ['mp4', 'avi', 'mov', 'mkv', 'webm'] }],
    })
    if (p) setVideoPath(p)
  }

  const save = () => {
    if (!name.trim()) {
      setError('Введите название сценария')
      return
    }
    if (!audioPath && !videoPath) {
      if (!window.confirm('В сценарии нет аудио и видео файлов. Продолжить?')) return
    }
    const emotion = EMOTION_LABELS[emotionIdx][0]
    const result: ScriptData = {
      ...initial,
      name: name.trim(),
      audio_path: audioPath,
      video_path: videoPath,
      emotion,
      head_visible: headVisible,
      erosion_enabled: toggles.erosion,
      glitch_enabled: toggles.glitch,
      alarm_enabled: toggles.alarm,
      terminal_enabled: toggles.terminal,
      matrix_enabled: toggles.matrix,
      shatter_enabled: toggles.shatter,
      visualizer_enabled: toggles.visualizer,
      particles_enabled: toggles.particles,
      waves_enabled: toggles.waves,
      color_effect: colorIdx === 0 ? null : colorIdx === 1 ? 'red' : 'white',
    }
    onClose(result)
  }

  const tog = (key: keyof typeof toggles) => setToggles((t) => ({ ...t, [key]: !t[key] }))

  const toggleDefs: Array<{ key: keyof typeof toggles; label: string; icon: 'skull' | 'glitch' | 'alarm' | 'terminal' | 'matrix' | 'shatter' | 'visualizer' | 'particles' | 'waves' }> = [
    { key: 'erosion', label: 'Эрозия лица (осыпание)', icon: 'skull' },
    { key: 'glitch', label: 'Помехи (глитч)', icon: 'glitch' },
    { key: 'alarm', label: 'Тревога (ошибка/внимание)', icon: 'alarm' },
    { key: 'terminal', label: 'Терминал', icon: 'terminal' },
    { key: 'matrix', label: 'Матрица (дождь из кода)', icon: 'matrix' },
    { key: 'shatter', label: 'Рассыпание', icon: 'shatter' },
    { key: 'visualizer', label: 'Звуковой визуализатор', icon: 'visualizer' },
    { key: 'particles', label: 'Символы кода', icon: 'particles' },
    { key: 'waves', label: 'Волны', icon: 'waves' },
  ]

  const emotion = EMOTION_LABELS[emotionIdx]

  return (
    <div className="se-overlay">
      <div className="se-dialog">
        <div className="se-title"><Icon name="edit" size={16} /> Редактор сценария</div>

        <label className="se-field">
          <span>Название:</span>
          <input value={name} onChange={(e) => setName(e.target.value)} />
        </label>

        <div className="se-group">
          <div className="se-group-title"><Icon name="music" size={13} /> Аудио</div>
          <div className="se-file-row">
            <input readOnly value={audioPath ?? ''} placeholder="нет аудио" />
            <button className="btn btn-sm" onClick={pickAudio}><Icon name="folderPlus" size={14} /> Выбрать</button>
            <button className="btn btn-sm btn-danger" onClick={() => setAudioPath(null)}><Icon name="trash" size={14} /></button>
          </div>
        </div>

        <div className="se-group">
          <div className="se-group-title"><Icon name="video" size={13} /> Видео</div>
          <div className="se-file-row">
            <input readOnly value={videoPath ?? ''} placeholder="нет видео" />
            <button className="btn btn-sm" onClick={pickVideo}><Icon name="folderPlus" size={14} /> Выбрать</button>
            <button className="btn btn-sm btn-danger" onClick={() => setVideoPath(null)}><Icon name="trash" size={14} /></button>
          </div>
        </div>

        <div className="se-group">
          <div className="se-group-title"><Icon name={EMOTION_ICONS[emotion[0]] ?? 'neutral'} size={13} /> Эмоция</div>
          <select value={emotionIdx} onChange={(e) => setEmotionIdx(parseInt(e.target.value, 10))}>
            {EMOTION_LABELS.map(([v, l], i) => (
              <option key={i} value={i}>{l}</option>
            ))}
          </select>
        </div>

        <div className="se-group">
          <div className="se-group-title"><Icon name="monitor" size={13} /> Отображение</div>
          <div className="se-checks">
            <label className={'chk' + (headVisible ? ' on' : '')}>
              <input type="checkbox" checked={headVisible} onChange={() => setHeadVisible(!headVisible)} />
              <Icon name="skull" size={14} className="chk-icon" />
              <span>Показывать голову</span>
            </label>
          </div>
        </div>

        <div className="se-group">
          <div className="se-group-title"><Icon name="shatter" size={13} /> Эффекты</div>
          <div className="se-checks">
            {toggleDefs.map((d) => (
              <label key={d.key} className={'chk' + (toggles[d.key] ? ' on' : '')}>
                <input type="checkbox" checked={toggles[d.key]} onChange={() => tog(d.key)} />
                <Icon name={d.icon} size={14} className="chk-icon" />
                <span>{d.label}</span>
              </label>
            ))}
          </div>
        </div>

        <div className="se-group">
          <div className="se-group-title"><Icon name="droplet" size={13} /> Цветовой эффект</div>
          <select value={colorIdx} onChange={(e) => setColorIdx(parseInt(e.target.value, 10))}>
            <option value={0}>Без эффекта</option>
            <option value={1}>Красный</option>
            <option value={2}>Белый</option>
          </select>
        </div>

        {error && <div className="se-error">{error}</div>}

        <div className="se-buttons">
          <button className="btn btn-primary" onClick={save}><Icon name="check" size={14} /> Сохранить</button>
          <button className="btn" onClick={() => onClose(null)}><Icon name="close" size={14} /> Отмена</button>
        </div>
      </div>
    </div>
  )
}
