/**
 * SVG renderer for Object-Process Diagrams.
 *
 * Takes a LayoutResult (positioned nodes + routed edges from ELK) and produces
 * an SVG string. Handles:
 *   - Object (rectangle) and Process (ellipse) shapes with OPM styling
 *   - State rounded-rects nested inside objects
 *   - Orthogonal edge routing with state-targeted endpoints, except
 *     "changes" (effect) links, which are straight diagonals sharing one
 *     anchor point per relationship on the process
 *   - Comb-style aggregation (triangle + vertical spine + horizontal stubs,
 *     parts stacked below the whole)
 *   - Invocation links get a distinct double-chevron arrowhead so they
 *     don't read as just another effect link, now that both use open
 *     (non-filled) arrowheads
 *   - Semicircular line jumps at edge crossings (the single, consistent
 *     crossing-decoration convention)
 */
import type { LayoutResult, LayoutNode, LayoutState, LayoutEdge, Point } from './layout.js';
import type { Relationship } from './types.js';

const PAD = 40;                // SVG padding around the diagram
export const OBJECT_COLOR = '#70E483';
export const PROCESS_COLOR = '#3BC3FF';
const FONT = 'Arial, Helvetica, sans-serif';
const AGG_GAP = 15;            // gap between parent bottom and aggregation triangle
const TRI_WIDTH = 16;          // aggregation triangle width
const TRI_HEIGHT = 12;         // aggregation triangle height
const JUMP_R = 7;              // radius of semicircular line jumps at crossings (>= 4x stroke width)
const MIN_CLEARANCE = 12;      // minimum gap kept between independently-drawn parallel segments

/** Render a complete OPD as an SVG string. */
export function renderSvg(layout: LayoutResult): string {
  const w = layout.width + PAD * 2;
  const h = layout.height + PAD * 2;

  const parts: string[] = [];
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">`);
  parts.push(defs());
  parts.push(`<g transform="translate(${PAD}, ${PAD})">`);

  for (const node of layout.nodes) {
    parts.push(renderNode(node));
  }

  const aggGroups = new Map<string, LayoutEdge[]>();
  const otherEdges: LayoutEdge[] = [];
  for (const edge of layout.edges) {
    if (edge.link.relationship === 'consists of') {
      const key = edge.sourceId;
      if (!aggGroups.has(key)) aggGroups.set(key, []);
      aggGroups.get(key)!.push(edge);
    } else {
      otherEdges.push(edge);
    }
  }

  // "changes" (effect) edges are drawn as straight diagonals rather than
  // orthogonal L-bends, and both the consumption (state -> process) and
  // result (process -> state) segments of the same relationship share one
  // anchor point on the process — chosen once, facing the changed object as
  // a whole — instead of each direction computing its own nearby point.
  const changesAnchors = computeChangesAnchors(otherEdges, layout);

  const edgeInfos: { points: Point[]; stroke: string; markerStart: string; markerEnd: string; diagonal: boolean }[] = [];
  for (const edge of otherEdges) {
    const rel = edge.link.relationship;
    const anchor = changesAnchors.get(edge.link.id);
    const points = rel === 'changes' && anchor
      ? computeChangesPoints(edge, anchor, layout)
      : computeEdgePoints(edge, layout);
    if (points.length < 2) continue;

    const sourceIsProcess = isProcessEntity(edge.sourceId, layout);
    const markers = edgeMarkers(rel, edge.id, sourceIsProcess);
    const stroke = edgeStroke(rel, edge.id);

    edgeInfos.push({ points, stroke, markerStart: markers.start, markerEnd: markers.end, diagonal: rel === 'changes' });
  }

  // Diagonal segments are excluded from crossing detection: the hop-arc math
  // assumes a purely horizontal or vertical segment, so a diagonal line
  // can't be a jump owner without drawing an incorrect arc.
  const jumpMap = detectJumps(edgeInfos.map(e => e.diagonal ? [] : e.points));

  for (let i = 0; i < edgeInfos.length; i++) {
    const info = edgeInfos[i];
    const jumps = jumpMap.get(i) ?? [];
    const d = buildPathWithJumps(info.points, jumps);
    parts.push(
      `<path d="${d}" ${info.stroke} ${info.markerStart} ${info.markerEnd} fill="none"/>`,
    );
  }

  const obstacles = edgeInfos.flatMap(e => verticalSegments(e.points));
  for (const [, edges] of aggGroups) {
    parts.push(renderAggregationGroup(edges, layout, obstacles));
  }

  parts.push('</g>');
  parts.push('</svg>');
  return parts.join('\n');
}

