import type { EventResponse } from '../types';
const API=(import.meta.env.VITE_API_URL || 'http://localhost:8000').replace(/\/$/,'');
export async function api<T>(path:string,init?:RequestInit):Promise<T>{const r=await fetch(`${API}${path}`,init);if(!r.ok)throw new Error(`API ${r.status}: ${await r.text()}`);return r.json() as Promise<T>}
export const getEvents=(query='')=>api<EventResponse>(`/api/v1/events?limit=500${query}`);
export const syncUSGS=(days=7)=>api<{status:string;records_seen:number;records_inserted:number;message:string}>(`/api/v1/sources/usgs/sync?days=${days}`,{method:'POST'});
