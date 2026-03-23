
import express from "express";
import cors from "cors";
import pkg from "pg";

const { Pool } = pkg;
const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));

const PORT = Number(process.env.PORT || 3001);
const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error("Falta DATABASE_URL");
  process.exit(1);
}

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// 🔥 AÑADIDO UNIQUE AUTOMÁTICO
async function ensureUniqueConstraint() {
  try {
    await pool.query(`
      ALTER TABLE usa_draws
      ADD CONSTRAINT unique_game_date UNIQUE (game, draw_date);
    `);
    console.log("UNIQUE creado correctamente");
  } catch (err) {
    console.log("UNIQUE ya existe o error:", err.message);
  }
}

app.get("/api/usa/health", async (_req, res) => {
  res.json({ ok: true });
});

async function start() {
  await pool.query("SELECT 1");

  // 🔥 Aquí se asegura el UNIQUE
  await ensureUniqueConstraint();

  app.listen(PORT, () => {
    console.log(`Radar Loto USA backend iniciado en puerto ${PORT}`);
  });
}

start().catch((err) => {
  console.error("No se pudo iniciar el backend:", err);
  process.exit(1);
});
