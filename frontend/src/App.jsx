import { useEffect, useMemo, useRef, useState } from 'react'
import MapView from './MapView.jsx'
import { api, loadPois, resetMock, usingMock } from './api.js'
import { TEAMS, distanceM, formatDistance } from './geo.js'

const DEMO = new URLSearchParams(location.search).has('demo')
const PING_EVERY_MS = 5000

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

function loadPlayer() {
  try { return JSON.parse(localStorage.getItem('turistak-player')) } catch { return null }
}

export default function App() {
  const [pois, setPois] = useState([])
  const [owners, setOwners] = useState({})
  const [player, setPlayer] = useState(loadPlayer)
  const [position, setPosition] = usePosition()
  const [selectedId, setSelectedId] = useState(null)
  const [filters, setFilters] = useState({ q: '', group: '', category: '', minPoints: 0, maxKm: '', nearStop: false })

  useEffect(() => { loadPois().then(setPois) }, [])
  const refreshOwners = () => api.poiOwners().then(setOwners)
  useEffect(() => { refreshOwners() }, [])

  const groups = useMemo(() => [...new Set(pois.map((f) => f.properties.group))].sort(), [pois])
  const categories = useMemo(() => {
    const m = new Map()
    for (const f of pois) if (!filters.group || f.properties.group === filters.group) m.set(f.properties.category, f.properties.category_label)
    return [...m].sort((a, b) => a[1].localeCompare(b[1], 'cs'))
  }, [pois, filters.group])

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

  const selected = pois.find((f) => f.properties.id === selectedId)
  const setF = (k) => (e) => setFilters({ ...filters, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value })

  if (!player) return <Onboarding onDone={setPlayer} />

  return (
    <div className="app">
      <header>
        <b>Turisťák</b> – Objevuj, dobývej, poznávej kraj.
        {usingMock && <small> [mock API]</small>}
        {DEMO && <small> [demo: klikni do mapy = tvoje poloha]</small>}
      </header>
      <MapView
        pois={filtered}
        owners={owners}
        selectedId={selectedId}
        onSelect={setSelectedId}
        position={position}
        demo={DEMO}
        onDemoClick={(lat, lon) => setPosition({ lat, lon, accuracy_m: 5 })}
      />
      <aside>
        <p>
          Hráč <b>{player.name}</b>, tým <TeamBadge team={player.team} />{' '}
          <button onClick={() => { localStorage.removeItem('turistak-player'); localStorage.removeItem('turistak-token'); setPlayer(null) }}>odhlásit</button>
        </p>
        <p>Poloha: {position ? `${position.lat.toFixed(5)}, ${position.lon.toFixed(5)} (±${Math.round(position.accuracy_m)} m)` : DEMO ? 'klikni do mapy' : 'čekám na GPS…'}</p>

        {selected && (
          <Detail
            key={selected.properties.id}
            poi={selected}
            position={position}
            player={player}
            owner={owners[selected.properties.id]}
            onClose={() => setSelectedId(null)}
            onCaptured={refreshOwners}
          />
        )}

        <fieldset>
          <legend>Filtry ({filtered.length} / {pois.length})</legend>
          <input placeholder="hledat název / obec" value={filters.q} onChange={setF('q')} />
          <select value={filters.group} onChange={(e) => setFilters({ ...filters, group: e.target.value, category: '' })}>
            <option value="">všechny skupiny</option>
            {groups.map((g) => <option key={g} value={g}>{g}</option>)}
          </select>
          <select value={filters.category} onChange={setF('category')}>
            <option value="">všechny kategorie</option>
            {categories.map(([c, label]) => <option key={c} value={c}>{label}</option>)}
          </select>
          <label>min. body: {filters.minPoints} <input type="range" min="0" max="100" step="5" value={filters.minPoints} onChange={(e) => setFilters({ ...filters, minPoints: +e.target.value })} /></label>
          <label>do km ode mě: <input type="number" min="0" style={{ width: 60 }} value={filters.maxKm} onChange={setF('maxKm')} disabled={!position} /></label>
          <label><input type="checkbox" checked={filters.nearStop} onChange={setF('nearStop')} /> zastávka do 500 m</label>
        </fieldset>

        <Leaderboard />
        {usingMock && <button onClick={() => { resetMock(); location.reload() }}>reset mock dat</button>}
      </aside>
    </div>
  )
}

function TeamBadge({ team }) {
  const t = TEAMS[team]
  return <span style={{ color: '#fff', background: t.color, padding: '0 6px', borderRadius: 4 }}>{t.label}</span>
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
        {Object.entries(TEAMS).map(([id, t]) => (
          <label key={id}><input type="radio" name="team" checked={team === id} onChange={() => setTeam(id)} /> <TeamBadge team={id} /></label>
        ))}
        <button>Hrát</button>
        {error && <p className="err">{error}</p>}
      </fieldset>
    </form>
  )
}

