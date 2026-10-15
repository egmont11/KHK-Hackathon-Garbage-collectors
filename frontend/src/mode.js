// Demo data, credentials and check-ins are always isolated from the real backend.
const params = new URLSearchParams(location.search)
const allowDemo = import.meta.env.DEV || import.meta.env.VITE_DEMO === '1'
export const DEMO = allowDemo && params.get('demo') === '1'
export const usingMock = DEMO || (allowDemo && (import.meta.env.VITE_MOCK === '1' || params.get('mock') === '1'))
export const storageKey = (name) => `krajanek-${usingMock ? 'demo-' : ''}${name}`
