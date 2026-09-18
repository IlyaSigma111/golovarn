# ГОЛОВА — Чеклист исправлений

Проект: ~/golova (Electron/Vite/TypeScript, React)

---

## 1. КРИТИЧЕСКИЕ БАГИ (исправлено)

### 1.1 transferToImageBitmap — краш каждый 5-й кадр
[x] canvas.ts: HTMLCanvasElement.transferToImageBitmap() не существует — каст `as unknown` скрывал ошибку
[x] Исправлено: копирование в OffscreenCanvas → transferToImageBitmap()

### 1.2 ResizeObserver — утечка памяти
[x] canvas.ts: ResizeObserver создавался но ссылка терялась — невозможно disconnect
[x] Исправлено: сохранён в `this.ro`, disconnect() в stop()

### 1.3 Video DOM leak — элементы не удалялись
[x] VizPage.tsx: video элементы создавались но не чистились при unmount
[x] Исправлено: cleanup в useEffect return — pause + src='' + load() + null

---

## 2. HIGH-БАГИ (исправлено)

### 2.1 Saccade drift — накопление смещения
[x] faceAnim.ts: driftX/driftY не сбрасывались при начале саккады
[x] Исправлено: driftX=0, driftY=0 при завершении саккады

### 2.2 AudioContext resume — не awaited
[x] player.ts: resume() вызывал ctx.resume() без await — старт до готовности контекста
[x] Исправлено: async resume() с await ctx.resume()

### 2.3 fadeProgress — вычислялся но не применялся
[x] videoPlayer.ts: fadeProgress считался но opacity видео не менялся
[x] Исправлено: video.style.opacity = String(1 - this.fadeProgress)

### 2.4 CSS дублирование .panel-root
[x] styles.css: два определения .panel-root — второе перезаписывало flex
[x] Исправлено: дубликат удалён, оставлено в первом определении

### 2.5 Визуализатор рисовался дважды
[x] canvas.ts: drawVisualizerPublic вызывался + drawBackgroundEffects вызывал drawVisualizer
[x] Исправлено: флаг visualizerSkipInBg в effects.ts

### 2.6 staticDirty — пересборка каждый кадр при открытом рте
[x] canvas.ts: staticDirty=true каждый кадр при mouth_open > 0.02
[x] Исправлено: отслеживание prevMouthOpen — dirty только при смене состояния

### 2.7 drawSkullInCorner — лишний layout()
[x] canvas.ts: layout() вызывался но результат не использовался
[x] Исправлено: убран вызов layout(), расчёт fontSize напрямую

### 2.8 effects.ts — non-null assertion
[x] effects.ts: `!` на get() — потенциальный краш при race condition
[x] Исправлено: optional chaining `d?.eroded`

### 2.9 renderer.ts — non-null assertions
[x] renderer.ts: две строки с `!` на erosion_cells.get()
[x] Исправлено: проверка d ? !d.eroded : true

---

## 3. ИНТЕРФЕЙС (перестроен)

### 3.1 Структура левой панели
[x] Было: 8 секций подряд без визуальных подгрупп
[x] Стало: 7 секций с подзаголовками (Глаза, Рот, Мимика)

### 3.2 Разделение "Цвет и Эмоции"
[x] Было: одна секция с кнопками цвета и эмоций
[x] Стало: отдельные секции "Цвет" и "Эмоции"

### 3.3 Эффекты — объединены
[x] Было: "Эффекты лица" + "Эффекты фона" отдельно
[x] Стало: одна секция "Эффекты" с подзаголовками "Лицо" и "Фон"

### 3.4 Анимация — подгруппы
[x] Было: все слайдеры подряд без разделения
[x] Стало: подзаголовки "Глаза", "Рот", "Мимика"

### 3.5 ИИ — свёртываемый блок
[x] Было: всегда открыт, inline-стили
[x] Стало: свёртывается по клику, CSS-классы

### 3.6 Правая панель — инфо блок
[x] Было: infoLines как plain text
[x] Стало: структурированный блок с ключами

### 3.7 Кнопка edit — всегда видима
[x] Было: opacity: 0, появлялась только при hover
[x] Стало: opacity: 0.55, всегда видна

---

## 4. ОСТАЛЬНЫЕ БАГИ (обнаружены, НЕ исправлены)

### 4.1 video.play() fire-and-forget
[!] hub.ts: video.play() без обработки ошибок автоблока
Приоритет: medium

### 4.2 API key в localStorage
[!] ai.ts: ключ в URL query string + localStorage
Приоритет: medium (безопасность)

### 4.3 effects.ts: initCodeParticles(1920,1080) захардкожен
[!] Конструктор Particles/Matrix на 1920×1080
Приоритет: low

### 4.5 emotion_pupil_bias не используется
[!] Параметр сохраняется но не читается рендерером
Приоритет: low

### 4.6 headMap.ts — мёртвый код
[!] Файл импортируется но не используется
Приоритет: low

