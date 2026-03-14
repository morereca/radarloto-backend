# Radar Loto backend + base de datos

Proyecto base para convertir Radar Loto en una web con:
- backend Express
- SQLite
- registro automático de combinaciones generadas
- almacenamiento de sorteos
- evaluación automática de tickets frente a sorteos guardados
- soporte para Euromillones y La Primitiva (incluyendo reintegro)

## Arranque

```bash
npm install
npm run seed
npm start
```

La app arranca en `http://localhost:3000`.

## Qué hace

- Cuando el usuario genera una combinación, se guarda automáticamente en la base de datos.
- Los tickets se guardan sin nick.
- Los tickets quedan con estado `pending`.
- Cuando existe un sorteo guardado para ese juego y esa fecha, el backend calcula:
  - aciertos principales
  - estrellas (Euromillones)
  - reintegro (Primitiva)
  - resumen del tipo “Habríamos dado este premio...”

## Rutas API principales

- `POST /api/generate`
- `GET /api/tickets`
- `GET /api/feed`
- `GET /api/draws?game=euromillones`
- `POST /api/admin/import-draw`
- `POST /api/admin/evaluate-pending`
- `POST /api/admin/sync-official`

## Resultados oficiales

He dejado un adaptador `services/officialSync.js` preparado para leer resultados desde páginas oficiales y guardarlos en base de datos.
Si el HTML oficial cambia, solo hay que tocar ese servicio.

## Importante

La parte de “IA de verdad” necesitaría un backend más avanzado o una API/modelo externo.
En este proyecto el motor de generación es heurístico y persistente: ya no es una simple página HTML aislada.

## Cambios v2
- Ya no muestra todos los números guardados en pantalla.
- Muestra contador total de tickets generados.
- Añade ranking de premios 'dados' a partir de tickets evaluados.


## Cambios v3
- Sync oficial más robusto con varios intentos de parsing.
- Nuevas rutas `/api/stats` y `/api/prize-ranking`.
- La home ya muestra volumen generado y ranking de premios dados, no todos los tickets.


## Automatización de sorteos
Se añade un scheduler con `node-cron`.

### Ejecutar una sincronización manual completa
```bash
node scripts/syncAndEvaluate.js
```

### Dejar el cron activo
```bash
npm run cron
```

Expresión por defecto:
- `15 22 * * 2,4,5`
- martes, jueves y viernes a las 22:15 (Europe/Madrid)

Puedes cambiarla con:
```bash
RADARLOTO_CRON="0 23 * * *" npm run cron
```


Backend v5.1 corregido: sync oficial desde páginas de resultados oficiales de SELAE y autosync cada 30 minutos.


## Importación desde archivo histórico local

Esta versión permite importar histórico sin scraping web.

### Archivos esperados
- `data/primitiva-2016-hoy.json`
- `data/euromillones-2016-hoy.json`

### Formato Primitiva
```json
{
  "draws": [
    {
      "drawDate": "2026-03-12",
      "numbers": [5,12,16,22,29,36],
      "reintegro": 2
    }
  ]
}
```

### Formato Euromillones
```json
{
  "draws": [
    {
      "drawDate": "2026-03-13",
      "numbers": [13,17,26,41,48],
      "stars": [4,10]
    }
  ]
}
```

### Endpoints nuevos
- `GET /api/history-local-files`
- `POST /api/admin/import-history-local`

Si llamas a `POST /api/admin/import-history-local` sin `game`, importa ambos juegos.
