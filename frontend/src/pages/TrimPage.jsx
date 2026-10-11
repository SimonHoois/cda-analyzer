import { useEffect, useMemo, useState } from 'react'
import Icon from '../components/Icon'
import Stepper from '../components/Stepper'
import TraceChart from '../charts/TraceChart'
import { QualityBadge } from '../components/Quality'
import { useApp } from '../lib/ctx'
import { navigate } from '../lib/router'
import { applyTrim, getTrim } from '../api'
import { clamp } from '../lib/format'

export default function TrimPage({ id }) {
  const { files, loaded } = useApp()
  const fileId = id || files[0]?.file_id
  if (!loaded) return <div className="skeleton" />
  return <TrimEditor key={fileId || 'none'} fileId={fileId} />
}

function TrimEditor({ fileId }) {
  const { params, files, reloadFiles, toast } = useApp()
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [start, setStart] = useState(0)
  const [end, setEnd] = useState(0)
  const [turns, setTurns] = useState([])
  const [edited, setEdited] = useState(false)
  const [manual, setManual] = useState(false)
  const [busy, setBusy] = useState(false)
  const [applied, setApplied] = useState(null)
  const [newTurn, setNewTurn] = useState('')

  useEffect(() => {
    if (!fileId) return undefined
    let live = true
    getTrim(fileId, params)
      .then((d) => {
        if (!live) return
        setData(d); setStart(d.crop_start); setEnd(d.crop_end); setTurns(d.turn_times_s); setManual(d.is_manual)
      })
      .catch((e) => live && setError(e.message))
    return () => { live = false }
    // params are only read once per ride; changing them later is applied by Apply
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fileId])

  const live = useMemo(() => {
    if (!data) return null
    const { time, speed, power } = data.trace
    let n = 0, sv = 0, sp = 0
    time.forEach((t, i) => { if (t >= start && t <= end) { n += 1; sv += speed[i]; sp += power[i] } })
    const inner = turns.filter((t) => t > start && t < end).length
    return { speed: n ? sv / n : 0, power: n ? sp / n : 0, legs: inner + 1, pairs: Math.floor((inner + 1) / 2) }
  }, [data, start, end, turns])

  if (!fileId) {
    return (
      <>
        <Stepper current="trim" />
        <section className="page-head"><h1>Trim and turnarounds</h1></section>
        <div className="card empty"><h2 className="h2">Pick a ride first</h2><p>Add a .fit file on the Analyze page, then open the trim editor from the ride's details.</p>
          <button className="btn btn-primary" onClick={() => navigate('')}><Icon name="left" size={15} />Go to Analyze</button></div>
      </>
    )
  }
  if (error) {
    return (
      <>
        <Stepper current="trim" hasFiles />
        <div className="alert" role="alert"><Icon name="alert" size={16} /><span>{error}</span></div>
        <div style={{ marginTop: 16 }}><button className="btn" onClick={() => navigate('')}><Icon name="left" size={14} />Back to rides</button></div>
      </>
    )
  }
  if (!data) return <div className="skeleton" aria-busy="true" />

  const total = data.total_time_s
  const file = files.find((f) => f.file_id === fileId)
  const setT = (i, v) => { setTurns((t) => t.map((x, j) => (j === i ? clamp(v, 0, total) : x))); setEdited(true); setManual(true); setApplied(null) }
  const preset = (s, e) => { setStart(s); setEnd(e); setApplied(null) }

  const run = async (opts) => {
    setBusy(true); setError(null)
    try {
      const r = await applyTrim(fileId, params, { cropStart: start, cropEnd: end, ...opts })
      setApplied(r); setTurns(r.turn_times_s); setManual(r.is_manual); setEdited(false)
      reloadFiles()
      return r
    } catch (e) { toast(e.message) } finally { setBusy(false) }
    return null
  }
  const apply = async () => { if (await run({ turnTimes: edited ? turns : undefined })) toast('Trim applied. CdA was reset for this ride.') }
  const reset = async () => { if (await run({ resetTurns: true })) toast('Turnarounds reset to auto-detected.') }
  const addTurn = () => {
    const v = parseFloat(newTurn)
    if (Number.isNaN(v) || v < 0 || v > total) { toast(`Enter a time between 0 and ${Math.round(total)} s.`); return }
    setTurns((t) => [...t, v].sort((a, b) => a - b)); setNewTurn(''); setEdited(true); setManual(true); setApplied(null)
  }

  return (
    <>
      <Stepper current="trim" hasFiles hasTrim={!!applied} />
      <div className="head-row page-head">
        <div>
          <h1>Trim and turnarounds</h1>
          <p className="lede" style={{ marginTop: 6 }}>Cut warm-up and cool-down from the ends and check that every turnaround is where you reversed. CdA resets after a change, so recalculate afterwards.</p>
        </div>
        {files.length > 1 && (
          <div className="inp" style={{ maxWidth: 320 }}>
            <select aria-label="Ride to edit" value={fileId} onChange={(e) => navigate(`trim/${e.target.value}`)}>
              {files.map((f) => <option key={f.file_id} value={f.file_id}>{f.name}</option>)}
            </select>
          </div>
        )}
      </div>

      <section className="card pad">
        <div className="head-row" style={{ alignItems: 'center', marginBottom: 12 }}>
          <h2 className="h2">1. Choose the section to keep</h2>
          {file && <span className="badge info">{file.name.length > 34 ? `${file.name.slice(0, 32)}…` : file.name}</span>}
        </div>
        <div className="chips">
          <button className="btn btn-sm" onClick={() => preset(Math.min(30, end - 30), end)}>Trim 30 s from start</button>
          <button className="btn btn-sm" onClick={() => preset(start, Math.max(total - 30, start + 30))}>Trim 30 s from end</button>
          <button className="btn btn-sm" onClick={() => preset(60, total - 60)}>Trim 60 s both ends</button>
          <button className="btn btn-sm btn-quiet" onClick={() => preset(0, total)}>Reset to full</button>
        </div>
        <div className="chart-scroll"><TraceChart trace={data.trace} start={start} end={end} turns={turns} power label="Speed and power with crop range and turnarounds" /></div>
        <div className="legend"><span><i className="out" />Outbound leg</span><span><i className="back" />Return leg</span><span><i className="tk" />Turnaround</span><span><i className="cutk" />Removed</span></div>
        <div className="sliders">
          <div>
            <label htmlFor="rs"><span>Start: remove first</span><b className="mono c-bad">{start.toFixed(1)} s</b></label>
            <input id="rs" type="range" min="0" max={total} step="0.5" value={start} onChange={(e) => { setStart(clamp(+e.target.value, 0, end - 30)); setApplied(null) }} />
          </div>
          <div>
            <label htmlFor="re"><span>End: remove last</span><b className="mono c-bad">{(total - end).toFixed(1)} s</b></label>
            <input id="re" type="range" min="0" max={total} step="0.5" value={end} onChange={(e) => { setEnd(clamp(+e.target.value, start + 30, total)); setApplied(null) }} />
          </div>
        </div>
        <div className="trim-stats">
          <div className="stat"><b style={{ color: 'var(--accent)' }}>{Math.round(end - start)} s</b><span>Keeping {Math.round(((end - start) / total) * 100)}%</span></div>
          <div className="stat"><b>{live.speed.toFixed(1)} km/h</b><span>Average speed</span></div>
          <div className="stat"><b>{Math.round(live.power)} W</b><span>Average power</span></div>
          <div className="stat"><b>{live.legs} legs · {live.pairs} pair{live.pairs !== 1 ? 's' : ''}</b><span>After trimming</span></div>
        </div>
      </section>

      <section className="card pad" style={{ marginTop: 16, display: 'grid', gap: 14 }}>
        <div className="head-row" style={{ alignItems: 'center' }}>
          <h2 className="h2">2. Check the turnarounds</h2>
          <span className={`badge ${manual ? 'manual' : 'auto'}`}>{manual ? 'Manual' : 'Auto-detected'}</span>
        </div>
        <p className="small muted" style={{ maxWidth: '70ch' }}>Turnarounds are found from the GPS heading or from speed drops. Adjust a time, add a missing one, or remove a false one. Legs alternate outbound and return, and two legs make one pair.</p>
        <LegStrip start={start} end={end} turns={turns} />
        <div style={{ display: 'grid', gap: 8 }}>
          {turns.length === 0 && (
            <div className="note" style={{ background: 'var(--warn-soft)' }}><span className="c-warn"><Icon name="alert" size={16} /></span><span>No turnarounds detected. Add one for each time you reversed direction, then apply.</span></div>
          )}
          {turns.map((t, i) => (
            <div className="turn-row" key={i}>
              <span className="tn">T{i + 1}</span>
              <div className="inp has-u"><input type="number" step="0.5" min="0" max={total} value={t} aria-label={`Turnaround ${i + 1} time in seconds`} onChange={(e) => setT(i, parseFloat(e.target.value) || 0)} /><span className="u">s</span></div>
              <span className="small faint mono">{(t / 60).toFixed(1)} min</span>
              <button className="icon-btn danger" aria-label={`Remove turnaround ${i + 1}`} onClick={() => { setTurns((x) => x.filter((_, j) => j !== i)); setEdited(true); setManual(true); setApplied(null) }}><Icon name="trash" size={15} /></button>
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <div className="inp" style={{ flex: '1 1 200px', minWidth: 0 }}>
            <input type="number" step="0.5" min="0" max={total} placeholder={`New turnaround time, 0 to ${Math.round(total)} s`} aria-label="New turnaround time in seconds"
              value={newTurn} onChange={(e) => setNewTurn(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') addTurn() }} />
          </div>
          <button className="btn" onClick={addTurn}><Icon name="plus" size={14} />Add</button>
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', justifyContent: 'space-between' }}>
          <button className="btn" onClick={reset} disabled={busy}><Icon name="refresh" size={14} />Reset to auto</button>
          <button className="btn btn-primary" onClick={apply} disabled={busy || turns.length === 0}>
            <Icon name={busy ? 'loader' : 'check'} size={15} />Apply trim and turnarounds
          </button>
        </div>
        {applied && (
          <div className={`result-bar ${applied.quality.overall.toLowerCase()}`} role="status">
            <span>Applied. {applied.n_legs} legs, {applied.n_pairs} pair{applied.n_pairs !== 1 ? 's' : ''}.</span>
            <QualityBadge quality={applied.quality} full />
            {applied.quality.overall !== 'FAIL'
              ? <button className="btn btn-sm btn-primary" style={{ marginLeft: 'auto' }} onClick={() => navigate('')}>Continue to calculate CdA<Icon name="right" size={14} /></button>
              : <span style={{ marginLeft: 'auto' }} className="small">Still failing. Check the red items on the ride's details.</span>}
          </div>
        )}
        {file && !applied && <div className="small muted">Current quality: <QualityBadge quality={file.quality} full /></div>}
      </section>
    </>
  )
}

function LegStrip({ start, end, turns }) {
  const b = [start, ...turns.filter((t) => t > start && t < end), end]
  const dur = end - start || 1
  return (
    <div className="legstrip" aria-hidden="true">
      {b.slice(0, -1).map((a, i) => {
        const w = ((b[i + 1] - a) / dur) * 100
        return <div key={i} className={i % 2 ? 'b' : 'o'} style={{ flex: w.toFixed(2) }}>{w > 7 ? `${i % 2 ? 'R' : 'O'}${Math.floor(i / 2) + 1}` : ''}</div>
      })}
    </div>
  )
}
