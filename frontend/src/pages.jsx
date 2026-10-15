import { useEffect, useState } from 'react'
import { api, loadStops, resetMock, usingMock } from './api.js'
import { TEAMS, distanceM, formatDistance } from './geo.js'
import { Icon, PageHeader, TeamBadge } from './ui.jsx'

const StopIcon = ({ type }) => <Icon name={type === 'train' ? 'train' : 'directions_bus'} />

const idosUrl = (from, to) => 'https://idos.cz/vlakyautobusy/spojeni/?' + new URLSearchParams({ f: from || '', t: to })
const poiLatLon = (poi) => ({ lat: poi.geometry.coordinates[1], lon: poi.geometry.coordinates[0] })

// --- Info o POI: body týmů na místě, info o týmech, dole text o místě ---
export function PoiInfoPage({ poi, owner }) {
  const p = poi.properties
  const [stats, setStats] = useState(null)
  const [teams, setTeams] = useState([])
  useEffect(() => {
    api.poiStats(p.id).then(setStats)
    api.teams().then(setTeams)
  }, [p.id])
  const holder = stats?.last_team || owner

  return (
    <>
      <PageHeader title={p.name} />
      <p><b>{p.points} b.</b> za zabrání · {p.category_label}{p.is_nkp && ' · národní kulturní památka'}</p>

      <h3>Týmy na tomto místě (tato sezóna)</h3>
      <p>{holder ? <>Místo drží <TeamBadge team={holder} /></> : 'Místo zatím nikdo nezabral.'}</p>
      <table>
        <thead><tr><th>Tým</th><th>Body tady</th><th>Návštěvy</th><th>Celkem v sezóně</th><th>Hráči</th></tr></thead>
        <tbody>
          {Object.keys(TEAMS).map((t) => {
            const total = teams.find((x) => x.team === t)
            return (
              <tr key={t}>
                <td><TeamBadge team={t} /></td>
                <td>{stats?.teams?.[t]?.points ?? '–'}</td>
                <td>{stats?.teams?.[t]?.visits ?? '–'}</td>
                <td>{total?.score ?? '–'}</td>
                <td>{total?.members ?? '–'}</td>
              </tr>
            )
          })}
        </tbody>
      </table>

      <h3>O místě</h3>
      <p>{p.municipality || ''}</p>
      {p.description ? <p>{p.description}</p> : <p><i>Popis zatím nemáme.</i></p>}
      {p.web && <p><a href={p.web} target="_blank" rel="noreferrer">{p.web}</a></p>}
      <p><small>Zdroj: {p.source} (data Královéhradeckého kraje)</small></p>
    </>
  )
}

// --- Doprava: vzdálenost, zastávky, IDOS ---
export function TransportPage({ poi, position }) {
  const p = poi.properties
  const target = poiLatLon(poi)
  const dist = position ? distanceM(position.lat, position.lon, target.lat, target.lon) : null
  const [myStop, setMyStop] = useState(null)

  useEffect(() => {
    if (!position) return
    loadStops().then((stops) => {
      let best = null
      for (const s of stops) {
        const [lon, lat] = s.geometry.coordinates
        const d = distanceM(position.lat, position.lon, lat, lon)
        if (!best || d < best.d) best = { name: s.properties.name, type: s.properties.type, d }
      }
      setMyStop(best)
    })
  }, [position?.lat, position?.lon]) // eslint-disable-line react-hooks/exhaustive-deps

  const stops = [p.nearest_bus, p.nearest_train].filter(Boolean).sort((a, b) => a.distance_m - b.distance_m)

  return (
    <>
      <PageHeader title={`Doprava: ${p.name}`} />
      <p>Vzdušnou čarou ode mě: <b>{dist != null ? formatDistance(dist) : 'neznám tvoji polohu'}</b></p>
      <p>
        Moje nejbližší zastávka:{' '}
        {myStop ? <><StopIcon type={myStop.type} /> {myStop.name} ({formatDistance(myStop.d)})</> : '–'}
      </p>

      <h3>Zastávky u místa</h3>
      <ul>
        {stops.map((s) => (
          <li key={s.type}>
            <StopIcon type={s.type} /> {s.type === 'train' ? 'vlak' : 'bus'} <b>{s.name}</b>, {formatDistance(s.distance_m)} od místa
            <br />
            <a href={idosUrl(myStop?.name, s.name)} target="_blank" rel="noreferrer">
              Najít spoj v IDOS{myStop ? ` z ${myStop.name}` : ''}
            </a>
          </li>
        ))}
      </ul>

      <h3>Na kole</h3>
      {p.category === 'cyklovylety'
        ? <p>Tohle je start cyklovýletu. {p.description}</p>
        : <p><i>Info o cyklostezkách zatím nemáme (chybí datová sada).</i></p>}
    </>
  )
}

