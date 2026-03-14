RadarLoto backend corregido

Cambios:
- Sync oficial usando RSS de SELAE para Euromillones y La Primitiva.
- Scheduler automático cada 30 minutos (configurable con RADARLOTO_SYNC_CRON).
- Primera sincronización automática al arrancar.
- Nuevo endpoint POST /api/admin/run-cycle para lanzar sync + evaluación completa.

Variables útiles:
- TZ=Europe/Madrid
- RADARLOTO_SYNC_CRON=*/30 * * * *
