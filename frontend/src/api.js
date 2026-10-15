// Klient pro REST API z AGENTS.md (kontrakt 1.2).
// Bez VITE_API_URL běží mock v prohlížeči (localStorage) se stejným rozhraním,
// takže po napojení na backend stačí nastavit VITE_API_URL=http://localhost:3000.
import { distanceM } from './geo.js'

const API_URL = import.meta.env.VITE_API_URL
export const usingMock = !API_URL

// --- POI (zatím vždy ze statického souboru; backend vrací totéž + live stav) ---
let poiCache
export async function loadPois() {
  if (!poiCache) {
    const res = await fetch(API_URL ? `${API_URL}/api/poi` : '/data/poi.geojson')
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
  const token = localStorage.getItem('krajanek-token')
  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || data.message || `HTTP ${res.status}`)
  return data
}

const real = {
  createPlayer: (body) => http('POST', '/api/players', body),
  startCheckin: (body) => http('POST', '/api/checkins/start', body),
  ping: (id, body) => http('POST', `/api/checkins/${id}/ping`, body),
  finish: (id) => http('POST', `/api/checkins/${id}/finish`),
  teams: () => http('GET', '/api/teams'),
  currentSeason: () => http('GET', '/api/seasons/current'),
  poiOwners: async () => ({}), // TODO: z /api/poi (live stav), až ho backend bude vracet
  poiStats: (id) => http('GET', `/api/poi/${encodeURIComponent(id)}`),
  activeEvents: () => http('GET', '/api/events/active'),
  myCheckins: async () => [], // TODO: endpoint v kontraktu zatím není
}

// --- Mock ---
const KEY = 'krajanek-mock'
const RULES = { radius_m: 100, max_accuracy_m: 50, max_gap_s: 15, required_s: 60, max_speed_kmh: 30 }
const EVENTS = { per_week: 3, multiplier: 2 }

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
const me = (s) => s.players[localStorage.getItem('krajanek-token')]

const mock = {
  async createPlayer({ name, team }) {
    const s = load()
    const token = randomId()
    s.players[token] = { player_id: token.slice(0, 8), name, team }
    save(s)
    return { player_id: s.players[token].player_id, token }
  },

  async startCheckin({ poi_id, lat, lon, accuracy_m }) {
    const s = load()
    const player = me(s)
    if (!player) throw new Error('Nejdřív si vyber tým.')
    const done = Object.values(s.checkins).some((c) => c.player_id === player.player_id && c.poi_id === poi_id && c.awarded_points)
    if (done) throw new Error('Tohle místo už jsi v této sezóně obsadil.')
    const poi = (await loadPois()).find((f) => f.properties.id === poi_id)
    const [plon, plat] = poi.geometry.coordinates
    if (distanceM(lat, lon, plat, plon) > RULES.radius_m) throw new Error('Jsi dál než 100 m od místa.')
    const id = randomId().slice(0, 8)
    s.checkins[id] = { id, poi_id, player_id: player.player_id, team: player.team, plat, plon, pings: [], awarded_points: 0 }
    save(s)
    await mock.ping(id, { lat, lon, accuracy_m })
    return { checkin_id: id, required_seconds: RULES.required_s }
  },

  async ping(id, { lat, lon, accuracy_m }) {
    const s = load()
    const c = s.checkins[id]
    const now = Date.now()
    const prev = c.pings[c.pings.length - 1]
    let valid = distanceM(lat, lon, c.plat, c.plon) <= RULES.radius_m && accuracy_m <= RULES.max_accuracy_m
    if (prev && valid) {
      const dt = (now - prev.ts) / 1000
      const speed = (distanceM(lat, lon, prev.lat, prev.lon) / Math.max(dt, 1)) * 3.6
      if (speed > RULES.max_speed_kmh) valid = false
    }
    // odpočet = souvislý úsek validních pingů bez mezer > 15 s
    if (!valid || !prev || !prev.valid || (now - prev.ts) / 1000 > RULES.max_gap_s) c.runStart = valid ? now : null
    c.pings.push({ ts: now, lat, lon, valid })
    save(s)
    const elapsed_s = c.runStart ? Math.floor((now - c.runStart) / 1000) : 0
    return { elapsed_s, valid }
  },

  async finish(id) {
    const s = load()
    const c = s.checkins[id]
    const elapsed = c.runStart ? (c.pings[c.pings.length - 1].ts - c.runStart) / 1000 : 0
    if (elapsed < RULES.required_s) throw new Error(`Ještě nemáš 60 s (${Math.floor(elapsed)} s).`)
    const poi = (await loadPois()).find((f) => f.properties.id === c.poi_id)
    const event = (await mock.activeEvents()).find((e) => e.poi_id === c.poi_id)
    c.awarded_points = poi.properties.points * (event ? event.multiplier : 1)
    c.finished_at = new Date().toISOString()
    s.scores[c.team] += c.awarded_points
    s.owners[c.poi_id] = c.team
    save(s)
    return { awarded_points: c.awarded_points, team_score: s.scores[c.team] }
  },

  async teams() {
    const s = load()
    const members = (t) => Object.values(s.players).filter((p) => p.team === t).length
    return Object.entries(s.scores)
      .map(([team, score]) => ({ team, score, members: members(team) }))
      .sort((a, b) => b.score - a.score)
  },

  async currentSeason() {
    return load().season
  },

  async poiOwners() {
    return load().owners
  },

  // detail POI: body a návštěvy po týmech v aktuální sezóně
  async poiStats(id) {
    const s = load()
    const teams = { hory: { points: 0, visits: 0 }, reky: { points: 0, visits: 0 }, lesy: { points: 0, visits: 0 } }
    for (const c of Object.values(s.checkins)) {
      if (c.poi_id !== id || !c.awarded_points) continue
      teams[c.team].points += c.awarded_points
      teams[c.team].visits += 1
    }
    const visits = Object.values(teams).reduce((a, t) => a + t.visits, 0)
    return { id, last_team: s.owners[id] || null, visits, teams }
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
      id: `week-${seed}-${i}`, type: 'bonus', poi_id, multiplier: EVENTS.multiplier,
      starts_at: monday.toISOString(), ends_at: ends.toISOString(),
    }))
  },

  async myCheckins() {
    const s = load()
    const player = me(s)
    if (!player) return []
    return Object.values(s.checkins).filter((c) => c.player_id === player.player_id && c.awarded_points)
  },
}

export const api = usingMock ? mock : real

export function resetMock() {
  localStorage.removeItem(KEY)
}
