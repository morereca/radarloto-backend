import express from "express";
import cors from "cors";
import pkg from "pg";

const { Pool } = pkg;
const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));

const PORT = Number(process.env.PORT || 3001);
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

const FEED_URLS = {
  powerball: {
    latest: process.env.POWERBALL_LATEST_URL || "https://www.powerball.com/draw-result?oc=tx",
    historyCsv: process.env.POWERBALL_HISTORY_CSV_URL || "https://www.texaslottery.com/export/sites/lottery/Games/Powerball/Winning_Numbers/powerball.csv"
  },
  megamillions: {
    latest: process.env.MEGAMILLIONS_LATEST_URL || "https://www.megamillions.com/winning-numbers.aspx",
    historyCsv: process.env.MEGAMILLIONS_HISTORY_CSV_URL || "https://www.texaslottery.com/export/sites/lottery/Games/Mega_Millions/Winning_Numbers/megamillions.csv"
  }
};

const stats = {
  total_generated: 0,
  powerball_generated: 0,
  megamillions_generated: 0,
  won_count: 0
};
const generatedRanking = [];

let syncPromise = null;
let lastSyncAt = null;
const syncLog = [];

function logSync(message) {
  const line = `${new Date().toISOString()} ${message}`;
  syncLog.unshift(line);
  if (syncLog.length > 120) syncLog.length = 120;
  console.log(line);
}

function normalizeGame(value) {
  return String(value || "").trim().toLowerCase();
}

function gameConfig(game) {
  if (game === "powerball") return { numbers: 5, min: 1, max: 69, stars: 1, starMax: 26 };
  if (game === "megamillions") return { numbers: 5, min: 1, max: 70, stars: 1, starMax: 25 };
  return null;
}

function currentWindowStartISO() {
  const now = new Date();
  const start = new Date(now);
  start.setUTCFullYear(start.getUTCFullYear() - YEARS_BACK);
  return start.toISOString().slice(0, 10);
}

function inHistoryWindow(drawDate) {
  return String(drawDate || "") >= currentWindowStartISO();
}

async function query(sql, params = []) {
  return pool.query(sql, params);
}

async function ensureDb() {
  await query(`
    CREATE TABLE IF NOT EXISTS usa_draws (
      id BIGSERIAL PRIMARY KEY,
      game TEXT NOT NULL,
      draw_date DATE NOT NULL,
      numbers_json JSONB NOT NULL DEFAULT '[]'::jsonb,
      stars_json JSONB NOT NULL DEFAULT '[]'::jsonb,
      multiplier TEXT,
      jackpot TEXT,
      cash_value TEXT,
      source TEXT,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);

  try {
    await query(`
      ALTER TABLE usa_draws
      ADD CONSTRAINT unique_game_date UNIQUE (game, draw_date)
    `);
    console.log("UNIQUE creado correctamente");
  } catch (err) {
    console.log("UNIQUE ya existe o no se pudo crear:", err.message);
  }

  await query(`
    CREATE INDEX IF NOT EXISTS idx_usa_draws_game_date
    ON usa_draws (game, draw_date DESC)
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS usa_generated_cache (
      id BIGSERIAL PRIMARY KEY,
      cache_key TEXT NOT NULL UNIQUE,
      payload JSONB NOT NULL,
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);
}

async function fetchText(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 25000);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        "user-agent": "Mozilla/5.0 (compatible; RadarLotoUSABot/1.0; +https://radarloto.com)",
        "accept": "text/html,text/plain;q=0.9,*/*;q=0.8",
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

function parseCsvLine(line) {
  const out = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (ch === ',' && !inQuotes) {
      out.push(cur.trim());
      cur = "";
      continue;
    }
    cur += ch;
  }
  out.push(cur.trim());
  return out;
}

