import os
from datetime import datetime, timezone, timedelta
import json
import asyncio
from fastapi import FastAPI, Depends, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
from sqlalchemy import select, func
import httpx
from .database import Base, engine, get_db, SessionLocal
from .models import SeismicEvent, IngestionRun, AuditLog, PushSubscription, AlertConfiguration, MLExperiment
from .schemas import EventOut, SyncOut

Base.metadata.create_all(bind=engine)

def _vapid_claims():
    subject = os.getenv("VAPID_SUBJECT", "mailto:admin@example.com")
    return {"sub": subject}

def _send_push_to_all(db: Session, payload: dict) -> dict:
    public_key = os.getenv("VAPID_PUBLIC_KEY", "").strip()
    private_key = os.getenv("VAPID_PRIVATE_KEY", "").strip()
    if not public_key or not private_key:
        return {"configured": False, "sent": 0, "failed": 0, "message": "Web Push no configurado: faltan claves VAPID."}
    try:
        from pywebpush import webpush, WebPushException
    except ImportError:
        return {"configured": False, "sent": 0, "failed": 0, "message": "Instala pywebpush en la API."}
    sent = failed = 0
    for sub in db.scalars(select(PushSubscription)).all():
        try:
            webpush(subscription_info=json.loads(sub.subscription_json), data=json.dumps(payload, ensure_ascii=False), vapid_private_key=private_key, vapid_claims=_vapid_claims(), ttl=120)
            sub.last_status = "sent"; sent += 1
        except Exception as exc:
            sub.last_status = "failed"; failed += 1
            # 404/410 endpoints expire; delete stale subscriptions when possible.
            status = getattr(getattr(exc, "response", None), "status_code", None)
            if status in (404, 410): db.delete(sub)
    db.commit()
    return {"configured": True, "sent": sent, "failed": failed, "message": f"Push enviado a {sent} dispositivo(s); fallidos: {failed}."}

app = FastAPI(title="Sismo Platform API", version="1.0.0", description="API para monitoreo y análisis de eventos sísmicos reportados. No es un sistema oficial de alerta.")
origins = os.getenv("CORS_ORIGINS", "http://localhost:5173").split(",")
app.add_middleware(CORSMiddleware, allow_origins=[o.strip() for o in origins], allow_credentials=False, allow_methods=["GET", "POST", "OPTIONS"], allow_headers=["*"])

_auto_sync_task = None

async def _automatic_sync_loop():
    interval = max(120, int(os.getenv("AUTO_SYNC_INTERVAL_SECONDS", "300")))
    enabled = os.getenv("AUTO_SYNC_ENABLED", "true").strip().lower() in ("1", "true", "yes", "on")
    if not enabled:
        return
    while True:
        await asyncio.sleep(interval)
        db = SessionLocal()
        try:
            await sync_usgs(days=1, min_magnitude=1.0, db=db)
        except Exception as exc:
            try:
                db.add(AuditLog(action="automatic_sync_failed", entity_type="data_source", entity_id="USGS", details=str(exc)[:500])); db.commit()
            except Exception:
                db.rollback()
        finally:
            db.close()

@app.on_event("startup")
async def start_automatic_sync():
    global _auto_sync_task
    _auto_sync_task = asyncio.create_task(_automatic_sync_loop())

@app.on_event("shutdown")
async def stop_automatic_sync():
    global _auto_sync_task
    if _auto_sync_task:
        _auto_sync_task.cancel()
        try:
            await _auto_sync_task
        except asyncio.CancelledError:
            pass
        _auto_sync_task = None

@app.get("/health")
def health(): return {"status":"ok", "service":"sismo-platform-api", "time_utc":datetime.now(timezone.utc).isoformat()}

@app.get("/api/v1/alerts/automatic-config")
def get_automatic_alert_config(db: Session=Depends(get_db)):
    cfg = db.get(AlertConfiguration, 1)
    if not cfg:
        cfg = AlertConfiguration(id=1, automatic_enabled=True, min_magnitude=float(os.getenv("AUTO_ALERT_MIN_MAGNITUDE", "5.0")))
        db.add(cfg); db.commit(); db.refresh(cfg)
    return {"enabled": cfg.automatic_enabled, "min_magnitude": cfg.min_magnitude, "updated_at": cfg.updated_at.isoformat() if cfg.updated_at else None}

