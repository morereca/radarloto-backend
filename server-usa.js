import express from "express";
import path from "path";
import { fileURLToPath } from "url";

const app = express();

app.use((req, res, next) => {
  console.log("HIT SERVER USA =>", req.method, req.path);
  next();
});

const REDIRECT_MAP = {
  "/powerball-stats.html": "/powerball-statistics.html",
  "/estadisticas-powerball.html": "/powerball-statistics.html",
  "/mega-stats.html": "/mega-statistics.html",
  "/estadisticas-megamillions.html": "/mega-statistics.html",
  "/numeros-que-mas-salen-powerball.html": "/powerball-hot-numbers.html",
  "/numeros-que-mas-salen-megamillions.html": "/mega-hot-numbers.html"
};

app.use((req, res, next) => {
  const url = req.path.replace(/\/+$/, "");
  if (REDIRECT_MAP[url]) {
    console.log("REDIRECT USA:", url, "→", REDIRECT_MAP[url]);
    return res.redirect(301, REDIRECT_MAP[url]);
  }
  next();
});

app.get("/test-redirect-debug", (req, res) => {
  res.send("DEBUG USA OK");
});

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.use(express.static(path.join(__dirname, "public")));

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log("Server USA running on", PORT));
