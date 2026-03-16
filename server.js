import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";

const app = express();

app.use(cors());
app.use(express.json());

const __filename = fileURLToPath(import.meta.url);
const _dirname = path.dirname(_filename);

app.use(express.static(path.join(__dirname, "public")));

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

app.post("/api/generate", (req, res) => {
  const game = req.body.game;

  if (!["primitiva", "euromillones"].includes(game)) {
    return res.status(400).json({ error: "Juego no válido" });
  }

  let numbers = [];
  let stars = [];
  let reintegro = null;

  if (game === "primitiva") {
    while (numbers.length < 6) {
      const n = Math.floor(Math.random() * 49) + 1;
      if (!numbers.includes(n)) numbers.push(n);
    }
    reintegro = Math.floor(Math.random() * 10);
  }

  if (game === "euromillones") {
    while (numbers.length < 5) {
      const n = Math.floor(Math.random() * 50) + 1;
      if (!numbers.includes(n)) numbers.push(n);
    }

    while (stars.length < 2) {
      const n = Math.floor(Math.random() * 12) + 1;
      if (!stars.includes(n)) stars.push(n);
    }
  }

  numbers.sort((a, b) => a - b);
  stars.sort((a, b) => a - b);

  res.json({
    generated: {
      numbers,
      stars,
      reintegro
    }
  });
});

app.get("*", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log('Radar Loto backend iniciado en puerto ${PORT}');
});
