import { useEffect, useState } from 'react'
import Icon from '../components/Icon'
import Accordion from '../components/Accordion'
import { useApp } from '../lib/ctx'
import { navigate } from '../lib/router'
import { compareFiles } from '../api'
import { fmtHMS, fmtSaving, sgn } from '../lib/format'

const name = (f) => f.label || f.name

function Slot({ tag, ride, onDropId, onClear, other }) {
  const [over, setOver] = useState(false)
  return (
    <div
      className={`slot${over ? ' over' : ''}${ride ? ' filled' : ''}`}
      onDragOver={(e) => { e.preventDefault(); setOver(true) }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); const id = e.dataTransfer.getData('text/plain'); if (id) onDropId(id) }}
      aria-label={`Slot ${tag}`}
    >
      <span className={`slot-tag t${tag}`}>{tag}</span>
      {ride ? (
        <div className="slot-body">
          <div className="slot-name" title={ride.name}>{name(ride)}</div>
          <div className="slot-cda"><b>{ride.cda.toFixed(4)}</b> <span>m²</span></div>
          <div className="small faint">{ride.n_pairs ? `${ride.n_pairs} pair${ride.n_pairs > 1 ? 's' : ''}` : ''}{ride.avg_speed_kmh ? ` · ${ride.avg_speed_kmh.toFixed(0)} km/h` : ''}{ride.avg_power_w ? ` · ${Math.round(ride.avg_power_w)} W` : ''}</div>
          <button className="icon-btn slot-x" onClick={onClear} aria-label={`Remove ride from ${tag}`}><Icon name="close" size={15} /></button>
        </div>
      ) : (
        <div className="slot-empty">Drag a ride here{other ? '' : ''}</div>
      )}
    </div>
  )
}

function RangeBar({ ci, diff }) {
  const m = Math.max(Math.abs(ci[0]), Math.abs(ci[1]), Math.abs(diff)) * 1.25 || 0.01
  const x = (v) => `${((v + m) / (2 * m)) * 100}%`
  const lo = Math.min(ci[0], ci[1]), hi = Math.max(ci[0], ci[1])
  return (
    <div className="rb" role="img" aria-label="Range of the difference in CdA compared with zero">
      <div className="rb-track">
        <i className="rb-zero" style={{ left: '50%' }} />
        <i className="rb-ci" style={{ left: x(lo), width: `calc(${x(hi)} - ${x(lo)})` }} />
        <i className="rb-dot" style={{ left: x(diff) }} />
      </div>
      <div className="rb-lbl"><span>B has less drag</span><span>no difference</span><span>A has less drag</span></div>
    </div>
  )
}

