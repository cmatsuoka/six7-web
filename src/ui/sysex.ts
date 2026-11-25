/**
 * DX7-family SYSEX parsing and packed-to-unpacked voice conversion.
 *
 * The engine's dump is the 156-byte unpacked voice layout: six 21-byte
 * operator blocks, the global block at 126, the ten-byte name at 145 and
 * one spare byte. A 32-voice bank carries the same voices packed into 128
 * bytes each; a single voice dump carries 155 unpacked bytes.
 */

import {
  VOICE_ALGORITHM_OFFSET,
  VOICE_DUMP_SIZE,
  VOICE_NAME_LENGTH,
  VOICE_NAME_OFFSET,
  type VoiceExtensions,
} from '../audio/protocol';

const SYSEX_START = 0xf0;
const SYSEX_END = 0xf7;
const MANUFACTURER = 0x43;

const BULK_VOICE_COUNT = 32;
const BULK_VOICE_SIZE = 128;
const BULK_DATA_SIZE = BULK_VOICE_COUNT * BULK_VOICE_SIZE;
const SINGLE_DATA_SIZE = 155;
const ACED_DATA_SIZE = 73;
const AMEM_VOICE_SIZE = 35;
const AMEM_DATA_SIZE = BULK_VOICE_COUNT * AMEM_VOICE_SIZE;

export interface SysexDump {
  /** A bulk bank holds 32 voices; a single dump holds one. */
  readonly kind: 'bulk' | 'single';
  /** The voices, already unpacked into the engine's 156-byte layout. */
  readonly voices: Uint8Array[];
  /** The DX7S parameters that accompany each voice, when the file has them. */
  readonly extensions: readonly (VoiceExtensions | undefined)[];
  /** The SYSEX message (or base plus extension) this dump came from. */
  readonly raw: Uint8Array;
}

interface ExtensionDump {
  readonly kind: 'extensions';
  readonly extensions: readonly VoiceExtensions[];
  readonly raw: Uint8Array;
}

export interface ParsedSysex {
  readonly dumps: SysexDump[];
  readonly warnings: string[];
}

function at(data: Uint8Array, index: number): number {
  return data[index] ?? 0;
}

function concatBytes(first: Uint8Array, second: Uint8Array): Uint8Array {
  const joined = new Uint8Array(first.length + second.length);
  joined.set(first);
  joined.set(second, first.length);
  return joined;
}

/**
 * The DX7 checksum: the low seven bits of the data sum, negated, so that
 * the sum of data and checksum is zero modulo 128.
 */
function checksum(data: Uint8Array, start: number, length: number): number {
  let sum = 0;
  for (let index = 0; index < length; index += 1) {
    sum = (sum + at(data, start + index)) & 0x7f;
  }
  return (128 - sum) & 0x7f;
}

function clampToParameter(value: number, max: number): number {
  if (value <= max) {
    return value;
  }
  return Math.floor((value * max) / 255);
}

/**
 * Unpack one 128-byte packed voice into the engine's 156-byte dump.
 *
 * This is the same conversion the library's validation renderer uses:
 * every packed field keeps its 7-bit value, the paired curve bits and the
 * combined detune/rate-scaling and velocity/amp-mod fields are split, and
 * the out-of-range values are scaled onto their parameter's range.
 */
export function unpackVoice(packed: Uint8Array): Uint8Array {
  const out = new Uint8Array(VOICE_DUMP_SIZE);

  for (let op = 0; op < 6; op += 1) {
    const src = op * 17;
    const dst = op * 21;

    for (let i = 0; i < 11; i += 1) {
      out[dst + i] = clampToParameter(at(packed, src + i) & 0x7f, 99);
    }

    const curves = at(packed, src + 11) & 0x0f;
    const detuneRate = at(packed, src + 12) & 0x7f;
    const velocityAms = at(packed, src + 13) & 0x1f;
    const coarseMode = at(packed, src + 15) & 0x3f;

    out[dst + 11] = curves & 3;
    out[dst + 12] = (curves >> 2) & 3;
    out[dst + 13] = detuneRate & 7;
    out[dst + 14] = velocityAms & 3;
    out[dst + 15] = (velocityAms >> 2) & 7;
    out[dst + 16] = at(packed, src + 14) & 0x7f;
    out[dst + 17] = coarseMode & 1;
    out[dst + 18] = (coarseMode >> 1) & 0x1f;
    out[dst + 19] = at(packed, src + 16) & 0x7f;
    out[dst + 20] = (detuneRate >> 3) & 0x7f;
  }

  for (let i = 0; i < 8; i += 1) {
    out[126 + i] = clampToParameter(at(packed, 102 + i) & 0x7f, 99);
  }

  out[134] = clampToParameter(at(packed, 110) & 0x1f, 31);

  const oscSyncFeedback = at(packed, 111) & 0x0f;
  const lfoPmsWaveSync = at(packed, 116) & 0x7f;

  out[135] = oscSyncFeedback & 7;
  out[136] = oscSyncFeedback >> 3;
  out[137] = at(packed, 112) & 0x7f;
  out[138] = at(packed, 113) & 0x7f;
  out[139] = at(packed, 114) & 0x7f;
  out[140] = at(packed, 115) & 0x7f;
  out[141] = lfoPmsWaveSync & 1;
  out[142] = (lfoPmsWaveSync >> 1) & 7;
  out[143] = lfoPmsWaveSync >> 4;
  out[144] = at(packed, 117) & 0x7f;

  for (let i = 0; i < VOICE_NAME_LENGTH; i += 1) {
    out[VOICE_NAME_OFFSET + i] = at(packed, 118 + i) & 0x7f;
  }

  // The serialiser's per-operator enable extension; the engine reads none
  // of it. The library's own renderer uses this value.
  out[155] = 0x3f;

  return out;
}

