import { useState } from 'react'

const W = 760, H = 280, PL = 56, PR = 18, PT = 14, PB = 30

/** CdA over time with ±σ bars. Hover or tap a point for details. */
export default function HistoryChart({ entries }) {
  const [hot, setHot] = useState(null)
  const n = entries.length
  const lo0 = Math.min(...entries.map((e) => e.cda - (e.cda_std || 0)))
  const hi0 = Math.max(...entries.map((e) => e.cda + (e.cda_std || 0)))
  const lo = Math.floor((lo0 - 0.004) * 50) / 50, hi = Math.ceil((hi0 + 0.004) * 50) / 50
  const X = (i) => (n === 1 ? PL + (W - PL - PR) / 2 : PL + (i * (W - PL - PR)) / (n - 1))
  const Y = (v) => PT + ((hi - v) / (hi - lo)) * (H - PT - PB)
  const steps = Math.max(1, Math.round((hi - lo) / 0.02))

  const onMove = (e) => {
    const r = e.currentTarget.getBoundingClientRect()
    const vx = ((e.clientX - r.left) / r.width) * W
    let best = 0, bd = Infinity
    for (let i = 0; i < n; i++) { const d = Math.abs(X(i) - vx); if (d < bd) { bd = d; best = i } }
    setHot(best)
  }
  const e = hot != null ? entries[hot] : null
  return (
    <div className="hist-wrap">
      <div className="chart-scroll">
        <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="CdA over time with error bars"
          onPointerMove={onMove} onPointerLeave={() => setHot(null)} onPointerDown={onMove}>
          {Array.from({ length: steps + 1 }, (_, k) => lo + k * 0.02).map((v) => (
            <g key={v}><line className="grid" x1={PL} x2={W - PR} y1={Y(v)} y2={Y(v)} /><text className="t" x={PL - 7} y={Y(v) + 3} textAnchor="end">{v.toFixed(3)}</text></g>
          ))}
          <polyline className="ln" points={entries.map((d, i) => `${X(i).toFixed(1)},${Y(d.cda).toFixed(1)}`).join(' ')} />
          {entries.map((d, i) => {
            const a = Y(d.cda + (d.cda_std || 0)), b = Y(d.cda - (d.cda_std || 0)), x = X(i)
            return (
              <g key={d.id}>
                <line className="eb" x1={x} x2={x} y1={a} y2={b} />
                <line className="eb" x1={x - 4} x2={x + 4} y1={a} y2={a} />
                <line className="eb" x1={x - 4} x2={x + 4} y1={b} y2={b} />
                <circle className={`pt${hot === i ? ' hot' : ''}`} cx={x} cy={Y(d.cda)} r="4.5" />
                <text className="t" x={x} y={H - 10} textAnchor="middle">#{i + 1}</text>
              </g>
            )
          })}
        </svg>
      </div>
      {e && (
        <div className="tip-box" style={{ left: `min(${(X(hot) / W) * 100}%, calc(100% - 240px))`, top: 18 }}>
          <b>{e.cda.toFixed(4)} ±{(e.cda_std || 0).toFixed(4)}</b>
          {e.label || e.file_name}<br />
          <span className="faint">#{hot + 1} · {e.n_pairs} pairs · quality {e.quality_score}%</span>
        </div>
      )}
    </div>
  )
}
