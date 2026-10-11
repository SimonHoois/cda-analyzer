export const fmtMS = (sec) => {
  let m = Math.floor(sec / 60), s = Math.round(sec % 60)
  if (s === 60) { m += 1; s = 0 }
  return `${m}:${String(s).padStart(2, '0')}`
}
export const fmtHMS = (sec) => {
  if (sec == null || Number.isNaN(sec)) return '—'
  let h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = Math.round(sec % 60)
  if (s === 60) { m += 1; s = 0 }
  if (m === 60) { h += 1; m = 0 }
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`
}
export const fmtSaving = (s) =>
  s == null ? '—' : s >= 60 ? `${Math.floor(s / 60)}m ${Math.round(s % 60)}s` : `${Math.round(s)}s`
export const sgn = (v, d = 0) => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(d)}`
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v))
export const lerp = (a, b, t) => a + (b - a) * t
export const smooth = (t) => t * t * (3 - 2 * t)

// 95 % two-sided Student-t critical values (only used for display fallbacks)
export function niceTicks(max, count = 4) {
  if (!(max > 0)) return [0, 1]
  const raw = max / count
  const pow = 10 ** Math.floor(Math.log10(raw))
  const step = [1, 2, 2.5, 5, 10].map((m) => m * pow).find((s) => s >= raw) || raw
  const top = Math.ceil(max / step) * step
  const out = []
  for (let v = 0; v <= top + 1e-9; v += step) out.push(+v.toFixed(6))
  return out
}

export function cdaZone(cda) {
  if (cda < 0.22) return { i: 0, label: 'Elite TT / track position', cls: 'c-good' }
  if (cda < 0.28) return { i: 1, label: 'Good TT position', cls: 'c-accent' }
  if (cda < 0.35) return { i: 2, label: 'Aggressive road / drops', cls: 'c-warn' }
  return { i: 3, label: 'Hoods / upright road', cls: 'c-warn' }
}
