import { useEffect, useState } from 'react';
import { Activity, BellRing, BrainCircuit, ChartNoAxesCombined, Database, FileBarChart, Gauge, Globe2, History, Layers3, RadioTower, Settings, ShieldCheck, Users, Waves, RefreshCw, Menu, X, Search, ExternalLink } from 'lucide-react';
import { Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis, ScatterChart, Scatter, ZAxis, Legend, Line, LineChart } from 'recharts';
import { api, syncUSGS } from '../services/api';
import type { EventItem } from '../types';
import SeismicMap from '../modules/mapa-sismico/SeismicMap';
import EstimatesPage from '../modules/estimaciones/EstimatesPage';

type ModuleKey='Dashboard'|'Eventos sísmicos'|'Mapa sísmico'|'Análisis estadístico'|'Preparación de datos'|'Modelos de Machine Learning'|'Estimaciones experimentales'|'Reglas de alertas'|'Centro de alertas'|'Fuentes de datos'|'Reportes'|'Usuarios y roles'|'Auditoría y configuración';
const groups=[{label:'OPERACIÓN',items:[['Dashboard',Gauge],['Eventos sísmicos',Waves],['Mapa sísmico',Globe2]]},{label:'ANÁLISIS',items:[['Análisis estadístico',ChartNoAxesCombined],['Preparación de datos',Database],['Modelos de Machine Learning',BrainCircuit],['Estimaciones experimentales',Activity]]},{label:'ALERTAS',items:[['Reglas de alertas',Layers3],['Centro de alertas',BellRing]]},{label:'ADMINISTRACIÓN',items:[['Fuentes de datos',RadioTower],['Reportes',FileBarChart],['Usuarios y roles',Users],['Auditoría y configuración',ShieldCheck]]}] as const;
const fmt=(s?:string|null)=>s?new Date(s).toLocaleString('es-PE',{dateStyle:'medium',timeStyle:'short'}):'Sin sincronización';
export default function App(){const [active,setActive]=useState<ModuleKey>('Dashboard');const [mobile,setMobile]=useState(false);const [summary,setSummary]=useState<any>(null);const [events,setEvents]=useState<EventItem[]>([]);const [series,setSeries]=useState<any[]>([]);const [sources,setSources]=useState<any[]>([]);const [quality,setQuality]=useState<any>(null);const [audit,setAudit]=useState<any[]>([]);const [busy,setBusy]=useState(false);const [notice,setNotice]=useState('');const [error,setError]=useState('');

const refresh = async () => {
  setError('');

  try {
    const [s, t, src, q, a] = await Promise.all([
      api<any>('/api/v1/dashboard/summary'),
      api<any>('/api/v1/analytics/timeseries?days=30'),
      api<any>('/api/v1/sources'),
      api<any>('/api/v1/data-quality/summary'),
      api<any>('/api/v1/audit-logs'),
    ]);

    const all: EventItem[] = [];
    let offset = 0;
    let total = Infinity;

    while (offset < total) {
      const page = await api<{
        items: EventItem[];
        total: number;
        limit: number;
        offset: number;
      }>(`/api/v1/events?limit=1000&offset=${offset}`);

      all.push(...page.items);
      total = page.total;

      if (!page.items.length) break;
      offset += page.items.length;
    }

    const previous = localStorage.getItem('sismo-seen-event-ids');
    const seen = new Set<string>(
      previous ? JSON.parse(previous) : []
    );

    const config = JSON.parse(
      localStorage.getItem('sismo-alert-config') ||
        '{"enabled":false,"minMagnitude":5,"region":""}'
    );

    if (
      previous &&
      config.enabled &&
      'Notification' in window &&
      Notification.permission === 'granted' &&
      'serviceWorker' in navigator
    ) {
      const fresh = all
        .filter(
          (e) =>
            !seen.has(String(e.id)) &&
            e.magnitude >= Number(config.minMagnitude) &&
            (!config.region ||
              e.place.toLowerCase().includes(
                String(config.region).toLowerCase()
              ))
        )
        .slice(0, 5);

      if (fresh.length) {
        try {
          await navigator.serviceWorker.register('/sw.js');
          const registration = await navigator.serviceWorker.ready;

          for (const e of fresh) {
            await registration.showNotification(
              `Sismo M ${e.magnitude.toFixed(1)}`,
              {
                body: `${e.place} · ${new Date(
                  e.occurred_at
                ).toLocaleString('es-PE')}`,
                icon: '/icons/icon-192.png',
                tag: `sismo-${e.id}`,
              }
            );
          }
        } catch (notificationError) {
          console.error(
            'Error al mostrar notificaciones:',
            notificationError
          );
        }
      }
    }

    localStorage.setItem(
      'sismo-seen-event-ids',
      JSON.stringify(
        all.map((e) => String(e.id)).slice(0, 5000)
      )
    );

    setSummary(s);
    setEvents(all);
    setSeries(t.items);
    setSources(src);
    setQuality(q);
    setAudit(a);
  } catch (err) {
    setError(
      err instanceof Error
        ? err.message
        : 'No se pudo conectar con la API.'
    );
  }
};
useEffect(()=>{void refresh();const timer=window.setInterval(()=>void refresh(),60000);if('serviceWorker' in navigator)void navigator.serviceWorker.register('/sw.js').catch(()=>{});return()=>window.clearInterval(timer)},[]);
const sync=async()=>{setBusy(true);setNotice('');try{const r=await syncUSGS(7);setNotice(`${r.message} Vistos: ${r.records_seen}; nuevos: ${r.records_inserted}.`);await refresh()}catch(e){setError(e instanceof Error?e.message:'Falló la sincronización')}finally{setBusy(false)}};
const title=active;const nav=<>{groups.map(g=><div className="nav-group" key={g.label}><div className="nav-label">{g.label}</div>{g.items.map(([name,Icon])=><button key={name} className={`nav-item ${active===name?'active':''}`} onClick={()=>{setActive(name as ModuleKey);setMobile(false)}}><Icon size={17}/><span>{name}</span></button>)}</div>)}</>;
console.log('SERIES RECIBIDA:', series);
console.log('PRIMER EVENTO:', events[0]);
return <div className="shell"><aside className={`sidebar ${mobile?'open':''}`}><div className="brand"><div className="brand-icon"><Activity/></div><div><b>SISMO <em>PLATFORM</em></b><small>ENTERPRISE MONITORING</small></div><button className="mobile-close" onClick={()=>setMobile(false)}><X/></button></div><div className="environment"><span className="pulse"/> <div><b>Centro de monitoreo</b><small>Entorno de demostración</small></div></div><nav>{nav}</nav><div className="sidebar-bottom"><ShieldCheck size={17}/><div><b>Operación responsable</b><small>Las alertas oficiales requieren fuentes y autorización verificadas.</small></div></div></aside>{mobile&&<button className="scrim" onClick={()=>setMobile(false)} aria-label="Cerrar menú"/>}<main className="main"><header className="topbar"><button className="mobile-menu" onClick={()=>setMobile(true)}><Menu/></button><div className="crumb">Plataforma <span>/</span> <b>{active}</b></div><div className="top-actions"><span className={`api-status ${error?'offline':''}`}><i/>{error?'API sin conexión':'API conectada'}</span><button title="Actualizar datos" onClick={()=>void refresh()}><RefreshCw size={16}/></button><button title="Documentación API" onClick={()=>window.open(`${(import.meta.env.VITE_API_URL||'http://localhost:8000')}/docs`,'_blank','noopener')}><ExternalLink size={16}/></button><div className="avatar">AD</div></div></header><div className="content"><div className="page-head"><div><div className="eyebrow">SISMO PLATFORM / OPERACIÓN</div><h1>{title}</h1><p>Monitoreo de eventos observados, análisis trazable y fuentes de datos verificables.</p></div>{active!=='Mapa sísmico'&&<button className="primary" disabled={busy} onClick={()=>void sync()}><RefreshCw size={15}/>{busy?'Sincronizando…':'Sincronizar USGS'}</button>}</div>{error&&<div className="banner error">{error}<button onClick={()=>void refresh()}>Reintentar</button></div>}{notice&&<div className="banner success">{notice}<button onClick={()=>setNotice('')}>×</button></div>}
{active==='Mapa sísmico'?<SeismicMap onSync={sync} busy={busy}/>:active==='Dashboard'?<Dashboard summary={summary} events={events} series={series} sources={sources} onSync={sync} busy={busy}/>:active==='Eventos sísmicos'?<EventsPage events={events}/>:active==='Análisis estadístico'?<AnalysisPage events={events} series={series}/>:active==='Preparación de datos'?<QualityPage quality={quality} events={events}/>:active==='Fuentes de datos'?<SourcesPage sources={sources} onSync={sync} busy={busy}/>:active==='Auditoría y configuración'?<AuditPage audit={audit}/>:active==='Modelos de Machine Learning'?<MLPage events={events}/>:active==='Estimaciones experimentales'?<EstimatesPage events={events} series={series}/>:active==='Reglas de alertas'?<AlertRulesPage events={events}/>:active==='Centro de alertas'?<AlertCenterPage events={events}/>:active==='Reportes'?<ReportsPage events={events}/>:active==='Usuarios y roles'?<UsersRolesPage/>:<InfoPage title="Usuarios y roles" text="Módulo de interfaz inicial. Antes de producción, conectar un proveedor de identidad y autorización real en cada endpoint; ocultar botones no es un control de seguridad."/>}<footer><span>© 2026 Sismo Platform Enterprise · MVP técnico</span><span><i className="green-dot"/> Los datos observados se distinguen de las estimaciones experimentales.</span><span>API v1.0</span></footer></div></main></div>}
function Dashboard({summary,events,series,sources,onSync,busy}:{summary:any;events:EventItem[];series:any[];sources:any[];onSync:()=>void;busy:boolean}){const [days,setDays]=useState('30');const [region,setRegion]=useState('');const [country,setCountry]=useState('');const [minMag,setMinMag]=useState('0');const countries=Array.from(new Set(events.map(e=>e.place.split(',').map(x=>x.trim()).filter(Boolean).slice(-1)[0]).filter(Boolean))).sort((a,b)=>a.localeCompare(b));const cutoff=Date.now()-Number(days)*86400000;const filtered=events.filter(e=>new Date(e.occurred_at).getTime()>=cutoff&&e.magnitude>=Number(minMag)&&e.place.toLowerCase().includes(region.toLowerCase())&&(!country||e.place.split(',').map(x=>x.trim()).filter(Boolean).slice(-1)[0]===country));const peaks=[...filtered].sort((a,b)=>new Date(a.occurred_at).getTime()-new Date(b.occurred_at).getTime()).slice(-120).map(e=>({time:new Date(e.occurred_at).toLocaleString('es-PE',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit',timeZone:'UTC'}),magnitude:e.magnitude,place:e.place,depth:e.depth_km}));const mags=[{label:'< 2',count:0},{label:'2–3.9',count:0},{label:'4–5.9',count:0},{label:'6+',count:0}];filtered.forEach(e=>{const i=e.magnitude<2?0:e.magnitude<4?1:e.magnitude<6?2:3;mags[i].count++});return <><Panel title="Filtros rápidos" subtitle="Afectan a los indicadores, picos y distribución del dashboard"><div className="toolbar"><label>Período<select value={days} onChange={e=>setDays(e.target.value)}><option value="1">Últimas 24 horas</option><option value="7">Últimos 7 días</option><option value="30">Últimos 30 días</option><option value="90">Últimos 90 días</option><option value="365">Último año</option><option value="3650">Todo lo cargado</option></select></label><label>País<select value={country} onChange={e=>setCountry(e.target.value)}><option value="">Todos los países</option>{countries.map(c=><option key={c} value={c}>{c}</option>)}</select></label><label>Magnitud mínima<select value={minMag} onChange={e=>setMinMag(e.target.value)}><option value="0">Todas</option><option value="2">2+</option><option value="4">4+</option><option value="5">5+</option><option value="6">6+</option></select></label><label>País / región / lugar<input value={region} onChange={e=>setRegion(e.target.value)} placeholder="Ej. Peru, Chile, Japan…"/></label><span className="tag muted">{filtered.length} eventos filtrados</span><button className="secondary" onClick={()=>{setDays('30');setCountry('');setMinMag('0');setRegion('')}}>Limpiar filtros</button></div></Panel><div className="kpi-grid"><Kpi label="Eventos registrados" value={filtered.length.toLocaleString('es-PE')} sub="Coinciden con filtros" icon={Waves}/><Kpi label="Magnitud promedio" value={filtered.length?(filtered.reduce((n,e)=>n+e.magnitude,0)/filtered.length).toFixed(2):'—'} sub="Magnitud media filtrada" icon={Activity}/><Kpi label="Profundidad media" value={filtered.length?`${(filtered.reduce((n,e)=>n+e.depth_km,0)/filtered.length).toFixed(1)} km`:'—'} sub="Profundidad media filtrada" icon={Layers3}/><Kpi label="Fuentes configuradas" value={sources.length} sub="Conector USGS" icon={RadioTower}/></div><div className="grid-two"><Panel title="Actividad sísmica por día" subtitle={`${days} día(s) · eventos según filtros`}><div className="chart"><ResponsiveContainer width="100%" height="100%"><AreaChart data={Object.values(filtered.reduce((acc:any,e)=>{const d=e.occurred_at.slice(0,10);acc[d]??={date:d,count:0};acc[d].count++;return acc},{}))}><defs><linearGradient id="areaFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#06b6d4" stopOpacity={.3}/><stop offset="95%" stopColor="#06b6d4" stopOpacity={0}/></linearGradient></defs><CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e8edf3"/><XAxis dataKey="date" tick={{fontSize:10}} tickFormatter={v=>v.slice(5)} minTickGap={24}/><YAxis allowDecimals={false} tick={{fontSize:10}}/><Tooltip/><Area type="monotone" dataKey="count" name="Eventos" stroke="#0891b2" fill="url(#areaFill)" strokeWidth={2}/></AreaChart></ResponsiveContainer></div></Panel><Panel title="Distribución por magnitud" subtitle="Eventos filtrados por el panel"><div className="chart"><ResponsiveContainer width="100%" height="100%"><BarChart data={mags}><CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e8edf3"/><XAxis dataKey="label" tick={{fontSize:11}}/><YAxis allowDecimals={false} tick={{fontSize:10}}/><Tooltip/><Bar dataKey="count" name="Eventos" fill="#0891b2" radius={[5,5,0,0]}/></BarChart></ResponsiveContainer></div></Panel></div><div className="grid-two lower-grid"><Panel title="Picos de magnitud sísmica" subtitle="Cada punto representa un evento reportado; no es un sismograma de estación"><div className="chart"><ResponsiveContainer width="100%" height="100%"><LineChart data={peaks}><CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e8edf3"/><XAxis dataKey="time" tick={{fontSize:9}} minTickGap={28}/><YAxis domain={[0,'auto']} tick={{fontSize:10}} label={{value:'Magnitud',angle:-90,position:'insideLeft'}}/><Tooltip formatter={(v:any)=>[Number(v).toFixed(1),'Magnitud']}/><Line type="monotone" dataKey="magnitude" name="Magnitud" stroke="#e05252" strokeWidth={2} dot={{r:2}} activeDot={{r:5}}/></LineChart></ResponsiveContainer></div><div className="muted-note">Pico máximo de la selección: {filtered.length?Math.max(...filtered.map(e=>e.magnitude)).toFixed(1):'—'} · Datos reportados por la fuente.</div></Panel><Panel title="Eventos recientes" subtitle="Procedencia y hora del evento"><EventTable events={[...filtered].sort((a,b)=>new Date(b.occurred_at).getTime()-new Date(a.occurred_at).getTime()).slice(0,7)}/></Panel><Panel title="Estado de las fuentes" subtitle="Estado reportado por la API"><div className="source-list">{sources.map((s:any)=><div className="source-row" key={s.id}><div className="source-logo">US</div><div className="source-info"><b>{s.name}</b><small>{s.organization} · {s.last_status==='success'?'Última sincronización correcta':'Pendiente de primera sincronización'}</small><small>Última ejecución: {s.last_sync_at?new Date(s.last_sync_at).toLocaleString('es-PE'):'Nunca'}</small></div><span className={`tag ${s.last_status==='success'?'good':'muted'}`}>{s.last_status==='success'?'Operativa':'Configurada'}</span></div>)}{!sources.length&&<Empty text="No hay fuentes disponibles. Comprueba la conexión de la API."/>}</div><button className="secondary full" disabled={busy} onClick={onSync}>{busy?'Sincronizando…':'Sincronizar catálogo USGS'}</button></Panel></div></>}
function Kpi({label,value,sub,icon:Icon}:any){return <div className="kpi"><div className="kpi-top"><span>{label}</span><div className="kpi-icon"><Icon size={17}/></div></div><strong>{value}</strong><small>{sub}</small></div>}
function Panel({title,subtitle,children}:any){return <section className="panel"><div className="panel-head"><div><h2>{title}</h2><p>{subtitle}</p></div></div>{children}</section>}
function EventsPage({events}:{events:EventItem[]}){const [q,setQ]=useState('');const [min,setMin]=useState('0');const [max,setMax]=useState('10');const [depth,setDepth]=useState('700');const [days,setDays]=useState('3650');const [source,setSource]=useState('all');const [sort,setSort]=useState('time');const cutoff=Date.now()-Number(days)*86400000;const rows=events.filter(e=>e.place.toLowerCase().includes(q.toLowerCase())&&e.magnitude>=Number(min)&&e.magnitude<=Number(max)&&e.depth_km<=Number(depth)&&new Date(e.occurred_at).getTime()>=cutoff&&(source==='all'||e.source_id===source)).sort((a,b)=>sort==='mag'?b.magnitude-a.magnitude:sort==='depth'?a.depth_km-b.depth_km:new Date(b.occurred_at).getTime()-new Date(a.occurred_at).getTime());return <Panel title="Catálogo de eventos sísmicos" subtitle={`${rows.length} eventos coinciden con los filtros · fuente y fecha preservadas`}><div className="toolbar"><div className="searchbox"><Search size={16}/><input value={q} onChange={e=>setQ(e.target.value)} placeholder="Buscar ciudad, región o lugar"/></div><label>Período<select value={days} onChange={e=>setDays(e.target.value)}><option value="1">24 horas</option><option value="7">7 días</option><option value="30">30 días</option><option value="90">90 días</option><option value="365">1 año</option><option value="3650">Todo lo cargado</option></select></label><label>Magnitud mín.<select value={min} onChange={e=>setMin(e.target.value)}><option value="0">Todas</option><option value="2">2+</option><option value="4">4+</option><option value="5">5+</option><option value="6">6+</option></select></label><label>Magnitud máx.<select value={max} onChange={e=>setMax(e.target.value)}><option value="3">3</option><option value="5">5</option><option value="7">7</option><option value="10">10</option></select></label><label>Profundidad máx.<select value={depth} onChange={e=>setDepth(e.target.value)}><option value="70">70 km</option><option value="300">300 km</option><option value="700">700 km</option></select></label><label>Fuente<select value={source} onChange={e=>setSource(e.target.value)}><option value="all">Todas</option><option value="USGS">USGS</option></select></label><label>Ordenar<select value={sort} onChange={e=>setSort(e.target.value)}><option value="time">Más recientes</option><option value="mag">Mayor magnitud</option><option value="depth">Menor profundidad</option></select></label></div><EventTable events={rows}/><p className="muted-note">Se cargan todas las páginas disponibles de la API. Total recibido: {events.length.toLocaleString('es-PE')} eventos.</p></Panel>}
function EventTable({events}:{events:EventItem[]}){return <div className="table-wrap"><table><thead><tr><th>Magnitud</th><th>Ubicación</th><th>Fecha / hora UTC</th><th>Profundidad</th><th>Fuente</th></tr></thead><tbody>{events.map(e=><tr key={e.id}><td><span className={`magnitude ${e.magnitude>=6?'major':e.magnitude>=4?'moderate':'minor'}`}>{e.magnitude.toFixed(1)}</span></td><td className="place-cell">{e.place}</td><td>{new Date(e.occurred_at).toLocaleString('es-PE',{timeZone:'UTC'})}</td><td>{e.depth_km.toFixed(1)} km</td><td>{e.source_id}{e.source_url&&<a className="source-link" href={e.source_url} target="_blank" rel="noreferrer" aria-label="Ver fuente"><ExternalLink size={13}/></a>}</td></tr>)}{!events.length&&<tr><td colSpan={5}><Empty text="No hay eventos cargados. Ejecuta una sincronización desde Fuentes de datos."/></td></tr>}</tbody></table></div>}
function AnalysisPage({events,series}:{events:EventItem[];series:any[]}){
 const [days,setDays]=useState('30'); const [minMag,setMinMag]=useState('0'); const [maxMag,setMaxMag]=useState('10'); const [maxDepth,setMaxDepth]=useState('700'); const [query,setQuery]=useState('');
 const cutoff=Date.now()-Number(days)*86400000;
 const rows=events.filter(e=>new Date(e.occurred_at).getTime()>=cutoff&&e.magnitude>=Number(minMag)&&e.magnitude<=Number(maxMag)&&e.depth_km<=Number(maxDepth)&&e.place.toLowerCase().includes(query.toLowerCase()));
 const scatter=rows.map(e=>({depth:e.depth_km,mag:e.magnitude,place:e.place,time:e.occurred_at}));
 const buckets=[{range:'< 2',n:0},{range:'2–3.9',n:0},{range:'4–5.9',n:0},{range:'6+',n:0}]; rows.forEach(e=>buckets[e.magnitude<2?0:e.magnitude<4?1:e.magnitude<6?2:3].n++);
 const trend=series.filter(x=>new Date(x.date).getTime()>=cutoff);
 return <><Panel title="Filtros de análisis" subtitle="Los gráficos y métricas se recalculan usando los registros cargados"><div className="toolbar"><label>Período<select value={days} onChange={e=>setDays(e.target.value)}><option value="1">24 horas</option><option value="7">7 días</option><option value="30">30 días</option><option value="90">90 días</option><option value="365">1 año</option></select></label><label>Magnitud mín.<select value={minMag} onChange={e=>setMinMag(e.target.value)}><option value="0">0</option><option value="2">2</option><option value="4">4</option><option value="5">5</option></select></label><label>Magnitud máx.<select value={maxMag} onChange={e=>setMaxMag(e.target.value)}><option value="3">3</option><option value="5">5</option><option value="7">7</option><option value="10">10</option></select></label><label>Profundidad máx. (km)<select value={maxDepth} onChange={e=>setMaxDepth(e.target.value)}><option value="70">70</option><option value="300">300</option><option value="700">700</option></select></label><div className="searchbox"><Search size={16}/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Filtrar lugar…"/></div></div><div className="inline-stats"><b>{rows.length.toLocaleString('es-PE')} eventos</b><span>Magnitud media: {rows.length?(rows.reduce((a,e)=>a+e.magnitude,0)/rows.length).toFixed(2):'—'}</span><span>Profundidad media: {rows.length?(rows.reduce((a,e)=>a+e.depth_km,0)/rows.length).toFixed(1)+' km':'—'}</span></div></Panel>
 <div className="grid-two"><Panel title="Frecuencia temporal" subtitle={`Conteo diario disponible · ${days} días seleccionados`}><div className="chart"><ResponsiveContainer width="100%" height="100%"><AreaChart data={trend}><CartesianGrid strokeDasharray="3 3" vertical={false}/><XAxis dataKey="date" tickFormatter={v=>v.slice(5)}/><YAxis allowDecimals={false}/><Tooltip/><Area type="monotone" dataKey="count" name="Eventos" stroke="#0891b2" fill="#a5f3fc"/></AreaChart></ResponsiveContainer></div></Panel><Panel title="Dispersión: profundidad y magnitud" subtitle="Cada punto representa un evento reportado; no implica causalidad"><div className="chart"><ResponsiveContainer width="100%" height="100%"><ScatterChart margin={{top:10,right:20,bottom:20,left:0}}><CartesianGrid strokeDasharray="3 3"/><XAxis type="number" dataKey="depth" name="Profundidad" unit=" km"/><YAxis type="number" dataKey="mag" name="Magnitud" domain={[0,10]}/><ZAxis range={[35,90]}/><Tooltip cursor={{strokeDasharray:'3 3'}} formatter={(v:any,n:any)=>[v,n]}/><Legend/><Scatter name="Eventos" data={scatter} fill="#0891b2"/></ScatterChart></ResponsiveContainer></div></Panel></div>
 <Panel title="Distribución por magnitud" subtitle="Clasificación descriptiva de la muestra filtrada"><div className="chart"><ResponsiveContainer width="100%" height="100%"><BarChart data={buckets}><CartesianGrid strokeDasharray="3 3" vertical={false}/><XAxis dataKey="range"/><YAxis allowDecimals={false}/><Tooltip/><Bar dataKey="n" name="Eventos" fill="#0891b2" radius={[5,5,0,0]}/></BarChart></ResponsiveContainer></div></Panel></>}
function QualityPage({quality,events}:{quality:any;events:EventItem[]}){const [q,setQ]=useState('');const [onlyIssues,setOnlyIssues]=useState(false);const rows=events.filter(e=>e.place.toLowerCase().includes(q.toLowerCase())&&(!onlyIssues||(e.latitude < -90||e.latitude>90||e.longitude < -180||e.longitude>180||e.magnitude<0||e.magnitude>10||!e.place.trim())));const exportClean=()=>downloadCSV('eventos-preparados.csv',['id','fecha_utc','latitud','longitud','magnitud','profundidad_km','ubicacion','fuente'],rows.filter(e=>e.latitude>=-90&&e.latitude<=90&&e.longitude>=-180&&e.longitude<=180&&e.magnitude>=0&&e.magnitude<=10).map(e=>[e.external_id,e.occurred_at,e.latitude,e.longitude,e.magnitude,e.depth_km,e.place,e.source_id]));return <><div className="kpi-grid"><Kpi label="Filas revisadas" value={quality?.row_count??events.length} sub="Registros persistidos" icon={Database}/><Kpi label="Registros inválidos" value={quality?.invalid_records??'—'} sub="Coordenadas / magnitud fuera de rango" icon={ShieldCheck}/><Kpi label="Ubicación no informada" value={quality?.missing_place??'—'} sub="Campos genéricos" icon={Search}/><Kpi label="Política duplicados" value="Activa" sub="Fuente + ID externo" icon={Layers3}/></div><Panel title="Preparación y validación" subtitle="Inspecciona, filtra y exporta registros válidos para análisis"><div className="toolbar"><div className="searchbox"><Search size={16}/><input value={q} onChange={e=>setQ(e.target.value)} placeholder="Buscar ubicación o región"/></div><label className="check-label"><input type="checkbox" checked={onlyIssues} onChange={e=>setOnlyIssues(e.target.checked)}/> Mostrar posibles incidencias</label><button className="primary" onClick={exportClean}>Exportar dataset limpio (CSV)</button></div><div className="quality-row"><span>Validación de latitud / longitud / magnitud</span><b>{quality?.invalid_records??'—'} inválidos en la base</b></div><div className="quality-row"><span>Ubicaciones no informadas</span><b>{quality?.missing_place??'—'}</b></div><div className="quality-row"><span>Regla de idempotencia</span><b>UNIQUE(source_id, external_id)</b></div><div className="table-wrap"><table><thead><tr><th>ID externo</th><th>Fecha UTC</th><th>Ubicación</th><th>Magnitud</th><th>Prof. km</th><th>Validación</th></tr></thead><tbody>{rows.slice(0,250).map(e=>{const valid=e.latitude>=-90&&e.latitude<=90&&e.longitude>=-180&&e.longitude<=180&&e.magnitude>=0&&e.magnitude<=10&&!!e.place.trim();return <tr key={e.id}><td>{e.external_id}</td><td>{new Date(e.occurred_at).toLocaleString('es-PE',{timeZone:'UTC'})}</td><td>{e.place}</td><td>{e.magnitude.toFixed(1)}</td><td>{e.depth_km.toFixed(1)}</td><td><span className={`tag ${valid?'good':'muted'}`}>{valid?'Válido':'Revisar'}</span></td></tr>})}{!rows.length&&<tr><td colSpan={6}><Empty text="No hay registros que coincidan con el filtro."/></td></tr>}</tbody></table></div><p className="muted-note">La exportación excluye coordenadas o magnitudes fuera de rango; no modifica ni borra registros originales.</p></Panel></>}
function SourcesPage({sources,onSync,busy}:{sources:any[];onSync:()=>void;busy:boolean}){return <Panel title="Fuentes de datos" subtitle="Conectores configurados, trazabilidad y sincronización manual"><div className="source-list">{sources.map(s=><div className="source-row expanded" key={s.id}><div className="source-logo">US</div><div className="source-info"><b>{s.name}</b><small>{s.organization} · {s.type}</small><small>Endpoint: {s.url}</small><small>Última sincronización: {s.last_sync_at?new Date(s.last_sync_at).toLocaleString('es-PE'):'Sin ejecutar'}</small><small>Última ejecución: {s.last_status} · vistos: {s.records_seen} · nuevos: {s.records_inserted}</small></div><span className={`tag ${s.last_status==='success'?'good':'muted'}`}>{s.last_status==='success'?'Correcta':'Configurada'}</span></div>)}</div><button className="primary" disabled={busy} onClick={onSync}><RefreshCw size={15}/>{busy?'Sincronizando…':'Sincronizar últimos 7 días'}</button><p className="muted-note">La ingesta es manual en esta entrega. Automatización programada, reintentos con backoff y monitoreo de latencia quedan como tareas de endurecimiento.</p></Panel>}
function AuditPage({audit}:{audit:any[]}){const [q,setQ]=useState('');const [action,setAction]=useState('all');const rows=audit.filter(a=>([a.actor,a.action,a.entity_type,a.entity_id,a.details].join(' ').toLowerCase().includes(q.toLowerCase()))&&(action==='all'||a.action===action));const actions=Array.from(new Set(audit.map(a=>a.action)));return <Panel title="Bitácora de auditoría" subtitle="Acciones registradas por la API · búsqueda y filtro de acción"><div className="toolbar"><div className="searchbox"><Search size={16}/><input value={q} onChange={e=>setQ(e.target.value)} placeholder="Buscar actor, entidad o detalle"/></div><label>Acción<select value={action} onChange={e=>setAction(e.target.value)}><option value="all">Todas</option>{actions.map((a:string)=><option key={a} value={a}>{a}</option>)}</select></label><span className="tag muted">{rows.length} entradas</span></div><div className="table-wrap"><table><thead><tr><th>Fecha UTC</th><th>Actor</th><th>Acción</th><th>Entidad</th><th>Detalle</th></tr></thead><tbody>{rows.map(a=><tr key={a.id}><td>{new Date(a.occurred_at).toLocaleString('es-PE',{timeZone:'UTC'})}</td><td>{a.actor}</td><td>{a.action}</td><td>{a.entity_type} {a.entity_id}</td><td>{a.details}</td></tr>)}{!rows.length&&<tr><td colSpan={5}><Empty text="No hay entradas para este filtro. Sincroniza una fuente para generar actividad auditada."/></td></tr>}</tbody></table></div></Panel>}
function MLPage({events}:{events:EventItem[]}){
 const [threshold,setThreshold]=useState('4');const [target,setTarget]=useState('magnitude');const [testPct,setTestPct]=useState('20');const [result,setResult]=useState<any>(null);const [runError,setRunError]=useState('');const [persistStatus,setPersistStatus]=useState('');const saveExperiment=async()=>{if(!result)return;setPersistStatus('Guardando experimento…');try{const saved=await api<any>('/api/v1/ml/experiments',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:`Clasificación sísmica ${new Date().toISOString().slice(0,10)}`,task_type:'classification',algorithm:'logistic-regression-binary',dataset_version:result.datasetVersion,target:result.target,features:result.features,metrics:{accuracy:result.accuracy,precision:result.precision,recall:result.recall,f1:result.f1,base_accuracy:result.baseAccuracy,confusion_matrix:{tn:result.tn,fp:result.fp,fn:result.fn,tp:result.tp}},validation:{total:result.total,train:result.train,test:result.test,first_train:result.firstTrain,last_train:result.lastTrain,first_test:result.firstTest,last_test:result.lastTest,chronological:true},seed:42,dependencies:'TypeScript/JavaScript local; no external ML package'})});setPersistStatus(`Experimento #${saved.id} guardado en la API.`)}catch(e){setPersistStatus(e instanceof Error?e.message:'No se pudo guardar el experimento.')}};
 const labelled=events.filter(e=>Number.isFinite(e.magnitude)&&Number.isFinite(e.depth_km)&&Number.isFinite(e.latitude)&&Number.isFinite(e.longitude)&&!!e.occurred_at);
 const positives=labelled.filter(e=>target==='magnitude'?e.magnitude>=Number(threshold):e.depth_km>=Number(threshold)*10).length;const rate=labelled.length?positives/labelled.length*100:0;
 const train=()=>{setRunError('');setResult(null);const rows=[...labelled].sort((a,b)=>new Date(a.occurred_at).getTime()-new Date(b.occurred_at).getTime());const split=Math.floor(rows.length*(1-Number(testPct)/100));if(rows.length<20){setRunError('Se necesitan al menos 20 registros válidos para una evaluación cronológica básica. Sincroniza más eventos e inténtalo de nuevo.');return}if(split<10||rows.length-split<5){setRunError('La partición deja muy pocos registros para entrenar o probar.');return}
 const label=(e:EventItem)=>Number(target==='magnitude'?e.magnitude>=Number(threshold):e.depth_km>=Number(threshold)*10);const raw=(e:EventItem)=>target==='magnitude'?[e.depth_km,e.latitude,e.longitude]:[e.magnitude,e.latitude,e.longitude];const trainRows=rows.slice(0,split),testRows=rows.slice(split);const X=trainRows.map(raw),Y=trainRows.map(label);const means=[0,1,2].map(j=>X.reduce((a,x)=>a+x[j],0)/X.length);const scales=[0,1,2].map(j=>Math.sqrt(X.reduce((a,x)=>a+(x[j]-means[j])**2,0)/X.length)||1);const norm=(e:EventItem)=>[1,...raw(e).map((v,j)=>(v-means[j])/scales[j])];let w=[0,0,0,0];const sigmoid=(z:number)=>1/(1+Math.exp(-Math.max(-30,Math.min(30,z))));for(let epoch=0;epoch<900;epoch++){const grad=[0,0,0,0];for(let i=0;i<trainRows.length;i++){const x=norm(trainRows[i]);const err=sigmoid(w.reduce((a,v,j)=>a+v*x[j],0))-Y[i];for(let j=0;j<w.length;j++)grad[j]+=err*x[j]}for(let j=0;j<w.length;j++)w[j]-=.08*(grad[j]/trainRows.length+(j===0?0:.001*w[j]))}
 const predicted=testRows.map(e=>Number(sigmoid(w.reduce((a,v,j)=>a+v*norm(e)[j],0))>=.5));const actual=testRows.map(label);let tp=0,tn=0,fp=0,fn=0;actual.forEach((y,i)=>{if(y===1&&predicted[i]===1)tp++;else if(y===0&&predicted[i]===0)tn++;else if(y===0)fp++;else fn++});const precision=tp+fp?tp/(tp+fp):0,recall=tp+fn?tp/(tp+fn):0,f1=precision+recall?2*precision*recall/(precision+recall):0,accuracy=(tp+tn)/actual.length;const majority=Y.filter(v=>v===1).length>=Y.length/2?1:0;const baseAccuracy=actual.filter(v=>v===majority).length/actual.length;const last=rows[rows.length-1];const datasetVersion=`events-${rows.length}-${new Date(last.occurred_at).toISOString().slice(0,10)}-${String(last.id)}`;setResult({total:rows.length,train:trainRows.length,test:testRows.length,positive:Y.filter(v=>v===1).length,testPositive:actual.filter(v=>v===1).length,tp,tn,fp,fn,precision,recall,f1,accuracy,baseAccuracy,datasetVersion,firstTrain:trainRows[0].occurred_at,lastTrain:trainRows[trainRows.length-1].occurred_at,firstTest:testRows[0].occurred_at,lastTest:testRows[testRows.length-1].occurred_at,features:target==='magnitude'?['depth_km','latitude','longitude']:['magnitude','latitude','longitude'],target:target==='magnitude'?`magnitude >= ${threshold}`:`depth_km >= ${Number(threshold)*10} km`})};
 return <><div className="banner warning">Laboratorio retrospectivo reproducible. Este clasificador explora eventos históricos; no predice cuándo ni dónde ocurrirá un terremoto y no genera alertas oficiales.</div><div className="grid-two"><Panel title="Configurar experimento" subtitle="Define una etiqueta histórica y evalúa con separación cronológica"><div className="toolbar"><label>Variable objetivo<select value={target} onChange={e=>{setTarget(e.target.value);setResult(null)}}><option value="magnitude">Magnitud por umbral</option><option value="depth">Profundidad por umbral</option></select></label><label>Umbral<select value={threshold} onChange={e=>{setThreshold(e.target.value);setResult(null)}}>{(target==='magnitude'?['2','3','4','5','6']:['1','3','5','10','20']).map(v=><option key={v} value={v}>{v}{target==='depth'?' × 10 km':''}</option>)}</select></label><label>Prueba cronológica<select value={testPct} onChange={e=>{setTestPct(e.target.value);setResult(null)}}><option value="20">20% más reciente</option><option value="25">25% más reciente</option><option value="30">30% más reciente</option></select></label></div><div className="ml-metric"><strong>{labelled.length.toLocaleString('es-PE')}</strong><span>registros válidos con fecha, magnitud, profundidad y coordenadas</span></div><div className="inline-stats"><span>Etiqueta positiva: {positives.toLocaleString('es-PE')}</span><span>Proporción: {rate.toFixed(1)}%</span><span>Etiqueta negativa: {(labelled.length-positives).toLocaleString('es-PE')}</span></div><button className="primary" onClick={train}>Ejecutar protocolo y evaluar</button>{runError&&<div className="banner error">{runError}</div>}<p className="muted-note">Modelo: regresión logística binaria implementada en el navegador. Variables predictoras: profundidad, latitud y longitud; la fecha solo ordena la partición y no se usa como predictor. La etiqueta se deriva del umbral seleccionado.</p></Panel><Panel title="Protocolo de modelado" subtitle="Lista de control antes de entrenar"><ul className="check-list"><li>Definir objetivo y evitar usar el futuro como variable predictora.</li><li>Separar entrenamiento y prueba cronológicamente.</li><li>Comparar contra una línea base sencilla.</li><li>Registrar versión del dataset, variables, semilla y dependencias.</li><li>Evaluar precisión, recall, F1 y matriz de confusión si aplica.</li></ul><span className={`tag ${result?'good':'muted'}`}>{result?'Protocolo ejecutado':'Pendiente de ejecutar'}</span><p className="muted-note">La partición cronológica reserva los eventos más recientes para prueba. Semilla registrada: 42 (este entrenamiento es determinista y no necesita muestreo aleatorio).</p></Panel></div>
 {result&&<><div className="kpi-grid"><Kpi label="Exactitud" value={`${(result.accuracy*100).toFixed(1)}%`} sub="En el bloque de prueba" icon={Activity}/><Kpi label="Precisión" value={`${(result.precision*100).toFixed(1)}%`} sub="De positivos predichos" icon={ChartNoAxesCombined}/><Kpi label="Recall" value={`${(result.recall*100).toFixed(1)}%`} sub="Positivos detectados" icon={Gauge}/><Kpi label="F1" value={`${(result.f1*100).toFixed(1)}%`} sub="Balance precisión/recall" icon={BrainCircuit}/></div><div className="grid-two"><Panel title="Matriz de confusión" subtitle="Evaluación en los eventos más recientes"><div className="table-wrap"><table><thead><tr><th></th><th>Predicho negativo</th><th>Predicho positivo</th></tr></thead><tbody><tr><th>Real negativo</th><td>{result.tn}</td><td>{result.fp}</td></tr><tr><th>Real positivo</th><td>{result.fn}</td><td>{result.tp}</td></tr></tbody></table></div><p className="muted-note">Precisión = TP/(TP+FP). Recall = TP/(TP+FN). F1 = media armónica de precisión y recall.</p></Panel><Panel title="Comparación con línea base" subtitle="La línea base predice siempre la clase mayoritaria del entrenamiento"><div className="inline-stats"><span>Modelo: <b>{(result.accuracy*100).toFixed(1)}%</b></span><span>Línea base: <b>{(result.baseAccuracy*100).toFixed(1)}%</b></span><span>Diferencia: <b>{((result.accuracy-result.baseAccuracy)*100).toFixed(1)} puntos</b></span></div><p className="muted-note">Si el modelo no supera la línea base, no debe considerarse útil sin más análisis.</p></Panel></div><Panel title="Registro reproducible del experimento" subtitle="Metadatos de esta ejecución"><div className="table-wrap"><table><tbody><tr><th>Versión del dataset</th><td>{result.datasetVersion}</td></tr><tr><th>Objetivo</th><td>{result.target}</td></tr><tr><th>Variables predictoras</th><td>{result.features.join(', ')}</td></tr><tr><th>Registros</th><td>{result.total} total · {result.train} entrenamiento · {result.test} prueba</td></tr><tr><th>Ventana de entrenamiento (UTC)</th><td>{new Date(result.firstTrain).toISOString()} — {new Date(result.lastTrain).toISOString()}</td></tr><tr><th>Ventana de prueba (UTC)</th><td>{new Date(result.firstTest).toISOString()} — {new Date(result.lastTest).toISOString()}</td></tr><tr><th>Semilla</th><td>42 (sin aleatoriedad en el ajuste)</td></tr><tr><th>Dependencias</th><td>Implementación local TypeScript/JavaScript; no añade paquetes de ML externos.</td></tr><tr><th>Algoritmo</th><td>Regresión logística binaria; variables estandarizadas usando solo entrenamiento.</td></tr></tbody></table></div><button className="secondary" onClick={()=>downloadFile(`protocolo-modelado-${new Date().toISOString().slice(0,10)}.json`,JSON.stringify({generatedAt:new Date().toISOString(),seed:42,algorithm:'logistic-regression-binary',...result},null,2),'application/json')}>Exportar registro JSON</button> <button className="primary" onClick={()=>void saveExperiment()}>Guardar experimento en API</button>{persistStatus&&<p className="muted-note">{persistStatus}</p>}</Panel></>}
 <Panel title="Variables disponibles" subtitle="Campos reales y uso aplicado en el experimento"><div className="table-wrap"><table><thead><tr><th>Variable</th><th>Uso</th><th>Regla</th></tr></thead><tbody><tr><td>Profundidad (km)</td><td>Predictora solo para objetivo magnitud</td><td>No se usa como predictor cuando la profundidad es la etiqueta</td></tr><tr><td>Latitud / longitud</td><td>Predictoras</td><td>Contexto geográfico del evento</td></tr><tr><td>Magnitud</td><td>Etiqueta o predictora según objetivo</td><td>No se usa como predictor cuando la magnitud es la etiqueta</td></tr><tr><td>Fecha UTC</td><td>Orden cronológico</td><td>No entra al modelo; evita partición aleatoria</td></tr><tr><td>Fuente / ID externo</td><td>Trazabilidad</td><td>No se usan como predictores</td></tr></tbody></table></div></Panel></>}
function urlBase64ToUint8Array(base64String:string){const padding='='.repeat((4-base64String.length%4)%4);const base64=(base64String+padding).replace(/-/g,'+').replace(/_/g,'/');const raw=window.atob(base64);return Uint8Array.from([...raw].map(c=>c.charCodeAt(0)))}
async function registerPhonePush(){if(!('serviceWorker' in navigator)||!('PushManager' in window))throw new Error('Este navegador no admite Web Push. Usa Chrome/Edge en Android o Safari compatible en iOS, con HTTPS.');if(!('Notification' in window))throw new Error('Este navegador no admite notificaciones.');const permission=await Notification.requestPermission();if(permission!=='granted')throw new Error('Permiso de notificaciones denegado. Actívalo en los ajustes del navegador.');const apiBase=(import.meta.env.VITE_API_URL||'http://localhost:8000').replace(/\/$/,'');const keyRes=await fetch(`${apiBase}/api/v1/push/public-key`);if(!keyRes.ok)throw new Error('No se pudo consultar la configuración push de la API.');const key=await keyRes.json();if(!key.configured||!key.public_key)throw new Error('Falta configurar VAPID en el backend. Revisa la guía de alertas push en README.md y reinicia la API.');const sw=await navigator.serviceWorker.register('/sw.js');const ready=await navigator.serviceWorker.ready;let sub=await ready.pushManager.getSubscription();if(!sub)sub=await ready.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:urlBase64ToUint8Array(key.public_key)});const response=await fetch(`${apiBase}/api/v1/push/subscriptions`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(sub)});if(!response.ok)throw new Error(`No se pudo registrar el celular: ${await response.text()}`);return 'Celular registrado para recibir notificaciones push.'}
function AlertRulesPage({events}:{events:EventItem[]}){const [notify,setNotify]=useState(()=>{try{return JSON.parse(localStorage.getItem('sismo-alert-config')||'{"enabled":false,"minMagnitude":5,"region":""}')}catch{return {enabled:false,minMagnitude:5,region:''}}});const [permission,setPermission]=useState(('Notification' in window)?Notification.permission:'unsupported');const [pushStatus,setPushStatus]=useState('');const [pushBusy,setPushBusy]=useState(false);const [autoMin,setAutoMin]=useState('5');const [autoEnabled,setAutoEnabled]=useState(true);useEffect(()=>{const base=(import.meta.env.VITE_API_URL||'http://localhost:8000').replace(/\/$/,'');fetch(`${base}/api/v1/alerts/automatic-config`).then(r=>r.ok?r.json():Promise.reject()).then(c=>{setAutoMin(String(c.min_magnitude));setAutoEnabled(Boolean(c.enabled))}).catch(()=>setPushStatus('No se pudo leer la configuración automática desde la API.'))},[]);const saveAutomatic=async(enabled:boolean,minimum:number)=>{const base=(import.meta.env.VITE_API_URL||'http://localhost:8000').replace(/\/$/,'');const r=await fetch(`${base}/api/v1/alerts/automatic-config`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({enabled,min_magnitude:minimum})});const data=await r.json();if(!r.ok)throw new Error(data.detail||'No se pudo guardar la configuración automática.');setAutoEnabled(data.enabled);setAutoMin(String(data.min_magnitude));setPushStatus('Configuración automática guardada en el backend.');};const saveNotify=(next:any)=>{setNotify(next);localStorage.setItem('sismo-alert-config',JSON.stringify(next))};const enableNotifications=async()=>{try{setPushBusy(true);setPushStatus(await registerPhonePush());setPermission(('Notification'in window)?Notification.permission:'unsupported');saveNotify({...notify,enabled:true});}catch(e){setPushStatus(e instanceof Error?e.message:'No se pudo activar push.')}finally{setPushBusy(false)}};const sendTest=async()=>{setPushBusy(true);setPushStatus('Enviando alerta de prueba…');try{const apiBase=(import.meta.env.VITE_API_URL||'http://localhost:8000').replace(/\/$/,'');const response=await fetch(`${apiBase}/api/v1/alerts/test`,{method:'POST'});const data=await response.json();if(!response.ok)throw new Error(data.detail||'No se pudo enviar la prueba.');setPushStatus(data.message||'Alerta de prueba enviada.');}catch(e){setPushStatus(e instanceof Error?e.message:'Error al enviar la prueba.')}finally{setPushBusy(false)}};type Rule={id:string;name:string;minMagnitude:number;maxDepth:number;region:string;enabled:boolean};const [rules,setRules]=useState<Rule[]>(()=>{try{return JSON.parse(localStorage.getItem('sismo-alert-rules')||'[]')}catch{return []}});const [name,setName]=useState('Magnitud alta');const [minMag,setMinMag]=useState('5');const [maxDepth,setMaxDepth]=useState('700');const [region,setRegion]=useState('');useEffect(()=>{localStorage.setItem('sismo-alert-rules',JSON.stringify(rules))},[rules]);const add=()=>{if(!name.trim())return;setRules(old=>[{id:crypto.randomUUID(),name:name.trim(),minMagnitude:Number(minMag),maxDepth:Number(maxDepth),region:region.trim(),enabled:true},...old]);setName('Magnitud alta');};const matches=rules.reduce((n,r)=>n+(r.enabled?events.filter(e=>e.magnitude>=r.minMagnitude&&e.depth_km<=r.maxDepth&&(!r.region||e.place.toLowerCase().includes(r.region.toLowerCase()))).length:0),0);return <><Panel title="Alertas en el celular" subtitle="Registra este dispositivo, envía una prueba manual y configura avisos automáticos al sincronizar nuevos eventos"><div className="toolbar"><label>Magnitud mínima (avisos del navegador)<select value={String(notify.minMagnitude)} onChange={e=>saveNotify({...notify,minMagnitude:Number(e.target.value)})}><option value="2">2.0+</option><option value="3">3.0+</option><option value="4">4.0+</option><option value="5">5.0+</option><option value="6">6.0+</option></select></label><label>Ubicación contiene (filtro local)<input value={notify.region||''} onChange={e=>saveNotify({...notify,region:e.target.value})} placeholder="Perú, Chile…"/></label><span className={`tag ${permission==='granted'?'good':'muted'}`}>Permiso: {permission}</span><button className="primary" disabled={pushBusy} onClick={()=>void enableNotifications()}>{pushBusy?'Procesando…':'Registrar este celular'}</button><button className="secondary" disabled={pushBusy} onClick={()=>void sendTest()}>Enviar alerta manual de prueba</button></div>{pushStatus&&<div className={`banner ${pushStatus.toLowerCase().includes('error')||pushStatus.toLowerCase().includes('falta')||pushStatus.toLowerCase().includes('denegado')||pushStatus.toLowerCase().includes('no se pudo')?'warning':'success'}`}>{pushStatus}</div>}<div className="toolbar"><label>Umbral automático<select value={autoMin} onChange={e=>{const value=e.target.value;setAutoMin(value);void saveAutomatic(autoEnabled,Number(value)).catch(err=>setPushStatus(err instanceof Error?err.message:'Error de configuración'))}}><option value="3">M ≥ 3.0</option><option value="4">M ≥ 4.0</option><option value="5">M ≥ 5.0</option><option value="6">M ≥ 6.0</option></select></label><button className={autoEnabled?'secondary':'primary'} onClick={()=>{const next=!autoEnabled;void saveAutomatic(next,Number(autoMin)).catch(err=>setPushStatus(err instanceof Error?err.message:'Error de configuración'))}}>{autoEnabled?'Pausar modo automático':'Activar modo automático'}</button><span className={`tag ${autoEnabled?'good':'muted'}`}>{autoEnabled?'Activado en API':'Pausado en API'}</span></div><p className="muted-note">El envío manual push llega a todos los celulares registrados en el backend. Los avisos automáticos se disparan tras sincronizar USGS cuando entran eventos nuevos que superan el umbral configurado en el backend. Para avisos con la app cerrada se requiere HTTPS y claves VAPID. Esto informa de sismos reportados; no es una alerta oficial ni predice terremotos.</p></Panel><Panel title="Crear regla de detección" subtitle="Reglas locales de revisión para los registros almacenados"><div className="toolbar"><label>Nombre<input value={name} onChange={e=>setName(e.target.value)} placeholder="Ej. Magnitud alta en Perú"/></label><label>Magnitud mínima<select value={minMag} onChange={e=>setMinMag(e.target.value)}><option value="2">2+</option><option value="4">4+</option><option value="5">5+</option><option value="6">6+</option></select></label><label>Profundidad máxima<select value={maxDepth} onChange={e=>setMaxDepth(e.target.value)}><option value="70">70 km</option><option value="300">300 km</option><option value="700">700 km</option></select></label><label>Contiene ubicación (opcional)<input value={region} onChange={e=>setRegion(e.target.value)} placeholder="Peru, Chile…"/></label><button className="primary" onClick={add}>Guardar regla</button></div></Panel><Panel title="Reglas guardadas" subtitle={`${rules.length} reglas · se conservan en este navegador`}><div className="table-wrap"><table><thead><tr><th>Regla</th><th>Condiciones</th><th>Coincidencias actuales</th><th>Estado</th><th>Acciones</th></tr></thead><tbody>{rules.map(r=>{const count=events.filter(e=>e.magnitude>=r.minMagnitude&&e.depth_km<=r.maxDepth&&(!r.region||e.place.toLowerCase().includes(r.region.toLowerCase()))).length;return <tr key={r.id}><td>{r.name}</td><td>M ≥ {r.minMagnitude}; profundidad ≤ {r.maxDepth} km{r.region?`; ubicación: ${r.region}`:''}</td><td>{r.enabled?count:0}</td><td><span className={`tag ${r.enabled?'good':'muted'}`}>{r.enabled?'Activa':'Pausada'}</span></td><td><button className="secondary" onClick={()=>setRules(old=>old.map(x=>x.id===r.id?{...x,enabled:!x.enabled}:x))}>{r.enabled?'Pausar':'Activar'}</button> <button className="secondary" onClick={()=>setRules(old=>old.filter(x=>x.id!==r.id))}>Eliminar</button></td></tr>})}{!rules.length&&<tr><td colSpan={5}><Empty text="Todavía no hay reglas. Crea una para revisar los eventos cargados."/></td></tr>}</tbody></table></div><p className="muted-note">Coincidencias: {matches}. Antes de producción, conecta las reglas a la API, control de acceso, auditoría y proveedores oficiales.</p></Panel></>}
function AlertCenterPage({ events }: { events: EventItem[] }) {
  const [minMag, setMinMag] = useState('4');
  const [status, setStatus] = useState('all');

  const rows = events
    .filter((e) => e.magnitude >= Number(minMag))
    .map((e) => ({
      ...e,
      alertStatus:
        e.magnitude >= 6
          ? 'Prioridad alta'
          : e.magnitude >= 5
            ? 'Revisión'
            : 'Informativa',
    }))
    .filter(
      (e) => status === 'all' || e.alertStatus === status
    )
    .sort(
      (a, b) =>
        new Date(b.occurred_at).getTime() -
        new Date(a.occurred_at).getTime()
    );

  const categories = [
    { id: 'all', label: 'Todos' },
    { id: 'Prioridad alta', label: 'Prioridad alta' },
    { id: 'Revisión', label: 'Revisión' },
    { id: 'Informativa', label: 'Informativa' },
  ];

  const countByCategory = (category: string) =>
    events.filter((e) => {
      const categoryMatches =
        category === 'all' ||
        (category === 'Prioridad alta' && e.magnitude >= 6) ||
        (category === 'Revisión' &&
          e.magnitude >= 5 &&
          e.magnitude < 6) ||
        (category === 'Informativa' && e.magnitude < 5);

      return categoryMatches && e.magnitude >= Number(minMag);
    }).length;

  return (
    <Panel
      title="Bandeja de revisión de eventos"
      subtitle="Clasificación automática por magnitud para facilitar la revisión. No representa alertas públicas u oficiales."
    >
      <div className="toolbar">
        <label>
          Magnitud mínima
          <select
            value={minMag}
            onChange={(e) => setMinMag(e.target.value)}
          >
            <option value="2">2.0+</option>
            <option value="4">4.0+</option>
            <option value="5">5.0+</option>
            <option value="6">6.0+</option>
          </select>
        </label>

        <span className="tag muted">
          {rows.length} eventos encontrados
        </span>
      </div>

      <div className="alert-category-filters">
        {categories.map((category) => (
          <button
            key={category.id}
            type="button"
            className={`alert-category-button ${
              status === category.id ? 'active' : ''
            }`}
            onClick={() => setStatus(category.id)}
            aria-pressed={status === category.id}
          >
            <span>{category.label}</span>
            <span className="alert-category-count">
              {countByCategory(category.id)}
            </span>
          </button>
        ))}
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Prioridad</th>
              <th>Magnitud</th>
              <th>Ubicación</th>
              <th>Fecha UTC</th>
              <th>Profundidad</th>
              <th>Fuente</th>
            </tr>
          </thead>

          <tbody>
            {rows.slice(0, 300).map((e) => (
              <tr key={e.id}>
                <td>
                  <span
                    className={`tag ${
                      e.alertStatus === 'Prioridad alta'
                        ? 'danger'
                        : e.alertStatus === 'Revisión'
                          ? 'warn'
                          : 'muted'
                    }`}
                  >
                    {e.alertStatus}
                  </span>
                </td>

                <td>
                  <span
                    className={`magnitude ${
                      e.magnitude >= 6
                        ? 'major'
                        : e.magnitude >= 4
                          ? 'moderate'
                          : 'minor'
                    }`}
                  >
                    {e.magnitude.toFixed(1)}
                  </span>
                </td>

                <td className="place-cell">{e.place}</td>

                <td>
                  {new Date(e.occurred_at).toLocaleString('es-PE', {
                    timeZone: 'UTC',
                  })}
                </td>

                <td>{e.depth_km.toFixed(1)} km</td>

                <td>
                  {e.source_id}
                  {e.source_url && (
                    <a
                      className="source-link"
                      href={e.source_url}
                      target="_blank"
                      rel="noreferrer"
                      aria-label="Consultar evento en la fuente original"
                      title="Ver evento en la fuente original"
                    >
                      <ExternalLink size={13} />
                    </a>
                  )}
                </td>
              </tr>
            ))}

            {!rows.length && (
              <tr>
                <td colSpan={6}>
                  <Empty text="No hay eventos que coincidan con la categoría y la magnitud seleccionadas." />
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {rows.length > 300 && (
        <p className="muted-note">
          Se muestran los primeros 300 eventos de los {rows.length}{' '}
          encontrados. Ajusta la magnitud mínima para reducir los resultados.
        </p>
      )}

      <p className="muted-note">
        Los niveles son criterios de clasificación de esta aplicación.
        No equivalen a una evaluación oficial del riesgo ni predicen
        daños o consecuencias.
      </p>
    </Panel>
  );
}
function UsersRolesPage(){type User={id:string;name:string;email:string;role:string;enabled:boolean};const [users,setUsers]=useState<User[]>(()=>{try{return JSON.parse(localStorage.getItem('sismo-demo-users')||'[{"id":"u-admin","name":"Administrador de demostración","email":"admin@example.local","role":"Administrador","enabled":true},{"id":"u-analyst","name":"Analista de demostración","email":"analista@example.local","role":"Analista","enabled":true}]')}catch{return []}});const [name,setName]=useState('');const [email,setEmail]=useState('');const [role,setRole]=useState('Analista');const [q,setQ]=useState('');useEffect(()=>{localStorage.setItem('sismo-demo-users',JSON.stringify(users))},[users]);const add=()=>{if(!name.trim()||!/^\S+@\S+\.\S+$/.test(email))return;if(users.some(u=>u.email.toLowerCase()===email.toLowerCase())){alert('Ese correo ya existe en la lista de demostración.');return}setUsers(old=>[{id:crypto.randomUUID(),name:name.trim(),email:email.trim(),role,enabled:true},...old]);setName('');setEmail('')};return <><div className="banner warning">Modo demostración local: estos roles no protegen la API ni equivalen a autenticación. No uses datos personales reales.</div><Panel title="Usuarios y roles (demostración)" subtitle="Altas, búsqueda, activación y asignación de roles guardadas en este navegador"><div className="toolbar"><label>Nombre<input value={name} onChange={e=>setName(e.target.value)} placeholder="Nombre de usuario"/></label><label>Correo<input type="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="usuario@dominio.com"/></label><label>Rol<select value={role} onChange={e=>setRole(e.target.value)}><option>Administrador</option><option>Analista</option><option>Operador</option><option>Auditor</option><option>Consulta</option></select></label><button className="primary" onClick={add}>Agregar usuario</button><div className="searchbox"><Search size={16}/><input value={q} onChange={e=>setQ(e.target.value)} placeholder="Buscar usuario…"/></div></div><div className="table-wrap"><table><thead><tr><th>Nombre</th><th>Correo</th><th>Rol</th><th>Estado</th><th>Acciones</th></tr></thead><tbody>{users.filter(u=>(u.name+' '+u.email+' '+u.role).toLowerCase().includes(q.toLowerCase())).map(u=><tr key={u.id}><td>{u.name}</td><td>{u.email}</td><td><select value={u.role} onChange={e=>setUsers(old=>old.map(x=>x.id===u.id?{...x,role:e.target.value}:x))}><option>Administrador</option><option>Analista</option><option>Operador</option><option>Auditor</option><option>Consulta</option></select></td><td><span className={`tag ${u.enabled?'good':'muted'}`}>{u.enabled?'Activo':'Inactivo'}</span></td><td><button className="secondary" onClick={()=>setUsers(old=>old.map(x=>x.id===u.id?{...x,enabled:!x.enabled}:x))}>{u.enabled?'Desactivar':'Activar'}</button> <button className="secondary" onClick={()=>{if(confirm('¿Eliminar este usuario de demostración?'))setUsers(old=>old.filter(x=>x.id!==u.id))}}>Eliminar</button></td></tr>)}</tbody></table></div></Panel></>}
function ReportsPage({events}:{events:EventItem[]}){const [q,setQ]=useState('');const [min,setMin]=useState('0');const [days,setDays]=useState('3650');const rows=events.filter(e=>e.magnitude>=Number(min)&&e.place.toLowerCase().includes(q.toLowerCase())&&new Date(e.occurred_at).getTime()>=Date.now()-Number(days)*86400000);const exportCsv=()=>downloadCSV(`sismos-${new Date().toISOString().slice(0,10)}.csv`,['external_id','source','occurred_at_utc','latitude','longitude','magnitude','depth_km','place','source_url'],rows.map(e=>[e.external_id,e.source_id,e.occurred_at,e.latitude,e.longitude,e.magnitude,e.depth_km,e.place,e.source_url??'']));const exportJson=()=>downloadFile(`sismos-${new Date().toISOString().slice(0,10)}.json`,JSON.stringify({generated_at:new Date().toISOString(),record_count:rows.length,source_note:'Eventos reportados; no predicciones.',events:rows},null,2),'application/json');return <Panel title="Generador de reportes" subtitle="Filtra una muestra y exporta datos trazables en CSV o JSON"><div className="toolbar"><div className="searchbox"><Search size={16}/><input value={q} onChange={e=>setQ(e.target.value)} placeholder="Ubicación / región"/></div><label>Magnitud mínima<select value={min} onChange={e=>setMin(e.target.value)}><option value="0">Todas</option><option value="2">2+</option><option value="4">4+</option><option value="5">5+</option><option value="6">6+</option></select></label><label>Período<select value={days} onChange={e=>setDays(e.target.value)}><option value="1">24 horas</option><option value="7">7 días</option><option value="30">30 días</option><option value="90">90 días</option><option value="365">1 año</option><option value="3650">Todo lo cargado</option></select></label></div><div className="report-card"><FileBarChart size={28}/><div><b>Eventos sísmicos filtrados</b><p>Incluye fecha UTC, magnitud, profundidad, coordenadas, fuente y URL de procedencia.</p><small>{rows.length} registros · corte {new Date().toLocaleString('es-PE')}</small></div><button className="primary" onClick={exportCsv}>Exportar CSV</button><button className="secondary" onClick={exportJson}>Exportar JSON</button></div><p className="muted-note">Los archivos contienen los registros cargados localmente desde la API; no incluyen eventos que aún no se hayan sincronizado.</p></Panel>}
function downloadCSV(filename:string,header:string[],rows:any[][]){const lines=[header,...rows].map(row=>row.map(v=>`"${String(v??'').replaceAll('"','""')}"`).join(','));downloadFile(filename,'\ufeff'+lines.join('\r\n'),'text/csv;charset=utf-8')}
function downloadFile(filename:string,content:string,type:string){const blob=new Blob([content],{type});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=filename;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}
function InfoPage({title,text}:{title:string;text:string}){return <Panel title={title} subtitle="Módulo del plan empresarial"><div className="placeholder"><div className="placeholder-icon"><Settings size={25}/></div><h3>Base del módulo preparada</h3><p>{text}</p><span className="tag muted">Pendiente de implementación operativa</span></div></Panel>}
function Empty({text}:{text:string}){return <div className="empty">{text}</div>}
