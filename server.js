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

const PORT = Number(process.env.PORT || 3000);
const DATA_DIR = path.join(__dirname, "data");

const PRIMITIVA_FILE = path.join(DATA_DIR, "primitiva.json");
const EUROMILLONES_FILE = path.join(DATA_DIR, "euromillones.json");
const GENERATED_FILE = path.join(DATA_DIR, "generated-cache.json");

const YEARS_BACK = Number(process.env.YEARS_BACK || 10);
const SYNC_MAX_AGE_HOURS = Number(process.env.SYNC_MAX_AGE_HOURS || 18);

const SOURCE_URLS = {
  primitivaBase: "https://www.elgordo.com/es/resultados/primitiva--a%C3%B1o-",
  euromillonesBase: "https://www.elgordo.com/es/resultados/euromillones--a%C3%B1o-",
};

const MONTHS_ES = {
  ene: "01",
  feb: "02",
  mar: "03",
  abr: "04",
  may: "05",
  jun: "06",
  jul: "07",
  ago: "08",
  sept: "09",
  sep: "09",
  oct: "10",
  nov: "11",
  dic: "12",
};

const stats = {
  total_generated: 0,
  primitiva_generated: 0,
  euromillones_generated: 0,
  won_count: 0,
};

const generatedRanking = [];
const historyState = {
  primitiva: [],
  euromillones: [],
  last_sync_at: null,
  sync_log: [],
};

let syncPromise = null;

function logSync(message) {
  const line = `${new Date().toISOString()} ${message}`;
  historyState.sync_log.unshift(line);
  historyState.sync_log = historyState.sync_log.slice(0, 80);
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

  const slash = str.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (slash) return `${slash[3]}-${slash[2]}-${slash[1]}`;

  const iso = str.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;

  const text = str.match(/^(?:[a-záéíóú]{3},\s*)?(\d{1,2})\s+([a-záéíóú]+)\s+(\d{4})$/i);
  if (text) {
    const day = String(text[1]).padStart(2, "0");
    const monthKey = text[2].toLowerCase().slice(0, 4).replace(".", "");
    const month = MONTHS_ES[monthKey] || MONTHS_ES[monthKey.slice(0, 3)];
    if (month) return `${text[3]}-${month}-${day}`;
  }

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
  if (game === "primitiva") {
    return { numbers: 6, min: 1, max: 49, stars: 0, starMax: 0 };
  }

  if (game === "euromillones") {
    return { numbers: 5, min: 1, max: 50, stars: 2, starMax: 12 };
  }

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
  return `${draw.game}:${draw.drawDate}:${draw.numbers.join("-")}:${(draw.stars || []).join("-")}:${draw.reintegro ?? ""}:${draw.complementary ?? ""}`;
}

function toStoredPrimitivaDraw(draw) {
  return {
    drawDate: normalizeDate(draw.drawDate),
    numbers: [...draw.numbers].sort((a, b) => a - b),
    reintegro: Number.isFinite(draw.reintegro) ? Number(draw.reintegro) : null,
    complementary: Number.isFinite(draw.complementary) ? Number(draw.complementary) : null,
  };
}

function toStoredEuromillonesDraw(draw) {
  return {
    drawDate: normalizeDate(draw.drawDate),
    numbers: [...draw.numbers].sort((a, b) => a - b),
    stars: [...(draw.stars || [])].sort((a, b) => a - b),
  };
}

function fromStoredPrimitivaDraw(raw) {
  const draw = {
    game: "primitiva",
    drawDate: normalizeDate(raw.drawDate || raw.date),
    numbers: (raw.numbers || []).map(Number).filter(Number.isFinite).sort((a, b) => a - b),
    stars: [],
    reintegro: raw.reintegro != null ? Number(raw.reintegro) : null,
    complementary: raw.complementary != null ? Number(raw.complementary) : null,
  };
  draw.id = ensureDrawId(draw);
  return draw;
}

function fromStoredEuromillonesDraw(raw) {
  const draw = {
    game: "euromillones",
    drawDate: normalizeDate(raw.drawDate || raw.date),
    numbers: (raw.numbers || []).map(Number).filter(Number.isFinite).sort((a, b) => a - b),
    stars: (raw.stars || []).map(Number).filter(Number.isFinite).sort((a, b) => a - b),
    reintegro: null,
    complementary: null,
  };
  draw.id = ensureDrawId(draw);
  return draw;
}

