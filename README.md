# Sismo Platform Enterprise — MVP técnico

Plataforma modular para monitoreo de eventos sísmicos, análisis histórico, preparación de datos, experimentos ML y gestión trazable de alertas. Arquitectura basada en el documento `Plan de Desarrollo Sistema Monitoreo Sísmico y ML`.

> **Uso responsable:** esto es un MVP técnico, no un sistema oficial de alerta temprana ni una herramienta capaz de predecir con certeza terremotos. Verifica los protocolos y fuentes con IGP/INDECI y especialistas antes de cualquier uso operativo.

## Arquitectura
- `apps/web`: React + TypeScript + Vite, Recharts y React Leaflet.
- `services/api`: FastAPI + SQLAlchemy, PostgreSQL (SQLite permitido solo para desarrollo local).
- `services/ml`: punto de partida para experimentos reproducibles con scikit-learn.
- `database`: migraciones/semillas y modelo de referencia.
- `infra`: Docker Compose.

## Inicio rápido con Docker
1. Instala Docker Desktop.
2. Copia `.env.example` a `.env` y cambia los secretos de ejemplo.
3. Desde la raíz ejecuta `docker compose up --build`.
4. Web: http://localhost:5173 · API: http://localhost:8000 · Swagger: http://localhost:8000/docs.
5. En la página Fuentes de datos usa **Sincronizar USGS** para importar eventos recientes al PostgreSQL.

## Inicio sin Docker
API (Python 3.11+):
```bash
cd services/api
python -m venv .venv
# Windows: .venv\Scripts\Activate.ps1 | macOS/Linux: source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```
Frontend (Node 20+):
```bash
cd apps/web
npm install
npm run dev
```
Configura `VITE_API_URL=http://localhost:8000` en `apps/web/.env.local` si es necesario.

## Endpoints iniciales
- `GET /health`
- `GET /api/v1/dashboard/summary`
- `GET /api/v1/events` (filtros, paginación)
- `GET /api/v1/events/geojson`
- `GET /api/v1/events/{event_id}`
- `POST /api/v1/sources/usgs/sync`
- `GET /api/v1/sources`
- `GET /api/v1/analytics/timeseries`
- `GET /api/v1/data-quality/summary`
- `GET /api/v1/audit-logs`
- `GET/POST /api/v1/ml/experiments` (registro persistente de experimentos)
- `GET /api/v1/alerts/automatic-config` y `POST /api/v1/alerts/automatic-config`
- `GET /api/v1/push/public-key`, `POST /api/v1/push/subscriptions`, `POST /api/v1/alerts/test`

## Límites de esta entrega
Incluye una base funcional para eventos, mapa, dashboard, ingesta manual USGS, calidad básica y auditoría. Autenticación/autorización empresarial, PostGIS, workers, aprobación formal de modelos, CI/CD completo, backup/restore probado y despliegue endurecido requieren configuración adicional antes de producción. Las notificaciones push requieren configurar claves VAPID en el entorno; no se incluyen credenciales reales.

## Mejoras de módulos (edición ampliada)
- Análisis estadístico: filtros por ventana temporal, magnitud, profundidad y ubicación; series temporales, distribución y dispersión magnitud-profundidad.
- Preparación de datos: inspección de registros, indicadores de calidad, búsqueda de incidencias y exportación CSV de filas válidas sin alterar la base original.
- Laboratorio ML: selector de etiquetas retrospectivas y ficha de variables/protocolo. No se presenta como modelo entrenado ni como predictor sísmico.
- Estimaciones experimentales: promedios y variabilidad retrospectiva de conteos diarios, con advertencia explícita de que no es pronóstico.
- Reglas de alertas: creación, pausa/reactivación, eliminación y coincidencias calculadas sobre los eventos cargados; se guardan localmente en el navegador.
- Centro de alertas: bandeja filtrable por magnitud/prioridad para revisión humana. La página Reglas de alertas incluye envío manual de prueba y envío push automático al sincronizar, si VAPID está configurado.
- Usuarios y roles: CRUD demostrativo en localStorage, sin autenticación ni autorización real.
- Reportes: filtros por ubicación, magnitud y período; exportación CSV/JSON.
- Mapa: solicitud de eventos usa parámetros de filtro compatibles con la API y límites de teselas de mapa.

## Alcance y validación
Esta ampliación usa los registros que ya se hayan sincronizado en la API; los filtros del cliente no sustituyen filtros de seguridad del servidor. Los datos de usuarios y reglas son locales al navegador. Antes de producción se debe implementar autenticación/autorización en backend, persistencia de reglas, entrega de alertas, pruebas automatizadas y validación con especialistas. El intento de compilar en el entorno de generación no pudo completarse porque `npm install` no terminó dentro del tiempo disponible; ejecutar `npm install` y `npm run build` en la máquina de desarrollo para verificar con sus dependencias instaladas.


