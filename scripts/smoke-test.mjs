/*
 * The engine smoke test.
 *
 * The wasm binary is instantiated directly, the way the worklet does it:
 * the application's own initial voice is loaded, a note is played and a
 * second of audio is rendered. The output has to be non-silent and inside
 * the int16 range. The controller setters and the pitch bend are checked
 * through the same boundary.
 *
 * Run it with `npm run smoke` after `npm run build:wasm`.
 */
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const SAMPLE_RATE = 48000;
const BLOCK_FRAMES = 128;
const VOICE_DUMP_SIZE = 156;

let failures = 0;

function check(condition, message) {
  if (condition) {
    console.log(`ok   ${message}`);
    return;
  }
  failures += 1;
  console.error(`FAIL ${message}`);
}

function equal(actual, expected, message) {
  check(actual === expected, `${message} (expected ${expected}, got ${actual})`);
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const bytes = await readFile(path.join(root, 'build', 'slopsix.wasm'));
const module = await WebAssembly.compile(bytes);

let memory = null;
const env = {
  emscripten_resize_heap: () => 0,
  fd_write: () => 0,
};

const instance = await WebAssembly.instantiate(module, {
  env,
  wasi_snapshot_preview1: env,
});
const engine = instance.exports;
memory = engine.memory;

if (typeof engine.__wasm_call_ctors === 'function') {
  engine.__wasm_call_ctors();
}

function initVoice() {
  const dump = new Uint8Array(VOICE_DUMP_SIZE);
  for (let block = 0; block < 6; block += 1) {
    const op = block * 21;
    dump[op] = 99;
    dump[op + 1] = 99;
    dump[op + 2] = 99;
    dump[op + 3] = 99;
    dump[op + 4] = 99;
    dump[op + 5] = 99;
    dump[op + 6] = 99;
    dump[op + 16] = block === 5 ? 99 : 0;
    dump[op + 18] = 1;
    dump[op + 20] = 7;
  }
  dump[126] = 99;
  dump[127] = 99;
  dump[128] = 99;
  dump[129] = 99;
  dump[130] = 50;
  dump[131] = 50;
  dump[132] = 50;
  dump[133] = 50;
  dump[134] = 0;
  dump[136] = 1;
  dump[144] = 24;
  const name = 'INIT 01';
  for (let i = 0; i < 10; i += 1) {
    dump[145 + i] = i < name.length ? name.charCodeAt(i) : 0x20;
  }
  return dump;
}

check(engine.six7_version_number() > 0, 'the library reports its version');

const context = engine.six7_create(0, SAMPLE_RATE);
check(context !== 0, 'the context is created');
equal(engine.six7_voice_dump_size(context), VOICE_DUMP_SIZE, 'the dump is 156 bytes');
equal(engine.six7_voice_count(context), 16, 'the DX7 engine has 16 voices');

const voicePtr = engine.malloc(VOICE_DUMP_SIZE);
new Uint8Array(engine.memory.buffer).set(initVoice(), voicePtr);
equal(engine.six7_set_voice(context, voicePtr, VOICE_DUMP_SIZE), 0, 'the voice loads');

equal(engine.six7_set_pitch_bend_range(context, 2, 0), 0, 'the bend range is set');
equal(engine.six7_set_pitch_bend(context, 8192), 0, 'the bend is centred');
equal(engine.six7_set_ctrl_range(context, 0, 99), 0, 'the mod-wheel range is set');
equal(engine.six7_set_ctrl_assign(context, 0, 0x3), 0, 'the mod wheel is routed');
equal(engine.six7_set_ctrl_value(context, 0, 127), 0, 'the mod wheel reaches full');
equal(engine.six7_set_sustain(context, 1), 0, 'the sustain pedal is held');
equal(engine.six7_set_sustain(context, 0), 0, 'the sustain pedal is released');

const outPtr = engine.malloc(BLOCK_FRAMES * 2 * Int16Array.BYTES_PER_ELEMENT);
equal(engine.six7_note_on(context, 60, 100), 0, 'the note starts');

let peak = 0;
for (let block = 0; block < 200; block += 1) {
  engine.six7_process(context, outPtr, BLOCK_FRAMES);
  const view = new Int16Array(engine.memory.buffer, outPtr, BLOCK_FRAMES * 2);
  for (const sample of view) {
    peak = Math.max(peak, Math.abs(sample));
  }
}

check(peak > 0, `the rendered audio is not silent (peak ${peak})`);
check(peak <= 32768, `the rendered audio stays inside int16 (peak ${peak})`);

equal(engine.six7_note_off(context, 60), 0, 'the note is released');
equal(
  engine.six7_set_digital_output_gain(context, 1),
  1,
  'the DX7 reports output-gain normalization as unsupported',
);
engine.six7_destroy(context);

const dx7s = engine.six7_create(1, SAMPLE_RATE);
check(dx7s !== 0, 'the DX7S context is created');
equal(engine.six7_set_key_mode(dx7s, 3), 0, 'the DX7S key mode is set');
equal(engine.six7_set_unison_detune(dx7s, 7), 0, 'the DX7S unison detune is set');
equal(engine.six7_set_peg_range(dx7s, 0), 0, 'the DX7S pitch-EG range is set');
equal(engine.six7_set_peg_velocity(dx7s, 1), 0, 'the DX7S pitch-EG velocity is set');
equal(engine.six7_set_peg_rate_scaling(dx7s, 7), 0, 'the DX7S pitch-EG rate scaling is set');
equal(engine.six7_set_lfo_mode(dx7s, 1), 0, 'the DX7S LFO mode is set');
equal(
  engine.six7_set_digital_output_gain(dx7s, 1),
  0,
  'the DX7S output gain is normalized',
);
equal(
  engine.six7_set_digital_output_gain(dx7s, 0),
  0,
  'the DX7S output gain is denormalized',
);
engine.six7_destroy(dx7s);

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}

console.log('\nall engine checks passed');
