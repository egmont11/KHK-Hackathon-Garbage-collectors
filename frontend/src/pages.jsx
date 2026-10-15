import { useEffect, useState } from 'react'
import { api, loadStops, resetMock, usingMock } from './api.js'
import { TEAMS, distanceM, formatDistance } from './geo.js'
import { Icon, PageHeader, TeamBadge, TeamIcon, seasonLabel } from './ui.jsx'

const StopIcon = ({ type }) => <Icon name={type === 'train' ? 'train' : 'directions_bus'} />

const idosUrl = (from, to) => 'https://idos.cz/vlakyautobusy/spojeni/?' + new URLSearchParams({ f: from || '', t: to })
const poiLatLon = (poi) => ({ lat: poi.geometry.coordinates[1], lon: poi.geometry.coordinates[0] })
const fmtDate = (iso) => new Date(iso).toLocaleDateString('cs', { day: 'numeric', month: 'numeric' })
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

// --- Info o POI: rozcestník, souboj týmů, text o místě ---
export function PoiInfoPage({ poi, live = {}, visit }) {
  const p = poi.properties
  const [d, error] = usePoiDetail(p.id)
  const owner = d?.owner_team ?? live.owner_team
  const event = d?.event
  const checkins = d?.team_checkins || {}
  const points = d?.team_points // body týmů na místě (backend), jinak jen návštěvy
  const top = d?.top_team ?? live.top_team

  return (
    <>
      <PageHeader title="" />
      <div className="signpost static">
        <div className="signpost-title">{p.name}</div>
        <div className="signpost-meta">
          {live.event_multiplier
            ? <span className="pts">{live.bonus_points} b. ×{live.event_multiplier}</span>
            : <span className="pts">{p.points} b.</span>}
          {p.municipality && <span><Icon name="location_on" />{p.municipality}</span>}
        </div>
      </div>
      <div className="chips">
        <span className="chip">{p.category_label}</span>
        {p.is_nkp && <span className="chip gold"><Icon name="workspace_premium" fill /> NKP</span>}
        {owner && <span className="chip"><Icon name="flag" fill /> <TeamBadge team={owner} /></span>}
        {event && (
          <span className="chip gold">
            <Icon name="bolt" fill /> ×{event.multiplier} do {event.type === 'daily_category' ? fmtDateTime(event.ends_at) : fmtDate(event.ends_at)}
          </span>
        )}
        {visit && <span className="chip mine"><Icon name="check_circle" fill /> {fmtDate(visit.at)} · +{visit.points} b.</span>}
      </div>

      {error && <p className="err">{error}</p>}
      <div className="team-stats">
        {Object.keys(TEAMS).map((t) => (
          <div key={t} className={`team-stat${(top || owner) === t ? ' holder' : ''}`} style={{ '--c': TEAMS[t].color }}>
            <TeamIcon team={t} size={26} />
            <b>{points ? points[t] ?? 0 : checkins[t] ?? 0}</b>
            <small>{points ? <><Icon name="directions_walk" /> {checkins[t] ?? 0}</> : 'návštěv'}</small>
          </div>
        ))}
      </div>
      {d?.last_visited_at && <p className="muted"><Icon name="schedule" /> Naposledy {fmtDateTime(d.last_visited_at)}</p>}

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
      <PageHeader title={p.name} />
      <div className="stat-row">
        <div className="stat"><Icon name="near_me" /><b>{dist != null ? formatDistance(dist) : '–'}</b></div>
        <div className="stat wide">
          <Icon name="my_location" />
          {myStop ? <span><StopIcon type={myStop.type} /> {myStop.name} <small>{formatDistance(myStop.d)}</small></span> : <b>–</b>}
        </div>
      </div>

      {stops.length === 0 && d?.idos_url && (
        <a className="btn-outline" href={d.idos_url} target="_blank" rel="noreferrer">IDOS <Icon name="arrow_outward" /></a>
      )}
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
function useCountdown(endsAt) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])
  const left = endsAt ? Math.max(0, new Date(endsAt) - now) : 0
  const d = Math.floor(left / 86400000)
  const h = Math.floor((left % 86400000) / 3600000)
  const m = Math.floor((left % 3600000) / 60000)
  const s = Math.floor((left % 60000) / 1000)
  if (!endsAt) return ''
  if (left === 0) return 'počítám výsledky…'
  return d > 0 ? `${d} d ${h} h ${m} min` : `${h} h ${m} min ${s} s`
}