/** Unpack the names of a bulk bank without unpacking the voices. */
export function unpackedVoiceName(data: Uint8Array): string {
  let name = '';
  for (let i = 0; i < VOICE_NAME_LENGTH; i += 1) {
    name += String.fromCharCode(at(data, VOICE_NAME_OFFSET + i));
  }
  return name.replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
}

/** The name of a voice dump, or an empty string when the field is blank. */
export function voiceName(data: Uint8Array): string {
  return unpackedVoiceName(data);
}

/** The voice's algorithm, 1-based as the panel numbers it. */
export function voiceAlgorithm(data: Uint8Array): number {
  return Math.max(0, Math.min(31, at(data, VOICE_ALGORITHM_OFFSET))) + 1;
}

/**
 * Parse every DX7-family dump found in a byte stream.
 *
 * Both canonical forms are accepted: the 32-voice bulk dump and the single
 * voice dump. A file may hold several messages; every one becomes a dump.
 * The checksum is checked but a bad one only produces a warning: the voice
 * data itself is still usable.
 */
export function parseSysex(bytes: Uint8Array): ParsedSysex {
  const dumps: SysexDump[] = [];
  const warnings: string[] = [];
  let index = 0;

  const pending: ExtensionDump[] = [];

  while (index < bytes.length) {
    if (at(bytes, index) !== SYSEX_START) {
      index += 1;
      continue;
    }

    let end = index + 1;
    while (end < bytes.length && at(bytes, end) !== SYSEX_END) {
      end += 1;
    }

    if (end >= bytes.length) {
      warnings.push('an unterminated SYSEX message was ignored');
      break;
    }

    const message = bytes.subarray(index, end + 1);
    const parsed = parseMessage(message, warnings);
    if (parsed !== null) {
      if (parsed.kind === 'extensions') {
        if (!attachExtensions(dumps, parsed)) {
          pending.push(parsed);
        }
      } else {
        dumps.push(parsed);
        const match = pending.findIndex(
          (extension) => extension.extensions.length === parsed.voices.length,
        );
        const extension = pending[match];
        if (extension !== undefined) {
          pending.splice(match, 1);
          dumps[dumps.length - 1] = {
            ...parsed,
            extensions: extension.extensions,
            raw: concatBytes(parsed.raw, extension.raw),
          };
        }
      }
    }

    index = end + 1;
  }

  for (const extension of pending) {
    warnings.push(
      'additional voice data without a matching voice dump was ignored',
    );
  }

  if (dumps.length === 0 && warnings.length === 0) {
    warnings.push('the file does not contain a DX7-family voice dump');
  }

  return { dumps, warnings };
}

function attachExtensions(
  dumps: SysexDump[],
  extension: ExtensionDump,
): boolean {
  for (let index = dumps.length - 1; index >= 0; index -= 1) {
    const target = dumps[index];
    if (
      target !== undefined &&
      target.voices.length === extension.extensions.length &&
      target.extensions.every((entry) => entry === undefined)
    ) {
      dumps[index] = {
        ...target,
        extensions: extension.extensions,
        raw: concatBytes(target.raw, extension.raw),
      };
      return true;
    }
  }
  return false;
}

