import { useEffect, useMemo, useRef, useState } from 'react'
import MapView from './MapView.jsx'
import { api } from './api.js'
import { CheckinOverlay } from './checkin.jsx'
import { TEAMS, distanceM, formatDistance } from './geo.js'
import { GROUPS, groupIcon } from './groups.js'
import { checkinRadius, useCheckin, useGame, useOnline, usePosition } from './hooks.js'
import { EventsPage, LeaderboardPage, PoiInfoPage, ProfilePage, TransportPage } from './pages.jsx'
import { DEMO, Icon, KctMark, TeamBadge, TeamIcon, go } from './ui.jsx'

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
  try { return JSON.parse(localStorage.getItem('krajanek-player')) } catch { return null }
}

function clearPlayer() {
  localStorage.removeItem('krajanek-player')
  localStorage.removeItem('krajanek-token')
  localStorage.removeItem('krajanek-checkin')
}

export default function App() {
  const [player, setPlayer] = useState(loadPlayer)
  const [kicked, setKicked] = useState(false)
  // Backend token nezná (restart v paměťovém režimu, token z mocku) -> znovu onboarding.
  useEffect(() => {
    const onUnauthorized = () => {
      clearPlayer()
      setKicked(true)
      setPlayer(null)
      go('')
    }
    window.addEventListener('krajanek-unauthorized', onUnauthorized)
    return () => window.removeEventListener('krajanek-unauthorized', onUnauthorized)
  }, [])
  const logout = () => {
    clearPlayer()
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
  if (route.page === 'udalosti') page = <EventsPage poiById={poiById} position={position} visited={visited} onShow={showOnMap} />
  if (route.page === 'profil') page = <ProfilePage player={player} me={me} poiById={poiById} onShow={showOnMap} onLogout={onLogout} />

  const tab = (id, icon, label, extra = '') => (
    <button className={`${extra}${route.page === id ? ' active' : ''}`} onClick={() => go(id)}>
      <span className="tab-icon"><Icon name={icon} fill={route.page === id} /></span>
      <span>{label}</span>
    </button>
  )

  return (
    <div className="app" style={{ '--team': TEAMS[team]?.color }}>
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
        {game.loadError && <div className="banner err"><Icon name="error" /> {game.loadError} <button className="text-btn" onClick={game.retryLoad}>Zkusit znovu</button></div>}
        {geoError && !DEMO && <div className="banner"><Icon name="location_off" /> {geoError}</div>}
        {game.newSeason && (
          <div className="banner info">
            <Icon name="restart_alt" /> Začala nová sezóna {game.newSeason}. Body se vynulovaly, všechna místa jdou zabrat znovu.
            <button className="banner-close" onClick={game.clearNewSeason} aria-label="Zavřít"><Icon name="close" /></button>
          </div>
        )}
      </div>
      <nav className="navbar">
        {tab('zebricek', 'trophy', 'Žebříček')}
        {tab('udalosti', 'flag', 'Questy', 'quests')}
        {tab('profil', 'person', 'Profil')}
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
  const filterActive = Object.entries(filters).some(([k, v]) => v !== EMPTY_FILTERS[k])

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
  const stop = sel?.nearest_stop

  function claim() {
    if (selVisit) return flash('Už zabráno')
    if (!position) return flash(DEMO ? 'Klikni do mapy, kde stojíš' : 'Bez polohy')
    if (!inRange) return flash(`Mimo dosah · ${formatDistance(dist)}`)
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

      <header className="topbar">
        <div className="brand">
          <KctMark team={team} className="brand-kct" />
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

      <CheckinOverlay checkin={checkin} team={team} selectedId={sel?.id} />
      {toast && <div className="toast"><Icon name="location_off" /> {toast}</div>}

      {sel && !filterOpen && (
        <div className="poi-panel">
          <div className="signpost">
            <button className="signpost-close" onClick={() => setSelectedId(null)} aria-label="Zavřít"><Icon name="close" /></button>
            <div className="signpost-title">{sel.name}</div>
            <div className="signpost-meta">
              {selLive.event_multiplier
                ? <span className="pts">{selLive.bonus_points} b. ×{selLive.event_multiplier}</span>
                : <span className="pts">{sel.points} b.</span>}
              {dist != null && <span><Icon name="near_me" />{formatDistance(dist)}</span>}
              {stop && <span><Icon name={stop.type === 'train' ? 'train' : 'directions_bus'} />{formatDistance(stop.distance_m)}</span>}
              {selLive.owner_team && <span><Icon name="flag" fill /><TeamBadge team={selLive.owner_team} /></span>}
            </div>
            {selVisit && <div className="signpost-visit"><Icon name="check_circle" fill /> Zabráno {new Date(selVisit.at).toLocaleDateString('cs')} · +{selVisit.points} b.</div>}
          </div>
          <div className="poi-buttons">
            <button className="round-btn big" onClick={() => go('doprava', sel.id)} aria-label="Doprava"><Icon name="directions_bus" /></button>
            <button className="round-btn big" onClick={() => go('info', sel.id)} aria-label="Informace"><Icon name="info" /></button>
            <button className={`claim${inRange && !selVisit ? '' : ' far'}`} onClick={claim} disabled={busy}>
              {selVisit ? <>Zabráno <Icon name="check" /></> : busy && cs.poiId === sel.id ? 'Zabírám…' : <>Zabrat <Icon name="flag" fill /></>}
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
  const toggle = (k, icon, label) => (
    <label className="row toggle">
      <Icon name={icon} />
      <span>{label}</span>
      <input type="checkbox" checked={filters[k]} onChange={setF(k)} />
      <i />
    </label>
  )
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
      <select value={filters.owner} onChange={setF('owner')}>
        <option value="">Kdokoli drží</option>
        <option value="none">Nikdo nedrží</option>
        {Object.entries(TEAMS).map(([id, t]) => <option key={id} value={id}>Drží {t.label}</option>)}
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
      {toggle('nearStop', 'directions_bus', '≤ 500 m')}
      {toggle('bonus', 'bolt', 'Jen bonus')}
      {toggle('unvisited', 'flag', 'Jen nezabrané')}
      <div className="filter-foot">
        <button className="text-btn" onClick={() => setFilters(EMPTY_FILTERS)}><Icon name="restart_alt" /> Reset</button>
        <span className="count">{count}<small> / {pois.length}</small></span>
      </div>
    </div>
  )
}

// Onboarding ve dvou krocích: 1) účet (nový hráč / přihlášení jménem a heslem), 2) tým (jen nový hráč).
const MIN_PASSWORD = 6

function Onboarding({ onDone, kicked }) {
  const [mode, setMode] = useState('new') // new | login
  const [step, setStep] = useState('account') // account | team
  const [name, setName] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [team, setTeam] = useState(null)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  const accountOk = name.trim() && password.length >= (mode === 'new' ? MIN_PASSWORD : 1)

  function finish({ player_id, token, name: n, team: t }) {
    const player = { player_id, name: n, team: t }
    localStorage.setItem('krajanek-token', token)
    localStorage.setItem('krajanek-player', JSON.stringify(player))
    onDone(player)
  }

  async function submitAccount(e) {
    e.preventDefault()
    if (!accountOk) return
    setError(null)
    if (mode === 'new') return setStep('team')
    setBusy(true)
    try {
      finish(await api.login({ name: name.trim(), password }))
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  async function submitTeam(e) {
    e.preventDefault()
    if (!team) return
    setBusy(true)
    setError(null)
    try {
      finish(await api.createPlayer({ name: name.trim(), team, password }))
    } catch (err) {
      setError(err.message)
      if (err.code === 'NAME_TAKEN' || err.code === 'INVALID_NAME' || err.code === 'INVALID_PASSWORD') setStep('account')
    } finally {
      setBusy(false)
    }
  }

  const brand = (
    <div className="onboarding-brand">
      <KctMark team={team || 'lesy'} />
      <h1>Krajánek</h1>
    </div>
  )

  if (step === 'team') {
    return (
      <form className="onboarding" onSubmit={submitTeam} style={{ '--team': team ? TEAMS[team].color : undefined }}>
        {brand}
        <div className="field">
          <span>Vyber tým, {name.trim()}</span>
          <div className="team-pick">
            {Object.entries(TEAMS).map(([id, t]) => (
              <button type="button" key={id} className={`team-card${team === id ? ' active' : ''}`} style={{ '--c': t.color }}
                onClick={() => setTeam(id)} aria-pressed={team === id} disabled={busy}>
                <TeamIcon team={id} size={44} />
                <KctMark team={id} className="big" />
                <span>{t.label}</span>
              </button>
            ))}
          </div>
        </div>
        <button className="play" disabled={busy || !team}>
          {busy ? 'Zakládám…' : <>Hrát <Icon name="arrow_forward" /></>}
        </button>
        <button type="button" className="text-btn back-btn" onClick={() => { setError(null); setStep('account') }} disabled={busy}>
          <Icon name="arrow_back" /> Zpět
        </button>
        {error && <p className="err">{error}</p>}
      </form>
    )
  }

  return (
    <form className="onboarding" onSubmit={submitAccount}>
      {brand}
      {kicked && <p className="err">Server tvůj účet nezná. Přihlas se znovu, případně si založ nový účet.</p>}
      <div className="mode-switch" role="tablist">
        <button type="button" role="tab" aria-selected={mode === 'new'} className={mode === 'new' ? 'active' : ''}
          onClick={() => { setMode('new'); setError(null) }}>Nový hráč</button>
        <button type="button" role="tab" aria-selected={mode === 'login'} className={mode === 'login' ? 'active' : ''}
          onClick={() => { setMode('login'); setError(null) }}>Přihlásit se</button>
      </div>
      <label className="field">
        <span>Jméno</span>
        <input className="name-input" required maxLength={40} autoComplete="username" value={name}
          onChange={(e) => setName(e.target.value)} disabled={busy} />
      </label>
      <label className="field">
        <span>Heslo{mode === 'new' && ` (aspoň ${MIN_PASSWORD} znaků)`}</span>
        <div className="password-row">
          <input className="name-input" required type={showPassword ? 'text' : 'password'} maxLength={200}
            autoComplete={mode === 'new' ? 'new-password' : 'current-password'} value={password}
            onChange={(e) => setPassword(e.target.value)} disabled={busy} />
          <button type="button" className="round-btn ghost" onClick={() => setShowPassword(!showPassword)}
            aria-label={showPassword ? 'Skrýt heslo' : 'Zobrazit heslo'}>
            <Icon name={showPassword ? 'visibility_off' : 'visibility'} />
          </button>
        </div>
      </label>
      <button className="play" disabled={busy || !accountOk}>
        {busy ? 'Přihlašuji…' : mode === 'new' ? <>Pokračovat <Icon name="arrow_forward" /></> : <>Přihlásit <Icon name="login" /></>}
      </button>
      {error && <p className="err">{error}</p>}
    </form>
  )
}
