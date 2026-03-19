import express from "express";
import cors from "cors";
import path from "path";
import fs from "fs/promises";
import { existsSync } from "fs";
import { fileURLToPath } from "url";

const app = express();

app.use(cors());
app.use(express.json({ limit: "1mb" }));

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.use(express.static(path.join(__dirname, "public")));

const PORT = Number(process.env.PORT || 3001);
const DATA_DIR = path.join(__dirname, "data");
const POWERBALL_FILE = path.join(DATA_DIR, "powerball.json");
const MEGAMILLIONS_FILE = path.join(DATA_DIR, "megamillions.json");
const GENERATED_FILE = path.join(DATA_DIR, "generated-cache-usa.json");

const YEARS_BACK = Number(process.env.YEARS_BACK || 10);
const SYNC_MAX_AGE_HOURS = Number(process.env.SYNC_MAX_AGE_HOURS || 18);

const FEED_URLS = {
  powerball: {
    latest: process.env.POWERBALL_LATEST_URL || "https://www.powerball.com/draw-result",
    history: process.env.POWERBALL_HISTORY_URL || "https://www.powerball.com/previous-results"
  },
  megamillions: {
    latest: process.env.MEGAMILLIONS_LATEST_URL || "https://www.megamillions.com/winning-numbers.aspx",
    history: process.env.MEGAMILLIONS_HISTORY_URL || "https://www.megamillions.com/Winning-Numbers/Previous-Drawings.aspx"
  }
};

const stats = {
  total_generated: 0,
  powerball_generated: 0,
  megamillions_generated: 0,
  won_count: 0
};

const generatedRanking = [];
const historyState = {
  powerball: [],
  megamillions: [],
  last_sync_at: null,
  sync_log: [],
  source: {
    provider: "official_pages_plus_open_data",
    urls: FEED_URLS
  }
};

let syncPromise = null;

