import { useEffect, useRef } from 'react'
import L from 'leaflet'
import 'leaflet.markercluster'
import { TEAMS } from './geo.js'
import { groupIcon } from './groups.js'

const KHK_BOUNDS = [[49.95, 15.1], [50.8, 16.6]]

function poiIcon(group, owner, selected) {
  const color = owner ? TEAMS[owner].color : '#777'
  const size = selected ? 34 : 26
  return L.divIcon({
    className: '',
    html: `<div class="poi-marker${selected ? ' selected' : ''}" style="background:${color}"><span class="material-symbols-outlined">${groupIcon(group)}</span></div>`,
    iconSize: [size, size],
  })
}

export default function MapView({ pois, owners, selectedId, onSelect, position, demo, onDemoClick }) {
  const elRef = useRef(null)
  const mapRef = useRef(null)
  const clusterRef = useRef(null)
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
      const m = L.marker([lat, lon], { icon: poiIcon(p.group, owners[p.id], p.id === selectedId), title: p.name })
      m.on('click', () => handlers.current.onSelect(p.id))
      return m
    })
    cluster.addLayers(markers)
  }, [pois, owners, selectedId])

  useEffect(() => {
    if (!position) return
    const ll = [position.lat, position.lon]
    if (!meRef.current) {
      meRef.current = L.circleMarker(ll, { radius: 8, color: '#000', fillColor: '#ffeb3b', fillOpacity: 1, interactive: false }).addTo(mapRef.current)
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
