import { useEffect, useRef } from 'react'
import L from 'leaflet'
import 'leaflet.markercluster'
import { TEAMS } from './geo.js'
import { groupIcon } from './groups.js'

const KHK_BOUNDS = [[49.95, 15.1], [50.8, 16.6]]

// Pin podle návrhu z Figmy: dřevěná cedule na kůlu, na ní ikona POI,
// pod ní stužka v barvě týmu, který má na místě nejvíc bodů.
// TODO: nahradit tvary SVG exportem z Figmy, až ho dostaneme.
const PIN_W = 104
const PIN_H = 96
const PIN_TIP = [46.7, 94.6] // špička kůlu = bod na mapě
const PIN_WOOD = 'M40.4 .4 89.6 15.8 103.3 33.8 80 39.6 64.2 36.3 46.7 94.6 46.3 83.8 44.2 85 43.8 82.5 37.9 86.7 54.2 32.5 25.8 23.3 34.6 22.5 33.3 20 30 17.1 39.2 9.2 35.4 3.8Z'
const PIN_RIBBON = 'M0 32.6Q30 29.8 64.8 35.8L63.2 43.6Q30 37.6 1.6 40.4L5.4 36.4Z'

function poiIcon(group, owner, selected) {
  const scale = selected ? 0.8 : 0.6
  const [w, h] = [PIN_W * scale, PIN_H * scale]
  const ribbon = owner ? `<path class="pin-ribbon" d="${PIN_RIBBON}" fill="${TEAMS[owner].color}"/>` : ''
  return L.divIcon({
    className: '',
    html: `<div class="pin${selected ? ' selected' : ''}">`
      + `<svg viewBox="0 0 ${PIN_W} ${PIN_H}" width="${w}" height="${h}"><path class="pin-wood" d="${PIN_WOOD}"/>${ribbon}</svg>`
      + `<span class="pin-icon material-symbols-rounded">${groupIcon(group)}</span></div>`,
    iconSize: [w, h],
    iconAnchor: [PIN_TIP[0] * scale, PIN_TIP[1] * scale],
  })
}

const clusterIcon = (cluster) => {
  const n = cluster.getChildCount()
  const size = n < 10 ? 34 : n < 100 ? 40 : 48
  return L.divIcon({ className: '', html: `<div class="cluster">${n}</div>`, iconSize: [size, size] })
}

const meIcon = L.divIcon({ className: '', html: '<div class="me"></div>', iconSize: [22, 22] })

export default function MapView({ pois, owners, selectedId, onSelect, position, demo, onDemoClick }) {
  const elRef = useRef(null)
  const mapRef = useRef(null)
  const clusterRef = useRef(null)
  const meRef = useRef(null)
  const handlers = useRef({})
  handlers.current = { onSelect, onDemoClick }

  useEffect(() => {
    const map = L.map(elRef.current, { zoomControl: false }).fitBounds(KHK_BOUNDS)
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap',
    }).addTo(map)
    clusterRef.current = L.markerClusterGroup({
      disableClusteringAtZoom: 15,
      showCoverageOnHover: false,
      maxClusterRadius: 50,
      iconCreateFunction: clusterIcon,
    }).addTo(map)
    map.on('click', (e) => {
      if (demo) handlers.current.onDemoClick?.(e.latlng.lat, e.latlng.lng)
    })
    mapRef.current = map
    return () => map.remove()
  }, [demo])

  useEffect(() => {
    const cluster = clusterRef.current
    cluster.clearLayers()
    const markers = pois.map((f) => {
      const [lon, lat] = f.geometry.coordinates
      const p = f.properties
      const selected = p.id === selectedId
      const m = L.marker([lat, lon], { icon: poiIcon(p.group, owners[p.id], selected), title: p.name, zIndexOffset: selected ? 1000 : 0 })
      m.on('click', () => handlers.current.onSelect(p.id))
      return m
    })
    cluster.addLayers(markers)
  }, [pois, owners, selectedId])

  useEffect(() => {
    if (!position) return
    const ll = [position.lat, position.lon]
    if (!meRef.current) {
      meRef.current = L.marker(ll, { icon: meIcon, interactive: false, zIndexOffset: 2000 }).addTo(mapRef.current)
    } else {
      meRef.current.setLatLng(ll)
    }
  }, [position])

  useEffect(() => {
    if (!selectedId) return
    const f = pois.find((x) => x.properties.id === selectedId)
    if (f) {
      const [lon, lat] = f.geometry.coordinates
      mapRef.current.setView([lat, lon], Math.max(mapRef.current.getZoom(), 14), { animate: false })
    }
  }, [selectedId]) // eslint-disable-line react-hooks/exhaustive-deps

  return <div ref={elRef} className="map" />
}