// --- Žebříček ---
export function LeaderboardPage() {
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
    <>
      <PageHeader title={`Žebříček ${season?.season_id || ''}`} />
      <ol>
        {teams.map((t) => <li key={t.team}><TeamBadge team={t.team} /> {t.score} b. ({t.members} hráčů)</li>)}
      </ol>
      {season && <p>Konec sezóny za {d} d {h} h {m} min</p>}
    </>
  )
}

// --- Quick time eventy ---
export function EventsPage({ pois, position, onShow }) {
  const [events, setEvents] = useState([])
  useEffect(() => { api.activeEvents().then(setEvents) }, [])
  return (
    <>
      <PageHeader title="Události" />
      {events.length === 0 && <p>Teď neběží žádná událost.</p>}
      {events.map((e) => {
        const poi = pois.find((f) => f.properties.id === e.poi_id)
        if (!poi) return null
        const p = poi.properties
        const t = poiLatLon(poi)
        const dist = position ? distanceM(position.lat, position.lon, t.lat, t.lon) : null
        return (
          <div key={e.id} className="card">
            <b>Do {new Date(e.ends_at).toLocaleDateString('cs')} navštiv {p.name}</b>
            <div>×{e.multiplier} bodů = {p.points * e.multiplier} b. · {p.municipality}{dist != null && ` · ${formatDistance(dist)}`}</div>
            <button onClick={() => onShow(p.id)}>Ukázat na mapě</button>
          </div>
        )
      })}
    </>
  )
}

// --- Profil: uživatel, odznaky, nastavení ---
const BADGES = [
  { id: 'first', label: 'První zábor', need: 1, test: () => true },
  { id: 'five', label: '5 míst', need: 5, test: () => true },
  { id: 'twenty', label: '20 míst', need: 20, test: () => true },
  { id: 'castles', label: 'Hradní pán (3 hrady/zámky)', need: 3, test: (p) => ['hrady', 'zamky'].includes(p.category) },
  { id: 'views', label: 'Rozhledna (3 rozhledny)', need: 3, test: (p) => p.category === 'rozhledny' },
  { id: 'nature', label: 'Přírodovědec (3 přírodní)', need: 3, test: (p) => p.group === 'priroda' },
  { id: 'nkp', label: 'Národní poklad (1 NKP)', need: 1, test: (p) => p.is_nkp },
  { id: 'groups', label: 'Všestranný (5 skupin)', need: 5, count: (ps) => new Set(ps.map((p) => p.group)).size },
]

export function ProfilePage({ player, pois, onLogout }) {
  const [checkins, setCheckins] = useState([])
  useEffect(() => { api.myCheckins().then(setCheckins) }, [])
  const rows = checkins
    .map((c) => ({ c, p: pois.find((f) => f.properties.id === c.poi_id)?.properties }))
    .filter((r) => r.p)
  const visited = rows.map((r) => r.p)
  const total = checkins.reduce((a, c) => a + c.awarded_points, 0)

  return (
    <>
      <PageHeader title="Profil" />
      <p><b>{player.name}</b> · <TeamBadge team={player.team} /></p>
      <p>Tato sezóna: {visited.length} míst, {total} b. pro tým</p>

      <h3>Odznaky</h3>
      <ul className="badges">
        {BADGES.map((b) => {
          const have = b.count ? b.count(visited) : visited.filter(b.test).length
          const done = have >= b.need
          return <li key={b.id} className={done ? '' : 'locked'}><Icon name={done ? 'military_tech' : 'lock'} /> {b.label} ({Math.min(have, b.need)}/{b.need})</li>
        })}
      </ul>

      <h3>Navštívená místa</h3>
      {visited.length === 0 ? <p>Zatím nic.</p> : <ul>{rows.map(({ c, p }) => <li key={c.id}>{p.name} (+{c.awarded_points} b.)</li>)}</ul>}

      <h3>Nastavení</h3>
      <button onClick={onLogout}>Odhlásit</button>{' '}
      {usingMock && <button onClick={() => { resetMock(); location.reload() }}>Reset mock dat</button>}
    </>
  )
}
