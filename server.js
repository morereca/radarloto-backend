import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";

const app = express();

app.use(cors());
app.use(express.json());

/* =================================
   __dirname fix para ESM
================================= */

const __filename = fileURLToPath(import.meta.url);
const _dirname = path.dirname(_filename);

/* =================================
   servir frontend
================================= */

app.use(express.static(path.join(__dirname, "public")));

/* =================================
   health check
================================= */

app.get("/api/health", (req, res) => {
  res.json({ ok: true });
});

/* =================================
   generar números (simple)
================================= */

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

  res.json({
    generated: {
      numbers,
      stars,
      reintegro
    }
  });

});

/* =================================
   fallback SPA
================================= */

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

/* =================================
   iniciar servidor
================================= */

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log('Radar Loto backend iniciado en puerto ${PORT}');
});
