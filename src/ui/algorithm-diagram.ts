/**
 * The operator topology charts for the edit mode's algorithm page.
 *
 * The operators sit on a 6×4 grid of possible positions.  Each algorithm
 * enables the cells its operators occupy and draws a line from every
 * modulator's bottom edge to the near corner of its carrier's top edge,
 * the way the hardware's chart draws them.  The carriers - the operators
 * that modulate nothing - are shaded with the line colour.  A feedback
 * loop wraps around its operator on the chart: it rises from the
 * operator's top centre, runs out on the free side, and its return leg
 * comes back at mid-gap and ends on the operator's own output line, or
 * into the box's underside when the operator's output is the feedback
 * itself.
 */

const SVG_NS = 'http://www.w3.org/2000/svg';

const COLUMNS = 6;
const ROWS = 4;
const CELL_WIDTH = 36;
const CELL_HEIGHT = 26;
const BOX_WIDTH = 30;
const BOX_HEIGHT = 17;
const MARGIN = 6;
const VIEW_WIDTH = MARGIN * 2 + COLUMNS * CELL_WIDTH;
const VIEW_HEIGHT = MARGIN * 2 + ROWS * CELL_HEIGHT;
/* The gap between the boxes of two stacked rows; the feedback loop's
 * return leg runs through its middle. */
const FEEDBACK_LEG_GAP = CELL_HEIGHT - BOX_HEIGHT;

type DiagramNode = readonly [
  operator: number,
  column: number,
  row: number,
];

type DiagramEdge = readonly [from: number, to: number];

interface DiagramFeedback {
  /** The operator whose output is fed back. */
  readonly from: number;
  /** The operator that consumes the feedback. */
  readonly to: number;
  readonly side: 'left' | 'right';
}

interface AlgorithmTopology {
  readonly nodes: readonly DiagramNode[];
  readonly edges: readonly DiagramEdge[];
  readonly feedback?: DiagramFeedback;
}

