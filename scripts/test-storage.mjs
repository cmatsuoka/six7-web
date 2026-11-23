/*
 * The internal memory's store check.
 *
 * The store is TypeScript, so this script bundles it with esbuild (a Vite
 * dependency) and imports the result. It writes into a stand-in for the
 * browser's local storage: no file and no hardware are involved.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const outDir = mkdtempSync(join(tmpdir(), 'six7-storage-'));
const outFile = join(outDir, 'storage.mjs');

try {
  execFileSync('./node_modules/.bin/esbuild', [
    'src/ui/storage.ts',
    '--bundle',
    '--format=esm',
    '--platform=node',
    `--outfile=${outFile}`,
    '--log-level=warning',
  ], { stdio: 'inherit' });
} catch (error) {
  console.error('test:storage: could not bundle the store:', error.message);
  process.exit(1);
}

/** A stand-in for the browser's local storage. */
const store = new Map();
globalThis.window = {
  localStorage: {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: (key) => store.delete(key),
  },
};

const { loadInternalMemory, saveInternalMemory } = await import(
  pathToFileURL(outFile).href
);

const checks = [];
function check(label, condition) {
  checks.push(condition);
  console.log(`${condition ? 'ok  ' : 'FAIL'} - ${label}`);
}

function aVoice(name) {
  const data = new Uint8Array(156);
  data.set(new TextEncoder().encode(name.padEnd(10, ' ')), 145);
  return {
    data,
    name,
    extensions: {
      keyMode: 2,
      unisonDetune: 3,
      pegRange: 1,
      pegVelocity: 4,
      pegRateScaling: 5,
      lfoMode: 1,
    },
  };
}

// An empty store gives 32 empty positions.
let memory = loadInternalMemory();
check('an empty memory has 32 positions', memory.length === 32);
check('an empty memory holds no voices', memory.every((voice) => voice === null));

// A stored voice comes back after a reload.
memory = loadInternalMemory();
memory[4] = aVoice('MY PATCH');
saveInternalMemory(memory);
check('the memory is written to the store', store.has('six7.internal.v1'));

const reloaded = loadInternalMemory();
check('the stored voice is back', reloaded[4] !== null);
check(
  'the stored voice keeps its bytes',
  reloaded[4] !== null &&
    reloaded[4].data[145] === 77 /* M */ &&
    reloaded[4].data.length === 156,
);
check('the stored voice keeps its name', reloaded[4]?.name === 'MY PATCH');
check(
  'the stored voice keeps its extensions',
  reloaded[4]?.extensions?.keyMode === 2 &&
    reloaded[4]?.extensions?.pegRange === 1,
);
check(
  'the other positions are empty',
  reloaded.filter((voice, index) => voice !== null && index !== 4).length === 0,
);

// A malformed entry is discarded; the good voice survives it.
const raw = JSON.parse(store.get('six7.internal.v1'));
raw[9] = { data: 'not base64!!' };
raw[10] = { data: 'AAAA' };
store.set('six7.internal.v1', JSON.stringify(raw));
const damaged = loadInternalMemory();
check('a malformed voice is discarded', damaged[9] === null && damaged[10] === null);
check('the good voice survives the malformed ones', damaged[4] !== null);

// A malformed store is discarded whole.
store.set('six7.internal.v1', 'not json');
const broken = loadInternalMemory();
check('a malformed store is discarded', broken.every((voice) => voice === null));
check('a malformed store is removed', !store.has('six7.internal.v1'));

if (checks.every(Boolean)) {
  console.log('\nall store checks passed');
} else {
  process.exit(1);
}
