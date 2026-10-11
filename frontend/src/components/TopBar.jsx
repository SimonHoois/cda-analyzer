import { useState } from 'react'
import Icon from './Icon'
import { navigate } from '../lib/router'

const TABS = [['analyze', 'Analyze', ''], ['compare', 'Compare', 'compare'], ['history', 'History', 'history'], ['guide', 'How to test', 'guide']]

export default function TopBar({ route }) {
  const [dark, setDark] = useState(() => {
    const t = document.documentElement.getAttribute('data-theme')
    return t ? t === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches
  })
  const flip = () => {
    const next = dark ? 'light' : 'dark'
    document.documentElement.setAttribute('data-theme', next)
    try { localStorage.setItem('cda.theme', next) } catch { /* ignore */ }
    setDark(!dark)
  }
  const active = ['compare', 'history', 'guide'].includes(route) ? route : 'analyze'
  return (
    <header className="top">
      <div className="top-in">
        <button className="brand" onClick={() => navigate('')} aria-label="CdA Lab home">
          <span className="mark"><Icon name="wind" size={18} /></span>CdA Lab
        </button>
        <nav className="tabs" aria-label="Main">
          {TABS.map(([id, label, path]) => (
            <button key={id} className="tab" aria-current={active === id ? 'page' : undefined} onClick={() => navigate(path)}>{label}</button>
          ))}
        </nav>
        <button className="icon-btn theme-btn" onClick={flip} aria-label={dark ? 'Switch to light theme' : 'Switch to dark theme'}>
          <Icon name={dark ? 'sun' : 'moon'} size={17} />
        </button>
      </div>
    </header>
  )
}
