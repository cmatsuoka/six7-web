/*
 * The SYSEX parser check.
 *
 * The parser is TypeScript, so this script bundles it with esbuild (a Vite
 * dependency) and imports the result. It builds synthetic DX7-family
 * dumps in memory: no hardware ROM or sample is involved.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const outDir = mkdtempSync(join(tmpdir(), 'six7-sysex-'));
const outFile = join(outDir, 'sysex.mjs');

try {
  execFileSync('./node_modules/.bin/esbuild', [
    'src/ui/sysex.ts',
    '--bundle',
    '--format=esm',
    '--platform=node',
    `--outfile=${outFile}`,
    '--log-level=warning',
  ], { stdio: 'inherit' });
} catch (error) {
  console.error('test:sysex: could not bundle the parser:', error.message);
  process.exit(1);
}

const { parseSysex, createInitVoice, voiceName } = await import(
  pathToFileURL(outFile).href
);

let failures = 0;
function check(condition, label) {
  if (condition) {
    console.log(`ok - ${label}`);
    return;
  }
  failures += 1;
  console.error(`not ok - ${label}`);
}

function checksum(data) {
  let sum = 0;
  for (const byte of data) {
    sum = (sum + byte) & 0x7f;
  }
  return (128 - sum) & 0x7f;
}

function packedVoice(name) {
  const packed = new Uint8Array(128);
  packed[0] = 99;
  packed[1] = 90;
  packed[11] = 0x05;
  packed[12] = 0x2b;
  packed[13] = 0x1d;
  packed[15] = 0x21;
  packed[110] = 4;
  packed[111] = 0x0d;
  packed[116] = 0x23;
  for (let i = 0; i < 10; i += 1) {
    packed[118 + i] = i < name.length ? name.charCodeAt(i) : 0x20;
  }
  return packed;
}

function bulkDump(names, badChecksum = false) {
  const data = new Uint8Array(32 * 128);
  names.forEach((name, index) => {
    data.set(packedVoice(name), index * 128);
  });
  const message = new Uint8Array(6 + data.length + 2);
  message.set([0xf0, 0x43, 0x00, 0x09, 0x20, 0x00], 0);
  message.set(data, 6);
  message[6 + data.length] = badChecksum ? 1 : checksum(data);
  message[6 + data.length + 1] = 0xf7;
  return message;
}

function singleDump(name) {
  const voice = createInitVoice(0);
  for (let i = 0; i < 10; i += 1) {
    voice[145 + i] = i < name.length ? name.charCodeAt(i) : 0x20;
  }
  const data = voice.subarray(0, 155);
  const message = new Uint8Array(6 + data.length + 2);
  message.set([0xf0, 0x43, 0x00, 0x00, 0x01, 0x1b], 0);
  message.set(data, 6);
  message[6 + data.length] = checksum(data);
  message[6 + data.length + 1] = 0xf7;
  return message;
}

function acedDump({
  keyMode = 0,
  unison = 0,
  pegRange = 3,
  pegVelocity = 0,
  pegRateScaling = 0,
  lfoMode = 0,
} = {}) {
  const data = new Uint8Array(73);
  data[12] = pegRange;
  data[13] = lfoMode;
  data[14] = pegVelocity;
  data[16] = keyMode;
  data[38] = pegRateScaling;
  data[72] = unison;
  const message = new Uint8Array(6 + data.length + 2);
  message.set([0xf0, 0x43, 0x00, 0x05, 0x00, 0x49], 0);
  message.set(data, 6);
  message[6 + data.length] = checksum(data);
  message[6 + data.length + 1] = 0xf7;
  return message;
}

function amemDump(extensions) {
  const data = new Uint8Array(32 * 35);
  extensions.forEach((ext, index) => {
    const offset = index * 35;
    data[offset + 4] =
      (ext.pegRange & 0x03) |
      ((ext.lfoMode & 0x01) << 2) |
      ((ext.pegVelocity & 0x01) << 3);
    data[offset + 5] = ext.keyMode & 0x03;
    data[offset + 24] = ext.pegRateScaling;
    data[offset + 34] = ext.unisonDetune;
  });
  const message = new Uint8Array(6 + data.length + 2);
  message.set([0xf0, 0x43, 0x00, 0x06, 0x08, 0x60], 0);
  message.set(data, 6);
  message[6 + data.length] = checksum(data);
  message[6 + data.length + 1] = 0xf7;
  return message;
}

{
  const names = Array.from({ length: 32 }, (_, i) => `VOICE ${String(i + 1).padStart(2, '0')}`);
  const parsed = parseSysex(bulkDump(names));
  check(parsed.dumps.length === 1, 'one bulk dump is found');
  check(parsed.dumps[0]?.kind === 'bulk', 'the dump is a bulk bank');
  check(parsed.dumps[0]?.voices.length === 32, 'a bulk bank holds 32 voices');
  check(voiceName(parsed.dumps[0].voices[0]) === 'VOICE 01', 'the first name is unpacked');
  check(voiceName(parsed.dumps[0].voices[31]) === 'VOICE 32', 'the last name is unpacked');
  check(parsed.warnings.length === 0, 'a good checksum has no warning');
}

{
  const parsed = parseSysex(bulkDump(['BAD SUM'], true));
  check(parsed.dumps.length === 1, 'a bad checksum still reads the data');
  check(parsed.warnings.length === 1, 'a bad checksum produces a warning');
}

{
  const parsed = parseSysex(singleDump('ONE VOICE'));
  check(parsed.dumps.length === 1, 'one single-voice dump is found');
  check(parsed.dumps[0]?.kind === 'single', 'the dump is a single voice');
  check(parsed.dumps[0]?.voices.length === 1, 'a single dump holds one voice');
  check(voiceName(parsed.dumps[0].voices[0]) === 'ONE VOICE', 'the single voice name is read');
  check(parsed.dumps[0].voices[0].length === 156, 'the single voice is padded to 156 bytes');
}

{
  const file = new Uint8Array([...bulkDump(['A']), ...bulkDump(['B'])]);
  const parsed = parseSysex(file);
  check(parsed.dumps.length === 2, 'two messages in one file become two dumps');
}

{
  const file = new Uint8Array([
    ...singleDump('EXT VOICE'),
    ...acedDump({
      keyMode: 3,
      unison: 5,
      pegRange: 1,
      pegVelocity: 1,
      pegRateScaling: 6,
      lfoMode: 1,
    }),
  ]);
  const parsed = parseSysex(file);
  check(parsed.dumps.length === 1, 'ACED pairs with the single voice');
  const ext = parsed.dumps[0]?.extensions[0];
  check(ext?.keyMode === 3, 'the ACED voice mode is read');
  check(ext?.unisonDetune === 5, 'the ACED unison detune is read');
  check(ext?.pegRange === 1, 'the ACED pitch-EG range is read');
  check(ext?.pegVelocity === 1, 'the ACED pitch-EG velocity is read');
  check(ext?.pegRateScaling === 6, 'the ACED pitch-EG rate scaling is read');
  check(ext?.lfoMode === 1, 'the ACED LFO mode is read');
  check(parsed.warnings.length === 0, 'the ACED checksum is good');
}

{
  const extensions = Array.from({ length: 32 }, (_, index) => ({
    keyMode: index % 4,
    unisonDetune: index % 8,
    pegRange: index % 4,
    pegVelocity: index % 2,
    pegRateScaling: index % 8,
    lfoMode: index % 2,
  }));
  const file = new Uint8Array([
    ...bulkDump(['AMEM']),
    ...amemDump(extensions),
  ]);
  const parsed = parseSysex(file);
  check(parsed.dumps.length === 1, 'AMEM pairs with the bulk bank');
  check(parsed.dumps[0]?.extensions.length === 32, 'AMEM covers every voice');
  const ext = parsed.dumps[0]?.extensions[17];
  check(ext?.keyMode === 1, 'the AMEM voice mode is read');
  check(ext?.unisonDetune === 1, 'the AMEM unison detune is read');
  check(ext?.pegRange === 1, 'the AMEM pitch-EG range is read');
  check(ext?.pegVelocity === 1, 'the AMEM pitch-EG velocity is read');
  check(ext?.pegRateScaling === 1, 'the AMEM pitch-EG rate scaling is read');
  check(ext?.lfoMode === 1, 'the AMEM LFO mode is read');
  const again = parseSysex(parsed.dumps[0].raw);
  check(again.dumps.length === 1, 'the dump re-parses from its raw bytes');
  check(
    again.dumps[0]?.extensions[17]?.pegRange === 1,
    'the raw bytes keep the extensions attached',
  );
}

{
  const extensions = Array.from({ length: 32 }, (_, index) => ({
    keyMode: index % 4,
    unisonDetune: index % 8,
    pegRange: index % 4,
    pegVelocity: index % 2,
    pegRateScaling: index % 8,
    lfoMode: index % 2,
  }));
  const file = new Uint8Array([
    ...amemDump(extensions),
    ...bulkDump(['REVERSED']),
  ]);
  const parsed = parseSysex(file);
  check(parsed.dumps.length === 1, 'AMEM may precede the bulk bank');
  check(parsed.dumps[0]?.extensions[17]?.pegRange === 1, 'reversed AMEM still pairs');
  const again = parseSysex(parsed.dumps[0].raw);
  check(
    again.dumps[0]?.extensions[17]?.pegRange === 1,
    'the raw bytes pair a reversed AMEM again',
  );
}

{
  const file = new Uint8Array([
    ...acedDump({ pegRange: 1 }),
    ...singleDump('REVERSED'),
  ]);
  const parsed = parseSysex(file);
  check(parsed.dumps.length === 1, 'ACED may precede the single voice');
  check(parsed.dumps[0]?.extensions[0]?.pegRange === 1, 'reversed ACED still pairs');
}

{
  const parsed = parseSysex(acedDump());
  check(parsed.dumps.length === 0, 'ACED alone is not a voice');
  check(
    parsed.warnings.some((warning) => warning.includes('additional voice')),
    'unpaired ACED is reported',
  );
}

{
  const parsed = parseSysex(singleDump('DX7 ONLY'));
  check(
    parsed.dumps[0]?.extensions[0] === undefined,
    'a DX7 voice has no extensions',
  );
}

{
  const parsed = parseSysex(new Uint8Array([0x00, 0x01, 0x02]));
  check(parsed.dumps.length === 0, 'junk is refused');
  check(parsed.warnings.length === 1, 'junk is reported');
}

{
  const parsed = parseSysex(bulkDump(['FIELD']));
  const voice = parsed.dumps[0].voices[0];
  check(voice[0] === 99, 'the first operator rate survives');
  check(voice[11] === 1, 'the left curve is split from the packed pair');
  check(voice[12] === 1, 'the right curve is split from the packed pair');
  check(voice[13] === 3, 'the rate scaling is split from the detune field');
  check(voice[14] === 1, 'the amp-mod sensitivity is split');
  check(voice[15] === 7, 'the velocity sensitivity is split');
  check(voice[17] === 1, 'the fixed-frequency mode bit is split');
  check(voice[18] === 16, 'the coarse frequency is split');
  check(voice[155] === 0x3f, 'the operator-enable byte is set');
}

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}

console.log('\nall SYSEX checks passed');
