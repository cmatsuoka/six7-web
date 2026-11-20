import {
  BANK_VOICE_COUNT,
  type VoiceExtensions,
} from '../audio/protocol';
import { createInitVoice, parseSysex, voiceName } from './sysex';

/** One program: the engine's 156-byte dump and the name it holds. */
export interface Voice {
  readonly data: Uint8Array;
  readonly name: string;
  readonly extensions?: VoiceExtensions;
}

/** A bank of voices. The starter bank is generated, never stored. */
export interface Bank {
  readonly id: string;
  readonly name: string;
  readonly voices: readonly Voice[];
  readonly builtin?: boolean;
  /** The SYSEX this bank was parsed from, so it can be parsed again. */
  readonly raw?: Uint8Array;
}

/** A bank as it is written to the browser's store: its raw SYSEX only. */
export interface StoredBank {
  readonly id: string;
  readonly name: string;
  /** The SYSEX the bank was parsed from, base64 encoded. */
  readonly raw: string;
}

export function makeVoice(
  data: Uint8Array,
  extensions?: VoiceExtensions,
): Voice {
  return { data, name: voiceName(data), extensions };
}

export function makeBank(
  id: string,
  name: string,
  voices: readonly Uint8Array[],
  extensions: readonly (VoiceExtensions | undefined)[] = [],
  raw?: Uint8Array,
): Bank {
  return {
    id,
    name,
    voices: voices.map((data, index) => makeVoice(data, extensions[index])),
    raw,
  };
}

/**
 * Parse a stored bank again from its original SYSEX.  This keeps parser
 * changes live without a delete-and-reload; a bank stored before the raw
 * data was kept returns null and stays as it was parsed.
 */
export function reparseBank(bank: Bank): Bank | null {
  const raw = bank.raw;
  if (raw === undefined) {
    return null;
  }

  const parsed = parseSysex(raw);
  const dump = parsed.dumps[0];
  if (dump === undefined) {
    return null;
  }

  return {
    ...bank,
    voices: dump.voices.map((data, index) =>
      makeVoice(data, dump.extensions[index]),
    ),
  };
}

/** The generated starter bank: the application's own initial voice. */
export function createStarterBank(): Bank {
  const voices: Voice[] = [];
  for (let slot = 0; slot < BANK_VOICE_COUNT; slot += 1) {
    voices.push(makeVoice(createInitVoice(slot)));
  }
  return {
    id: 'starter',
    name: 'INIT BANK',
    voices,
    builtin: true,
  };
}

export function newBankId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `bank-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

/** A display name for a loaded file: its base name, without the suffix. */
export function bankNameFromFile(fileName: string): string {
  const base = fileName.replace(/^.*[\\/]/, '').replace(/\.[^.]+$/, '');
  return (base.trim() || 'UNTITLED BANK').toUpperCase();
}

/** Persist only the raw SYSEX; the voices are parsed again on load. */
export function encodeBank(bank: Bank): StoredBank | null {
  if (bank.raw === undefined) {
    return null;
  }
  return {
    id: bank.id,
    name: bank.name,
    raw: bytesToBase64(bank.raw),
  };
}

export function decodeBank(stored: StoredBank): Bank | null {
  if (
    typeof stored.id !== 'string' ||
    typeof stored.name !== 'string' ||
    typeof stored.raw !== 'string'
  ) {
    return null;
  }

  let raw: Uint8Array;
  try {
    raw = base64ToBytes(stored.raw);
  } catch {
    return null;
  }

  const parsed = parseSysex(raw);
  const dump = parsed.dumps[0];
  if (dump === undefined) {
    return null;
  }

  return {
    id: stored.id,
    name: stored.name.slice(0, 24) || 'UNTITLED BANK',
    voices: dump.voices.map((data, index) =>
      makeVoice(data, dump.extensions[index]),
    ),
    raw,
  };
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunk) {
    const slice = bytes.subarray(offset, offset + chunk);
    binary += String.fromCharCode(...slice);
  }
  return btoa(binary);
}

function base64ToBytes(text: string): Uint8Array {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}