const ALGORITHMS: Readonly<Record<number, AlgorithmTopology>> = {
  1: {
    nodes: [
      [1, 2, 3],
      [2, 2, 2],
      [3, 3, 3],
      [4, 3, 2],
      [5, 3, 1],
      [6, 3, 0],
    ],
    edges: [
      [6, 5],
      [5, 4],
      [4, 3],
      [2, 1],
    ],
    feedback: { from: 6, to: 6, side: 'right' },
  },
  2: {
    nodes: [
      [1, 2, 3],
      [2, 2, 2],
      [3, 3, 3],
      [4, 3, 2],
      [5, 3, 1],
      [6, 3, 0],
    ],
    edges: [
      [6, 5],
      [5, 4],
      [4, 3],
      [2, 1],
    ],
    feedback: { from: 2, to: 2, side: 'left' },
  },
  3: {
    nodes: [
      [1, 2, 3],
      [2, 2, 2],
      [3, 2, 1],
      [4, 3, 3],
      [5, 3, 2],
      [6, 3, 1],
    ],
    edges: [
      [6, 5],
      [5, 4],
      [3, 2],
      [2, 1],
    ],
    feedback: { from: 6, to: 6, side: 'right' },
  },
  4: {
    nodes: [
      [1, 2, 3],
      [2, 2, 2],
      [3, 2, 1],
      [4, 3, 3],
      [5, 3, 2],
      [6, 3, 1],
    ],
    edges: [
      [6, 5],
      [5, 4],
      [3, 2],
      [2, 1],
    ],
    feedback: { from: 4, to: 6, side: 'right' },
  },
  5: {
    nodes: [
      [1, 2, 3],
      [2, 2, 2],
      [3, 3, 3],
      [4, 3, 2],
      [5, 4, 3],
      [6, 4, 2],
    ],
    edges: [
      [6, 5],
      [4, 3],
      [2, 1],
    ],
    feedback: { from: 6, to: 6, side: 'right' },
  },
  6: {
    nodes: [
      [1, 2, 3],
      [2, 2, 2],
      [3, 3, 3],
      [4, 3, 2],
      [5, 4, 3],
      [6, 4, 2],
    ],
    edges: [
      [6, 5],
      [4, 3],
      [2, 1],
    ],
    feedback: { from: 5, to: 6, side: 'right' },
  },
  7: {
    nodes: [
      [1, 2, 3],
      [2, 2, 2],
      [3, 3, 3],
      [4, 3, 2],
      [5, 4, 2],
      [6, 4, 1],
    ],
    edges: [
      [6, 5],
      [4, 3],
      [5, 3],
      [2, 1],
    ],
    feedback: { from: 6, to: 6, side: 'right' },
  },
  8: {
    nodes: [
      [1, 2, 3],
      [2, 2, 2],
      [3, 3, 3],
      [4, 3, 2],
      [5, 4, 2],
      [6, 4, 1],
    ],
    edges: [
      [6, 5],
      [4, 3],
      [5, 3],
      [2, 1],
    ],
    feedback: { from: 4, to: 4, side: 'left' },
  },
  9: {
    nodes: [
      [1, 2, 3],
      [2, 2, 2],
      [3, 3, 3],
      [4, 3, 2],
      [5, 4, 2],
      [6, 4, 1],
    ],
    edges: [
      [6, 5],
      [4, 3],
      [5, 3],
      [2, 1],
    ],
    feedback: { from: 2, to: 2, side: 'left' },
  },
  10: {
    nodes: [
      [1, 3, 3],
      [2, 3, 2],
      [3, 3, 1],
      [4, 2, 3],
      [5, 1, 2],
      [6, 2, 2],
    ],
    edges: [
      [5, 4],
      [6, 4],
      [3, 2],
      [2, 1],
    ],
    feedback: { from: 3, to: 3, side: 'right' },
  },
  11: {
    nodes: [
      [1, 3, 3],
      [2, 3, 2],
      [3, 3, 1],
      [4, 2, 3],
      [5, 1, 2],
      [6, 2, 2],
    ],
    edges: [
      [5, 4],
      [6, 4],
      [3, 2],
      [2, 1],
    ],
    feedback: { from: 6, to: 6, side: 'right' },
  },
  12: {
    nodes: [
      [1, 4, 3],
      [2, 4, 2],
      [3, 2, 3],
      [4, 1, 2],
      [5, 2, 2],
      [6, 3, 2],
    ],
    edges: [
      [4, 3],
      [5, 3],
      [6, 3],
      [2, 1],
    ],
    feedback: { from: 2, to: 2, side: 'right' },
  },
  13: {
    nodes: [
      [1, 4, 3],
      [2, 4, 2],
      [3, 2, 3],
      [4, 1, 2],
      [5, 2, 2],
      [6, 3, 2],
    ],
    edges: [
      [4, 3],
      [5, 3],
      [6, 3],
      [2, 1],
    ],
    feedback: { from: 6, to: 6, side: 'right' },
  },
  14: {
    nodes: [
      [1, 2, 3],
      [2, 2, 2],
      [3, 3, 3],
      [4, 3, 2],
      [5, 2, 1],
      [6, 3, 1],
    ],
    edges: [
      [5, 4],
      [6, 4],
      [4, 3],
      [2, 1],
    ],
    feedback: { from: 6, to: 6, side: 'right' },
  },
  15: {
    nodes: [
      [1, 2, 3],
      [2, 2, 2],
      [3, 3, 3],
      [4, 3, 2],
      [5, 2, 1],
      [6, 3, 1],
    ],
    edges: [
      [5, 4],
      [6, 4],
      [4, 3],
      [2, 1],
    ],
    feedback: { from: 2, to: 2, side: 'left' },
  },
  16: {
    nodes: [
      [1, 3, 3],
      [2, 2, 2],
      [3, 3, 2],
      [4, 3, 1],
      [5, 4, 2],
      [6, 4, 1],
    ],
    edges: [
      [6, 5],
      [4, 3],
      [2, 1],
      [3, 1],
      [5, 1],
    ],
    feedback: { from: 6, to: 6, side: 'right' },
  },
  17: {
    nodes: [
      [1, 3, 3],
      [2, 2, 2],
      [3, 3, 2],
      [4, 3, 1],
      [5, 4, 2],
      [6, 4, 1],
    ],
    edges: [
      [6, 5],
      [4, 3],
      [2, 1],
      [3, 1],
      [5, 1],
    ],
    feedback: { from: 2, to: 2, side: 'right' },
  },
  18: {
    nodes: [
      [1, 3, 3],
      [2, 2, 2],
      [3, 3, 2],
      [4, 4, 2],
      [5, 4, 1],
      [6, 4, 0],
    ],
    edges: [
      [6, 5],
      [5, 4],
      [2, 1],
      [3, 1],
      [4, 1],
    ],
    feedback: { from: 3, to: 3, side: 'right' },
  },
  19: {
    nodes: [
      [1, 2, 3],
      [2, 2, 2],
      [3, 2, 1],
      [4, 3, 3],
      [5, 4, 3],
      [6, 3, 2],
    ],
    edges: [
      [6, 5],
      [6, 4],
      [3, 2],
      [2, 1],
    ],
    feedback: { from: 6, to: 6, side: 'right' },
  },
  20: {
    nodes: [
      [1, 1, 3],
      [2, 2, 3],
      [3, 1, 2],
      [4, 4, 3],
      [5, 3, 2],
      [6, 4, 2],
    ],
    edges: [
      [5, 4],
      [6, 4],
      [3, 2],
      [3, 1],
    ],
    feedback: { from: 3, to: 3, side: 'right' },
  },
  21: {
    nodes: [
      [1, 1, 3],
      [2, 2, 3],
      [3, 1, 2],
      [4, 3, 3],
      [5, 4, 3],
      [6, 3, 2],
    ],
    edges: [
      [6, 5],
      [6, 4],
      [3, 2],
      [3, 1],
    ],
    feedback: { from: 3, to: 3, side: 'right' },
  },
  22: {
    nodes: [
      [1, 1, 3],
      [2, 1, 2],
      [3, 2, 3],
      [4, 3, 3],
      [5, 4, 3],
      [6, 3, 2],
    ],
    edges: [
      [6, 5],
      [6, 4],
      [6, 3],
      [2, 1],
    ],
    feedback: { from: 6, to: 6, side: 'right' },
  },
  23: {
    nodes: [
      [1, 1, 3],
      [2, 2, 3],
      [3, 2, 2],
      [4, 3, 3],
      [5, 4, 3],
      [6, 3, 2],
    ],
    edges: [
      [6, 5],
      [6, 4],
      [3, 2],
    ],
    feedback: { from: 6, to: 6, side: 'right' },
  },
  24: {
    nodes: [
      [1, 0, 3],
      [2, 1, 3],
      [3, 2, 3],
      [4, 3, 3],
      [5, 4, 3],
      [6, 3, 2],
    ],
    edges: [
      [6, 5],
      [6, 4],
      [6, 3],
    ],
    feedback: { from: 6, to: 6, side: 'right' },
  },
  25: {
    nodes: [
      [1, 0, 3],
      [2, 1, 3],
      [3, 2, 3],
      [4, 3, 3],
      [5, 4, 3],
      [6, 3, 2],
    ],
    edges: [
      [6, 5],
      [6, 4],
    ],
    feedback: { from: 6, to: 6, side: 'right' },
  },
  26: {
    nodes: [
      [1, 1, 3],
      [2, 2, 3],
      [3, 2, 2],
      [4, 4, 3],
      [5, 3, 2],
      [6, 4, 2],
    ],
    edges: [
      [5, 4],
      [6, 4],
      [3, 2],
    ],
    feedback: { from: 6, to: 6, side: 'right' },
  },
  27: {
    nodes: [
      [1, 1, 3],
      [2, 2, 3],
      [3, 2, 2],
      [4, 4, 3],
      [5, 3, 2],
      [6, 4, 2],
    ],
    edges: [
      [5, 4],
      [6, 4],
      [3, 2],
    ],
    feedback: { from: 3, to: 3, side: 'right' },
  },
  28: {
    nodes: [
      [1, 2, 3],
      [2, 2, 2],
      [3, 3, 3],
      [4, 3, 2],
      [5, 3, 1],
      [6, 4, 3],
    ],
    edges: [
      [5, 4],
      [4, 3],
      [2, 1],
    ],
    feedback: { from: 5, to: 5, side: 'right' },
  },
  29: {
    nodes: [
      [1, 1, 3],
      [2, 2, 3],
      [3, 3, 3],
      [4, 3, 2],
      [5, 4, 3],
      [6, 4, 2],
    ],
    edges: [
      [6, 5],
      [4, 3],
    ],
    feedback: { from: 6, to: 6, side: 'right' },
  },
  30: {
    nodes: [
      [1, 1, 3],
      [2, 2, 3],
      [3, 3, 3],
      [4, 3, 2],
      [5, 3, 1],
      [6, 4, 3],
    ],
    edges: [
      [5, 4],
      [4, 3],
    ],
    feedback: { from: 5, to: 5, side: 'right' },
  },
  31: {
    nodes: [
      [1, 0, 3],
      [2, 1, 3],
      [3, 2, 3],
      [4, 3, 3],
      [5, 4, 3],
      [6, 4, 2],
    ],
    edges: [
      [6, 5],
    ],
    feedback: { from: 6, to: 6, side: 'right' },
  },
  32: {
    nodes: [
      [1, 0, 3],
      [2, 1, 3],
      [3, 2, 3],
      [4, 3, 3],
      [5, 4, 3],
      [6, 5, 3],
    ],
    edges: [
    ],
    feedback: { from: 6, to: 6, side: 'right' },
  },
};

