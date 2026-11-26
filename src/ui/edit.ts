import {
  VOICE_ALGORITHM_OFFSET,
  VOICE_LFO_AMD_OFFSET,
  VOICE_LFO_DELAY_OFFSET,
  VOICE_LFO_PMD_OFFSET,
  VOICE_LFO_SPEED_OFFSET,
  VOICE_LFO_WAVE_OFFSET,
  VOICE_NAME_LENGTH,
  VOICE_NAME_OFFSET,
} from '../audio/protocol';
import { noteName } from './computer-keyboard';

export type EditSubGroup = 'osc' | 'eg' | 'scale' | null;

export type EditKind = 'value' | 'name';

export interface EditView {
  readonly button: number;
  readonly sub: number;
  readonly offset: number;
  readonly max: number;
  readonly kind: EditKind;
  readonly value: number;
  readonly lineOne: string;
  readonly lineTwo: string;
  /** The column of the name cursor inside lineTwo; null when there is none. */
  readonly cursorColumn: number | null;
  readonly valueText: string;
}

interface ParamDef {
  readonly max: number;
  readonly sub?: Exclude<EditSubGroup, null>;
  readonly scope: (sub: number) => 'operator' | 'patch';
  readonly offset: (sub: number) => number;
}

const OPERATOR_BLOCKS = 6;
const OPERATOR_BLOCK_SIZE = 21;
const NAME_CHAR_MIN = 32;
const NAME_CHAR_MAX = 126;
const NAME_CHAR_COUNT = NAME_CHAR_MAX - NAME_CHAR_MIN + 1;

const PARAMS: Readonly<Record<number, ParamDef>> = {
  7: { max: 31, scope: () => 'patch', offset: () => 134 },
  8: { max: 7, scope: () => 'patch', offset: () => 135 },
  9: { max: 5, scope: () => 'patch', offset: () => VOICE_LFO_WAVE_OFFSET },
  10: { max: 99, scope: () => 'patch', offset: () => VOICE_LFO_SPEED_OFFSET },
  11: { max: 99, scope: () => 'patch', offset: () => VOICE_LFO_DELAY_OFFSET },
  12: { max: 99, scope: () => 'patch', offset: () => VOICE_LFO_PMD_OFFSET },
  13: { max: 99, scope: () => 'patch', offset: () => VOICE_LFO_AMD_OFFSET },
  14: { max: 1, scope: () => 'patch', offset: () => 141 },
  15: { max: 7, scope: () => 'patch', offset: () => 143 },
  16: { max: 3, scope: () => 'operator', offset: () => 14 },
  17: {
    max: 1,
    sub: 'osc',
    scope: (sub) => (sub === 0 ? 'operator' : 'patch'),
    offset: (sub) => (sub === 0 ? 17 : 136),
  },
  18: { max: 31, scope: () => 'operator', offset: () => 18 },
  19: { max: 99, scope: () => 'operator', offset: () => 19 },
  20: { max: 14, scope: () => 'operator', offset: () => 20 },
  21: {
    max: 99,
    sub: 'eg',
    scope: () => 'operator',
    offset: (sub) => 0 + sub,
  },
  22: {
    max: 99,
    sub: 'eg',
    scope: () => 'operator',
    offset: (sub) => 4 + sub,
  },
  23: { max: 99, scope: () => 'operator', offset: () => 8 },
  24: {
    max: 3,
    sub: 'scale',
    scope: () => 'operator',
    offset: (sub) => 11 + sub,
  },
  25: {
    max: 99,
    sub: 'scale',
    scope: () => 'operator',
    offset: (sub) => 9 + sub,
  },
  26: { max: 7, scope: () => 'operator', offset: () => 13 },
  27: { max: 99, scope: () => 'operator', offset: () => 16 },
  28: { max: 7, scope: () => 'operator', offset: () => 15 },
  29: {
    max: 99,
    sub: 'eg',
    scope: () => 'patch',
    offset: (sub) => 126 + sub,
  },
  30: {
    max: 99,
    sub: 'eg',
    scope: () => 'patch',
    offset: (sub) => 130 + sub,
  },
  31: { max: 48, scope: () => 'patch', offset: () => 144 },
};

const NAME_LINE_PREFIX = 'NAME= ';
const WAVEFORMS = ['TRIANGL', 'SAW DWN', 'SAW UP', 'SQUARE', 'SINE', 'S/HOLD'];
const CURVES = ['-LIN', '-EXP', '+EXP', '+LIN'];

export function editSubGroup(button: number): EditSubGroup {
  if (button === 32) {
    return null;
  }
  return PARAMS[button]?.sub ?? null;
}

