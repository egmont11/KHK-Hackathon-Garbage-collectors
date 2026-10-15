import { useEffect, useState } from 'react'
import { api, loadStops, resetMock, usingMock } from './api.js'
import { TEAMS, distanceM, formatDistance } from './geo.js'
import { Icon, PageHeader, TeamBadge, TeamIcon } from './ui.jsx'

const StopIcon = ({ type }) => <Icon name={type === 'train' ? 'train' : 'directions_bus'} />

const idosUrl = (from, to) => 'https://idos.cz/vlakyautobusy/spojeni/?' + new URLSearchParams({ f: from || '', t: to })
const poiLatLon = (poi) => ({ lat: poi.geometry.coordinates[1], lon: poi.geometry.coordinates[0] })

// --- Info o POI: rozcestník, týmy na místě, text o místě ---
export function PoiInfoPage({ poi, owner }) {
  const p = poi.properties
  const [stats, setStats] = useState(null)
  useEffect(() => { api.poiStats(p.id).then(setStats) }, [p.id])
  const holder = stats?.last_team || owner

  return (
    <>
      <PageHeader title="" />
      <div className="signpost static">
        <div className="signpost-title">{p.name}</div>
        <div className="signpost-meta">
          <span className="pts">{p.points} b.</span>
          {p.municipality && <span><Icon name="location_on" />{p.municipality}</span>}
        </div>
      </div>
      <div className="chips">
        <span className="chip">{p.category_label}</span>
        {p.is_nkp && <span className="chip gold"><Icon name="workspace_premium" fill /> NKP</span>}
        {holder && <span className="chip"><Icon name="flag" fill /> <TeamBadge team={holder} /></span>}
      </div>

      <div className="team-stats">
        {Object.keys(TEAMS).map((t) => (
          <div key={t} className={`team-stat${holder === t ? ' holder' : ''}`} style={{ '--c': TEAMS[t].color }}>
            <TeamIcon team={t} size={26} />
            <b>{stats?.teams?.[t]?.points ?? 0}</b>
            <small><Icon name="directions_walk" /> {stats?.teams?.[t]?.visits ?? 0}</small>
          </div>
        ))}
      </div>

      {p.description && <p className="prose">{p.description}</p>}
      {p.web && <a className="btn-outline" href={p.web} target="_blank" rel="noreferrer"><Icon name="language" /> Web</a>}
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
      <PageHeader title={p.name} />
      <div className="stat-row">
        <div className="stat"><Icon name="near_me" /><b>{dist != null ? formatDistance(dist) : '–'}</b></div>
        <div className="stat wide">
          <Icon name="my_location" />
          {myStop ? <span><StopIcon type={myStop.type} /> {myStop.name} <small>{formatDistance(myStop.d)}</small></span> : <b>–</b>}
        </div>
      </div>

      {stops.map((s) => (
        <div key={s.type} className="ticket">
          <div className="ticket-icon"><StopIcon type={s.type} /></div>
          <div className="ticket-body">
            <b>{s.name}</b>
            <small><Icon name="directions_walk" /> {formatDistance(s.distance_m)}</small>
          </div>
          <a className="ticket-btn" href={idosUrl(myStop?.name, s.name)} target="_blank" rel="noreferrer">
            Spoj <Icon name="arrow_outward" />
          </a>
        </div>
      ))}

      {p.category === 'cyklovylety' && (
        <div className="ticket">
          <div className="ticket-icon"><Icon name="directions_bike" /></div>
          <div className="ticket-body"><small>{p.description}</small></div>
        </div>
      )}
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
  const sorted = [...teams].sort((a, b) => b.score - a.score)
  const max = Math.max(1, ...sorted.map((t) => t.score))
  return (
    <>
      <PageHeader title="Žebříček" />
      {season && (
        <div className="season-pill">
          <span>{season.season_id}</span>
          <span><Icon name="hourglass_top" /> {d} d {h} h {m} min</span>
        </div>
      )}
      <div className="leaders">
        {sorted.map((t, i) => (
          <div key={t.team} className="leader" style={{ '--c': TEAMS[t.team]?.color }}>
            <span className="rank">{i + 1}</span>
            <TeamIcon team={t.team} size={30} />
            <div className="leader-body">
              <div className="leader-top">
                <b>{TEAMS[t.team]?.label}</b>
                <span className="score">{t.score.toLocaleString('cs')}</span>
              </div>
              <div className="bar"><i style={{ width: `${(t.score / max) * 100}%` }} /></div>
              <small><Icon name="group" /> {t.members}</small>
            </div>
          </div>
        ))}
      </div>
    </>
  )
}

// --- Quick time eventy ---
export function EventsPage({ pois, position, onShow }) {
  const [events, setEvents] = useState([])
  useEffect(() => { api.activeEvents().then(setEvents) }, [])
  return (
    <>
      <PageHeader title="Questy" />
      {events.length === 0 && <div className="empty"><Icon name="flag" /></div>}
      {events.map((e) => {
        const poi = pois.find((f) => f.properties.id === e.poi_id)
        if (!poi) return null
        const p = poi.properties
        const t = poiLatLon(poi)
        const dist = position ? distanceM(position.lat, position.lon, t.lat, t.lon) : null
        return (
          <button key={e.id} className="quest" onClick={() => onShow(p.id)}>
            <span className="mult">×{e.multiplier}</span>
            <div className="quest-body">
              <b>{p.name}</b>
              <small>
                <span><Icon name="event" /> {new Date(e.ends_at).toLocaleDateString('cs', { day: 'numeric', month: 'numeric' })}</span>
                {dist != null && <span><Icon name="near_me" /> {formatDistance(dist)}</span>}
              </small>
            </div>
            <span className="quest-pts">{p.points * e.multiplier}<small> b.</small></span>
          </button>
        )
      })}
    </>
  )
}

// --- Profil: uživatel, odznaky, nastavení ---
const BADGES = [
  { id: 'first', label: 'První zábor', icon: 'flag', need: 1, test: () => true },
  { id: 'five', label: '5 míst', icon: 'hiking', need: 5, test: () => true },
  { id: 'twenty', label: '20 míst', icon: 'landscape', need: 20, test: () => true },
  { id: 'castles', label: 'Hradní pán', icon: 'castle', need: 3, test: (p) => ['hrady', 'zamky'].includes(p.category) },
  { id: 'views', label: 'Rozhledna', icon: 'visibility', need: 3, test: (p) => p.category === 'rozhledny' },
  { id: 'nature', label: 'Přírodovědec', icon: 'forest', need: 3, test: (p) => p.group === 'priroda' },
  { id: 'nkp', label: 'Národní poklad', icon: 'workspace_premium', need: 1, test: (p) => p.is_nkp },
  { id: 'groups', label: 'Všestranný', icon: 'explore', need: 5, count: (ps) => new Set(ps.map((p) => p.group)).size },
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
      <PageHeader title="" />
      <div className="profile-card">
        <TeamIcon team={player.team} size={40} />
        <div>
          <b>{player.name}</b>
          <TeamBadge team={player.team} />
        </div>
      </div>
      <div className="stat-row">
        <div className="stat"><Icon name="location_on" /><b>{visited.length}</b></div>
        <div className="stat"><Icon name="star" /><b>{total}</b></div>
      </div>

      <div className="stamps">
        {BADGES.map((b) => {
          const have = b.count ? b.count(visited) : visited.filter(b.test).length
          const done = have >= b.need
          return (
            <div key={b.id} className={`stamp-badge${done ? ' done' : ''}`}>
              <div className="stamp-disc"><Icon name={done ? b.icon : 'lock'} /></div>
              <b>{b.label}</b>
              <small>{Math.min(have, b.need)}/{b.need}</small>
            </div>
          )
        })}
      </div>

      {rows.length > 0 && (
        <ul className="visited">
          {rows.map(({ c, p }) => <li key={c.id}><span>{p.name}</span><b>+{c.awarded_points}</b></li>)}
        </ul>
      )}

      <div className="profile-actions">
        <button className="btn-outline" onClick={onLogout}><Icon name="logout" /> Odhlásit</button>
        {usingMock && <button className="btn-outline" onClick={() => { resetMock(); location.reload() }}><Icon name="restart_alt" /> Mock</button>}
      </div>
    </>
  )
}