@app.post("/api/v1/alerts/automatic-config")
def update_automatic_alert_config(payload: dict, db: Session=Depends(get_db)):
    enabled = payload.get("enabled")
    minimum = payload.get("min_magnitude")
    if not isinstance(enabled, bool) or not isinstance(minimum, (int, float)) or not 0 <= float(minimum) <= 10:
        raise HTTPException(422, "Se requiere enabled booleano y min_magnitude entre 0 y 10")
    cfg = db.get(AlertConfiguration, 1)
    if not cfg:
        cfg = AlertConfiguration(id=1, automatic_enabled=enabled, min_magnitude=float(minimum)); db.add(cfg)
    else:
        cfg.automatic_enabled = enabled; cfg.min_magnitude = float(minimum)
    db.add(AuditLog(action="automatic_alert_config", entity_type="alert_configuration", entity_id="1", details=json.dumps({"enabled":enabled,"min_magnitude":float(minimum)})))
    db.commit(); db.refresh(cfg)
    return {"enabled":cfg.automatic_enabled,"min_magnitude":cfg.min_magnitude,"updated_at":cfg.updated_at.isoformat() if cfg.updated_at else None}

@app.get("/api/v1/ml/experiments")
def list_ml_experiments(limit: int=Query(50, ge=1, le=200), db: Session=Depends(get_db)):
    rows = db.scalars(select(MLExperiment).order_by(MLExperiment.created_at.desc()).limit(limit)).all()
    return [{"id":r.id,"name":r.name,"task_type":r.task_type,"algorithm":r.algorithm,"dataset_version":r.dataset_version,"target":r.target_name,"features":json.loads(r.features_json),"metrics":json.loads(r.metrics_json),"validation":json.loads(r.validation_json),"seed":r.seed,"dependencies":r.dependencies,"created_at":r.created_at.isoformat()} for r in rows]

@app.post("/api/v1/ml/experiments")
def save_ml_experiment(payload: dict, db: Session=Depends(get_db)):
    required = ("name", "algorithm", "dataset_version", "target", "features", "metrics", "validation", "dependencies")
    if any(k not in payload for k in required) or not isinstance(payload.get("features"), list) or not isinstance(payload.get("metrics"), dict) or not isinstance(payload.get("validation"), dict):
        raise HTTPException(422, "Faltan metadatos o la estructura de métricas del experimento no es válida")
    row = MLExperiment(name=str(payload["name"])[:160], task_type=str(payload.get("task_type", "classification"))[:40], algorithm=str(payload["algorithm"])[:100], dataset_version=str(payload["dataset_version"])[:200], target_name=str(payload["target"])[:200], features_json=json.dumps(payload["features"], ensure_ascii=False), metrics_json=json.dumps(payload["metrics"], ensure_ascii=False), validation_json=json.dumps(payload["validation"], ensure_ascii=False), seed=int(payload.get("seed", 42)), dependencies=str(payload["dependencies"])[:2000])
    db.add(row); db.flush(); db.add(AuditLog(action="ml_experiment_saved", entity_type="ml_experiment", entity_id=str(row.id), details=f"dataset={row.dataset_version}; algorithm={row.algorithm}")); db.commit(); db.refresh(row)
    return {"id":row.id,"status":"saved","message":"Experimento guardado en el registro de la API.","created_at":row.created_at.isoformat()}

@app.get("/api/v1/push/public-key")
def push_public_key():
    return {"configured": bool(os.getenv("VAPID_PUBLIC_KEY", "").strip() and os.getenv("VAPID_PRIVATE_KEY", "").strip()), "public_key": os.getenv("VAPID_PUBLIC_KEY", "").strip(), "subject": os.getenv("VAPID_SUBJECT", "mailto:admin@example.com")}

