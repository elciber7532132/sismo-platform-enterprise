# Base de datos

La creación inicial de tablas SQLAlchemy está automatizada al arrancar la API para facilitar el MVP. Antes de producción, sustituir `create_all` por migraciones versionadas (Alembic), revisar índices y restricciones, planificar backups y probar restauración. PostGIS puede incorporarse para consultas espaciales avanzadas.
