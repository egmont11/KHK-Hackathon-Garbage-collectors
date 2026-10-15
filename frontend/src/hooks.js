import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api, connection, loadPois } from './api.js'
import { DEMO } from './ui.jsx'

const REFRESH_MS = 15000
const PING_EVERY_MS = 5000

// --- Poloha: GPS, v demo režimu ji nastavuje klik do mapy ---
const GEO_ERRORS = {
  1: 'Přístup k poloze je zakázaný. Povol ho v nastavení prohlížeče, jinak nejde nic zabrat.',
  2: 'Polohu se nedaří zjistit. Zkus to venku nebo zapni GPS.',
  3: 'Zjišťování polohy trvá moc dlouho.',
}

const DEMO_POS_KEY = 'turistak-demo-position'

export function usePosition() {
  // demo: poloha z kliknutí přežije reload (kvůli obnovení rozběhnutého check-inu)
  const [position, setPositionState] = useState(() => {
    if (!DEMO) return null
    try { return JSON.parse(sessionStorage.getItem(DEMO_POS_KEY)) } catch { return null }
  })
  const setPosition = useCallback((p) => {
    setPositionState(p)
    if (DEMO) try { sessionStorage.setItem(DEMO_POS_KEY, JSON.stringify(p)) } catch { /* private mode */ }
  }, [])
  const [error, setError] = useState(null)
  useEffect(() => {
    if (DEMO) return
    if (!navigator.geolocation) return setError('Tenhle prohlížeč neumí zjistit polohu.')
    if (!window.isSecureContext) return setError('Poloha funguje jen přes HTTPS (npm run dev:https) nebo na localhost.')
    const id = navigator.geolocation.watchPosition(
      (p) => { setError(null); setPosition({ lat: p.coords.latitude, lon: p.coords.longitude, accuracy_m: p.coords.accuracy }) },
      (e) => setError(GEO_ERRORS[e.code] || e.message),
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 30000 },
    )
    return () => navigator.geolocation.clearWatch(id)
  }, [])
  return [position, setPosition, error]
}

// --- Spojení s backendem ---
export function useOnline() {
  const [online, setOnline] = useState(true)
  useEffect(() => {
    const on = () => setOnline(connection.online !== false)
    connection.addEventListener('change', on)
    return () => connection.removeEventListener('change', on)
  }, [])
  return online
}

// --- Herní stav: POI, živý stav míst, hráč, sezóna ---
export function useGame() {
  const [pois, setPois] = useState([])
  const [loadError, setLoadError] = useState(null)
  const [live, setLive] = useState({})
  const [me, setMe] = useState(null)
  const [season, setSeason] = useState(null)
  const [newSeason, setNewSeason] = useState(null) // oznámení „začala nová sezóna“
  const seasonRef = useRef(null)

  const loadPoiList = useCallback(() => {
    setLoadError(null)
    loadPois().then(setPois, (e) => setLoadError(e.message))
  }, [])

  const refresh = useCallback(async () => {
    const [l, m, s] = await Promise.allSettled([api.live(), api.me(), api.currentSeason()])
    if (l.status === 'fulfilled') setLive(l.value)
    if (m.status === 'fulfilled') setMe(m.value)
    if (s.status === 'fulfilled') {
      const prev = seasonRef.current
      if (prev && prev.season_id !== s.value.season_id) setNewSeason(s.value.season_id)
      seasonRef.current = s.value
      setSeason(s.value)
    }
  }, [])

  useEffect(() => {
    loadPoiList()
    refresh()
    const id = setInterval(refresh, REFRESH_MS)
    return () => clearInterval(id)
  }, [loadPoiList, refresh])

  // Konec sezóny: backend přepne sezónu líně při dalším požadavku, tak se zeptáme hned po konci.
  useEffect(() => {
    if (!season) return
    const ms = new Date(season.ends_at) - Date.now() + 1000
    if (ms > 2 ** 31 - 1) return
    const id = setTimeout(refresh, Math.max(ms, 1000))
    return () => clearTimeout(id)
  }, [season, refresh])

  const visited = useMemo(() => new Map((me?.visited || []).map((v) => [v.poi_id, v])), [me])

  return { pois, loadError, retryLoad: loadPoiList, live, me, season, visited, refresh, newSeason, clearNewSeason: () => setNewSeason(null) }
}

// --- Check-in ---
// Backend drží jen jeden rozběhnutý check-in na hráče: nový start ten předchozí zahodí
// (pak ping na starý vrací CHECKIN_NOT_FOUND). Proto: žádné souběžné starty, pingy jen
// z posledního běhu (run) a nikdy dva pingy najednou (setTimeout řetěz místo setInterval).
// Rozběhnutý check-in se pamatuje v localStorage a po reloadu stránky pokračuje.
const STORE_KEY = 'turistak-checkin'
const RADIUS_KEY = 'turistak-radius'

