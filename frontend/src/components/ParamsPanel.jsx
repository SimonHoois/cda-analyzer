import { useState } from 'react'
import { DEFAULT_PARAMS } from '../lib/params'

function Field({ id, label, unit, hint, value, onChange, step, min, max }) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <div className={`inp${unit ? ' has-u' : ''}`}>
        <input id={id} type="number" inputMode="decimal" step={step} min={min} max={max} value={value}
          onChange={(e) => onChange(e.target.value === '' ? '' : parseFloat(e.target.value))} />
        {unit && <span className="u">{unit}</span>}
      </div>
      <p className="hint">{hint}</p>
    </div>
  )
}

/** Collapsed to one line until the user wants to change something. */
export default function ParamsPanel({ params, setParams, hints = {} }) {
  const [open, setOpen] = useState(false)
  const [adv, setAdv] = useState(false)
  const set = (k) => (v) => setParams((p) => ({ ...p, [k]: v }))
  const num = (v, d) => (typeof v === 'number' ? v : d)

  return (
    <div className="stack">
      <div className="set-row">
        <span>Rider and conditions <span className="faint">·</span> <b className="mono">{num(params.mass, 0)} kg</b>{' '}
          <span className="faint">·</span> Crr <b className="mono">{params.crr}</b>{' '}
          <span className="faint">·</span> ρ <b className="mono">{params.rho}</b></span>
        <button className="btn btn-sm btn-quiet" aria-expanded={open} onClick={() => setOpen(!open)}>{open ? 'Done' : 'Edit'}</button>
      </div>
      {open && (
        <section className="card pad" style={{ display: 'grid', gap: 16 }}>
          <div className="pgrid">
            <Field id="p-mass" label="Total mass" unit="kg" step="0.5" min="30" max="250" value={params.mass} onChange={set('mass')} hint="Rider, bike, kit and bottles." />
            <Field id="p-crr" label="Rolling resistance (Crr)" step="0.0001" min="0.0005" max="0.02" value={params.crr} onChange={set('crr')} hint="Tubular TT about 0.003, road clincher about 0.004." />
            <Field id="p-rho" label="Air density" unit="kg/m³" step="0.001" min="0.9" max="1.5" value={params.rho} onChange={set('rho')} hint="1.225 at sea level and 15 °C. Higher when cold." />
            <Field id="p-wind" label="Wind" unit="m/s" step="0.1" min="-20" max="20" value={params.wind_ms} onChange={set('wind_ms')} hint="Positive is a headwind on the outbound leg. 0 if unknown." />
          </div>
          {hints.rho && Math.abs(hints.rho.value - params.rho) > 0.004 && (
            <div className="hint-box">
              <span>This ride was recorded at {hints.rho.temp.toFixed(0)} °C. Suggested air density: <b className="mono">{hints.rho.value}</b></span>
              <button className="btn btn-sm" onClick={() => setParams((p) => ({ ...p, rho: hints.rho.value }))}>Use it</button>
            </div>
          )}
          <button className="btn btn-sm btn-quiet" style={{ justifySelf: 'start' }} aria-expanded={adv} onClick={() => setAdv(!adv)}>
            {adv ? 'Hide advanced' : 'Advanced settings'}
          </button>
          {adv && (
            <div className="adv">
              <div className="field">
                <label>Power meter location</label>
                <div className="seg" role="group" aria-label="Power meter location" style={{ justifySelf: 'start' }}>
                  <button aria-pressed={params.drivetrain_eff < 1} onClick={() => set('drivetrain_eff')(DEFAULT_PARAMS.drivetrain_eff)}>Crank / pedals</button>
                  <button aria-pressed={params.drivetrain_eff >= 1} onClick={() => set('drivetrain_eff')(1)}>Hub / wheel</button>
                </div>
                <p className="hint">Crank and pedal meters measure before the drivetrain, which loses about 2.3%. Hub meters do not.</p>
              </div>
              <div className="field">
                <label>Speed source</label>
                <div className="seg" role="group" aria-label="Speed source" style={{ justifySelf: 'start' }}>
                  <button aria-pressed={params.speed_source === 'sensor'} onClick={() => set('speed_source')('sensor')}>Speed sensor</button>
                  <button aria-pressed={params.speed_source === 'gps'} onClick={() => set('speed_source')('gps')}>GPS</button>
                </div>
              </div>
              <Field id="p-scale" label="Speed sensor calibration" step="0.001" min="0.9" max="1.1" value={params.speed_scale} onChange={set('speed_scale')} hint="1.000 means no correction. Aero power grows with speed cubed, so 1% too low speed means about 3% too high CdA." />
              {hints.scale && Math.abs(hints.scale - params.speed_scale) > 0.015 && (
                <div className="hint-box">
                  <span>Your speed sensor covers {(100 / hints.scale).toFixed(1)}% of the GPS distance. Suggested calibration: <b className="mono">{hints.scale.toFixed(3)}</b></span>
                  <button className="btn btn-sm" onClick={() => setParams((p) => ({ ...p, speed_scale: hints.scale }))}>Use it</button>
                </div>
              )}
              <button className="btn btn-sm btn-quiet" style={{ justifySelf: 'start' }} onClick={() => setParams({ ...DEFAULT_PARAMS })}>Reset all to defaults</button>
            </div>
          )}
          <p className="hint">Changes apply the next time you calculate or press Recalculate all.</p>
        </section>
      )}
    </div>
  )
}
