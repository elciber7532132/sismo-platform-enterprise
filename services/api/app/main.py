
import os
from datetime import datetime, timezone, timedelta
import json
import asyncio
import logging

from fastapi import FastAPI, Depends, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
from sqlalchemy import select, func
import httpx

from .database import Base, engine, get_db, SessionLocal
from .models import (
    SeismicEvent,
    IngestionRun,
    AuditLog,
    PushSubscription,
    AlertConfiguration,
    MLExperiment,
)
from .schemas import EventOut, SyncOut


# ---------------------------------------------------------
# CONFIGURACIÓN GENERAL
# ---------------------------------------------------------

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("sismo-platform-api")

Base.metadata.create_all(bind=engine)

app = FastAPI(
    title="Sismo Platform API",
    version="1.0.0",
    description=(
        "API para monitoreo y análisis de eventos sísmicos reportados. "
        "No es un sistema oficial de alerta."
    ),
)

origins = [
    origin.strip()
    for origin in os.getenv(
        "CORS_ORIGINS",
        "http://localhost:5173",
    ).split(",")
    if origin.strip()
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
)

_auto_sync_task = None


# ---------------------------------------------------------
# NOTIFICACIONES PUSH
# ---------------------------------------------------------

def _vapid_claims():
    subject = os.getenv(
        "VAPID_SUBJECT",
        "mailto:admin@example.com",
    )
    return {"sub": subject}


def _send_push_to_all(db: Session, payload: dict) -> dict:
    """
    Envía una notificación a las suscripciones guardadas.

    Devuelve el número de suscripciones encontradas,
    los envíos correctos y los fallidos.
    """

    public_key = os.getenv("VAPID_PUBLIC_KEY", "").strip()
    private_key = os.getenv("VAPID_PRIVATE_KEY", "").strip()

    if not public_key or not private_key:
        return {
            "configured": False,
            "total": 0,
            "sent": 0,
            "failed": 0,
            "message": (
                "Web Push no configurado: faltan las claves VAPID."
            ),
        }

    try:
        from pywebpush import webpush
    except ImportError:
        return {
            "configured": False,
            "total": 0,
            "sent": 0,
            "failed": 0,
            "message": (
                "Falta instalar pywebpush en los requisitos de la API."
            ),
        }

    # Consultar las suscripciones guardadas en la base de datos.
    try:
        subscriptions = db.scalars(
            select(PushSubscription)
        ).all()
    except Exception:
        db.rollback()
        logger.exception(
            "No se pudieron consultar las suscripciones push."
        )
        return {
            "configured": True,
            "total": 0,
            "sent": 0,
            "failed": 0,
            "message": (
                "No se pudieron consultar las suscripciones "
                "en la base de datos."
            ),
        }

    total = len(subscriptions)
    sent = 0
    failed = 0
    errors = []

    logger.info(
        "Iniciando envío push. Suscripciones encontradas: %s",
        total,
    )

    for sub in subscriptions:
        try:
            subscription_info = json.loads(sub.subscription_json)

            webpush(
                subscription_info=subscription_info,
                data=json.dumps(payload, ensure_ascii=False),
                vapid_private_key=private_key,
                vapid_claims=_vapid_claims(),
                ttl=120,
            )

            sub.last_status = "sent"
            sent += 1

        except Exception as exc:
            failed += 1
            sub.last_status = "failed"

            # Guardar un diagnóstico sin imprimir claves privadas
            # ni el contenido completo de la suscripción.
            response = getattr(exc, "response", None)
            status_code = getattr(response, "status_code", None)

            error_message = (
                f"{type(exc).__name__}: {str(exc)[:300]}"
            )

            errors.append({
                "status_code": status_code,
                "error": error_message,
            })

            logger.exception(
                "Falló un envío push. HTTP del proveedor: %s",
                status_code,
            )

            # Los endpoints expirados ya no sirven.
            if status_code in (404, 410):
                db.delete(sub)

    try:
        db.commit()
    except Exception:
        db.rollback()
        logger.exception(
            "No se pudieron guardar los estados de las suscripciones."
        )
        raise HTTPException(
            status_code=500,
            detail="No se pudieron guardar los resultados del envío push.",
        )

    if total == 0:
        message = (
            "No se encontraron suscripciones push en la base de datos."
        )
    else:
        message = (
            f"Suscripciones encontradas: {total}; "
            f"enviadas: {sent}; fallidas: {failed}."
        )

    logger.info("%s", message)

    return {
        "configured": True,
        "total": total,
        "sent": sent,
        "failed": failed,
        "message": message,
        "errors": errors[:5],
    }


