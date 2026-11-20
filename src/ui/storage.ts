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


