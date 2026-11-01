import express from "express";
import rateLimit from "express-rate-limit";
import cors from "cors";
import path from "path";
import pkg from "pg";
import { fileURLToPath } from "url";

const { Pool } = pkg;
const app = express();
app.set("trust proxy", true);

const apiLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minuto
  max: 100, // máximo 100 peticiones por IP
  standardHeaders: true,
  legacyHeaders: false,
  message: "Too many requests, try again later.",
  keyGenerator: (req) => {
    const cfIp = req.headers["cf-connecting-ip"];
    const forwarded = req.headers["x-forwarded-for"];

    if (typeof cfIp === "string" && cfIp.trim()) return cfIp.trim();
    if (typeof forwarded === "string" && forwarded.trim()) {
      return forwarded.split(",")[0].trim();
    }

    return req.ip;
  }
});

// protege SOLO /api
app.use("/api", apiLimiter);

app.use(cors());
app.use(express.json({ limit: "1mb" }));

// ===== REDIRECCIONES SEO =====
// OJO: estas redirecciones van ANTES de express.static para que no las pisen
// los archivos HTML existentes dentro de /public.

// España: fríos / menos frecuentes
app.get('/numeros-menos-frecuentes-euromillones.html', (req, res) => {
  return res.redirect(301, '/numeros-frios-euromillones.html');
});

app.get('/numeros-menos-frecuentes-primitiva.html', (req, res) => {
  return res.redirect(301, '/numeros-frios-primitiva.html');
});

// España: más frecuentes / que más salen
app.get('/numeros-mas-frecuentes-euromillones.html', (req, res) => {
  return res.redirect(301, '/numeros-que-mas-salen-euromillones.html');
});

app.get('/numeros-mas-frecuentes-primitiva.html', (req, res) => {
  return res.redirect(301, '/numeros-que-mas-salen-primitiva.html');
});

// USA: statistics
app.get(['/powerball-stats.html', '/estadisticas-powerball.html'], (req, res) => {
  return res.redirect(301, '/powerball-statistics.html');
});

app.get(['/mega-stats.html', '/estadisticas-megamillions.html'], (req, res) => {
  return res.redirect(301, '/mega-statistics.html');
});

// USA: hot numbers
app.get('/numeros-que-mas-salen-powerball.html', (req, res) => {
  return res.redirect(301, '/powerball-hot-numbers.html');
});

app.get('/numeros-que-mas-salen-megamillions.html', (req, res) => {
  return res.redirect(301, '/mega-hot-numbers.html');
});

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.use(express.static(path.join(__dirname, "public")));

const PORT = Number(process.env.PORT || 3000);
const YEARS_BACK = Number(process.env.YEARS_BACK || 10);
const SYNC_MAX_AGE_HOURS = Number(process.env.SYNC_MAX_AGE_HOURS || 1);
const AUTO_SYNC_INTERVAL_MINUTES = Number(process.env.AUTO_SYNC_INTERVAL_MINUTES || 30);
const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error("Falta DATABASE_URL");
  process.exit(1);
}

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: process.env.PGSSLMODE === "disable" ? false : { rejectUnauthorized: false }
});

const CSV_URLS = {
  primitiva: process.env.PRIMITIVA_CSV_URL || "https://docs.google.com/spreadsheets/d/e/2PACX-1vTov1BuA0nkVGTS48arpPFkc9cG7B40Xi3BfY6iqcWTrMwCBg5b50-WwvnvaR6mxvFHbDBtYFKg5IsJ/pub?gid=1&output=csv&single=true",
  euromillones: process.env.EUROMILLONES_CSV_URL || "https://docs.google.com/spreadsheets/d/e/2PACX-1vRy91wfK2JteoMi1ZOhGm0D1RKJfDTbEOj6rfnrB6-X7n2Q1nfFwBZBpcivHRdg3pSwxSQgLA3KpW7v/pub?output=csv",
  bonoloto: process.env.BONOLOTO_CSV_URL || "https://docs.google.com/spreadsheets/d/e/2PACX-1vQALTRaLDFfhXOAQmeONPqmFKm9yOiQ4W97rhWgR41BZ7czFsjK5YktD6fnETKHGB9YUnyQ4XBSbhZx/pub?gid=0&single=true&output=csv"
};

// Juegos de 6 números con complementario y reintegro
const SIX_NUMBER_GAMES = ["primitiva", "bonoloto"];
// Juegos de 5 números + 2 estrellas/soles
const STAR_GAMES = ["euromillones", "eurojackpot"];
const ES_GAMES = ["primitiva", "euromillones", "bonoloto", "eurojackpot"];

// EuroJackpot: resultados oficiales desde la API pública de LOTTO.de (Alemania).
// La ONCE bloquea las peticiones desde servidores; el robots.txt de lotto.de lo permite todo.
const LOTTO_DE_API = "https://www.lotto.de/api/stats/entities.eurojackpot";
const LOTTO_DE_DELAY_MS = 250;

const stats = {
  total_generated: 0,
  primitiva_generated: 0,
  euromillones_generated: 0,
  won_count: 0
};


const ACTIVE_USER_TTL_MS = Number(process.env.ACTIVE_USER_TTL_MS || 70000);
const RANKING_RESPONSE_LIMIT = clamp(Number(process.env.RANKING_RESPONSE_LIMIT || 10), 1, 100);
const activeVisitors = new Map();

function cleanupActiveVisitors() {
  const now = Date.now();
  for (const [id, ts] of activeVisitors.entries()) {
    if (now - ts > ACTIVE_USER_TTL_MS) activeVisitors.delete(id);
  }
}

function getActiveUsersCount() {
  cleanupActiveVisitors();
  return activeVisitors.size;
}

function touchActiveVisitor(rawId) {
  const id = String(rawId || '').trim().slice(0, 120);
  if (!id) return getActiveUsersCount();
  activeVisitors.set(id, Date.now());
  return getActiveUsersCount();
}

setInterval(cleanupActiveVisitors, 15000).unref();
let lastSyncAt = null;
let syncPromise = null;
const syncLog = [];

