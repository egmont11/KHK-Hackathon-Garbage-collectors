import { useEffect, useState } from 'react'
import { formatDistance } from './geo.js'
import { PING_REASONS, checkinRadius } from './hooks.js'
import { Icon, TeamIcon } from './ui.jsx'

// Odpočet se od backendu dozví jen při pingu (à 5 s), mezi pingy ho dopočítáme lokálně,
// aby kruh běžel plynule. Když je poloha neplatná, odpočet stojí.
function useSmoothElapsed(cs) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 200)
    return () => clearInterval(id)
  }, [])
  if (!cs.valid || cs.offline) return cs.elapsed || 0
  // nejvýš o jeden ping (5 s) napřed, ať kruh neuteče, když ping nedorazí
  const extra = Math.min((now - (cs.syncedAt || now)) / 1000, 5)
  return Math.min((cs.elapsed || 0) + extra, cs.required)
}

function Ring({ cs }) {
  const elapsed = useSmoothElapsed(cs)
  const required = cs.required || 60
  const r = 26
  const c = 2 * Math.PI * r
  const paused = !cs.valid || cs.offline
  const left = Math.max(0, Math.ceil(required - elapsed))
  return (
    <div className={`ring${paused ? ' paused' : ''}`} role="img" aria-label={`Zbývá ${left} sekund`}>
      <svg viewBox="0 0 64 64">
        <circle className="ring-track" cx="32" cy="32" r={r} />
        <circle className="ring-fill" cx="32" cy="32" r={r} strokeDasharray={c} strokeDashoffset={c * (1 - Math.min(elapsed / required, 1))} />
      </svg>
      <b>{left}</b>
    </div>
  )
}

// Razítko po zabrání: body „naskakují“ od nuly, pod ním bonus, skóre týmu a nové odznaky.
function Stamp({ cs, team, onClose }) {
  const [shown, setShown] = useState(0)
  useEffect(() => {
    const t0 = performance.now()
    let raf
    const step = (t) => {
      const k = Math.min((t - t0) / 900, 1)
      setShown(Math.round(cs.awarded_points * (1 - (1 - k) ** 3)))
      if (k < 1) raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [cs.awarded_points])
  return (
    <div className="stamp-wrap" onClick={onClose}>
      <div className="stamp">
        <TeamIcon team={team} size={34} />
        <b>+{shown}</b>
        <span>{cs.name}</span>
      </div>
      <div className="stamp-info">
        {cs.multiplier > 1 && <span className="chip gold"><Icon name="bolt" fill /> ×{cs.multiplier} · základ {cs.base_points} b.</span>}
        <span className="chip"><Icon name="groups" /> Tým má {cs.team_score} b.</span>
        {cs.new_badges?.map((b, i) => (
          <span key={b.id} className="chip gold badge-chip" style={{ animationDelay: `${0.6 + i * 0.25}s` }}>
            <Icon name="military_tech" fill /> {b.name}
          </span>
        ))}
      </div>
    </div>
  )
}

export function CheckinOverlay({ checkin, team, selectedId }) {
  const cs = checkin.state
  if (cs.phase === 'idle') return null
  if (cs.phase === 'error' && selectedId && cs.poiId !== selectedId) return null // hráč už vybral jiné místo
  if (cs.phase === 'done') return <Stamp cs={cs} team={team} onClose={checkin.cancel} />
  if (cs.phase === 'error') {
    return (
      <div className="toast err" onClick={checkin.cancel}>
        <Icon name="error" /> {cs.msg}
      </div>
    )
  }
  return (
    <div className="checkin">
      {cs.phase === 'running' ? <Ring cs={cs} /> : <div className="ring"><b>…</b></div>}
      <div className="checkin-body">
        <b>{cs.name}</b>
        {cs.phase === 'starting' && <small>Zahajuji check-in…</small>}
        {cs.phase === 'running' && cs.points != null && (
          <small className="checkin-pts">{cs.points} b.{cs.multiplier > 1 && ` · ×${cs.multiplier}`}</small>
        )}
        {cs.phase === 'running' && (cs.offline
          ? <span className="warn"><Icon name="cloud_off" /> Bez spojení, zkouším znovu</span>
          : !cs.valid
            ? <span className="warn"><Icon name="location_off" /> {PING_REASONS[cs.reason] || 'Poloha neplatí.'}{cs.distance != null && cs.reason === 'OUT_OF_RANGE' && ` ${formatDistance(cs.distance)}`}</span>
            : <small>Zůstaň do {formatDistance(checkinRadius())}</small>)}
      </div>
      <button className="round-btn ghost" onClick={checkin.cancel} aria-label="Zrušit"><Icon name="close" /></button>
    </div>
  )
}
