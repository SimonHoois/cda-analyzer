import { useEffect, useRef, useState } from 'react'
import Icon from '../components/Icon'
import HistoryChart from '../charts/HistoryChart'
import { useApp } from '../lib/ctx'
import { navigate } from '../lib/router'
import { clearHistory, deleteHistoryEntry, getHistory, importHistory } from '../api'

const cdaCol = (v) => (v < 0.22 ? 'c-good' : v < 0.28 ? 'c-accent' : v < 0.35 ? 'c-warn' : '')

export default function HistoryPage() {
  const { toast } = useApp()
  const [entries, setEntries] = useState(null)
  const [error, setError] = useState(null)
  const [confirm, setConfirm] = useState(false)
  const fileRef = useRef(null)

  const load = () => getHistory().then(setEntries).catch((e) => setError(e.message))
  useEffect(() => { load() }, [])

  const onImport = async (e) => {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (!f) return
    try {
      const { added } = await importHistory(JSON.parse(await f.text()))
      toast(added ? `Imported ${added} test${added > 1 ? 's' : ''}.` : 'Nothing new to import.')
      load()
    } catch (err) { toast(err.message || 'That file is not a history export.') }
  }

  if (error) return <div className="alert" role="alert"><Icon name="alert" size={16} /><span>{error}</span></div>
  if (!entries) return <div className="skeleton" aria-busy="true" />

  const importer = (
    <>
      <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={onImport} />
      <button className="btn btn-sm btn-quiet" onClick={() => fileRef.current?.click()}><Icon name="upload" size={14} />Import cda_history.json</button>
    </>
  )

  if (!entries.length) {
    return (
      <>
        <section className="page-head"><h1>Test history</h1></section>
        <div className="card empty">
          <h2 className="h2">No tests yet</h2>
          <p>Every CdA you calculate is saved here, so you can see whether a change to your position or equipment made a difference.</p>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <button className="btn btn-primary" onClick={() => navigate('')}>Go to Analyze<Icon name="right" size={14} /></button>{importer}
          </div>
        </div>
      </>
    )
  }

  const rows = entries.map((e, i) => ({ e, i })).reverse()
  return (
    <>
      <div className="head-row page-head">
        <div>
          <h1>Test history</h1>
          <p className="lede" style={{ marginTop: 6 }}>{entries.length} saved test{entries.length > 1 ? 's' : ''}. Lower CdA is faster.</p>
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          {importer}
          {confirm
            ? <span className="confirm">Delete all {entries.length} tests?
              <button className="btn btn-sm btn-danger" onClick={async () => { await clearHistory(); setConfirm(false); load() }}>Delete</button>
              <button className="btn btn-sm" onClick={() => setConfirm(false)}>Cancel</button></span>
            : <button className="btn btn-sm btn-quiet btn-danger" onClick={() => setConfirm(true)}><Icon name="trash" size={14} />Clear all</button>}
        </div>
      </div>
      <section className="card pad">
        <div className="head-row" style={{ alignItems: 'center', marginBottom: 10 }}>
          <h2 className="h2">CdA over time</h2><span className="small faint">Bars show ±σ across pairs. Hover or tap a point.</span>
        </div>
        <HistoryChart entries={entries} />
      </section>
      <section className="card" style={{ marginTop: 16 }}>
        <div className="tbl-wrap">
          <table>
            <thead><tr><th style={{ textAlign: 'left' }}>Test</th><th>CdA</th><th>Quality</th><th>Date</th><th /></tr></thead>
            <tbody>
              {rows.map(({ e, i }) => (
                <tr key={e.id}>
                  <td style={{ textAlign: 'left', whiteSpace: 'normal', minWidth: 180 }}>
                    <div style={{ fontWeight: 600 }}>{e.label || <span className="faint">No label</span>}</div>
                    <div className="small faint fname" title={e.file_name}>{e.file_name}</div>
                  </td>
                  <td className="mono"><b className={cdaCol(e.cda)}>{e.cda.toFixed(4)}</b> <span className="faint small">±{(e.cda_std || 0).toFixed(4)}</span></td>
                  <td className={`mono ${e.quality_score >= 90 ? 'c-good' : e.quality_score >= 70 ? 'c-warn' : 'c-bad'}`}>{e.quality_score}%</td>
                  <td className="small faint">{new Date(e.timestamp).toLocaleDateString('nl-NL', { day: 'numeric', month: 'short' })}</td>
                  <td><button className="icon-btn danger" aria-label={`Delete test #${i + 1}`} onClick={async () => { await deleteHistoryEntry(e.id); load() }}><Icon name="trash" size={15} /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  )
}
