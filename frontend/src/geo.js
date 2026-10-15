export function distanceM(lat1, lon1, lat2, lon2) {
  const R = 6371000
  const toRad = (d) => (d * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLon = toRad(lon2 - lon1)
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(a))
}

export function formatDistance(m) {
  if (m == null) return '?'
  return m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1)} km`
}

export const TEAMS = {
  hory: { label: 'Hory', color: '#D7263D' },
  reky: { label: 'Řeky', color: '#1E63B5' },
  lesy: { label: 'Lesy', color: '#2E8B3E' },
}
