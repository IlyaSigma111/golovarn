import React from 'react'
import { createRoot } from 'react-dom/client'
import { MainPanel } from './pages/MainPanel'
import { VizPage } from './pages/VizPage'
import './styles.css'

function App() {
  const hash = window.location.hash.replace(/^#/, '')
  if (hash === 'viz') return <VizPage />
  return <MainPanel />
}

createRoot(document.getElementById('root')!).render(<App />)
