import React, { useEffect, useRef, useState } from 'react'
import { SkullCanvas } from '../skull/canvas'
import { hub, DEFAULT_EFFECTS, EMOTION_LABELS } from '../state/hub'
import { emotionLabel } from '../state/hub'
import { MusicWidget } from '../ui/MusicWidget'
import { ScriptEditor } from '../ui/ScriptEditor'
import { Icon, type IconName } from '../ui/icons'
import type { EffectToggles, ScriptData } from '../types'

const onyx = window as unknown as {
  onyx?: {
    readText: (p: string) => Promise<string | null>
    writeText: (p: string, d: string) => Promise<boolean>
  }
}

const FACE_EFFECTS: Array<{ key: keyof EffectToggles; icon: IconName; label: string; color: string }> = [
  { key: 'erosion', icon: 'skull', label: 'Эрозия', color: '#ff8800' },
  { key: 'glitch', icon: 'glitch', label: 'Помехи', color: '#ff44ff' },
  { key: 'alarm', icon: 'alarm', label: 'Тревога', color: '#ff2222' },
  { key: 'terminal', icon: 'terminal', label: 'Терминал', color: '#00ff88' },
  { key: 'matrix', icon: 'matrix', label: 'Матрица', color: '#00ff44' },
  { key: 'shatter', icon: 'shatter', label: 'Рассыпание', color: '#ff8844' },
]

const BG_EFFECTS: Array<{ key: keyof EffectToggles; icon: IconName; label: string }> = [
  { key: 'visualizer', icon: 'visualizer', label: 'Визуализатор' },
  { key: 'particles', icon: 'particles', label: 'Символы' },
  { key: 'waves', icon: 'waves', label: 'Волны' },
]

const EMOTION_BUTTONS: Array<{ value: number; icon: IconName; label: string }> = [
  { value: 1, icon: 'smile', label: 'Добрый' },
  { value: 0, icon: 'neutral', label: 'Нейтральный' },
  { value: -1, icon: 'angry', label: 'Злой' },
]

