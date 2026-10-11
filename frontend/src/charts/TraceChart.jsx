import { useMemo } from 'react'
import { fmtMS, niceTicks } from '../lib/format'

const W = 760, PL = 46, PR = 14, PT = 12, PB = 24

/** Speed (and optionally power) over time. Legs are coloured out/back; removed parts are shaded. */
export default function TraceChart({
  trace, start = 0, end, turns = [], legs = null, power = false, compact = false,
  label = 'Speed and power over time',
}) {
  const TT = trace?.time?.[trace.time.length - 1] || 1
  const stop = end ?? TT
  const H = power ? 330 : 150

  const panels = useMemo(() => {
    const defs = [{ key: 'speed', unit: 'km/h' }]
    if (power) defs.push({ key: 'power', unit: 'W' })
    return defs.map((d) => {
      const ticks = niceTicks(Math.max(...trace[d.key], 1), 3)
      return { ...d, ticks, max: ticks[ticks.length - 1] }
    })
  }, [trace, power])

  const bounds = useMemo(() => {
    if (legs?.length) return legs.map((l, i) => ({ a: l.t0, b: l.t1, cls: i % 2 ? 'back' : 'out' }))
    const inner = turns.filter((t) => t > start && t < stop)
    const b = [start, ...inner, stop]
    return b.slice(0, -1).map((a, i) => ({ a, b: b[i + 1], cls: i % 2 ? 'back' : 'out' }))
  }, [legs, turns, start, stop])

  const X = (t) => PL + (t / TT) * (W - PL - PR)
  const gap = 16
  const ph = (H - PT - PB - gap * (panels.length - 1)) / panels.length
  const step = compact ? 240 : 120
  const xt = []
  for (let t = 0; t <= TT; t += step) xt.push(t)

  return (
    <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label}>
      {panels.map((pn, pi) => {
        const top = PT + pi * (ph + gap)
        const Y = (v) => top + ph - (v / pn.max) * ph
        const arr = trace[pn.key]
        const pts = (a, b) => trace.time.reduce((acc, t, i) => {
          if (t >= a && t <= b) acc.push(`${X(t).toFixed(1)},${Y(arr[i]).toFixed(1)}`)
          return acc
        }, []).join(' ')
        return (
          <g key={pn.key}>
            {pn.ticks.map((v) => (
              <g key={v}>
                <line className="grid" x1={PL} x2={W - PR} y1={Y(v)} y2={Y(v)} />
                <text className="t" x={PL - 6} y={Y(v) + 3} textAnchor="end">{v}</text>
              </g>
            ))}
            <text className="t" transform={`rotate(-90 11 ${top + ph / 2})`} x="11" y={top + ph / 2 + 3} textAnchor="middle">{pn.unit}</text>
            <polyline className="ghost" points={pts(0, TT)} />
            {bounds.map((s, i) => <polyline key={i} className={`leg ${s.cls}`} points={pts(s.a, s.b)} />)}
          </g>
        )
      })}
      {start > 0 && <rect className="cut" x={X(0)} y={PT} width={X(start) - X(0)} height={H - PT - PB} />}
      {stop < TT && <rect className="cut" x={X(stop)} y={PT} width={X(TT) - X(stop)} height={H - PT - PB} />}
      {turns.map((t, i) => (
        <g key={i}>
          <line className={`turn${t <= start || t >= stop ? ' off' : ''}`} x1={X(t)} x2={X(t)} y1={PT} y2={H - PB} />
          {!compact && <text className="tl" x={X(t) + 4} y={PT + 10}>T{i + 1}</text>}
        </g>
      ))}
      {!compact && [start, stop].map((t, i) => <line key={i} className="handle" x1={X(t)} x2={X(t)} y1={PT} y2={H - PB} />)}
      {xt.map((t) => <text key={t} className="t" x={X(t)} y={H - 7} textAnchor="middle">{fmtMS(t)}</text>)}
    </svg>
  )
}