### 4.7 #player маршрут не обрабатывается
[!] main.tsx: hash 'player' рендерит MainPanel вместо PlayerPage
Приоритет: low

### 4.8 loadAudioFromScript — setTimeout 150ms
[!] гонка при быстром play/stop
Приоритет: medium

---

## 5. ОПТИМИЗАЦИЯ ПРОИЗВОДИТЕЛЬНОСТИ (исправлено)

Аудит выявил до 35мс/кадр при полной нагрузке (аудио+видео+эффекты) —
нужно 16.6мс для 60fps. Исправлены главные узкие места.

### 5.1 rebuildMask — аллокация 2D-массивов каждый рот-переход
[x] Было: buildMask() создавал 2 новых массива (200×200×2 = 80k ячеек) при каждом открытии/закрытии рта — 2-4 раза/сек при аудио
[x] Исправлено: clearMasks() — in-place fill(false), без аллокаций

### 5.2 OffscreenCanvas создавался каждые 5 кадров
[x] Было: new OffscreenCanvas(w,h) + full drawImage каждый 5-й кадр = 8M пикселей аллокации/GC
[x] Исправлено: кэшируется, пересоздаётся только при изменении размера

### 5.3 isShattered/isEroded — string-key Map per cell
[x] Было: Map.get(`${x},${y}`) с созданием строки для каждой клетки в draw loop (40k строк/кадр)
[x] Исправлено: Uint8Array битмаска по y*cols+x — O(1) без аллокаций
[x] isEroded: бит ставится при progress≥0.3, сбрасывается при ≤0.3 (точная семантика)

### 5.4 drawGlitch — ~2100 fillRect с rnd() на кадр
[x] Было: циклы по x+=2/3/4 по всей ширине + rnd() цвет для каждого прямоугольника
[x] Исправлено: ограничено ~60 полос, r/g/b кэшированы в glitch_noise объектах

### 5.5 Двойной rebuildMask у рта
[x] Было: rebuildMask() вызывался 2 раза в кадр при переходе
[x] Исправлено: консолидировано в один rebuildNeeded flag

### 5.6 Остальные оптимизации (не выполнены, низкий приоритет)
[!] layout() кэширование (низкий ROI — 0.1ms)
[!] Перенос аудио-семплинга в rAF (архитектурное изменение)
[!] face_cells.filter() аллокации при эрозии (редкий случай)
[!] ctx.font per particle (batch по размерам)
[!] splice() → swap-pop в update loops

---

## ИЗМЕНЁННЫЕ ФАЙЛЫ (все раунды)

| Файл | Что изменено |
|------|-------------|
| src/skull/renderer.ts | getColorForCell все targets, emotion_data/brow, non-null assertions, **clearMasks in-place (perf)**, **erodedMask Uint8Array (perf)**, консолидирован двойной rebuildMask |
| src/skull/canvas.ts | drawSkullInCorner, mouth colors, layer order, splitSentences, ResizeObserver leak fix, transferToImageBitmap fix, visualizerSkipInBg, staticDirty fix |
| src/skull/effects.ts | shatter speed slowdown, visualizerSkipInBg, non-null fix, **shatteredMask Uint8Array (perf)**, **glitch полосы ограничены + r/g/b кэш (perf)** |
| src/skull/faceAnim.ts | drift reset on saccade end |
| src/skullParams.ts | head_height 90→62, blink/pupil defaults false, emotion params |
| src/types.ts | SkullParamsData emotion fields, StateMsg sync colorEffect |
| src/state/hub.ts | syncBroadcast+color, setEmotionFaceParam, video mute, EMOTION_LABELS |
| src/audio/player.ts | async resume() with await |
| src/video/videoPlayer.ts | fadeProgress → video.style.opacity |
| src/pages/VizPage.tsx | sync color state, video DOM cleanup |
| src/pages/MainPanel.tsx | Полная перестройка UI + **удалён блок ИИ** |
| src/styles.css | Дубликат .panel-root удалён, блоки/подгруппы, **убран CSS ИИ** |

## ПАПКА ДЛЯ ТЕСТА

`~/Documents/ГОЛОВА ДЛЯ ТЕСТА/` — ~1.1MB, полный исходник без node_modules.
Скопировать на Windows, запустить `npm install && npm run dev`.

## ТЕСТИРОВАНИЕ (на Windows)

- [ ] Открыть панель: блоки Аватара/Эффекты/Цвет/Эмоции/Анимация/Статус
- [ ] Включить аудио-сценарий — проверить рот + визуализатор (нет фризов)
- [ ] Включить видео — skull в углу, звук без дубля
- [ ] Переключить цвет (красный/белый) — все окна синхронны
- [ ] Включить все эффекты сразу — проверить FPS (не должно падать ниже ~50)
- [ ] Эмоции (Добрый/Злой) — брови и уголки рта меняются
