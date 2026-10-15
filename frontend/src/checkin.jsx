import { useEffect, useState } from 'react'
import { TEAMS, formatDistance } from './geo.js'
import { PING_REASONS, checkinRadius } from './hooks.js'
import { Icon } from './ui.jsx'

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

function Ring({ cs, color }) {
  const elapsed = useSmoothElapsed(cs)
  const required = cs.required || 60
  const R = 52
  const C = 2 * Math.PI * R
  const progress = Math.min(elapsed / required, 1)
  const paused = !cs.valid || cs.offline
  return (
    <svg className={`ring ${paused ? 'paused' : ''}`} viewBox="0 0 120 120" role="img" aria-label={`Zbývá ${Math.ceil(required - elapsed)} sekund`}>
      <circle cx="60" cy="60" r={R} className="ring-track" />
      <circle cx="60" cy="60" r={R} className="ring-bar" stroke={color}
        strokeDasharray={C} strokeDashoffset={C * (1 - progress)} transform="rotate(-90 60 60)" />
      <text x="60" y="58" className="ring-num">{Math.max(0, Math.ceil(required - elapsed))}</text>
      <text x="60" y="80" className="ring-unit">{paused ? 'stojí' : 'sekund'}</text>
    </svg>
  )
}

function Success({ cs, color, onClose }) {
  // body „naskakují“ od nuly
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
    <div className="success">
      <div className="burst" aria-hidden="true">
        {Array.from({ length: 14 }, (_, i) => <i key={i} style={{ '--a': `${(i * 360) / 14}deg`, background: i % 2 ? color : '#F2C230' }} />)}
      </div>
      <div className="success-flag" style={{ '--team': color }}><Icon name="flag" /></div>
      <div className="success-points">+{shown} b.</div>
      <div><b>{cs.name}</b> je zabrané!</div>
      {cs.multiplier > 1 && <div className="chip bonus">Bonus ×{cs.multiplier} (základ {cs.base_points} b.)</div>}
      <div>Tvůj tým má teď <b>{cs.team_score} b.</b></div>
      {cs.new_badges?.length > 0 && (
        <div className="new-badges">
          {cs.new_badges.map((b, i) => (
            <div key={b.id} className="chip badge-chip" style={{ animationDelay: `${0.9 + i * 0.25}s` }}>
              <Icon name="military_tech" /> Nový odznak: <b>{b.name}</b>
            </div>
          ))}
        </div>
      )}
      <button className="claim" onClick={onClose}>Super!</button>
    </div>
  )
}

export function CheckinOverlay({ checkin, team, selectedId }) {
  const cs = checkin.state
  const color = TEAMS[team]?.color || '#2E8B3E'
  if (cs.phase === 'idle') return null
  if (cs.phase === 'error' && selectedId && cs.poiId !== selectedId) return null // hráč už vybral jiné místo
  if (cs.phase === 'done') {
    return <div className="overlay checkin center"><Success cs={cs} color={color} onClose={checkin.cancel} /></div>
  }
  return (
    <div className="overlay checkin">
      <b>{cs.name}</b>
      {cs.phase === 'starting' && <p>Zahajuji check-in…</p>}
      {cs.phase === 'error' && <p className="err">{cs.msg} <button className="link" onClick={checkin.cancel} aria-label="Zavřít"><Icon name="close" /></button></p>}
      {cs.phase === 'running' && (
        <div className="checkin-run">
          <Ring cs={cs} color={color} />
          <div>
            {cs.points != null && <div>Za zabrání: <b>{cs.points} b.</b>{cs.multiplier > 1 && <span className="chip bonus">×{cs.multiplier}</span>}</div>}
            {cs.offline
              ? <div className="err">Ztratil se signál k serveru, zkouším znovu…</div>
              : cs.valid
                ? <div>Zůstaň do {formatDistance(checkinRadius())} od místa.</div>
                : <div className="err">{PING_REASONS[cs.reason] || 'Poloha teď neplatí.'}{cs.distance != null && cs.reason === 'OUT_OF_RANGE' && ` (${formatDistance(cs.distance)})`} Odpočet stojí.</div>}
            <button onClick={checkin.cancel}>Zrušit</button>
          </div>
        </div>
      )}
    </div>
  )
}