function defs(): string {
  return `<defs>
  <filter id="shadow" x="-5%" y="-5%" width="115%" height="115%">
    <feDropShadow dx="3" dy="3" stdDeviation="2" flood-opacity="0.3"/>
  </filter>
  <marker id="arrow" viewBox="0 0 10 10" refX="10" refY="5"
    markerWidth="8" markerHeight="8" orient="auto-start-reverse">
    <path d="M 0 0 L 10 5 L 0 10 z" fill="#333"/>
  </marker>
  <marker id="filled-circle" viewBox="0 0 10 10" refX="5" refY="5"
    markerWidth="8" markerHeight="8" orient="auto">
    <circle cx="5" cy="5" r="4" fill="#333"/>
  </marker>
  <marker id="hollow-circle" viewBox="0 0 10 10" refX="5" refY="5"
    markerWidth="8" markerHeight="8" orient="auto">
    <circle cx="5" cy="5" r="4" fill="white" stroke="#333" stroke-width="1.5"/>
  </marker>
  <marker id="hollow-triangle" viewBox="0 0 10 10" refX="10" refY="5"
    markerWidth="10" markerHeight="10" orient="auto">
    <path d="M 10 0 L 0 5 L 10 10 z" fill="white" stroke="#333" stroke-width="1"/>
  </marker>
  <marker id="hollow-arrow" viewBox="0 0 10 10" refX="10" refY="5"
    markerWidth="8" markerHeight="8" orient="auto">
    <path d="M 0 0 L 10 5 L 0 10 z" fill="white" stroke="#333" stroke-width="1.5"/>
  </marker>
  <marker id="invoke-chevrons" viewBox="0 0 13 10" refX="13" refY="5"
    markerWidth="11" markerHeight="8.5" orient="auto">
    <path d="M 0 0 L 5 5 L 0 10 M 7 0 L 12 5 L 7 10" fill="none" stroke="#333" stroke-width="1.5"/>
  </marker>
</defs>`;
}

function renderNode(node: LayoutNode): string {
  const e = node.entity;
  const isPhysical = e.essence === 'physical';
  const isDashed = e.affiliation === 'environmental';
  const filter = isPhysical ? ' filter="url(#shadow)"' : '';
  const dash = isDashed ? ' stroke-dasharray="8,4"' : '';

  const parts: string[] = [];

  if (e.entityType === 'object') {
    parts.push(
      `<rect x="${node.x}" y="${node.y}" width="${node.width}" height="${node.height}" ` +
      `fill="white" stroke="${OBJECT_COLOR}" stroke-width="2"${dash}${filter}/>`,
    );
    parts.push(
      `<text x="${node.x + node.width / 2}" y="${node.y + 20}" ` +
      `text-anchor="middle" font-family="${FONT}" font-size="14" font-weight="bold" fill="#333">` +
      `${esc(e.name)}</text>`,
    );
    for (const st of node.children) {
      parts.push(renderState(st, node));
    }
  } else {
    const cx = node.x + node.width / 2;
    const cy = node.y + node.height / 2;
    const rx = node.width / 2;
    const ry = node.height / 2;
    parts.push(
      `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" ` +
      `fill="white" stroke="${PROCESS_COLOR}" stroke-width="2"${dash}${filter}/>`,
    );
    parts.push(
      `<text x="${cx}" y="${cy + 5}" ` +
      `text-anchor="middle" font-family="${FONT}" font-size="14" font-weight="bold" fill="#333">` +
      `${esc(e.name)}</text>`,
    );
  }

  return parts.join('\n');
}

