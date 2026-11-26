/**
 * The envelope illustration on the right side of the LCD, shown while an
 * operator EG or the patch pitch EG is being edited.
 *
 * It is a diagram, not a scope.  The four levels set the heights of the
 * breakpoints and the four rates set how long each stage lasts: a low rate
 * is a long stage, a high rate a short one.  The envelope starts at L4,
 * runs to L1, L2 and L3, holds L3 for the key's sustain and releases to
 * L4.  The amplitude envelope rises from silence; the pitch envelope is
 * centred on its no-change level, 50.  The curve is sampled on the same
 * coarse dot grid as the LFO waveform, so it reads like the LCD's pixels.
 */

import {
  VOICE_PEG_LEVEL_OFFSET,
  VOICE_PEG_RATE_OFFSET,
} from '../audio/protocol';

const SVG_NS = 'http://www.w3.org/2000/svg';

const VIEW_WIDTH = 200;
const VIEW_HEIGHT = 100;
const CENTER_Y = VIEW_HEIGHT / 2;
const X_START = 4;
const X_END = VIEW_WIDTH - 4;
const Y_TOP = 8;
const Y_BOTTOM = VIEW_HEIGHT - 8;
const COLUMNS = 192;
const COLUMN_WIDTH = VIEW_WIDTH / COLUMNS;
const ROW_HEIGHT = 2;
const OPERATOR_BLOCK_SIZE = 21;
/** The pitch envelope's no-change level, in its 0..99 range. */
const PEG_CENTER = 50;
/** The share of the field the held sustain spends before the release. */
const SUSTAIN_SHARE = 0.3;

export type EnvelopeKind = 'eg' | 'peg';

export function envelopeKindForButton(button: number): EnvelopeKind | null {
  switch (button) {
    case 21:
    case 22:
      return 'eg';
    case 29:
    case 30:
      return 'peg';
    default:
      return null;
  }
}

export interface EnvelopeDiagram {
  readonly element: HTMLElement;
  /** Draw an envelope from a voice dump, or hide the diagram. */
  setEnvelope(
    data: Uint8Array | null,
    kind?: EnvelopeKind,
    operatorIndex?: number,
  ): boolean;
}

export function createEnvelopeDiagram(): EnvelopeDiagram {
  const element = document.createElement('div');
  element.className = 'envelope-diagram';
  element.hidden = true;

  return {
    element,
    setEnvelope(
      data: Uint8Array | null,
      kind: EnvelopeKind = 'eg',
      operatorIndex = 0,
    ): boolean {
      if (data === null) {
        element.hidden = true;
        element.replaceChildren();
        element.removeAttribute('aria-label');
        return false;
      }
      const base =
        kind === 'eg'
          ? clamp(operatorIndex, 0, 5) * OPERATOR_BLOCK_SIZE
          : 0;
      const rateStart = kind === 'eg' ? base : VOICE_PEG_RATE_OFFSET;
      const levelStart =
        kind === 'eg' ? base + 4 : VOICE_PEG_LEVEL_OFFSET;
      const rates = [0, 1, 2, 3].map((index) =>
        clamp(data[rateStart + index] ?? 0, 0, 99),
      );
      const levels = [0, 1, 2, 3].map((index) =>
        clamp(data[levelStart + index] ?? 0, 0, 99),
      );
      element.hidden = false;
      element.setAttribute('role', 'img');
      element.setAttribute('aria-label', describe(kind, rates, levels));
      element.replaceChildren(renderEnvelope(kind, rates, levels));
      return true;
    },
  };
}

interface Breakpoint {
  readonly t: number;
  readonly value: number;
}

