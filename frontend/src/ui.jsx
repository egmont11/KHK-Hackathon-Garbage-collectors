import { TEAMS } from './geo.js'

// Google Material Symbols (Rounded), názvy: https://fonts.google.com/icons
export const Icon = ({ name, fill }) => (
  <span className={`material-symbols-rounded${fill ? ' fill' : ''}`} aria-hidden="true">{name}</span>
)

export { DEMO } from './mode.js'

export const go = (page, id) => { location.hash = id ? `/${page}/${encodeURIComponent(id)}` : `/${page}` }
// Zpět z podstránky vede vždy na mapu.
export const back = () => go('')

// „2026-Q4“ -> „2026 podzim“ (čtvrtletí: zima, jaro, léto, podzim), ručně ukončená „2026-Q4-2“ -> „2026 podzim (2)“.
const SEASON_NAMES = ['zima', 'jaro', 'léto', 'podzim']
export function seasonLabel(id) {
  const m = /^(\d{4})-Q([1-4])(?:-(\d+))?$/.exec(id || '')
  if (!m) return id || ''
  return `${m[1]} ${SEASON_NAMES[m[2] - 1]}${m[3] ? ` (${m[3]})` : ''}`
}

// Týmové ikony od Tadeáše (hora / vlny / stromy)
const TEAM_PATHS = {
  hory: 'm2 20 7-16 6 11 3-7 5 12ZM6 11l3 2 3-3',
  reky: 'M2 7q3-4 6 0t6 0 8 0M2 12q3-4 6 0t6 0 8 0M2 17q3-4 6 0t6 0 8 0',
  lesy: 'm8 3-6 12h4l-3 5h10l-3-5h4ZM8 20v3M17 2l-4 8h3l-3 6h8l-3-6h3ZM17 16v6',
}

export function TeamIcon({ team, size = 24 }) {
  return (
    <svg className="team-icon" viewBox="0 0 24 24" width={size} height={size} aria-hidden="true">
      <path d={TEAM_PATHS[team]} />
    </svg>
  )
}

// Turistická značka KČT: bílá–barva–bílá
export function KctMark({ team, className = '' }) {
  return <span className={`kct ${className}`} style={{ '--c': TEAMS[team]?.color }} aria-hidden="true" />
}

export function TeamBadge({ team }) {
  const t = TEAMS[team]
  if (!t) return null
  return (
    <span className="team-badge" style={{ '--c': t.color }}>
      <TeamIcon team={team} size={16} />{t.label}
    </span>
  )
}

export function PageHeader({ title }) {
  return (
    <header className="page-header">
      <button className="round-btn" onClick={back} aria-label="Zpět"><Icon name="arrow_back" /></button>
      <h2>{title}</h2>
    </header>
  )
}
