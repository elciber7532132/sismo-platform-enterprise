# Configuración de alertas push al celular

## Qué hace

- **Manual:** desde `Reglas de alertas`, pulsa `Registrar este celular` y después `Enviar alerta manual de prueba`. La API manda una notificación que identifica claramente que es una prueba.
- **Automático:** la API consulta el catálogo USGS cada 300 segundos por defecto. Si una sincronización incorpora eventos nuevos que alcanzan la magnitud mínima configurada, envía una notificación a los dispositivos registrados.
- **Trazabilidad:** los intentos de sincronización, suscripciones, cambios de umbral y pruebas se registran en la bitácora de auditoría.

Esto es monitoreo de eventos publicados por el catálogo USGS. No es una alerta temprana oficial y puede existir retraso entre un sismo y su publicación por la fuente. No puede predecir terremotos.

## Pasos

1. Copia `.env.example` como `.env` en la raíz del repositorio.
2. Genera un par VAPID con `py-vapid` en un entorno Python privado. Por ejemplo:

   ```powershell
   py -m pip install py-vapid
   py -c "from py_vapid import Vapid; v=Vapid(); v.generate_keys(); print('VAPID_PUBLIC_KEY=' + v.public_key_urlsafe_base64); print('VAPID_PRIVATE_KEY=' + v.private_pem().decode('utf-8'))"
   ```

   Si tu versión del paquete no expone esos atributos, utiliza el método de generación de claves documentado por la versión instalada de `py-vapid`. Mantén privada la clave privada; nunca la copies a `apps/web` ni a Git.

3. Pon los valores generados en `.env` junto con:

   ```dotenv
   VAPID_SUBJECT=mailto:tu-correo-de-contacto@dominio.com
   AUTO_SYNC_ENABLED=true
   AUTO_SYNC_INTERVAL_SECONDS=300
   AUTO_ALERT_MIN_MAGNITUDE=5.0
   ```

   El umbral se puede cambiar desde la pantalla de alertas; el ajuste queda guardado en la API. `AUTO_ALERT_MIN_MAGNITUDE` es el valor inicial si aún no existe una configuración guardada.

4. En la raíz del proyecto ejecuta:

   ```powershell
   docker compose up --build -d
   ```

5. Publica la web detrás de HTTPS y configura `CORS_ORIGINS` con el origen exacto de tu frontend. En el celular abre la URL HTTPS, entra en `Reglas de alertas` y pulsa `Registrar este celular`.
6. Pulsa `Enviar alerta manual de prueba`. Si todo está bien, debe llegar al teléfono y la interfaz mostrará el resultado de la API.
7. Mantén `Activar modo automático` habilitado y configura el umbral. La API seguirá consultando USGS mientras el backend esté encendido, aunque la página del celular esté cerrada.

## Comprobación y solución de problemas

- `GET https://TU-API/api/v1/push/public-key` debe devolver `configured: true` y una clave pública.
- Si la prueba responde `503`, VAPID no está configurado o no se reinició el backend.
- Si responde `409`, no hay dispositivos registrados. Repite `Registrar este celular` desde la web HTTPS.
- Si la API reporta fallos, revisa los logs del contenedor `api`, el permiso de notificaciones del sistema y la conectividad del dispositivo.
- Para apagar la ingesta automática, define `AUTO_SYNC_ENABLED=false` y reinicia la API. El intervalo mínimo admitido es de 120 segundos.

Antes de exponer el sistema a internet o usarlo para comunicaciones públicas, agrega autenticación/autorización del operador y revisa los protocolos de IGP/INDECI. Las alertas de este MVP son informativas y no sustituyen a las autoridades.
