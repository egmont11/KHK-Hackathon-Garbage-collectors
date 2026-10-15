import { useEffect, useState } from 'react'
import { api, loadStops, resetMock, usingMock } from './api.js'
import { TEAMS, distanceM, formatDistance } from './geo.js'
import { Icon, PageHeader, TeamBadge } from './ui.jsx'

const StopIcon = ({ type }) => <Icon name={type === 'train' ? 'train' : 'directions_bus'} />

const idosUrl = (from, to) => 'https://idos.cz/vlakyautobusy/spojeni/?' + new URLSearchParams({ f: from || '', t: to })
const poiLatLon = (poi) => ({ lat: poi.geometry.coordinates[1], lon: poi.geometry.coordinates[0] })
const fmtDate = (iso) => new Date(iso).toLocaleDateString('cs')
const fmtDateTime = (iso) => new Date(iso).toLocaleString('cs', { day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' })

function usePoiDetail(id) {
  const [detail, setDetail] = useState(null)
  const [error, setError] = useState(null)
  useEffect(() => {
    let alive = true
    setDetail(null)
    api.poiDetail(id).then((d) => alive && setDetail(d), (e) => alive && setError(e.message))
    return () => { alive = false }
  }, [id])
  return [detail, error]
}

// Podíl check-inů týmů na místě jako pruh v barvách týmů.
function TeamBar({ counts }) {
  const total = Object.values(counts).reduce((a, n) => a + n, 0)
  if (!total) return null
  return (
    <div className="team-bar">
      {Object.entries(TEAMS).map(([t, info]) => counts[t] > 0 && (
        <span key={t} style={{ flex: counts[t], background: info.color }} title={`${info.label}: ${counts[t]}`}>{counts[t]}</span>
      ))}
    </div>
  )
}

// --- Info o POI: kdo místo drží, check-iny týmů, bonus, text o místě ---
export function PoiInfoPage({ poi, live = {}, visit }) {
  const p = poi.properties
  const [d, error] = usePoiDetail(p.id)
  const owner = d?.owner_team ?? live.owner_team
  const event = d?.event
  const counts = d?.team_checkins

  return (
    <>
      <PageHeader title={p.name} />
      <p>
        {live.event_multiplier
          ? <><s>{p.points}</s> <b>{live.bonus_points} b.</b> <span className="chip bonus">×{live.event_multiplier}</span></>
          : <b>{p.points} b.</b>}
        {' '}za zabrání · {p.category_label}{p.is_nkp && ' · národní kulturní památka'}
      </p>
      {event && (
        <p className="card bonus-card">
          <Icon name="bolt" />{' '}
          {event.type === 'daily_category'
            ? <>Dnes je bonusová kategorie <b>{event.category_label}</b>: ×{event.multiplier} do {fmtDateTime(event.ends_at)}.</>
            : <>Týdenní bonus: ×{event.multiplier} do {fmtDate(event.ends_at)}.</>}
        </p>
      )}
      {visit && <p className="visited-note"><Icon name="check_circle" /> Zabral(a) jsi {fmtDateTime(visit.at)} za {visit.points} b.</p>}

      <h3>Souboj týmů (tato sezóna)</h3>
      {error && <p className="err">{error}</p>}
      <p>{owner ? <>Místo drží <TeamBadge team={owner} /> (nejvíc check-inů).</> : 'Místo zatím nikdo nezabral, buď první!'}</p>
      {counts && <TeamBar counts={counts} />}
      {d && (
        <p>
          Celkem {d.visits} {d.visits === 1 ? 'návštěva' : d.visits >= 2 && d.visits <= 4 ? 'návštěvy' : 'návštěv'}
          {d.last_visited_at && `, naposledy ${fmtDateTime(d.last_visited_at)}`}.
        </p>
      )}

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
  const [d] = usePoiDetail(p.id)
  const [myStop, setMyStop] = useState(null)

  useEffect(() => {
    if (!position) return
    loadStops().then((stops) => {
      let best = null
      for (const s of stops) {
        const [lon, lat] = s.geometry.coordinates
        const dd = distanceM(position.lat, position.lon, lat, lon)
        if (!best || dd < best.d) best = { name: s.properties.name, type: s.properties.type, d: dd }
      }
      setMyStop(best)
    })
  }, [position?.lat, position?.lon]) // eslint-disable-line react-hooks/exhaustive-deps

  const bus = d?.nearest_bus_stop ?? p.nearest_bus
  const train = d?.nearest_train_stop ?? p.nearest_train
  const stops = [bus, train].filter(Boolean).sort((a, b) => a.distance_m - b.distance_m)

  return (
    <>
      <PageHeader title={`Doprava: ${p.name}`} />
      <p>Vzdušnou čarou ode mě: <b>{dist != null ? formatDistance(dist) : 'neznám tvoji polohu'}</b></p>
      <p>
        Moje nejbližší zastávka:{' '}
        {myStop ? <><StopIcon type={myStop.type} /> {myStop.name} ({formatDistance(myStop.d)})</> : '–'}
      </p>

      <h3>Zastávky u místa</h3>
      {stops.length === 0 && (d?.idos_url
        ? <p><a href={d.idos_url} target="_blank" rel="noreferrer">Najít spoj v IDOS</a></p>
        : <p><i>Zastávku u místa neznáme.</i></p>)}
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
function Countdown({ endsAt }) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])
  const left = Math.max(0, new Date(endsAt) - now)
  const d = Math.floor(left / 86400000)
  const h = Math.floor((left % 86400000) / 3600000)
  const m = Math.floor((left % 3600000) / 60000)
  const s = Math.floor((left % 60000) / 1000)
  if (left === 0) return <p>Sezóna právě skončila, počítám výsledky…</p>
  return <p>Konec sezóny za {d > 0 && `${d} d `}{h} h {m} min{d === 0 && ` ${s} s`}</p>
}

export function LeaderboardPage({ season, myTeam }) {
  const [teams, setTeams] = useState([])
  const [history, setHistory] = useState([])
  useEffect(() => {
    const load = () => { api.teams().then(setTeams, () => {}); api.seasonHistory().then(setHistory, () => {}) }
    load()
    const id = setInterval(load, 10000)
    return () => clearInterval(id)
  }, [season?.season_id])
  const ranked = [...teams].sort((a, b) => b.score - a.score)
  const top = Math.max(1, ...ranked.map((t) => t.score))
  return (
    <>
      <PageHeader title={`Žebříček ${season?.season_id || ''}`} />
      <ol className="leaderboard">
        {ranked.map((t) => (
          <li key={t.team} className={t.team === myTeam ? 'mine' : ''}>
            <div><TeamBadge team={t.team} /> <b>{t.score} b.</b>{t.team === myTeam && ' · tvůj tým'}</div>
            <div className="score-bar"><span style={{ width: `${(t.score / top) * 100}%`, background: TEAMS[t.team]?.color }} /></div>
            <small>{t.members} hráčů{t.owned_pois != null && ` · drží ${t.owned_pois} míst`}</small>
          </li>
        ))}
      </ol>
      {season && <Countdown endsAt={season.ends_at} />}
      {history.length > 0 && (
        <>
          <h3>Minulé sezóny</h3>
          <ul>
            {history.map((s) => (
              <li key={s.season_id}>
                <b>{s.season_id}</b>{' '}
                {[...s.ranking].sort((a, b) => b.score - a.score).map((r, i) => (
                  <span key={r.team}>{i > 0 && ', '}{i === 0 && <Icon name="emoji_events" />}<TeamBadge team={r.team} /> {r.score} b.</span>
                ))}
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  )
}

// --- Quick time eventy ---
export function EventsPage({ poiById, position, visited, onShow }) {
  const [events, setEvents] = useState(null)
  const [error, setError] = useState(null)
  useEffect(() => { api.activeEvents().then(setEvents, (e) => setError(e.message)) }, [])
  return (
    <>
      <PageHeader title="Události" />
      {error && <p className="err">{error}</p>}
      {events?.length === 0 && <p>Teď neběží žádná událost.</p>}
      {events?.map((e) => {
        if (e.type === 'daily_category') {
          return (
            <div key={e.id} className="card bonus-card">
              <b><Icon name="bolt" /> Dnes: {e.category_label} za ×{e.multiplier} bodů</b>
              <div>Platí pro všech {e.poi_count} míst této kategorie do {fmtDateTime(e.ends_at)}.</div>
            </div>
          )
        }
        const poi = poiById.get(e.poi_id)
        if (!poi) return null
        const p = poi.properties
        const t = poiLatLon(poi)
        const dist = position ? distanceM(position.lat, position.lon, t.lat, t.lon) : null
        const done = visited.get(p.id)
        return (
          <div key={e.id} className={`card ${done ? 'done' : ''}`}>
            <b>Do {fmtDate(e.ends_at)} navštiv {p.name}</b>
            <div>
              ×{e.multiplier} bodů = {e.bonus_points ?? Math.round(p.points * e.multiplier)} b. · {p.municipality}{dist != null && ` · ${formatDistance(dist)}`}
            </div>
            {done && <div className="visited-note"><Icon name="check_circle" /> Splněno (+{done.points} b.)</div>}
            <button onClick={() => onShow(p.id)}>Ukázat na mapě</button>
          </div>
        )
      })}
    </>
  )
}

// --- Profil: uživatel, odznaky, navštívená místa, nastavení ---
// Záložní odznaky jen pro mock (backend posílá vlastní v /api/players/me).
const LOCAL_BADGES = [
  { id: 'first', name: 'První krok', description: 'První check-in', target: 1, test: () => true },
  { id: 'five', name: 'Objevitel', description: 'Navštiv 5 míst', target: 5, test: () => true },
  { id: 'castles', name: 'Hradní pán', description: 'Navštiv 3 hrady nebo zámky', target: 3, test: (p) => ['hrady', 'zamky'].includes(p.category) },
  { id: 'views', name: 'Výhled!', description: 'Navštiv 3 rozhledny', target: 3, test: (p) => p.category === 'rozhledny' },
  { id: 'nkp', name: 'Strážce dědictví', description: 'Navštiv národní kulturní památku', target: 1, test: (p) => p.is_nkp },
]

export function ProfilePage({ player, me, poiById, onShow, onLogout }) {
  const visits = [...(me?.visited || [])].sort((a, b) => (b.at || '').localeCompare(a.at || ''))
  const visitedProps = visits.map((v) => poiById.get(v.poi_id)?.properties).filter(Boolean)
  const badges = me?.badges ?? LOCAL_BADGES.map(({ test, ...b }) => {
    const progress = visitedProps.filter(test).length
    return { ...b, progress: Math.min(progress, b.target), earned: progress >= b.target }
  })
  const earned = badges.filter((b) => b.earned).length

  return (
    <>
      <PageHeader title="Profil" />
      <p><b>{me?.name || player.name}</b> · <TeamBadge team={me?.team || player.team} /></p>
      {me ? <p>Sezóna {me.season_id}: <b>{visits.length}</b> míst, <b>{me.season_points}</b> b. pro tým</p> : <p>Načítám…</p>}

      <h3>Odznaky ({earned}/{badges.length})</h3>
      <ul className="badges">
        {badges.map((b) => (
          <li key={b.id} className={b.earned ? 'earned' : 'locked'} title={b.description}>
            <Icon name={b.earned ? 'military_tech' : 'lock'} />
            <div>
              <b>{b.name}</b> <small>{b.description}</small>
              {!b.earned && b.target > 1 && <div className="score-bar small"><span style={{ width: `${(b.progress / b.target) * 100}%` }} /></div>}
            </div>
            <small>{b.progress}/{b.target}</small>
          </li>
        ))}
      </ul>

      {me?.badge_archive?.length > 0 && (
        <>
          <h3>Odznaky z minulých sezón</h3>
          <ul>
            {me.badge_archive.map((s) => <li key={s.season_id}><b>{s.season_id}</b>: {s.badges.map((b) => b.name).join(', ')}</li>)}
          </ul>
        </>
      )}

      <h3>Zabraná místa</h3>
      {visits.length === 0 ? <p>Zatím nic. Vyber místo na mapě a vyraž!</p> : (
        <ul className="visits">
          {visits.map((v) => {
            const p = poiById.get(v.poi_id)?.properties
            return (
              <li key={v.poi_id}>
                <button className="link" onClick={() => onShow(v.poi_id)}>{p?.name || v.poi_id}</button>
                {' '}+{v.points} b.{v.at && <small> · {fmtDateTime(v.at)}</small>}
              </li>
            )
          })}
        </ul>
      )}

      <h3>Nastavení</h3>
      <button onClick={() => { if (confirm('Odhlásit? Bez uloženého tokenu se k tomuto hráči už nevrátíš.')) onLogout() }}>Odhlásit</button>{' '}
      {usingMock && <button onClick={() => { resetMock(); location.reload() }}>Reset mock dat</button>}
      {!usingMock && <p><a href="/dashboard" target="_blank" rel="noreferrer">Dashboard pro kraj</a></p>}
    </>
  )
}
