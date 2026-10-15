import { useEffect, useMemo, useRef, useState } from 'react'
import MapView from './MapView.jsx'
import { api } from './api.js'
import { CheckinOverlay } from './checkin.jsx'
import { TEAMS, distanceM, formatDistance } from './geo.js'
import { GROUPS, groupIcon } from './groups.js'
import { checkinRadius, useCheckin, useGame, useOnline, usePosition } from './hooks.js'
import { EventsPage, LeaderboardPage, PoiInfoPage, ProfilePage, TransportPage } from './pages.jsx'
import { DEMO, Icon, TeamBadge, go } from './ui.jsx'

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

function loadPlayer() {
  try { return JSON.parse(localStorage.getItem('turistak-player')) } catch { return null }
}

export default function App() {
  const [player, setPlayer] = useState(loadPlayer)
  const [kicked, setKicked] = useState(false)
  // Backend token nezná (restart v paměťovém režimu, token z mocku) -> znovu onboarding.
  useEffect(() => {
    const onUnauthorized = () => {
      localStorage.removeItem('turistak-player')
      localStorage.removeItem('turistak-token')
      localStorage.removeItem('turistak-checkin')
      setKicked(true)
      setPlayer(null)
      go('')
    }
    window.addEventListener('turistak-unauthorized', onUnauthorized)
    return () => window.removeEventListener('turistak-unauthorized', onUnauthorized)
  }, [])
  const logout = () => {
    localStorage.removeItem('turistak-player')
    localStorage.removeItem('turistak-token')
    localStorage.removeItem('turistak-checkin')
    setKicked(false)
    setPlayer(null)
    go('')
  }
  if (!player) return <Onboarding kicked={kicked} onDone={(p) => { setKicked(false); setPlayer(p) }} />
  return <Game player={player} onLogout={logout} />
}

function Game({ player, onLogout }) {
  const game = useGame()
  const { pois, live, visited, me, season } = game
  const online = useOnline()
  const [position, setPosition, geoError] = usePosition()
  const [selectedId, setSelectedId] = useState(null)
  const route = useRoute()
  const checkin = useCheckin(position, game.refresh)

  const poiById = useMemo(() => new Map(pois.map((f) => [f.properties.id, f])), [pois])
  const routePoi = route.id && poiById.get(route.id)
  const showOnMap = (id) => { setSelectedId(id); go('') }
  const team = me?.team || player.team

  let page = null
  if (route.page === 'info' && routePoi) page = <PoiInfoPage poi={routePoi} live={live[routePoi.properties.id]} visit={visited.get(routePoi.properties.id)} />
  if (route.page === 'doprava' && routePoi) page = <TransportPage poi={routePoi} position={position} />
  if (route.page === 'zebricek') page = <LeaderboardPage season={season} myTeam={team} />
  if (route.page === 'udalosti') page = <EventsPage pois={pois} poiById={poiById} position={position} visited={visited} onShow={showOnMap} />
  if (route.page === 'profil') page = <ProfilePage player={player} me={me} poiById={poiById} onShow={showOnMap} onLogout={onLogout} />

  return (
    <div className="app">
      <MapPage
        pois={pois}
        live={live}
        visited={visited}
        team={team}
        position={position}
        setPosition={setPosition}
        selected={selectedId && poiById.get(selectedId)}
        setSelectedId={setSelectedId}
        checkin={checkin}
      />
      <div className="banners">
        {!online && <div className="banner err"><Icon name="cloud_off" /> Server je nedostupný, zkouším to znovu…</div>}
        {game.loadError && <div className="banner err">{game.loadError} <button onClick={game.retryLoad}>Zkusit znovu</button></div>}
        {geoError && !DEMO && <div className="banner"><Icon name="location_off" /> {geoError}</div>}
        {game.newSeason && (
          <div className="banner info">
            <Icon name="restart_alt" /> Začala nová sezóna {game.newSeason}. Body se vynulovaly, všechna místa jdou zabrat znovu.
            <button className="link" onClick={game.clearNewSeason} aria-label="Zavřít"><Icon name="close" /></button>
          </div>
        )}
      </div>
      <nav className="navbar">
        <button onClick={() => go('zebricek')}><Icon name="leaderboard" /><br />Žebříček</button>
        <button onClick={() => go('udalosti')}><Icon name="timer" /><br />Události</button>
        <button onClick={() => go('profil')}><Icon name="person" /><br />Profil</button>
      </nav>
      {page && <div className="page">{page}</div>}
    </div>
  )
}

