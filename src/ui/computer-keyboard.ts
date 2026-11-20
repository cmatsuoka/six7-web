/**
 * The computer keyboard's note map.
 *
 * The keys are read by `KeyboardEvent.code`, so the map follows the
 * physical key positions and not the layout. Two rows are mapped: the
 * lower row starts at C and the upper row starts an octave above it.
 */

const KEY_SEMITONE: Readonly<Record<string, number>> = {
  KeyZ: 0,
  KeyS: 1,
  KeyX: 2,
  KeyD: 3,
  KeyC: 4,
  KeyV: 5,
  KeyG: 6,
  KeyB: 7,
  KeyH: 8,
  KeyN: 9,
  KeyJ: 10,
  KeyM: 11,
  Comma: 12,
  KeyL: 13,
  Period: 14,
  Semicolon: 15,
  Slash: 16,

  KeyQ: 12,
  Digit2: 13,
  KeyW: 14,
  Digit3: 15,
  KeyE: 16,
  KeyR: 17,
  Digit5: 18,
  KeyT: 19,
  Digit6: 20,
  KeyY: 21,
  Digit7: 22,
  KeyU: 23,
  KeyI: 24,
};

export interface ComputerKeyboard {
  readonly octave: number;
  setOctave(octave: number): void;
  dispose(): void;
}

export interface KeyboardHandlers {
  onNoteOn(note: number, velocity: number): void;
  onNoteOff(note: number): void;
  onAllNotesOff(): void;
}

export function attachComputerKeyboard(
  handlers: KeyboardHandlers,
  initialOctave = 4,
): ComputerKeyboard {
  let octave = Math.max(1, Math.min(7, initialOctave));
  const held = new Set<number>();

  const noteFor = (code: string): number | null => {
    const semitone = KEY_SEMITONE[code];
    if (semitone === undefined) {
      return null;
    }
    return Math.max(0, Math.min(127, (octave + 1) * 12 + semitone));
  };

  const isEditable = (target: EventTarget | null): boolean => {
    if (!(target instanceof HTMLElement)) {
      return false;
    }
    const tag = target.tagName;
    return (
      tag === 'INPUT' ||
      tag === 'TEXTAREA' ||
      tag === 'SELECT' ||
      target.isContentEditable
    );
  };

  const keydown = (event: KeyboardEvent): void => {
    if (isEditable(event.target)) {
      return;
    }
    const note = noteFor(event.code);
    if (note === null) {
      return;
    }
    event.preventDefault();
    if (event.repeat || held.has(note)) {
      return;
    }
    held.add(note);
    handlers.onNoteOn(note, 100);
  };

  const keyup = (event: KeyboardEvent): void => {
    const note = noteFor(event.code);
    if (note === null || !held.has(note)) {
      return;
    }
    held.delete(note);
    handlers.onNoteOff(note);
  };

  const blur = (): void => {
    held.clear();
    handlers.onAllNotesOff();
  };

  window.addEventListener('keydown', keydown);
  window.addEventListener('keyup', keyup);
  window.addEventListener('blur', blur);

  return {
    get octave(): number {
      return octave;
    },
    setOctave(next: number): void {
      const value = Math.max(1, Math.min(7, Math.round(next)));
      if (value === octave) {
        return;
      }
      held.clear();
      handlers.onAllNotesOff();
      octave = value;
    },
    dispose(): void {
      window.removeEventListener('keydown', keydown);
      window.removeEventListener('keyup', keyup);
      window.removeEventListener('blur', blur);
    },
  };
}

/** The note name, with MIDI 60 as C4. */
export function noteName(note: number): string {
  const names = [
    'C',
    'C#',
    'D',
    'D#',
    'E',
    'F',
    'F#',
    'G',
    'G#',
    'A',
    'A#',
    'B',
  ];
  const name = names[((note % 12) + 12) % 12] ?? '?';
  const octave = Math.floor(note / 12) - 1;
  return `${name}${octave}`;
}
