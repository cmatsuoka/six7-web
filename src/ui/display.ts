/**
 * The display cluster: the two-digit seven-segment program display and the
 * 16×2 character LCD. Both are pure displays: they read the host's
 * selected program and never invent a value.
 */

import {
  KEY_MONO,
  KEY_POLY,
  KEY_UNISON_MONO,
  KEY_UNISON_POLY,
  PEG_RANGE_1_OCTAVE,
  PEG_RANGE_2_OCTAVES,
  PEG_RANGE_8_OCTAVES,
  PEG_RANGE_HALF_OCTAVE,
} from '../audio/protocol';

const SEGMENT_POINTS: Readonly<Record<string, string>> = {
  a: '14,10 86,10 78,20 22,20',
  b: '90,14 90,84 80,74 80,24',
  c: '90,96 90,166 80,156 80,106',
  d: '14,170 86,170 78,160 22,160',
  e: '10,96 10,166 20,156 20,106',
  f: '10,14 10,84 20,74 20,24',
  g: '14,90 22,82 78,82 86,90 78,98 22,98',
};

const DIGIT_SEGMENTS: Readonly<Record<string, readonly string[]>> = {
  '0': ['a', 'b', 'c', 'd', 'e', 'f'],
  '1': ['b', 'c'],
  '2': ['a', 'b', 'g', 'e', 'd'],
  '3': ['a', 'b', 'g', 'c', 'd'],
  '4': ['f', 'g', 'b', 'c'],
  '5': ['a', 'f', 'g', 'c', 'd'],
  '6': ['a', 'f', 'g', 'e', 'c', 'd'],
  '7': ['a', 'b', 'c'],
  '8': ['a', 'b', 'c', 'd', 'e', 'f', 'g'],
  '9': ['a', 'b', 'c', 'd', 'f', 'g'],
  ' ': [],
};

const SVG_NS = 'http://www.w3.org/2000/svg';

const WIDE_LINE_COLUMNS = 48;
const SECOND_LINE_COLUMNS = 25;

export interface PatchDetails {
  /** The voice's algorithm, 1..32 as the panel numbers it. */
  readonly algorithm: number;
  /** The DX7S pitch-EG range (depth), from the additional voice data. */
  readonly pegRange: number;
  /** The DX7S key mode, from the additional voice data. */
  readonly keyMode: number;
  /** The unison detune, 0..7, active in the unison modes. */
  readonly unisonDetune: number;
}

export interface Display {
  readonly element: HTMLElement;
  /** Show a 1-based program number, or blank both digits. */
  setProgram(program: number | null): void;
  /** Set both LCD lines; the second is padded to its full width. */
  setLines(first: string, second: string): void;
  /** Show the current voice's algorithm, PEG depth and key mode. */
  setPatchDetails(details: PatchDetails | null): void;
}

