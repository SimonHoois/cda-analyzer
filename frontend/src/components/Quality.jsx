import { useState } from 'react'
import Icon from './Icon'

const WORD = { PASS: 'Good data', WARNING: 'Usable', FAIL: 'Needs fixing' }
const ICON = { PASS: 'ok', WARNING: 'alert', FAIL: 'bad' }

export function QualityBadge({ quality, full = false }) {
  if (!quality) return null
  return (
    <span className={`badge ${quality.overall.toLowerCase()}`} title={`Quality score ${quality.score}%`}>
      <Icon name={ICON[quality.overall]} size={12} />
      {WORD[quality.overall]}{full ? ` · ${quality.score}%` : ''}
    </span>
  )
}

/** The 11 checks as an expandable list. */
export function QualityList({ quality, onFix }) {
  const [open, setOpen] = useState({})
  return (
    <div className="qp">
      <div className="qp-h">
        <span className="h2" style={{ fontSize: '.9rem' }}>Data quality</span>
        <QualityBadge quality={quality} full />
      </div>
      {quality.checks.map((c) => {
        const ic = c.pass ? 'ok' : c.warning ? 'alert' : 'bad'
        const col = c.pass ? 'c-good' : c.warning ? 'c-warn' : 'c-bad'
        const isOpen = !!open[c.key]
        return (
          <button key={c.key} className="qrow" aria-expanded={isOpen}
            onClick={() => setOpen((o) => ({ ...o, [c.key]: !o[c.key] }))}>
            <span className="qrow-in">
              <span className={col}><Icon name={ic} size={14} /></span>
              <span>{c.label}</span>
              <span className="faint"><Icon name={isOpen ? 'up' : 'down'} size={13} /></span>
            </span>
            {isOpen && <span className="qdetail" style={{ display: 'block' }}>{c.detail}</span>}
          </button>
        )
      })}
      {quality.overall === 'FAIL' && onFix && (
        <div className="qfix">
          <span>Fix the red items before calculating CdA.</span>
          <button className="btn btn-sm" onClick={onFix}><Icon name="scissors" size={14} />Open trim editor</button>
        </div>
      )}
    </div>
  )
}
