import React from 'react'
import { createRoot } from 'react-dom/client'
import 'leaflet/dist/leaflet.css'
import 'material-symbols/outlined.css'
import 'leaflet.markercluster/dist/MarkerCluster.css'
import 'leaflet.markercluster/dist/MarkerCluster.Default.css'
import './style.css'
import App from './App.jsx'

createRoot(document.getElementById('root')).render(<App />)