async function ensureDataDir() {
  if (!existsSync(DATA_DIR)) {
    await fs.mkdir(DATA_DIR, { recursive: true });
  }
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

  const primitivaJson = await readJsonSafe(PRIMITIVA_FILE, { draws: [] });
  const euromillonesJson = await readJsonSafe(EUROMILLONES_FILE, { draws: [] });
  const generatedJson = await readJsonSafe(GENERATED_FILE, { stats, ranking: [], last_sync_at: null, sync_log: [] });

  historyState.primitiva = Array.isArray(primitivaJson.draws)
    ? primitivaJson.draws.map(fromStoredPrimitivaDraw).filter((d) => d.numbers.length === 6)
    : [];

  historyState.euromillones = Array.isArray(euromillonesJson.draws)
    ? euromillonesJson.draws.map(fromStoredEuromillonesDraw).filter((d) => d.numbers.length === 5 && d.stars.length === 2)
    : [];

  if (generatedJson?.stats) {
    stats.total_generated = Number(generatedJson.stats.total_generated || 0);
    stats.primitiva_generated = Number(generatedJson.stats.primitiva_generated || 0);
    stats.euromillones_generated = Number(generatedJson.stats.euromillones_generated || 0);
    stats.won_count = Number(generatedJson.stats.won_count || 0);
  }

  if (Array.isArray(generatedJson?.ranking)) {
    generatedRanking.splice(0, generatedRanking.length, ...generatedJson.ranking.slice(0, 10));
  }

  historyState.last_sync_at = generatedJson?.last_sync_at || null;
  historyState.sync_log = Array.isArray(generatedJson?.sync_log) ? generatedJson.sync_log.slice(0, 80) : [];
}

async function saveHistoryFiles() {
  const primitivaDraws = historyState.primitiva
    .filter((d) => inHistoryWindow(d.drawDate))
    .sort((a, b) => normalizeDate(b.drawDate).localeCompare(normalizeDate(a.drawDate)))
    .map(toStoredPrimitivaDraw);

  const euromillonesDraws = historyState.euromillones
    .filter((d) => inHistoryWindow(d.drawDate))
    .sort((a, b) => normalizeDate(b.drawDate).localeCompare(normalizeDate(a.drawDate)))
    .map(toStoredEuromillonesDraw);

  await writeJsonSafe(PRIMITIVA_FILE, { draws: primitivaDraws });
  await writeJsonSafe(EUROMILLONES_FILE, { draws: euromillonesDraws });
}

async function saveGeneratedCache() {
  await writeJsonSafe(GENERATED_FILE, {
    stats,
    ranking: generatedRanking.slice(0, 10),
    last_sync_at: historyState.last_sync_at,
    sync_log: historyState.sync_log.slice(0, 80),
  });
}

async function fetchText(url, timeoutMs = 25000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { "user-agent": "RadarLoto/1.0" },
    });

    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }

    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

function decodeHtml(str) {
  return String(str || "")
    .replace(/&nbsp;/g, " ")
    .replace(/&#160;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function stripTags(str) {
  return decodeHtml(String(str || "").replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]*>/g, "\n"));
}

function textFromHtml(html) {
  return stripTags(html)
    .replace(/\r/g, "\n")
    .replace(/\t/g, " ")
    .replace(/[ ]{2,}/g, " ")
    .replace(/\n{2,}/g, "\n");
}

function parseEuromillonesText(fullText) {
  const draws = [];
  const regex = /(\d{2}-\d{2}-\d{2}-\d{2}-\d{2}-E\d{2}\s*-E\d{2})\s+([a-záéíóú]{3},\s*\d{1,2}\s+[a-záéíóú]+\s+\d{4})/gi;

  for (const match of fullText.matchAll(regex)) {
    const combo = match[1].replace(/\s+/g, "");
    const date = normalizeDate(match[2]);

    const numMatches = [...combo.matchAll(/\d{2}/g)].map((m) => Number(m[0]));
    const numbers = numMatches.slice(0, 5).sort((a, b) => a - b);
    const stars = numMatches.slice(5, 7).sort((a, b) => a - b);

    if (numbers.length === 5 && stars.length === 2) {
      const draw = {
        game: "euromillones",
        drawDate: date,
        numbers,
        stars,
        reintegro: null,
        complementary: null,
      };
      draw.id = ensureDrawId(draw);
      draws.push(draw);
    }
  }

  return draws;
}

