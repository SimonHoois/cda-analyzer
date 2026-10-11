import Icon from './Icon'

/** Native <details>, so it works without JavaScript state and stays accessible. */
export default function Accordion({ title, meta, children, onOpen, defaultOpen = false }) {
  return (
    <details className="acc" open={defaultOpen} onToggle={(e) => { if (e.currentTarget.open && onOpen) onOpen() }}>
      <summary>
        <span>{title}</span>
        <span className="acc-meta">{meta}<span className="chev"><Icon name="down" size={16} /></span></span>
      </summary>
      <div className="acc-body">{children}</div>
    </details>
  )
}