# ---------------------------------------------------------
# SINCRONIZACIÓN AUTOMÁTICA CON USGS
# ---------------------------------------------------------

async def _automatic_sync_loop():
    interval = max(
        120,
        int(os.getenv("AUTO_SYNC_INTERVAL_SECONDS", "300")),
    )

    enabled = (
        os.getenv("AUTO_SYNC_ENABLED", "true")
        .strip()
        .lower()
        in ("1", "true", "yes", "on")
    )

    if not enabled:
        logger.info("Sincronización automática desactivada.")
        return

    logger.info(
        "Sincronización automática activada. Intervalo: %s segundos.",
        interval,
    )

    while True:
        await asyncio.sleep(interval)
        db = SessionLocal()

        try:
            await sync_usgs(
                days=1,
                min_magnitude=1.0,
                db=db,
            )
        except Exception as exc:
            try:
                db.add(
                    AuditLog(
                        action="automatic_sync_failed",
                        entity_type="data_source",
                        entity_id="USGS",
                        details=str(exc)[:500],
                    )
                )
                db.commit()
            except Exception:
                db.rollback()

            logger.exception("Falló la sincronización automática.")

        finally:
            db.close()


@app.on_event("startup")
async def start_automatic_sync():
    global _auto_sync_task

    _auto_sync_task = asyncio.create_task(
        _automatic_sync_loop()
    )


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


# ---------------------------------------------------------
# SALUD DE LA API
# ---------------------------------------------------------

@app.get("/health")
def health():
    return {
        "status": "ok",
        "service": "sismo-platform-api",
        "time_utc": datetime.now(timezone.utc).isoformat(),
    }


# ---------------------------------------------------------
# CONFIGURACIÓN DE ALERTAS AUTOMÁTICAS
# ---------------------------------------------------------

@app.get("/api/v1/alerts/automatic-config")
def get_automatic_alert_config(
    db: Session = Depends(get_db),
):
    cfg = db.get(AlertConfiguration, 1)

    if not cfg:
        cfg = AlertConfiguration(
            id=1,
            automatic_enabled=True,
            min_magnitude=float(
                os.getenv("AUTO_ALERT_MIN_MAGNITUDE", "5.0")
            ),
        )
        db.add(cfg)
        db.commit()
        db.refresh(cfg)

    return {
        "enabled": cfg.automatic_enabled,
        "min_magnitude": cfg.min_magnitude,
        "updated_at": (
            cfg.updated_at.isoformat()
            if cfg.updated_at
            else None
        ),
    }


@app.post("/api/v1/alerts/automatic-config")
def update_automatic_alert_config(
    payload: dict,
    db: Session = Depends(get_db),
):
    enabled = payload.get("enabled")
    minimum = payload.get("min_magnitude")

    if (
        not isinstance(enabled, bool)
        or not isinstance(minimum, (int, float))
        or not 0 <= float(minimum) <= 10
    ):
        raise HTTPException(
            status_code=422,
            detail=(
                "Se requiere enabled booleano y "
                "min_magnitude entre 0 y 10."
            ),
        )

    cfg = db.get(AlertConfiguration, 1)

    if not cfg:
        cfg = AlertConfiguration(
            id=1,
            automatic_enabled=enabled,
            min_magnitude=float(minimum),
        )
        db.add(cfg)
    else:
        cfg.automatic_enabled = enabled
        cfg.min_magnitude = float(minimum)

    db.add(
        AuditLog(
            action="automatic_alert_config",
            entity_type="alert_configuration",
            entity_id="1",
            details=json.dumps({
                "enabled": enabled,
                "min_magnitude": float(minimum),
            }),
        )
    )

    db.commit()
    db.refresh(cfg)

    return {
        "enabled": cfg.automatic_enabled,
        "min_magnitude": cfg.min_magnitude,
        "updated_at": (
            cfg.updated_at.isoformat()
            if cfg.updated_at
            else None
        ),
    }


