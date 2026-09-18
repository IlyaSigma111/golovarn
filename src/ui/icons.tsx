import React from 'react'

export type IconName =
  | 'monitor' | 'monitors' | 'download' | 'refresh' | 'folder' | 'folderPlus'
  | 'trash' | 'play' | 'pause' | 'stop' | 'skipPrev' | 'skipNext'
  | 'edit' | 'plus' | 'save' | 'folderOpen' | 'skull' | 'glitch' | 'alarm'
  | 'terminal' | 'matrix' | 'shatter' | 'visualizer' | 'particles' | 'waves'
  | 'droplet' | 'reset' | 'music' | 'volume' | 'close' | 'check' | 'video'
  | 'file' | 'smile' | 'neutral' | 'angry' | 'clock' | 'sliders' | 'eye'

const P: Record<IconName, React.ReactNode> = {
  monitor: (<><rect x="2" y="4" width="20" height="14" rx="2" /><path d="M8 21h8" /><path d="M12 18v3" /></>),
  monitors: (<><rect x="2" y="3" width="14" height="10" rx="2" /><path d="M9 13v4" /><path d="M5 17h8" /><rect x="11" y="9" width="11" height="10" rx="2" /><path d="M16 19v1" /><path d="M14 20h6" /></>),
  download: (<><path d="M12 3v12" /><path d="M7 10l5 5 5-5" /><path d="M4 21h16" /></>),
  refresh: (<><path d="M21 12a9 9 0 1 1-2.8-6.5" /><path d="M21 3v5h-5" /></>),
  folder: (<path d="M3 6a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />),
  folderPlus: (<><path d="M3 6a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /><path d="M12 11v4" /><path d="M10 13h4" /></>),
  trash: (<><path d="M3 6h18" /><path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /><path d="M10 11v6" /><path d="M14 11v6" /></>),
  play: (<path d="M6 4l14 8-14 8z" />),
  pause: (<><path d="M9 5v14" /><path d="M15 5v14" /></>),
  stop: (<rect x="6" y="6" width="12" height="12" rx="1" />),
  skipPrev: (<><path d="M6 5v14" /><path d="M19 5l-10 7 10 7z" /></>),
  skipNext: (<><path d="M18 5v14" /><path d="M5 5l10 7-10 7z" /></>),
  edit: (<><path d="M4 20l1-4L15 6a2.1 2.1 0 0 1 3 3L8 19z" /><path d="M13 6l3 3" /></>),
  plus: (<><path d="M12 5v14" /><path d="M5 12h14" /></>),
  save: (<><path d="M3 5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /><path d="M8 3v5h8" /><path d="M8 21v-6h8v6" /></>),
  folderOpen: (<><path d="M2 6a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v1" /><path d="M2 9h18l-2.5 9a2 2 0 0 1-1.9 1.5H6.4A2 2 0 0 1 4.5 18z" /></>),
  skull: (<><path d="M12 3a7.5 7.5 0 0 0-7.5 7.5c0 2.2 1 4 2.3 5.2V20a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2v-4.3c1.3-1.2 2.3-3 2.3-5.2A7.5 7.5 0 0 0 12 3z" /><circle cx="9" cy="11" r="1.4" /><circle cx="15" cy="11" r="1.4" /><path d="M10 17h4" /></>),
  glitch: (<><rect x="3" y="6" width="18" height="12" rx="2" /><path d="M3 11h5l2-2 3 4 2-2h6" /></>),
  alarm: (<><path d="M18 8a6 6 0 0 0-12 0c0 7-3 8-3 8h18s-3-1-3-8" /><path d="M10.3 21a2 2 0 0 0 3.4 0" /></>),
  terminal: (<><path d="M4 6l5 5-5 5" /><path d="M12 17h8" /></>),
  matrix: (<><path d="M8 4v16" /><path d="M16 4v16" /><path d="M4 9l3-2" /><path d="M20 15l-3 2" /></>),
  shatter: (<path d="M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8z" />),
  visualizer: (<><path d="M4 20v-6" /><path d="M9 20V9" /><path d="M14 20v-11" /><path d="M19 20v-3" /></>),
  sliders: (<><path d="M4 21v-7" /><path d="M4 10V3" /><path d="M12 21v-9" /><path d="M12 8V3" /><path d="M20 21v-5" /><path d="M20 12V3" /><path d="M2 14h4" /><path d="M10 8h4" /><path d="M18 16h4" /></>),
  particles: (<><path d="M8 6l4 4-4 4" /><path d="M16 6l-4 4 4 4" /></>),
  waves: (<path d="M2 12c2-3 4-3 6 0s4 3 6 0 4-3 6 0" />),
  droplet: (<path d="M12 3s6 6 6 10a6 6 0 0 1-12 0c0-4 6-10 6-10z" />),
  reset: (<><path d="M3 12a9 9 0 1 0 2.8-6.5" /><path d="M3 3v5h5" /></>),
  music: (<><path d="M9 18V5l10-2v13" /><circle cx="6.5" cy="18" r="2.5" /><circle cx="16.5" cy="16" r="2.5" /></>),
  volume: (<><path d="M4 9v6h4l5 4V5L8 9z" /><path d="M16 8a4 4 0 0 1 0 8" /><path d="M18.5 5.5a8 8 0 0 1 0 13" /></>),
  close: (<><path d="M5 5l14 14" /><path d="M19 5L5 19" /></>),
  check: (<path d="M4 12l5 5L20 6" />),
  video: (<><rect x="2" y="5" width="15" height="14" rx="2" /><path d="M17 10l5-3v10l-5-3z" /></>),
  file: (<><path d="M6 2h8l4 4v16H6z" /><path d="M14 2v4h4" /></>),
  smile: (<><circle cx="12" cy="12" r="9" /><path d="M8 14a4 4 0 0 0 8 0" /><path d="M9 10h.01" /><path d="M15 10h.01" /></>),
  neutral: (<><circle cx="12" cy="12" r="9" /><path d="M8 15h8" /><path d="M9 10h.01" /><path d="M15 10h.01" /></>),
  angry: (<><circle cx="12" cy="12" r="9" /><path d="M8.5 7.5l-2 2" /><path d="M15.5 7.5l2 2" /><path d="M8 15h8" /></>),
  clock: (<><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>),
  eye: (<><path d="M2 12s3.5-6.5 10-6.5S22 12 22 12s-3.5 6.5-10 6.5S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></>),
}

export function Icon({ name, size = 16, className }: { name: IconName; size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {P[name]}
    </svg>
  )
}

export const EMOTION_ICONS: Record<number, IconName> = { 0: 'neutral', 1: 'smile', [-1]: 'angry' }
