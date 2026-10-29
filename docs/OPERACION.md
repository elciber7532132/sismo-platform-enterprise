# Guía de operación inicial

1. Levantar servicios y comprobar `/health`.
2. Abrir `/docs` y confirmar los endpoints disponibles.
3. Ejecutar sincronización manual USGS de los últimos 7 días.
4. Confirmar conteos en Dashboard y Eventos; repetir la sincronización y verificar que `records_inserted` no duplique IDs externos.
5. Exportar CSV y comprobar que conserva fecha UTC, coordenadas, magnitud, profundidad y procedencia.
6. Si la fuente falla, revisar logs de API y el estado en Fuentes de datos.

## Antes de producción
Configurar HTTPS, secretos gestionados, autenticación real, autorización backend, CORS limitado, rate limiting, migraciones, backups y restauración, observabilidad, tareas programadas, política de retención, canales de alertas aprobados, pruebas de carga y revisión por especialistas. No emitir alertas públicas basadas solo en estimaciones experimentales.
