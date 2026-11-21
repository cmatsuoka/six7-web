import { decodeBank, encodeBank, type Bank, type StoredBank } from './bank';

const BANKS_KEY = 'six7.banks.v1';

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