function renderState(st: LayoutState, parent: LayoutNode): string {
  const x = parent.x + st.x;
  const y = parent.y + st.y;

  let strokeWidth = '1.5';
  let extraRect = '';

  if (st.initial) {
    strokeWidth = '3';
  }
  if (st.final) {
    extraRect =
      `<rect x="${x + 3}" y="${y + 3}" width="${st.width - 6}" height="${st.height - 6}" ` +
      `rx="6" ry="6" fill="none" stroke="${OBJECT_COLOR}" stroke-width="1"/>`;
  }

  return [
    `<rect x="${x}" y="${y}" width="${st.width}" height="${st.height}" ` +
    `rx="8" ry="8" fill="white" stroke="${OBJECT_COLOR}" stroke-width="${strokeWidth}"/>`,
    extraRect,
    `<text x="${x + st.width / 2}" y="${y + st.height / 2 + 5}" ` +
    `text-anchor="middle" font-family="${FONT}" font-size="12" fill="#333">` +
    `${esc(st.name)}</text>`,
  ].filter(Boolean).join('\n');
}

/**
 * Placement is keyed off OPM role (which endpoint is the process), not off
 * which side happens to be the YAML `subject`/`target` — a link authored
 * `object -> process` and one authored `process -> object` must render
 * identically for a given relationship type.
 */
function edgeMarkers(rel: Relationship, edgeId: string, sourceIsProcess: boolean): { start: string; end: string } {
  switch (rel) {
    case 'handles': // agent link: filled circle at the process
      return circleAtProcess('filled-circle', sourceIsProcess);
    case 'requires': // instrument link: hollow circle at the process
      return circleAtProcess('hollow-circle', sourceIsProcess);
    case 'consumes': // consumption link: solid arrow into the process
      return sourceIsProcess
        ? { start: 'marker-start="url(#arrow)"', end: '' }
        : { start: '', end: 'marker-end="url(#arrow)"' };
    case 'yields': // result link: solid arrow into the object
      return sourceIsProcess
        ? { start: '', end: 'marker-end="url(#arrow)"' }
        : { start: 'marker-start="url(#arrow)"', end: '' };
    case 'invokes': // distinct double-chevron so it doesn't read as another effect link
      return { start: '', end: 'marker-end="url(#invoke-chevrons)"' };
    case 'is a':
      return { start: '', end: 'marker-end="url(#hollow-triangle)"' };
    case 'changes': // effect/consumption/result: open outline arrowhead per the target style
      return { start: '', end: 'marker-end="url(#hollow-arrow)"' };
    default:
      return { start: '', end: 'marker-end="url(#arrow)"' };
  }
}

function circleAtProcess(glyph: 'filled-circle' | 'hollow-circle', sourceIsProcess: boolean): { start: string; end: string } {
  return sourceIsProcess
    ? { start: `marker-start="url(#${glyph})"`, end: '' }
    : { start: '', end: `marker-end="url(#${glyph})"` };
}

function isProcessEntity(id: string, layout: LayoutResult): boolean {
  const node = layout.nodes.find(n => n.id === id);
  return node?.entity.entityType === 'process';
}

function edgeStroke(_rel: Relationship, _edgeId: string): string {
  return 'stroke="#333" stroke-width="1.5"';
}

/**
 * One shared anchor point per "changes" relationship, keyed by the
 * relationship id (shared by its -from and -to edge pair). The anchor faces
 * the changed object as a whole — using the object's center rather than the
 * specific state's position — so both directions read as meeting at the
 * same spot on the process regardless of which side of it the object sits.
 */
