export const DEFAULT_PARAMS = {
  mass: 75,
  crr: 0.0031,
  rho: 1.225,
  wind_ms: 0,
  drivetrain_eff: 0.977, // 1.0 for hub-based power meters
  speed_source: 'sensor',
  speed_scale: 1,
}

const KEY = 'cda.params'

export function loadParams() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || '{}')
    return { ...DEFAULT_PARAMS, ...raw }
  } catch {
    return { ...DEFAULT_PARAMS }
  }
}

export function saveParams(p) {
  try { localStorage.setItem(KEY, JSON.stringify(p)) } catch { /* private mode */ }
}
