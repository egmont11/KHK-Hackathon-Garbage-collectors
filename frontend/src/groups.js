// Skupiny POI (pole `group` v poi.geojson) a jejich ikony z Google Material Symbols.
export const GROUPS = {
  pamatky: { label: 'Památky', icon: 'castle' },
  priroda: { label: 'Příroda', icon: 'forest' },
  kultura: { label: 'Kultura', icon: 'museum' },
  sport: { label: 'Sport a zážitky', icon: 'hiking' },
  gastro: { label: 'Gastro a řemesla', icon: 'sports_bar' },
  sluzby: { label: 'Odpočinek a služby', icon: 'camping' },
}

export const groupIcon = (group) => GROUPS[group]?.icon ?? 'location_on'