function emptyScript(): ScriptData {
  return {
    name: 'Новый сценарий',
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

function baseName(p: string): string {
  return p.split(/[\\/]/).pop() || p
}

export function MainPanel() {
  const [status, setStatus] = useState('Готов')
  const [avatarStatus, setAvatarStatus] = useState('Аватар не загружен')
  const [toggles, setToggles] = useState<EffectToggles>(DEFAULT_EFFECTS())
  const [scripts, setScripts] = useState<ScriptData[]>([])
  const [currentIdx, setCurrentIdx] = useState(-1)
  const [playing, setPlaying] = useState(false)
  const [autoPlay, setAutoPlay] = useState(true)
  const [chatOn, setChatOn] = useState(false)
  const [headVisible, setHeadVisible] = useState(true)
  const [editor, setEditor] = useState<{ script: ScriptData; isNew: boolean } | null>(null)
  const [headScale, setHeadScale] = useState(1)
  const [paused, setPaused] = useState(false)
  const [renameOf, setRenameOf] = useState<ScriptData | null>(null)
  const [renameVal, setRenameVal] = useState('')

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const skullRef = useRef<SkullCanvas | null>(null)
  const [modelLoaded, setModelLoaded] = useState(false)

  const refresh = () => {
    setScripts([...hub.scripts.scripts])
    const ci = hub.scripts.scripts.findIndex((s) => s === hub.currentScript)
    setCurrentIdx(ci)
    setToggles({ ...hub.effects })
    setHeadScale(hub.params.data.head_scale || 1)
  }

  useEffect(() => {
    hub.onStatus = (s) => setStatus(s)
    hub.onPlayStateChange = (p) => {
      setPlaying(p)
      if (!p) setPaused(false)
      setToggles({ ...hub.effects })
    }
    hub.onScriptsChange = () => refresh()
    hub.onParamsChange = () => refresh()

    let alive = true
    ;(async () => {
      await Promise.all([hub.loadParams(), hub.scriptsInit()])
      if (!alive) return
      hub.autoPlayEnabled = true
      setAvatarStatus('Аватар загружен (default)')
      if (hub.scripts.scripts.length) hub.currentScript = hub.scripts.scripts[0]
      refresh()
      const canvas = canvasRef.current
      if (canvas) {
        const skull = new SkullCanvas(canvas, hub.params)
        skullRef.current = skull
        skull.start()
        hub.setPreview(skull)
      }
    })()

    return () => {
      alive = false
      hub.setPreview(null)
      skullRef.current?.stop()
      skullRef.current = null
      hub.onStatus = null
      hub.onPlayStateChange = null
      hub.onScriptsChange = null
      hub.onParamsChange = null
    }
  }, [])

  const current = currentIdx >= 0 && currentIdx < scripts.length ? scripts[currentIdx] : null

  const toggleFx = (key: keyof EffectToggles, active: boolean) => {
    hub.setEffect(key, active)
    setToggles({ ...hub.effects })
  }

  const toggleChatter = () => {
    const v = !chatOn
    setChatOn(v)
    hub.setChatter(v)
  }

  const toggleHeadVisible = () => {
    const v = !headVisible
    setHeadVisible(v)
    hub.setHeadVisible(v)
  }

  const loadAvatar = async () => {
    const ok = await hub.loadAvatar()
    if (ok) setAvatarStatus('Аватар загружен (пользовательский)')
  }

  const loadModelBtn = async () => {
    const ok = await hub.loadModel()
    if (ok) {
      setAvatarStatus('Модель загружена (Головастик)')
      setModelLoaded(true)
    }
  }

  const clearModelBtn = () => {
    hub.clearModel()
    setModelLoaded(false)
    setAvatarStatus('Аватар загружен (default)')
  }

  const newScript = () => setEditor({ script: emptyScript(), isNew: true })

  const editScript = () => {
    if (current) setEditor({ script: current, isNew: false })
  }

  const deleteScript = () => {
    if (!current) return
    if (!window.confirm(`Удалить сценарий «${current.name}»?`)) return
    const idx = hub.scripts.scripts.findIndex((s) => s === current)
    if (idx < 0) return
    if (hub.isPlaying) hub.stopScript()
    hub.scripts.remove(idx)
    if (hub.currentScript === current) hub.currentScript = hub.scripts.scripts[0] ?? null
    hub.scripts.save()
    refresh()
  }

  const renameScript = (script: ScriptData) => {
    setRenameVal(script.name)
    setRenameOf(script)
  }

  const renameCommit = () => {
    if (!renameOf) return
    const n = renameVal.trim()
    if (!n || n === renameOf.name) {
      setRenameOf(null)
      return
    }
    if (hub.scripts.scripts.some((s) => s !== renameOf && s.name === n)) {
      window.alert(`Сценарий с именем '${n}' уже существует`)
      return
    }
    hub.scripts.rename(hub.scripts.scripts.findIndex((s) => s === renameOf), n)
    setRenameOf(null)
    refresh()
  }

  const editorClose = (res: ScriptData | null) => {
    if (res) {
      if (editor?.isNew) {
        if (hub.scripts.scripts.some((s) => s.name === res.name)) {
          window.alert(`Сценарий с именем '${res.name}' уже существует`)
          return
        }
        hub.scripts.scripts.push(res)
      } else if (editor) {
        const idx = hub.scripts.scripts.findIndex((s) => s === editor.script)
        if (idx >= 0) hub.scripts.scripts[idx] = res
      }
      hub.scripts.save()
      hub.selectScript(res)
      refresh()
    }
    setEditor(null)
  }

  const saveScriptToFile = async () => {
    if (!current) return
    const p = await hub.onyx?.saveFile({
      title: 'Сохранить сценарий',
      defaultPath: `${current.name}.json`,
      filters: [{ name: 'Script files', extensions: ['json'] }],
    })
    if (!p) return
    await onyx.onyx?.writeText(p, JSON.stringify(current, null, 2))
    setStatus(`[SAVE] Сценарий сохранен: ${baseName(p)}`)
  }

  const loadScriptFromFile = async () => {
    const p = await hub.onyx?.openFile({
      title: 'Загрузить сценарий',
      filters: [{ name: 'Script files', extensions: ['json'] }],
    })
    if (!p) return
    const raw = await onyx.onyx?.readText(p)
    if (!raw) {
      setStatus('[ERR] Не удалось прочитать файл')
      return
    }
    try {
      const data = JSON.parse(raw) as Partial<ScriptData>
      const script: ScriptData = { ...emptyScript(), ...data }
      const existing = hub.scripts.scripts.find((s) => s.name === script.name)
      if (existing) {
        if (!window.confirm(`Сценарий с именем '${script.name}' уже существует. Заменить?`)) return
        hub.scripts.scripts[hub.scripts.scripts.indexOf(existing)] = script
      } else {
        hub.scripts.scripts.push(script)
      }
      hub.scripts.save()
      hub.selectScript(script)
      refresh()
      setStatus(`[LOAD] Сценарий загружен: ${baseName(p)}`)
    } catch {
      setStatus('[ERR] Ошибка в JSON сценария')
    }
  }

  const play = () => {
    if (!current) return
    hub.playScript(current)
    setPlaying(true)
    setPaused(false)
  }

  const stop = () => {
    hub.stopScript()
    setPlaying(false)
    setPaused(false)
  }

  const pauseToggle = () => {
    hub.togglePause()
    setPaused(hub.isPaused)
  }

  const step = (dir: 1 | -1) => {
    if (!scripts.length) return
    const n = scripts.length
    const idx = current ? scripts.findIndex((s) => s === current) : -1
    const start = idx < 0 ? (dir === 1 ? -1 : 0) : idx
    const next = scripts[(((start + dir) % n) + n) % n]
    hub.selectScript(next)
    refresh()
    hub.playScript(next)
    setPlaying(true)
    setPaused(false)
  }

  const effectsList = current
    ? (FACE_EFFECTS as Array<{ key: keyof EffectToggles; icon: IconName; label: string }>)
        .filter((e) => (current as unknown as Record<string, unknown>)[e.key + '_enabled'])
        .map((e) => e.label)
        .concat(
          (BG_EFFECTS as Array<{ key: keyof EffectToggles; icon: IconName; label: string }>)
            .filter((e) => (current as unknown as Record<string, unknown>)[e.key + '_enabled'])
            .map((e) => e.label)
        )
        .concat(current.color_effect ? [`Цвет: ${current.color_effect === 'red' ? 'Красный' : 'Белый'}`] : [])
    : []

  return (
    <div className="panel-root">
      <div className="panel-body">
        <aside className="panel-left">
          <button className="btn-viz btn-block" onClick={() => hub.openViz()}>
            <Icon name="monitor" size={18} /> Открыть визуализацию
          </button>

          {/* ── 1. Аватар и модель ── */}
          <section className="grp">
            <div className="grp-title"><Icon name="skull" size={14} /> Аватар</div>
            <div className="grp-row">
              <button className="btn btn-sm" onClick={loadAvatar}>
                <Icon name="folderOpen" size={13} /> Аватар
              </button>
              <button className="btn btn-sm" onClick={loadModelBtn}>
                <Icon name="folderOpen" size={13} /> Модель
              </button>
              <button className="btn btn-sm btn-danger" onClick={clearModelBtn} disabled={!modelLoaded}>
                Сброс
              </button>
            </div>
            <div className="avatar-status" style={{ color: avatarStatus.includes('не загружен') ? '#888' : '#00ff00' }}>
              {avatarStatus}
            </div>
          </section>

          {/* ── 2. Эффекты лица ── */}
          <section className="grp">
            <div className="grp-title"><Icon name="glitch" size={14} /> Эффекты</div>
            <div className="grp-subtitle">Лицо</div>
            <div className="chk-col">
              {FACE_EFFECTS.map((e) => (
                <label key={e.key} className={'fx-cb' + (toggles[e.key] ? ' on' : '')} style={{ '--ac': e.color } as React.CSSProperties}>
                  <input type="checkbox" checked={toggles[e.key]} onChange={(ev) => toggleFx(e.key, ev.target.checked)} />
                  <Icon name={e.icon} size={14} className="chk-icon" />
                  <span>{e.label}</span>
                </label>
              ))}
            </div>
            <div className="grp-divider"></div>
            <div className="grp-subtitle">Фон</div>
            <div className="chk-col">
              {BG_EFFECTS.map((e) => (
                <label key={e.key} className={'fx-cb' + (toggles[e.key] ? ' on' : '')}>
                  <input type="checkbox" checked={toggles[e.key]} onChange={(ev) => toggleFx(e.key, ev.target.checked)} />
                  <Icon name={e.icon} size={14} className="chk-icon" />
                  <span>{e.label}</span>
                </label>
              ))}
            </div>
          </section>

          {/* ── 3. Цвет ── */}
          <section className="grp">
            <div className="grp-title"><Icon name="droplet" size={14} /> Цвет</div>
            <div className="color-row">
              <button className="btn btn-sm btn-c-red" title="Красный" onClick={() => hub.setColor('red')}>
                <Icon name="droplet" size={14} />
              </button>
              <button className="btn btn-sm btn-c-green" title="Исходный цвет" onClick={() => hub.setColor('reset')}>
                <Icon name="reset" size={14} />
              </button>
              <button className="btn btn-sm btn-c-white" title="Белый" onClick={() => hub.setColor('white')}>
                <Icon name="droplet" size={14} />
              </button>
            </div>
          </section>

          {/* ── 4. Эмоции ── */}
          <section className="grp">
            <div className="grp-title"><Icon name="smile" size={14} /> Эмоции</div>
            <div className="emotion-row">
              {EMOTION_BUTTONS.map((e) => (
                <button
                  key={e.value}
                  className={'emotion-btn' + (hub.emotion === e.value ? ' active' : '')}
                  title={e.label}
                  onClick={() => {
                    hub.setEmotion(e.value)
                    if (current) {
                      current.emotion = e.value
                      hub.scripts.save()
                    }
                    setToggles({ ...hub.effects })
                  }}
                >
                  <Icon name={e.icon} size={15} />
                </button>
              ))}
            </div>
          </section>




          {/* ── 6. Статус ── */}
          <section className="grp grp-status">
            <div className="grp-title"><Icon name="terminal" size={14} /> Статус</div>
            <button
              type="button"
              className={'btn-viz btn-block btn-chatter' + (chatOn ? ' on' : '')}
              onClick={toggleChatter}
              title="Имитация речи: рот хаотично двигается, будто голова говорит"
            >
              <Icon name={chatOn ? 'monitor' : 'skull'} size={18} />
              {chatOn ? 'Голова говорит (вкл)' : 'Голова говорит (выкл)'}
            </button>
            <button
              type="button"
              className={'btn-viz btn-block' + (headVisible ? ' on' : '')}
              onClick={toggleHeadVisible}
              title="Показать или скрыть голову на экране (остаются видео, фон, эффекты)"
              style={{ marginTop: 6 }}
            >
              <Icon name={headVisible ? 'monitor' : 'skull'} size={18} />
              {headVisible ? 'Голова видна' : 'Голова скрыта'}
            </button>
            <div className="status-line">{status}</div>
          </section>
        </aside>

        <main className="panel-center">
          <div className="preview-title"><Icon name="monitor" size={15} /> Предпросмотр</div>
          <div className="preview-wrap">
            <canvas ref={canvasRef} className="preview-canvas" />
          </div>
          <div className="preview-size">
            <span className="preview-size-label">Размер головы</span>
            <input
              type="range"
              min={0.4}
              max={2.4}
              step={0.05}
              value={headScale}
              onChange={(ev) => {
                const v = parseFloat(ev.target.value)
                setHeadScale(v)
                hub.setHeadScale(v)
              }}
            />
            <span className="preview-size-val">{headScale.toFixed(2)}×</span>
          </div>
        </main>

        <aside className="panel-right">
          {/* ── Сценарии ── */}
          <section className="grp grp-scripts">
            <div className="grp-title"><Icon name="file" size={14} /> Сценарии</div>

            <div className="sc-list">
              {scripts.length === 0 ? (
                <div className="sc-empty">Сценариев нет</div>
              ) : (
                scripts.map((s, i) => (
                  <div
                    key={i}
                    className={'sc-item' + (i === currentIdx ? ' current' : '')}
                    onClick={() => {
                      hub.selectScript(s)
                      refresh()
                    }}
                    onDoubleClick={() => {
                      hub.selectScript(s)
                      refresh()
                      hub.playScript(s)
                      setPlaying(true)
                    }}
                  >
                    <Icon name="file" size={12} className="sc-ic" />
                    <span className="sc-name">{s.name}</span>
                    <button
                      type="button"
                      className="sc-rename"
                      title="Переименовать"
                      onClick={(ev) => {
                        ev.stopPropagation()
                        renameScript(s)
                      }}
                    >
                      <Icon name="edit" size={11} />
                    </button>
                    <span className="sc-mark">
                      {playing && s === hub.currentScript ? <Icon name="play" size={11} /> : s === hub.currentScript ? <span className="sc-arrow">◀</span> : null}
                    </span>
                  </div>
                ))
              )}
            </div>

            {current && (
              <div className="sc-info-block">
                <div className="sc-info-row"><span className="sc-info-key">Имя:</span> {current.name}</div>
                <div className="sc-info-row"><span className="sc-info-key">Аудио:</span> {current.audio_path ? baseName(current.audio_path) : '—'}</div>
                <div className="sc-info-row"><span className="sc-info-key">Видео:</span> {current.video_path ? baseName(current.video_path) : '—'}</div>
                <div className="sc-info-row"><span className="sc-info-key">Эмоция:</span> {emotionLabel(current.emotion)}</div>
                {effectsList.length > 0 && (
                  <div className="sc-info-row"><span className="sc-info-key">Эффекты:</span> {effectsList.join(', ')}</div>
                )}
              </div>
            )}
          </section>

          {/* ── Управление ── */}
          <section className="grp grp-controls">
            <div className="grp-row">
              <button className="btn btn-sm" onClick={newScript}><Icon name="plus" size={13} /> Новый</button>
              <button className="btn btn-sm" onClick={editScript} disabled={!current}><Icon name="edit" size={13} /> Ред.</button>
              <button className="btn btn-sm btn-danger" onClick={deleteScript} disabled={!current}><Icon name="trash" size={13} /> Удал.</button>
            </div>
            <div className="grp-row">
              <button className="btn btn-sm" onClick={loadScriptFromFile}><Icon name="folderOpen" size={13} /> Загрузить</button>
              <button className="btn btn-sm" onClick={saveScriptToFile} disabled={!current}><Icon name="save" size={13} /> Сохранить</button>
            </div>
            <div className="grp-divider"></div>
            <div className="grp-row">
              <button
                className="btn btn-primary btn-sm btn-playwide"
                onClick={paused ? pauseToggle : playing ? pauseToggle : play}
                disabled={!current}
              >
                <Icon name={paused || !playing ? 'play' : 'pause'} size={13} /> {paused ? 'Далее' : playing ? 'Пауза' : 'Воспроизвести'}
              </button>
              <button className="btn btn-sm btn-danger" onClick={stop} disabled={!current}><Icon name="stop" size={13} /> Стоп</button>
            </div>
            <div className="grp-row auto-row">
              <label className="chk auto">
                <input
                  type="checkbox"
                  checked={autoPlay}
                  onChange={(ev) => {
                    setAutoPlay(ev.target.checked)
                    hub.autoPlayEnabled = ev.target.checked
                  }}
                />
                <Icon name="refresh" size={13} className="chk-icon" />
                <span>Авто</span>
              </label>
              <span className="row-grow" />
              <button className="btn btn-sm btn-sq" onClick={() => step(-1)} title="Предыдущий"><Icon name="skipPrev" size={13} /></button>
              <button className="btn btn-sm btn-sq" onClick={() => step(1)} title="Следующий"><Icon name="skipNext" size={13} /></button>
            </div>
          </section>

          {/* ── Музыка ── */}
          <section className="grp grp-music">
            <MusicWidget />
          </section>
        </aside>
      </div>

      {editor && <ScriptEditor initial={editor.script} onClose={editorClose} />}

      {renameOf && (
        <div
          className="modal-overlay"
          onClick={() => setRenameOf(null)}
        >
          <div className="rename-dialog" onClick={(ev) => ev.stopPropagation()}>
            <div className="rename-title">Переименовать сценарий</div>
            <input
              className="rename-input"
              autoFocus
              value={renameVal}
              onChange={(ev) => setRenameVal(ev.target.value)}
              onKeyDown={(ev) => {
                if (ev.key === 'Enter') renameCommit()
                if (ev.key === 'Escape') setRenameOf(null)
              }}
            />
            <div className="rename-actions">
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => setRenameOf(null)}
              >
                Отмена
              </button>
              <button
                type="button"
                className="btn btn-sm btn-primary"
                onClick={renameCommit}
              >
                ОК
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