function logSync(message) {
  const line = `${new Date().toISOString()} ${message}`;
  syncLog.unshift(line);
  if (syncLog.length > 120) syncLog.length = 120;
  console.log(line);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function normalizeGame(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizeDate(value) {
  const str = String(value || "").trim();

  let m = str.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;

  m = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return `${m[3]}-${String(m[2]).padStart(2, "0")}-${String(m[1]).padStart(2, "0")}`;

  m = str.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
  if (m) return `${m[3]}-${String(m[2]).padStart(2, "0")}-${String(m[1]).padStart(2, "0")}`;

  return str;
}

function currentWindowStartISO() {
  const now = new Date();
  const start = new Date(now);
  start.setUTCFullYear(start.getUTCFullYear() - YEARS_BACK);
  return start.toISOString().slice(0, 10);
}

function inHistoryWindow(drawDate) {
  return normalizeDate(drawDate) >= currentWindowStartISO();
}

function gameConfig(game) {
  if (game === "primitiva") return { numbers: 6, min: 1, max: 49, stars: 0, starMax: 0 };
  if (game === "bonoloto") return { numbers: 6, min: 1, max: 49, stars: 0, starMax: 0 };
  if (game === "eurojackpot") return { numbers: 5, min: 1, max: 50, stars: 2, starMax: 12 };
  if (game === "euromillones") return { numbers: 5, min: 1, max: 50, stars: 2, starMax: 12 };
  return null;
}

function uniqueRandoms(count, min, max) {
  const arr = [];
  while (arr.length < count) {
    const n = Math.floor(Math.random() * (max - min + 1)) + min;
    if (!arr.includes(n)) arr.push(n);
  }
  return arr.sort((a, b) => a - b);
}

async function query(sql, params = []) {
  return pool.query(sql, params);
}

async function ensureDb() {
  await query(`
    CREATE TABLE IF NOT EXISTS es_draws (
      id BIGSERIAL PRIMARY KEY,
      game TEXT NOT NULL,
      draw_date DATE NOT NULL,
      numbers_json JSONB NOT NULL DEFAULT '[]'::jsonb,
      stars_json JSONB NOT NULL DEFAULT '[]'::jsonb,
      reintegro INTEGER,
      complementary INTEGER,
      source TEXT,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);

  await query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'unique_es_game_date'
      ) THEN
        ALTER TABLE es_draws
        ADD CONSTRAINT unique_es_game_date UNIQUE (game, draw_date);
      END IF;
    END$$;
  `);

  await query(`
    CREATE INDEX IF NOT EXISTS idx_es_draws_game_date
    ON es_draws (game, draw_date DESC)
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS es_generated_cache (
      id BIGSERIAL PRIMARY KEY,
      cache_key TEXT NOT NULL UNIQUE,
      payload JSONB NOT NULL,
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS es_generated (
      id BIGSERIAL PRIMARY KEY,
      game TEXT NOT NULL,
      mode TEXT NOT NULL,
      numbers_json JSONB NOT NULL DEFAULT '[]'::jsonb,
      stars_json JSONB NOT NULL DEFAULT '[]'::jsonb,
      reintegro INTEGER,
      historical_winning_draws INTEGER NOT NULL DEFAULT 0,
      historical_top_prize TEXT,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);

  await query(`
    CREATE INDEX IF NOT EXISTS idx_es_generated_created_at
    ON es_generated (created_at DESC)
  `);

  await query(`
    CREATE INDEX IF NOT EXISTS idx_es_generated_game_created_at
    ON es_generated (game, created_at DESC)
  `);
}

async function loadGeneratedCache() {
  const { rows } = await query(
    `SELECT payload FROM es_generated_cache WHERE cache_key = 'generated_cache' LIMIT 1`
  );
  const payload = rows[0]?.payload;
  if (!payload) return;

  if (payload.stats) {
    stats.total_generated = Number(payload.stats.total_generated || 0);
    stats.primitiva_generated = Number(payload.stats.primitiva_generated || 0);
    stats.euromillones_generated = Number(payload.stats.euromillones_generated || 0);
    stats.won_count = Number(payload.stats.won_count || 0);
  }

  lastSyncAt = payload.last_sync_at || null;
  if (Array.isArray(payload.sync_log)) {
    syncLog.splice(0, syncLog.length, ...payload.sync_log.slice(0, 120));
  }
}

async function saveGeneratedCache() {
  const payload = {
    stats,
    last_sync_at: lastSyncAt,
    sync_log: syncLog.slice(0, 120)
  };

  await query(
    `INSERT INTO es_generated_cache (cache_key, payload, updated_at)
     VALUES ('generated_cache', $1::jsonb, NOW())
     ON CONFLICT (cache_key)
     DO UPDATE SET payload = EXCLUDED.payload, updated_at = NOW()`,
    [JSON.stringify(payload)]
  );
}

async function rebuildStatsFromDatabase() {
  const { rows } = await query(`
    SELECT
      COUNT(*)::int AS total_generated,
      COUNT(*) FILTER (WHERE game = 'primitiva')::int AS primitiva_generated,
      COUNT(*) FILTER (WHERE game = 'euromillones')::int AS euromillones_generated,
      COUNT(*) FILTER (WHERE historical_winning_draws > 0)::int AS won_count
    FROM es_generated
  `);

  const row = rows[0] || {};
  stats.total_generated = Number(row.total_generated || 0);
  stats.primitiva_generated = Number(row.primitiva_generated || 0);
  stats.euromillones_generated = Number(row.euromillones_generated || 0);
  stats.won_count = Number(row.won_count || 0);
}

async function fetchText(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 25000);

  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        "user-agent": "Mozilla/5.0 (compatible; RadarLotoBot/1.0; +https://radarloto.com)",
        "accept": "text/csv,text/plain;q=0.9,*/*;q=0.8",
        "cache-control": "no-cache",
        "pragma": "no-cache"
      }
    });

    if (!res.ok) throw new Error(`HTTP ${res.status} en ${url}`);
    return await res.text();
  } finally {
    clearTimeout(timeout);
  }
}

function dedupeRows(rows) {
  const seen = new Set();
  return rows.filter((row) => {
    const key = `${row.game}|${row.drawDate}|${row.numbers.join("-")}|${(row.stars || []).join("-")}|${row.reintegro ?? ""}|${row.complementary ?? ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function extractDate(line) {
  let m = line.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (m) return { original: m[0], iso: `${m[1]}-${m[2]}-${m[3]}` };

  m = line.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) return { original: m[0], iso: `${m[3]}-${String(m[2]).padStart(2, "0")}-${String(m[1]).padStart(2, "0")}` };

  m = line.match(/(\d{1,2})-(\d{1,2})-(\d{4})/);
  if (m) return { original: m[0], iso: `${m[3]}-${String(m[2]).padStart(2, "0")}-${String(m[1]).padStart(2, "0")}` };

  return null;
}

function extractNumbersAfterDate(line, dateString) {
  const idx = line.indexOf(dateString);
  const tail = idx >= 0 ? line.slice(idx + dateString.length) : line;
  return (tail.match(/\d{1,2}/g) || []).map(Number).filter(Number.isFinite);
}

function parseCsvLineForGame(game, line) {
  const date = extractDate(line);
  if (!date) return null;

  const numberTokens = extractNumbersAfterDate(line, date.original);

  if (SIX_NUMBER_GAMES.includes(game)) {
    if (numberTokens.length < 6) return null;
    const numbers = numberTokens.slice(0, 6).sort((a, b) => a - b);
    const extra = numberTokens.slice(6);

    const complementary = extra.find((n) => !numbers.includes(n)) ?? null;
    const reintegro = extra.length ? extra[extra.length - 1] : null;

    return {
      game,
      drawDate: date.iso,
      numbers,
      stars: [],
      reintegro: Number.isFinite(reintegro) ? reintegro : null,
      complementary: Number.isFinite(complementary) ? complementary : null,
      source: `csv_${game}`
    };
  }

  if (numberTokens.length < 7) return null;

  return {
    game: "euromillones",
    drawDate: date.iso,
    numbers: numberTokens.slice(0, 5).sort((a, b) => a - b),
    stars: numberTokens.slice(5, 7).sort((a, b) => a - b),
    reintegro: null,
    complementary: null,
    source: "csv_euromillones"
  };
}

function parseCsvHistory(game, csv, startYear, endYear) {
  const lines = csv.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const out = [];
  for (const line of lines) {
    const row = parseCsvLineForGame(game, line);
    if (!row) continue;
    const year = Number(row.drawDate.slice(0, 4));
    if (year < startYear || year > endYear) continue;
    out.push(row);
  }
  return dedupeRows(out);
}

async function upsertDraw(draw) {
  if (!draw || !inHistoryWindow(draw.drawDate)) return;

  await query(
    `INSERT INTO es_draws (game, draw_date, numbers_json, stars_json, reintegro, complementary, source)
     VALUES ($1,$2,$3::jsonb,$4::jsonb,$5,$6,$7)
     ON CONFLICT (game, draw_date)
     DO UPDATE SET
       numbers_json = EXCLUDED.numbers_json,
       stars_json = EXCLUDED.stars_json,
       reintegro = COALESCE(EXCLUDED.reintegro, es_draws.reintegro),
       complementary = COALESCE(EXCLUDED.complementary, es_draws.complementary),
       source = EXCLUDED.source,
       updated_at = NOW()`,
    [
      draw.game,
      normalizeDate(draw.drawDate),
      JSON.stringify(draw.numbers || []),
      JSON.stringify(draw.stars || []),
      draw.reintegro ?? null,
      draw.complementary ?? null,
      draw.source ?? null
    ]
  );
}

async function importHistory(game, startYear, endYear) {
  const url = CSV_URLS[game];
  if (!url) throw new Error(`Juego no soportado: ${game}`);
  const csv = await fetchText(url);
  const rows = parseCsvHistory(game, csv, Number(startYear), Number(endYear));
  for (const row of rows) await upsertDraw(row);
  logSync(`${game}: ${rows.length} sorteos importados desde CSV`);
  return rows.length;
}

function shouldSyncNow(force = false) {
  if (force) return true;
  if (!lastSyncAt) return true;
  const last = new Date(lastSyncAt).getTime();
  const ageMs = Date.now() - last;
  return ageMs > SYNC_MAX_AGE_HOURS * 60 * 60 * 1000;
}


function startAutoSync() {
  const intervalMs = Math.max(5, AUTO_SYNC_INTERVAL_MINUTES) * 60 * 1000;

  setInterval(() => {
    syncHistory(true).catch((err) => {
      logSync(`Error en sincronización automática ES: ${err.message}`);
    });
  }, intervalMs).unref();

  logSync(`Auto-sync ES activado cada ${Math.max(5, AUTO_SYNC_INTERVAL_MINUTES)} minutos`);
}

const eurojackpotMissing = new Set(); // fechas consultadas sin resultado (se reintentan tras reiniciar)
let eurojackpotSyncRunning = false;

async function fetchLottoDeJson(path) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  try {
    const res = await fetch(`${LOTTO_DE_API}${path}`, {
      signal: controller.signal,
      headers: {
        "user-agent": "Mozilla/5.0 (compatible; RadarLotoBot/1.0; +https://radarloto.com)",
        "accept": "application/json"
      }
    });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timeout);
  }
}

/** La API identifica cada sorteo por la medianoche (hora de Berlín) del día, en milisegundos. */
function berlinMidnightMs(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  const fmt = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Berlin", hour: "2-digit", hour12: false });
  for (const offsetHours of [1, 2]) {
    const ms = Date.UTC(y, m - 1, d) - offsetHours * 3600 * 1000;
    if (fmt.format(new Date(ms)) === "00") return ms;
  }
  return Date.UTC(y, m - 1, d) - 3600 * 1000;
}

function parseLottoDeDraw(json, drawDate) {
  const items = Array.isArray(json?.drawNumbersCollection) ? json.drawNumbersCollection : [];
  const pick = (type) => items
    .filter((x) => x?.drawNumberType === type && Number.isFinite(Number(x?.drawNumber)))
    .map((x) => Number(x.drawNumber))
    .sort((a, b) => a - b);
  const numbers = pick(0);
  const stars = pick(1);
  if (numbers.length !== 5 || stars.length !== 2) return null;
  return { game: "eurojackpot", drawDate, numbers, stars, reintegro: null, complementary: null, source: "lotto.de" };
}

async function syncEurojackpot() {
  if (eurojackpotSyncRunning) return;
  eurojackpotSyncRunning = true;
  try {
    const windowStart = currentWindowStartISO();
    const firstYear = Number(windowStart.slice(0, 4));
    const thisYear = new Date().getUTCFullYear();

    // 1) Fechas de sorteo de cada año. La API devuelve los sorteos del año hasta la fecha
    //    indicada, así que se pide con el 31 de diciembre para tener el año entero.
    const dates = [];
    for (let year = firstYear; year <= thisYear; year += 1) {
      const json = await fetchLottoDeJson(`/history/${Date.UTC(year, 11, 31, 12)}`);
      for (const day of json?.days || []) {
        if (typeof day?.date === "string" && day.date >= windowStart) dates.push(day.date);
      }
      await new Promise((r) => setTimeout(r, LOTTO_DE_DELAY_MS));
    }

    // 2) Solo las que faltan en la base de datos
    const { rows } = await query(`SELECT draw_date::text AS d FROM es_draws WHERE game = 'eurojackpot'`);
    const have = new Set(rows.map((r) => r.d));
    const pending = [...new Set(dates)].filter((d) => !have.has(d) && !eurojackpotMissing.has(d)).sort();
    if (!pending.length) return;

    logSync(`eurojackpot: importando ${pending.length} sorteos desde lotto.de`);
    let added = 0;
    let errors = 0;
    let lastError = null;
    for (const iso of pending) {
      try {
        const draw = parseLottoDeDraw(await fetchLottoDeJson(`/draw/${berlinMidnightMs(iso)}`), iso);
        if (draw) {
          await upsertDraw(draw);
          added += 1;
        } else {
          eurojackpotMissing.add(iso);
        }
      } catch (err) {
        errors += 1;
        lastError = err.name === "AbortError" ? "timeout" : err.message;
        if (errors === 1) logSync(`eurojackpot: primer error en lotto.de (${iso}): ${lastError}`);
        // 5 errores sin ningún acierto: la fuente no responde; se reintenta en la próxima sincronización
        if (errors >= 5 && added === 0) break;
      }
      await new Promise((r) => setTimeout(r, LOTTO_DE_DELAY_MS));
    }
    logSync(`eurojackpot: ${added} sorteos nuevos desde lotto.de, ${errors} errores${lastError ? ` (último: ${lastError})` : ""}`);
  } catch (err) {
    logSync(`eurojackpot: error al leer el calendario de lotto.de: ${err.message}`);
  } finally {
    eurojackpotSyncRunning = false;
  }
}

async function syncHistory(force = false) {
  if (!shouldSyncNow(force)) return;
  if (syncPromise) {
    await syncPromise;
    return;
  }

  syncPromise = (async () => {
    const year = new Date().getUTCFullYear();
    const startYear = year - YEARS_BACK;

    logSync("Inicio de sincronización histórica ES");

    try { await importHistory("primitiva", startYear, year); }
    catch (err) { logSync(`Error al importar primitiva: ${err.message}`); }

    try { await importHistory("euromillones", startYear, year); }
    catch (err) { logSync(`Error al importar euromillones: ${err.message}`); }

    try { await importHistory("bonoloto", startYear, year); }
    catch (err) { logSync(`Error al importar bonoloto: ${err.message}`); }

    // En segundo plano: la primera carga lee ~800 sorteos y no debe bloquear las peticiones.
    syncEurojackpot().catch((err) => logSync(`Error al importar eurojackpot: ${err.message}`));

    lastSyncAt = new Date().toISOString();
    await saveGeneratedCache();
    logSync("Sincronización histórica ES completada");
  })();

  try { await syncPromise; }
  finally { syncPromise = null; }
}

async function getAllDrawRows(game) {
  const { rows } = await query(
    `SELECT draw_date::text AS draw_date, numbers_json, stars_json, reintegro, complementary
       FROM es_draws
      WHERE game = $1 AND draw_date >= $2
      ORDER BY draw_date ASC`,
    [game, currentWindowStartISO()]
  );

  return rows.map((r) => ({
    drawDate: r.draw_date,
    numbers: Array.isArray(r.numbers_json) ? r.numbers_json.map(Number).sort((a, b) => a - b) : [],
    stars: Array.isArray(r.stars_json) ? r.stars_json.map(Number).sort((a, b) => a - b) : [],
    reintegro: r.reintegro != null ? Number(r.reintegro) : null,
    complementary: r.complementary != null ? Number(r.complementary) : null
  }));
}

function buildFrequencyMapsFromDraws(game, draws) {
  const cfg = gameConfig(game);
  const numFreq = new Map();
  const starFreq = new Map();
  const lastSeen = new Map();
  const starLastSeen = new Map();

  for (let i = 0; i < draws.length; i += 1) {
    const draw = draws[i];
    for (const n of draw.numbers) {
      numFreq.set(n, (numFreq.get(n) || 0) + 1);
      lastSeen.set(n, i);
    }
    if (STAR_GAMES.includes(game)) {
      for (const s of draw.stars || []) {
        starFreq.set(s, (starFreq.get(s) || 0) + 1);
        starLastSeen.set(s, i);
      }
    }
  }

  const numCold = new Map();
  const starCold = new Map();
  const lastIndex = Math.max(0, draws.length - 1);

  for (let n = cfg.min; n <= cfg.max; n += 1) {
    const seenAt = lastSeen.has(n) ? lastSeen.get(n) : -9999;
    numCold.set(n, lastIndex - seenAt);
  }

  if (STAR_GAMES.includes(game)) {
    for (let s = 1; s <= cfg.starMax; s += 1) {
      const seenAt = starLastSeen.has(s) ? starLastSeen.get(s) : -9999;
      starCold.set(s, lastIndex - seenAt);
    }
  }

  return { draws, numFreq, starFreq, numCold, starCold };
}

function weightedPick(pool, weights, count) {
  const selected = new Set();
  while (selected.size < count) {
    const available = pool.filter((n) => !selected.has(n));
    const total = available.reduce((sum, n) => sum + (weights.get(n) || 1), 0);
    let r = Math.random() * total;
    for (const n of available) {
      r -= (weights.get(n) || 1);
      if (r <= 0) {
        selected.add(n);
        break;
      }
    }
  }
  return [...selected].sort((a, b) => a - b);
}

/**
 * Ordena el bombo por apariciones (de más a menos si hot, de menos a más si no),
 * se queda con los `poolSize` primeros y elige `count` al azar entre ellos.
 */
function pickByFrequency(pool, freqMap, count, poolSize, hot) {
  const ranked = [...pool]
    .map((n) => ({ n, c: freqMap.get(n) || 0, r: Math.random() }))
    .sort((a, b) => (hot ? b.c - a.c : a.c - b.c) || a.r - b.r)
    .slice(0, Math.max(count, poolSize))
    .map((x) => x.n);
  return uniqueFrom(ranked, count);
}

function uniqueFrom(list, count) {
  const copy = [...list];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy.slice(0, count).sort((a, b) => a - b);
}

/**
 * Radar Loto IA: genera muchas candidatas mezclando calientes, fríos y neutros
 * y se queda con la de estructura más "típica" que además evita los patrones
 * que juega mucha gente (fechas, series, combinaciones ya premiadas).
 * No aumenta la probabilidad de acertar; reduce la de compartir premio.
 */
const RADAR_AI_CANDIDATES = 600;

function generateRadarAI(game, cfg, draws, numFreq, starFreq) {
  const pool = Array.from({ length: cfg.max - cfg.min + 1 }, (_, i) => i + cfg.min);
  const ranked = [...pool].sort((a, b) => (numFreq.get(b) || 0) - (numFreq.get(a) || 0));
  const hotSet = ranked.slice(0, 12);
  const coldSet = ranked.slice(-12);
  const neutral = ranked.slice(12, ranked.length - 12);
  const nHot = 2;
  const nCold = 2;
  const nNeutral = cfg.numbers - nHot - nCold;

  const pastCombos = new Set(draws.map((d) => d.numbers.join("-")));
  const starPool = Array.from({ length: cfg.starMax }, (_, i) => i + 1);

  let best = null;
  for (let i = 0; i < RADAR_AI_CANDIDATES; i += 1) {
    const numbers = [
      ...uniqueFrom(hotSet, nHot),
      ...uniqueFrom(coldSet, nCold),
      ...uniqueFrom(neutral, nNeutral)
    ].sort((a, b) => a - b);
    if (new Set(numbers).size !== cfg.numbers) continue;

    const evaluation = evaluateRadarAI(game, numbers, pastCombos);
    if (!best || evaluation.score > best.score) {
      best = { numbers, ...evaluation };
    }
  }

  let stars = [];
  if (cfg.stars > 0) {
    // Una estrella entre las más frecuentes y otra entre el resto, evitando consecutivas.
    const rankedStars = [...starPool].sort((a, b) => (starFreq.get(b) || 0) - (starFreq.get(a) || 0));
    for (let i = 0; i < 50; i += 1) {
      const candidate = [...uniqueFrom(rankedStars.slice(0, 4), 1), ...uniqueFrom(rankedStars.slice(4), cfg.stars - 1)]
        .sort((a, b) => a - b);
      stars = candidate;
      if (countConsecutive(candidate) === 0) break;
    }
  }

  return { numbers: best.numbers, stars, highlights: best.highlights };
}

function evaluateRadarAI(game, numbers, pastCombos) {
  const six = SIX_NUMBER_GAMES.includes(game);
  const sum = numbers.reduce((a, b) => a + b, 0);
  const odd = numbers.filter((n) => n % 2 === 1).length;
  const even = numbers.length - odd;
  const decades = new Set(numbers.map((n) => Math.floor((n === 50 ? 49 : n) / 10))).size;
  const consecutive = countConsecutive(numbers);
  const above31 = numbers.filter((n) => n > 31).length;
  const minSum = six ? 100 : 95;
  const maxSum = six ? 200 : 160;
  const steps = numbers.slice(1).map((n, i) => n - numbers[i]);
  const arithmetic = steps.every((d) => d === steps[0]);

  let score = calcStatQuality(game, numbers);
  if (sum >= minSum && sum <= maxSum) score += 10;
  if (Math.abs(odd - even) <= (six ? 0 : 1)) score += 6;
  if (decades >= numbers.length - 1) score += 6;
  if (consecutive === 0) score += 4;
  if (above31 >= 2) score += 10;        // evita combinaciones de solo fechas
  else if (above31 === 1) score += 4;
  if (arithmetic) score -= 60;          // series tipo 5-10-15-20...
  if (pastCombos.has(numbers.join("-"))) score -= 100;

  const highlights = [];
  if (above31 >= 2) highlights.push("Evita las combinaciones de fechas (números > 31 incluidos)");
  if (sum >= minSum && sum <= maxSum) highlights.push(`Suma ${sum}, dentro del rango más habitual`);
  if (Math.abs(odd - even) <= 1) highlights.push(`${even} pares y ${odd} impares`);
  if (decades >= numbers.length - 1) highlights.push("Números repartidos por todas las decenas");
  highlights.push("Mezcla de 2 números calientes, 2 fríos y el resto neutros");
  if (!pastCombos.has(numbers.join("-"))) highlights.push("Nunca ha salido completa como combinación ganadora (1ª categoría)");

  return { score, highlights };
}

async function generateCombination(game, mode = "Al azar") {
  const cfg = gameConfig(game);
  if (!cfg) return null;

  const draws = await getAllDrawRows(game);
  const { numFreq, starFreq, numCold, starCold } = buildFrequencyMapsFromDraws(game, draws);

  const pool = Array.from({ length: cfg.max - cfg.min + 1 }, (_, i) => i + cfg.min);
  const starPool = Array.from({ length: cfg.starMax }, (_, i) => i + 1);

  let numbers = [];
  let stars = [];
  let reintegro = null;
  let highlights = [];

  if ((mode === "Números calientes" || mode === "Números fríos") && draws.length > 0) {
    // Calientes: se elige entre los números que MÁS veces han salido.
    // Fríos: se elige entre los números que MENOS veces han salido.
    const hot = mode === "Números calientes";
    numbers = pickByFrequency(pool, numFreq, cfg.numbers, cfg.numbers * 2, hot);
    if (STAR_GAMES.includes(game)) {
      stars = pickByFrequency(starPool, starFreq, cfg.stars, cfg.stars * 2, hot);
    }
  } else if (mode === "Radar Loto IA" && draws.length > 0) {
    const best = generateRadarAI(game, cfg, draws, numFreq, starFreq);
    numbers = best.numbers;
    stars = best.stars;
    highlights = best.highlights;
  } else {
    numbers = uniqueRandoms(cfg.numbers, cfg.min, cfg.max);
    if (STAR_GAMES.includes(game)) stars = uniqueRandoms(cfg.stars, 1, cfg.starMax);
  }

  if (SIX_NUMBER_GAMES.includes(game)) reintegro = Math.floor(Math.random() * 10);
  return highlights.length ? { numbers, stars, reintegro, highlights } : { numbers, stars, reintegro };
}

function countConsecutive(values) {
  let total = 0;
  for (let i = 1; i < values.length; i += 1) {
    if (values[i] === values[i - 1] + 1) total += 1;
  }
  return total;
}

function maxEndingRepeat(values) {
  const counts = {};
  for (const n of values) {
    const ending = String(n).slice(-1);
    counts[ending] = (counts[ending] || 0) + 1;
  }
  return Math.max(...Object.values(counts));
}

function calcEquilibrium(game, numbers) {
  const odd = numbers.filter((n) => n % 2 === 1).length;
  const six = SIX_NUMBER_GAMES.includes(game);
  const idealOdd = six ? 3 : 2;
  return clamp((six ? 84 : 82) - Math.abs(idealOdd - odd) * 8, 20, 98);
}

function calcStatQuality(game, numbers) {
  const sorted = [...numbers].sort((a, b) => a - b);
  const sum = sorted.reduce((a, b) => a + b, 0);
  const odd = sorted.filter((n) => n % 2 === 1).length;
  const six = SIX_NUMBER_GAMES.includes(game);
  const low = sorted.filter((n) => n <= (six ? 24 : 25)).length;
  const consecutive = countConsecutive(sorted);
  const endingRepeat = maxEndingRepeat(sorted);

  let score = 78;
  score -= Math.abs((six ? 3 : 2) - odd) * 7;
  score -= Math.abs(Math.ceil(sorted.length / 2) - low) * 6;
  score -= consecutive * 10;
  score -= Math.max(0, endingRepeat - 2) * 9;

  const minSum = six ? 90 : 80;
  const maxSum = six ? 190 : 180;
  if (sum < minSum || sum > maxSum) score -= 12;

  return clamp(score, 10, 96);
}

function classifyPrimitiva(matches, complementaryHit, reintegroHit, game = "primitiva") {
  if (matches === 6 && reintegroHit && game === "primitiva") return "Especial (6 + R)";
  if (matches === 6) return "1ª (6)";
  if (matches === 5 && complementaryHit) return "2ª (5 + C)";
  if (matches === 5) return "3ª (5)";
  if (matches === 4) return "4ª (4)";
  if (matches === 3) return "5ª (3)";
  if (reintegroHit) return "Reintegro";
  return null;
}

function classifyEuromillones(numMatches, starMatches) {
  const table = {
    "5+2": "1ª (5 + 2)",
    "5+1": "2ª (5 + 1)",
    "5+0": "3ª (5 + 0)",
    "4+2": "4ª (4 + 2)",
    "4+1": "5ª (4 + 1)",
    "3+2": "6ª (3 + 2)",
    "4+0": "7ª (4 + 0)",
    "2+2": "8ª (2 + 2)",
    "3+1": "9ª (3 + 1)",
    "3+0": "10ª (3 + 0)",
    "1+2": "11ª (1 + 2)",
    "2+1": "12ª (2 + 1)",
    "2+0": "13ª (2 + 0)"
  };
  return table[`${numMatches}+${starMatches}`] || null;
}

function classifyEurojackpot(numMatches, starMatches) {
  const table = {
    "5+2": "1ª (5 + 2)",
    "5+1": "2ª (5 + 1)",
    "5+0": "3ª (5 + 0)",
    "4+2": "4ª (4 + 2)",
    "4+1": "5ª (4 + 1)",
    "3+2": "6ª (3 + 2)",
    "4+0": "7ª (4 + 0)",
    "2+2": "8ª (2 + 2)",
    "3+1": "9ª (3 + 1)",
    "3+0": "10ª (3 + 0)",
    "1+2": "11ª (1 + 2)",
    "2+1": "12ª (2 + 1)"
  };
  return table[`${numMatches}+${starMatches}`] || null;
}

async function simulateHistorical(game, generated) {
  const draws = await getAllDrawRows(game);
  const genNums = new Set(generated.numbers);
  const genStars = new Set(generated.stars || []);
  const breakdownMap = {};
  const hitSamples = [];
  let winningDraws = 0;

  for (const draw of draws) {
    const numMatches = draw.numbers.filter((n) => genNums.has(n)).length;

    if (SIX_NUMBER_GAMES.includes(game)) {
      const complementaryHit = draw.complementary != null && genNums.has(draw.complementary);
      const reintegroHit = draw.reintegro != null && Number(draw.reintegro) === Number(generated.reintegro);
      const category = classifyPrimitiva(numMatches, complementaryHit, reintegroHit, game);
      if (category) {
        winningDraws += 1;
        breakdownMap[category] = (breakdownMap[category] || 0) + 1;
        hitSamples.unshift({ date: draw.drawDate, category, summary: `${numMatches} aciertos${complementaryHit ? " + C" : ""}${reintegroHit ? " + R" : ""}` });
      }
    } else {
      const starMatches = (draw.stars || []).filter((s) => genStars.has(s)).length;
      const category = game === "eurojackpot"
        ? classifyEurojackpot(numMatches, starMatches)
        : classifyEuromillones(numMatches, starMatches);
      if (category) {
        winningDraws += 1;
        breakdownMap[category] = (breakdownMap[category] || 0) + 1;
        hitSamples.unshift({ date: draw.drawDate, category, summary: `${numMatches} números + ${starMatches} estrellas` });
      }
    }
  }

  const breakdown = Object.entries(breakdownMap)
    .map(([category, count]) => ({ category, count }))
    .sort((a, b) => b.count - a.count);

  return {
    window_years: YEARS_BACK,
    draws_analyzed: draws.length,
    winning_draws: winningDraws,
    breakdown,
    latest_hits: hitSamples.slice(0, 5)
  };
}

async function buildAnalysis(game, generated) {
  const equilibrium = calcEquilibrium(game, generated.numbers);
  const statQuality = calcStatQuality(game, generated.numbers);
  const historicalSimulation = await simulateHistorical(game, generated);
  return {
    eq: equilibrium,
    statScore: statQuality,
    historicalSimulation,
    reasons: [
      ...(generated.highlights || []),
      `Equilibrio: ${equilibrium} / 100`,
      `Calidad estadística: ${statQuality} / 100`,
      `Simulación histórica (${historicalSimulation.window_years} años): ${historicalSimulation.winning_draws} sorteos con premio`
    ]
  };
}

function registerStats(game, historicalSimulation = null) {
  stats.total_generated += 1;
  if (game === "primitiva") stats.primitiva_generated += 1;
  if (game === "euromillones") stats.euromillones_generated += 1;
  if ((historicalSimulation?.winning_draws || 0) > 0) stats.won_count += 1;
}

async function registerGeneratedCombination(game, mode, generated, analysis = null) {
  await query(
    `INSERT INTO es_generated (
      game, mode, numbers_json, stars_json, reintegro, historical_winning_draws, historical_top_prize, created_at
    )
    VALUES ($1, $2, $3::jsonb, $4::jsonb, $5, $6, $7, NOW())`,
    [
      game,
      String(mode || "Al azar"),
      JSON.stringify(generated.numbers || []),
      JSON.stringify(generated.stars || []),
      generated.reintegro ?? null,
      Number(analysis?.historicalSimulation?.winning_draws || 0),
      analysis?.historicalSimulation?.breakdown?.[0]?.category || null
    ]
  );
}

function getPrizeTierScore(game, label, matchesMain = 0, matchesExtra = 0) {
  if (game === "primitiva") {
    const map = {
      "Especial (6 + R)": 800,
      "1ª (6)": 700,
      "2ª (5 + C)": 600,
      "3ª (5)": 500,
      "4ª (4)": 400,
      "5ª (3)": 300,
      "Reintegro": 200
    };
    return map[label] || (matchesMain * 10 + matchesExtra);
  }

  const map = {
    "1ª (5 + 2)": 1300,
    "2ª (5 + 1)": 1200,
    "3ª (5 + 0)": 1100,
    "4ª (4 + 2)": 1000,
    "5ª (4 + 1)": 900,
    "6ª (3 + 2)": 800,
    "7ª (4 + 0)": 700,
    "8ª (2 + 2)": 600,
    "9ª (3 + 1)": 500,
    "10ª (3 + 0)": 400,
    "11ª (1 + 2)": 300,
    "12ª (2 + 1)": 200,
    "13ª (2 + 0)": 100
  };
  return map[label] || (matchesMain * 10 + matchesExtra);
}

function buildDisplayCombination(item) {
  const numbers = Array.isArray(item.numbers_json)
    ? item.numbers_json.map(Number).sort((a, b) => a - b)
    : Array.isArray(item.numbers)
      ? item.numbers.map(Number).sort((a, b) => a - b)
      : [];

  const stars = Array.isArray(item.stars_json)
    ? item.stars_json.map(Number).sort((a, b) => a - b)
    : Array.isArray(item.stars)
      ? item.stars.map(Number).sort((a, b) => a - b)
      : [];

  return {
    numbers,
    stars,
    reintegro: item.reintegro != null ? Number(item.reintegro) : null
  };
}

async function getCoverage(game) {
  const { rows } = await query(
    `SELECT COUNT(*)::int AS total_draws, MIN(draw_date)::text AS first_draw_date, MAX(draw_date)::text AS last_draw_date
       FROM es_draws
      WHERE game = $1 AND draw_date >= $2`,
    [game, currentWindowStartISO()]
  );
  const r = rows[0] || {};
  return {
    total_draws: r.total_draws || 0,
    draws_analyzed: r.total_draws || 0,
    analyzed_draws: r.total_draws || 0,
    analyzed_count: r.total_draws || 0,
    total_analyzed: r.total_draws || 0,
    first_draw_date: r.first_draw_date || null,
    firstDrawDate: r.first_draw_date || null,
    last_draw_date: r.last_draw_date || null,
    lastDrawDate: r.last_draw_date || null,
    years_back: YEARS_BACK
  };
}

function mapCounts(countMap) {
  return Object.fromEntries([...countMap.entries()].sort((a, b) => Number(a[0]) - Number(b[0])));
}

async function getNumberStats(game) {
  const cfg = gameConfig(game);
  const draws = await getAllDrawRows(game);
  const { numFreq, starFreq, numCold, starCold } = buildFrequencyMapsFromDraws(game, draws);

  const hotMain = [...numFreq.entries()]
    .sort((a, b) => b[1] - a[1] || a[0] - b[0])
    .map(([number, count]) => ({ number, count }));

  const coldMain = Array.from({ length: cfg.max - cfg.min + 1 }, (_, i) => i + cfg.min)
    .map((number) => ({ number, gap: numCold.get(number) || 0, count: numFreq.get(number) || 0 }))
    .sort((a, b) => b.gap - a.gap || a.number - b.number);

  const hotExtra = STAR_GAMES.includes(game)
    ? [...starFreq.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0]).map(([number, count]) => ({ number, count }))
    : [];

  const coldExtra = STAR_GAMES.includes(game)
    ? Array.from({ length: cfg.starMax }, (_, i) => i + 1)
        .map((number) => ({ number, gap: starCold.get(number) || 0, count: starFreq.get(number) || 0 }))
        .sort((a, b) => b.gap - a.gap || a.number - b.number)
    : [];

  const coverage = await getCoverage(game);

  return {
    coverage,
    hot_numbers: hotMain.slice(0, 12),
    cold_numbers: coldMain.slice(0, 12),
    hot_extra: hotExtra.slice(0, 6),
    cold_extra: coldExtra.slice(0, 6),
    main_counts: mapCounts(numFreq),
    extra_counts: STAR_GAMES.includes(game) ? mapCounts(starFreq) : {}
  };
}

app.get("/api/health", async (_req, res) => {
  const primitiva = await getCoverage("primitiva");
  const euromillones = await getCoverage("euromillones");
  res.json({
    ok: true,
    history: {
      primitiva_draws: primitiva.total_draws,
      euromillones_draws: euromillones.total_draws,
      last_sync_at: lastSyncAt
    }
  });
});

app.post("/api/presence", (req, res) => {
  const sessionId = req.body?.session_id || req.body?.sessionId || req.query?.session_id || req.query?.sessionId;
  const activeUsers = touchActiveVisitor(sessionId);
  res.json({ ok: true, active_users: activeUsers, ttl_ms: ACTIVE_USER_TTL_MS });
});

app.get("/api/stats", async (_req, res) => {
  await syncHistory(false);
  const primitiva = await getCoverage("primitiva");
  const euromillones = await getCoverage("euromillones");
  res.json({
    stats: {
      ...stats,
      active_users: getActiveUsersCount()
    },
    history: {
      primitiva_draws: primitiva.total_draws,
      euromillones_draws: euromillones.total_draws,
      last_sync_at: lastSyncAt
    }
  });
});

app.get("/api/history-status", async (_req, res) => {
  await syncHistory(false);
  const primitiva = await getCoverage("primitiva");
  const euromillones = await getCoverage("euromillones");
  res.json({
    history: {
      years_back: YEARS_BACK,
      primitiva_draws: primitiva.total_draws,
      euromillones_draws: euromillones.total_draws,
      last_sync_at: lastSyncAt,
      sync_log: syncLog,
      source: {
        provider: "lotoideas_csv",
        urls: CSV_URLS
      },
      table: "es_draws"
    }
  });
});

app.post("/api/history/refresh", async (_req, res) => {
  await syncHistory(false);
  const primitiva = await getCoverage("primitiva");
  const euromillones = await getCoverage("euromillones");
  res.json({
    ok: true,
    history: {
      primitiva_draws: primitiva.total_draws,
      euromillones_draws: euromillones.total_draws,
      last_sync_at: lastSyncAt
    }
  });
});

app.get("/api/history-coverage", async (_req, res) => {
  await syncHistory(false);
  res.json({
    primitiva: await getCoverage("primitiva"),
    euromillones: await getCoverage("euromillones")
  });
});

app.get("/api/number-stats", async (req, res) => {
  const game = normalizeGame(req.query.game);
  if (!ES_GAMES.includes(game)) {
    return res.status(400).json({ error: "game requerido" });
  }

  await syncHistory(false);
  res.json({
    game,
    ...(await getNumberStats(game))
  });
});

app.get("/api/draws", async (req, res) => {
  const game = normalizeGame(req.query.game);
  if (!ES_GAMES.includes(game)) {
    return res.status(400).json({ error: "game requerido" });
  }

  await syncHistory(false);

  const { rows } = await query(
    `SELECT game, draw_date::text AS draw_date, numbers_json, stars_json, reintegro, complementary
       FROM es_draws
      WHERE game = $1 AND draw_date >= $2
      ORDER BY draw_date DESC
      LIMIT 100`,
    [game, currentWindowStartISO()]
  );

  const draws = rows.map((row) => ({
    game: row.game,
    draw_date: row.draw_date,
    numbers_json: JSON.stringify(row.numbers_json || []),
    stars_json: STAR_GAMES.includes(game) ? JSON.stringify(row.stars_json || []) : null,
    reintegro: SIX_NUMBER_GAMES.includes(game) ? row.reintegro ?? null : null,
    complementary: SIX_NUMBER_GAMES.includes(game) ? row.complementary ?? null : null
  }));

  res.json({ draws });
});

app.get("/api/prize-ranking", async (req, res) => {
  try {
    await syncHistory(true);
    await rebuildStatsFromDatabase();

    const requestedLimit = Number(req.query.limit || RANKING_RESPONSE_LIMIT);
    const responseLimit = clamp(requestedLimit, 1, 100);

    const { rows: generatedRows } = await query(`
      SELECT id, game, mode, numbers_json, stars_json, reintegro, created_at
      FROM es_generated
      ORDER BY created_at DESC
    `);

    const { rows: allDrawRows } = await query(`
      SELECT game, draw_date::text AS draw_date, numbers_json, stars_json, reintegro, complementary
      FROM es_draws
      WHERE draw_date >= $1
      ORDER BY draw_date ASC
    `, [currentWindowStartISO()]);

    const drawsByGame = { primitiva: [], euromillones: [] };
    for (const row of allDrawRows) {
      if (row.game === "primitiva" || row.game === "euromillones") {
        drawsByGame[row.game].push(row);
      }
    }

    const ranking = [];
    let combinationsWithFutureDraws = 0;
    let totalPendingFutureDraws = 0;
    let combinationsWithAnyHit = 0;
    let combinationsWithRealPrize = 0;
    let latestWinningDrawDate = null;

    for (const item of generatedRows) {
      const game = item.game;
      const createdAt = item.created_at;
      if (!createdAt || !["primitiva", "euromillones"].includes(game)) continue;

      const created = new Date(createdAt);

      const madridDate = new Intl.DateTimeFormat("sv-SE", {
        timeZone: "Europe/Madrid",
        year: "numeric",
        month: "2-digit",
        day: "2-digit"
      }).format(created);

      const madridTimeParts = new Intl.DateTimeFormat("en-GB", {
        timeZone: "Europe/Madrid",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false
      }).formatToParts(created);

      const createdHour = Number(madridTimeParts.find(p => p.type === "hour")?.value || 0);
      const createdMinute = Number(madridTimeParts.find(p => p.type === "minute")?.value || 0);

      const cutoffHour = 21;
      const cutoffMinute = 30;

      const futureRows = (drawsByGame[game] || []).filter((row) => {
        const drawDateStr = String(row.draw_date).slice(0, 10);
        const sameDay = drawDateStr === madridDate;

        if (sameDay) {
          return (
            createdHour < cutoffHour ||
            (createdHour === cutoffHour && createdMinute <= cutoffMinute)
          );
        }

        return drawDateStr > madridDate;
      });

      if (futureRows.length > 0) combinationsWithFutureDraws += 1;
      totalPendingFutureDraws += futureRows.length;

      const combo = buildDisplayCombination(item);
      const genNums = new Set(combo.numbers);
      const genStars = new Set(combo.stars);
      const genReintegro = combo.reintegro;

      let totalHits = 0;
      let realPrizes = 0;
      let bestResult = null;
      let bestScore = -1;
      let lastDrawDate = null;

      for (const row of futureRows) {
        const drawNumbers = Array.isArray(row.numbers_json) ? row.numbers_json.map(Number) : [];
        const drawStars = Array.isArray(row.stars_json) ? row.stars_json.map(Number) : [];
        const numMatches = drawNumbers.filter((n) => genNums.has(n)).length;

        if (game === "primitiva") {
          const reintegroHit =
            genReintegro !== null &&
            row.reintegro != null &&
            Number(row.reintegro) === genReintegro;
          const complementaryHit =
            row.complementary != null &&
            genNums.has(Number(row.complementary));

          const category = classifyPrimitiva(numMatches, complementaryHit, reintegroHit);

          if (category) {
            totalHits += 1;
            realPrizes += 1;

            const tierScore = getPrizeTierScore(game, category, numMatches, complementaryHit ? 1 : reintegroHit ? 1 : 0);
            if (tierScore > bestScore) {
              bestScore = tierScore;
              bestResult = {
                label: category,
                matches_main: numMatches,
                matches_extra: complementaryHit ? 1 : reintegroHit ? 1 : 0
              };
              lastDrawDate = row.draw_date;
            }
          }
        } else {
          const starMatches = drawStars.filter((s) => genStars.has(s)).length;
          const category = classifyEuromillones(numMatches, starMatches);

          if (category) {
            totalHits += 1;
            realPrizes += 1;

            const tierScore = getPrizeTierScore(game, category, numMatches, starMatches);
            if (tierScore > bestScore) {
              bestScore = tierScore;
              bestResult = {
                label: category,
                matches_main: numMatches,
                matches_extra: starMatches
              };
              lastDrawDate = row.draw_date;
            }
          }
        }
      }

      if (totalHits > 0) combinationsWithAnyHit += 1;
      if (realPrizes > 0) combinationsWithRealPrize += 1;
      if (lastDrawDate && (!latestWinningDrawDate || lastDrawDate > latestWinningDrawDate)) {
        latestWinningDrawDate = lastDrawDate;
      }

      if (realPrizes > 0) {
        ranking.push({
          id: item.id,
          created_at: item.created_at,
          game,
          mode: item.mode,
          numbers: combo.numbers,
          stars: combo.stars,
          reintegro: combo.reintegro,
          outcome_label: bestResult?.label || "Premio detectado",
          prize_amount: bestResult?.label || "Premio detectado",
          official_prize_category: bestResult?.label || "Premio detectado",
          real_prizes: realPrizes,
          total_hits: totalHits,
          times_given: totalHits,
          last_draw_date: lastDrawDate,
          pending_future_draws: futureRows.length
        });
      }
    }

    ranking.sort((a, b) => {
      if (b.real_prizes !== a.real_prizes) return b.real_prizes - a.real_prizes;
      if (b.total_hits !== a.total_hits) return b.total_hits - a.total_hits;
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });

    const evaluatedCombinations = generatedRows.length;
    const shownRanking = ranking.slice(0, responseLimit);

    res.json({
      ranking: shownRanking,
      evaluated_combinations: evaluatedCombinations,
      evaluated_count: evaluatedCombinations,
      total_evaluated: evaluatedCombinations,
      total_considered: evaluatedCombinations,
      total_generated_considered: evaluatedCombinations,
      total_generated_evaluated: evaluatedCombinations,
      total_generated: stats.total_generated,
      combinations_with_future_draws: combinationsWithFutureDraws,
      combinations_with_hits: combinationsWithAnyHit,
      combinations_with_real_prize: combinationsWithRealPrize,
      pending_future_draws: totalPendingFutureDraws,
      latest_winning_draw_date: latestWinningDrawDate,
      last_draw_date: latestWinningDrawDate || lastSyncAt || null,
      response_limit: responseLimit,
      methodology: "Solo aparecen combinaciones con premio real en sorteos posteriores a su generación"
    });
  } catch (error) {
    console.error("ranking error:", error);
    res.status(500).json({ error: "Error en ranking" });
  }
});

app.post("/api/generate", async (req, res) => {
  const game = normalizeGame(req.body?.game);
  const mode = String(req.body?.mode || "Al azar");

  try {
    const generated = await generateCombination(game, mode);

    if (!generated) {
      return res.status(400).json({ error: "Juego no válido" });
    }

    try { await syncHistory(false); } catch (syncErr) {
      console.error("syncHistory error (ES):", syncErr.message);
    }

    let analysis;
    try {
      analysis = await buildAnalysis(game, generated);
    } catch (analysisErr) {
      console.error("buildAnalysis error (ES):", analysisErr.message);
      analysis = { eq: 75, statScore: 70, historicalSimulation: { window_years: 0, draws_analyzed: 0, winning_draws: 0, breakdown: [], latest_hits: [] }, reasons: [] };
    }

    try {
      registerStats(game, analysis.historicalSimulation);
      await registerGeneratedCombination(game, mode, generated, analysis);
      await saveGeneratedCache();
    } catch (dbErr) {
      console.error("DB write error (ES):", dbErr.message);
    }

    res.json({
      generated: {
        ...generated,
        eq: analysis.eq,
        statScore: analysis.statScore,
        historicalSimulation: analysis.historicalSimulation,
        reasons: analysis.reasons
      }
    });
  } catch (err) {
    console.error("generate error (ES):", err);
    // Fallback: return a random combination so the user always gets numbers
    const cfg = SIX_NUMBER_GAMES.includes(game)
      ? { numbers: 6, min: 1, max: 49 }
      : STAR_GAMES.includes(game)
      ? { numbers: 5, min: 1, max: 50, stars: 2, starMax: 12 }
      : null;
    if (!cfg) return res.status(400).json({ error: "Juego no válido" });
    const nums = uniqueRandoms(cfg.numbers, cfg.min, cfg.max);
    const stars = cfg.stars ? uniqueRandoms(cfg.stars, 1, cfg.starMax) : [];
    const reintegro = SIX_NUMBER_GAMES.includes(game) ? Math.floor(Math.random() * 10) : null;
    res.json({
      generated: {
        numbers: nums, stars, reintegro,
        eq: 75, statScore: 70,
        historicalSimulation: { window_years: 0, draws_analyzed: 0, winning_draws: 0, breakdown: [], latest_hits: [] },
        reasons: ["Combinación generada aleatoriamente (modo emergencia)"],
        _fallback: true
      }
    });
  }
});

app.post("/api/generate-smart", async (req, res) => {
  const game = normalizeGame(req.body?.game);
  const mode = String(req.body?.mode || "Radar Loto IA");

  try {
    const generated = await generateCombination(game, mode === "radar_ai" ? "Radar Loto IA" : mode);

    if (!generated) return res.status(400).json({ error: "Juego no válido" });

    try { await syncHistory(false); } catch (syncErr) {
      console.error("syncHistory error (ES smart):", syncErr.message);
    }

    let analysis;
    try {
      analysis = await buildAnalysis(game, generated);
    } catch (analysisErr) {
      console.error("buildAnalysis error (ES smart):", analysisErr.message);
      analysis = { eq: 75, statScore: 70, historicalSimulation: { window_years: 0, draws_analyzed: 0, winning_draws: 0, breakdown: [], latest_hits: [] }, reasons: [] };
    }

    try {
      registerStats(game, analysis.historicalSimulation);
      await registerGeneratedCombination(game, mode, generated, analysis);
      await saveGeneratedCache();
    } catch (dbErr) {
      console.error("DB write error (ES smart):", dbErr.message);
    }

    res.json({
      result: {
        ...generated,
        mode: mode === "radar_ai" ? "Radar Loto IA" : mode,
        eq: analysis.eq,
        statScore: analysis.statScore,
        historicalSimulation: analysis.historicalSimulation,
        reasons: analysis.reasons
      }
    });
  } catch (err) {
    console.error("generate-smart error (ES):", err);
    const cfg = SIX_NUMBER_GAMES.includes(game)
      ? { numbers: 6, min: 1, max: 49 }
      : STAR_GAMES.includes(game)
      ? { numbers: 5, min: 1, max: 50, stars: 2, starMax: 12 }
      : null;
    if (!cfg) return res.status(400).json({ error: "Juego no válido" });
    const nums = uniqueRandoms(cfg.numbers, cfg.min, cfg.max);
    const stars = cfg.stars ? uniqueRandoms(cfg.stars, 1, cfg.starMax) : [];
    const reintegro = SIX_NUMBER_GAMES.includes(game) ? Math.floor(Math.random() * 10) : null;
    res.json({
      result: {
        numbers: nums, stars, reintegro,
        mode: mode === "radar_ai" ? "Radar Loto IA" : mode,
        eq: 75, statScore: 70,
        historicalSimulation: { window_years: 0, draws_analyzed: 0, winning_draws: 0, breakdown: [], latest_hits: [] },
        reasons: ["Combinación generada aleatoriamente (modo emergencia)"],
        _fallback: true
      }
    });
  }
});

app.get("*", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

async function start() {
  await query("SELECT 1");
  await ensureDb();
  await loadGeneratedCache();
  await rebuildStatsFromDatabase();
  await saveGeneratedCache();

  syncHistory(true).catch((err) => {
    logSync(`Error en sincronización inicial ES: ${err.message}`);
  });

  startAutoSync();

  app.listen(PORT, () => {
    console.log(`Radar Loto ES DB backend iniciado en puerto ${PORT}`);
  });
}

start().catch((err) => {
  console.error("No se pudo iniciar el backend ES DB:", err);
  process.exit(1);
});
