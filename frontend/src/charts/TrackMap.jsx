const W = 380, H = 260, P = 18

/** GPS track coloured by leg. Equal-aspect projection so loops look like loops. */
export default function TrackMap({ track }) {
  const lat0 = track.lat.reduce((a, b) => a + b, 0) / track.lat.length
  const k = Math.cos((lat0 * Math.PI) / 180)
  const xs = track.lon.map((l) => l * k), ys = track.lat
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys)
  const span = Math.max(x1 - x0, y1 - y0, 1e-6)
  const sc = Math.min((W - 2 * P) / span, (H - 2 * P) / span)
  const px = (x) => P + (x - x0) * sc + ((W - 2 * P) - (x1 - x0) * sc) / 2
  const py = (y) => H - P - (y - y0) * sc - ((H - 2 * P) - (y1 - y0) * sc) / 2
  const runs = []
  let cur = null
  track.dir.forEach((d, i) => {
    if (!cur || cur.d !== d) { cur = { d, pts: [] }; runs.push(cur); if (i > 0) cur.pts.push(i - 1) }
    cur.pts.push(i)
  })
  const cls = { o: 'out', b: 'back', t: 'turnrun' }
  return (
    <svg className="chart" style={{ minWidth: 0, maxWidth: 420 }} viewBox={`0 0 ${W} ${H}`} role="img" aria-label="GPS track, outbound and return legs">
      {runs.map((r, i) => (
        <polyline key={i} className={`leg ${cls[r.d]}`} style={r.d === 't' ? { stroke: 'var(--bad)' } : undefined}
          points={r.pts.map((j) => `${px(xs[j]).toFixed(1)},${py(ys[j]).toFixed(1)}`).join(' ')} />
      ))}
      {track.turns.map(([la, lo], i) => <circle key={i} cx={px(lo * k)} cy={py(la)} r="4" fill="var(--warn)" />)}
      <circle cx={px(xs[0])} cy={py(ys[0])} r="4.5" fill="var(--bg)" stroke="var(--fg)" strokeWidth="2" />
    </svg>
  )
}