# ---------------------------------------------------------
# CLAVE PÚBLICA VAPID
# ---------------------------------------------------------

@app.get("/api/v1/push/public-key")
def push_public_key():
    public_key = os.getenv(
        "VAPID_PUBLIC_KEY", ""
    ).strip()

    private_key = os.getenv(
        "VAPID_PRIVATE_KEY", ""
    ).strip()

    return {
        "configured": bool(public_key and private_key),
        "public_key": public_key,
        "subject": os.getenv(
            "VAPID_SUBJECT",
            "mailto:admin@example.com",
        ),
    }


# ---------------------------------------------------------
# REGISTRO DE SUSCRIPCIONES PUSH
# ---------------------------------------------------------

@app.post("/api/v1/push/subscriptions")
def register_push_subscription(
    payload: dict,
    db: Session = Depends(get_db),
):
    endpoint = payload.get("endpoint")
    keys = payload.get("keys")

    if (
        not isinstance(endpoint, str)
        or not endpoint.startswith("https://")
        or not isinstance(keys, dict)
        or not keys.get("p256dh")
        or not keys.get("auth")
    ):
        raise HTTPException(
            status_code=422,
            detail="Suscripción Web Push inválida.",
        )

    existing = db.scalar(
        select(PushSubscription).where(
            PushSubscription.endpoint == endpoint
        )
    )

    serialized = json.dumps(
        payload,
        ensure_ascii=False,
    )

    if existing:
        existing.subscription_json = serialized
        existing.last_status = "registered"
    else:
        db.add(
            PushSubscription(
                endpoint=endpoint,
                subscription_json=serialized,
            )
        )

    db.add(
        AuditLog(
            action="push_subscribed",
            entity_type="push_subscription",
            entity_id=endpoint[-32:],
            details="Dispositivo registrado para notificaciones push.",
        )
    )

    try:
        db.commit()
    except Exception:
        db.rollback()
        logger.exception(
            "No se pudo guardar la suscripción push."
        )
        raise HTTPException(
            status_code=500,
            detail="No se pudo guardar la suscripción en la base de datos.",
        )

    logger.info("Suscripción push registrada o actualizada.")

    return {
        "status": "registered",
        "message": "Dispositivo registrado en la API.",
    }


# ---------------------------------------------------------
# ALERTA MANUAL DE PRUEBA
# ---------------------------------------------------------

@app.post("/api/v1/alerts/test")
def send_test_alert(
    db: Session = Depends(get_db),
):
    payload = {
        "title": "Sismo Platform · Alerta de prueba",
        "body": (
            "Esta es una notificación manual de prueba. "
            "No corresponde a un sismo real."
        ),
        "url": "/",
        "tag": (
            f"test-{int(datetime.now(timezone.utc).timestamp())}"
        ),
        "kind": "test",
    }

    result = _send_push_to_all(db, payload)

    db.add(
        AuditLog(
            action="manual_test_alert",
            entity_type="alert",
            entity_id=payload["tag"],
            details=json.dumps(
                result,
                ensure_ascii=False,
            ),
        )
    )
    db.commit()

    if not result["configured"]:
        raise HTTPException(
            status_code=503,
            detail=result["message"],
        )

    if result.get("total", 0) == 0:
        raise HTTPException(
            status_code=409,
            detail=(
                "La API no encuentra suscripciones guardadas "
                "en la base de datos. Vuelve a activar las "
                "notificaciones desde el celular."
            ),
        )

    if result["sent"] == 0:
        raise HTTPException(
            status_code=502,
            detail={
                "message": (
                    "Se encontraron suscripciones, pero "
                    "ninguna recibió la notificación."
                ),
                "total": result["total"],
                "failed": result["failed"],
                "errors": result.get("errors", []),
            },
        )

    return {
        "status": "sent",
        **result,
    }


# ---------------------------------------------------------
# EXPERIMENTOS DE MACHINE LEARNING
# ---------------------------------------------------------

