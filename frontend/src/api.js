// All backend calls in one place. The app is served by the same origin as the API.
const BASE = '/api'

async function request(path, opts = {}) {
  let res
  try {
    res = await fetch(`${BASE}${path}`, { credentials: 'same-origin', ...opts })
  } catch {
    throw new Error('Cannot reach the server. Check your connection and try again.')
  }
  let data = null
  try { data = await res.json() } catch { /* empty body */ }
  if (!res.ok) throw new Error((data && data.detail) || `Request failed (${res.status})`)
  return data
}

function form(params, extra = {}) {
  const f = new FormData()
  if (params) {
    f.append('mass', params.mass)
    f.append('crr', params.crr)
    f.append('rho', params.rho)
    f.append('wind_ms', params.wind_ms)
    f.append('drivetrain_eff', params.drivetrain_eff)
    f.append('speed_source', params.speed_source)
    f.append('speed_scale', params.speed_scale)
  }
  Object.entries(extra).forEach(([k, v]) => { if (v !== undefined && v !== null) f.append(k, v) })
  return f
}

const query = (params) => new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)])).toString()

export const getConfig = () => request('/config')

// files
export const listFiles = () => request('/files')
export const uploadFile = (file, params) =>
  request('/files/upload', { method: 'POST', body: (() => { const f = form(params); f.append('file', file); return f })() })
export const deleteFile = (id) => request(`/files/${id}`, { method: 'DELETE' })
export const clearFiles = () => request('/files', { method: 'DELETE' })
export const recalculateFile = (id, params) =>
  request(`/files/${id}/recalculate`, { method: 'POST', body: form(params) })
export const analyzeFile = (id, params, label, notes, excludePairs) =>
  request(`/files/${id}/analyze`, { method: 'POST', body: form(params, { label, notes, exclude_pairs: excludePairs }) })
export const getResult = (id) => request(`/files/${id}/result`)
export const compareFiles = (a, b, params, refPower) =>
  request('/files/compare', { method: 'POST', body: form(params, { file_id_a: a, file_id_b: b, ref_power: refPower }) })

// trim + turnarounds
export const getTrim = (id, params) => request(`/files/${id}/trim?${query(params)}`)
export const applyTrim = (id, params, { cropStart, cropEnd, turnTimes, resetTurns }) =>
  request(`/files/${id}/trim`, {
    method: 'POST',
    body: form(params, {
      crop_start: cropStart,
      crop_end: cropEnd,
      turn_times: turnTimes ? JSON.stringify(turnTimes) : undefined,
      reset_turns: resetTurns ? 'true' : undefined,
    }),
  })

// chart data
export const getOverview = (id) => request(`/files/${id}/charts/overview`)
export const getSegment = (id) => request(`/files/${id}/charts/segment`)
export const getResultCharts = (id) => request(`/files/${id}/charts/results`)

// history
export const getHistory = () => request('/history')
export const deleteHistoryEntry = (id) => request(`/history/${id}`, { method: 'DELETE' })
export const clearHistory = () => request('/history', { method: 'DELETE' })
export const importHistory = (entries) =>
  request('/history/import', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(entries) })
