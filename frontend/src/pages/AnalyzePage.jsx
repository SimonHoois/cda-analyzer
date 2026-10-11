import { useCallback, useRef, useState } from 'react'
import Icon from '../components/Icon'
import Stepper from '../components/Stepper'
import ParamsPanel from '../components/ParamsPanel'
import TraceChart from '../charts/TraceChart'
import { QualityBadge, QualityList } from '../components/Quality'
import { firstProblem } from '../lib/quality'
import { useApp } from '../lib/ctx'
import { navigate } from '../lib/router'
import { analyzeFile, clearFiles, deleteFile, getOverview, recalculateFile, uploadFile } from '../api'

export default function AnalyzePage() {
  const { params, setParams, files, setFiles, reloadFiles, toast, loaded } = useApp()
  const [uploading, setUploading] = useState(false)
  const [errors, setErrors] = useState([])
  const [expanded, setExpanded] = useState(null)
  const [busy, setBusy] = useState({})
  const [drafts, setDrafts] = useState({})
  const [traces, setTraces] = useState({})
  const [over, setOver] = useState(false)
  const [confirmClear, setConfirmClear] = useState(false)
  const [recalcing, setRecalcing] = useState(false)
  const inputRef = useRef(null)

  const addError = (msg) => setErrors((e) => [...e, msg].slice(-4))

  const handleFiles = useCallback(async (list) => {
    const fits = Array.from(list).filter((f) => /\.fit$/i.test(f.name))
    if (!fits.length) { addError('Please choose .fit files.'); return }
    setUploading(true)
    for (const f of fits) {
      try {
        const rec = await uploadFile(f, params)
        setFiles((prev) => [...prev, rec])
      } catch (e) {
        addError(`${f.name}: ${e.message}`)
      }
    }
    setUploading(false)
  }, [params, setFiles])

  const analyze = async (f) => {
    setBusy((b) => ({ ...b, [f.file_id]: true }))
    try {
      const d = drafts[f.file_id] || {}
      await analyzeFile(f.file_id, params, d.label || f.label || '', d.notes || f.notes || '')
      await reloadFiles()
      navigate(`result/${f.file_id}`)
    } catch (e) {
      addError(`${f.name}: ${e.message}`)
      reloadFiles()
    } finally {
      setBusy((b) => ({ ...b, [f.file_id]: false }))
    }
  }

  const remove = async (f) => {
    try { await deleteFile(f.file_id) } catch { /* already gone */ }
    setFiles((prev) => prev.filter((x) => x.file_id !== f.file_id))
    if (expanded === f.file_id) setExpanded(null)
  }

  const recalcAll = async () => {
    setRecalcing(true)
    const next = []
    for (const f of files) {
      try { next.push(await recalculateFile(f.file_id, params)) } catch { next.push(f) }
    }
    setFiles(next)
    setRecalcing(false)
    toast('Recalculated with your current settings.')
  }

  const toggle = async (f) => {
    const open = expanded === f.file_id ? null : f.file_id
    setExpanded(open)
    if (open && !traces[open]) {
      try { const t = await getOverview(open); setTraces((x) => ({ ...x, [open]: t })) } catch { /* chart is optional */ }
    }
  }

  // suggestions taken from the most recent upload that has the data
  const withTemp = [...files].reverse().find((f) => f.suggested_rho)
  const withCal = [...files].reverse().find((f) => f.speed_calibration)
  const hints = {
    rho: withTemp ? { value: withTemp.suggested_rho, temp: withTemp.temp_c } : null,
    scale: withCal ? withCal.speed_calibration.ratio : null,
  }

  const nFail = files.filter((f) => f.quality?.overall === 'FAIL').length
  const nRes = files.filter((f) => f.cda != null).length
  const dropProps = {
    onDragOver: (e) => { e.preventDefault(); setOver(true) },
    onDragLeave: () => setOver(false),
    onDrop: (e) => { e.preventDefault(); setOver(false); handleFiles(e.dataTransfer.files) },
    onClick: (e) => { if (e.target.type !== 'file') inputRef.current?.click() },
    onKeyDown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); inputRef.current?.click() } },
  }
  const input = <input ref={inputRef} type="file" accept=".fit" multiple hidden onChange={(e) => { handleFiles(e.target.files); e.target.value = '' }} />
  const alerts = errors.length > 0 && (
    <div className="stack">
      {errors.map((m, i) => (
        <div className="alert" role="alert" key={i}>
          <Icon name="alert" size={16} /><span>{m}</span>
          <button aria-label="Dismiss" onClick={() => setErrors((e) => e.filter((_, j) => j !== i))}><Icon name="close" size={14} /></button>
        </div>
      ))}
    </div>
  )

  if (!loaded) return <div className="skeleton" aria-busy="true" />

  if (!files.length) {
    return (
      <>
        <section className="page-head" style={{ textAlign: 'center', justifyItems: 'center', marginTop: 12 }}>
          <h1>Measure your aerodynamic drag</h1>
          <p className="lede">Upload an out-and-back ride and get your CdA with a data-quality check in under a minute.</p>
        </section>
        <div style={{ maxWidth: 620, margin: '0 auto', display: 'grid', gap: 22 }}>
          <div className={`drop big-drop${over ? ' over' : ''}`} role="button" tabIndex={0} aria-label="Upload .fit files" {...dropProps}>
            {input}
            {uploading
              ? <><div className="ic"><Icon name="loader" size={22} /></div><div className="big">Reading your file…</div><div className="small muted">Parsing the ride and running the quality checks.</div></>
              : <><div className="ic"><Icon name="upload" size={22} /></div><div className="big">Drop a .fit file here</div><div className="small muted">or click to browse. Several files at once is fine.</div></>}
          </div>
          {alerts}
          <ol className="how"><li><span className="n">1</span>Upload</li><li><span className="n">2</span>Check data</li><li><span className="n">3</span>Get your CdA</li></ol>
          <div className="empty-actions"><button className="btn" onClick={() => navigate('guide')}>How to record a test</button></div>
          <ParamsPanel params={params} setParams={setParams} hints={hints} />
        </div>
      </>
    )
  }

  return (
    <>
      <Stepper current="analyze" hasFiles hasTrim={files.some((f) => f.trimmed)} hasResult={nRes > 0} />
      <section className="page-head">
        <h1>Your rides</h1>
        <p className="lede">Calculate CdA for each ride. Open a ride for its full data-quality report and trim options.</p>
      </section>
      <div className="stack">
        {alerts}
        <div className="toolbar">
          <div className="sum">
            <span><b>{files.length}</b> ride{files.length > 1 ? 's' : ''}</span>
            <span><b>{nRes}</b> with CdA</span>
            {nFail > 0 && <span className="c-bad"><b>{nFail}</b> need{nFail > 1 ? '' : 's'} fixing</span>}
          </div>
          {nRes > 1 && <button className="btn btn-sm btn-primary" onClick={() => navigate('compare')}><Icon name="compare" size={14} />Compare rides</button>}
        </div>
        <div className="list">
          {files.map((f) => (
            <FileRow key={f.file_id} f={f} open={expanded === f.file_id} busy={!!busy[f.file_id]}
              trace={traces[f.file_id]} draft={drafts[f.file_id]}
              onDraft={(d) => setDrafts((x) => ({ ...x, [f.file_id]: { ...(x[f.file_id] || {}), ...d } }))}
              onToggle={() => toggle(f)} onAnalyze={() => analyze(f)} onRemove={() => remove(f)} />
          ))}
        </div>
        <div className={`drop compact${over ? ' over' : ''}`} role="button" tabIndex={0} aria-label="Add more .fit files" {...dropProps}>
          {input}
          {uploading
            ? <div className="drop-row"><Icon name="loader" size={16} /><span className="big" style={{ fontSize: '.9rem' }}>Reading your file…</span></div>
            : <div className="drop-row"><Icon name="upload" size={16} /><span className="big" style={{ fontSize: '.9rem' }}>Add more .fit files</span><span className="small muted">drop or click to browse</span></div>}
        </div>
        <ParamsPanel params={params} setParams={setParams} hints={hints} />
        <div className="list-foot">
          <button className="btn btn-sm btn-quiet" onClick={recalcAll} disabled={recalcing}>
            <Icon name={recalcing ? 'loader' : 'refresh'} size={14} />Recalculate all
          </button>
          {confirmClear
            ? <span className="confirm">Remove all {files.length} rides?
              <button className="btn btn-sm btn-danger" onClick={async () => { await clearFiles(); setFiles([]); setConfirmClear(false) }}>Remove</button>
              <button className="btn btn-sm" onClick={() => setConfirmClear(false)}>Cancel</button></span>
            : <button className="btn btn-sm btn-quiet btn-danger" onClick={() => setConfirmClear(true)}><Icon name="trash" size={14} />Clear all</button>}
        </div>
      </div>
    </>
  )
}