@app.get("/api/v1/ml/experiments")
def list_ml_experiments(
    limit: int = Query(50, ge=1, le=200),
    db: Session = Depends(get_db),
):
    rows = db.scalars(
        select(MLExperiment)
        .order_by(MLExperiment.created_at.desc())
        .limit(limit)
    ).all()

    return [
        {
            "id": r.id,
            "name": r.name,
            "task_type": r.task_type,
            "algorithm": r.algorithm,
            "dataset_version": r.dataset_version,
            "target": r.target_name,
            "features": json.loads(r.features_json),
            "metrics": json.loads(r.metrics_json),
            "validation": json.loads(r.validation_json),
            "seed": r.seed,
            "dependencies": r.dependencies,
            "created_at": r.created_at.isoformat(),
        }
        for r in rows
    ]


@app.post("/api/v1/ml/experiments")
def save_ml_experiment(
    payload: dict,
    db: Session = Depends(get_db),
):
    required = (
        "name",
        "algorithm",
        "dataset_version",
        "target",
        "features",
        "metrics",
        "validation",
        "dependencies",
    )

    if (
        any(k not in payload for k in required)
        or not isinstance(payload.get("features"), list)
        or not isinstance(payload.get("metrics"), dict)
        or not isinstance(payload.get("validation"), dict)
    ):
        raise HTTPException(
            status_code=422,
            detail=(
                "Faltan metadatos o la estructura de métricas "
                "del experimento no es válida."
            ),
        )

    row = MLExperiment(
        name=str(payload["name"])[:160],
        task_type=str(
            payload.get("task_type", "classification")
        )[:40],
        algorithm=str(payload["algorithm"])[:100],
        dataset_version=str(payload["dataset_version"])[:200],
        target_name=str(payload["target"])[:200],
        features_json=json.dumps(
            payload["features"],
            ensure_ascii=False,
        ),
        metrics_json=json.dumps(
            payload["metrics"],
            ensure_ascii=False,
        ),
        validation_json=json.dumps(
            payload["validation"],
            ensure_ascii=False,
        ),
        seed=int(payload.get("seed", 42)),
        dependencies=str(payload["dependencies"])[:2000],
    )

    db.add(row)
    db.flush()

    db.add(
        AuditLog(
            action="ml_experiment_saved",
            entity_type="ml_experiment",
            entity_id=str(row.id),
            details=(
                f"dataset={row.dataset_version}; "
                f"algorithm={row.algorithm}"
            ),
        )
    )

    db.commit()
    db.refresh(row)

    return {
        "id": row.id,
        "status": "saved",
        "message": "Experimento guardado en el registro de la API.",
        "created_at": row.created_at.isoformat(),
    }


# ---------------------------------------------------------
# EVENTOS SÍSMICOS
# ---------------------------------------------------------

@app.get("/api/v1/events", response_model=dict)
def list_events(
    db: Session = Depends(get_db),
    start: datetime | None = None,
    end: datetime | None = None,
    min_magnitude: float = Query(0, ge=0, le=10),
    max_magnitude: float = Query(10, ge=0, le=10),
    min_depth: float = Query(0, ge=0, le=800),
    max_depth: float = Query(700, ge=0, le=800),
    q: str | None = None,
    source: str | None = None,
    limit: int = Query(100, ge=1, le=1000),
    offset: int = Query(0, ge=0),
):
    if (
        min_magnitude > max_magnitude
        or min_depth > max_depth
    ):
        raise HTTPException(
            status_code=422,
            detail="El límite mínimo no puede superar al máximo.",
        )

    stmt = select(SeismicEvent).where(
        SeismicEvent.magnitude.between(
            min_magnitude,
            max_magnitude,
        ),
        SeismicEvent.depth_km.between(
            min_depth,
            max_depth,
        ),
    )

    if start:
        stmt = stmt.where(
            SeismicEvent.occurred_at >= start
        )

    if end:
        stmt = stmt.where(
            SeismicEvent.occurred_at <= end
        )

    if q:
        stmt = stmt.where(
            SeismicEvent.place.ilike(f"%{q[:100]}%")
        )

    if source:
        stmt = stmt.where(
            SeismicEvent.source_id == source
        )

    total = db.scalar(
        select(func.count()).select_from(
            stmt.subquery()
        )
    ) or 0

    rows = db.scalars(
        stmt.order_by(
            SeismicEvent.occurred_at.desc()
        )
        .offset(offset)
        .limit(limit)
    ).all()

    return {
        "items": [
            EventOut.model_validate(x).model_dump(mode="json")
            for x in rows
        ],
        "total": total,
        "limit": limit,
        "offset": offset,
    }


