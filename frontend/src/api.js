// Klient pro REST API backendu (kontrakt 1.2, detaily v backend/README.md).
// Výchozí je backend přes Vite proxy (/api -> localhost:3001). VITE_API_URL přepíše adresu
// backendu, VITE_MOCK=1 (nebo ?mock v URL) spustí mock v prohlížeči (localStorage) se stejným rozhraním.
//
// Rozhraní, které čte UI (real i mock):
//   loadPois()            -> GeoJSON features (statické vlastnosti; živý stav je v api.live())
//   api.live()            -> { [poi_id]: { owner_team, event_multiplier, event_type, bonus_points, visits } }
//   api.me()              -> { player_id, name, team, season_id, season_points, visited: [{poi_id, points, at}], badges, badge_archive }
//   api.poiDetail(id)     -> detail z /api/poi/:id (owner_team, team_checkins, visits, last_visited_at, nearest_*_stop, idos_url, event)
//   api.startCheckin / ping / finish, api.teams, api.currentSeason, api.seasonHistory, api.activeEvents, api.createPlayer
import { distanceM } from './geo.js'

const API_URL = import.meta.env.VITE_API_URL || ''
export const usingMock = import.meta.env.VITE_MOCK === '1' || new URLSearchParams(location.search).has('mock')

// Stav spojení s backendem: App ukazuje lištu „server nedostupný“.
export const connection = new EventTarget()
function setOnline(online) {
  if (connection.online === online) return
  connection.online = online
  connection.dispatchEvent(new Event('change'))
}

// --- POI (backend vrací poi.geojson + live stav; mock čte statický soubor) ---
let poiCache
export async function loadPois() {
  if (!poiCache) {
    let res
    try { res = await fetch(usingMock ? '/data/poi.geojson' : `${API_URL}/api/poi`) } catch { setOnline(false) }
    if (!res?.ok) throw new Error(`Nepodařilo se načíst místa${res ? ` (HTTP ${res.status})` : ''}. Běží backend?`)
    setOnline(true)
    poiCache = (await res.json()).features
  }
  return poiCache
}

let stopsCache
export async function loadStops() {
  if (!stopsCache) stopsCache = (await (await fetch('/data/stops.geojson')).json()).features
  return stopsCache
}