export function createEditView(
  button: number,
  sub: number,
  operatorIndex: number,
  data: Uint8Array,
  nameCursor: number,
): EditView | null {
  if (button === 32) {
    const cursor = clampInt(nameCursor, 0, VOICE_NAME_LENGTH - 1);
    const offset = VOICE_NAME_OFFSET + cursor;
    const raw = data[offset] ?? 0;
    const code = clampInt(raw, NAME_CHAR_MIN, NAME_CHAR_MAX);
    const name = rawName(data);
    const before = name.slice(0, cursor);
    const current = name[cursor] ?? ' ';
    const after = name.slice(cursor + 1);
    const lineTwo = `${NAME_LINE_PREFIX}${before}${current}${after}`;
    return {
      button,
      sub: 0,
      offset,
      max: NAME_CHAR_COUNT - 1,
      kind: 'name',
      value: code - NAME_CHAR_MIN,
      lineOne: algorithmLine(data, operatorIndex, false),
      lineTwo,
      cursorColumn: NAME_LINE_PREFIX.length + cursor,
      valueText: lineTwo,
    };
  }

  const def = PARAMS[button];
  if (def === undefined) {
    return null;
  }

  const local = def.scope(sub) === 'operator';
  const offset =
    (local
      ? clampInt(operatorIndex, 0, OPERATOR_BLOCKS - 1) * OPERATOR_BLOCK_SIZE
      : 0) + def.offset(sub);
  const value = clampInt(data[offset] ?? 0, 0, def.max);
  const operatorField = isOperatorField(button, sub);
  const lineOne = algorithmLine(data, operatorIndex, operatorField);
  const lineTwo = formatLineTwo(button, sub, value);
  return {
    button,
    sub,
    offset,
    max: def.max,
    kind: 'value',
    value,
    lineOne,
    lineTwo,
    cursorColumn: null,
    valueText: lineTwo,
  };
}

function isOperatorField(button: number, sub: number): boolean {
  if (button < 16 || button > 28) {
    return false;
  }
  return !(button === 17 && sub === 1);
}

function algorithmLine(
  data: Uint8Array,
  operatorIndex: number,
  operatorField: boolean,
): string {
  const algorithm = clampInt(data[VOICE_ALGORITHM_OFFSET] ?? 0, 0, 31) + 1;
  const enabled = data[155] ?? 0x3f;
  let bits = '';
  for (let bit = OPERATOR_BLOCKS - 1; bit >= 0; bit -= 1) {
    bits += ((enabled >> bit) & 1) !== 0 ? '1' : '0';
  }
  let line = `ALG ${algorithm} ${bits}`;
  if (operatorField) {
    line += ` OP${OPERATOR_BLOCKS - clampInt(operatorIndex, 0, 5)}`;
  }
  return line;
}

function formatLineTwo(button: number, sub: number, value: number): string {
  switch (button) {
    case 7:
      return `ALGORITHM SELECT ${value + 1}`;
    case 8:
      return `FEEDBACK ${value}`;
    case 9:
      return `LFO WAVE=${WAVEFORMS[value] ?? ''}`;
    case 10:
      return `LFO SPEED ${value}`;
    case 11:
      return `LFO DELAY ${value}`;
    case 12:
      return `LFO PM DEPTH ${value}`;
    case 13:
      return `LFO AM DEPTH ${value}`;
    case 14:
      return `LFO KEY SYNC= ${onOff(value)}`;
    case 15:
      return `P MOD SENS. ${value}`;
    case 16:
      return `A MOD SENS. ${value}`;
    case 17:
      return sub === 0
        ? value === 0
          ? 'FREQUENCY(RATIO)'
          : 'FIXED FREQ.(Hz)'
        : `OSC KEY SYNC= ${onOff(value)}`;
    case 18:
      return `F COARSE= ${value}`;
    case 19:
      return `F FINE  = ${value}`;
    case 20:
      return `OSC DETUNE = ${signed(value - 7)}`;
    case 21:
      return `EG  RATE  ${sub + 1} ${value}`;
    case 22:
      return `EG  LEVEL ${sub + 1} ${value}`;
    case 23:
      return `BREAK POINT= ${noteName((value + 20) & 0x7f)}`;
    case 24:
      return `${sub === 0 ? 'L' : 'R'} KEY SCALE= ${CURVES[value] ?? ''}`;
    case 25:
      return `${sub === 0 ? 'L' : 'R'} SCALE DEPTH ${value}`;
    case 26:
      return `RATE SCALING  ${value}`;
    case 27:
      return `OUTPUT LEVEL ${value}`;
    case 28:
      return `KEY VELOCITY  ${value}`;
    case 29:
      return `P EG RATE  ${sub + 1} ${value}`;
    case 30:
      return `P EG LEVEL ${sub + 1} ${value}`;
    case 31:
      return `MIDDLE C = ${noteName((value + 24) & 0x7f)}`;
    default:
      return '';
  }
}

function rawName(data: Uint8Array): string {
  let name = '';
  for (let index = 0; index < VOICE_NAME_LENGTH; index += 1) {
    const code = data[VOICE_NAME_OFFSET + index] ?? 0;
    name +=
      code >= NAME_CHAR_MIN && code <= NAME_CHAR_MAX
        ? String.fromCharCode(code)
        : ' ';
  }
  return name;
}

function onOff(value: number): string {
  return value === 0 ? 'OFF' : 'ON';
}

function signed(value: number): string {
  return value > 0 ? `+${value}` : String(value);
}

function clampInt(value: number, min: number, max: number): number {
  const rounded = Math.round(value);
  if (!Number.isFinite(rounded)) {
    return min;
  }
  if (rounded < min) {
    return min;
  }
  if (rounded > max) {
    return max;
  }
  return rounded;
}