function parsePrimitivaText(fullText) {
  const draws = [];
  const regex = /(\d{2}-\d{2}-\d{2}-\d{2}-\d{2}-\d{2}-C\d{2}\s*-R\d{1,2})\s+([a-záéíóú]{3},\s*\d{1,2}\s+[a-záéíóú]+\s+\d{4})/gi;

  for (const match of fullText.matchAll(regex)) {
    const combo = match[1].replace(/\s+/g, "");
    const date = normalizeDate(match[2]);

    const main = combo.match(/^(\d{2})-(\d{2})-(\d{2})-(\d{2})-(\d{2})-(\d{2})-C(\d{2})-R(\d{1,2})$/i);
    if (!main) continue;

    const numbers = main.slice(1, 7).map(Number).sort((a, b) => a - b);
    const complementary = Number(main[7]);
    const reintegro = Number(main[8]);

    if (numbers.length === 6) {
      const draw = {
        game: "primitiva",
        drawDate: date,
        numbers,
        stars: [],
        reintegro,
        complementary,
      };
      draw.id = ensureDrawId(draw);
      draws.push(draw);
    }
  }

  return draws;
}

function mergeHistory(game, incoming) {
  const current = new Map((historyState[game] || []).map((d) => [d.id, d]));

  for (const draw of incoming) {
    if (!draw?.id) continue;
    if (!inHistoryWindow(draw.drawDate)) continue;
    current.set(draw.id, draw);
  }

  historyState[game] = [...current.values()]
    .sort((a, b) => normalizeDate(a.drawDate).localeCompare(normalizeDate(b.drawDate)));
}

async function syncYear(game, year) {
  const base = game === "primitiva" ? SOURCE_URLS.primitivaBase : SOURCE_URLS.euromillonesBase;
  const url = `${base}${year}`;
  const html = await fetchText(url);
  const text = textFromHtml(html);

  const parsed = game === "primitiva" ? parsePrimitivaText(text) : parseEuromillonesText(text);
  mergeHistory(game, parsed);
  logSync(`${game} ${year}: ${parsed.length} sorteos importados`);
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
    const currentYear = new Date().getUTCFullYear();
    const years = [];
    for (let y = currentYear; y >= currentYear - YEARS_BACK; y -= 1) {
      years.push(y);
    }

    logSync("Inicio de sincronización histórica");
    for (const year of years) {
      try {
        await syncYear("primitiva", year);
      } catch (err) {
        logSync(`Error al importar primitiva ${year}: ${err.message}`);
      }

      try {
        await syncYear("euromillones", year);
      } catch (err) {
        logSync(`Error al importar euromillones ${year}: ${err.message}`);
      }
    }

    historyState.last_sync_at = new Date().toISOString();
    await saveHistoryFiles();
    await saveGeneratedCache();
    logSync("Sincronización histórica completada");
  })();

  try {
    await syncPromise;
  } finally {
    syncPromise = null;
  }
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

  return { numFreq, starFreq, numCold, starCold };
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

function generateCombination(game, mode = "Al azar") {
  const cfg = gameConfig(game);
  if (!cfg) return null;

  const pool = Array.from({ length: cfg.max - cfg.min + 1 }, (_, i) => i + cfg.min);
  const starPool = Array.from({ length: cfg.starMax }, (_, i) => i + 1);
  const { numFreq, starFreq, numCold, starCold } = buildFrequencyMaps(game);

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

  if (game === "primitiva") {
    reintegro = Math.floor(Math.random() * 10);
  }

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
    "2+0": "13ª (2 + 0)",
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

    if (game === "primitiva") {
      const complementaryHit = draw.complementary != null && genNums.has(draw.complementary);
      const reintegroHit = draw.reintegro != null && Number(draw.reintegro) === Number(generated.reintegro);
      const category = classifyPrimitiva(numMatches, complementaryHit, reintegroHit);

      if (category) {
        winningDraws += 1;
        breakdownMap[category] = (breakdownMap[category] || 0) + 1;
        hitSamples.unshift({
          date: draw.drawDate,
          category,
          summary: `${numMatches} aciertos${complementaryHit ? " + C" : ""}${reintegroHit ? " + R" : ""}`,
        });
      }
    } else {
      const starMatches = (draw.stars || []).filter((s) => genStars.has(s)).length;
      const category = classifyEuromillones(numMatches, starMatches);

      if (category) {
        winningDraws += 1;
        breakdownMap[category] = (breakdownMap[category] || 0) + 1;
        hitSamples.unshift({
          date: draw.drawDate,
          category,
          summary: `${numMatches} números + ${starMatches} estrellas`,
        });
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
    latest_hits: hitSamples.slice(0, 5),
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
      `Equilibrio: ${equilibrium} / 100`,
      `Calidad estadística: ${statQuality} / 100`,
      `Simulación histórica (${historicalSimulation.window_years} años): ${historicalSimulation.winning_draws} sorteos con premio`,
    ],
  };
}