// --- Real API ---
async function http(method, path, body) {
  const token = localStorage.getItem('turistak-token')
  let res
  try {
    res = await fetch(`${API_URL}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    })
  } catch {
    setOnline(false)
    throw Object.assign(new Error('Server je nedostupný. Zkontroluj připojení.'), { code: 'OFFLINE' })
  }
  const data = await res.json().catch(() => ({}))
  // Přes Vite proxy se nedostupný backend projeví jako 5xx bez JSON chyby backendu.
  const unreachable = res.status >= 500 && !data.error
  setOnline(!unreachable)
  if (unreachable) throw Object.assign(new Error('Server je nedostupný. Zkontroluj připojení.'), { code: 'OFFLINE' })
  if (!res.ok) {
    // Neplatný hráčský token (např. restart backendu v paměťovém režimu) -> App pošle hráče na onboarding.
    if (res.status === 401 && token) window.dispatchEvent(new Event('turistak-unauthorized'))
    throw Object.assign(new Error(data.error?.message || data.message || `HTTP ${res.status}`), { code: data.error?.code, status: res.status })
  }
  return data
}

const LIVE_FIELDS = ['owner_team', 'event_multiplier', 'event_type', 'bonus_points', 'visits']

const real = {
  createPlayer: (body) => http('POST', '/api/players', body),
  me: () => http('GET', '/api/players/me'),
  startCheckin: (body) => http('POST', '/api/checkins/start', body),
  ping: (id, body) => http('POST', `/api/checkins/${id}/ping`, body),
  finish: (id) => http('POST', `/api/checkins/${id}/finish`),
  teams: () => http('GET', '/api/teams'),
  currentSeason: () => http('GET', '/api/seasons/current'),
  seasonHistory: () => http('GET', '/api/seasons/history'),
  poiDetail: (id) => http('GET', `/api/poi/${encodeURIComponent(id)}`),

  async live() {
    const { features } = await http('GET', '/api/poi?lite=1')
    return Object.fromEntries(features.map((f) => [f.properties.id, Object.fromEntries(LIVE_FIELDS.map((k) => [k, f.properties[k]]))]))
  },

  // weekly = bonusová místa, daily = bonusová kategorie dne
  async activeEvents() {
    const { weekly = [], daily } = await http('GET', '/api/events/active')
    return [...weekly, ...(daily ? [daily] : [])]
  },
}

// --- Mock (bez backendu, jen pro vývoj UI) ---
const KEY = 'turistak-mock'
const RULES = { radius_m: 100, max_accuracy_m: 50, max_gap_s: 15, required_s: 60, max_speed_kmh: 30 }
const EVENTS = { per_week: 3, multiplier: 2 }
const TEAM_IDS = ['hory', 'reky', 'lesy']

function currentQuarter() {
  const now = new Date()
  const q = Math.floor(now.getMonth() / 3)
  const starts = new Date(now.getFullYear(), q * 3, 1)
  const ends = new Date(now.getFullYear(), q * 3 + 3, 1)
  return { season_id: `${now.getFullYear()}-Q${q + 1}`, starts_at: starts.toISOString(), ends_at: ends.toISOString() }
}

function load() {
  const season = currentQuarter()
  let s
  try { s = JSON.parse(localStorage.getItem(KEY)) } catch { s = null }
  if (!s || s.season.season_id !== season.season_id) {
    // nová sezóna = kompletní reset skóre (hráči zůstávají)
    s = { season, players: s?.players || {}, checkins: {}, scores: { hory: 0, reky: 0, lesy: 0 }, owners: {} }
  }
  return s
}
// crypto.randomUUID je jen v secure contextu (HTTPS/localhost), přes http://<ip> v síti chybí.
function randomId() {
  return [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, '0')).join('')
}
const save = (s) => localStorage.setItem(KEY, JSON.stringify(s))
const mePlayer = (s) => s.players[localStorage.getItem('turistak-token')]
const fail = (code, message) => { throw Object.assign(new Error(message), { code }) }
const doneCheckins = (s) => Object.values(s.checkins).filter((c) => c.awarded_points)

async function bonusFor(poiId) {
  const event = (await mock.activeEvents()).find((e) => e.poi_id === poiId)
  return event ? event.multiplier : 1
}

const mock = {
  async createPlayer({ name, team }) {
    const s = load()
    const token = randomId()
    s.players[token] = { player_id: token.slice(0, 8), name, team }
    save(s)
    return { player_id: s.players[token].player_id, token, name, team }
  },

  async me() {
    const s = load()
    const player = mePlayer(s)
    if (!player) fail('UNAUTHORIZED', 'Neznámý hráč.')
    const visited = doneCheckins(s).filter((c) => c.player_id === player.player_id)
      .map((c) => ({ poi_id: c.poi_id, points: c.awarded_points, at: c.finished_at }))
    return {
      ...player, season_id: s.season.season_id, season_points: visited.reduce((a, v) => a + v.points, 0),
      visited, badges: null, badge_archive: [],
    }
  },

  async startCheckin({ poi_id, lat, lon, accuracy_m }) {
    const s = load()
    const player = mePlayer(s)
    if (!player) fail('UNAUTHORIZED', 'Nejdřív si vyber tým.')
    if (doneCheckins(s).some((c) => c.player_id === player.player_id && c.poi_id === poi_id)) {
      fail('ALREADY_VISITED', 'Toto místo už jste v této sezóně obsadili.')
    }
    const poi = (await loadPois()).find((f) => f.properties.id === poi_id)
    const [plon, plat] = poi.geometry.coordinates
    const id = randomId().slice(0, 8)
    s.checkins[id] = { id, poi_id, player_id: player.player_id, team: player.team, plat, plon, pings: [], awarded_points: 0 }
    save(s)
    const { valid, reason } = await mock.ping(id, { lat, lon, accuracy_m })
    const multiplier = await bonusFor(poi_id)
    return {
      checkin_id: id, required_seconds: RULES.required_s, valid, reason, radius_m: RULES.radius_m,
      distance_m: Math.round(distanceM(lat, lon, plat, plon)), points: Math.round(poi.properties.points * multiplier), multiplier,
    }
  },

  async ping(id, { lat, lon, accuracy_m }) {
    const s = load()
    const c = s.checkins[id]
    if (!c) fail('CHECKIN_NOT_FOUND', 'Check-in nebyl nalezen.')
    const now = Date.now()
    const prev = c.pings[c.pings.length - 1]
    const distance = distanceM(lat, lon, c.plat, c.plon)
    let reason = accuracy_m > RULES.max_accuracy_m ? 'LOW_ACCURACY' : distance > RULES.radius_m ? 'OUT_OF_RANGE' : null
    if (prev && !reason) {
      const dt = (now - prev.ts) / 1000
      if ((distanceM(lat, lon, prev.lat, prev.lon) / Math.max(dt, 1)) * 3.6 > RULES.max_speed_kmh) reason = 'TOO_FAST'
    }
    const valid = !reason
    // odpočet = souvislý úsek validních pingů bez mezer > 15 s
    if (!valid || !prev || !prev.valid || (now - prev.ts) / 1000 > RULES.max_gap_s) c.runStart = valid ? now : null
    c.pings.push({ ts: now, lat, lon, valid })
    save(s)
    const elapsed_s = c.runStart ? Math.floor((now - c.runStart) / 1000) : 0
    return { elapsed_s, remaining_s: Math.max(0, RULES.required_s - elapsed_s), valid, reason, distance_m: Math.round(distance) }
  },

  async finish(id) {
    const s = load()
    const c = s.checkins[id]
    const elapsed = c.runStart ? (c.pings[c.pings.length - 1].ts - c.runStart) / 1000 : 0
    if (elapsed < RULES.required_s) fail('CHECKIN_INCOMPLETE', `Ještě nemáš ${RULES.required_s} s (${Math.floor(elapsed)} s).`)
    const poi = (await loadPois()).find((f) => f.properties.id === c.poi_id)
    const multiplier = await bonusFor(c.poi_id)
    c.awarded_points = Math.round(poi.properties.points * multiplier)
    c.finished_at = new Date().toISOString()
    s.scores[c.team] += c.awarded_points
    s.owners[c.poi_id] = c.team
    save(s)
    return { awarded_points: c.awarded_points, base_points: poi.properties.points, multiplier, team: c.team, team_score: s.scores[c.team], new_badges: [] }
  },

  async teams() {
    const s = load()
    const members = (t) => Object.values(s.players).filter((p) => p.team === t).length
    const owned = (t) => Object.values(s.owners).filter((o) => o === t).length
    return TEAM_IDS.map((team) => ({ team, score: s.scores[team], members: members(team), owned_pois: owned(team) }))
  },

  async currentSeason() {
    return load().season
  },

  async seasonHistory() {
    return []
  },

  async live() {
    const s = load()
    const out = {}
    for (const [id, team] of Object.entries(s.owners)) out[id] = { owner_team: team }
    const pois = await loadPois()
    for (const e of await mock.activeEvents()) {
      const p = pois.find((f) => f.properties.id === e.poi_id)?.properties
      out[e.poi_id] = { ...out[e.poi_id], event_multiplier: e.multiplier, event_type: 'weekly_poi', bonus_points: Math.round(p.points * e.multiplier) }
    }
    return out
  },

  async poiDetail(id) {
    const s = load()
    const team_checkins = { hory: 0, reky: 0, lesy: 0 }
    let last = null
    for (const c of doneCheckins(s)) {
      if (c.poi_id !== id) continue
      team_checkins[c.team] += 1
      if (!last || c.finished_at > last) last = c.finished_at
    }
    const visits = Object.values(team_checkins).reduce((a, n) => a + n, 0)
    return { id, owner_team: s.owners[id] || null, team_checkins, visits, last_visited_at: last, event: null }
  },

  // quick time eventy: každý týden 3 pseudonáhodná POI s ×2 body (stejná pro všechny)
  async activeEvents() {
    const now = new Date()
    const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - ((now.getDay() + 6) % 7))
    const ends = new Date(monday.getTime() + 7 * 86400000)
    const pois = await loadPois()
    let seed = Math.floor(monday.getTime() / 86400000)
    const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648)
    const picked = new Set()
    while (picked.size < EVENTS.per_week) picked.add(pois[Math.floor(rnd() * pois.length)].properties.id)
    return [...picked].map((poi_id, i) => ({
      id: `week-${seed}-${i}`, type: 'weekly_poi', poi_id, multiplier: EVENTS.multiplier,
      starts_at: monday.toISOString(), ends_at: ends.toISOString(),
    }))
  },
}

export const api = usingMock ? mock : real

export function resetMock() {
  localStorage.removeItem(KEY)
}
