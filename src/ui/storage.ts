import {
  base64ToBytes,
  bytesToBase64,
  decodeBank,
  encodeBank,
  makeVoice,
  type Bank,
  type StoredBank,
  type Voice,
} from './bank';
import {
  BANK_VOICE_COUNT,
  VOICE_DUMP_SIZE,
  type VoiceExtensions,
} from '../audio/protocol';

const BANKS_KEY = 'six7.banks.v1';
const INTERNAL_KEY = 'six7.internal.v1';

function read(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // A full or unavailable store is not fatal: the session still works.
  }
}

function remove(key: string): void {
  try {
    window.localStorage.removeItem(key);
  } catch {
    // Nothing to do.
  }
}

/** The user's banks. A malformed entry is discarded. */
export function loadBanks(): Bank[] {
  const raw = read(BANKS_KEY);
  if (raw === null) {
    return [];
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    remove(BANKS_KEY);
    return [];
  }

  if (!Array.isArray(parsed)) {
    remove(BANKS_KEY);
    return [];
  }

  const banks: Bank[] = [];
  for (const entry of parsed) {
    const bank = decodeBank(entry as StoredBank);
    if (bank !== null) {
      banks.push(bank);
    }
  }
  return banks;
}

/** Persist the user's banks. The starter bank is never stored. */
export function saveBanks(banks: readonly Bank[]): void {
  const stored: StoredBank[] = [];
  for (const bank of banks) {
    if (bank.builtin === true) {
      continue;
    }
    const entry = encodeBank(bank);
    if (entry !== null) {
      stored.push(entry);
    }
  }
  if (stored.length === 0) {
    remove(BANKS_KEY);
    return;
  }
  write(BANKS_KEY, JSON.stringify(stored));
}

/**
 * The internal memory: the voices the user stored in the internal
 * positions. A position without a stored voice is null, and keeps the
 * initial voice the starter bank generates.
 */
export function loadInternalMemory(): (Voice | null)[] {
  const slots: (Voice | null)[] = new Array(BANK_VOICE_COUNT).fill(null);
  const raw = read(INTERNAL_KEY);
  if (raw === null) {
    return slots;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    remove(INTERNAL_KEY);
    return slots;
  }

  if (!Array.isArray(parsed)) {
    remove(INTERNAL_KEY);
    return slots;
  }

  for (const [index, entry] of parsed.entries()) {
    if (index >= BANK_VOICE_COUNT) {
      break;
    }
    const voice = decodeInternalVoice(entry);
    if (voice !== null) {
      slots[index] = voice;
    }
  }
  return slots;
}

/** Persist the internal memory. Only the stored positions are written. */
export function saveInternalMemory(voices: readonly (Voice | null)[]): void {
  const stored = voices.map((voice) =>
    voice === null
      ? null
      : {
          data: bytesToBase64(voice.data),
          extensions: voice.extensions ?? null,
        },
  );
  if (stored.every((entry) => entry === null)) {
    remove(INTERNAL_KEY);
    return;
  }
  write(INTERNAL_KEY, JSON.stringify(stored));
}

/** A malformed entry is discarded, not fatal. */
function decodeInternalVoice(entry: unknown): Voice | null {
  if (typeof entry !== 'object' || entry === null) {
    return null;
  }
  const { data, extensions } = entry as {
    data?: unknown;
    extensions?: unknown;
  };
  if (typeof data !== 'string') {
    return null;
  }

  let bytes: Uint8Array;
  try {
    bytes = base64ToBytes(data);
  } catch {
    return null;
  }
  if (bytes.length !== VOICE_DUMP_SIZE) {
    return null;
  }
  return makeVoice(bytes, decodeExtensions(extensions));
}

function decodeExtensions(value: unknown): VoiceExtensions | undefined {
  if (typeof value !== 'object' || value === null) {
    return undefined;
  }
  const entry = value as Record<string, unknown>;
  const field = (raw: unknown, max: number): number => {
    if (typeof raw !== 'number' || !Number.isFinite(raw)) {
      return 0;
    }
    const clamped = Math.round(raw);
    return clamped < 0 ? 0 : clamped > max ? max : clamped;
  };
  return {
    keyMode: field(entry.keyMode, 3),
    unisonDetune: field(entry.unisonDetune, 7),
    pegRange: field(entry.pegRange, 3),
    pegVelocity: field(entry.pegVelocity, 1),
    pegRateScaling: field(entry.pegRateScaling, 7),
    lfoMode: field(entry.lfoMode, 1),
  };
}

const SETTINGS_KEY = 'six7.settings.v1';
export interface StoredSettings {
  sensitivity: number;
}

export function loadSensitivity(): number | null {
  const raw = read(SETTINGS_KEY);
  if (raw === null) {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    !('sensitivity' in parsed) ||
    typeof (parsed as StoredSettings).sensitivity !== 'number'
  ) {
    return null;
  }
  return (parsed as StoredSettings).sensitivity;
}

let sensitivitySaveTimer: ReturnType<typeof setTimeout> | null = null;

export function scheduleSensitivitySave(value: number): void {
  if (sensitivitySaveTimer !== null) {
    clearTimeout(sensitivitySaveTimer);
  }
  sensitivitySaveTimer = setTimeout(() => {
    sensitivitySaveTimer = null;
    try {
      const raw = read(SETTINGS_KEY);
      let settings: StoredSettings = { sensitivity: value };
      if (raw !== null) {
        try {
          const parsed = JSON.parse(raw);
          if (
            typeof parsed === 'object' &&
            parsed !== null &&
            'sensitivity' in parsed
          ) {
            settings = parsed as StoredSettings;
          }
        } catch {
          // Start fresh on malformed data.
        }
      }
      settings.sensitivity = value;
      write(SETTINGS_KEY, JSON.stringify(settings));
    } catch {
      // Nothing we can do.
    }
  }, 500);
}

export function cancelSensitivitySave(): void {
  if (sensitivitySaveTimer !== null) {
    clearTimeout(sensitivitySaveTimer);
    sensitivitySaveTimer = null;
  }
}