function parseMessage(
  message: Uint8Array,
  warnings: string[],
): SysexDump | ExtensionDump | null {
  if (message.length < 7 || at(message, 1) !== MANUFACTURER) {
    return null;
  }

  const format = at(message, 3);
  const length = (at(message, 4) << 7) | at(message, 5);
  const dataStart = 6;
  const checksumIndex = dataStart + length;

  if (message.length < checksumIndex + 2) {
    if (isKnownFormat(format)) {
      warnings.push('a voice dump is too short and was ignored');
    }
    return null;
  }

  const data = message.subarray(dataStart, checksumIndex);

  if (format === 0x09) {
    if (length !== BULK_DATA_SIZE) {
      warnings.push('a 32-voice dump has an unexpected size and was ignored');
      return null;
    }
    checkChecksum(message, dataStart, length, checksumIndex, warnings);

    const voices: Uint8Array[] = [];
    for (let voice = 0; voice < BULK_VOICE_COUNT; voice += 1) {
      const start = voice * BULK_VOICE_SIZE;
      voices.push(unpackVoice(data.subarray(start, start + BULK_VOICE_SIZE)));
    }
    return {
      kind: 'bulk',
      voices,
      extensions: new Array(BULK_VOICE_COUNT).fill(undefined),
      raw: message.slice(),
    };
  }

  if (format === 0x00) {
    if (length !== SINGLE_DATA_SIZE) {
      warnings.push('a single-voice dump has an unexpected size and was ignored');
      return null;
    }
    checkChecksum(message, dataStart, length, checksumIndex, warnings);

    const voice = new Uint8Array(VOICE_DUMP_SIZE);
    voice.set(data.subarray(0, SINGLE_DATA_SIZE));
    voice[155] = 0x3f;
    return {
      kind: 'single',
      voices: [voice],
      extensions: [undefined],
      raw: message.slice(),
    };
  }

  if (format === 0x05) {
    if (length !== ACED_DATA_SIZE) {
      warnings.push('additional voice data has an unexpected size and was ignored');
      return null;
    }
    checkChecksum(message, dataStart, length, checksumIndex, warnings);
    return {
      kind: 'extensions',
      extensions: [unpackAced(data)],
      raw: message.slice(),
    };
  }

  if (format === 0x06) {
    if (length !== AMEM_DATA_SIZE) {
      warnings.push('an additional voice bank has an unexpected size and was ignored');
      return null;
    }
    checkChecksum(message, dataStart, length, checksumIndex, warnings);

    const extensions: VoiceExtensions[] = [];
    for (let voice = 0; voice < BULK_VOICE_COUNT; voice += 1) {
      extensions.push(unpackAmemVoice(data, voice * AMEM_VOICE_SIZE));
    }
    return { kind: 'extensions', extensions, raw: message.slice() };
  }

  return null;
}

function isKnownFormat(format: number): boolean {
  return (
    format === 0x00 ||
    format === 0x05 ||
    format === 0x06 ||
    format === 0x09
  );
}

function clampField(value: number, max: number): number {
  return value > max ? max : value;
}

function unpackAced(data: Uint8Array): VoiceExtensions {
  return {
    keyMode: clampField(at(data, 16), 3),
    unisonDetune: clampField(at(data, 72), 7),
    pegRange: clampField(at(data, 12), 3),
    pegVelocity: at(data, 14) === 0 ? 0 : 1,
    pegRateScaling: clampField(at(data, 38), 7),
    lfoMode: at(data, 13) === 0 ? 0 : 1,
  };
}

function unpackAmemVoice(data: Uint8Array, offset: number): VoiceExtensions {
  const composite = at(data, offset + 4);
  // Byte 5 packs the pitch-bend range (bits 6..3) with the key mode
  // (bits 1..0).  Byte 34 packs FCCS1SW in bit 3 above the three-bit
  // unison detune, so the detune must be masked, not clamped whole.
  const bendAndMode = at(data, offset + 5);
  return {
    keyMode: bendAndMode & 0x03,
    unisonDetune: at(data, offset + 34) & 0x07,
    pegRange: composite & 0x03,
    pegVelocity: (composite >> 3) & 0x01,
    pegRateScaling: clampField(at(data, offset + 24), 7),
    lfoMode: (composite >> 2) & 0x01,
  };
}

function checkChecksum(
  message: Uint8Array,
  dataStart: number,
  dataLength: number,
  checksumIndex: number,
  warnings: string[],
): void {
  const expected = checksum(message, dataStart, dataLength);
  if (at(message, checksumIndex) !== expected) {
    warnings.push('the SYSEX checksum does not match; the data was still read');
  }
}

/**
 * The application's own initial voice. It is generated here, not taken
 * from any hardware ROM: a simple two-operator-ish patch that is audible
 * on every slot of the starter bank.
 */
export function createInitVoice(slot: number): Uint8Array {
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
    dump[op + 7] = 0;
    // Only operator 1 (the last block) sounds in algorithm 1.
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
  dump[155] = 0x3f;

  const name = `INIT ${String(slot + 1).padStart(2, '0')}`;
  for (let i = 0; i < VOICE_NAME_LENGTH; i += 1) {
    dump[VOICE_NAME_OFFSET + i] =
      i < name.length ? name.charCodeAt(i) & 0x7f : 0x20;
  }

  return dump;
}
