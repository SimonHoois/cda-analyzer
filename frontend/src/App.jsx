import { useCallback, useEffect, useRef, useState } from 'react'
import TopBar from './components/TopBar'
import AnalyzePage from './pages/AnalyzePage'
import TrimPage from './pages/TrimPage'
import ResultPage from './pages/ResultPage'
import ComparePage from './pages/ComparePage'
import HistoryPage from './pages/HistoryPage'
import GuidePage from './pages/GuidePage'
import { AppCtx } from './lib/ctx'
import { loadParams, saveParams } from './lib/params'
import { useRoute } from './lib/router'
import { getConfig, listFiles } from './api'

export default function App() {
  const route = useRoute()
  const [params, setParams] = useState(loadParams)
  const [files, setFiles] = useState([])
  const [loaded, setLoaded] = useState(false)
  const [config, setConfig] = useState(null)
  const [toastMsg, setToastMsg] = useState('')
  const timer = useRef(null)

  useEffect(() => { saveParams(params) }, [params])

  const reloadFiles = useCallback(
    () => listFiles().then(setFiles).catch(() => { /* keep the current list */ }).finally(() => setLoaded(true)),
    [],
  )
  useEffect(() => {
    let live = true
    listFiles().then((f) => live && setFiles(f)).catch(() => {}).finally(() => live && setLoaded(true))
    getConfig().then((c) => live && setConfig(c)).catch(() => {})
    return () => { live = false }
  }, [])

  const toast = useCallback((msg) => {
    setToastMsg(msg)
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setToastMsg(''), 3200)
  }, [])

  const ctx = { params, setParams, files, setFiles, reloadFiles, toast, loaded, config }
  const { name, id } = route

  return (
    <AppCtx.Provider value={ctx}>
      <TopBar route={name} />
      <main className="wrap">
        {name === 'analyze' && <AnalyzePage />}
        {name === 'trim' && <TrimPage id={id} />}
        {name === 'result' && <ResultPage id={id} />}
        {name === 'compare' && <ComparePage />}
        {name === 'history' && <HistoryPage />}
        {name === 'guide' && <GuidePage />}
        {!['analyze', 'trim', 'result', 'compare', 'history', 'guide'].includes(name) && <AnalyzePage />}
      </main>
      {config && (
        <footer className="foot">
          {config.private ? 'Private workspace. ' : 'Your files stay in this browser session. '}
          Uploads are deleted after {config.retention_days} days.
        </footer>
      )}
      <div className={`toast${toastMsg ? ' show' : ''}`} role="status" aria-live="polite">{toastMsg}</div>
    </AppCtx.Provider>
  )
}
