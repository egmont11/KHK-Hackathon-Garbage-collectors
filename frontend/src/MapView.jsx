import { useEffect, useRef } from 'react'
import L from 'leaflet'
import 'leaflet.markercluster'
import { TEAMS } from './geo.js'
import { groupIcon } from './groups.js'

const KHK_BOUNDS = [[49.95, 15.1], [50.8, 16.6]]

// Pin podle návrhu z Figmy: dřevěná cedule na kůlu, na ní ikona POI,
// pod ní stužka v barvě týmu, který má na místě nejvíc bodů.
// Bonusové místo má štítek ×N, místo, které už hráč v sezóně zabral, má fajfku.
// TODO: nahradit tvary SVG exportem z Figmy, až ho dostaneme.
const PIN_W = 104
const PIN_H = 96
const PIN_TIP = [46.7, 94.6] // špička kůlu = bod na mapě
const PIN_WOOD = 'M40.4 .4 89.6 15.8 103.3 33.8 80 39.6 64.2 36.3 46.7 94.6 46.3 83.8 44.2 85 43.8 82.5 37.9 86.7 54.2 32.5 25.8 23.3 34.6 22.5 33.3 20 30 17.1 39.2 9.2 35.4 3.8Z'
const PIN_RIBBON = 'M0 32.6Q30 29.8 64.8 35.8L63.2 43.6Q30 37.6 1.6 40.4L5.4 36.4Z'

function poiIcon({ group, team, bonus, quest, visited, selected }) {
  const scale = selected ? 0.8 : 0.6
  const [w, h] = [PIN_W * scale, PIN_H * scale]
  const ribbon = team ? `<path class="pin-ribbon" d="${PIN_RIBBON}" fill="${TEAMS[team]?.color}"/>` : ''
  const cls = ['pin', selected && 'selected', bonus && 'bonus', visited && 'claimed'].filter(Boolean).join(' ')
  return L.divIcon({
    className: '',
    html: `<div class="${cls}">`
      + `<svg viewBox="0 0 ${PIN_W} ${PIN_H}" width="${w}" height="${h}"><path class="pin-wood" d="${PIN_WOOD}"/>${ribbon}</svg>`
      + `<span class="pin-icon material-symbols-rounded">${groupIcon(group)}</span>`
      + (bonus ? `<b class="pin-tag">×${String(bonus).replace('.', ',')}</b>` : quest ? '<b class="pin-tag quest material-symbols-rounded">flag</b>' : '')
      + (visited ? '<span class="pin-check material-symbols-rounded">check</span>' : '')
      + '</div>',
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

export default function MapView({ pois, live, visited, dailyCategory, selectedId, onSelect, position, demo, onDemoClick }) {
  const elRef = useRef(null)
  const mapRef = useRef(null)
  const clusterRef = useRef(null)
  const markersRef = useRef(new Map()) // poi id -> { marker, key, onMap }
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
    markersRef.current = new Map()
    meRef.current = null
    map.on('click', (e) => {
      if (demo) handlers.current.onDemoClick?.(e.latlng.lat, e.latlng.lng)
    })
    mapRef.current = map
    return () => map.remove()
  }, [demo])

  // Jen rozdíly: nové markery přidat, zmizelé odebrat, změněným vyměnit ikonu.
  useEffect(() => {
    const cluster = clusterRef.current
    const markers = markersRef.current
    const wanted = new Set()
    const toAdd = []
    const toRemove = []
    for (const f of pois) {
      const p = f.properties
      wanted.add(p.id)
      const l = live[p.id] || {}
      // stužka: tým s nejvíc body na místě (top_team), záložně tým, který místo drží
      const look = { group: p.group, team: l.top_team || l.owner_team || null, bonus: l.event_multiplier || (p.category === dailyCategory ? 1.4 : null), quest: !!l.quest, visited: visited.has(p.id), selected: p.id === selectedId }
      const key = JSON.stringify(look)
      let entry = markers.get(p.id)
      if (!entry) {
        const [lon, lat] = f.geometry.coordinates
        const marker = L.marker([lat, lon], { icon: poiIcon(look), title: p.name, zIndexOffset: look.selected ? 1000 : 0 })
        marker.on('click', () => handlers.current.onSelect(p.id))
        entry = { marker, key, onMap: false }
        markers.set(p.id, entry)
      } else if (entry.key !== key) {
        entry.marker.setIcon(poiIcon(look))
        entry.marker.setZIndexOffset(look.selected ? 1000 : 0)
        entry.key = key
      }
      if (!entry.onMap) { toAdd.push(entry.marker); entry.onMap = true }
    }
    for (const [id, entry] of markers) {
      if (entry.onMap && !wanted.has(id)) { toRemove.push(entry.marker); entry.onMap = false }
    }
    if (toRemove.length) cluster.removeLayers(toRemove)
    if (toAdd.length) cluster.addLayers(toAdd)
  }, [pois, live, visited, selectedId, dailyCategory])

  useEffect(() => {
    if (!position) return
    const ll = [position.lat, position.lon]
    if (!meRef.current) {
      meRef.current = L.marker(ll, { icon: meIcon, interactive: false, zIndexOffset: 2000 }).addTo(mapRef.current)
    } else {
      meRef.current.setLatLng(ll)
    }
  }, [position])

  // Vybrané místo plynule vycentrovat (pan / přelet); od zoomu 15 se neclusteruje, takže bude vidět.
  useEffect(() => {
    if (!selectedId) return
    const f = pois.find((x) => x.properties.id === selectedId)
    if (f) {
      const [lon, lat] = f.geometry.coordinates
      const map = mapRef.current
      const zoom = Math.max(map.getZoom(), 15)
      // Během letu je cedule schovaná v clusteru a cluster pak vykreslí starou ikonu → po doletu obnovit.
      map.once('moveend', () => {
        const entry = markersRef.current.get(selectedId)
        if (entry) entry.marker.setIcon(entry.marker.options.icon)
      })
      if (matchMedia('(prefers-reduced-motion: reduce)').matches) map.setView([lat, lon], zoom, { animate: false })
      else if (zoom === map.getZoom()) map.panTo([lat, lon], { animate: true, duration: 0.5, easeLinearity: 0.3 })
      else map.flyTo([lat, lon], zoom, { duration: 0.9 })
    }
  }, [selectedId]) // eslint-disable-line react-hooks/exhaustive-deps

  return <div ref={elRef} className="map" />
}