export const checkinRadius = () => Number(localStorage.getItem(RADIUS_KEY)) || 100

export const PING_REASONS = {
  OUT_OF_RANGE: 'Jsi moc daleko od místa.',
  LOW_ACCURACY: 'Máš slabý signál GPS.',
  TOO_FAST: 'Pohybuješ se moc rychle.',
  PING_GAP: 'Spojení vypadlo, odpočet začíná znovu.',
}

const ERROR_MESSAGES = {
  ALREADY_VISITED: 'Tohle místo už máš v této sezóně zabrané.',
  SEASON_CHANGED: 'Sezóna právě skončila a začala nová. Zkus místo zabrat znovu.',
  CHECKIN_NOT_FOUND: 'Check-in se přerušil (běží jinde, nebo se restartoval server). Zkus to znovu.',
}

function readStored() {
  try { return JSON.parse(localStorage.getItem(STORE_KEY)) } catch { return null }
}

export function useCheckin(position, onFinished) {
  const [state, setState] = useState({ phase: 'idle' }) // idle | starting | running | done | error
  const posRef = useRef(position)
  posRef.current = position
  const finishedRef = useRef(onFinished)
  finishedRef.current = onFinished
  const timer = useRef(null)
  const run = useRef(0)
  const stop = () => { clearTimeout(timer.current); run.current++ }

  function fail(info, e) {
    localStorage.removeItem(STORE_KEY)
    setState({ phase: 'error', poiId: info.poiId, name: info.name, msg: ERROR_MESSAGES[e.code] || e.message })
    if (e.code === 'SEASON_CHANGED' || e.code === 'ALREADY_VISITED') finishedRef.current?.()
  }

  // Ping smyčka pro už založený check-in (po startu i po obnovení ze storage).
  function loop(info, myRun, retried) {
    const alive = () => run.current === myRun
    const tick = async () => {
      if (!alive()) return
      const pos = posRef.current
      if (!pos) { timer.current = setTimeout(tick, PING_EVERY_MS); return }
      try {
        const r = await api.ping(info.checkin_id, { lat: pos.lat, lon: pos.lon, accuracy_m: pos.accuracy_m ?? 9999 })
        if (!alive()) return
        if (r.elapsed_s >= info.required) {
          try {
            const res = await api.finish(info.checkin_id)
            if (!alive()) return
            localStorage.removeItem(STORE_KEY)
            setState({ phase: 'done', poiId: info.poiId, name: info.name, ...res })
            finishedRef.current?.()
            return
          } catch (e) {
            if (e.code !== 'CHECKIN_INCOMPLETE') throw e // jinak pingujeme dál
          }
        }
        setState((s) => ({ ...s, offline: false, elapsed: r.elapsed_s, syncedAt: Date.now(), valid: r.valid, reason: r.reason, distance: r.distance_m }))
      } catch (e) {
        if (!alive()) return
        if (e.code === 'OFFLINE' || e.code === 'PING_TOO_SOON') {
          setState((s) => ({ ...s, offline: e.code === 'OFFLINE' }))
        } else if (e.code === 'CHECKIN_NOT_FOUND' && !retried && info.poi) {
          return start(info.poi, true)
        } else {
          return fail(info, e)
        }
      }
      timer.current = setTimeout(tick, PING_EVERY_MS)
    }
    timer.current = setTimeout(tick, PING_EVERY_MS)
  }

  async function start(poi, retried = false) {
    stop()
    const myRun = run.current
    const p = poi.properties
    const base = { poiId: p.id, name: p.name }
    setState({ phase: 'starting', ...base })
    const pos = posRef.current
    try {
      const r = await api.startCheckin({ poi_id: p.id, lat: pos.lat, lon: pos.lon, accuracy_m: pos.accuracy_m ?? 9999 })
      if (run.current !== myRun) return
      if (r.radius_m) localStorage.setItem(RADIUS_KEY, String(r.radius_m))
      const info = { ...base, checkin_id: r.checkin_id, required: r.required_seconds, points: r.points, multiplier: r.multiplier }
      localStorage.setItem(STORE_KEY, JSON.stringify(info))
      setState({ phase: 'running', ...info, elapsed: 0, syncedAt: Date.now(), valid: r.valid ?? true, reason: r.reason, distance: r.distance_m })
      loop({ ...info, poi }, myRun, retried)
    } catch (e) {
      if (run.current === myRun) fail(base, e)
    }
  }

  // Po reloadu stránky navázat na rozběhnutý check-in.
  useEffect(() => {
    const info = readStored()
    if (info?.checkin_id) {
      setState({ phase: 'running', ...info, elapsed: 0, syncedAt: Date.now(), valid: true })
      loop(info, run.current, true)
    }
    return stop
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const cancel = () => { stop(); localStorage.removeItem(STORE_KEY); setState({ phase: 'idle' }) }
  return { state, start, cancel }
}