@app.post("/api/v1/push/subscriptions")
def register_push_subscription(payload: dict, db: Session=Depends(get_db)):
    endpoint = payload.get("endpoint")
    keys = payload.get("keys")
    if not isinstance(endpoint, str) or not endpoint.startswith("https://") or not isinstance(keys, dict) or not keys.get("p256dh") or not keys.get("auth"):
        raise HTTPException(422, "Suscripción Web Push inválida")
    existing = db.scalar(select(PushSubscription).where(PushSubscription.endpoint == endpoint))
    serialized = json.dumps(payload, ensure_ascii=False)
    if existing:
        existing.subscription_json = serialized; existing.last_status = "registered"
    else:
        db.add(PushSubscription(endpoint=endpoint, subscription_json=serialized))
    db.add(AuditLog(action="push_subscribed", entity_type="push_subscription", entity_id=endpoint[-32:], details="Dispositivo registrado para notificaciones push"))
    db.commit()
    return {"status": "registered", "message": "Dispositivo registrado en la API."}

@app.post("/api/v1/alerts/test")
def send_test_alert(db: Session=Depends(get_db)):
    payload = {"title": "Sismo Platform · Alerta de prueba", "body": "Esta es una notificación manual de prueba. No corresponde a un sismo real.", "url": "/", "tag": f"test-{int(datetime.now(timezone.utc).timestamp())}", "kind": "test"}
    result = _send_push_to_all(db, payload)
    db.add(AuditLog(action="manual_test_alert", entity_type="alert", entity_id=payload["tag"], details=json.dumps(result, ensure_ascii=False)))
    db.commit()
    if not result["configured"]:
        raise HTTPException(503, result["message"] + " Configura VAPID en .env y reinicia la API.")
    if result["sent"] == 0:
        raise HTTPException(409, "No hay dispositivos suscritos para recibir la prueba. Registra este celular desde el botón de activar push.")
    return {"status": "sent", **result}

@app.get("/api/v1/events", response_model=dict)
def list_events(db: Session=Depends(get_db), start: datetime|None=None, end: datetime|None=None, min_magnitude: float=Query(0, ge=0, le=10), max_magnitude: float=Query(10, ge=0, le=10), min_depth: float=Query(0, ge=0, le=800), max_depth: float=Query(700, ge=0, le=800), q: str|None=None, source: str|None=None, limit: int=Query(100, ge=1, le=1000), offset: int=Query(0, ge=0)):
    if min_magnitude > max_magnitude or min_depth > max_depth: raise HTTPException(422, "El límite mínimo no puede superar al máximo")
    stmt=select(SeismicEvent).where(SeismicEvent.magnitude.between(min_magnitude,max_magnitude), SeismicEvent.depth_km.between(min_depth,max_depth))
    if start: stmt=stmt.where(SeismicEvent.occurred_at >= start)
    if end: stmt=stmt.where(SeismicEvent.occurred_at <= end)
    if q: stmt=stmt.where(SeismicEvent.place.ilike(f"%{q[:100]}%"))
    if source: stmt=stmt.where(SeismicEvent.source_id==source)
    total=db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    rows=db.scalars(stmt.order_by(SeismicEvent.occurred_at.desc()).offset(offset).limit(limit)).all()
    return {"items":[EventOut.model_validate(x).model_dump(mode="json") for x in rows], "total":total,"limit":limit,"offset":offset}

@app.get("/api/v1/events/geojson")
def events_geojson(db: Session=Depends(get_db), limit: int=Query(2000, ge=1, le=5000), min_magnitude: float=Query(0, ge=0, le=10), start: datetime|None=None, end: datetime|None=None):
    stmt=select(SeismicEvent).where(SeismicEvent.magnitude>=min_magnitude)
    if start: stmt=stmt.where(SeismicEvent.occurred_at>=start)
    if end: stmt=stmt.where(SeismicEvent.occurred_at<=end)
    rows=db.scalars(stmt.order_by(SeismicEvent.occurred_at.desc()).limit(limit)).all()
    return {"type":"FeatureCollection","features":[{"type":"Feature","id":str(e.id),"geometry":{"type":"Point","coordinates":[e.longitude,e.latitude,e.depth_km]},"properties":{"external_id":e.external_id,"source":e.source_id,"time":int(e.occurred_at.timestamp()*1000),"mag":e.magnitude,"place":e.place,"url":e.source_url,"depth_km":e.depth_km,"review_status":e.review_status}} for e in rows]}

