import { deployRemote } from './release.mjs';
const [name, version] = process.argv.slice(2);
if (!name || !version) { console.error('Usage: npm run deploy -- <remote> <version>'); process.exitCode = 1; }
else {
  try { const result = deployRemote(name, version, process.argv.join(' ')); console.log(JSON.stringify(result, null, 2)); if (!result.ok) process.exitCode = 1; }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
