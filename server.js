import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import { db } from "./db.js";
import { importHistory } from "./services.historyImport.js";
import { getDrawCoverage } from "./services.stats.js";

const app = express();

app.use(cors());
app.use(express.json());

/* =================================
   ARREGLO __dirname PARA NODE ESM
================================= */

const __filename = fileURLToPath(import.meta.url);
const _dirname = path.dirname(_filename);

app.use(express.static(path.join(__dirname, "public")));


/* =================================
   HEALTH
================================= */

app.get("/api/health", (req,res)=>{
  res.json({ ok:true });
});


/* =================================
   GENERADOR DE NÚMEROS
================================= */

app.post("/api/generate",(req,res)=>{

  const game = req.body.game;

  if(!["primitiva","euromillones"].includes(game)){
    return res.status(400).json({ error:"Juego no válido" });
  }

  let numbers = [];
  let stars = [];
  let reintegro = null;

  if(game==="primitiva"){

    while(numbers.length < 6){
      const n = Math.floor(Math.random()*49)+1;
      if(!numbers.includes(n)) numbers.push(n);
    }

    reintegro = Math.floor(Math.random()*10);

  }

  if(game==="euromillones"){

    while(numbers.length < 5){
      const n = Math.floor(Math.random()*50)+1;
      if(!numbers.includes(n)) numbers.push(n);
    }

    while(stars.length < 2){
      const n = Math.floor(Math.random()*12)+1;
      if(!stars.includes(n)) stars.push(n);
    }

  }

  numbers.sort((a,b)=>a-b);

  res.json({
    generated:{
      numbers,
      stars,
      reintegro
    }
  });

});


/* =================================
   SORTEOS GUARDADOS
================================= */

app.get("/api/draws",(req,res)=>{

  const game = req.query.game;

  if(!game){
    return res.status(400).json({ error:"game requerido" });
  }

  const draws = db.prepare(`
    SELECT *
    FROM draws
    WHERE game = ?
    ORDER BY draw_date DESC
    LIMIT 100
  `).all(game);

  res.json({ draws });

});


/* =================================
   COBERTURA HISTÓRICO
================================= */

app.get("/api/history-coverage",(req,res)=>{

  res.json({
    primitiva:getDrawCoverage("primitiva"),
    euromillones:getDrawCoverage("euromillones")
  });

});


/* =================================
   IMPORTAR HISTÓRICO
================================= */

app.get("/api/admin/import-10-years", async (req,res)=>{

  try{

    const year = new Date().getFullYear();

    const primitiva = await importHistory("primitiva",2016,year);
    const euromillones = await importHistory("euromillones",2016,year);

    res.json({
      ok:true,
      result:{
        primitiva,
        euromillones
      },
      coverage:{
        primitiva:getDrawCoverage("primitiva"),
        euromillones:getDrawCoverage("euromillones")
      }
    });

  }
  catch(error){

    res.status(500).json({
      error:String(error.message || error)
    });

  }

});


/* =================================
   AUTO CARGA HISTÓRICO
================================= */

async function ensureHistoricalBackfill(){

  try{

    const year = new Date().getFullYear();

    const primCoverage = getDrawCoverage("primitiva");
    const euroCoverage = getDrawCoverage("euromillones");

    const primCount = primCoverage?.total || primCoverage?.total_draws || 0;
    const euroCount = euroCoverage?.total || euroCoverage?.total_draws || 0;

    const needsPrim = primCount < 300;
    const needsEuro = euroCount < 300;

    if(!needsPrim && !needsEuro){

      console.log("Histórico suficiente. No se necesita importar.");

      return;

    }

    console.log("Importando histórico de 10 años...");

    if(needsPrim){

      const primResult = await importHistory("primitiva",2016,year);
      console.log("Primitiva importada:",primResult);

    }

    if(needsEuro){

      const euroResult = await importHistory("euromillones",2016,year);
      console.log("Euromillones importado:",euroResult);

    }

    console.log("Cobertura final:",{
      primitiva:getDrawCoverage("primitiva"),
      euromillones:getDrawCoverage("euromillones")
    });

  }
  catch(error){

    console.error("Error cargando histórico:",error);

  }

}


/* =================================
   FRONTEND
================================= */

app.get("*",(req,res)=>{
  res.sendFile(path.join(__dirname,"public","index.html"));
});


/* =================================
   SERVER
================================= */

const PORT = process.env.PORT || 3000;

app.listen(PORT, async ()=>{

  console.log(Radar Loto backend iniciado en puerto ${PORT});

  await ensureHistoricalBackfill();

});
