import { importHistory } from '../services.historyImport.js';
import { getDrawCoverage } from '../services.stats.js';

async function run() {
  const year = new Date().getFullYear();
  const primitiva = await importHistory('primitiva', 2016, year);
  const euromillones = await importHistory('euromillones', 2016, year);
  console.log(JSON.stringify({
    ok: true,
    result: { primitiva, euromillones },
    coverage: {
      primitiva: getDrawCoverage('primitiva'),
      euromillones: getDrawCoverage('euromillones')
    }
  }, null, 2));
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
