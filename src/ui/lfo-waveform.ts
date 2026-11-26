/**
 * The LFO illustration on the right side of the LCD, shown while one of the
 * LFO parameters is being edited.
 *
 * It is a diagram, not a scope.  The waveform parameter picks the shape,
 * LFO SPEED sets how many cycles span the field, and LFO DELAY leaves a
 * flat lead and a fade-in.  PM DEPTH bends the note's pitch and AM DEPTH
 * tremoloes its loudness, so both depths are drawn as the same LFO wave at
 * their own amplitude: the amplitude-modulation line in the display's ink
 * and the slightly lighter pitch-modulation line over it.  A zero depth is
 * a flat line, since it has no audible effect.
 */

import {
  VOICE_LFO_AMD_OFFSET,
  VOICE_LFO_DELAY_OFFSET,
  VOICE_LFO_PMD_OFFSET,
  VOICE_LFO_SPEED_OFFSET,
  VOICE_LFO_WAVE_OFFSET,
} from '../audio/protocol';

const SVG_NS = 'http://www.w3.org/2000/svg';

const VIEW_WIDTH = 200;
const VIEW_HEIGHT = 100;
const CENTER_Y = VIEW_HEIGHT / 2;
const MAX_AMPLITUDE = 34;
/**
 * The field is sampled on a coarse dot grid - a fixed number of columns with
 * the height snapped to a row step - and drawn as a staircase, so the wave
 * reads like the LCD's pixels instead of a smooth vector curve.  Fewer
 * samples than a smooth plot also means less work on every redraw.
 */
const COLUMNS = 192;
const COLUMN_WIDTH = VIEW_WIDTH / COLUMNS;
const ROW_HEIGHT = 2;
/** The fraction of the field a non-zero delay spends fading the LFO in. */
const FADE_FRACTION = 0.14;

const WAVEFORM_NAMES = [
  'triangle',
  'saw down',
  'saw up',
  'square',
  'sine',
  'sample and hold',
];

export type LfoFocus = 'wave' | 'speed' | 'delay' | 'pmd' | 'amd';

export interface LfoWaveform {
  readonly element: HTMLElement;
  /** Draw the LFO of a voice dump, or hide the diagram. */
  setWaveform(data: Uint8Array | null): boolean;
}

export function lfoFocusForButton(button: number): LfoFocus | null {
  switch (button) {
    case 9:
      return 'wave';
    case 10:
      return 'speed';
    case 11:
      return 'delay';
    case 12:
      return 'pmd';
    case 13:
      return 'amd';
    default:
      return null;
  }
}

export function createLfoWaveform(): LfoWaveform {
  const element = document.createElement('div');
  element.className = 'lfo-waveform';
  element.hidden = true;

  return {
    element,
    setWaveform(data: Uint8Array | null): boolean {
      if (data === null) {
        element.hidden = true;
        element.replaceChildren();
        element.removeAttribute('aria-label');
        return false;
      }
      const params: LfoParams = {
        wave: clamp(data[VOICE_LFO_WAVE_OFFSET] ?? 0, 0, 5),
        speed: clamp(data[VOICE_LFO_SPEED_OFFSET] ?? 0, 0, 99),
        delay: clamp(data[VOICE_LFO_DELAY_OFFSET] ?? 0, 0, 99),
        pmd: clamp(data[VOICE_LFO_PMD_OFFSET] ?? 0, 0, 99),
        amd: clamp(data[VOICE_LFO_AMD_OFFSET] ?? 0, 0, 99),
      };
      element.hidden = false;
      element.setAttribute('role', 'img');
      element.setAttribute('aria-label', describe(params));
      element.replaceChildren(renderLfo(params));
      return true;
    },
  };
}

interface LfoParams {
  readonly wave: number;
  readonly speed: number;
  readonly delay: number;
  readonly pmd: number;
  readonly amd: number;
}

function renderLfo(params: LfoParams): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`);
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.setAttribute('aria-hidden', 'true');

  const cycles = 1 + (params.speed / 99) * 10;
  const delayFraction = (params.delay / 99) * 0.6;
  const wave = (t: number): number =>
    lfoValue(params.wave, t * cycles) * fadeIn(t, delayFraction);

  appendCurve(svg, (t) => wave(t) * (params.amd / 99), 'lfo-wave');
  appendCurve(svg, (t) => wave(t) * (params.pmd / 99), 'lfo-wave lfo-pitch');
  return svg;
}

function appendCurve(
  svg: SVGSVGElement,
  evaluate: (t: number) => number,
  className: string,
): void {
  const snap = (y: number): number =>
    CENTER_Y + Math.round((y - CENTER_Y) / ROW_HEIGHT) * ROW_HEIGHT;

  let path = '';
  for (let index = 0; index <= COLUMNS; index += 1) {
    const t = index / COLUMNS;
    const x = index * COLUMN_WIDTH;
    const y = snap(CENTER_Y - evaluate(t) * MAX_AMPLITUDE);
    // A staircase: step across at the previous height, then drop to the
    // sample's height.  The coarse grid is what gives the pixel look.
    path +=
      index === 0
        ? `M${x.toFixed(2)} ${y.toFixed(2)}`
        : `H${x.toFixed(2)}V${y.toFixed(2)}`;
  }
  const curve = document.createElementNS(SVG_NS, 'path');
  curve.setAttribute('d', path);
  curve.setAttribute('class', className);
  curve.setAttribute('vector-effect', 'non-scaling-stroke');
  svg.append(curve);
}

/** The LFO's value at a phase, in -1..1, for the hardware's waveforms. */
function lfoValue(wave: number, phase: number): number {
  const p = phase - Math.floor(phase);
  switch (wave) {
    case 0: // triangle
      return 1 - 4 * Math.abs(p - 0.5);
    case 1: // saw down
      return 1 - 2 * p;
    case 2: // saw up
      return 2 * p - 1;
    case 3: // square
      return p < 0.5 ? 1 : -1;
    case 4: // sine
      return Math.sin(2 * Math.PI * p);
    case 5: // sample and hold
    default:
      return sampleAndHold(Math.floor(phase * 4));
  }
}

/** A deterministic held value per step, so a redraw does not jitter. */
function sampleAndHold(index: number): number {
  const noise = Math.sin(index * 12.9898 + 78.233) * 43758.5453;
  return ((noise - Math.floor(noise)) * 2 - 1) * 0.9;
}

function fadeIn(t: number, delayFraction: number): number {
  if (delayFraction <= 0) {
    return 1;
  }
  if (t <= delayFraction) {
    return 0;
  }
  return Math.min(1, (t - delayFraction) / FADE_FRACTION);
}

function describe(params: LfoParams): string {
  const name = WAVEFORM_NAMES[params.wave] ?? 'triangle';
  return `LFO ${name} waveform, speed ${params.speed}, delay ${params.delay}, pitch depth ${params.pmd}, amplitude depth ${params.amd}`;
}

function clamp(value: number, min: number, max: number): number {
  const rounded = Math.round(value);
  if (!Number.isFinite(rounded)) {
    return min;
  }
  return Math.max(min, Math.min(max, rounded));
}
