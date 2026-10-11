import { useEffect, useRef, useState } from 'react'
import Icon from '../components/Icon'
import { navigate } from '../lib/router'
import { clamp, lerp, smooth } from '../lib/format'

const TIPS = [
  ['Route', ['Flat, straight road', '1–2 km each way', 'Minimal traffic', 'Low crosswind']],
  ['Riding', ['Steady power, 200 W or more', 'Speed of 25 km/h or more', 'Hold the same position', '3 or more out-and-back laps']],
  ['Equipment', ['Power meter (required)', 'Speed sensor (recommended)', 'GPS head unit', 'Record at 1-second intervals']],
]

function say(g) {
  if (g.done) return 'Stop recording. Upload the .fit file.'
  const p = g.pos
  if (g.dir === 1 && p > 0.9) return 'Cone ahead, 10 m. Brake hard.'
  if (g.dir === -1 && p < 0.1) return g.lap >= 3 ? 'Cone ahead, 10 m. Stop recording.' : 'Cone ahead, 10 m. Brake hard.'
  if (!g.started && p < 0.14) return 'Start recording, then ride out.'
  if (g.started && Math.abs(p - g.turnPos) < 0.14) return 'Accelerate and get into position.'
  return 'Hold your aero position. Steady power.'
}

const fresh = () => ({ pos: 0, dir: 1, lap: 1, done: false, turnPos: 0, started: false })

function TopDown() {
  const reduce = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  const g = useRef(fresh())
  const [s, setS] = useState(fresh)
  const [playing, setPlaying] = useState(!reduce)

  useEffect(() => {
    if (!playing) return undefined
    let raf, last = performance.now()
    const step = (now) => {
      const s = g.current
      const dt = Math.min(0.05, (now - last) / 1000 || 0)
      last = now
      if (!s.done) {
        const edge = Math.min(s.pos, 1 - s.pos)
        s.pos += lerp(0.035, 0.2, smooth(clamp(edge / 0.14, 0, 1))) * dt * s.dir
        if (s.pos > 0.14) s.started = true
        if (s.dir === 1 && s.pos >= 1) { s.pos = 1; s.dir = -1; s.turnPos = 1 }
        else if (s.dir === -1 && s.pos <= 0) {
          s.pos = 0; s.turnPos = 0
          if (s.lap >= 3) { s.done = true; setPlaying(false) } else { s.lap += 1; s.dir = 1 }
        }
      }
      setS({ ...s })
      raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [playing])

  const x = 70 + s.pos * 620
  const toggle = () => {
    if (s.done) { g.current = fresh(); setS(fresh()); setPlaying(true) } else setPlaying((p) => !p)
  }
  return (
    <section className="card guide">
      <div className="guide-top">
        <div>
          <div className="say" aria-live="off">{say(s)}</div>
          <div className="small faint mono" style={{ marginTop: 2 }}>
            Lap {s.lap} of 3 · {s.done ? 'finished' : s.dir === 1 ? 'outbound' : 'return'} · {Math.round(s.pos * 1500).toLocaleString('en-US')} m
          </div>
        </div>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <span className="laps" aria-hidden="true">
            {[1, 2, 3].map((n) => <i key={n} className={n < s.lap || s.done ? 'done' : n === s.lap ? 'on' : ''} />)}
          </span>
          <button className="btn btn-sm" onClick={toggle}>
            {s.done ? <><Icon name="refresh" size={14} />Replay</> : playing ? <><Icon name="pause" size={14} />Pause</> : <><Icon name="play" size={14} />Play</>}
          </button>
        </div>
      </div>
      <div className="chart-scroll">
        <svg className="gsvg" viewBox="0 0 760 220" role="img" aria-label="Top view of a rider going out to a cone and back three times">
          <rect className="lane" x="70" y="90" width="620" height="40" rx="6" />
          <line className="mid" x1="70" x2="690" y1="110" y2="110" />
          <rect className="zone" x="70" y="90" width="50" height="40" /><rect className="zone" x="640" y="90" width="50" height="40" />
          {[70, 690].map((cx) => <g key={cx}><circle className="cone" cx={cx} cy="110" r="13" /><circle className="cone2" cx={cx} cy="110" r="4" /></g>)}
          <text x="70" y="62" textAnchor="middle">Start cone</text><text x="690" y="62" textAnchor="middle">Turn cone</text>
          <text x="95" y="152" textAnchor="middle">Brake zone</text><text x="665" y="152" textAnchor="middle">Brake zone</text>
          <text x="70" y="180" textAnchor="middle">0 m</text><text x="690" y="180" textAnchor="middle">1,500 m</text>
          <g transform={`translate(${x.toFixed(1)} 110)`}><g transform={`scale(${s.dir === 1 ? 1 : -1} 1)`}>
            <rect className="rider" x="-20" y="-6" width="34" height="12" rx="6" /><path className="rider" d="M12 -9 L26 0 L12 9Z" />
          </g></g>
        </svg>
      </div>
    </section>
  )
}

export default function GuidePage() {
  return (
    <>
      <section className="page-head">
        <h1>How to ride a CdA test</h1>
        <p className="lede">Ride three out-and-back laps on a flat, straight road. Brake only at the cones, hold steady power, and keep the same position the whole time.</p>
      </section>
      <TopDown />
      <div className="tips" style={{ marginTop: 16 }}>
        {TIPS.map(([title, items]) => (
          <div className="card tip" key={title}><h3>{title}</h3><ul>{items.map((i) => <li key={i}>{i}</li>)}</ul></div>
        ))}
      </div>
      <section className="card why" style={{ marginTop: 16 }}>
        <h2 className="h2">Why out and back works</h2>
        <p>Wind and slope push you one way going out and the opposite way coming back. Averaging both legs cancels most of it. At the right CdA, the virtual elevation of both legs ends at the same height, which is what the closure check measures. Wind does not cancel completely, so a calm day still gives the most reliable result.</p>
      </section>
      <div style={{ marginTop: 18 }}><button className="btn btn-primary" onClick={() => navigate('')}>Go to Analyze<Icon name="right" size={14} /></button></div>
    </>
  )
}