function Detail({ poi, position, player, owner, onClose, onCaptured }) {
  const p = poi.properties
  const [lon, lat] = poi.geometry.coordinates
  const dist = position ? distanceM(position.lat, position.lon, lat, lon) : null
  const stop = p.nearest_stop
  return (
    <fieldset className="detail">
      <legend>{p.name} <button onClick={onClose}>×</button></legend>
      <p>
        <b>{p.points} b.</b> · {p.category_label}{p.is_nkp && ' · NKP'} · {p.municipality || '–'}
        {dist != null && <> · {formatDistance(dist)} ode mě</>}
        {owner && <> · drží <TeamBadge team={owner} /></>}
      </p>
      {p.description && <p className="desc">{p.description}</p>}
      {p.web && <p><a href={p.web} target="_blank" rel="noreferrer">{p.web}</a></p>}
      {stop && (
        <p>
          🚏 {stop.type === 'train' ? 'vlak' : 'bus'} <b>{stop.name}</b> ({formatDistance(stop.distance_m)}){' '}
          <a href={p.idos_url} target="_blank" rel="noreferrer">Najít spoj (IDOS)</a>
          {p.nearest_train && stop.type !== 'train' && <><br />🚆 vlak {p.nearest_train.name} ({formatDistance(p.nearest_train.distance_m)})</>}
        </p>
      )}
      <CheckIn poi={poi} position={position} onCaptured={onCaptured} />
    </fieldset>
  )
}

function CheckIn({ poi, position, onCaptured }) {
  const [state, setState] = useState({ phase: 'idle' }) // idle | running | done | error
  const posRef = useRef(position)
  posRef.current = position
  const timer = useRef(null)
  useEffect(() => () => clearInterval(timer.current), [])

  async function start() {
    if (!posRef.current) return setState({ phase: 'error', msg: 'Neznám tvoji polohu.' })
    try {
      const { checkin_id, required_seconds } = await api.startCheckin({ poi_id: poi.properties.id, ...posRef.current })
      setState({ phase: 'running', elapsed: 0, required: required_seconds, valid: true })
      timer.current = setInterval(async () => {
        try {
          const { elapsed_s, valid } = await api.ping(checkin_id, posRef.current)
          if (elapsed_s >= required_seconds) {
            clearInterval(timer.current)
            const res = await api.finish(checkin_id)
            setState({ phase: 'done', ...res })
            onCaptured()
          } else {
            setState({ phase: 'running', elapsed: elapsed_s, required: required_seconds, valid })
          }
        } catch (e) {
          clearInterval(timer.current)
          setState({ phase: 'error', msg: e.message })
        }
      }, PING_EVERY_MS)
    } catch (e) {
      setState({ phase: 'error', msg: e.message })
    }
  }

  if (state.phase === 'running') {
    return (
      <div>
        <progress max={state.required} value={state.elapsed} /> {state.elapsed} / {state.required} s
        {!state.valid && <p className="err">Jsi mimo 100 m (nebo slabé GPS) – odpočet stojí. Vrať se blíž.</p>}
        <button onClick={() => { clearInterval(timer.current); setState({ phase: 'idle' }) }}>zrušit</button>
      </div>
    )
  }
  if (state.phase === 'done') return <p>🎉 Obsazeno! +{state.awarded_points} b., tým má {state.team_score} b.</p>
  return (
    <div>
      <button onClick={start}>Check-in (60 s do 100 m)</button>
      {state.phase === 'error' && <p className="err">{state.msg}</p>}
    </div>
  )
}

function Leaderboard() {
  const [teams, setTeams] = useState([])
  const [season, setSeason] = useState(null)
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const load = () => { api.teams().then(setTeams); api.currentSeason().then(setSeason) }
    load()
    const id = setInterval(load, 10000)
    const tick = setInterval(() => setNow(Date.now()), 1000)
    return () => { clearInterval(id); clearInterval(tick) }
  }, [])
  const left = season ? Math.max(0, new Date(season.ends_at) - now) : 0
  const d = Math.floor(left / 86400000)
  const h = Math.floor((left % 86400000) / 3600000)
  const m = Math.floor((left % 3600000) / 60000)
  return (
    <fieldset>
      <legend>Žebříček {season?.season_id}</legend>
      <ol>
        {teams.map((t) => <li key={t.team}><TeamBadge team={t.team} /> {t.score} b. ({t.members} hráčů)</li>)}
      </ol>
      {season && <small>Konec sezóny za {d} d {h} h {m} min</small>}
    </fieldset>
  )
}