function registerStats(game, historicalSimulation = null) {
  stats.total_generated += 1;
  if (game === "primitiva") stats.primitiva_generated += 1;
  if (game === "euromillones") stats.euromillones_generated += 1;
  if ((historicalSimulation?.winning_draws || 0) > 0) stats.won_count += 1;
}

function registerRanking(game, mode, generated, analysis = null) {
  generatedRanking.unshift({
    created_at: new Date().toISOString(),
    game,
    mode,
    numbers: generated.numbers,
    stars: generated.stars || [],
    reintegro: generated.reintegro ?? null,
    draws_analyzed: analysis?.historicalSimulation?.draws_analyzed ?? 0,
    winning_draws: analysis?.historicalSimulation?.winning_draws ?? 0,
    top_prize: analysis?.historicalSimulation?.breakdown?.[0]?.category || null,
  });

  while (generatedRanking.length > 10) generatedRanking.pop();
}

app.get("/api/health", async (_req, res) => {
  res.json({
    ok: true,
    history: {
      primitiva_draws: historyState.primitiva.length,
      euromillones_draws: historyState.euromillones.length,
      last_sync_at: historyState.last_sync_at,
    },
  });
});

app.get("/api/stats", async (_req, res) => {
  await syncHistory(false);

  res.json({
    stats,
    history: {
      primitiva_draws: historyState.primitiva.length,
      euromillones_draws: historyState.euromillones.length,
      last_sync_at: historyState.last_sync_at,
    },
  });
});

app.get("/api/history-status", async (_req, res) => {
  await syncHistory(false);

  res.json({
    history: {
      years_back: YEARS_BACK,
      primitiva_draws: historyState.primitiva.length,
      euromillones_draws: historyState.euromillones.length,
      last_sync_at: historyState.last_sync_at,
      sync_log: historyState.sync_log,
      files: {
        primitiva: "data/primitiva.json",
        euromillones: "data/euromillones.json",
        generated: "data/generated-cache.json",
      },
      source: SOURCE_URLS,
    },
  });
});

app.post("/api/history/refresh", async (_req, res) => {
  await syncHistory(true);

  res.json({
    ok: true,
    history: {
      primitiva_draws: historyState.primitiva.length,
      euromillones_draws: historyState.euromillones.length,
      last_sync_at: historyState.last_sync_at,
    },
  });
});

app.get("/api/prize-ranking", (_req, res) => {
  res.json({ ranking: generatedRanking });
});

app.post("/api/generate", async (req, res) => {
  const game = normalizeGame(req.body?.game);
  const mode = String(req.body?.mode || "Al azar");
  const generated = generateCombination(game, mode);

  if (!generated) {
    return res.status(400).json({ error: "Juego no válido" });
  }

  await syncHistory(false);
  registerStats(game);
  registerRanking(game, mode, generated);
  await saveGeneratedCache();

  res.json({ generated });
});

app.post("/api/generate-smart", async (req, res) => {
  const game = normalizeGame(req.body?.game);
  const mode = String(req.body?.mode || "Radar Loto IA");
  const generated = generateCombination(game, mode === "radar_ai" ? "Radar Loto IA" : mode);

  if (!generated) {
    return res.status(400).json({ error: "Juego no válido" });
  }

  await syncHistory(false);

  const analysis = buildAnalysis(game, generated);
  registerStats(game, analysis.historicalSimulation);
  registerRanking(game, mode, generated, analysis);
  await saveGeneratedCache();

  res.json({
    result: {
      ...generated,
      mode: mode === "radar_ai" ? "Radar Loto IA" : mode,
      eq: analysis.eq,
      statScore: analysis.statScore,
      historicalSimulation: analysis.historicalSimulation,
      reasons: analysis.reasons,
    },
  });
});

app.get("*", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

async function start() {
  await loadCache();

  syncHistory(false).catch((err) => {
    logSync(`Error en sincronización inicial: ${err.message}`);
  });

  app.listen(PORT, () => {
    console.log(`Radar Loto backend iniciado en puerto ${PORT}`);
  });
}

start().catch((err) => {
  console.error("No se pudo iniciar el backend:", err);
  process.exit(1);
});