function computeChangesAnchors(edges: LayoutEdge[], layout: LayoutResult): Map<string, Point> {
  const anchors = new Map<string, Point>();
  for (const edge of edges) {
    if (edge.link.relationship !== 'changes' || anchors.has(edge.link.id)) continue;
    const processId = isProcessEntity(edge.sourceId, layout) ? edge.sourceId : edge.targetId;
    const objectId = processId === edge.sourceId ? edge.targetId : edge.sourceId;
    const objectCenter = findCenter(objectId, layout);
    if (!objectCenter) continue;
    const anchor = findBorderPoint(processId, layout, objectCenter);
    if (anchor) anchors.set(edge.link.id, anchor);
  }
  return anchors;
}

/** Straight diagonal from the process's shared anchor to the state's border. */
function computeChangesPoints(edge: LayoutEdge, anchor: Point, layout: LayoutResult): Point[] {
  const stateId = edge.sourceState ?? edge.targetState;
  if (!stateId) return [];
  const stateBorder = findBorderPoint(stateId, layout, anchor) ?? anchor;
  return edge.sourceState ? [stateBorder, anchor] : [anchor, stateBorder];
}

function computeEdgePoints(edge: LayoutEdge, layout: LayoutResult): Point[] {
  let points: Point[];

  if (edge.sections.length > 0) {
    points = [];
    for (const section of edge.sections) {
      if (points.length === 0) {
        points.push(section.startPoint);
      }
      if (section.bendPoints) {
        points.push(...section.bendPoints);
      }
      points.push(section.endPoint);
    }
  } else {
    const srcId = edge.sourceState ?? edge.sourceId;
    const tgtId = edge.targetState ?? edge.targetId;
    const srcCenter = findCenter(srcId, layout);
    const tgtCenter = findCenter(tgtId, layout);
    if (!srcCenter || !tgtCenter) return [];

    const dx = tgtCenter.x - srcCenter.x;
    const dy = tgtCenter.y - srcCenter.y;

    if (Math.abs(dy) >= Math.abs(dx)) {
      const exitDir = dy > 0 ? 1 : -1;
      const src = findBorderPoint(srcId, layout, { x: srcCenter.x, y: srcCenter.y + exitDir * 1000 }) ?? srcCenter;
      const tgt = findBorderPoint(tgtId, layout, { x: tgtCenter.x, y: tgtCenter.y - exitDir * 1000 }) ?? tgtCenter;
      // tgt's border point was computed as the top/bottom-facing point on its
      // shape, so the final segment into it must stay vertical (constant
      // tgt.x) — bending at {x:tgt.x, y:src.y} keeps that, instead of
      // bending at {x:src.x, y:tgt.y} which would arrive horizontally and
      // point the arrowhead 90° off from the border it's actually touching.
      if (Math.abs(src.x - tgt.x) < 1) points = [src, tgt];
      else points = [src, { x: tgt.x, y: src.y }, tgt];
    } else {
      const exitDir = dx > 0 ? 1 : -1;
      const src = findBorderPoint(srcId, layout, { x: srcCenter.x + exitDir * 1000, y: srcCenter.y }) ?? srcCenter;
      const tgt = findBorderPoint(tgtId, layout, { x: tgtCenter.x - exitDir * 1000, y: tgtCenter.y }) ?? tgtCenter;
      // Mirror of the branch above: tgt's border point is left/right-facing,
      // so the final segment must stay horizontal (constant tgt.y).
      if (Math.abs(src.y - tgt.y) < 1) points = [src, tgt];
      else points = [src, { x: src.x, y: tgt.y }, tgt];
    }
  }

  if (edge.sourceState && points.length >= 2) {
    const secondY = points[1].y;
    const stateBorder = findStateBorderCenter(edge.sourceState, layout, secondY);
    if (stateBorder) {
      points.splice(0, 1, stateBorder, { x: stateBorder.x, y: secondY });
    }
  }

  if (edge.targetState && points.length >= 2) {
    const n = points.length;
    const prevY = points[n - 2].y;
    const stateBorder = findStateBorderCenter(edge.targetState, layout, prevY);
    if (stateBorder) {
      points.splice(n - 1, 1, { x: stateBorder.x, y: prevY }, stateBorder);
    }
  }

  return cleanPath(points);
}

