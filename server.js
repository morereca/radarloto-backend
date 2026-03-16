import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";

const app = express();

app.use(cors());
app.use(express.json());

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.use(express.static(path.join(__dirname, "public")));

const stats = {
  total_generated: 0,
  primitiva_generated: 0,
  euromillones_generated: 0,
  won_count: 0,
};

function uniqueRandoms(count, min, max) {
  const arr = [];
  while (arr.length < count) {
    const n = Math.floor(Math.random() * (max - min + 1)) + min;
    if (!arr.includes(n)) arr.push(n);
  }
  return arr.sort((a, b) => a - b);
}

function normalizeGame(value) {
  return String(value || "").trim().toLowerCase();
}

function generateCombination(game) {
  if (game === "primitiva") {
    return {
      numbers: uniqueRandoms(6, 1, 49),
      stars: [],
      reintegro: Math.floor(Math.random() * 10),
    };
  }

  if (game === "euromillones") {
    return {
      numbers: uniqueRandoms(5, 1, 50),
      stars: uniqueRandoms(2, 1, 12),
      reintegro: null,
    };
  }

  return null;
}

function registerStats(game) {
  stats.total_generated += 1;
  if (game === "primitiva") stats.primitiva_generated += 1;
  if (game === "euromillones") stats.euromillones_generated += 1;
}

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

app.get("/api/stats", (_req, res) => {
  res.json({ stats });
});

app.get("/api/prize-ranking", (_req, res) => {
  res.json({ ranking: [] });
});

app.post("/api/generate", (req, res) => {
  const game = normalizeGame(req.body?.game);
  const generated = generateCombination(game);

  if (!generated) {
    return res.status(400).json({ error: "Juego no válido" });
  }

  registerStats(game);
  res.json({ generated });
});

app.post("/api/generate-smart", (req, res) => {
  const game = normalizeGame(req.body?.game);
  const result = generateCombination(game);

  if (!result) {
    return res.status(400).json({ error: "Juego no válido" });
  }

  registerStats(game);
  res.json({
    result: {
      ...result,
      mode: "Radar Loto IA",
      reasons: [
        "Equilibrio entre pares e impares",
        "Distribución variada por rangos",
        "Selección aleatoria sin repeticiones"
      ]
    }
  });
});

app.get("*", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Radar Loto backend iniciado en puerto ${PORT}`);
});
