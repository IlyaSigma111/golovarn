import headMapRaw from '../head_map.txt?raw'

export interface Rect {
  x: number
  y: number
  w: number
  h: number
  cx: number
  cy: number
}

const rawLines = headMapRaw.replace(/\r/g, '').split('\n')

export const COLS = Math.max(...rawLines.map((l) => l.length))
export const ROWS = rawLines.length

function parseMap(): boolean[][] {
  const mask: boolean[][] = []
  for (let y = 0; y < ROWS; y++) {
    const row: boolean[] = []
    const line = rawLines[y] || ''
    for (let x = 0; x < COLS; x++) {
      row.push(x < line.length ? line[x] !== ' ' : false)
    }
    mask.push(row)
  }
  return mask
}

// Space cells not reachable from the border = internal holes (dark features)
function findInternalHoles(mask: boolean[][]): Rect[] {
  const bg: boolean[][] = Array.from({ length: ROWS }, () => Array(COLS).fill(false))
  const stack: Array<[number, number]> = []
  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      if ((y === 0 || x === 0 || y === ROWS - 1 || x === COLS - 1) && !mask[y][x]) {
        bg[y][x] = true
        stack.push([x, y])
      }
    }
  }
  while (stack.length) {
    const [x, y] = stack.pop()!
    for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]] as const) {
      const nx = x + dx
      const ny = y + dy
      if (nx >= 0 && nx < COLS && ny >= 0 && ny < ROWS && !mask[ny][nx] && !bg[ny][nx]) {
        bg[ny][nx] = true
        stack.push([nx, ny])
      }
    }
  }
  const seen: boolean[][] = Array.from({ length: ROWS }, () => Array(COLS).fill(false))
  const holes: Rect[] = []
  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      if (mask[y][x] || bg[y][x] || seen[y][x]) continue
      const cells: Array<[number, number]> = []
      const q: Array<[number, number]> = [[x, y]]
      seen[y][x] = true
      let minX = x, maxX = x, minY = y, maxY = y
      while (q.length) {
        const [cx, cy] = q.pop()!
        cells.push([cx, cy])
        minX = Math.min(minX, cx); maxX = Math.max(maxX, cx)
        minY = Math.min(minY, cy); maxY = Math.max(maxY, cy)
        for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]] as const) {
          const nx = cx + dx
          const ny = cy + dy
          if (nx >= 0 && nx < COLS && ny >= 0 && ny < ROWS && !mask[ny][nx] && !bg[ny][nx] && !seen[ny][nx]) {
            seen[ny][nx] = true
            q.push([nx, ny])
          }
        }
      }
      if (cells.length >= 8) {
        holes.push({ x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1, cx: Math.floor(cells.length > 0 ? cells.reduce((s, c) => s + c[0], 0) / cells.length : 0), cy: Math.floor(cells.reduce((s, c) => s + c[1], 0) / cells.length) })
      }
    }
  }
  return holes.sort((a, b) => b.h * b.w - a.h * a.w)
}

export const HEAD_MASK = parseMap()
export const HOLES = findInternalHoles(HEAD_MASK)

function findFeature(holes: Rect[], yMin: number, yMax: number, leftOfCx: boolean | null): Rect | null {
  let best: Rect | null = null
  for (const h of holes) {
    if (h.cy < yMin || h.cy > yMax) continue
    if (leftOfCx === true && h.cx > 39) continue
    if (leftOfCx === false && h.cx < 39) continue
    if (!best || h.w * h.h > best.w * best.h) best = h
  }
  return best
}

const eyeLeftRaw = findFeature(HOLES, 8, 22, true)
const eyeRightRaw = findFeature(HOLES, 8, 22, false)
const noseRaw = findFeature(HOLES, 20, 30, null)
const mouthRaw = findFeature(HOLES, 30, 40, null)

export const EYE_LEFT: Rect = eyeLeftRaw ?? { x: 16, y: 14, w: 12, h: 4, cx: 22, cy: 15 }
export const EYE_RIGHT: Rect = eyeRightRaw ?? { x: 52, y: 14, w: 12, h: 4, cx: 58, cy: 15 }
export const NOSE: Rect = noseRaw ?? { x: 36, y: 22, w: 8, h: 4, cx: 40, cy: 24 }
export const MOUTH: Rect = mouthRaw ?? { x: 32, y: 33, w: 16, h: 2, cx: 40, cy: 34 }

export const HEAD_CX = 39
export const HEAD_CY = 22

// Build the eye mask (cells inside the eye holes) for pupils/blink
export function buildEyeMask(): boolean[][] {
  const eyeMask: boolean[][] = Array.from({ length: ROWS }, () => Array(COLS).fill(false))
  for (const e of [EYE_LEFT, EYE_RIGHT]) {
    for (let y = e.y; y < e.y + e.h; y++) {
      for (let x = e.x; x < e.x + e.w; x++) {
        if (y >= 0 && y < ROWS && x >= 0 && x < COLS) eyeMask[y][x] = true
      }
    }
  }
  return eyeMask
}