const EMPTY_FILTERS = { q: '', group: '', category: '', minPoints: 0, maxKm: '', nearStop: false, bonus: false, unvisited: false, owner: '' }

function MapPage({ pois, live, visited, team, position, setPosition, selected, setSelectedId, checkin }) {
  const [filters, setFilters] = useState(EMPTY_FILTERS)
  const [filterOpen, setFilterOpen] = useState(false)
  const [toast, setToast] = useState(null)
  const toastTimer = useRef(null)
  const flash = (msg) => {
    setToast(msg)
    clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(null), 3500)
  }

  const filtered = useMemo(() => {
    const q = filters.q.trim().toLowerCase()
    return pois.filter((f) => {
      const p = f.properties
      const l = live[p.id] || {}
      if (q && !p.name.toLowerCase().includes(q) && !(p.municipality || '').toLowerCase().includes(q)) return false
      if (filters.group && p.group !== filters.group) return false
      if (filters.category && p.category !== filters.category) return false
      if ((l.bonus_points ?? p.points) < filters.minPoints) return false
      if (filters.nearStop && !(p.nearest_stop && p.nearest_stop.distance_m <= 500)) return false
      if (filters.bonus && !l.event_multiplier) return false
      if (filters.unvisited && visited.has(p.id)) return false
      if (filters.owner && (l.owner_team || 'none') !== filters.owner) return false
      if (filters.maxKm && position) {
        const [lon, lat] = f.geometry.coordinates
        if (distanceM(position.lat, position.lon, lat, lon) > filters.maxKm * 1000) return false
      }
      return true
    })
  }, [pois, live, visited, filters, position])
  const activeFilters = Object.entries(filters).filter(([k, v]) => v !== EMPTY_FILTERS[k]).length

  const sel = selected?.properties
  const selLive = (sel && live[sel.id]) || {}
  const selVisit = sel && visited.get(sel.id)
  const dist = selected && position
    ? distanceM(position.lat, position.lon, selected.geometry.coordinates[1], selected.geometry.coordinates[0])
    : null
  const radius = checkinRadius()
  const inRange = dist != null && dist <= radius
  const cs = checkin.state
  const busy = cs.phase === 'running' || cs.phase === 'starting'

  function claim() {
    if (selVisit) return flash('Tohle místo už máš v této sezóně zabrané.')
    if (!position) return flash(DEMO ? 'Klikni do mapy, kde stojíš.' : 'Neznám tvoji polohu.')
    if (!inRange) return flash(`Jsi mimo dosah (${formatDistance(dist)}, potřeba do ${radius} m).`)
    checkin.start(selected)
  }

  return (
    <div className="map-wrap">
      <MapView
        pois={filtered}
        live={live}
        visited={visited}
        selectedId={sel?.id}
        onSelect={setSelectedId}
        position={position}
        demo={DEMO}
        onDemoClick={(lat, lon) => setPosition({ lat, lon, accuracy_m: 5 })}
      />
      {DEMO && <div className="overlay demo-hint">demo: klik do mapy = tvoje poloha</div>}

      <button className="overlay round filter-btn" onClick={() => setFilterOpen(!filterOpen)} aria-label="Filtr">
        <Icon name="filter_alt" />
        {activeFilters > 0 && <span className="count">{activeFilters}</span>}
      </button>
      {filterOpen && (
        <Filters pois={pois} filters={filters} setFilters={setFilters} count={filtered.length} position={position} />
      )}

      <CheckinOverlay checkin={checkin} team={team} selectedId={sel?.id} />
      {toast && <div className="overlay toast">{toast}</div>}

      {sel && (
        <div className="overlay poi-actions">
          <div className="poi-label">
            <div>
              <b>{sel.name}</b>
              <button className="link" onClick={() => setSelectedId(null)} aria-label="Zrušit výběr"><Icon name="close" /></button>
            </div>
            <div className="poi-meta">
              {selLive.event_multiplier
                ? <><s>{sel.points}</s> <b>{selLive.bonus_points} b.</b> <span className="chip bonus">×{selLive.event_multiplier}</span></>
                : <b>{sel.points} b.</b>}
              {dist != null && ` · ${formatDistance(dist)}`}
              {selLive.owner_team && <> · drží <TeamBadge team={selLive.owner_team} /></>}
            </div>
            {selVisit && <div className="poi-meta visited-note"><Icon name="check_circle" /> Zabráno {new Date(selVisit.at).toLocaleDateString('cs')} (+{selVisit.points} b.)</div>}
          </div>
          <div className="buttons">
            <button className="round" onClick={() => go('doprava', sel.id)} aria-label="Doprava"><Icon name="directions_bus" /></button>
            <button className="round" onClick={() => go('info', sel.id)} aria-label="Informace"><Icon name="question_mark" /></button>
            <button className={`claim ${inRange && !selVisit ? '' : 'disabled'}`} onClick={claim} disabled={busy}>
              {selVisit ? 'Zabráno' : busy && cs.poiId === sel.id ? 'Zabírám…' : 'Zabrat'}
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
    <div className="overlay filter-panel">
      <b>Filtr ({count} / {pois.length})</b>
      <input placeholder="hledat název / obec" value={filters.q} onChange={setF('q')} />
      <div className="group-chips">
        {groups.map((g) => (
          <button key={g} title={GROUPS[g]?.label ?? g} className={filters.group === g ? 'active' : ''}
            onClick={() => setFilters({ ...filters, group: filters.group === g ? '' : g, category: '' })}>
            <Icon name={groupIcon(g)} />
          </button>
        ))}
      </div>
      {filters.group && <small>{GROUPS[filters.group]?.label}</small>}
      <select value={filters.category} onChange={setF('category')}>
        <option value="">všechny kategorie</option>
        {categories.map(([c, label]) => <option key={c} value={c}>{label}</option>)}
      </select>
      <select value={filters.owner} onChange={setF('owner')}>
        <option value="">kdokoli drží</option>
        <option value="none">nikdo nedrží</option>
        {Object.entries(TEAMS).map(([id, t]) => <option key={id} value={id}>drží {t.label}</option>)}
      </select>
      <label>min. body: {filters.minPoints} <input type="range" min="0" max="100" step="5" value={filters.minPoints} onChange={(e) => setFilters({ ...filters, minPoints: +e.target.value })} /></label>
      <label>do km ode mě: <input type="number" min="0" style={{ width: 60 }} value={filters.maxKm} onChange={setF('maxKm')} disabled={!position} /></label>
      <label><input type="checkbox" checked={filters.nearStop} onChange={setF('nearStop')} /> zastávka do 500 m</label>
      <label><input type="checkbox" checked={filters.bonus} onChange={setF('bonus')} /> jen bonusová místa</label>
      <label><input type="checkbox" checked={filters.unvisited} onChange={setF('unvisited')} /> jen nezabraná mnou</label>
      <button onClick={() => setFilters(EMPTY_FILTERS)}>zrušit filtr</button>
    </div>
  )
}

function Onboarding({ onDone, kicked }) {
  const [name, setName] = useState('')
  const [team, setTeam] = useState('hory')
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  async function submit(e) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const { player_id, token } = await api.createPlayer({ name: name.trim(), team })
      const player = { player_id, name: name.trim(), team }
      localStorage.setItem('turistak-token', token)
      localStorage.setItem('turistak-player', JSON.stringify(player))
      onDone(player)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <form className="onboarding" onSubmit={submit}>
      <h1>Turisťák</h1>
      <p>Objevuj, dobývej, poznávej kraj.</p>
      {kicked && <p className="err">Server tvůj účet nezná (nejspíš se restartoval). Založ si prosím hráče znovu.</p>}
      <fieldset disabled={busy}>
        <legend>Jak se jmenuješ a za koho hraješ?</legend>
        <input required maxLength={40} placeholder="jméno" value={name} onChange={(e) => setName(e.target.value)} />
        {Object.entries(TEAMS).map(([id]) => (
          <label key={id}><input type="radio" name="team" checked={team === id} onChange={() => setTeam(id)} /> <TeamBadge team={id} /></label>
        ))}
        <button>{busy ? 'Zakládám…' : 'Hrát'}</button>
        {error && <p className="err">{error}</p>}
      </fieldset>
    </form>
  )
}