@app.get("/api/v1/events/geojson")
def events_geojson(
    db: Session = Depends(get_db),
    limit: int = Query(2000, ge=1, le=5000),
    min_magnitude: float = Query(0, ge=0, le=10),
    start: datetime | None = None,
    end: datetime | None = None,
):
    stmt = select(SeismicEvent).where(
        SeismicEvent.magnitude >= min_magnitude
    )

    if start:
        stmt = stmt.where(
            SeismicEvent.occurred_at >= start
        )

    if end:
        stmt = stmt.where(
            SeismicEvent.occurred_at <= end
        )

    rows = db.scalars(
        stmt.order_by(
            SeismicEvent.occurred_at.desc()
        ).limit(limit)
    ).all()

    return {
        "type": "FeatureCollection",
        "features": [
            {
                "type": "Feature",
                "id": str(e.id),
                "geometry": {
                    "type": "Point",
                    "coordinates": [
                        e.longitude,
                        e.latitude,
                        e.depth_km,
                    ],
                },
                "properties": {
                    "external_id": e.external_id,
                    "source": e.source_id,
                    "time": int(
                        e.occurred_at.timestamp() * 1000
                    ),
                    "mag": e.magnitude,
                    "place": e.place,
                    "url": e.source_url,
                    "depth_km": e.depth_km,
                    "review_status": e.review_status,
                },
            }
            for e in rows
        ],
    }


@app.get(
    "/api/v1/events/{event_id}",
    response_model=EventOut,
)
def event_detail(
    event_id: int,
    db: Session = Depends(get_db),
):
    event = db.get(SeismicEvent, event_id)

    if not event:
        raise HTTPException(
            status_code=404,
            detail="Evento no encontrado.",
        )

    return event


# ---------------------------------------------------------
# SINCRONIZACIÓN CON USGS
# ---------------------------------------------------------