function parseTexasDateParts(month, day, year) {
  return `${String(year)}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function dedupeRows(rows) {
  const seen = new Set();
  return rows.filter((row) => {
    const key = `${row.game}|${row.drawDate}|${row.numbers.join("-")}|${(row.stars || []).join("-")}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function parsePowerballCsv(csvText) {
  const rows = [];
  const lines = String(csvText || "").split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
  for (const line of lines) {
    if (/^Game Name,/i.test(line)) continue;
    if (!/^Powerball/i.test(line)) continue;
    const cols = parseCsvLine(line);
    if (cols.length < 10) continue;
    const month = Number(cols[1]);
    const day = Number(cols[2]);
    const year = Number(cols[3]);
    const nums = cols.slice(4, 9).map(Number).filter(Number.isFinite).sort((a, b) => a - b);
    const bonus = Number(cols[9]);
    const powerPlay = cols[10] ? String(cols[10]).replace(/\s+/g, "") : null;
    if (nums.length !== 5 || !Number.isFinite(bonus)) continue;
    rows.push({
      game: "powerball",
      drawDate: parseTexasDateParts(month, day, year),
      numbers: nums,
      stars: [bonus],
      multiplier: powerPlay || null,
      jackpot: null,
      cashValue: null,
      source: "texas_lottery_csv"
    });
  }
  return dedupeRows(rows);
}

function parseMegaMillionsCsv(csvText) {
  const rows = [];
  const lines = String(csvText || "").split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
  for (const line of lines) {
    if (/^Game Name,/i.test(line)) continue;
    if (!/^Mega Millions/i.test(line)) continue;
    const cols = parseCsvLine(line);
    if (cols.length < 10) continue;
    const month = Number(cols[1]);
    const day = Number(cols[2]);
    const year = Number(cols[3]);
    const nums = cols.slice(4, 9).map(Number).filter(Number.isFinite).sort((a, b) => a - b);
    const bonus = Number(cols[9]);
    const megaplier = cols[10] ? String(cols[10]).replace(/\s+/g, "") : null;
    if (nums.length !== 5 || !Number.isFinite(bonus)) continue;
    rows.push({
      game: "megamillions",
      drawDate: parseTexasDateParts(month, day, year),
      numbers: nums,
      stars: [bonus],
      multiplier: megaplier && megaplier !== "N/A" ? megaplier : null,
      jackpot: null,
      cashValue: null,
      source: "texas_lottery_csv"
    });
  }
  return dedupeRows(rows);
}

function stripHtml(html) {
  return String(html || "")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<\/?(?:div|p|br|li|tr|td|th|section|article|header|footer|h1|h2|h3|h4|h5|h6)\b[^>]*>/gi, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&#160;/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const MONTHS = {
  jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
  jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12"
};

function parsePowerballDate(value) {
  const m = String(value || "").match(/(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun),\s+([A-Za-z]{3})\s+(\d{1,2}),\s+(\d{4})/);
  if (!m) return null;
  const month = MONTHS[m[1].slice(0, 3).toLowerCase()];
  if (!month) return null;
  return `${m[3]}-${month}-${String(m[2]).padStart(2, "0")}`;
}

function parseMegaDate(month, day, year = null) {
  const now = new Date();
  const y = year || now.getUTCFullYear();
  return `${String(y)}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function parsePowerballLatest(html) {
  const text = stripHtml(html);
  const dateMatch = text.match(/Winning Numbers\s+(Mon|Tue|Wed|Thu|Fri|Sat|Sun),\s+[A-Za-z]{3}\s+\d{1,2},\s+\d{4}/);
  const dateIso = dateMatch ? parsePowerballDate(dateMatch[0].replace(/^Winning Numbers\s+/, "")) : null;
  const fullMatch = text.match(/Winning Numbers\s+(Mon|Tue|Wed|Thu|Fri|Sat|Sun),\s+[A-Za-z]{3}\s+\d{1,2},\s+\d{4}\s+(\d{1,2})\s+(\d{1,2})\s+(\d{1,2})\s+(\d{1,2})\s+(\d{1,2})\s+(\d{1,2})(?:\s+Power Play\s+([0-9Xx]+))?/);
  if (!fullMatch || !dateIso) return null;
  return {
    game: "powerball",
    drawDate: dateIso,
    numbers: [fullMatch[2], fullMatch[3], fullMatch[4], fullMatch[5], fullMatch[6]].map(Number).sort((a, b) => a - b),
    stars: [Number(fullMatch[7])],
    multiplier: fullMatch[8] || null,
    jackpot: (text.match(/Estimated Jackpot:\s+\$[0-9.,]+\s*(?:Million|Billion)?/i) || [null])[0]?.replace(/Estimated Jackpot:\s*/i, "") || null,
    cashValue: (text.match(/Cash Value:\s+\$[0-9.,]+\s*(?:Million|Billion)?/i) || [null])[0]?.replace(/Cash Value:\s*/i, "") || null,
    source: "powerball_latest_html"
  };
}

function parseMegaLatest(html) {
  const text = stripHtml(html);
  const m = text.match(/DRAWING DATE:\s*(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)\.,?\s*(\d{1,2})\/(\d{1,2})\.\s*(\d{1,2});\s*(\d{1,2});\s*(\d{1,2});\s*(\d{1,2});\s*(\d{1,2});\s*(\d{1,2})(?:;\s*(\d{1,2})X)?/i);
  if (!m) return null;
  return {
    game: "megamillions",
    drawDate: parseMegaDate(m[1], m[2]),
    numbers: [m[3], m[4], m[5], m[6], m[7]].map(Number).sort((a, b) => a - b),
    stars: [Number(m[8])],
    multiplier: m[9] ? `${m[9]}X` : null,
    jackpot: (text.match(/Estimated Jackpot:\s+\$[0-9.,]+\s*(?:Million|Billion)?/i) || [null])[0]?.replace(/Estimated Jackpot:\s*/i, "") || null,
    cashValue: (text.match(/Cash Option:\s+\$[0-9.,]+\s*(?:Million|Billion)?/i) || [null])[0]?.replace(/Cash Option:\s*/i, "") || null,
    source: "megamillions_latest_html"
  };
}

async function upsertDraw(draw) {
  if (!draw || !inHistoryWindow(draw.drawDate)) return;
  await query(
    `INSERT INTO usa_draws (game, draw_date, numbers_json, stars_json, multiplier, jackpot, cash_value, source)
     VALUES ($1,$2,$3::jsonb,$4::jsonb,$5,$6,$7,$8)
     ON CONFLICT (game, draw_date)
     DO UPDATE SET
       numbers_json = EXCLUDED.numbers_json,
       stars_json = EXCLUDED.stars_json,
       multiplier = EXCLUDED.multiplier,
       jackpot = COALESCE(EXCLUDED.jackpot, usa_draws.jackpot),
       cash_value = COALESCE(EXCLUDED.cash_value, usa_draws.cash_value),
       source = EXCLUDED.source,
       updated_at = NOW()`,
    [
      draw.game,
      draw.drawDate,
      JSON.stringify(draw.numbers || []),
      JSON.stringify(draw.stars || []),
      draw.multiplier ?? null,
      draw.jackpot ?? null,
      draw.cashValue ?? null,
      draw.source ?? null
    ]
  );
}

async function importInitialHistory() {
  logSync("Inicio importación histórica USA a PostgreSQL");
  const pCsv = await fetchText(FEED_URLS.powerball.historyCsv);
  const pRows = parsePowerballCsv(pCsv).filter((d) => inHistoryWindow(d.drawDate));
  for (const row of pRows) await upsertDraw(row);
  logSync(`powerball: ${pRows.length} sorteos importados`);

  const mCsv = await fetchText(FEED_URLS.megamillions.historyCsv);
  const mRows = parseMegaMillionsCsv(mCsv).filter((d) => inHistoryWindow(d.drawDate));
  for (const row of mRows) await upsertDraw(row);
  logSync(`megamillions: ${mRows.length} sorteos importados`);

  lastSyncAt = new Date().toISOString();
  logSync("Importación histórica USA completada");
}

async function refreshIncremental() {
  try {
    const pHtml = await fetchText(FEED_URLS.powerball.latest);
    const pLatest = parsePowerballLatest(pHtml);
    if (pLatest) await upsertDraw(pLatest);
  } catch (err) {
    logSync(`Error latest powerball: ${err.message}`);
  }
  try {
    const mHtml = await fetchText(FEED_URLS.megamillions.latest);
    const mLatest = parseMegaLatest(mHtml);
    if (mLatest) await upsertDraw(mLatest);
  } catch (err) {
    logSync(`Error latest megamillions: ${err.message}`);
  }
  lastSyncAt = new Date().toISOString();
}

function shouldSyncNow(force = false) {
  if (force) return true;
  if (!lastSyncAt) return true;
  const last = new Date(lastSyncAt).getTime();
  return Date.now() - last > SYNC_MAX_AGE_HOURS * 60 * 60 * 1000;
}

async function syncHistory(force = false) {
  if (!shouldSyncNow(force)) return;
  if (syncPromise) return syncPromise;
  syncPromise = (async () => {
    const countRes = await query("SELECT COUNT(*)::int AS count FROM usa_draws WHERE draw_date >= $1", [currentWindowStartISO()]);
    const total = countRes.rows[0]?.count || 0;
    if (total === 0 || force) {
      await importInitialHistory();
    }
    await refreshIncremental();
  })();
  try {
    await syncPromise;
  } finally {
    syncPromise = null;
  }
}

async function getCoverage(game) {
  const { rows } = await query(
    `SELECT COUNT(*)::int AS total_draws, MIN(draw_date)::text AS first_draw_date, MAX(draw_date)::text AS last_draw_date
       FROM usa_draws WHERE game = $1 AND draw_date >= $2`,
    [game, currentWindowStartISO()]
  );
  const r = rows[0] || {};
  return {
    total_draws: r.total_draws || 0,
    draws_analyzed: r.total_draws || 0,
    first_draw_date: r.first_draw_date || null,
    last_draw_date: r.last_draw_date || null,
    years_back: YEARS_BACK
  };
}

async function getLatest(game) {
  const { rows } = await query(
    `SELECT game, draw_date::text AS draw_date, numbers_json, stars_json, multiplier, jackpot, cash_value
       FROM usa_draws WHERE game = $1 AND draw_date >= $2 ORDER BY draw_date DESC LIMIT 1`,
    [game, currentWindowStartISO()]
  );
  const row = rows[0];
  if (!row) return null;
  return {
    game: row.game,
    drawDate: row.draw_date,
    numbers: row.numbers_json,
    stars: row.stars_json,
    multiplier: row.multiplier,
    jackpot: row.jackpot,
    cashValue: row.cash_value
  };
}

async function getDraws(game, limit = 150) {
  const { rows } = await query(
    `SELECT game, draw_date::text AS draw_date, numbers_json, stars_json, multiplier, jackpot, cash_value
       FROM usa_draws
      WHERE game = $1 AND draw_date >= $2
      ORDER BY draw_date DESC
      LIMIT $3`,
    [game, currentWindowStartISO(), limit]
  );
  return rows.map((row) => ({
    game: row.game,
    draw_date: row.draw_date,
    numbers_json: JSON.stringify(row.numbers_json || []),
    stars_json: JSON.stringify(row.stars_json || []),
    multiplier: row.multiplier ?? null,
    jackpot: row.jackpot ?? null,
    cash_value: row.cash_value ?? null
  }));
}

async function getAllDrawRows(game) {
  const { rows } = await query(
    `SELECT draw_date::text AS draw_date, numbers_json, stars_json
       FROM usa_draws
      WHERE game = $1 AND draw_date >= $2
      ORDER BY draw_date ASC`,
    [game, currentWindowStartISO()]
  );
  return rows.map((r) => ({
    drawDate: r.draw_date,
    numbers: Array.isArray(r.numbers_json) ? r.numbers_json.map(Number).sort((a, b) => a - b) : [],
    stars: Array.isArray(r.stars_json) ? r.stars_json.map(Number).sort((a, b) => a - b) : []
  }));
}

function mapCounts(countMap) {
  return Object.fromEntries([...countMap.entries()].sort((a, b) => Number(a[0]) - Number(b[0])));
}

async function getNumberStats(game) {
  const cfg = gameConfig(game);
  const draws = await getAllDrawRows(game);
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
    for (const s of draw.stars || []) {
      starFreq.set(s, (starFreq.get(s) || 0) + 1);
      starLastSeen.set(s, i);
    }
  }

  const lastIndex = Math.max(0, draws.length - 1);
  const coldMain = [];
  for (let n = cfg.min; n <= cfg.max; n += 1) {
    const seenAt = lastSeen.has(n) ? lastSeen.get(n) : -9999;
    coldMain.push({ number: n, gap: lastIndex - seenAt, count: numFreq.get(n) || 0 });
  }
  coldMain.sort((a, b) => b.gap - a.gap || a.number - b.number);

  const hotMain = [...numFreq.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0]).map(([number, count]) => ({ number, count }));

  const hotExtra = Array.from({ length: cfg.starMax }, (_, i) => i + 1)
    .map((number) => ({ number, count: starFreq.get(number) || 0 }))
    .sort((a, b) => b.count - a.count || a.number - b.number);

  const coldExtra = Array.from({ length: cfg.starMax }, (_, i) => i + 1)
    .map((number) => {
      const seenAt = starLastSeen.has(number) ? starLastSeen.get(number) : -9999;
      return { number, gap: lastIndex - seenAt, count: starFreq.get(number) || 0 };
    })
    .sort((a, b) => b.gap - a.gap || a.number - b.number);

  return {
    coverage: await getCoverage(game),
    hot_numbers: hotMain.slice(0, 12),
    cold_numbers: coldMain.slice(0, 12),
    hot_extra: hotExtra.slice(0, 6),
    cold_extra: coldExtra.slice(0, 6),
    main_counts: mapCounts(numFreq),
    extra_counts: mapCounts(starFreq)
  };
}


async function loadGeneratedCache() {
  const { rows } = await query(
    `SELECT payload FROM usa_generated_cache WHERE cache_key = 'generated_cache' LIMIT 1`
  );
  const payload = rows[0]?.payload;
  if (!payload) return;

  if (payload.stats) {
    stats.total_generated = Number(payload.stats.total_generated || 0);
    stats.powerball_generated = Number(payload.stats.powerball_generated || 0);
    stats.megamillions_generated = Number(payload.stats.megamillions_generated || 0);
    stats.won_count = Number(payload.stats.won_count || 0);
  }

  if (Array.isArray(payload.ranking)) {
    generatedRanking.splice(0, generatedRanking.length, ...payload.ranking.slice(0, 10));
  }

  if (payload.last_sync_at) lastSyncAt = payload.last_sync_at;
  if (Array.isArray(payload.sync_log) && payload.sync_log.length) {
    syncLog.splice(0, syncLog.length, ...payload.sync_log.slice(0, 120));
  }
}

async function saveGeneratedCache() {
  const payload = {
    stats,
    ranking: generatedRanking.slice(0, 10),
    last_sync_at: lastSyncAt,
    sync_log: syncLog.slice(0, 120)
  };

  await query(
    `INSERT INTO usa_generated_cache (cache_key, payload, updated_at)
     VALUES ('generated_cache', $1::jsonb, NOW())
     ON CONFLICT (cache_key)
     DO UPDATE SET payload = EXCLUDED.payload, updated_at = NOW()`,
    [JSON.stringify(payload)]
  );
}

function uniqueRandoms(count, min, max) {
  const arr = [];
  while (arr.length < count) {
    const n = Math.floor(Math.random() * (max - min + 1)) + min;
    if (!arr.includes(n)) arr.push(n);
  }
  return arr.sort((a, b) => a - b);
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

function calcEquilibrium(numbers) {
  const odd = numbers.filter((n) => n % 2 === 1).length;
  const idealOdd = 2;
  return Math.max(20, Math.min(98, 82 - Math.abs(idealOdd - odd) * 8));
}

function calcStatQuality(game, numbers) {
  const cfg = gameConfig(game);
  const sorted = [...numbers].sort((a, b) => a - b);
  const sum = sorted.reduce((a, b) => a + b, 0);
  const odd = sorted.filter((n) => n % 2 === 1).length;
  const low = sorted.filter((n) => n <= Math.floor(cfg.max / 2)).length;
  const consecutive = countConsecutive(sorted);
  const endingRepeat = maxEndingRepeat(sorted);

  let score = 78;
  score -= Math.abs(2 - odd) * 7;
  score -= Math.abs(Math.ceil(sorted.length / 2) - low) * 6;
  score -= consecutive * 10;
  score -= Math.max(0, endingRepeat - 2) * 9;
  if (sum < 90 || sum > 240) score -= 12;

  return Math.max(10, Math.min(96, score));
}

function classifyPowerball(numMatches, starMatches) {
  const table = {
    "5+1": "Jackpot (5 + Powerball)",
    "5+0": "Match 5",
    "4+1": "4 + Powerball",
    "4+0": "4",
    "3+1": "3 + Powerball",
    "3+0": "3",
    "2+1": "2 + Powerball",
    "1+1": "1 + Powerball",
    "0+1": "Powerball only"
  };
  return table[`${numMatches}+${starMatches}`] || null;
}

function classifyMegaMillions(numMatches, starMatches) {
  const table = {
    "5+1": "Jackpot (5 + Mega Ball)",
    "5+0": "Match 5",
    "4+1": "4 + Mega Ball",
    "4+0": "4",
    "3+1": "3 + Mega Ball",
    "3+0": "3",
    "2+1": "2 + Mega Ball",
    "1+1": "1 + Mega Ball",
    "0+1": "Mega Ball only"
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
    const starMatches = (draw.stars || []).filter((s) => genStars.has(s)).length;
    const category = game === "powerball"
      ? classifyPowerball(numMatches, starMatches)
      : classifyMegaMillions(numMatches, starMatches);

    if (category) {
      winningDraws += 1;
      breakdownMap[category] = (breakdownMap[category] || 0) + 1;
      hitSamples.unshift({ date: draw.drawDate, category, summary: `${numMatches} numbers + ${starMatches} bonus ball` });
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
  const equilibrium = calcEquilibrium(generated.numbers);
  const statQuality = calcStatQuality(game, generated.numbers);
  const historicalSimulation = await simulateHistorical(game, generated);
  return {
    eq: equilibrium,
    statScore: statQuality,
    historicalSimulation,
    reasons: [
      `Balance: ${equilibrium} / 100`,
      `Statistical quality: ${statQuality} / 100`,
      `Historical simulation (${historicalSimulation.window_years} years): ${historicalSimulation.winning_draws} prize draws`
    ]
  };
}

async function generateCombination(game, mode = "Random") {
  const cfg = gameConfig(game);
  if (!cfg) return null;

  const draws = await getAllDrawRows(game);
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
    for (const s of draw.stars || []) {
      starFreq.set(s, (starFreq.get(s) || 0) + 1);
      starLastSeen.set(s, i);
    }
  }

  const numCold = new Map();
  const starCold = new Map();
  const lastIndex = Math.max(0, draws.length - 1);

  for (let n = cfg.min; n <= cfg.max; n += 1) {
    const seenAt = lastSeen.has(n) ? lastSeen.get(n) : -9999;
    numCold.set(n, lastIndex - seenAt);
  }
  for (let s = 1; s <= cfg.starMax; s += 1) {
    const seenAt = starLastSeen.has(s) ? starLastSeen.get(s) : -9999;
    starCold.set(s, lastIndex - seenAt);
  }

  const pool = Array.from({ length: cfg.max - cfg.min + 1 }, (_, i) => i + cfg.min);
  const starPool = Array.from({ length: cfg.starMax }, (_, i) => i + 1);

  let numbers = [];
  let stars = [];

  if (mode === "Hot numbers") {
    const weights = new Map(pool.map((n) => [n, (numFreq.get(n) || 1) + 1]));
    numbers = weightedPick(pool, weights, cfg.numbers);
    const sWeights = new Map(starPool.map((n) => [n, (starFreq.get(n) || 1) + 1]));
    stars = weightedPick(starPool, sWeights, cfg.stars);
  } else if (mode === "Cold numbers") {
    const weights = new Map(pool.map((n) => [n, (numCold.get(n) || 1) + 1]));
    numbers = weightedPick(pool, weights, cfg.numbers);
    const sWeights = new Map(starPool.map((n) => [n, (starCold.get(n) || 1) + 1]));
    stars = weightedPick(starPool, sWeights, cfg.stars);
  } else {
    numbers = uniqueRandoms(cfg.numbers, cfg.min, cfg.max);
    stars = uniqueRandoms(cfg.stars, 1, cfg.starMax);
  }

  return { numbers, stars };
}

function registerStats(game, historicalSimulation = null) {
  stats.total_generated += 1;
  if (game === "powerball") stats.powerball_generated += 1;
  if (game === "megamillions") stats.megamillions_generated += 1;
  if ((historicalSimulation?.winning_draws || 0) > 0) stats.won_count += 1;
}

function registerRanking(game, mode, generated, analysis = null) {
  generatedRanking.unshift({
    created_at: new Date().toISOString(),
    game,
    mode,
    numbers: generated.numbers,
    stars: generated.stars || [],
    draws_analyzed: analysis?.historicalSimulation?.draws_analyzed ?? 0,
    winning_draws: analysis?.historicalSimulation?.winning_draws ?? 0,
    top_prize: analysis?.historicalSimulation?.breakdown?.[0]?.category || null
  });
  while (generatedRanking.length > 10) generatedRanking.pop();
}

app.get("/api/usa/health", async (_req, res) => {
  const pb = await getCoverage("powerball");
  const mm = await getCoverage("megamillions");
  res.json({ ok: true, last_sync_at: lastSyncAt, history: { powerball_draws: pb.total_draws, megamillions_draws: mm.total_draws } });
});

app.get("/api/usa/history-status", async (_req, res) => {
  await syncHistory(false);
  const pb = await getCoverage("powerball");
  const mm = await getCoverage("megamillions");
  res.json({
    history: {
      years_back: YEARS_BACK,
      powerball_draws: pb.total_draws,
      megamillions_draws: mm.total_draws,
      last_sync_at: lastSyncAt,
      sync_log: syncLog,
      source: FEED_URLS,
      table: "usa_draws"
    }
  });
});

app.post("/api/usa/history/refresh", async (_req, res) => {
  await syncHistory(true);
  const pb = await getCoverage("powerball");
  const mm = await getCoverage("megamillions");
  res.json({ ok: true, history: { powerball_draws: pb.total_draws, megamillions_draws: mm.total_draws, last_sync_at: lastSyncAt } });
});

app.get("/api/usa/latest", async (req, res) => {
  const game = normalizeGame(req.query.game);
  if (!["powerball", "megamillions"].includes(game)) return res.status(400).json({ error: "game requerido" });
  await syncHistory(false);
  const draw = await getLatest(game);
  res.json({ draw });
});

app.get("/api/usa/draws", async (req, res) => {
  const game = normalizeGame(req.query.game);
  if (!["powerball", "megamillions"].includes(game)) return res.status(400).json({ error: "game requerido" });
  await syncHistory(false);
  res.json({ draws: await getDraws(game, 150) });
});

app.get("/api/usa/number-stats", async (req, res) => {
  const game = normalizeGame(req.query.game);
  if (!["powerball", "megamillions"].includes(game)) return res.status(400).json({ error: "game requerido" });
  await syncHistory(false);
  res.json({ game, ...(await getNumberStats(game)) });
});


app.get("/api/usa/stats", async (_req, res) => {
  await syncHistory(false);
  const pb = await getCoverage("powerball");
  const mm = await getCoverage("megamillions");
  res.json({
    stats,
    history: {
      powerball_draws: pb.total_draws,
      megamillions_draws: mm.total_draws,
      last_sync_at: lastSyncAt
    }
  });
});

app.get("/api/usa/prize-ranking", async (_req, res) => {
  await syncHistory(false);

  const ranking = generatedRanking.map((item) => {
    const game = item.game;
    const drawsPromise = getAllDrawRows(game);
    return { item, drawsPromise };
  });

  const built = [];
  for (const entry of ranking) {
    const { item } = entry;
    const draws = await entry.drawsPromise;
    const genNums = new Set((item.numbers || []).map(Number));
    const genStars = new Set((item.stars || []).map(Number));

    let totalHits = 0;
    let bestResult = null;
    let lastDrawDate = null;

    for (const draw of draws) {
      const numMatches = (draw.numbers || []).filter((n) => genNums.has(Number(n))).length;
      const starMatches = (draw.stars || []).filter((s) => genStars.has(Number(s))).length;
      const category = item.game === "powerball"
        ? classifyPowerball(numMatches, starMatches)
        : classifyMegaMillions(numMatches, starMatches);

      if (category) {
        totalHits += 1;
        if (!bestResult || numMatches > bestResult.matches_main || (numMatches === bestResult.matches_main && starMatches > bestResult.matches_extra)) {
          bestResult = {
            label: category,
            matches_main: numMatches,
            matches_extra: starMatches
          };
          lastDrawDate = draw.drawDate;
        }
      }
    }

    built.push({
      game: item.game,
      outcome_label: bestResult?.label || "No significant prize",
      prize_amount: bestResult ? bestResult.label : "—",
      total_hits: totalHits,
      times_given: totalHits,
      last_draw_date: lastDrawDate
    });
  }

  built.sort((a, b) => b.total_hits - a.total_hits);

  res.json({
    ranking: built.slice(0, 10),
    methodology: "USA historical simulation"
  });
});

app.post("/api/usa/generate", async (req, res) => {
  const game = normalizeGame(req.body?.game);
  const mode = String(req.body?.mode || "Random");
  const generated = await generateCombination(game, mode);

  if (!generated) return res.status(400).json({ error: "Juego no válido" });

  await syncHistory(false);
  const analysis = await buildAnalysis(game, generated);

  registerStats(game, analysis.historicalSimulation);
  registerRanking(game, mode, generated, analysis);
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

app.post("/api/usa/generate-smart", async (req, res) => {
  const game = normalizeGame(req.body?.game);
  const mode = String(req.body?.mode || "Radar Loto IA");
  const generated = await generateCombination(game, mode);

  if (!generated) return res.status(400).json({ error: "Juego no válido" });

  await syncHistory(false);
  const analysis = await buildAnalysis(game, generated);

  registerStats(game, analysis.historicalSimulation);
  registerRanking(game, mode, generated, analysis);
  await saveGeneratedCache();

  res.json({
    result: {
      ...generated,
      mode,
      eq: analysis.eq,
      statScore: analysis.statScore,
      historicalSimulation: analysis.historicalSimulation,
      reasons: analysis.reasons
    }
  });
});


async function start() {
  await query("SELECT 1");
  await ensureDb();
  await loadGeneratedCache();
  syncHistory(false).catch((err) => {
    logSync(`Error en sincronización inicial USA: ${err.message}`);
  });
  app.listen(PORT, () => {
    console.log(`Radar Loto USA DB backend iniciado en puerto ${PORT}`);
  });
}

start().catch((err) => {
  console.error("No se pudo iniciar el backend USA DB:", err);
  process.exit(1);
});
