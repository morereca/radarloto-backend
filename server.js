import express from "express";
import path from "path";
import { fileURLToPath } from "url";

const app = express();

app.use((req, res, next) => {
  console.log("HIT SERVER ES =>", req.method, req.path);
  next();
});

const REDIRECT_MAP = {
  "/numeros-mas-frecuentes-euromillones.html": "/numeros-que-mas-salen-euromillones.html",
  "/numeros-mas-frecuentes-primitiva.html": "/numeros-que-mas-salen-primitiva.html",
  "/numeros-menos-frecuentes-euromillones.html": "/numeros-frios-euromillones.html",
  "/numeros-menos-frecuentes-primitiva.html": "/numeros-frios-primitiva.html"
};

app.use((req, res, next) => {
  const url = req.path.replace(/\/+$/, "");
  if (REDIRECT_MAP[url]) {
    console.log("REDIRECT ES:", url, "→", REDIRECT_MAP[url]);
    return res.redirect(301, REDIRECT_MAP[url]);
  }
  next();
});

app.get("/test-redirect-debug", (req, res) => {
  res.send("DEBUG ES OK");
});

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.use(express.static(path.join(__dirname, "public")));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Server ES running on", PORT));