@app.post(
    "/api/v1/sources/usgs/sync",
    response_model=SyncOut,
)
async def sync_usgs(
    days: int = Query(7, ge=1, le=30),
    min_magnitude: float = Query(1, ge=0, le=10),
    db: Session = Depends(get_db),
):
    started = datetime.now(timezone.utc)

    run = IngestionRun(
        source_id="USGS",
        status="running",
        started_at=started,
    )

    db.add(run)
    db.commit()
    db.refresh(run)

    url = "https://earthquake.usgs.gov/fdsnws/event/1/query"

    params = {
        "format": "geojson",
        "starttime": (
            started - timedelta(days=days)
        ).isoformat(),
        "endtime": started.isoformat(),
        "minmagnitude": min_magnitude,
        "orderby": "time",
        "limit": 20000,
    }

    try:
        async with httpx.AsyncClient(timeout=40) as client:
            response = await client.get(
                url,
                params=params,
            )
            response.raise_for_status()
            payload = response.json()

        features = payload.get("features", [])
        inserted = 0

        for feature in features:
            props = feature.get("properties") or {}
            coords = (
                feature.get("geometry") or {}
            ).get("coordinates") or []

            if len(coords) < 3 or props.get("mag") is None:
                continue

            ext = str(feature.get("id") or "")

            if not ext:
                continue

            exists = db.scalar(
                select(SeismicEvent.id).where(
                    SeismicEvent.source_id == "USGS",
                    SeismicEvent.external_id == ext,
                )
            )

            if exists:
                continue

            occurred = datetime.fromtimestamp(
                (props.get("time") or 0) / 1000,
                timezone.utc,
            )

            db.add(
                SeismicEvent(
                    external_id=ext,
                    source_id="USGS",
                    occurred_at=occurred,
                    longitude=float(coords[0]),
                    latitude=float(coords[1]),
                    depth_km=float(coords[2]),
                    magnitude=float(props["mag"]),
                    magnitude_type=props.get("magType"),
                    place=(
                        props.get("place")
                        or "Ubicación no informada"
                    ),
                    source_url=props.get("url"),
                    review_status="observed",
                )
            )

            inserted += 1

        run.status = "success"
        run.records_seen = len(features)
        run.records_inserted = inserted
        run.finished_at = datetime.now(timezone.utc)

        db.add(
            AuditLog(
                action="source_sync",
                entity_type="data_source",
                entity_id="USGS",
                details=(
                    f"seen={len(features)} "
                    f"inserted={inserted}"
                ),
            )
        )

        db.commit()

        cfg = db.get(AlertConfiguration, 1)

        if not cfg:
            cfg = AlertConfiguration(
                id=1,
                automatic_enabled=True,
                min_magnitude=float(
                    os.getenv(
                        "AUTO_ALERT_MIN_MAGNITUDE",
                        "5.0",
                    )
                ),
            )
            db.add(cfg)
            db.commit()
            db.refresh(cfg)

        auto_min = float(cfg.min_magnitude)

        new_events = (
            db.scalars(
                select(SeismicEvent)
                .where(
                    SeismicEvent.received_at >= started,
                    SeismicEvent.magnitude >= auto_min,
                )
                .order_by(
                    SeismicEvent.magnitude.desc()
                )
                .limit(10)
            ).all()
            if cfg.automatic_enabled
            else []
        )

        auto_result = {
            "sent": 0,
            "failed": 0,
            "configured": False,
        }

        if new_events and cfg.automatic_enabled:
            auto_result = _send_push_to_all(
                db,
                {
                    "title": "Sismo reportado · revisión",
                    "body": (
                        f"{len(new_events)} evento(s) nuevo(s) "
                        f"con magnitud ≥ {auto_min:.1f}. "
                        f"Ejemplo: M "
                        f"{new_events[0].magnitude:.1f} · "
                        f"{new_events[0].place}. Fuente: USGS."
                    ),
                    "url": "/",
                    "tag": (
                        "usgs-auto-"
                        + str(new_events[0].id)
                    ),
                    "kind": "automatic",
                    "source_url": new_events[0].source_url,
                },
            )

            db.add(
                AuditLog(
                    action="automatic_alert_check",
                    entity_type="alert",
                    entity_id=str(new_events[0].id),
                    details=json.dumps(
                        {
                            "threshold": auto_min,
                            "events": len(new_events),
                            **auto_result,
                        },
                        ensure_ascii=False,
                    ),
                )
            )
            db.commit()

        return SyncOut(
            status="success",
            records_seen=len(features),
            records_inserted=inserted,
            message=(
                "Sincronización completada. Los eventos son "
                "reportes del catálogo USGS. "
                f"Alertas automáticas nuevas (M≥{auto_min:g}): "
                f"{auto_result.get('sent', 0)} envío(s)."
            ),
        )

    except Exception as exc:
        db.rollback()

        run = db.get(IngestionRun, run.id)

        if run:
            run.status = "failed"
            run.finished_at = datetime.now(timezone.utc)
            run.error_summary = str(exc)[:1000]
            db.commit()

        logger.exception("Falló la sincronización con USGS.")

        raise HTTPException(
            status_code=502,
            detail=(
                "Falló la sincronización con USGS. "
                "Revisa conectividad y logs."
            ),
        ) from exc


# ---------------------------------------------------------
# FUENTES DE DATOS
# ---------------------------------------------------------

@app.get("/api/v1/sources")
def sources(
    db: Session = Depends(get_db),
):
    latest = db.scalar(
        select(IngestionRun)
        .where(IngestionRun.source_id == "USGS")
        .order_by(IngestionRun.started_at.desc())
        .limit(1)
    )

    return [
        {
            "id": "USGS",
            "name": "USGS Earthquake Catalog",
            "organization": (
                "United States Geological Survey"
            ),
            "type": "GeoJSON / FDSN",
            "status": (
                "available"
                if latest and latest.status == "success"
                else "configured"
            ),
            "last_sync_at": (
                latest.finished_at.isoformat()
                if latest and latest.finished_at
                else None
            ),
            "last_status": (
                latest.status if latest else "not_run"
            ),
            "records_seen": (
                latest.records_seen if latest else 0
            ),
            "records_inserted": (
                latest.records_inserted if latest else 0
            ),
            "url": (
                "https://earthquake.usgs.gov/fdsnws/event/1/"
            ),
        }
    ]


