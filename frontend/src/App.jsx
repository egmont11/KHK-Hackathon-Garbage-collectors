import { useEffect, useMemo, useRef, useState } from 'react'
import MapView from './MapView.jsx'
import { api, loadPois } from './api.js'
import { TEAMS, distanceM, formatDistance } from './geo.js'
import { DEMO, Icon, KctMark, TeamIcon, go } from './ui.jsx'
import { GROUPS, groupIcon } from './groups.js'
import { EventsPage, LeaderboardPage, PoiInfoPage, ProfilePage, TransportPage } from './pages.jsx'

const PING_EVERY_MS = 5000
const CHECKIN_RADIUS_M = 100

function usePosition() {
  const [position, setPosition] = useState(null)
  useEffect(() => {
    if (DEMO || !navigator.geolocation) return
    const id = navigator.geolocation.watchPosition(
      (p) => setPosition({ lat: p.coords.latitude, lon: p.coords.longitude, accuracy_m: p.coords.accuracy }),
      (e) => console.warn('geolocation', e.message),
      { enableHighAccuracy: true },
    )
    return () => navigator.geolocation.clearWatch(id)
  }, [])
  return [position, setPosition]
}

// Jednoduchý hash router: #/info/<id>, #/doprava/<id>, #/zebricek, #/udalosti, #/profil
function useRoute() {
  const parse = () => {
    const [page = '', id] = location.hash.replace(/^#\/?/, '').split('/')
    return { page, id: id && decodeURIComponent(id) }
  }
  const [route, setRoute] = useState(parse)
  useEffect(() => {
    const onHash = () => setRoute(parse())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])
  return route
}

// Check-in žije v App, aby běžel dál i při přepnutí na podstránku.
function useCheckin(position, onCaptured) {
  const [state, setState] = useState({ phase: 'idle' }) // idle | running | done | error
  const posRef = useRef(position)
  posRef.current = position
  const timer = useRef(null)
  useEffect(() => () => clearInterval(timer.current), [])

  async function start(poi) {
    clearInterval(timer.current)
    const poiId = poi.properties.id
    try {
      const { checkin_id, required_seconds } = await api.startCheckin({ poi_id: poiId, ...posRef.current })
      setState({ phase: 'running', poiId, name: poi.properties.name, elapsed: 0, required: required_seconds, valid: true })
      timer.current = setInterval(async () => {
        try {
          const { elapsed_s, valid } = await api.ping(checkin_id, posRef.current)
          if (elapsed_s >= required_seconds) {
            clearInterval(timer.current)
            const res = await api.finish(checkin_id)
            setState({ phase: 'done', poiId, name: poi.properties.name, ...res })
            onCaptured()
          } else {
            setState((s) => ({ ...s, elapsed: elapsed_s, valid }))
          }
        } catch (e) {
          clearInterval(timer.current)
          setState({ phase: 'error', poiId, msg: e.message })
        }
      }, PING_EVERY_MS)
    } catch (e) {
      setState({ phase: 'error', poiId, msg: e.message })
    }
  }
  const cancel = () => { clearInterval(timer.current); setState({ phase: 'idle' }) }
  return { state, start, cancel }
}

function loadPlayer() {
  try { return JSON.parse(localStorage.getItem('krajanek-player')) } catch { return null }
}

export default function App() {
  const [player, setPlayer] = useState(loadPlayer)
  if (!player) return <Onboarding onDone={setPlayer} />
  return <Game player={player} onLogout={() => {
    localStorage.removeItem('krajanek-player')
    localStorage.removeItem('krajanek-token')
    setPlayer(null)
    go('')
  }} />
}

function Game({ player, onLogout }) {
  const [pois, setPois] = useState([])
  const [owners, setOwners] = useState({})
  const [position, setPosition] = usePosition()
  const [selectedId, setSelectedId] = useState(null)
  const route = useRoute()

  useEffect(() => { loadPois().then(setPois) }, [])
  const refreshOwners = () => api.poiOwners().then(setOwners)
  useEffect(() => { refreshOwners() }, [])
  const checkin = useCheckin(position, refreshOwners)

  const poiById = (id) => pois.find((f) => f.properties.id === id)
  const routePoi = route.id && poiById(route.id)
  const showOnMap = (id) => { setSelectedId(id); go('') }

  let page = null
  if (route.page === 'info' && routePoi) page = <PoiInfoPage poi={routePoi} owner={owners[routePoi.properties.id]} />
  if (route.page === 'doprava' && routePoi) page = <TransportPage poi={routePoi} position={position} />
  if (route.page === 'zebricek') page = <LeaderboardPage />
  if (route.page === 'udalosti') page = <EventsPage pois={pois} position={position} onShow={showOnMap} />
  if (route.page === 'profil') page = <ProfilePage player={player} pois={pois} onLogout={onLogout} />

  const teamColor = TEAMS[player.team]?.color
  const tab = (id, icon, label, extra = '') => (
    <button className={`${extra}${route.page === id ? ' active' : ''}`} onClick={() => go(id)}>
      <span className="tab-icon"><Icon name={icon} fill={route.page === id} /></span>
      <span>{label}</span>
    </button>
  )

  return (
    <div className="app" style={{ '--team': teamColor }}>
      <MapPage
        player={player}
        pois={pois}
        owners={owners}
        position={position}
        setPosition={setPosition}
        selected={selectedId && poiById(selectedId)}
        setSelectedId={setSelectedId}
        checkin={checkin}
      />
      <nav className="navbar">
        {tab('zebricek', 'trophy', 'Žebříček')}
        {tab('udalosti', 'flag', 'Questy', 'quests')}
        {tab('profil', 'person', 'Profil')}
      </nav>
      {page && <div className="page">{page}</div>}
    </div>
  )
}

const EMPTY_FILTERS = { q: '', group: '', category: '', minPoints: 0, maxKm: '', nearStop: false }

function CheckinRing({ elapsed, required, valid }) {
  const r = 26
  const c = 2 * Math.PI * r
  return (
    <div className={`ring${valid ? '' : ' paused'}`}>
      <svg viewBox="0 0 64 64">
        <circle className="ring-track" cx="32" cy="32" r={r} />
        <circle className="ring-fill" cx="32" cy="32" r={r} strokeDasharray={c} strokeDashoffset={c * (1 - elapsed / required)} />
      </svg>
      <b>{Math.max(0, required - elapsed)}</b>
    </div>
  )
}

function MapPage({ player, pois, owners, position, setPosition, selected, setSelectedId, checkin }) {
  const [filters, setFilters] = useState(EMPTY_FILTERS)
  const [filterOpen, setFilterOpen] = useState(false)
  const [toast, setToast] = useState(null)
  const toastTimer = useRef(null)
  const flash = (msg) => {
    setToast(msg)
    clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(null), 3000)
  }

  const filtered = useMemo(() => {
    const q = filters.q.trim().toLowerCase()
    return pois.filter((f) => {
      const p = f.properties
      if (q && !p.name.toLowerCase().includes(q) && !(p.municipality || '').toLowerCase().includes(q)) return false
      if (filters.group && p.group !== filters.group) return false
      if (filters.category && p.category !== filters.category) return false
      if (p.points < filters.minPoints) return false
      if (filters.nearStop && !(p.nearest_stop && p.nearest_stop.distance_m <= 500)) return false
      if (filters.maxKm && position) {
        const [lon, lat] = f.geometry.coordinates
        if (distanceM(position.lat, position.lon, lat, lon) > filters.maxKm * 1000) return false
      }
      return true
    })
  }, [pois, filters, position])
  const filterActive = JSON.stringify(filters) !== JSON.stringify(EMPTY_FILTERS)

  const sel = selected?.properties
  const dist = selected && position
    ? distanceM(position.lat, position.lon, selected.geometry.coordinates[1], selected.geometry.coordinates[0])
    : null
  const inRange = dist != null && dist <= CHECKIN_RADIUS_M
  const cs = checkin.state
  const running = cs.phase === 'running'
  const stop = sel?.nearest_stop

  function claim() {
    if (!inRange) return flash(position ? `Mimo dosah · ${formatDistance(dist)}` : 'Bez polohy')
    checkin.start(selected)
  }

  return (
    <div className="map-wrap">
      <MapView
        pois={filtered}
        owners={owners}
        selectedId={sel?.id}
        onSelect={setSelectedId}
        position={position}
        demo={DEMO}
        onDemoClick={(lat, lon) => setPosition({ lat, lon, accuracy_m: 5 })}
      />

      <header className="topbar">
        <div className="brand">
          <KctMark team={player.team} className="brand-kct" />
          Krajánek
          {DEMO && <span className="demo-pill">demo</span>}
        </div>
        <button className={`round-btn${filterOpen ? ' on' : ''}`} onClick={() => setFilterOpen(!filterOpen)} aria-label="Filtr">
          <Icon name={filterOpen ? 'close' : 'tune'} />
          {filterActive && !filterOpen && <i className="dot" />}
        </button>
      </header>

      {filterOpen && (
        <Filters pois={pois} filters={filters} setFilters={setFilters} count={filtered.length} position={position} />
      )}

      {running && (
        <div className="checkin">
          <CheckinRing elapsed={cs.elapsed} required={cs.required} valid={cs.valid} />
          <div className="checkin-body">
            <b>{cs.name}</b>
            {!cs.valid && <span className="warn"><Icon name="location_off" /> Mimo dosah</span>}
          </div>
          <button className="round-btn ghost" onClick={checkin.cancel} aria-label="Zrušit"><Icon name="close" /></button>
        </div>
      )}
      {cs.phase === 'done' && (
        <div className="stamp-wrap" onClick={checkin.cancel}>
          <div className="stamp">
            <TeamIcon team={player.team} size={34} />
            <b>+{cs.awarded_points}</b>
            <span>{cs.name}</span>
          </div>
        </div>
      )}
      {cs.phase === 'error' && cs.poiId === sel?.id && (
        <div className="toast err"><Icon name="error" /> {cs.msg}</div>
      )}
      {toast && <div className="toast"><Icon name="location_off" /> {toast}</div>}

      {sel && !filterOpen && (
        <div className="poi-panel">
          <div className="signpost">
            <button className="signpost-close" onClick={() => setSelectedId(null)} aria-label="Zavřít"><Icon name="close" /></button>
            <div className="signpost-title">{sel.name}</div>
            <div className="signpost-meta">
              <span className="pts">{sel.points} b.</span>
              {dist != null && <span><Icon name="near_me" />{formatDistance(dist)}</span>}
              {stop && <span><Icon name={stop.type === 'train' ? 'train' : 'directions_bus'} />{formatDistance(stop.distance_m)}</span>}
            </div>
          </div>
          <div className="poi-buttons">
            <button className="round-btn big" onClick={() => go('doprava', sel.id)} aria-label="Doprava"><Icon name="directions_bus" /></button>
            <button className="round-btn big" onClick={() => go('info', sel.id)} aria-label="Informace"><Icon name="info" /></button>
            <button className={`claim${inRange ? '' : ' far'}`} onClick={claim} disabled={running}>
              Zabrat <Icon name="flag" fill />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function Filters({ pois, filters, setFilters, count, position }) {
  const groups = useMemo(() => {
    const present = new Set(pois.map((f) => f.properties.group))
    return [...Object.keys(GROUPS).filter((g) => present.has(g)), ...[...present].filter((g) => !GROUPS[g])]
  }, [pois])
  const categories = useMemo(() => {
    const m = new Map()
    for (const f of pois) if (!filters.group || f.properties.group === filters.group) m.set(f.properties.category, f.properties.category_label)
    return [...m].sort((a, b) => a[1].localeCompare(b[1], 'cs'))
  }, [pois, filters.group])
  const setF = (k) => (e) => setFilters({ ...filters, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value })
  return (
    <div className="sheet filter-sheet">
      <label className="search">
        <Icon name="search" />
        <input placeholder="Hledat" value={filters.q} onChange={setF('q')} />
      </label>
      <div className="group-chips">
        {groups.map((g) => (
          <button key={g} className={filters.group === g ? 'active' : ''}
            onClick={() => setFilters({ ...filters, group: filters.group === g ? '' : g, category: '' })}>
            <Icon name={groupIcon(g)} />
            <span>{GROUPS[g]?.label.split(' ')[0] ?? g}</span>
          </button>
        ))}
      </div>
      <select value={filters.category} onChange={setF('category')}>
        <option value="">Všechny kategorie</option>
        {categories.map(([c, label]) => <option key={c} value={c}>{label}</option>)}
      </select>
      <label className="row">
        <Icon name="star" />
        <input type="range" min="0" max="100" step="5" value={filters.minPoints} onChange={(e) => setFilters({ ...filters, minPoints: +e.target.value })} />
        <b>{filters.minPoints}+</b>
      </label>
      <label className={`row${position ? '' : ' off'}`}>
        <Icon name="near_me" />
        <input type="number" min="0" inputMode="numeric" placeholder="–" value={filters.maxKm} onChange={setF('maxKm')} disabled={!position} />
        <b>km</b>
      </label>
      <label className="row toggle">
        <Icon name="directions_bus" />
        <span>≤ 500 m</span>
        <input type="checkbox" checked={filters.nearStop} onChange={setF('nearStop')} />
        <i />
      </label>
      <div className="filter-foot">
        <button className="text-btn" onClick={() => setFilters(EMPTY_FILTERS)}><Icon name="restart_alt" /> Reset</button>
        <span className="count">{count}<small> / {pois.length}</small></span>
      </div>
    </div>
  )
}

function Onboarding({ onDone }) {
  const [name, setName] = useState('')
  const [team, setTeam] = useState(null)
  const [error, setError] = useState(null)
  async function submit(e) {
    e.preventDefault()
    if (!team) return
    try {
      const { player_id, token } = await api.createPlayer({ name, team })
      const player = { player_id, name, team }
      localStorage.setItem('krajanek-token', token)
      localStorage.setItem('krajanek-player', JSON.stringify(player))
      onDone(player)
    } catch (err) { setError(err.message) }
  }
  return (
    <form className="onboarding" onSubmit={submit} style={{ '--team': team ? TEAMS[team].color : undefined }}>
      <div className="onboarding-brand">
        <KctMark team={team || 'lesy'} />
        <h1>Krajánek</h1>
      </div>
      <label className="field">
        <span>Jméno</span>
        <input className="name-input" required autoComplete="nickname" value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <div className="field">
        <span>Tým</span>
        <div className="team-pick">
        {Object.entries(TEAMS).map(([id, t]) => (
          <button type="button" key={id} className={`team-card${team === id ? ' active' : ''}`} style={{ '--c': t.color }}
            onClick={() => setTeam(id)} aria-pressed={team === id}>
            <TeamIcon team={id} size={44} />
            <KctMark team={id} className="big" />
            <span>{t.label}</span>
          </button>
        ))}
        </div>
      </div>
      <button className="play" disabled={!team || !name.trim()}>Hrát <Icon name="arrow_forward" /></button>
      {error && <p className="err">{error}</p>}
    </form>
  )
}