function FileRow({ f, open, busy, trace, draft, onDraft, onToggle, onAnalyze, onRemove }) {
  const q = f.quality
  const fail = q?.overall === 'FAIL'
  const has = f.cda != null
  const issue = fail ? firstProblem(q) : null
  const title = has && f.label ? f.label : f.name
  return (
    <article className="fc">
      <div className="fr">
        <div className="fr-main">
          <div className="fc-name" title={f.name}>{title}</div>
          <div className="fc-line">
            {has && f.label && <span>{f.name.length > 30 ? `${f.name.slice(0, 28)}…` : f.name}</span>}
            <span className="mono">{Math.round(f.duration_min)} min</span>
            <span className="mono">{f.avg_speed_kmh?.toFixed(1)} km/h</span>
            <span className="mono">{f.avg_power_w} W</span>
            {f.trimmed && <span className="badge info">Trimmed</span>}
          </div>
        </div>
        <div className="fr-right">
          <QualityBadge quality={q} />
          {has && <span className="fc-cda"><b>{f.cda.toFixed(4)}</b></span>}
          {has
            ? <button className="btn btn-primary btn-sm" onClick={() => navigate(`result/${f.file_id}`)}>View result</button>
            : fail
              ? <button className="btn btn-sm" onClick={() => navigate(`trim/${f.file_id}`)}><Icon name="scissors" size={14} />Fix</button>
              : <button className="btn btn-primary btn-sm" disabled={busy} onClick={onAnalyze}>{busy ? <><Icon name="loader" size={14} />Calculating…</> : 'Calculate CdA'}</button>}
          <button className="icon-btn" onClick={onToggle} aria-expanded={open} aria-label={`Details for ${f.name}`}><Icon name={open ? 'up' : 'down'} size={17} /></button>
        </div>
      </div>
      {issue && !open && <div className="fc-issue"><Icon name="alert" size={14} /><span>{issue.label}</span></div>}
      {open && (
        <div className="fc-sub">
          <QualityList quality={q} onFix={() => navigate(`trim/${f.file_id}`)} />
          {trace && (
            <div>
              <div className="sec-title" style={{ marginBottom: 8 }}>Ride preview</div>
              <div className="chart-scroll"><TraceChart trace={trace} compact label={`Speed over time for ${f.name}`} /></div>
            </div>
          )}
          <div className="fc-run" style={{ padding: 0 }}>
            <input className="txt" type="text" maxLength={120} placeholder="Label, e.g. TT extensions" aria-label="Label"
              value={draft?.label ?? f.label ?? ''} onChange={(e) => onDraft({ label: e.target.value })} />
            <input className="txt" type="text" maxLength={500} placeholder="Notes (optional)" aria-label="Notes"
              value={draft?.notes ?? f.notes ?? ''} onChange={(e) => onDraft({ notes: e.target.value })} />
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button className="btn btn-sm" onClick={() => navigate(`trim/${f.file_id}`)}><Icon name="scissors" size={14} />Trim and turnarounds</button>
            {has && <button className="btn btn-sm" disabled={busy} onClick={onAnalyze}><Icon name={busy ? 'loader' : 'refresh'} size={14} />Recalculate</button>}
            <button className="btn btn-sm btn-quiet btn-danger" style={{ marginLeft: 'auto' }} onClick={onRemove}><Icon name="trash" size={14} />Remove</button>
          </div>
        </div>
      )}
    </article>
  )
}