function segmentIntersect(a1: Point, a2: Point, b1: Point, b2: Point): Point | null {
  const d1x = a2.x - a1.x;
  const d1y = a2.y - a1.y;
  const d2x = b2.x - b1.x;
  const d2y = b2.y - b1.y;

  const denom = d1x * d2y - d1y * d2x;
  if (Math.abs(denom) < 1e-10) return null;

  const t = ((b1.x - a1.x) * d2y - (b1.y - a1.y) * d2x) / denom;
  const u = ((b1.x - a1.x) * d1y - (b1.y - a1.y) * d1x) / denom;

  const eps = 0.01;
  if (t > eps && t < 1 - eps && u > eps && u < 1 - eps) {
    return { x: a1.x + t * d1x, y: a1.y + t * d1y };
  }
  return null;
}

/**
 * Ownership at each crossing is deterministic given a fixed edge order: the
 * horizontal segment hops over the vertical one (standard line-jump
 * convention); when both segments share the same orientation, the
 * later-drawn edge (higher index) hops. Same input always yields the same
 * hop assignment.
 */
function detectJumps(allPaths: Point[][]): Map<number, Point[]> {
  const result = new Map<number, Point[]>();

  for (let a = 0; a < allPaths.length; a++) {
    for (let b = a + 1; b < allPaths.length; b++) {
      const pathA = allPaths[a];
      const pathB = allPaths[b];

      for (let i = 1; i < pathA.length; i++) {
        for (let j = 1; j < pathB.length; j++) {
          const cross = segmentIntersect(pathA[i - 1], pathA[i], pathB[j - 1], pathB[j]);
          if (!cross) continue;

          const isHorizA = Math.abs(pathA[i].y - pathA[i - 1].y) < 1;
          const isHorizB = Math.abs(pathB[j].y - pathB[j - 1].y) < 1;

          let jumpEdge: number;
          if (isHorizA && !isHorizB) {
            jumpEdge = a;
          } else if (isHorizB && !isHorizA) {
            jumpEdge = b;
          } else {
            jumpEdge = b;
          }

          if (!result.has(jumpEdge)) result.set(jumpEdge, []);
          result.get(jumpEdge)!.push(cross);
        }
      }
    }
  }

  return result;
}

function isOnSegment(point: Point, p1: Point, p2: Point): boolean {
  const minX = Math.min(p1.x, p2.x) - 1;
  const maxX = Math.max(p1.x, p2.x) + 1;
  const minY = Math.min(p1.y, p2.y) - 1;
  const maxY = Math.max(p1.y, p2.y) + 1;
  return point.x >= minX && point.x <= maxX && point.y >= minY && point.y <= maxY;
}

function buildPathWithJumps(points: Point[], jumps: Point[]): string {
  if (points.length < 2) return '';

  let d = `M ${points[0].x} ${points[0].y}`;

  for (let i = 1; i < points.length; i++) {
    const p1 = points[i - 1];
    const p2 = points[i];

    const segJumps = jumps.filter(j => isOnSegment(j, p1, p2));
    if (segJumps.length === 0) {
      d += ` L ${p2.x} ${p2.y}`;
      continue;
    }

    segJumps.sort((a, b) => {
      const da = (a.x - p1.x) ** 2 + (a.y - p1.y) ** 2;
      const db = (b.x - p1.x) ** 2 + (b.y - p1.y) ** 2;
      return da - db;
    });

    // Deduplicate jumps that are too close together (would produce overlapping arcs)
    const uniqueJumps: Point[] = [];
    for (const j of segJumps) {
      if (uniqueJumps.length === 0 || uniqueJumps.every(u => Math.hypot(j.x - u.x, j.y - u.y) > JUMP_R * 3)) {
        uniqueJumps.push(j);
      }
    }

    const isHoriz = Math.abs(p2.y - p1.y) < 1;
    const dirX = p2.x - p1.x;
    const dirY = p2.y - p1.y;

    for (const jump of uniqueJumps) {
      if (isHoriz) {
        const sign = dirX > 0 ? 1 : -1;
        d += ` L ${jump.x - JUMP_R * sign} ${jump.y}`;
        d += ` A ${JUMP_R} ${JUMP_R} 0 0 0 ${jump.x + JUMP_R * sign} ${jump.y}`;
      } else {
        const sign = dirY > 0 ? 1 : -1;
        d += ` L ${jump.x} ${jump.y - JUMP_R * sign}`;
        d += ` A ${JUMP_R} ${JUMP_R} 0 0 ${sign > 0 ? 1 : 0} ${jump.x} ${jump.y + JUMP_R * sign}`;
      }
    }

    d += ` L ${p2.x} ${p2.y}`;
  }

  return d;
}