export default function ComparePage() {
  const { files, params, loaded } = useApp()
  const rs = files.filter((f) => f.cda != null)
  const [a, setA] = useState(null)
  const [b, setB] = useState(null)
  const [power, setPower] = useState(250)
  const [out, setOut] = useState(null)
  const [error, setError] = useState(null)

  const A = rs.find((f) => f.file_id === a)
  const B = rs.find((f) => f.file_id === b)
  const aId = A?.file_id, bId = B?.file_id

  useEffect(() => {
    if (!aId || !bId || !(power >= 50)) return undefined
    let live = true
    const t = setTimeout(() => {
      compareFiles(aId, bId, params, power)
        .then((r) => { if (live) { setOut(r); setError(null) } })
        .catch((e) => { if (live) { setOut(null); setError(e.message) } })
    }, 200)
    return () => { live = false; clearTimeout(t) }
  }, [aId, bId, power, params])

  const put = (slot, id) => {
    if (!rs.find((f) => f.file_id === id)) return
    if (slot === 'A') { if (id === b) setB(a); setA(id) } else { if (id === a) setA(b); setB(id) }
  }
  const quick = (id) => { if (!A) put('A', id); else if (!B) put('B', id); else put('B', id) }

  if (!loaded) return <div className="skeleton" />
  if (rs.length < 2) {
    return (
      <>
        <section className="page-head"><h1>Compare</h1><p className="lede">Find out which setup or position is faster.</p></section>
        <div className="card empty">
          <h2 className="h2">You need two calculated rides</h2>
          <p>Calculate CdA for at least two rides, for example one on the hoods and one on the extensions. Then drag them here to see which one is faster.</p>
          <button className="btn btn-primary" onClick={() => navigate('')}><Icon name="left" size={15} />Go to Analyze</button>
        </div>
      </>
    )
  }

  const v = out?.verdict
  const lead = v ? (v.faster || v.leans) : null
  const leadRide = out && (lead === 'A' ? out.file_a : out.file_b)
  const otherRide = out && (lead === 'A' ? out.file_b : out.file_a)
  const secPerCda = out && Math.abs(out.delta_cda_cm2) > 0 ? Math.abs(out.delta_s) / (Math.abs(out.delta_cda_cm2) / 10000) : null
  const levelText = { very_likely: 'Very likely', probably: 'Probably', unclear: 'Too close to call' }
  const cls = !v ? '' : v.level === 'very_likely' ? 'good' : v.level === 'probably' ? 'ok' : 'neutral'
  const lab = (f) => (f.label || f.name)

  return (
    <>
      <section className="page-head">
        <h1>Compare</h1>
        <p className="lede">Drag two rides into A and B. You get a plain answer on which one is faster, and how sure we are.</p>
      </section>

      <div className="slots">
        <Slot tag="A" ride={A} onDropId={(id) => put('A', id)} onClear={() => setA(null)} />
        <button className="swap btn btn-sm btn-quiet" disabled={!A && !B} onClick={() => { setA(b); setB(a) }} aria-label="Swap A and B"><Icon name="compare" size={14} /></button>
        <Slot tag="B" ride={B} onDropId={(id) => put('B', id)} onClear={() => setB(null)} />
      </div>

      <section className="tray" aria-label="Rides with a calculated CdA">
        <div className="sec-title" style={{ marginBottom: 8 }}>Your rides · drag, or use the A / B buttons</div>
        <div className="tray-list">
          {rs.map((f) => {
            const tag = f.file_id === aId ? 'A' : f.file_id === bId ? 'B' : null
            return (
              <div key={f.file_id} className={`chip${tag ? ' used' : ''}`} draggable
                onDragStart={(e) => { e.dataTransfer.setData('text/plain', f.file_id); e.dataTransfer.effectAllowed = 'move' }}>
                <div className="chip-main">
                  <div className="chip-name" title={f.name}>{name(f)}</div>
                  <div className="small faint">{f.label ? `${f.name.length > 26 ? `${f.name.slice(0, 24)}…` : f.name} · ` : ''}CdA <b className="mono" style={{ color: 'var(--fg)' }}>{f.cda.toFixed(4)}</b></div>
                </div>
                <div className="chip-btns">
                  <button className={`btn btn-sm${tag === 'A' ? ' btn-primary' : ''}`} onClick={() => put('A', f.file_id)} aria-pressed={tag === 'A'}>A</button>
                  <button className={`btn btn-sm${tag === 'B' ? ' btn-primary' : ''}`} onClick={() => put('B', f.file_id)} aria-pressed={tag === 'B'}>B</button>
                </div>
              </div>
            )
          })}
        </div>
        {!A && !B && <p className="hint" style={{ marginTop: 10 }}>Tip: tap a ride's A or B button on a phone.</p>}
        {(A || B) && !(A && B) && <button className="btn btn-sm btn-quiet" style={{ marginTop: 8 }} onClick={() => { const f = rs.find((x) => x.file_id !== aId && x.file_id !== bId); if (f) quick(f.file_id) }}>Fill the empty slot with the next ride</button>}
      </section>

      {error && <div className="alert" role="alert" style={{ marginTop: 16 }}><Icon name="alert" size={16} /><span>{error}</span></div>}

      {v && (
        <>
          <section className={`card verdict-card ${cls}`} style={{ marginTop: 16 }} aria-live="polite">
            <div className="vc-top">
              <span className={`badge ${v.level === 'unclear' ? 'warning' : 'pass'}`}><Icon name={v.level === 'unclear' ? 'alert' : 'check'} size={12} />{levelText[v.level]}</span>
            </div>
            <h2 className="vc-head">
              {v.level === 'unclear'
                ? <>Can't tell A and B apart</>
                : <><span className={`slot-tag t${lead}`}>{lead}</span> is {v.level === 'probably' ? 'probably ' : ''}faster than <span className={`slot-tag t${lead === 'A' ? 'B' : 'A'}`}>{lead === 'A' ? 'B' : 'A'}</span></>}
            </h2>
            <p className="vc-sub">
              {v.level === 'unclear' ? (
                <>The gap of {Math.abs(out.delta_cda_cm2).toFixed(1)} cm² is smaller than what these two rides can reliably show. {lead && <>If anything, <b>{lab(leadRide)}</b> looks slightly better.</>}</>
              ) : (
                <><b>{lab(leadRide)}</b> has {Math.abs(v.diff_pct).toFixed(1)}% less drag than <b>{lab(otherRide)}</b> ({Math.abs(out.delta_cda_cm2).toFixed(1)} cm² lower). Over 40 km at {out.ref_power} W that is about <b>{fmtSaving(Math.abs(out.delta_s))}</b> faster.</>
              )}
            </p>

            <div className="vc-meter">
              <div className="sec-title">How sure are we?</div>
              <RangeBar ci={v.diff_ci95} diff={v.diff_cda} />
              <p className="hint">
                The dot is the measured gap, the bar is where the true gap very likely lies (95%). {v.diff_ci95[0] * v.diff_ci95[1] > 0
                  ? 'The bar stays on one side of the centre line, so the winner is clear.'
                  : v.level === 'probably'
                    ? 'The bar still crosses the centre line, so it is likely but not certain.'
                    : 'The bar crosses the centre line, so the true winner could be either.'}
              </p>
              <p className="hint">
                With these two rides, only gaps larger than about <b>{(v.detectable_cda * 10000).toFixed(0)} cm²</b>
                {secPerCda ? <> (about {fmtSaving(v.detectable_cda * secPerCda)} over 40 km)</> : null} can be shown reliably.
                {v.level === 'unclear' ? ' To see smaller differences, ride more laps or repeat each setup.' : ''}
              </p>
            </div>
          </section>

          {v.warnings.length > 0 && (
            <section className="card pad" style={{ marginTop: 12 }}>
              <div className="sec-title" style={{ marginBottom: 8 }}>Things that could affect this comparison</div>
              <ul className="warns">
                {v.warnings.map((w, i) => <li key={`${w.key}${i}`}><span className="c-warn"><Icon name="alert" size={14} /></span><span>{w.text}</span></li>)}
              </ul>
            </section>
          )}
          {v.warnings.length === 0 && (
            <p className="small muted" style={{ marginTop: 12 }}><Icon name="ok" size={14} className="c-good" /> The two rides were measured under similar conditions and settings.</p>
          )}

          <div className="stack" style={{ marginTop: 12 }}>
            <Accordion title="Numbers behind this" meta="advanced">
              <div className="deltas">
                <div><span>CdA A</span><b>{out.file_a.cda.toFixed(4)}</b></div>
                <div><span>CdA B</span><b>{out.file_b.cda.toFixed(4)}</b></div>
                <div><span>B minus A</span><b>{sgn(out.delta_cda_cm2, 1)} cm²</b></div>
              </div>
              <p className="hint" style={{ marginTop: 10 }}>
                95% range of the gap: {(v.diff_ci95[0] * 10000).toFixed(1)} to {(v.diff_ci95[1] * 10000).toFixed(1)} cm². Chance that the ride with the lower CdA is really the faster one: {(v.probability * 100).toFixed(0)}%.
                The range combines how much the pairs within each ride disagree, plus an allowance of 0.003 m² per ride for changes the pairs can't show (wind, temperature, rider).
              </p>
              <div className="field" style={{ maxWidth: 220, marginTop: 14 }}>
                <label htmlFor="cp">Reference power for the time estimate</label>
                <div className="inp has-u"><input id="cp" type="number" step="10" min="100" max="600" value={power} onChange={(e) => setPower(parseFloat(e.target.value) || 0)} /><span className="u">W</span></div>
              </div>
              <div className="tbl-wrap" style={{ marginTop: 12 }}>
                <table>
                  <thead><tr><th>Power</th><th>A, 40 km</th><th>B, 40 km</th><th>B minus A</th></tr></thead>
                  <tbody>
                    {out.by_power.map((r) => (
                      <tr key={r.power}><td className="mono">{r.power} W</td><td className="mono">{fmtHMS(r.time_a_s)}</td><td className="mono">{fmtHMS(r.time_b_s)}</td><td className={`mono ${r.delta_s < 0 ? 'c-good' : 'c-bad'}`}>{sgn(r.delta_s, 0)} s</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="hint" style={{ marginTop: 10 }}>Flat 40 km course, mass {params.mass} kg, Crr {params.crr}, air density {params.rho} kg/m³.</p>
            </Accordion>
          </div>
        </>
      )}
      {!v && !error && <div className="card empty" style={{ marginTop: 16 }}><p style={{ margin: 0 }}>Put a ride in both A and B to see the verdict.</p></div>}
    </>
  )
}
