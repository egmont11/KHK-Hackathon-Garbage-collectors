import { useEffect, useState } from 'react'
import { Icon } from './ui.jsx'

// Android/Chrome nabídne vlastní instalaci (beforeinstallprompt) – zachytit hned při startu.
let deferredPrompt = null
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferredPrompt = e })

export const isStandalone = () =>
  window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true

const guessPlatform = () => (/iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1) ? 'ios' : 'android')

const STEPS = {
  ios: [
    ['ios_share', 'Otevři Krajánka v Safari a dole klepni na Sdílet.'],
    ['add_box', 'Sjeď níž a vyber „Přidat na plochu“.'],
    ['check_circle', 'Potvrď „Přidat“. Krajánek je na ploše jako aplikace.'],
  ],
  android: [
    ['more_vert', 'V Chromu klepni vpravo nahoře na ⋮ (menu).'],
    ['install_mobile', 'Vyber „Nainstalovat aplikaci“ nebo „Přidat na plochu“.'],
    ['check_circle', 'Potvrď „Nainstalovat“. Krajánek je na ploše jako aplikace.'],
  ],
}

/** Návod, jak si Krajánka přidat na plochu (iOS / Android), s tlačítkem instalace, když ho prohlížeč nabízí. */
export function InstallGuide({ onDone }) {
  const [platform, setPlatform] = useState(guessPlatform)
  const [canPrompt, setCanPrompt] = useState(!!deferredPrompt)
  useEffect(() => {
    const on = () => setCanPrompt(true)
    window.addEventListener('beforeinstallprompt', on)
    return () => window.removeEventListener('beforeinstallprompt', on)
  }, [])

  async function install() {
    if (!deferredPrompt) return
    deferredPrompt.prompt()
    const { outcome } = await deferredPrompt.userChoice
    deferredPrompt = null
    setCanPrompt(false)
    if (outcome === 'accepted') onDone()
  }

  return (
    <div className="install-guide">
      <div className="field">
        <span>Přidej si Krajánka na plochu</span>
        <p className="install-lead">Pak se otevře přes celou obrazovku jako aplikace a zůstaneš přihlášený.</p>
      </div>
      <div className="mode-switch" role="tablist">
        <button type="button" role="tab" aria-selected={platform === 'ios'} className={platform === 'ios' ? 'active' : ''} onClick={() => setPlatform('ios')}>
          iPhone
        </button>
        <button type="button" role="tab" aria-selected={platform === 'android'} className={platform === 'android' ? 'active' : ''} onClick={() => setPlatform('android')}>
          Android
        </button>
      </div>
      {platform === 'android' && canPrompt && (
        <button type="button" className="play" onClick={install}>Nainstalovat <Icon name="install_mobile" /></button>
      )}
      <ol className="install-steps">
        {STEPS[platform].map(([icon, text], i) => (
          <li key={i}><span className="install-icon"><Icon name={icon} /></span><span>{text}</span></li>
        ))}
      </ol>
      <button type="button" className={platform === 'android' && canPrompt ? 'text-btn back-btn' : 'play'} onClick={onDone}>
        {platform === 'android' && canPrompt ? 'Teď ne' : <>Do hry <Icon name="arrow_forward" /></>}
      </button>
    </div>
  )
}