interface VSegment { x: number; y1: number; y2: number }

/** Extracts the vertical runs of a routed edge path, used to keep the
 * hand-drawn aggregation spine (which ELK never sees) out of channels that
 * ELK already assigned to procedural edges. For pure entity-to-entity
 * aggregation this is normally a no-op — the layout engine already reserves
 * the cluster's footprint — but state-scoped aggregation targets aren't
 * clustered, so their comb still needs this safety net. */
function verticalSegments(points: Point[]): VSegment[] {
  const segs: VSegment[] = [];
  for (let i = 1; i < points.length; i++) {
    const p1 = points[i - 1];
    const p2 = points[i];
    if (Math.abs(p1.x - p2.x) < 0.5) {
      segs.push({ x: p1.x, y1: Math.min(p1.y, p2.y), y2: Math.max(p1.y, p2.y) });
    }
  }
  return segs;
}

/**
 * Renders aggregation as a vertical spine with horizontal branches: the
 * whole sits on top, a single line drops from its participation triangle,
 * and each part branches off that spine at its own height via a short
 * horizontal stub — parts stack vertically instead of fanning out in a row.
 */
function renderAggregationGroup(edges: LayoutEdge[], layout: LayoutResult, obstacles: VSegment[]): string {
  const parts: string[] = [];
  const stroke = edgeStroke('consists of', '');
  const sourceId = edges[0].sourceId;

  const parentNode = layout.nodes.find(n => n.id === sourceId);
  if (!parentNode) return '';

  const trunkX = parentNode.x + parentNode.width / 2;
  const parentBottom = parentNode.y + parentNode.height;

  const triTopY = parentBottom + AGG_GAP;
  const triBottomY = triTopY + TRI_HEIGHT;

  parts.push(
    `<line x1="${trunkX}" y1="${parentBottom}" x2="${trunkX}" y2="${triTopY}" ${stroke} fill="none"/>`,
  );

  parts.push(
    `<polygon points="${trunkX},${triTopY} ${trunkX - TRI_WIDTH / 2},${triBottomY} ${trunkX + TRI_WIDTH / 2},${triBottomY}" fill="#333" stroke="#333" stroke-width="1"/>`,
  );

  const targetInfos: { tgtId: string; center: Point }[] = [];
  for (const edge of edges) {
    const tgtId = edge.targetState ?? edge.targetId;
    const c = findCenter(tgtId, layout);
    if (c) targetInfos.push({ tgtId, center: c });
  }
  if (targetInfos.length === 0) return parts.join('\n');

  targetInfos.sort((a, b) => a.center.y - b.center.y);
  const lastY = targetInfos[targetInfos.length - 1].center.y;

  // Nudge the spine sideways in small steps if it would run through a
  // procedural edge's own vertical segment.
  const collides = (x: number) => obstacles.some(o =>
    Math.abs(o.x - x) < MIN_CLEARANCE && o.y1 < lastY && o.y2 > triBottomY,
  );
  const STEP = 4;
  let spineX = trunkX;
  let guard = 0;
  while (collides(spineX) && guard++ < 50) {
    spineX += STEP;
  }

  if (Math.abs(spineX - trunkX) > 0.5) {
    parts.push(
      `<line x1="${trunkX}" y1="${triBottomY}" x2="${spineX}" y2="${triBottomY}" ${stroke} fill="none"/>`,
    );
  }

  parts.push(
    `<line x1="${spineX}" y1="${triBottomY}" x2="${spineX}" y2="${lastY}" ${stroke} fill="none"/>`,
  );

  for (const { tgtId, center } of targetInfos) {
    const nearBorder = findBorderPoint(tgtId, layout, { x: spineX, y: center.y }) ?? center;
    parts.push(
      `<line x1="${spineX}" y1="${center.y}" x2="${nearBorder.x}" y2="${nearBorder.y}" ${stroke} fill="none"/>`,
    );
  }

  return parts.join('\n');
}

