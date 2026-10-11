import { useEffect, useState } from 'react'
import Icon from '../components/Icon'
import Stepper from '../components/Stepper'
import Accordion from '../components/Accordion'
import VEChart from '../charts/VEChart'
import SensitivityChart from '../charts/SensitivityChart'
import TrackMap from '../charts/TrackMap'
import TraceChart from '../charts/TraceChart'
import { useApp } from '../lib/ctx'
import { navigate } from '../lib/router'
import { analyzeFile, getOverview, getResult, getResultCharts, getSegment } from '../api'
import { cdaZone, fmtHMS, fmtSaving, sgn } from '../lib/format'

const ZONES = [[0.15, 0.22, '--z1'], [0.22, 0.28, '--z2'], [0.28, 0.35, '--z3'], [0.35, 0.45, '--z4']]

export default function ResultPage({ id }) {
  const { files, loaded } = useApp()
  const fileId = id || files.find((f) => f.cda != null)?.file_id
  if (!loaded) return <div className="skeleton" />
  return <ResultView key={fileId || 'none'} fileId={fileId} />
}

function ResultView({ fileId }) {
  const { files, reloadFiles, toast } = useApp()
  const [busy, setBusy] = useState(false)
  const withResult = files.filter((f) => f.cda != null)
  const [res, setRes] = useState(null)
  const [error, setError] = useState(null)
  const [charts, setCharts] = useState(null)
  const [seg, setSeg] = useState(null)

  useEffect(() => {
    if (!fileId) return undefined
    let live = true
    getResult(fileId).then((r) => live && setRes(r)).catch((e) => live && setError(e.message))
    return () => { live = false }
  }, [fileId])

  const toggle = (pair) => {
    const cur = res.excluded_pairs || []
    const next = cur.includes(pair) ? cur.filter((x) => x !== pair) : [...cur, pair].sort((a, b) => a - b)
    setBusy(true)
    analyzeFile(fileId, res.params, res.label, res.notes, next.length ? next.join(',') : 'none')
      .then((r) => { setRes(r); return getResultCharts(fileId).then(setCharts).catch(() => setCharts({ error: true })) })
      .then(() => reloadFiles())
      .catch((e) => toast(e.message))
      .finally(() => setBusy(false))
  }

  const openPairs = () => { if (!charts) getResultCharts(fileId).then(setCharts).catch(() => setCharts({ error: true })) }
  const openRoute = () => {
    if (seg) return
    Promise.all([getSegment(fileId), getOverview(fileId)]).then(([s, t]) => setSeg({ s, t })).catch(() => setSeg({ error: true }))
  }

  if (!fileId || error) {
    return (
      <>
        <Stepper current="result" hasFiles={files.length > 0} />
        <section className="page-head"><h1>CdA result</h1></section>
        <div className="card empty">
          <h2 className="h2">{error ? 'No result for this ride' : 'No result yet'}</h2>
          <p>{error || 'Calculate CdA for a ride that passed the quality check. Your result appears here.'}</p>
          <button className="btn btn-primary" onClick={() => navigate('')}><Icon name="left" size={15} />Go to Analyze</button>
        </div>
      </>
    )
  }
  if (!res) return <div className="skeleton" aria-busy="true" />

  const { cda, n_pairs: n, params: p } = res
  const total = res.n_pairs_total || n
  const excl = res.excluded_pairs || []
  const maxEx = total - Math.floor(total / 4) >= 3 ? Math.floor(total / 4) : 0
  const canToggle = (pair) => excl.includes(pair) || (excl.length + 1 <= maxEx && total - excl.length - 1 >= 3)
  const zone = cdaZone(cda)
  const lo = 0.15, hi = 0.45, pos = Math.min(1, Math.max(0, (cda - lo) / (hi - lo))) * 100
  const spread = res.cda_std != null ? res.cda_std / cda : null
  const conf = n < 2
    ? { t: 'Only one pair. Add more laps for a reliable result.', i: 'alert', c: 'c-warn', lvl: 'Low' }
    : spread < 0.02 ? { t: `The ${n} pairs agree within about ±${(spread * 100).toFixed(1)}%.`, i: 'ok', c: 'c-good', lvl: 'High' }
      : spread < 0.04 ? { t: `The ${n} pairs agree within about ±${(spread * 100).toFixed(1)}%.`, i: 'ok', c: 'c-good', lvl: 'Good' }
        : { t: `The ${n} pairs differ by about ±${(spread * 100).toFixed(1)}%. More laps or a steadier day would help.`, i: 'alert', c: 'c-warn', lvl: 'Low' }
  const pairWord = (d) => {
    const a = Math.abs(d)
    return a < 1 ? ['Matches the ride', 'c-good'] : a < 3 ? ['Slightly off', 'c-warn'] : [d > 0 ? 'Much higher than the rest' : 'Much lower than the rest', 'c-bad']
  }

  return (
    <>
      <Stepper current="result" hasFiles hasResult />
      <div className="head-row page-head">
        <div>
          <h1>CdA result</h1>
          <p className="lede" style={{ marginTop: 6 }}>{res.label ? `${res.label} · ${res.filename}` : res.filename}</p>
        </div>
        {withResult.length > 1 && (
          <div className="inp" style={{ maxWidth: 340 }}>
            <select aria-label="Show result for" value={fileId} onChange={(e) => navigate(`result/${e.target.value}`)}>
              {withResult.map((f) => <option key={f.file_id} value={f.file_id}>{f.label || f.name}</option>)}
            </select>
          </div>
        )}
      </div>

      <section className="card hero">
        <div>
          <div className="sec-title">Your CdA</div>
          <div className="cda-num" style={{ marginTop: 10 }}>{cda.toFixed(4)}</div>
          <div className="cda-unit">m²{res.cda_ci95 ? ` · 95% range ${res.cda_ci95[0].toFixed(4)} – ${res.cda_ci95[1].toFixed(4)}` : ''}</div>
          <div className={`conf ${conf.c}`}><Icon name={conf.i} size={15} /><span><b>Reliability: {conf.lvl}.</b> {conf.t}</span></div>
          <p className="hint" style={{ marginTop: 8, maxWidth: '44ch' }}>Reliability says how clean this one ride is. To know if a change made you faster, compare two rides in the Compare tab.</p>
        </div>
        <div style={{ minWidth: 0 }}>
          <div className="sec-title">Where this sits</div>
          <div className={zone.cls} style={{ fontWeight: 650, marginTop: 8 }}>{zone.label}</div>
          <div className="scale">
            <div className="scale-bar">{ZONES.map((z) => <i key={z[2]} style={{ flex: z[1] - z[0], background: `var(${z[2]})` }} />)}</div>
            <div className="scale-mark" style={{ left: `${pos.toFixed(1)}%` }} />
            <div className="scale-ticks">{[0.15, 0.22, 0.28, 0.35, 0.45].map((v) => <span key={v} style={{ left: `${((v - lo) / (hi - lo)) * 100}%` }}>{v.toFixed(2)}</span>)}</div>
          </div>
        </div>
      </section>

      <div className="stack" style={{ marginTop: 12 }}>
        <Accordion title="Pair breakdown" meta={excl.length ? `${n} of ${total} pairs used` : `${n} pair${n > 1 ? 's' : ''}`} onOpen={openPairs}>
          {!charts && <div className="skeleton" style={{ minHeight: 200 }} />}
          {charts?.error && <div className="alert"><Icon name="alert" size={16} /><span>Could not load the chart.</span></div>}
          {charts && !charts.error && (
            <>
              <p className="hint" style={{ marginBottom: 8 }}>
                Each line is the height the data says you climbed, if all your power went into speed, drag and gravity. Out and back is the same road, so
                both lines should finish at the same height. The closer they end together, the better the CdA fits.
              </p>
              <div className="chart-scroll"><VEChart grid={charts.grid} pairs={charts.pairs} /></div>
              <div className="legend">
                <span><i style={{ borderColor: 'var(--fg-2)' }} />Outbound</span><span><i className="d" style={{ borderColor: 'var(--fg-2)' }} />Return</span>
                <span>Colour = pair.</span>
              </div>
            </>
          )}
          <p className="hint" style={{ margin: '12px 0 0' }}>
            One pair = one leg out and one back. "Vs. ride" shows how far a pair's CdA is from the ride's CdA. Under 1% is a match. A pair that is far off
            usually means the wind changed, you changed position, or the road was not the same both ways. Hover a value to see the height gap in metres.
          </p>
          <div className="tbl-wrap" style={{ marginTop: 8 }}>
            <table>
              <thead><tr><th>Use</th><th>Pair</th><th>CdA</th><th>Vs. ride</th><th>Verdict</th></tr></thead>
              <tbody>
                {res.pair_breakdown.map((r, i) => {
                  const [word, cls] = pairWord(r.deviation_pct ?? 0)
                  return (
                    <tr key={r.pair} style={{ opacity: r.used === false ? 0.5 : 1 }}>
                      <td>
                        <input type="checkbox" checked={r.used !== false} disabled={busy || !canToggle(r.pair)} onChange={() => toggle(r.pair)}
                          aria-label={`Use pair ${r.pair} in the result`}
                          title={canToggle(r.pair) ? 'Leave this pair out of the result' : 'Not allowed: keep at least 3 pairs and leave out at most 1 in 4'} />
                      </td>
                      <td><i className="dot" style={{ background: `var(--p${(i % 4) + 1})` }} />Pair {r.pair}</td>
                      <td className="mono">{r.cda.toFixed(4)}</td>
                      <td className="mono faint" title={`Closure ${sgn(r.ve_closure, 3)} m`}>{sgn(r.deviation_pct ?? 0, 1)}%</td>
                      <td className={cls} style={{ fontWeight: 600, fontSize: '.8rem', whiteSpace: 'normal' }}>
                        {word}
                        {total >= 3 && Math.abs(r.odd_leg_dev_m) >= 0.02 && <div className="faint" style={{ fontWeight: 400 }}>{r.suspect ? 'Clear outlier. ' : ''}Odd leg: {r.odd_leg} ({sgn(r.odd_leg_dev_m * 100, 0)} cm)</div>}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <p className="hint" style={{ marginTop: 10, lineHeight: 1.5 }}>
            {maxEx === 0
              ? `All ${total} pairs are used. Leaving one out would remove a third of your data or more and make the result look more precise than it is. Ride more laps instead.`
              : `You may leave out up to ${maxEx} pair${maxEx > 1 ? 's' : ''}, and only with a clear cause on that leg, such as a gust, a car or a stop. Never to get a nicer number. The result then says so, and Compare mentions it.`}
            {' '}"Odd leg" shows the leg that ends furthest from the same direction in the other pairs.
          </p>
        </Accordion>

        <Accordion title="What a lower CdA is worth" meta="time savings">
          <div className="tbl-wrap">
            <table>
              <thead><tr><th>Distance</th><th>Speed</th><th>Time</th><th>−0.01</th><th>−0.02</th><th>−0.05</th></tr></thead>
              <tbody>
                {res.time_savings.map((t) => (
                  <tr key={t.distance_km}>
                    <td>{t.distance_km} km</td><td className="mono faint">{t.speed_kmh} km/h</td><td className="mono">{fmtHMS(t.time_min * 60)}</td>
                    <td className="mono c-warn">{fmtSaving(t.savings_s.delta_01)}</td>
                    <td className="mono" style={{ color: 'var(--z4)' }}>{fmtSaving(t.savings_s.delta_02)}</td>
                    <td className="mono c-bad">{fmtSaving(t.savings_s.delta_05)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="hint" style={{ marginTop: 10 }}>Flat course at 250 W, mass {p.mass} kg, Crr {p.crr}, air density {p.rho} kg/m³. Columns show the time saved if CdA were lower by that amount.</p>
        </Accordion>

        <Accordion title="Route, legs and sensitivity" meta="diagnostics" onOpen={() => { openRoute(); openPairs() }}>
          {!seg && <div className="skeleton" style={{ minHeight: 160 }} />}
          {seg && !seg.error && (
            <div style={{ display: 'grid', gap: 18 }}>
              <div>
                <div className="sec-title" style={{ marginBottom: 8 }}>Legs used in the calculation</div>
                <div className="chart-scroll"><TraceChart trace={seg.t} legs={seg.s.legs} start={seg.s.t0} end={seg.s.t1} turns={seg.s.turns} power compact={false} label="Speed and power per leg" /></div>
                <p className="hint" style={{ marginTop: 8 }}>
                  Steady speed and power on each leg make a clean test. Spikes or dips inside a leg add noise. Leg distances: {seg.s.legs.map((l) => `${(l.dist_m / 1000).toFixed(2)} km`).join(' · ')}. Shaded areas around the turnarounds are excluded.
                </p>
              </div>
              {seg.s.track && <div><div className="sec-title" style={{ marginBottom: 8 }}>GPS track</div><TrackMap track={seg.s.track} /></div>}
            </div>
          )}
          {charts && !charts.error && (
            <div style={{ marginTop: 18 }}>
              <div className="sec-title" style={{ marginBottom: 8 }}>CdA sensitivity (±0.03 m²)</div>
              <div className="chart-scroll"><SensitivityChart sensitivity={charts.sensitivity} /></div>
              <p className="hint" style={{ marginTop: 8 }}>The same legs with a lower and a higher CdA. A wrong CdA makes the lines tilt up or down, and the fitted one stays flat. This shows how sensitive your ride is to CdA.</p>
            </div>
          )}
        </Accordion>

        <Accordion title="Settings and accuracy" meta="what this number depends on">
          <div className="tbl-wrap">
            <table>
              <tbody>
                {[['Total mass', `${p.mass} kg`], ['Rolling resistance', p.crr], ['Air density', `${p.rho} kg/m³`], ['Wind', `${p.wind_ms} m/s`],
                  ['Power meter', p.drivetrain_eff < 1 ? `crank / pedals (${((1 - p.drivetrain_eff) * 100).toFixed(1)}% drivetrain loss)` : 'hub / wheel'],
                  ['Speed source', `${p.speed_source}${p.speed_scale !== 1 ? `, calibration ${p.speed_scale}` : ''}`]].map(([k, v]) => (
                    <tr key={k}><td className="muted" style={{ whiteSpace: 'normal' }}>{k}</td><td className="mono" style={{ textAlign: 'right', whiteSpace: 'normal' }}>{v}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="hint" style={{ marginTop: 10, lineHeight: 1.5 }}>
            The 95% range only reflects how well the pairs agree with each other. It does not include errors in the settings above.
            As a rule of thumb, 3% too high air density gives about 3% too low CdA, 0.001 too low Crr gives about 3% too high,
            and an unmodelled 2 m/s wind adds about 3%. For the most reliable comparisons, change only one thing between tests.
          </p>
        </Accordion>
      </div>

      <div className="foot-actions" style={{ marginTop: 20 }}>
        <span className="small muted"><Icon name="check" size={14} className="c-good" /> Saved to your history</span>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <button className="btn" onClick={() => navigate('')}><Icon name="left" size={14} />Back to rides</button>
          <button className="btn btn-primary" onClick={() => navigate('compare')}>Compare with another ride<Icon name="right" size={14} /></button>
        </div>
      </div>
    </>
  )
}
