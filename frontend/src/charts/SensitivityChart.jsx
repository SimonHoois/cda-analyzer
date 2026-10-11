import { niceTicks } from '../lib/format'

const W = 760, H = 250, PL = 50, PR = 16, PT = 12, PB = 34
const CLS = ['p4', 'p2', 'p3']

/** What happens to virtual elevation if CdA were 0.03 lower / higher. */
export default function SensitivityChart({ sensitivity }) {
  const all = sensitivity.flatMap((s) => s.legs.flatMap((l) => l.ve)).concat(0)
  const mn = Math.min(...all) - 0.05, mx = Math.max(...all) + 0.05
  const maxD = Math.max(...sensitivity[0].legs.map((l) => l.dist[l.dist.length - 1]), 1)
  const step = niceTicks(mx - mn, 5)[1] || 0.5
  const X = (d) => PL + (d / maxD) * (W - PL - PR)
  const Y = (v) => PT + ((mx - v) / (mx - mn)) * (H - PT - PB)
  const yt = []
  for (let v = Math.ceil(mn / step) * step; v <= mx + 1e-9; v += step) yt.push(+v.toFixed(3))
  const xt = niceTicks(maxD, 5)
  return (
    <>
      <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="CdA sensitivity of the virtual elevation">
        {yt.map((v) => (
          <g key={v}><line className="grid" x1={PL} x2={W - PR} y1={Y(v)} y2={Y(v)} /><text className="t" x={PL - 7} y={Y(v) + 3} textAnchor="end">{v.toFixed(1)}</text></g>
        ))}
        {xt.filter((d) => d <= maxD).map((d) => <text key={d} className="t" x={X(d)} y={H - 16} textAnchor="middle">{Math.round(d)}</text>)}
        <text className="t" x={PL + (W - PL - PR) / 2} y={H - 3} textAnchor="middle">Cumulative distance (m)</text>
        <line className="zero" x1={PL} x2={W - PR} y1={Y(0)} y2={Y(0)} />
        {sensitivity.map((s, si) => s.legs.map((l, li) => (
          <polyline key={`${si}-${li}`} className={`ve ${CLS[si]}`} points={l.dist.map((d, i) => `${X(d).toFixed(1)},${Y(l.ve[i]).toFixed(1)}`).join(' ')} />
        )))}
      </svg>
      <div className="legend">
        {sensitivity.map((s, i) => (
          <span key={i}><i style={{ borderColor: `var(--${CLS[i]})` }} />CdA {s.cda.toFixed(3)} {s.delta === 0 ? '(fitted)' : s.delta < 0 ? '(lower)' : '(higher)'}</span>
        ))}
      </div>
    </>
  )
}