export function LeaderboardPage({ season, myTeam, myId }) {
  const [teams, setTeams] = useState([])
  const [players, setPlayers] = useState([])
  const [history, setHistory] = useState([])
  const countdown = useCountdown(season?.ends_at)
  useEffect(() => {
    const load = () => {
      api.teams().then(setTeams, () => {})
      api.topPlayers(10).then(setPlayers, () => {})
      api.seasonHistory().then(setHistory, () => {})
    }
    load()
    const id = setInterval(load, 10000)
    return () => clearInterval(id)
  }, [season?.season_id])
  const sorted = [...teams].sort((a, b) => b.score - a.score)
  const max = Math.max(1, ...sorted.map((t) => t.score))
  return (
    <>
      <PageHeader title="Žebříček" />
      {season && (
        <div className="season-pill">
          <span>{seasonLabel(season.season_id)}</span>
          <span><Icon name="hourglass_top" /> {countdown}</span>
        </div>
      )}
      <div className="leaders">
        {sorted.map((t, i) => (
          <div key={t.team} className={`leader${t.team === myTeam ? ' mine' : ''}`} style={{ '--c': TEAMS[t.team]?.color }}>
            <span className="rank">{i + 1}</span>
            <TeamIcon team={t.team} size={30} />
            <div className="leader-body">
              <div className="leader-top">
                <b>{TEAMS[t.team]?.label}</b>
                <span className="score">{t.score.toLocaleString('cs')}</span>
              </div>
              <div className="bar"><i style={{ width: `${(t.score / max) * 100}%` }} /></div>
              <small>
                <span><Icon name="group" /> {t.members}</span>
                {t.owned_pois != null && <span><Icon name="flag" /> {t.owned_pois}</span>}
                {t.team === myTeam && <span>tvůj tým</span>}
              </small>
            </div>
          </div>
        ))}
      </div>

      <h3 className="section">Top 10 hráčů</h3>
      {players.length === 0 ? <p className="muted">Zatím nikdo nic nezabral.</p> : (
        <ol className="top-players">
          {players.map((p, i) => (
            <li key={p.player_id} className={p.player_id === myId ? 'mine' : ''} style={{ '--c': TEAMS[p.team]?.color }}>
              <span className="rank">{i + 1}</span>
              <TeamIcon team={p.team} size={20} />
              <span className="name">{p.name}</span>
              <small>{p.places} míst</small>
              <b>{p.points.toLocaleString('cs')}</b>
            </li>
          ))}
        </ol>
      )}

      {history.length > 0 && (
        <>
          <h3 className="section">Minulé sezóny</h3>
          <ul className="visited">
            {history.map((s) => {
              const ranking = [...s.ranking].sort((a, b) => b.score - a.score)
              return (
                <li key={s.season_id}>
                  <span>{seasonLabel(s.season_id)}</span>
                  <span className="history-rank">
                    <Icon name="emoji_events" fill /> <TeamBadge team={ranking[0]?.team} /> {ranking[0]?.score.toLocaleString('cs')}
                  </span>
                </li>
              )
            })}
          </ul>
        </>
      )}
    </>
  )
}

// --- Questy: týdenní týmové (soutěží všechny týmy) + můj denní ---
// „Denní úkol: zaber …“ – kategorie denního questu ve 4. pádě jednotného čísla (backend/src/events.ts dailyBonusCategories).
const DAILY_TARGET = {
  rozhledny: 'rozhlednu nebo vyhlídku', hrady: 'hrad', zamky: 'zámek', pevnosti: 'pevnost', muzea: 'muzeum nebo galerii',
  priroda: 'přírodní zajímavost', cirkevni: 'církevní památku', technicke: 'technickou památku', architektura: 'architektonickou památku',
  historicke: 'historickou památku', zidovske: 'židovskou památku', zvony: 'místo se zvony na Broumovsku', pivovary: 'pivovar',
  potraviny: 'místo s regionálními potravinami', remesla: 'místo s řemeslnými výrobky', lanovky: 'lanovku', koupani: 'místo na koupání',
  divadla: 'divadlo nebo filharmonii', cyklovylety: 'start cyklovýletu',
}

