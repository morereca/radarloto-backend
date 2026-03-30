import express from "express";
import cors from "cors";
import path from "path";
import pkg from "pg";
import { fileURLToPath } from "url";

const { Pool } = pkg;
const app = express();

app.use(cors());
app.use(express.json({ limit: "1mb" }));
app.use((req, res, next) => {
  res.set("Cache-Control", "no-store");
  next();
});


// ===== REDIRECCIONES SEO ROBUSTAS =====
// Middleware único para redirecciones, antes de express.static y antes de cualquier catch-all.
const REDIRECT_MAP = {
  // ES
  "/numeros-menos-frecuentes-euromillones.html": "/numeros-frios-euromillones.html",
  "/numeros-menos-frecuentes-primitiva.html": "/numeros-frios-primitiva.html",
  "/numeros-mas-frecuentes-euromillones.html": "/numeros-que-mas-salen-euromillones.html",
  "/numeros-mas-frecuentes-primitiva.html": "/numeros-que-mas-salen-primitiva.html",

  // USA stats
  "/powerball-stats.html": "/powerball-statistics.html",
  "/estadisticas-powerball.html": "/powerball-statistics.html",
  "/mega-stats.html": "/mega-statistics.html",
  "/estadisticas-megamillions.html": "/mega-statistics.html",

  // USA hot
  "/numeros-que-mas-salen-powerball.html": "/powerball-hot-numbers.html",
  "/numeros-que-mas-salen-megamillions.html": "/mega-hot-numbers.html"
};

app.use((req, res, next) => {
  const rawPath = (req.path || "").replace(/\/+$/, "") || "/";
  const target = REDIRECT_MAP[rawPath];
  if (target) {
    return res.redirect(301, target);
  }
  return next();
});


const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.use(express.static(path.join(__dirname, "public")));

