import { TEAMS } from './geo.js'

// Google Material Symbols (Outlined), názvy: https://fonts.google.com/icons
export const Icon = ({ name }) => <span className="material-symbols-outlined" aria-hidden="true">{name}</span>

export const DEMO = new URLSearchParams(location.search).has('demo')

export const go = (page, id) => { location.hash = id ? `/${page}/${encodeURIComponent(id)}` : `/${page}` }
export const back = () => (history.length > 1 ? history.back() : go(''))

export function TeamBadge({ team }) {
  const t = TEAMS[team]
  if (!t) return null
  return <span className="badge" style={{ background: t.color }}>{t.label}</span>
}

export function PageHeader({ title }) {
  return (
    <header className="page-header">
      <button onClick={back}><Icon name="arrow_back" /> Zpět</button>
      <h2>{title}</h2>
    </header>
  )
}