function QuestStandings({ players, leader }) {
  const max = Math.max(1, ...Object.values(players || {}))
  return (
    <div className="quest-teams">
      {Object.keys(TEAMS).map((t) => (
        <div key={t} className={`quest-team${leader === t ? ' lead' : ''}`} style={{ '--c': TEAMS[t].color }}>
          <TeamIcon team={t} size={18} />
          <div className="bar"><i style={{ width: `${((players?.[t] || 0) / max) * 100}%` }} /></div>
          <b>{players?.[t] || 0}</b>
        </div>
      ))}
    </div>
  )
}

export function EventsPage({ poiById, position, visited, onShow }) {
  const [quests, setQuests] = useState(null)
  const [error, setError] = useState(null)
  useEffect(() => {
    const load = () => api.quests().then(setQuests, (e) => setError(e.message))
    load()
    const id = setInterval(load, 15000)
    return () => clearInterval(id)
  }, [])
  const daily = quests?.daily
  return (
    <>
      <PageHeader title="Questy" />
      {error && <p className="err">{error}</p>}

      {daily && (
        <div className={`quest daily${daily.completed ? ' done' : ''}`}>
          <span className="mult">{daily.completed ? <Icon name="check" /> : `×${String(daily.multiplier).replace('.', ',')}`}</span>
          <div className="quest-body">
            <b>Denní úkol: zaber {DAILY_TARGET[daily.category] || daily.category_label}</b>
            <small>
              {daily.completed
                ? <span><Icon name="check_circle" /> Splněno (+{daily.completed_points} b.)</span>
                : <span><Icon name="person" /> jen pro tebe</span>}
              <span><Icon name="schedule" /> do {fmtDateTime(daily.ends_at)}</span>
            </small>
          </div>
        </div>
      )}

      <h3 className="section">Týdenní souboj týmů</h3>
      {quests?.weekly?.map((e) => {
        const poi = poiById.get(e.poi_id)
        if (!poi) return null
        const p = poi.properties
        const t = poiLatLon(poi)
        const dist = position ? distanceM(position.lat, position.lon, t.lat, t.lon) : null
        const done = visited.get(p.id)
        return (
          <button key={e.id} className={`quest weekly${done ? ' mine' : ''}`} onClick={() => onShow(p.id)}>
            <div className="quest-head">
              <span className="mult"><Icon name="flag" fill /></span>
              <div className="quest-body">
                <b>{p.name}</b>
                <small>
                  <span><Icon name="event" /> do {fmtDate(e.ends_at)}</span>
                  {dist != null && <span><Icon name="near_me" /> {formatDistance(dist)}</span>}
                  {done && <span><Icon name="check_circle" /> zabráno</span>}
                </small>
              </div>
              <span className="quest-pts">+{e.reward}<small> b.</small></span>
            </div>
            <QuestStandings players={e.players} leader={e.leader} />
          </button>
        )
      })}

      {quests?.last_week?.some((q) => q.leader) && (
        <>
          <h3 className="section">Minulý týden</h3>
          <ul className="visited">
            {quests.last_week.filter((q) => q.leader).map((q) => (
              <li key={q.poi_id}>
                <span>{poiById.get(q.poi_id)?.properties.name || q.poi_name}</span>
                <span className="history-rank"><Icon name="emoji_events" fill /> <TeamBadge team={q.leader} /> +{q.reward}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  )
}

// --- Profil: uživatel, odznaky, zabraná místa, nastavení ---
// Ikony k odznakům z backendu (backend/src/badges.ts); neznámé id dostane obecnou medaili.
const BADGE_ICONS = {
  'prvni-krok': 'flag', objevitel: 'hiking', cestovatel: 'landscape', dobyvatel: 'terrain',
  'hradni-pan': 'castle', vyhled: 'visibility', historik: 'museum', 'poutni-cesta': 'church',
  sladek: 'sports_bar', 'strazce-dedictvi': 'workspace_premium', 'krizem-krazem': 'explore',
  dobrodruh: 'forest', 'lovec-bonusu': 'bolt', bet: 'casino', prevrat: 'swap_horiz', 'ranni-ptace': 'wb_twilight',
}

// Záložní odznaky jen pro mock (backend posílá vlastní v /api/players/me).
const LOCAL_BADGES = [
  { id: 'prvni-krok', name: 'První krok', description: 'První check-in', target: 1, test: () => true },
  { id: 'objevitel', name: 'Objevitel', description: 'Navštiv 5 míst', target: 5, test: () => true },
  { id: 'hradni-pan', name: 'Hradní pán', description: 'Navštiv 3 hrady nebo zámky', target: 3, test: (p) => ['hrady', 'zamky'].includes(p.category) },
  { id: 'vyhled', name: 'Výhled!', description: 'Navštiv 3 rozhledny', target: 3, test: (p) => p.category === 'rozhledny' },
  { id: 'strazce-dedictvi', name: 'Strážce dědictví', description: 'Navštiv národní kulturní památku', target: 1, test: (p) => p.is_nkp },
]

export function ProfilePage({ player, me, poiById, onShow, onLogout }) {
  const team = me?.team || player.team
  const visits = [...(me?.visited || [])].sort((a, b) => (b.at || '').localeCompare(a.at || ''))
  const visitedProps = visits.map((v) => poiById.get(v.poi_id)?.properties).filter(Boolean)
  const badges = me?.badges ?? LOCAL_BADGES.map(({ test, ...b }) => {
    const progress = visitedProps.filter(test).length
    return { ...b, progress: Math.min(progress, b.target), earned: progress >= b.target }
  })

  return (
    <>
      <PageHeader title="" />
      <div className="profile-card">
        <TeamIcon team={team} size={40} />
        <div>
          <b>{me?.name || player.name}</b>
          <TeamBadge team={team} />
        </div>
      </div>
      <div className="stat-row">
        <div className="stat"><Icon name="location_on" /><b>{visits.length}</b></div>
        <div className="stat"><Icon name="star" /><b>{me?.season_points ?? 0}</b></div>
      </div>

      <div className="stamps">
        {badges.map((b) => (
          <div key={b.id} className={`stamp-badge${b.earned ? ' done' : ''}`} title={b.description}>
            <div className="stamp-disc"><Icon name={b.earned ? BADGE_ICONS[b.id] || 'military_tech' : 'lock'} /></div>
            <b>{b.name}</b>
            <small>{Math.min(b.progress, b.target)}/{b.target}</small>
          </div>
        ))}
      </div>

      {me?.badge_archive?.length > 0 && (
        <>
          <h3 className="section">Minulé sezóny</h3>
          <ul className="visited">
            {me.badge_archive.map((s) => (
              <li key={s.season_id}><span>{seasonLabel(s.season_id)}</span><span className="muted">{s.badges.map((b) => b.name).join(', ')}</span></li>
            ))}
          </ul>
        </>
      )}

      {visits.length > 0 && (
        <ul className="visited">
          {visits.map((v) => (
            <li key={v.poi_id}>
              <button className="link" onClick={() => onShow(v.poi_id)}>{poiById.get(v.poi_id)?.properties.name || v.poi_id}</button>
              <b>+{v.points}</b>
            </li>
          ))}
        </ul>
      )}

      <div className="profile-actions">
        <button className="btn-outline" onClick={() => { if (confirm('Odhlásit? Zpátky se přihlásíš jménem a heslem.')) onLogout() }}>
          <Icon name="logout" /> Odhlásit
        </button>
        {usingMock && <button className="btn-outline" onClick={() => { resetMock(); location.reload() }}><Icon name="restart_alt" /> Mock</button>}
      </div>
    </>
  )
}
