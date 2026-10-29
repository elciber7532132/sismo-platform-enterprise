import { useEffect, useMemo, useState } from 'react';
import { CircleMarker, MapContainer, Popup, useMap } from 'react-leaflet';
import { maplibreGL } from '@maplibre/maplibre-gl-leaflet';
import { setWorkerUrl } from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import 'maplibre-gl/dist/maplibre-gl.css';

// OpenFreeMap es vectorial y no requiere API key. MapLibre renderiza el mapa base
// dentro de Leaflet para conservar los marcadores y controles existentes.
setWorkerUrl(workerUrl);
import { Search, RefreshCw, MapPin } from 'lucide-react';
import { api } from '../../services/api';
import type { EventItem } from '../../types';
function OpenFreeMapLayer(){
  const map=useMap();
  useEffect(()=>{
    const layer=maplibreGL({style:'https://tiles.openfreemap.org/styles/positron'});
    map.attributionControl.addAttribution('&copy; OpenFreeMap &copy; OpenMapTiles &copy; OpenStreetMap contributors');
    layer.addTo(map);
    return()=>{map.attributionControl.removeAttribution('&copy; OpenFreeMap &copy; OpenMapTiles &copy; OpenStreetMap contributors');if(map.hasLayer(layer))map.removeLayer(layer)};
  },[map]);
  return null;
}
function MapLayoutFix(){
  const map=useMap();
  useEffect(()=>{
    const container=map.getContainer();
    const refresh=()=>window.requestAnimationFrame(()=>map.invalidateSize({pan:false}));
    const timer=window.setTimeout(refresh,180);
    const observer=typeof ResizeObserver!=='undefined'?new ResizeObserver(refresh):null;
    observer?.observe(container);
    window.addEventListener('resize',refresh);
    return()=>{window.clearTimeout(timer);observer?.disconnect();window.removeEventListener('resize',refresh)};
  },[map]);
  return null;
}
function RegionView({region}:{region:string}){
  const map=useMap();
  useEffect(()=>{
    const box=regions[region]?.box;
    if(box){map.fitBounds([[box[0],box[1]],[box[2],box[3]]],{padding:[24,24],maxZoom:5,animate:false});}
    else map.setView([15,0],2,{animate:false});
  },[map,region]);
  return null;
}
const regions:Record<string,{label:string;box?:[number,number,number,number]}>= {world:{label:'Todo el mundo'},peru:{label:'Perú',box:[-20,-82,1,-67]},chile:{label:'Chile',box:[-57,-77,-17,-66]},japan:{label:'Japón',box:[24,122,46,146]},mexico:{label:'México',box:[14,-119,33,-86]},indonesia:{label:'Indonesia',box:[-12,94,7,142]},usa:{label:'Estados Unidos',box:[24,-126,50,-65]},ecuador:{label:'Ecuador',box:[-6,-82,2,-75]},colombia:{label:'Colombia',box:[-5,-80,14,-66]},argentina:{label:'Argentina',box:[-56,-74,-21,-53]},philippines:{label:'Filipinas',box:[4,116,22,127]},turkey:{label:'Turquía',box:[35,25,43,45]},newzealand:{label:'Nueva Zelanda',box:[-48,165,-33,180]}};
const color=(m:number)=>m>=6?'#ef4444':m>=4?'#f59e0b':m>=2?'#3b82f6':'#06b6d4';
export default function SeismicMap({onSync,busy}:{onSync:()=>void;busy:boolean}){const [events,setEvents]=useState<EventItem[]>([]);const [region,setRegion]=useState('world');const [days,setDays]=useState('30');const [mag,setMag]=useState('0');const [q,setQ]=useState('');const [loading,setLoading]=useState(false);const [error,setError]=useState('');const [sort,setSort]=useState('time');const [selected,setSelected]=useState<number|null>(null);
useEffect(()=>{let alive=true;setLoading(true);setError('');const end=new Date();const start=new Date();start.setDate(start.getDate()-Number(days));const params=new URLSearchParams({limit:'1000',min_magnitude:mag,start:start.toISOString(),end:end.toISOString()});const box=regions[region].box;if(box){params.set('minlatitude',String(box[0]));params.set('minlongitude',String(box[1]));params.set('maxlatitude',String(box[2]));params.set('maxlongitude',String(box[3]));}
// API persists the catalogue. For geographic bounds, apply the region filter client-side.
api<any>(`/api/v1/events?${params.toString()}`).then(r=>{if(alive)setEvents(r.items)}).catch(e=>{if(alive)setError(e instanceof Error?e.message:'No se pudo consultar la API')}).finally(()=>{if(alive)setLoading(false)});return()=>{alive=false}},[days,mag,region]);
const filtered=useMemo(()=>{const term=q.toLowerCase();const box=regions[region].box;return events.filter(e=>e.place.toLowerCase().includes(term)&&(!box||(e.latitude>=box[0]&&e.latitude<=box[2]&&e.longitude>=box[1]&&e.longitude<=box[3]))).sort((a,b)=>sort==='mag'?b.magnitude-a.magnitude:sort==='depth'?a.depth_km-b.depth_km:new Date(b.occurred_at).getTime()-new Date(a.occurred_at).getTime())},[events,q,region,sort]);
return <div className="map-layout"><section className="panel map-filter-panel"><div className="panel-head"><div><h2>Filtros de exploración</h2><p>Consulta eventos persistidos en la API</p></div></div><label>País o región<select value={region} onChange={e=>setRegion(e.target.value)}>{Object.entries(regions).map(([k,v])=><option key={k} value={k}>{v.label}</option>)}</select></label><label>Período<select value={days} onChange={e=>setDays(e.target.value)}><option value="1">Últimas 24 horas</option><option value="7">Últimos 7 días</option><option value="30">Últimos 30 días</option><option value="90">Últimos 90 días</option><option value="365">Último año</option></select></label><label>Magnitud mínima<select value={mag} onChange={e=>setMag(e.target.value)}><option value="0">Todas</option><option value="2">2+</option><option value="4">4+</option><option value="5">5+</option><option value="6">6+</option></select></label><label>Buscar ubicación<div className="searchbox"><Search size={15}/><input value={q} onChange={e=>setQ(e.target.value)} placeholder="Ciudad o lugar"/></div></label><button className="secondary full" disabled={busy} onClick={onSync}><RefreshCw size={15}/>{busy?'Sincronizando…':'Actualizar catálogo USGS'}</button><div className="map-note"><b>Fuente:</b> USGS Earthquake Catalog<br/><b>Último período:</b> {days} días<br/><b>Resultados:</b> {filtered.length}<p>Los límites regionales son aproximados. Los eventos de este mapa son registros reportados, no predicciones.</p></div></section><section className="panel map-panel"><div className="map-topline"><div><h2><MapPin size={17}/> Mapa de eventos</h2><p>Selecciona un marcador para abrir la ficha del evento</p></div><div className="map-legend"><span><i style={{background:'#06b6d4'}}/> &lt; 2</span><span><i style={{background:'#3b82f6'}}/> 2–3.9</span><span><i style={{background:'#f59e0b'}}/> 4–5.9</span><span><i style={{background:'#ef4444'}}/> 6+</span></div></div>{error&&<div className="banner error">{error}</div>}<div className="leaflet-map"><MapContainer center={[15,0]} zoom={2} minZoom={2} maxZoom={12} scrollWheelZoom={true} worldCopyJump={false} maxBounds={[[-85,-180],[85,180]]} maxBoundsViscosity={0.8} preferCanvas={true}><MapLayoutFix/><RegionView region={region}/><OpenFreeMapLayer/>{filtered.map(e=><CircleMarker key={e.id} center={[e.latitude,e.longitude]} radius={Math.max(4,Math.min(15,4+e.magnitude*1.3))} pathOptions={{color:color(e.magnitude),fillColor:color(e.magnitude),fillOpacity:.72,weight:1.5}} eventHandlers={{click:()=>setSelected(e.id)}}><Popup><b>Magnitud {e.magnitude.toFixed(1)}</b><p>{e.place}</p><p>Profundidad: {e.depth_km.toFixed(1)} km</p><p>{new Date(e.occurred_at).toLocaleString('es-PE',{timeZone:'UTC'})} UTC</p>{e.source_url&&<a href={e.source_url} target="_blank" rel="noreferrer">Ficha oficial del evento</a>}</Popup></CircleMarker>)}</MapContainer>{loading&&<div className="map-loading">Consultando eventos…</div>}</div><div className="table-toolbar"><div><b>Registro de eventos</b><small>{filtered.length} resultados · hasta 200 filas visibles</small></div><label>Ordenar<select value={sort} onChange={e=>setSort(e.target.value)}><option value="time">Más recientes</option><option value="mag">Mayor magnitud</option><option value="depth">Menor profundidad</option></select></label></div><div className="table-wrap map-table"><table><thead><tr><th>Magnitud</th><th>Ubicación</th><th>Fecha UTC</th><th>Profundidad</th><th>Fuente</th></tr></thead><tbody>{filtered.slice(0,200).map(e=><tr key={e.id} className={selected===e.id?'selected':''} onClick={()=>setSelected(e.id)}><td><span className={`magnitude ${e.magnitude>=6?'major':e.magnitude>=4?'moderate':'minor'}`}>{e.magnitude.toFixed(1)}</span></td><td>{e.place}</td><td>{new Date(e.occurred_at).toLocaleString('es-PE',{timeZone:'UTC'})}</td><td>{e.depth_km.toFixed(1)} km</td><td>{e.source_id}</td></tr>)}{!loading&&!filtered.length&&<tr><td colSpan={5}>Sin eventos para los filtros seleccionados. Sincroniza primero el catálogo desde Fuentes de datos.</td></tr>}</tbody></table></div><p className="muted-note">El número de resultados representa los registros devueltos por la API, no todos los eventos que hayan ocurrido en el mundo.</p></section></div>}
