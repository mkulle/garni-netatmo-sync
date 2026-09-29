// Garni 419T (Tuya cloud) -> Netatmo thermostat "true temperature" sync.
// No runtime dependencies; Node.js >= 22.18 runs the TypeScript directly (type stripping).
//
//   node src/main.ts            run in a loop
//   node src/main.ts --list     print Tuya DP codes and Netatmo homes/rooms, then exit
//   node src/main.ts --once     single pass, then exit
//   DRY_RUN=1                   never write to Netatmo, only log

import { loadConfig } from './config.ts';
import { list } from './list.ts';
import { Netatmo } from './netatmo.ts';
import { Sync } from './sync.ts';
import { Tuya } from './tuya.ts';
import { log, sleep } from './utils.ts';

async function main(): Promise<void> {
  const cfg = loadConfig();
  const tuya = new Tuya(cfg.tuya);
  const netatmo = new Netatmo(cfg.netatmo);
  const args = process.argv.slice(2);
  if (args.includes('--list')) return list(cfg, tuya, netatmo);

  const { rules } = cfg;
  log(
    `Start (interval ${cfg.intervalSec} s, ` +
      (rules.onlyWhenWrong ? `only when regulating wrong, tolerance ±${rules.tolerance} °C, ` : '') +
      `threshold ${rules.threshold} °C${cfg.dryRun ? ', DRY_RUN' : ''})`,
  );
  const sync = new Sync(cfg, tuya, netatmo);
  do {
    try {
      await sync.tick();
    } catch (e) {
      log('ERROR:', e instanceof Error ? e.message : e);
    }
    if (args.includes('--once')) break;
    await sleep(cfg.intervalSec * 1000);
  } while (true);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