function rectBorderPoint(cx: number, cy: number, w: number, h: number, toward: Point): Point {
  const dx = toward.x - cx;
  const dy = toward.y - cy;
  if (dx === 0 && dy === 0) return { x: cx, y: cy };
  const scaleX = dx !== 0 ? (w / 2) / Math.abs(dx) : Infinity;
  const scaleY = dy !== 0 ? (h / 2) / Math.abs(dy) : Infinity;
  const scale = Math.min(scaleX, scaleY);
  return { x: cx + dx * scale, y: cy + dy * scale };
}

function ellipseBorderPoint(cx: number, cy: number, rx: number, ry: number, toward: Point): Point {
  const dx = toward.x - cx;
  const dy = toward.y - cy;
  if (dx === 0 && dy === 0) return { x: cx, y: cy };
  const t = 1 / Math.sqrt((dx / rx) ** 2 + (dy / ry) ** 2);
  return { x: cx + t * dx, y: cy + t * dy };
}

function findBorderPoint(id: string, layout: LayoutResult, toward: Point): Point | null {
  for (const n of layout.nodes) {
    if (n.id === id) {
      const cx = n.x + n.width / 2;
      const cy = n.y + n.height / 2;
      if (n.entity.entityType === 'process') {
        return ellipseBorderPoint(cx, cy, n.width / 2, n.height / 2, toward);
      }
      return rectBorderPoint(cx, cy, n.width, n.height, toward);
    }
    for (const s of n.children) {
      if (s.id === id) {
        return rectBorderPoint(
          n.x + s.x + s.width / 2, n.y + s.y + s.height / 2,
          s.width, s.height, toward,
        );
      }
    }
  }
  return null;
}

function findCenter(id: string, layout: LayoutResult): Point | null {
  for (const n of layout.nodes) {
    if (n.id === id) return { x: n.x + n.width / 2, y: n.y + n.height / 2 };
    for (const s of n.children) {
      if (s.id === id) return { x: n.x + s.x + s.width / 2, y: n.y + s.y + s.height / 2 };
    }
  }
  return null;
}

/**
 * Anchors on whichever horizontal facet of the state box faces `towardY`, so
 * a link to a process below the state exits through the state's bottom
 * instead of always through the top and slicing through the parent object.
 */
function findStateBorderCenter(stateId: string, layout: LayoutResult, towardY: number): Point | null {
  for (const n of layout.nodes) {
    for (const s of n.children) {
      if (s.id === stateId) {
        const absTop = n.y + s.y;
        const cy = absTop + s.height / 2;
        const y = towardY < cy ? absTop : absTop + s.height;
        return { x: n.x + s.x + s.width / 2, y };
      }
    }
  }
  return null;
}

function cleanPath(points: Point[]): Point[] {
  if (points.length <= 2) return points;
  const result: Point[] = [points[0]];
  for (let i = 1; i < points.length - 1; i++) {
    const prev = result[result.length - 1];
    const curr = points[i];
    const next = points[i + 1];
    const sameX = Math.abs(prev.x - curr.x) < 1 && Math.abs(curr.x - next.x) < 1;
    const sameY = Math.abs(prev.y - curr.y) < 1 && Math.abs(curr.y - next.y) < 1;
    if (!sameX && !sameY) {
      result.push(curr);
    }
  }
  result.push(points[points.length - 1]);
  return result;
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