export interface AlgorithmDiagram {
  readonly element: HTMLElement;
  /**
   * Show the topology of a 1-based algorithm, or hide the diagram.
   * Returns whether a chart is actually visible.
   */
  setAlgorithm(algorithm: number | null): boolean;
}

export function createAlgorithmDiagram(): AlgorithmDiagram {
  const element = document.createElement('div');
  element.className = 'algorithm-diagram';
  element.hidden = true;

  return {
    element,
    setAlgorithm(algorithm: number | null): boolean {
      const topology =
        algorithm === null ? undefined : ALGORITHMS[algorithm];
      if (topology === undefined) {
        element.hidden = true;
        element.replaceChildren();
        element.removeAttribute('aria-label');
        return false;
      }
      element.hidden = false;
      element.setAttribute('role', 'img');
      element.setAttribute('aria-label', `algorithm ${algorithm} topology`);
      element.replaceChildren(renderTopology(topology));
      return true;
    },
  };
}

function renderTopology(topology: AlgorithmTopology): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`);
  svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
  svg.setAttribute('aria-hidden', 'true');

  const columnShift = centerColumnShift(topology);
  const centers = new Map<number, { x: number; y: number }>();
  const cells = new Map<number, string>();
  for (const [operator, column, row] of topology.nodes) {
    const x = centerX(column + columnShift);
    const cell = `${column + columnShift},${row}`;
    centers.set(operator, { x, y: centerY(row) });
    cells.set(operator, cell);
  }
  const carriers = new Set(topology.nodes.map(([operator]) => operator));
  for (const [from] of topology.edges) {
    carriers.delete(from);
  }
  const occupied = new Set(cells.values());

  for (const [fromOperator, toOperator] of topology.edges) {
    const from = centers.get(fromOperator);
    const to = centers.get(toOperator);
    if (from === undefined || to === undefined) {
      continue;
    }
    /* Diagonal connections meet the modulated operator's top edge at
     * the corner nearest the modulator, like the hardware's chart; a
     * straight drop meets it at the centre. */
    const x2 =
      to.x === from.x ? to.x : to.x > from.x ? to.x - BOX_WIDTH / 2 : to.x + BOX_WIDTH / 2;
    const line = document.createElementNS(SVG_NS, 'line');
    line.setAttribute('x1', String(from.x));
    line.setAttribute('y1', String(from.y + BOX_HEIGHT / 2));
    line.setAttribute('x2', String(x2));
    line.setAttribute('y2', String(to.y - BOX_HEIGHT / 2));
    line.setAttribute('class', 'algorithm-edge');
    svg.append(line);
  }

  if (topology.feedback !== undefined) {
    appendFeedback(
      svg,
      centers,
      occupied,
      cells,
      topology,
      topology.feedback,
    );
  }

  for (const [operator, column, row] of topology.nodes) {
    const x = centerX(column + columnShift);
    const y = centerY(row);
    const box = document.createElementNS(SVG_NS, 'rect');
    box.setAttribute('x', String(x - BOX_WIDTH / 2));
    box.setAttribute('y', String(y - BOX_HEIGHT / 2));
    box.setAttribute('width', String(BOX_WIDTH));
    box.setAttribute('height', String(BOX_HEIGHT));
    box.setAttribute('rx', '2');
    box.setAttribute('class', carrierClass(carriers.has(operator), 'algorithm-node'));
    svg.append(box);

    const label = document.createElementNS(SVG_NS, 'text');
    label.setAttribute('x', String(x));
    label.setAttribute('y', String(y));
    label.setAttribute(
      'class',
      carrierClass(carriers.has(operator), 'algorithm-operator'),
    );
    label.setAttribute('text-anchor', 'middle');
    label.setAttribute('dominant-baseline', 'central');
    label.textContent = String(operator);
    svg.append(label);
  }

  return svg;
}

function carrierClass(carrier: boolean, base: string): string {
  return carrier ? `${base} algorithm-carrier` : base;
}

/**
 * The chart's feedback loop.  It rises from the operator's top centre,
 * runs out on the chart's side, descends past the operator, and its
 * return leg comes back at mid-gap, ending on the operator's own output
 * line; when the operator's only output is the feedback itself the leg
 * closes up into the box's underside.
 */
function appendFeedback(
  svg: SVGSVGElement,
  centers: ReadonlyMap<number, { x: number; y: number }>,
  occupied: ReadonlySet<string>,
  cells: ReadonlyMap<number, string>,
  topology: AlgorithmTopology,
  feedback: DiagramFeedback,
): void {
  const top = centers.get(feedback.to);
  const bottom = centers.get(feedback.from);
  if (top === undefined || bottom === undefined) {
    return;
  }
  const left = feedback.side === 'left';
  const topY = top.y - BOX_HEIGHT / 2;
  const bottomEdgeY = bottom.y + BOX_HEIGHT / 2;
  const legY = bottomEdgeY + FEEDBACK_LEG_GAP / 2;
  const offset = adjacentCell(occupied, cells, feedback.to, left) ? 3 : 4;
  const edgeX = left
    ? top.x - BOX_WIDTH / 2 - offset
    : top.x + BOX_WIDTH / 2 + offset;

  /* The return leg ends on the first output line of the feedback
   * operator that it meets on the chart's own side; a far-side diagonal
   * is behind the operator and not part of the loop. */
  let endX = bottom.x;
  let endY = bottomEdgeY;
  for (const [from, to] of topology.edges) {
    if (from !== feedback.from) {
      continue;
    }
    const target = centers.get(to);
    if (
      target === undefined ||
      target.y <= bottom.y ||
      target.x === bottom.x
    ) {
      continue;
    }
    const targetTopY = target.y - BOX_HEIGHT / 2;
    const crossingX =
      bottom.x + ((legY - bottomEdgeY) / (targetTopY - bottomEdgeY)) *
        (target.x - BOX_WIDTH / 2 - bottom.x);
    const onSide = left ? crossingX <= bottom.x : crossingX >= bottom.x;
    if (!onSide || (left ? crossingX >= endX : crossingX <= endX)) {
      continue;
    }
    endX = crossingX;
    endY = legY;
  }

  const loop = document.createElementNS(SVG_NS, 'path');
  loop.setAttribute(
    'd',
    `M ${top.x} ${topY} V ${topY - 5} H ${edgeX} V ${legY} H ${endX} V ${endY}`,
  );
  loop.setAttribute('class', 'algorithm-feedback');
  svg.append(loop);
}

/** Whether the cell beside the loop's operator on the chart's side holds
 * a box: the loop then hugs the gap between the two boxes. */
function adjacentCell(
  occupied: ReadonlySet<string>,
  cells: ReadonlyMap<number, string>,
  operator: number,
  left: boolean,
): boolean {
  const cell = cells.get(operator);
  if (cell === undefined) {
    return false;
  }
  const [column, row] = cell.split(',');
  const beside = left ? Number(column) - 1 : Number(column) + 1;
  return occupied.has(`${beside},${row}`);
}

/**
 * Even-width charts centre exactly in the six-column grid: a two-wide
 * chart lands on the middle two columns, a four-wide one on the middle
 * four.  Odd widths keep their chart coordinates (they cannot centre on
 * whole columns).
 */
function centerColumnShift(topology: AlgorithmTopology): number {
  let min = COLUMNS;
  let max = -1;
  for (const [, column] of topology.nodes) {
    min = Math.min(min, column);
    max = Math.max(max, column);
  }
  const width = max - min + 1;
  if (width < 1 || width % 2 !== 0) {
    return 0;
  }
  return (COLUMNS - width) / 2 - min;
}

function centerX(column: number): number {
  return MARGIN + column * CELL_WIDTH + CELL_WIDTH / 2;
}

function centerY(row: number): number {
  return MARGIN + row * CELL_HEIGHT + CELL_HEIGHT / 2;
}