## Mapa sísmico con OpenFreeMap

El mapa base usa OpenFreeMap (estilo Positron) mediante MapLibre GL y el adaptador para Leaflet. No requiere API key. Los marcadores, filtros regionales y la tabla siguen usando los eventos de la API de Sismo Platform. La primera carga necesita conexión a internet para descargar el estilo y los mosaicos vectoriales. Atribución cartográfica: OpenFreeMap, OpenMapTiles y OpenStreetMap.

Para iniciar: desde esta carpeta ejecuta `docker compose up --build`.

## Actualización: carga completa y alertas en dispositivos móviles

- El frontend consulta `/api/v1/events` por páginas de hasta 1,000 filas y continúa con `offset` hasta recibir el total de la API. El catálogo ya no depende de `limit=500` ni corta la tabla en 500 filas.
- El panel de **Reglas de alertas** permite activar notificaciones del navegador, elegir magnitud mínima y filtrar por texto de ubicación. La configuración se guarda en el navegador de ese dispositivo.
- La aplicación incluye `manifest.webmanifest`, iconos y un service worker básico para poder instalarla como PWA. Para instalarla en un teléfono, primero despliega el frontend en un dominio HTTPS y abre ese dominio desde Chrome/Edge/Android o Safari/iOS (la disponibilidad varía según navegador y versión).
- La revisión de eventos nuevos y notificaciones se realiza mientras la aplicación está abierta y ejecutándose, con consulta cada 60 segundos. Para notificaciones push verdaderas con la aplicación cerrada, se requiere configurar VAPID, guardar suscripciones push en el backend y usar un servicio Web Push; eso no queda activado por este paquete.
- Las notificaciones son avisos informativos generados por umbrales de datos observados, no alertas oficiales, pronósticos ni un servicio de emergencia. No deben usarse para decisiones de seguridad.

### Inicio local
1. Ejecuta el backend siguiendo `services/api/README.md` (o las instrucciones de Docker de este repositorio).
2. En `apps/web`, ejecuta `npm install` y luego `npm run dev`.
3. Para alertas locales, abre **Reglas de alertas** y pulsa **Activar notificaciones**; acepta el permiso del navegador y configura la magnitud y ubicación.


## Alertas push manuales y automáticas al celular

La pantalla **Reglas de alertas** incluye un botón para registrar el celular y otro para **Enviar alerta manual de prueba**. El backend envía la notificación a las suscripciones registradas. La API consulta USGS en segundo plano cada 300 segundos por defecto (`AUTO_SYNC_ENABLED=true`, `AUTO_SYNC_INTERVAL_SECONDS=300`), además de la sincronización manual. Después de cada sincronización USGS, la API también revisa los eventos nuevos y envía una notificación automática si alguno alcanza `AUTO_ALERT_MIN_MAGNITUDE`. El umbral automático de producción se configura en el `.env` del backend; por defecto es 5.0.

### Activar Web Push (necesario para el teléfono)

1. Despliega la web en un dominio HTTPS y abre la web desde el celular. En desarrollo local, `localhost` solo sirve para probar en el mismo equipo, no para registrar el teléfono remoto.
2. Genera un par de claves VAPID con Python en un entorno de confianza que tenga `pywebpush` instalado: `python -c "from py_vapid import Vapid; v=Vapid(); v.generate_keys(); print('public:', v.public_key_urlsafe_base64); print('private:', v.private_pem().decode())"`. Si la versión de `py-vapid` no expone esos métodos, consulta la documentación de pywebpush/py-vapid para generar el par; no pegues la clave privada en el frontend ni la publiques.
3. Copia las claves al `.env` en la raíz del proyecto: `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` (un correo real de contacto) y `AUTO_ALERT_MIN_MAGNITUDE=5.0`. La clave pública se comparte con el navegador; la privada permanece solo en el backend.
4. Reinicia los servicios: `docker compose up --build -d`.
5. En el celular, abre **Reglas de alertas**, pulsa **Registrar este celular** y acepta el permiso. Luego pulsa **Enviar alerta manual de prueba**; el mensaje indica que es una prueba y no un sismo real.
6. Sincroniza USGS. Si hay eventos recién incorporados que cumplen el umbral, la API intenta enviar la alerta automática a los celulares registrados. Los intentos y resultados se anotan en la bitácora.

Las notificaciones push dependen del navegador, del sistema operativo y de la conectividad. No son alertas oficiales ni una garantía de aviso de emergencia. La aplicación requiere HTTPS fuera de localhost y configuración real de VAPID; sin esto, el backend devolverá un error explícito en vez de fingir que envió el aviso.
