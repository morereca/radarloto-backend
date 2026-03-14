
import fs from 'fs';
import Database from 'better-sqlite3';

const db = new Database('./radarloto.db');

function importFile(file, game){
  const data = JSON.parse(fs.readFileSync(file,'utf8'));
  let inserted = 0;

  for(const d of data.draws){
    const r = db.prepare(`
      INSERT OR IGNORE INTO draws (game, draw_date, numbers_json, stars_json, reintegro)
      VALUES (?,?,?,?,?)
    `).run(
      game,
      d.drawDate,
      JSON.stringify(d.numbers),
      d.stars ? JSON.stringify(d.stars) : null,
      d.reintegro ?? null
    );
    inserted += r.changes;
  }

  return inserted;
}

console.log("Importando dataset...");

const p = importFile("./data/primitiva.json","primitiva");
const e = importFile("./data/euromillones.json","euromillones");

console.log("Primitiva insertados:",p);
console.log("Euromillones insertados:",e);