const PORT = Number(process.env.PORT || 3000);
const YEARS_BACK = Number(process.env.YEARS_BACK || 10);
const SYNC_MAX_AGE_HOURS = Number(process.env.SYNC_MAX_AGE_HOURS || 18);
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
  euromillones: process.env.EUROMILLONES_CSV_URL || "https://docs.google.com/spreadsheets/d/e/2PACX-1vRy91wfK2JteoMi1ZOhGm0D1RKJfDTbEOj6rfnrB6-X7n2Q1nfFwBZBpcivHRdg3pSwxSQgLA3KpW7v/pub?output=csv"
};

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

  try {
    await query(`
      ALTER TABLE es_draws
      ADD CONSTRAINT unique_es_game_date UNIQUE (game, draw_date)
    `);
    console.log("UNIQUE de es_draws creado");
  } catch (err) {
    console.log("UNIQUE ya existe o no se pudo crear:", err.message);
  }

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

  if (game === "primitiva") {
    if (numberTokens.length < 6) return null;
    const numbers = numberTokens.slice(0, 6).sort((a, b) => a - b);
    const extra = numberTokens.slice(6);

    const complementary = extra.find((n) => !numbers.includes(n)) ?? null;
    const reintegro = extra.length ? extra[extra.length - 1] : null;

    return {
      game: "primitiva",
      drawDate: date.iso,
      numbers,
      stars: [],
      reintegro: Number.isFinite(reintegro) ? reintegro : null,
      complementary: Number.isFinite(complementary) ? complementary : null,
      source: "csv_primitiva"
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
    if (game === "euromillones") {
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

  if (game === "euromillones") {
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

  if (mode === "Números calientes") {
    const weights = new Map(pool.map((n) => [n, (numFreq.get(n) || 1) + 1]));
    numbers = weightedPick(pool, weights, cfg.numbers);
    if (game === "euromillones") {
      const sWeights = new Map(starPool.map((n) => [n, (starFreq.get(n) || 1) + 1]));
      stars = weightedPick(starPool, sWeights, cfg.stars);
    }
  } else if (mode === "Números fríos") {
    const weights = new Map(pool.map((n) => [n, (numCold.get(n) || 1) + 1]));
    numbers = weightedPick(pool, weights, cfg.numbers);
    if (game === "euromillones") {
      const sWeights = new Map(starPool.map((n) => [n, (starCold.get(n) || 1) + 1]));
      stars = weightedPick(starPool, sWeights, cfg.stars);
    }
  } else {
    numbers = uniqueRandoms(cfg.numbers, cfg.min, cfg.max);
    if (game === "euromillones") stars = uniqueRandoms(cfg.stars, 1, cfg.starMax);
  }

  if (game === "primitiva") reintegro = Math.floor(Math.random() * 10);
  return { numbers, stars, reintegro };
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
  const idealOdd = game === "primitiva" ? 3 : 2;
  return clamp((game === "primitiva" ? 84 : 82) - Math.abs(idealOdd - odd) * 8, 20, 98);
}

function calcStatQuality(game, numbers) {
  const sorted = [...numbers].sort((a, b) => a - b);
  const sum = sorted.reduce((a, b) => a + b, 0);
  const odd = sorted.filter((n) => n % 2 === 1).length;
  const low = sorted.filter((n) => n <= (game === "primitiva" ? 24 : 25)).length;
  const consecutive = countConsecutive(sorted);
  const endingRepeat = maxEndingRepeat(sorted);

  let score = 78;
  score -= Math.abs((game === "primitiva" ? 3 : 2) - odd) * 7;
  score -= Math.abs(Math.ceil(sorted.length / 2) - low) * 6;
  score -= consecutive * 10;
  score -= Math.max(0, endingRepeat - 2) * 9;

  const minSum = game === "primitiva" ? 90 : 80;
  const maxSum = game === "primitiva" ? 190 : 180;
  if (sum < minSum || sum > maxSum) score -= 12;

  return clamp(score, 10, 96);
}

function classifyPrimitiva(matches, complementaryHit, reintegroHit) {
  if (matches === 6 && reintegroHit) return "Especial (6 + R)";
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

async function simulateHistorical(game, generated) {
  const draws = await getAllDrawRows(game);
  const genNums = new Set(generated.numbers);
  const genStars = new Set(generated.stars || []);
  const breakdownMap = {};
  const hitSamples = [];
  let winningDraws = 0;

  for (const draw of draws) {
    const numMatches = draw.numbers.filter((n) => genNums.has(n)).length;

    if (game === "primitiva") {
      const complementaryHit = draw.complementary != null && genNums.has(draw.complementary);
      const reintegroHit = draw.reintegro != null && Number(draw.reintegro) === Number(generated.reintegro);
      const category = classifyPrimitiva(numMatches, complementaryHit, reintegroHit);
      if (category) {
        winningDraws += 1;
        breakdownMap[category] = (breakdownMap[category] || 0) + 1;
        hitSamples.unshift({ date: draw.drawDate, category, summary: `${numMatches} aciertos${complementaryHit ? " + C" : ""}${reintegroHit ? " + R" : ""}` });
      }
    } else {
      const starMatches = (draw.stars || []).filter((s) => genStars.has(s)).length;
      const category = classifyEuromillones(numMatches, starMatches);
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

  const hotExtra = game === "euromillones"
    ? [...starFreq.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0]).map(([number, count]) => ({ number, count }))
    : [];

  const coldExtra = game === "euromillones"
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
    extra_counts: game === "euromillones" ? mapCounts(starFreq) : {}
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
  await syncHistory(true);
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
  if (!["primitiva", "euromillones"].includes(game)) {
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
  if (!["primitiva", "euromillones"].includes(game)) {
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
    stars_json: game === "euromillones" ? JSON.stringify(row.stars_json || []) : null,
    reintegro: game === "primitiva" ? row.reintegro ?? null : null,
    complementary: game === "primitiva" ? row.complementary ?? null : null
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

      const createdDate = String(createdAt).slice(0, 10);
      const futureRows = (drawsByGame[game] || []).filter((row) => row.draw_date > createdDate);

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
            if (numMatches >= 4) realPrizes += 1;

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
            if (numMatches >= 4 || (numMatches === 3 && starMatches >= 2)) realPrizes += 1;

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
  const generated = await generateCombination(game, mode);

  if (!generated) {
    return res.status(400).json({ error: "Juego no válido" });
  }

  await syncHistory(false);
  const analysis = await buildAnalysis(game, generated);

  registerStats(game, analysis.historicalSimulation);
  await registerGeneratedCombination(game, mode, generated, analysis);
  await saveGeneratedCache();

  res.json({
    generated: {
      ...generated,
      eq: analysis.eq,
      statScore: analysis.statScore,
      historicalSimulation: analysis.historicalSimulation,
      reasons: analysis.reasons
    }
  });
});

app.post("/api/generate-smart", async (req, res) => {
  const game = normalizeGame(req.body?.game);
  const mode = String(req.body?.mode || "Radar Loto IA");
  const generated = await generateCombination(game, mode === "radar_ai" ? "Radar Loto IA" : mode);

  if (!generated) return res.status(400).json({ error: "Juego no válido" });

  await syncHistory(false);
  const analysis = await buildAnalysis(game, generated);

  registerStats(game, analysis.historicalSimulation);
  await registerGeneratedCombination(game, mode, generated, analysis);
  await saveGeneratedCache();

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

  syncHistory(false).catch((err) => {
    logSync(`Error en sincronización inicial ES: ${err.message}`);
  });

  app.listen(PORT, () => {
    console.log(`Radar Loto ES DB backend iniciado en puerto ${PORT}`);
  });
}

start().catch((err) => {
  console.error("No se pudo iniciar el backend ES DB:", err);
  process.exit(1);
});
