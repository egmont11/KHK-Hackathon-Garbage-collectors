import { useEffect, useMemo, useRef, useState } from 'react'
import MapView from './MapView.jsx'
import { api, loadPois } from './api.js'
import { TEAMS, distanceM, formatDistance } from './geo.js'
import { DEMO, Icon, TeamBadge, go } from './ui.jsx'
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
  try { return JSON.parse(localStorage.getItem('turistak-player')) } catch { return null }
}

export default function App() {
  const [player, setPlayer] = useState(loadPlayer)
  if (!player) return <Onboarding onDone={setPlayer} />
  return <Game player={player} onLogout={() => {
    localStorage.removeItem('turistak-player')
    localStorage.removeItem('turistak-token')
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

  return (
    <div className="app">
      <MapPage
        pois={pois}
        owners={owners}
        position={position}
        setPosition={setPosition}
        selected={selectedId && poiById(selectedId)}
        setSelectedId={setSelectedId}
        checkin={checkin}
      />
      <nav className="navbar">
        <button onClick={() => go('zebricek')}><Icon name="leaderboard" /><br />Žebříček</button>
        <button onClick={() => go('udalosti')}><Icon name="timer" /><br />Události</button>
        <button onClick={() => go('profil')}><Icon name="person" /><br />Profil</button>
      </nav>
      {page && <div className="page">{page}</div>}
    </div>
  )
}

const EMPTY_FILTERS = { q: '', group: '', category: '', minPoints: 0, maxKm: '', nearStop: false }

function MapPage({ pois, owners, position, setPosition, selected, setSelectedId, checkin }) {
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

  const sel = selected?.properties
  const dist = selected && position
    ? distanceM(position.lat, position.lon, selected.geometry.coordinates[1], selected.geometry.coordinates[0])
    : null
  const inRange = dist != null && dist <= CHECKIN_RADIUS_M
  const cs = checkin.state
  const running = cs.phase === 'running'

  function claim() {
    if (!inRange) return flash(position ? `Jsi mimo dosah (${formatDistance(dist)}, potřeba do ${CHECKIN_RADIUS_M} m).` : 'Neznám tvoji polohu.')
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
      {DEMO && <div className="overlay demo-hint">demo: klik do mapy = tvoje poloha</div>}

      <button className="overlay round filter-btn" onClick={() => setFilterOpen(!filterOpen)} aria-label="Filtr">
        <Icon name="filter_alt" />
      </button>
      {filterOpen && (
        <Filters pois={pois} filters={filters} setFilters={setFilters} count={filtered.length} position={position} />
      )}

      {(running || cs.phase === 'done' || (cs.phase === 'error' && cs.poiId === sel?.id)) && (
        <div className="overlay checkin">
          {running && (
            <>
              <b>{cs.name}</b><br />
              <progress max={cs.required} value={cs.elapsed} /> {cs.elapsed} / {cs.required} s
              {!cs.valid && <div className="err">Jsi mimo 100 m nebo máš slabé GPS – odpočet stojí.</div>}
              <button onClick={checkin.cancel}>zrušit</button>
            </>
          )}
          {cs.phase === 'done' && <><Icon name="celebration" /> {cs.name}: +{cs.awarded_points} b., tým má {cs.team_score} b. <button onClick={checkin.cancel}>ok</button></>}
          {cs.phase === 'error' && <span className="err">{cs.msg}</span>}
        </div>
      )}
      {toast && <div className="overlay toast">{toast}</div>}

      {sel && (
        <div className="overlay poi-actions">
          <div className="poi-label">
            {sel.name} · {sel.points} b.{dist != null && ` · ${formatDistance(dist)}`}
            <button className="link" onClick={() => setSelectedId(null)} aria-label="Zrušit výběr"><Icon name="close" /></button>
          </div>
          <div className="buttons">
            <button className="round" onClick={() => go('doprava', sel.id)} aria-label="Doprava"><Icon name="directions_bus" /></button>
            <button className="round" onClick={() => go('info', sel.id)} aria-label="Informace"><Icon name="question_mark" /></button>
            <button className={`claim ${inRange ? '' : 'disabled'}`} onClick={claim} disabled={running}>Zabrat</button>
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
    <div className="overlay filter-panel">
      <b>Filtr ({count} / {pois.length})</b>
      <input placeholder="hledat název / obec" value={filters.q} onChange={setF('q')} />
      <div className="group-chips">
        {groups.map((g) => (
          <button key={g} title={GROUPS[g]?.label ?? g} className={filters.group === g ? 'active' : ''}
            onClick={() => setFilters({ ...filters, group: filters.group === g ? '' : g, category: '' })}>
            <span className="material-symbols-rounded">{groupIcon(g)}</span>
          </button>
        ))}
      </div>
      {filters.group && <small>{GROUPS[filters.group]?.label}</small>}
      <select value={filters.category} onChange={setF('category')}>
        <option value="">všechny kategorie</option>
        {categories.map(([c, label]) => <option key={c} value={c}>{label}</option>)}
      </select>
      <label>min. body: {filters.minPoints} <input type="range" min="0" max="100" step="5" value={filters.minPoints} onChange={(e) => setFilters({ ...filters, minPoints: +e.target.value })} /></label>
      <label>do km ode mě: <input type="number" min="0" style={{ width: 60 }} value={filters.maxKm} onChange={setF('maxKm')} disabled={!position} /></label>
      <label><input type="checkbox" checked={filters.nearStop} onChange={setF('nearStop')} /> zastávka do 500 m</label>
      <button onClick={() => setFilters(EMPTY_FILTERS)}>zrušit filtr</button>
    </div>
  )
}

function Onboarding({ onDone }) {
  const [name, setName] = useState('')
  const [team, setTeam] = useState('hory')
  const [error, setError] = useState(null)
  async function submit(e) {
    e.preventDefault()
    try {
      const { player_id, token } = await api.createPlayer({ name, team })
      const player = { player_id, name, team }
      localStorage.setItem('turistak-token', token)
      localStorage.setItem('turistak-player', JSON.stringify(player))
      onDone(player)
    } catch (err) { setError(err.message) }
  }
  return (
    <form className="onboarding" onSubmit={submit}>
      <h1>Turisťák</h1>
      <p>Objevuj, dobývej, poznávej kraj.</p>
      <fieldset>
        <legend>Jak se jmenuješ a za koho hraješ?</legend>
        <input required placeholder="jméno" value={name} onChange={(e) => setName(e.target.value)} />
        {Object.entries(TEAMS).map(([id]) => (
          <label key={id}><input type="radio" name="team" checked={team === id} onChange={() => setTeam(id)} /> <TeamBadge team={id} /></label>
        ))}
        <button>Hrát</button>
        {error && <p className="err">{error}</p>}
      </fieldset>
    </form>
  )
}