# ---------------------------------------------------------
# RESUMEN DEL DASHBOARD
# ---------------------------------------------------------

@app.get("/api/v1/dashboard/summary")
def dashboard_summary(
    db: Session = Depends(get_db),
):
    total = db.scalar(
        select(func.count(SeismicEvent.id))
    ) or 0

    avg_mag = db.scalar(
        select(func.avg(SeismicEvent.magnitude))
    )

    avg_depth = db.scalar(
        select(func.avg(SeismicEvent.depth_km))
    )

    latest = db.scalar(
        select(IngestionRun)
        .order_by(IngestionRun.started_at.desc())
        .limit(1)
    )

    recent = db.scalars(
        select(SeismicEvent)
        .order_by(SeismicEvent.occurred_at.desc())
        .limit(8)
    ).all()

    return {
        "total_events": total,
        "average_magnitude": (
            round(avg_mag, 2)
            if avg_mag is not None
            else None
        ),
        "average_depth_km": (
            round(avg_depth, 2)
            if avg_depth is not None
            else None
        ),
        "last_sync_at": (
            latest.finished_at.isoformat()
            if latest and latest.finished_at
            else None
        ),
        "source_status": (
            latest.status if latest else "not_run"
        ),
        "recent_events": [
            EventOut.model_validate(e).model_dump(mode="json")
            for e in recent
        ],
    }


# ---------------------------------------------------------
# ANÁLISIS TEMPORAL
# ---------------------------------------------------------

@app.get("/api/v1/analytics/timeseries")
def timeseries(
    days: int = Query(30, ge=1, le=365),
    db: Session = Depends(get_db),
):
    cutoff = datetime.now(timezone.utc) - timedelta(days=days)

    rows = db.scalars(
        select(SeismicEvent).where(
            SeismicEvent.occurred_at >= cutoff
        )
    ).all()

    buckets = {}

    for event in rows:
        key = event.occurred_at.date().isoformat()
        buckets[key] = buckets.get(key, 0) + 1

    return {
        "period_days": days,
        "sample_size": len(rows),
        "items": [
            {"date": key, "count": value}
            for key, value in sorted(buckets.items())
        ],
        "source": "PostgreSQL persisted USGS events",
    }


# ---------------------------------------------------------
# CALIDAD DE DATOS
# ---------------------------------------------------------

@app.get("/api/v1/data-quality/summary")
def data_quality(
    db: Session = Depends(get_db),
):
    total = db.scalar(
        select(func.count(SeismicEvent.id))
    ) or 0

    missing_place = db.scalar(
        select(func.count(SeismicEvent.id)).where(
            SeismicEvent.place == "Ubicación no informada"
        )
    ) or 0

    invalid = db.scalar(
        select(func.count(SeismicEvent.id)).where(
            (SeismicEvent.latitude < -90)
            | (SeismicEvent.latitude > 90)
            | (SeismicEvent.longitude < -180)
            | (SeismicEvent.longitude > 180)
            | (SeismicEvent.magnitude < 0)
            | (SeismicEvent.magnitude > 10)
        )
    ) or 0

    return {
        "row_count": total,
        "missing_place": missing_place,
        "invalid_records": invalid,
        "duplicate_policy": "UNIQUE(source_id, external_id)",
        "quality_note": (
            "Reporte básico; amplíe reglas y versionado "
            "de datasets antes de uso analítico productivo."
        ),
    }


# ---------------------------------------------------------
# AUDITORÍA
# ---------------------------------------------------------

@app.get("/api/v1/audit-logs")
def audit_logs(
    limit: int = Query(100, ge=1, le=500),
    db: Session = Depends(get_db),
):
    rows = db.scalars(
        select(AuditLog)
        .order_by(AuditLog.occurred_at.desc())
        .limit(limit)
    ).all()

    return [
        {
            "id": r.id,
            "actor": r.actor,
            "action": r.action,
            "entity_type": r.entity_type,
            "entity_id": r.entity_id,
            "details": r.details,
            "occurred_at": r.occurred_at.isoformat(),
        }
        for r in rows
    ]