export function createDisplay(): Display {
  const element = document.createElement('div');
  element.className = 'display-cluster';

  const led = document.createElement('div');
  led.className = 'program-window';

  const ledLabel = document.createElement('span');
  ledLabel.className = 'display-label';
  ledLabel.textContent = 'PROGRAM';

  const digits = document.createElement('div');
  digits.className = 'seven-segment';
  digits.setAttribute('role', 'img');
  digits.setAttribute('aria-label', 'program number');

  const digitA = createDigit();
  const digitB = createDigit();
  digits.append(digitA.element, digitB.element);

  led.append(ledLabel, digits);

  const lcdShell = document.createElement('div');
  lcdShell.className = 'lcd-shell';

  const lcd = document.createElement('div');
  lcd.className = 'lcd';
  lcd.setAttribute('role', 'img');
  lcd.setAttribute('aria-label', 'bank name and voice name');

  const lineOne = document.createElement('div');
  lineOne.className = 'lcd-line';
  const lineTwo = document.createElement('div');
  lineTwo.className = 'lcd-line';
  const detail = document.createElement('div');
  detail.className = 'lcd-detail';
  lcd.append(lineOne, lineTwo, detail);
  lcdShell.append(lcd);

  element.append(led, lcdShell);

  return {
    element,
    setProgram(program: number | null): void {
      if (program === null || !Number.isFinite(program)) {
        digitA.show(' ');
        digitB.show(' ');
        digits.setAttribute('aria-label', 'no program selected');
        return;
      }
      const value = Math.max(0, Math.min(99, Math.round(program)));
      const text = String(value);
      // The hardware leaves the tens digit dark below 10; it does not show
      // a leading zero.
      if (text.length === 1) {
        digitA.show(' ');
        digitB.show(text);
      } else {
        digitA.show(text[0] ?? ' ');
        digitB.show(text[1] ?? ' ');
      }
      digits.setAttribute('aria-label', `program ${value}`);
    },
    setLines(first: string, second: string): void {
      lineOne.textContent = fitLine(first, WIDE_LINE_COLUMNS);
      lineTwo.textContent = fitLine(second, SECOND_LINE_COLUMNS);
      updateAria();
    },
    setPatchDetails(details: PatchDetails | null): void {
      detail.textContent =
        details === null ? '' : formatPatchDetails(details);
      updateAria();
    },
  };

  function updateAria(): void {
    const parts = [lineOne.textContent, lineTwo.textContent, detail.textContent];
    lcd.setAttribute(
      'aria-label',
      parts.filter((part) => part !== null && part !== '').join('; '),
    );
  }
}

interface Digit {
  readonly element: SVGSVGElement;
  show(character: string): void;
}

function createDigit(): Digit {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 100 180');
  svg.setAttribute('class', 'digit');
  svg.setAttribute('aria-hidden', 'true');

  const segments = new Map<string, SVGPolygonElement>();
  for (const [name, points] of Object.entries(SEGMENT_POINTS)) {
    const polygon = document.createElementNS(SVG_NS, 'polygon');
    polygon.setAttribute('points', points);
    polygon.setAttribute('class', 'segment');
    svg.append(polygon);
    segments.set(name, polygon);
  }

  return {
    element: svg,
    show(character: string): void {
      const lit = new Set(DIGIT_SEGMENTS[character] ?? []);
      for (const [name, polygon] of segments) {
        polygon.classList.toggle('lit', lit.has(name));
      }
    },
  };
}

function formatPatchDetails(details: PatchDetails): string {
  const algorithm = `ALG ${String(details.algorithm).padStart(2, '0')}`;
  const peg = `PEG ${pegRangeLabel(details.pegRange)}`;
  const mode = keyModeLabel(details.keyMode);
  const unison = isUnison(details.keyMode)
    ? `DETUNE ${details.unisonDetune}`
    : 'UNISON OFF';
  return `${algorithm} · ${peg} · ${mode} · ${unison}`;
}

function pegRangeLabel(pegRange: number): string {
  switch (pegRange) {
    case PEG_RANGE_2_OCTAVES:
      return '2';
    case PEG_RANGE_1_OCTAVE:
      return '1';
    case PEG_RANGE_HALF_OCTAVE:
      return '1/2';
    case PEG_RANGE_8_OCTAVES:
    default:
      return '8';
  }
}

function keyModeLabel(keyMode: number): string {
  switch (keyMode) {
    case KEY_MONO:
      return 'MONO';
    case KEY_UNISON_POLY:
      return 'UNISON POLY';
    case KEY_UNISON_MONO:
      return 'UNISON MONO';
    case KEY_POLY:
    default:
      return 'POLY';
  }
}

function isUnison(keyMode: number): boolean {
  return keyMode === KEY_UNISON_POLY || keyMode === KEY_UNISON_MONO;
}

function fitLine(text: string, columns: number): string {
  const clean = text.replace(/[\r\n\t]/g, ' ');
  return clean.padEnd(columns, ' ').slice(0, columns);
}