@app.get("/api/v1/events/{event_id}", response_model=EventOut)
def event_detail(event_id: int, db: Session=Depends(get_db)):
    event=db.get(SeismicEvent,event_id)
    if not event: raise HTTPException(404,"Evento no encontrado")
    return event

@app.post("/api/v1/sources/usgs/sync", response_model=SyncOut)
async def sync_usgs(days: int=Query(7, ge=1, le=30), min_magnitude: float=Query(1, ge=0, le=10), db: Session=Depends(get_db)):
    started=datetime.now(timezone.utc); run=IngestionRun(source_id="USGS",status="running",started_at=started); db.add(run); db.commit(); db.refresh(run)
    url="https://earthquake.usgs.gov/fdsnws/event/1/query"
    params={"format":"geojson","starttime":(started-timedelta(days=days)).isoformat(),"endtime":started.isoformat(),"minmagnitude":min_magnitude,"orderby":"time","limit":20000}
    try:
        async with httpx.AsyncClient(timeout=40) as client:
            response=await client.get(url,params=params); response.raise_for_status(); payload=response.json()
        features=payload.get("features",[]); inserted=0
        for feature in features:
            props=feature.get("properties") or {}; coords=(feature.get("geometry") or {}).get("coordinates") or []
            if len(coords)<3 or props.get("mag") is None: continue
            ext=str(feature.get("id") or "")
            if not ext: continue
            exists=db.scalar(select(SeismicEvent.id).where(SeismicEvent.source_id=="USGS",SeismicEvent.external_id==ext))
            if exists: continue
            occurred=datetime.fromtimestamp((props.get("time") or 0)/1000,timezone.utc)
            db.add(SeismicEvent(external_id=ext,source_id="USGS",occurred_at=occurred,longitude=float(coords[0]),latitude=float(coords[1]),depth_km=float(coords[2]),magnitude=float(props["mag"]),magnitude_type=props.get("magType"),place=props.get("place") or "Ubicación no informada",source_url=props.get("url"),review_status="observed")); inserted+=1
        run.status="success"; run.records_seen=len(features); run.records_inserted=inserted; run.finished_at=datetime.now(timezone.utc)
        db.add(AuditLog(action="source_sync",entity_type="data_source",entity_id="USGS",details=f"seen={len(features)} inserted={inserted}")); db.commit()
        cfg = db.get(AlertConfiguration, 1)
        if not cfg:
            cfg = AlertConfiguration(id=1, automatic_enabled=True, min_magnitude=float(os.getenv("AUTO_ALERT_MIN_MAGNITUDE", "5.0"))); db.add(cfg); db.commit(); db.refresh(cfg)
        auto_min = float(cfg.min_magnitude)
        new_events = db.scalars(select(SeismicEvent).where(SeismicEvent.received_at >= started, SeismicEvent.magnitude >= auto_min).order_by(SeismicEvent.magnitude.desc()).limit(10)).all() if cfg.automatic_enabled else []
        auto_result = {"sent": 0, "failed": 0, "configured": False}
        if new_events and cfg.automatic_enabled:
            auto_result = _send_push_to_all(db, {"title": "Sismo reportado · revisión", "body": f"{len(new_events)} evento(s) nuevo(s) con magnitud ≥ {auto_min:.1f}. Ejemplo: M {new_events[0].magnitude:.1f} · {new_events[0].place}. Fuente: USGS.", "url": "/", "tag": "usgs-auto-" + str(new_events[0].id), "kind": "automatic", "source_url": new_events[0].source_url})
            db.add(AuditLog(action="automatic_alert_check",entity_type="alert",entity_id=str(new_events[0].id),details=json.dumps({"threshold":auto_min,"events":len(new_events),**auto_result},ensure_ascii=False))); db.commit()
        return SyncOut(status="success",records_seen=len(features),records_inserted=inserted,message=f"Sincronización completada. Los eventos son reportes del catálogo USGS. Alertas automáticas nuevas (M≥{auto_min:g}): {auto_result.get('sent',0)} envío(s).")
    except Exception as exc:
        db.rollback(); run=db.get(IngestionRun,run.id)
        if run: run.status="failed"; run.finished_at=datetime.now(timezone.utc); run.error_summary=str(exc)[:1000]; db.commit()
        raise HTTPException(502,"Falló la sincronización con USGS. Revisa conectividad y logs.") from exc

