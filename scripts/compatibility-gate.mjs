import { checkManifest, manifestPath, readJson } from './release.mjs';
try {
  const failures = checkManifest(readJson(manifestPath));
  for (const item of failures) console.error(`${item.gate} [${item.name}] ${item.reason}`);
  if (failures.length) process.exitCode = 1;
  else console.log('G1–G6: all active artifacts passed.');
} catch (error) { console.error(error.message); process.exitCode = 1; }
