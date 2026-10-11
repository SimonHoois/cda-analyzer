import { niceTicks, sgn } from '../lib/format'

const W = 760, H = 310, PL = 50, PR = 112, PT = 14, PB = 40

/** Virtual elevation per out-and-back pair. Solid = outbound, dashed = return. */
export default function VEChart({ grid, pairs }) {
  const all = pairs.flatMap((p) => [...p.out, ...p.back]).concat(0)
  const mn = Math.min(...all) - 0.06
  const mx = Math.max(...all) + 0.06
  const stepV = niceTicks(mx - mn, 5)[1] || 0.1
  const X = (pct) => PL + (pct / 100) * (W - PL - PR)
  const Y = (v) => PT + ((mx - v) / (mx - mn)) * (H - PT - PB)
  const yt = []
  for (let v = Math.ceil(mn / stepV) * stepV; v <= mx + 1e-9; v += stepV) yt.push(+v.toFixed(4))
  const line = (arr) => arr.map((v, i) => `${X(grid[i]).toFixed(1)},${Y(v).toFixed(1)}`).join(' ')

  const labels = pairs.map((p, k) => {
    const eo = p.out[p.out.length - 1], eb = p.back[p.back.length - 1]
    return { k, y: (Y(eo) + Y(eb)) / 2, eo, eb, closure: p.closure }
  }).sort((a, b) => a.y - b.y)
  for (let i = 1; i < labels.length; i++) if (labels[i].y - labels[i - 1].y < 15) labels[i].y = labels[i - 1].y + 15

  return (
    <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Virtual elevation per pair, outbound versus return">
      {yt.map((v) => (
        <g key={v}>
          <line className="grid" x1={PL} x2={W - PR} y1={Y(v)} y2={Y(v)} />
          <text className="t" x={PL - 7} y={Y(v) + 3} textAnchor="end">{v.toFixed(1)}</text>
        </g>
      ))}
      {[0, 25, 50, 75, 100].map((p) => <text key={p} className="t" x={X(p)} y={H - 20} textAnchor="middle">{p}</text>)}
      <text className="t" x={PL + (W - PL - PR) / 2} y={H - 5} textAnchor="middle">Leg progress (%)</text>
      <text className="t" transform={`rotate(-90 12 ${PT + (H - PT - PB) / 2})`} x="12" y={PT + (H - PT - PB) / 2 + 3} textAnchor="middle">Virtual elevation (m)</text>
      <line className="zero" x1={PL} x2={W - PR} y1={Y(0)} y2={Y(0)} />
      {pairs.map((p, k) => {
        const cls = `p${(k % 4) + 1}`
        const eo = p.out[p.out.length - 1], eb = p.back[p.back.length - 1]
        return (
          <g key={k} style={{ opacity: p.used === false ? 0.22 : 1 }}>
            <polyline className={`ve ${cls}`} points={line(p.out)} />
            <polyline className={`ve dash ${cls}`} points={line(p.back)} />
            <line className="br" x1={W - PR + 4} x2={W - PR + 4} y1={Y(eo)} y2={Y(eb)} />
          </g>
        )
      })}
      {labels.map((l) => (
        <text key={l.k} className={`t p${(l.k % 4) + 1}`} x={W - PR + 12} y={l.y + 3}>P{l.k + 1}  {sgn(l.closure, 3)} m</text>
      ))}
    </svg>
  )
}
