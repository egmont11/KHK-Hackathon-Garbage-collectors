import { useEffect, useRef } from 'react'
import L from 'leaflet'
import 'leaflet.markercluster'
import { TEAMS } from './geo.js'
import { groupIcon } from './groups.js'

const KHK_BOUNDS = [[49.95, 15.1], [50.8, 16.6]]

// Marker: kolečko s ikonou skupiny v barvě týmu, který místo drží (owner_team).
// Bonusové místo má štítek ×N, místo, které už hráč v sezóně zabral, má fajfku.
function poiIcon({ group, owner, bonus, visited, selected }) {
  const color = owner ? TEAMS[owner]?.color : '#777'
  const size = selected ? 34 : 26
  const cls = ['poi-marker', selected && 'selected', bonus && 'bonus', visited && 'visited'].filter(Boolean).join(' ')
  return L.divIcon({
    className: '',
    html: `<div class="${cls}" style="background:${color}"><span class="material-symbols-outlined">${groupIcon(group)}</span>`
      + (bonus ? `<b class="marker-tag">×${bonus}</b>` : '')
      + (visited ? '<b class="marker-check material-symbols-outlined">check</b>' : '')
      + '</div>',
    iconSize: [size, size],
  })
}

export default function MapView({ pois, live, visited, selectedId, onSelect, position, demo, onDemoClick }) {
  const elRef = useRef(null)
  const mapRef = useRef(null)
  const clusterRef = useRef(null)
  const markersRef = useRef(new Map()) // poi id -> { marker, key, onMap }
  const meRef = useRef(null)
  const handlers = useRef({})
  handlers.current = { onSelect, onDemoClick }

  useEffect(() => {
    const map = L.map(elRef.current).fitBounds(KHK_BOUNDS)
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap contributors',
    }).addTo(map)
    clusterRef.current = L.markerClusterGroup({ disableClusteringAtZoom: 15 }).addTo(map)
    markersRef.current = new Map()
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
      const look = { group: p.group, owner: l.owner_team || null, bonus: l.event_multiplier || null, visited: visited.has(p.id), selected: p.id === selectedId }
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
  }, [pois, live, visited, selectedId])

  useEffect(() => {
    if (!position) return
    const ll = [position.lat, position.lon]
    if (!meRef.current) {
      meRef.current = L.circleMarker(ll, { radius: 8, color: '#000', fillColor: '#ffeb3b', fillOpacity: 1, interactive: false }).addTo(mapRef.current)
    } else {
      meRef.current.setLatLng(ll)
    }
  }, [position])

  // Vybrané místo vycentrovat; od zoomu 15 se neclusteruje, takže bude vidět.
  useEffect(() => {
    if (!selectedId) return
    const f = pois.find((x) => x.properties.id === selectedId)
    if (f) {
      const [lon, lat] = f.geometry.coordinates
      mapRef.current.setView([lat, lon], Math.max(mapRef.current.getZoom(), 15), { animate: false })
    }
  }, [selectedId]) // eslint-disable-line react-hooks/exhaustive-deps

  return <div ref={elRef} className="map" />
}
