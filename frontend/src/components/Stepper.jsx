import Icon from './Icon'
import { navigate } from '../lib/router'

export default function Stepper({ current, hasFiles, hasTrim, hasResult }) {
  const steps = [
    ['analyze', 'Upload & check', '', hasFiles, ''],
    ['trim', 'Trim', 'optional', hasTrim, 'trim'],
    ['result', 'Result', '', hasResult, 'result'],
    ['compare', 'Compare', '', false, 'compare'],
  ]
  return (
    <ol className="steps" aria-label="Workflow">
      {steps.map(([id, label, sub, done], i) => {
        const on = current === id
        return (
          <li key={id}>
            <button className={`step${on ? ' on' : ''}${done && !on ? ' done' : ''}`}
              aria-current={on ? 'step' : undefined}
              onClick={() => navigate(id === 'analyze' ? '' : id)}>
              <span className="n">{done && !on ? <Icon name="check" size={11} /> : i + 1}</span>
              <span className="lbl">{label}{sub && <span className="sub">{sub}</span>}</span>
            </button>
          </li>
        )
      })}
    </ol>
  )
}