function logSync(message) {
  const line = `${new Date().toISOString()} ${message}`;
  historyState.sync_log.unshift(line);
  historyState.sync_log = historyState.sync_log.slice(0, 120);
  console.log(line);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function normalizeGame(value) {
  return String(value || "").trim().toLowerCase();
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

function gameConfig(game) {
  if (game === "powerball") return { numbers: 5, min: 1, max: 69, stars: 1, starMax: 26 };
  if (game === "megamillions") return { numbers: 5, min: 1, max: 70, stars: 1, starMax: 24 };
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

function ensureDrawId(draw) {
  return `${draw.game}:${draw.drawDate}:${draw.numbers.join("-")}:${(draw.stars || []).join("-")}:${draw.multiplier ?? ""}:${draw.jackpot ?? ""}`;
}

function fromStoredDraw(game, raw) {
  const draw = {
    game,
    drawDate: String(raw.drawDate || raw.date || "").slice(0, 10),
    numbers: (raw.numbers || []).map(Number).filter(Number.isFinite).sort((a, b) => a - b),
    stars: (raw.stars || []).map(Number).filter(Number.isFinite).sort((a, b) => a - b),
    multiplier: raw.multiplier != null ? String(raw.multiplier) : null,
    jackpot: raw.jackpot != null ? String(raw.jackpot) : null,
    cashValue: raw.cashValue != null ? String(raw.cashValue) : null
  };
  draw.id = ensureDrawId(draw);
  return draw;
}

function toStoredDraw(draw) {
  return {
    drawDate: draw.drawDate,
    numbers: [...draw.numbers].sort((a, b) => a - b),
    stars: [...(draw.stars || [])].sort((a, b) => a - b),
    multiplier: draw.multiplier ?? null,
    jackpot: draw.jackpot ?? null,
    cashValue: draw.cashValue ?? null
  };
}

async function ensureDataDir() {
  if (!existsSync(DATA_DIR)) await fs.mkdir(DATA_DIR, { recursive: true });
}

async function readJsonSafe(filePath, fallbackValue) {
  try {
    if (!existsSync(filePath)) return fallbackValue;
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw);
  } catch (err) {
    logSync(`No se pudo leer ${path.basename(filePath)}: ${err.message}`);
    return fallbackValue;
  }
}

async function writeJsonSafe(filePath, value) {
  await ensureDataDir();
  await fs.writeFile(filePath, JSON.stringify(value, null, 2), "utf8");
}

async function loadCache() {
  await ensureDataDir();

  const powerballJson = await readJsonSafe(POWERBALL_FILE, { draws: [] });
  const megamillionsJson = await readJsonSafe(MEGAMILLIONS_FILE, { draws: [] });
  const generatedJson = await readJsonSafe(GENERATED_FILE, {
    stats,
    ranking: [],
    last_sync_at: null,
    sync_log: []
  });

  historyState.powerball = Array.isArray(powerballJson.draws)
    ? powerballJson.draws.map((d) => fromStoredDraw("powerball", d)).filter((d) => d.numbers.length === 5 && d.stars.length === 1)
    : [];

  historyState.megamillions = Array.isArray(megamillionsJson.draws)
    ? megamillionsJson.draws.map((d) => fromStoredDraw("megamillions", d)).filter((d) => d.numbers.length === 5 && d.stars.length === 1)
    : [];

  if (generatedJson?.stats) {
    stats.total_generated = Number(generatedJson.stats.total_generated || 0);
    stats.powerball_generated = Number(generatedJson.stats.powerball_generated || 0);
    stats.megamillions_generated = Number(generatedJson.stats.megamillions_generated || 0);
    stats.won_count = Number(generatedJson.stats.won_count || 0);
  }

  if (Array.isArray(generatedJson?.ranking)) {
    generatedRanking.splice(0, generatedRanking.length, ...generatedJson.ranking.slice(0, 10));
  }

  historyState.last_sync_at = generatedJson?.last_sync_at || null;
  historyState.sync_log = Array.isArray(generatedJson?.sync_log) ? generatedJson.sync_log.slice(0, 120) : [];
}

async function saveHistoryFiles() {
  await writeJsonSafe(POWERBALL_FILE, {
    draws: historyState.powerball
      .filter((d) => inHistoryWindow(d.drawDate))
      .sort((a, b) => b.drawDate.localeCompare(a.drawDate))
      .map(toStoredDraw)
  });

  await writeJsonSafe(MEGAMILLIONS_FILE, {
    draws: historyState.megamillions
      .filter((d) => inHistoryWindow(d.drawDate))
      .sort((a, b) => b.drawDate.localeCompare(a.drawDate))
      .map(toStoredDraw)
  });
}

async function saveGeneratedCache() {
  await writeJsonSafe(GENERATED_FILE, {
    stats,
    ranking: generatedRanking.slice(0, 10),
    last_sync_at: historyState.last_sync_at,
    sync_log: historyState.sync_log.slice(0, 120)
  });
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


function parseOpenDataMainNumbers(value) {
  const parts = String(value || "")
    .trim()
    .split(/[^0-9]+/)
    .map(Number)
    .filter(Number.isFinite);

  if (parts.length >= 5) return parts.slice(0, 5).sort((a, b) => a - b);
  return [];
}

function parseOpenDataSpecial(row, game) {
  const directCandidates = game === "megamillions"
    ? [row.mega_ball, row.megaball, row.mega]
    : [row.power_ball, row.powerball, row.power_ball_number, row.powerball_number];

  for (const value of directCandidates) {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }

  const parts = String(row.winning_numbers || "")
    .trim()
    .split(/[^0-9]+/)
    .map(Number)
    .filter(Number.isFinite);

  if (parts.length >= 6) return parts[5];
  return null;
}

function dedupeRows(rows) {
  const seen = new Set();
  return rows.filter((row) => {
    const key = row.drawDate + "|" + row.numbers.join("-") + "|" + row.stars.join("-");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function parsePowerballLatest(html) {
  const text = stripHtml(html);
  const dateMatch = text.match(/Winning Numbers\s+(Mon|Tue|Wed|Thu|Fri|Sat|Sun),\s+[A-Za-z]{3}\s+\d{1,2},\s+\d{4}/);
  const dateIso = dateMatch ? parsePowerballDate(dateMatch[0].replace(/^Winning Numbers\s+/, "")) : null;

  const fullMatch = text.match(/Winning Numbers\s+(Mon|Tue|Wed|Thu|Fri|Sat|Sun),\s+[A-Za-z]{3}\s+\d{1,2},\s+\d{4}\s+(\d{1,2})\s+(\d{1,2})\s+(\d{1,2})\s+(\d{1,2})\s+(\d{1,2})\s+(\d{1,2})(?:\s+Power Play\s+([0-9Xx]+))?/);
  if (!fullMatch || !dateIso) return null;

  const draw = {
    game: "powerball",
    drawDate: dateIso,
    numbers: [fullMatch[2], fullMatch[3], fullMatch[4], fullMatch[5], fullMatch[6]].map(Number).sort((a, b) => a - b),
    stars: [Number(fullMatch[7])],
    multiplier: fullMatch[8] || null,
    jackpot: (text.match(/Estimated Jackpot:\s+\$[0-9.,]+\s*(?:Million|Billion)?/i) || [null])[0]?.replace(/Estimated Jackpot:\s*/i, "") || null,
    cashValue: (text.match(/Cash Value:\s+\$[0-9.,]+\s*(?:Million|Billion)?/i) || [null])[0]?.replace(/Cash Value:\s*/i, "") || null
  };
  draw.id = ensureDrawId(draw);
  return draw;
}

function parsePowerballHistory(html) {
  const text = stripHtml(html);
  const rows = [];
  const regex = /((?:Mon|Tue|Wed|Thu|Fri|Sat|Sun),\s+[A-Za-z]{3}\s+\d{1,2},\s+\d{4})\s+(\d{1,2})\s+(\d{1,2})\s+(\d{1,2})\s+(\d{1,2})\s+(\d{1,2})\s+(\d{1,2})(?:\s+Power Play\s+([0-9Xx]+))?/g;
  let m;
  while ((m = regex.exec(text)) !== null) {
    const drawDate = parsePowerballDate(m[1]);
    if (!drawDate) continue;
    const row = {
      game: "powerball",
      drawDate,
      numbers: [m[2], m[3], m[4], m[5], m[6]].map(Number).sort((a, b) => a - b),
      stars: [Number(m[7])],
      multiplier: m[8] || null,
      jackpot: null,
      cashValue: null
    };
    row.id = ensureDrawId(row);
    rows.push(row);
  }
  return dedupeRows(rows);
}

function parseMegaLatest(html) {
  const text = stripHtml(html);
  const m = text.match(/DRAWING DATE:\s*(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)\.,?\s*(\d{1,2})\/(\d{1,2})\.\s*(\d{1,2});\s*(\d{1,2});\s*(\d{1,2});\s*(\d{1,2});\s*(\d{1,2});\s*(\d{1,2})(?:;\s*(\d{1,2})X)?/i);
  if (!m) return null;

  const draw = {
    game: "megamillions",
    drawDate: parseMegaDate(m[1], m[2]),
    numbers: [m[3], m[4], m[5], m[6], m[7]].map(Number).sort((a, b) => a - b),
    stars: [Number(m[8])],
    multiplier: m[9] ? `${m[9]}X` : null,
    jackpot: (text.match(/Estimated Jackpot:\s+\$[0-9.,]+\s*(?:Million|Billion)?/i) || [null])[0]?.replace(/Estimated Jackpot:\s*/i, "") || null,
    cashValue: (text.match(/Cash Option:\s+\$[0-9.,]+\s*(?:Million|Billion)?/i) || [null])[0]?.replace(/Cash Option:\s*/i, "") || null
  };
  draw.id = ensureDrawId(draw);
  return draw;
}

function parseMegaHistory(html) {
  const text = stripHtml(html);
  const rows = [];
  const regex = /(\d{1,2})\/(\d{1,2})\/(\d{4})\.\s*(\d{1,2});\s*(\d{1,2});\s*(\d{1,2});\s*(\d{1,2});\s*(\d{1,2});\s*(\d{1,2})(?:\.\s*([0-9]{1,2})X)?/g;
  let m;
  while ((m = regex.exec(text)) !== null) {
    const row = {
      game: "megamillions",
      drawDate: parseMegaDate(m[1], m[2], m[3]),
      numbers: [m[4], m[5], m[6], m[7], m[8]].map(Number).sort((a, b) => a - b),
      stars: [Number(m[9])],
      multiplier: m[10] ? `${m[10]}X` : null,
      jackpot: null,
      cashValue: null
    };
    row.id = ensureDrawId(row);
    rows.push(row);
  }
  return dedupeRows(rows);
}

function mergeHistory(game, incoming) {
  const current = new Map((historyState[game] || []).map((d) => [d.id, d]));
  for (const draw of incoming) {
    if (!draw?.id || !inHistoryWindow(draw.drawDate)) continue;
    current.set(draw.id, draw);
  }
  historyState[game] = [...current.values()].sort((a, b) => a.drawDate.localeCompare(b.drawDate));
}

async function importHistory(game) {
  const start = currentWindowStartISO();

  if (game === "powerball") {
    const url = `https://data.ny.gov/resource/d6yy-54nr.json?$limit=5000&$order=draw_date%20ASC&$where=draw_date%20%3E%3D%20%27${start}T00:00:00%27`;
    const json = await fetch(url, {
      headers: {
        "accept": "application/json",
        "user-agent": "Mozilla/5.0 (compatible; RadarLotoUSABot/1.0; +https://radarloto.com)"
      }
    }).then(async (r) => {
      if (!r.ok) throw new Error(`HTTP ${r.status} en ${url}`);
      return r.json();
    });

    const rows = json.map((d) => {
      const numbers = parseOpenDataMainNumbers(d.winning_numbers);
      const special = parseOpenDataSpecial(d, "powerball");
      if (!d.draw_date || numbers.length !== 5 || !Number.isFinite(special)) return null;

      const row = {
        game: "powerball",
        drawDate: String(d.draw_date).slice(0, 10),
        numbers,
        stars: [special],
        multiplier: d.multiplier != null ? String(d.multiplier) : null,
        jackpot: d.jackpot_amount != null ? String(d.jackpot_amount) : null,
        cashValue: null
      };
      row.id = ensureDrawId(row);
      return row;
    }).filter(Boolean);

    mergeHistory(game, rows);
    logSync(`powerball: ${rows.length} sorteos importados`);
    return rows.length;
  }

  if (game === "megamillions") {
    const url = `https://data.ny.gov/resource/5xaw-6ayf.json?$limit=5000&$order=draw_date%20ASC&$where=draw_date%20%3E%3D%20%27${start}T00:00:00%27`;
    const json = await fetch(url, {
      headers: {
        "accept": "application/json",
        "user-agent": "Mozilla/5.0 (compatible; RadarLotoUSABot/1.0; +https://radarloto.com)"
      }
    }).then(async (r) => {
      if (!r.ok) throw new Error(`HTTP ${r.status} en ${url}`);
      return r.json();
    });

    const rows = json.map((d) => {
      const numbers = parseOpenDataMainNumbers(d.winning_numbers);
      const special = parseOpenDataSpecial(d, "megamillions");
      if (!d.draw_date || numbers.length !== 5 || !Number.isFinite(special)) return null;

      const row = {
        game: "megamillions",
        drawDate: String(d.draw_date).slice(0, 10),
        numbers,
        stars: [special],
        multiplier: d.multiplier != null ? String(d.multiplier) : null,
        jackpot: d.jackpot_amount != null ? String(d.jackpot_amount) : null,
        cashValue: null
      };
      row.id = ensureDrawId(row);
      return row;
    }).filter(Boolean);

    mergeHistory(game, rows);
    logSync(`megamillions: ${rows.length} sorteos importados`);
    return rows.length;
  }

  return 0;
}

async function refreshLatest(game) {
  if (game === "powerball") {
    const html = await fetchText(FEED_URLS.powerball.latest);
    const latest = parsePowerballLatest(html);
    if (latest) mergeHistory(game, [latest]);
    return latest;
  }
  const html = await fetchText(FEED_URLS.megamillions.latest);
  const latest = parseMegaLatest(html);
  if (latest) mergeHistory(game, [latest]);
  return latest;
}

function shouldSyncNow(force = false) {
  if (force) return true;
  if (!historyState.last_sync_at) return true;
  const last = new Date(historyState.last_sync_at).getTime();
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
    logSync("Inicio de sincronización USA");
    try {
      await importHistory("powerball");
      await refreshLatest("powerball");
    } catch (err) {
      logSync(`Error al importar powerball: ${err.message}`);
    }

    try {
      await importHistory("megamillions");
      await refreshLatest("megamillions");
    } catch (err) {
      logSync(`Error al importar megamillions: ${err.message}`);
    }

    historyState.last_sync_at = new Date().toISOString();
    await saveHistoryFiles();
    await saveGeneratedCache();
    logSync("Sincronización USA completada");
  })();

  try { await syncPromise; }
  finally { syncPromise = null; }
}

function buildFrequencyMaps(game) {
  const cfg = gameConfig(game);
  const draws = historyState[game] || [];
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

function generateCombination(game, mode = "Random") {
  const cfg = gameConfig(game);
  if (!cfg) return null;

  const pool = Array.from({ length: cfg.max - cfg.min + 1 }, (_, i) => i + cfg.min);
  const starPool = Array.from({ length: cfg.starMax }, (_, i) => i + 1);
  const { numFreq, starFreq, numCold, starCold } = buildFrequencyMaps(game);

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
  const idealOdd = 2;
  return clamp(82 - Math.abs(idealOdd - odd) * 8, 20, 98);
}

function calcStatQuality(game, numbers) {
  const sorted = [...numbers].sort((a, b) => a - b);
  const sum = sorted.reduce((a, b) => a + b, 0);
  const odd = sorted.filter((n) => n % 2 === 1).length;
  const low = sorted.filter((n) => n <= Math.floor(gameConfig(game).max / 2)).length;
  const consecutive = countConsecutive(sorted);
  const endingRepeat = maxEndingRepeat(sorted);

  let score = 78;
  score -= Math.abs(2 - odd) * 7;
  score -= Math.abs(Math.ceil(sorted.length / 2) - low) * 6;
  score -= consecutive * 10;
  score -= Math.max(0, endingRepeat - 2) * 9;
  if (sum < 90 || sum > 240) score -= 12;

  return clamp(score, 10, 96);
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

function simulateHistorical(game, generated) {
  const draws = historyState[game] || [];
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

function buildAnalysis(game, generated) {
  const equilibrium = calcEquilibrium(game, generated.numbers);
  const statQuality = calcStatQuality(game, generated.numbers);
  const historicalSimulation = simulateHistorical(game, generated);
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

function getDrawCoverage(game) {
  const draws = historyState[game] || [];
  const firstDrawDate = draws.length ? draws[0].drawDate : null;
  const lastDrawDate = draws.length ? draws[draws.length - 1].drawDate : null;
  return {
    total_draws: draws.length,
    draws_analyzed: draws.length,
    first_draw_date: firstDrawDate,
    last_draw_date: lastDrawDate,
    years_back: YEARS_BACK
  };
}

function mapCounts(countMap) {
  return Object.fromEntries([...countMap.entries()].sort((a, b) => Number(a[0]) - Number(b[0])));
}

function getNumberStats(game) {
  const cfg = gameConfig(game);
  const { draws, numFreq, starFreq, numCold, starCold } = buildFrequencyMaps(game);

  const hotMain = [...numFreq.entries()]
    .sort((a, b) => b[1] - a[1] || a[0] - b[0])
    .map(([number, count]) => ({ number, count }));

  const coldMain = Array.from({ length: cfg.max - cfg.min + 1 }, (_, i) => i + cfg.min)
    .map((number) => ({ number, gap: numCold.get(number) || 0, count: numFreq.get(number) || 0 }))
    .sort((a, b) => b.gap - a.gap || a.number - b.number);

  const hotExtra = Array.from({ length: cfg.starMax }, (_, i) => i + 1)
    .map((number) => ({ number, count: starFreq.get(number) || 0 }))
    .sort((a, b) => b.count - a.count || a.number - b.number);

  const coldExtra = Array.from({ length: cfg.starMax }, (_, i) => i + 1)
    .map((number) => ({ number, gap: starCold.get(number) || 0, count: starFreq.get(number) || 0 }))
    .sort((a, b) => b.gap - a.gap || a.number - b.number);

  const firstDrawDate = draws.length ? draws[0].drawDate : null;
  const lastDrawDate = draws.length ? draws[draws.length - 1].drawDate : null;

  return {
    coverage: {
      total_draws: draws.length,
      draws_analyzed: draws.length,
      first_draw_date: firstDrawDate,
      last_draw_date: lastDrawDate,
      years_back: YEARS_BACK
    },
    hotMain,
    coldMain,
    hotExtra,
    coldExtra,
    mainCounts: mapCounts(numFreq),
    extraCounts: mapCounts(starFreq)
  };
}

app.get("/api/usa/health", (_req, res) => {
  res.json({
    ok: true,
    history: {
      powerball_draws: historyState.powerball.length,
      megamillions_draws: historyState.megamillions.length,
      last_sync_at: historyState.last_sync_at
    }
  });
});

app.get("/api/usa/stats", async (_req, res) => {
  await syncHistory(false);
  res.json({
    stats,
    history: {
      powerball_draws: historyState.powerball.length,
      megamillions_draws: historyState.megamillions.length,
      last_sync_at: historyState.last_sync_at
    }
  });
});

app.get("/api/usa/history-status", async (_req, res) => {
  await syncHistory(false);
  res.json({
    history: {
      years_back: YEARS_BACK,
      powerball_draws: historyState.powerball.length,
      megamillions_draws: historyState.megamillions.length,
      last_sync_at: historyState.last_sync_at,
      sync_log: historyState.sync_log,
      source: historyState.source,
      files: {
        powerball: "data/powerball.json",
        megamillions: "data/megamillions.json",
        generated: "data/generated-cache-usa.json"
      }
    }
  });
});

app.post("/api/usa/history/refresh", async (_req, res) => {
  await syncHistory(true);
  res.json({
    ok: true,
    history: {
      powerball_draws: historyState.powerball.length,
      megamillions_draws: historyState.megamillions.length,
      last_sync_at: historyState.last_sync_at
    }
  });
});

app.get("/api/usa/history-coverage", async (_req, res) => {
  await syncHistory(false);
  res.json({
    powerball: getDrawCoverage("powerball"),
    megamillions: getDrawCoverage("megamillions")
  });
});

app.get("/api/usa/number-stats", async (req, res) => {
  const game = normalizeGame(req.query.game);
  if (!["powerball", "megamillions"].includes(game)) {
    return res.status(400).json({ error: "game requerido" });
  }

  await syncHistory(false);
  const ns = getNumberStats(game);

  res.json({
    game,
    coverage: ns.coverage,
    hot_numbers: ns.hotMain.slice(0, 12),
    cold_numbers: ns.coldMain.slice(0, 12),
    hot_extra: ns.hotExtra.slice(0, 6),
    cold_extra: ns.coldExtra.slice(0, 6),
    main_counts: ns.mainCounts,
    extra_counts: ns.extraCounts
  });
});

app.get("/api/usa/draws", async (req, res) => {
  const game = normalizeGame(req.query.game);
  if (!["powerball", "megamillions"].includes(game)) {
    return res.status(400).json({ error: "game requerido" });
  }

  await syncHistory(false);
  const draws = (historyState[game] || [])
    .slice()
    .sort((a, b) => b.drawDate.localeCompare(a.drawDate))
    .slice(0, 150)
    .map((draw) => ({
      game,
      draw_date: draw.drawDate,
      numbers_json: JSON.stringify(draw.numbers),
      stars_json: JSON.stringify(draw.stars || []),
      multiplier: draw.multiplier ?? null,
      jackpot: draw.jackpot ?? null,
      cash_value: draw.cashValue ?? null
    }));

  res.json({ draws });
});

app.get("/api/usa/latest", async (req, res) => {
  const game = normalizeGame(req.query.game);
  if (!["powerball", "megamillions"].includes(game)) {
    return res.status(400).json({ error: "game requerido" });
  }
  await syncHistory(false);
  const draws = (historyState[game] || []).slice().sort((a, b) => b.drawDate.localeCompare(a.drawDate));
  const draw = draws[0] || null;
  res.json({ draw });
});

app.get("/api/usa/prize-ranking", async (_req, res) => {
  await syncHistory(false);

  const ranking = generatedRanking.map((item) => {
    const game = item.game;
    const draws = historyState[game] || [];
    const genNums = new Set((item.numbers || []).map(Number));
    const genStars = new Set((item.stars || []).map(Number));

    let totalHits = 0;
    let bestResult = null;
    let lastDrawDate = null;

    for (const draw of draws) {
      const numMatches = (draw.numbers || []).filter((n) => genNums.has(Number(n))).length;
      const starMatches = (draw.stars || []).filter((s) => genStars.has(Number(s))).length;
      const category = game === "powerball"
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

    return {
      game,
      outcome_label: bestResult?.label || "No significant prize",
      prize_amount: bestResult ? bestResult.label : "—",
      total_hits: totalHits,
      times_given: totalHits,
      last_draw_date: lastDrawDate
    };
  });

  ranking.sort((a, b) => b.total_hits - a.total_hits);

  res.json({
    ranking: ranking.slice(0, 10),
    methodology: "USA historical simulation"
  });
});

app.post("/api/usa/generate", async (req, res) => {
  const game = normalizeGame(req.body?.game);
  const mode = String(req.body?.mode || "Random");
  const generated = generateCombination(game, mode);

  if (!generated) return res.status(400).json({ error: "Juego no válido" });

  await syncHistory(false);
  const analysis = buildAnalysis(game, generated);

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
  const generated = generateCombination(game, mode);

  if (!generated) return res.status(400).json({ error: "Juego no válido" });

  await syncHistory(false);
  const analysis = buildAnalysis(game, generated);

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

app.get("*", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

async function start() {
  await loadCache();
  syncHistory(false).catch((err) => {
    logSync(`Error en sincronización inicial USA: ${err.message}`);
  });
  app.listen(PORT, () => {
    console.log(`Radar Loto USA backend iniciado en puerto ${PORT}`);
  });
}

start().catch((err) => {
  console.error("No se pudo iniciar el backend USA:", err);
  process.exit(1);
});