@app.get("/api/v1/sources")
def sources(db: Session=Depends(get_db)):
    latest=db.scalar(select(IngestionRun).where(IngestionRun.source_id=="USGS").order_by(IngestionRun.started_at.desc()).limit(1))
    return [{"id":"USGS","name":"USGS Earthquake Catalog","organization":"United States Geological Survey","type":"GeoJSON / FDSN","status":"available" if latest and latest.status=="success" else "configured","last_sync_at":latest.finished_at.isoformat() if latest and latest.finished_at else None,"last_status":latest.status if latest else "not_run","records_seen":latest.records_seen if latest else 0,"records_inserted":latest.records_inserted if latest else 0,"url":"https://earthquake.usgs.gov/fdsnws/event/1/"}]

@app.get("/api/v1/dashboard/summary")
def dashboard_summary(db: Session=Depends(get_db)):
    total=db.scalar(select(func.count(SeismicEvent.id))) or 0
    avg_mag=db.scalar(select(func.avg(SeismicEvent.magnitude)))
    avg_depth=db.scalar(select(func.avg(SeismicEvent.depth_km)))
    latest=db.scalar(select(IngestionRun).order_by(IngestionRun.started_at.desc()).limit(1))
    recent=db.scalars(select(SeismicEvent).order_by(SeismicEvent.occurred_at.desc()).limit(8)).all()
    return {"total_events":total,"average_magnitude":round(avg_mag,2) if avg_mag is not None else None,"average_depth_km":round(avg_depth,2) if avg_depth is not None else None,"last_sync_at":latest.finished_at.isoformat() if latest and latest.finished_at else None,"source_status":latest.status if latest else "not_run","recent_events":[EventOut.model_validate(e).model_dump(mode="json") for e in recent]}

@app.get("/api/v1/analytics/timeseries")
def timeseries(days: int=Query(30,ge=1,le=365), db: Session=Depends(get_db)):
    cutoff=datetime.now(timezone.utc)-timedelta(days=days)
    rows=db.scalars(select(SeismicEvent).where(SeismicEvent.occurred_at>=cutoff)).all()
    buckets={}
    for e in rows:
        key=e.occurred_at.date().isoformat(); buckets[key]=buckets.get(key,0)+1
    return {"period_days":days,"sample_size":len(rows),"items":[{"date":k,"count":v} for k,v in sorted(buckets.items())],"source":"PostgreSQL persisted USGS events"}

@app.get("/api/v1/data-quality/summary")
def data_quality(db: Session=Depends(get_db)):
    total=db.scalar(select(func.count(SeismicEvent.id))) or 0
    missing_place=db.scalar(select(func.count(SeismicEvent.id)).where(SeismicEvent.place=="Ubicación no informada")) or 0
    invalid=db.scalar(select(func.count(SeismicEvent.id)).where((SeismicEvent.latitude < -90)|(SeismicEvent.latitude>90)|(SeismicEvent.longitude < -180)|(SeismicEvent.longitude>180)|(SeismicEvent.magnitude<0)|(SeismicEvent.magnitude>10))) or 0
    return {"row_count":total,"missing_place":missing_place,"invalid_records":invalid,"duplicate_policy":"UNIQUE(source_id, external_id)","quality_note":"Reporte básico; amplíe reglas y versionado de datasets antes de uso analítico productivo."}

@app.get("/api/v1/audit-logs")
def audit_logs(limit: int=Query(100,ge=1,le=500), db: Session=Depends(get_db)):
    rows=db.scalars(select(AuditLog).order_by(AuditLog.occurred_at.desc()).limit(limit)).all()
    return [{"id":r.id,"actor":r.actor,"action":r.action,"entity_type":r.entity_type,"entity_id":r.entity_id,"details":r.details,"occurred_at":r.occurred_at.isoformat()} for r in rows]