function renderEnvelope(
  kind: EnvelopeKind,
  rates: readonly number[],
  levels: readonly number[],
): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`);
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.setAttribute('aria-hidden', 'true');

  const points = envelopePoints(rates, levels);
  const valueAt = sampleEnvelope(points);
  const referenceY = yFor(kind, kind === 'peg' ? PEG_CENTER : 0);
  appendReference(svg, referenceY);

  const releaseT = points[4]?.t ?? 1;
  const releaseX = X_START + releaseT * (X_END - X_START);
  const releaseY = yFor(kind, valueAt(releaseT));
  appendRelease(svg, releaseX, referenceY, releaseY);

  appendCurve(svg, (t) => yFor(kind, valueAt(t)));
  return svg;
}

function appendReference(svg: SVGSVGElement, y: number): void {
  const line = document.createElementNS(SVG_NS, 'line');
  line.setAttribute('x1', String(X_START));
  line.setAttribute('y1', y.toFixed(2));
  line.setAttribute('x2', String(X_END));
  line.setAttribute('y2', y.toFixed(2));
  line.setAttribute('class', 'envelope-reference');
  line.setAttribute('vector-effect', 'non-scaling-stroke');
  svg.append(line);
}

function appendRelease(
  svg: SVGSVGElement,
  x: number,
  fromY: number,
  toY: number,
): void {
  const line = document.createElementNS(SVG_NS, 'line');
  line.setAttribute('x1', x.toFixed(2));
  line.setAttribute('y1', fromY.toFixed(2));
  line.setAttribute('x2', x.toFixed(2));
  line.setAttribute('y2', toY.toFixed(2));
  line.setAttribute('class', 'envelope-release');
  line.setAttribute('vector-effect', 'non-scaling-stroke');
  svg.append(line);
}

/**
 * The envelope's breakpoints in normalised time and level.  The stage
 * lengths come from the rates, the held sustain sits between L3 and the
 * release, and the curve starts and ends on L4.
 */
function envelopePoints(
  rates: readonly number[],
  levels: readonly number[],
): readonly Breakpoint[] {
  const [r1 = 0, r2 = 0, r3 = 0, r4 = 0] = rates;
  const [l1 = 0, l2 = 0, l3 = 0, l4 = 0] = levels;
  const w1 = rateWeight(r1);
  const w2 = rateWeight(r2);
  const w3 = rateWeight(r3);
  const w4 = rateWeight(r4);
  const sustain = (w1 + w2 + w3 + w4) * SUSTAIN_SHARE;
  const total = w1 + w2 + w3 + w4 + sustain;
  const x1 = w1 / total;
  const x2 = (w1 + w2) / total;
  const x3 = (w1 + w2 + w3) / total;
  const xSustain = (w1 + w2 + w3 + sustain) / total;
  return [
    { t: 0, value: l4 },
    { t: x1, value: l1 },
    { t: x2, value: l2 },
    { t: x3, value: l3 },
    { t: xSustain, value: l3 },
    { t: 1, value: l4 },
  ];
}

/** A low rate is a long stage; the weight grows as the rate falls. */
function rateWeight(rate: number): number {
  return Math.pow(2, (99 - rate) / 24);
}

function sampleEnvelope(
  points: readonly Breakpoint[],
): (t: number) => number {
  return (t: number): number => {
    for (let index = 1; index < points.length; index += 1) {
      const from = points[index - 1];
      const to = points[index];
      if (from !== undefined && to !== undefined && t <= to.t) {
        const span = to.t - from.t;
        const u = span <= 0 ? 0 : (t - from.t) / span;
        return from.value + (to.value - from.value) * u;
      }
    }
    return points[points.length - 1]?.value ?? 0;
  };
}

function yFor(kind: EnvelopeKind, value: number): number {
  if (kind === 'peg') {
    const normalised = (value - PEG_CENTER) / PEG_CENTER;
    const amplitude = (Y_BOTTOM - Y_TOP) / 2;
    return CENTER_Y - Math.max(-1, Math.min(1, normalised)) * amplitude;
  }
  return Y_BOTTOM - (value / 99) * (Y_BOTTOM - Y_TOP);
}

function appendCurve(
  svg: SVGSVGElement,
  evaluate: (t: number) => number,
): void {
  const snapY = (y: number): number =>
    CENTER_Y + Math.round((y - CENTER_Y) / ROW_HEIGHT) * ROW_HEIGHT;

  let path = '';
  for (let index = 0; index <= COLUMNS; index += 1) {
    const t = index / COLUMNS;
    const x = X_START + t * (X_END - X_START);
    const y = snapY(evaluate(t));
    path +=
      index === 0
        ? `M${x.toFixed(2)} ${y.toFixed(2)}`
        : `H${x.toFixed(2)}V${y.toFixed(2)}`;
  }
  const curve = document.createElementNS(SVG_NS, 'path');
  curve.setAttribute('d', path);
  curve.setAttribute('class', 'envelope-curve');
  curve.setAttribute('vector-effect', 'non-scaling-stroke');
  svg.append(curve);
}

function describe(
  kind: EnvelopeKind,
  rates: readonly number[],
  levels: readonly number[],
): string {
  const name = kind === 'peg' ? 'pitch envelope' : 'amplitude envelope';
  return `${name}, rates ${rates.join(' ')}, levels ${levels.join(' ')}`;
}

function clamp(value: number, min: number, max: number): number {
  const rounded = Math.round(value);
  if (!Number.isFinite(rounded)) {
    return min;
  }
  return Math.max(min, Math.min(max, rounded));
}
