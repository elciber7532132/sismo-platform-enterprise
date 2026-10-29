export type EventItem={id:number;external_id:string;source_id:string;occurred_at:string;latitude:number;longitude:number;magnitude:number;magnitude_type?:string|null;depth_km:number;place:string;source_url?:string|null;received_at:string;review_status:string};
export type EventResponse={items:EventItem[];total:number;limit:number;offset:number};
