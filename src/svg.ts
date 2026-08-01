/**
 * SVG renderer for Object-Process Diagrams.
 *
 * Takes a LayoutResult (positioned nodes + routed edges from ELK) and produces
 * an SVG string. Handles:
 *   - Object (rectangle) and Process (ellipse) shapes with OPM styling
 *   - State rounded-rects nested inside objects
 *   - Orthogonal edge routing with state-targeted endpoints
 *   - Comb-style aggregation (triangle + horizontal bar + vertical stubs)
 *   - Z-shaped kink on invocation links
 *   - Semicircular line jumps at edge crossings
 */
import type { LayoutResult, LayoutNode, LayoutState, LayoutEdge, Point } from './layout.js';
import type { Relationship } from './types.js';

const PAD = 40;                // SVG padding around the diagram
const OBJECT_COLOR = '#70E483';
const PROCESS_COLOR = '#3BC3FF';
const FONT = 'Arial, Helvetica, sans-serif';
const AGG_GAP = 15;            // gap between parent bottom and aggregation triangle
const TRI_WIDTH = 16;          // aggregation triangle width
const TRI_HEIGHT = 12;         // aggregation triangle height
const JUMP_R = 5;              // radius of semicircular line jumps at crossings
const Z_H = 6;                 // half-height of Z-kink on invocation links
const Z_W = 8;                 // half-width of Z-kink

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

  const edgeInfos: { points: Point[]; stroke: string; markerStart: string; markerEnd: string }[] = [];
  for (const edge of otherEdges) {
    let points = computeEdgePoints(edge, layout);
    if (points.length < 2) continue;

    const rel = edge.link.relationship;
    const markers = edgeMarkers(rel, edge.id);
    const stroke = edgeStroke(rel, edge.id);

    if (rel === 'invokes') {
      points = insertZKink(points);
    }

    edgeInfos.push({ points, stroke, markerStart: markers.start, markerEnd: markers.end });
  }

  const jumpMap = detectJumps(edgeInfos.map(e => e.points));

  for (let i = 0; i < edgeInfos.length; i++) {
    const info = edgeInfos[i];
    const jumps = jumpMap.get(i) ?? [];
    const d = buildPathWithJumps(info.points, jumps);
    parts.push(
      `<path d="${d}" ${info.stroke} ${info.markerStart} ${info.markerEnd} fill="none"/>`,
    );
  }

  for (const [, edges] of aggGroups) {
    parts.push(renderAggregationGroup(edges, layout));
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
  <marker id="filled-triangle" viewBox="0 0 10 10" refX="0" refY="5"
    markerWidth="10" markerHeight="10" orient="auto">
    <path d="M 0 0 L 10 5 L 0 10 z" fill="#333"/>
  </marker>
  <marker id="hollow-triangle" viewBox="0 0 10 10" refX="10" refY="5"
    markerWidth="10" markerHeight="10" orient="auto">
    <path d="M 10 0 L 0 5 L 10 10 z" fill="white" stroke="#333" stroke-width="1"/>
  </marker>
  <marker id="hollow-arrow" viewBox="0 0 10 10" refX="10" refY="5"
    markerWidth="8" markerHeight="8" orient="auto">
    <path d="M 0 0 L 10 5 L 0 10 z" fill="white" stroke="#333" stroke-width="1.5"/>
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

function edgeMarkers(rel: Relationship, edgeId: string): { start: string; end: string } {
  switch (rel) {
    case 'handles':
      return { start: '', end: 'marker-end="url(#filled-circle)"' };
    case 'requires':
      return { start: '', end: 'marker-end="url(#hollow-circle)"' };
    case 'yields':
      return { start: '', end: 'marker-end="url(#arrow)"' };
    case 'consumes':
      return { start: '', end: 'marker-end="url(#arrow)"' };
    case 'consists of':
      return { start: 'marker-start="url(#filled-triangle)"', end: '' };
    case 'invokes':
      return { start: '', end: 'marker-end="url(#hollow-arrow)"' };
    case 'is a':
      return { start: '', end: 'marker-end="url(#hollow-triangle)"' };
    case 'changes':
      if (edgeId.endsWith('-from')) return { start: '', end: 'marker-end="url(#arrow)"' };
      if (edgeId.endsWith('-to')) return { start: '', end: 'marker-end="url(#arrow)"' };
      return { start: '', end: 'marker-end="url(#arrow)"' };
    default:
      return { start: '', end: 'marker-end="url(#arrow)"' };
  }
}

function edgeStroke(_rel: Relationship, _edgeId: string): string {
  return 'stroke="#333" stroke-width="1.5"';
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
      if (Math.abs(src.x - tgt.x) < 1) points = [src, tgt];
      else points = [src, { x: src.x, y: tgt.y }, tgt];
    } else {
      const exitDir = dx > 0 ? 1 : -1;
      const src = findBorderPoint(srcId, layout, { x: srcCenter.x + exitDir * 1000, y: srcCenter.y }) ?? srcCenter;
      const tgt = findBorderPoint(tgtId, layout, { x: tgtCenter.x - exitDir * 1000, y: tgtCenter.y }) ?? tgtCenter;
      if (Math.abs(src.y - tgt.y) < 1) points = [src, tgt];
      else points = [src, { x: tgt.x, y: src.y }, tgt];
    }
  }

  if (edge.sourceState && points.length >= 2) {
    const stateTop = findStateTopCenter(edge.sourceState, layout);
    if (stateTop) {
      const secondY = points[1].y;
      points.splice(0, 1, stateTop, { x: stateTop.x, y: secondY });
    }
  }

  if (edge.targetState && points.length >= 2) {
    const stateTop = findStateTopCenter(edge.targetState, layout);
    if (stateTop) {
      const n = points.length;
      const prevY = points[n - 2].y;
      points.splice(n - 1, 1, { x: stateTop.x, y: prevY }, stateTop);
    }
  }

  return cleanPath(points);
}

function insertZKink(points: Point[]): Point[] {
  let totalLen = 0;
  for (let i = 1; i < points.length; i++) {
    const dx = points[i].x - points[i - 1].x;
    const dy = points[i].y - points[i - 1].y;
    totalLen += Math.sqrt(dx * dx + dy * dy);
  }

  const half = totalLen / 2;
  let cumLen = 0;
  for (let i = 1; i < points.length; i++) {
    const dx = points[i].x - points[i - 1].x;
    const dy = points[i].y - points[i - 1].y;
    const segLen = Math.sqrt(dx * dx + dy * dy);

    if (cumLen + segLen >= half && segLen > Z_H * 4) {
      const t = (half - cumLen) / segLen;
      const midX = points[i - 1].x + t * dx;
      const midY = points[i - 1].y + t * dy;

      const isVertical = Math.abs(dy) > Math.abs(dx);
      const result = [...points.slice(0, i)];

      if (isVertical) {
        const dirY = dy > 0 ? 1 : -1;
        result.push(
          { x: midX, y: midY - Z_H * dirY },
          { x: midX + Z_W, y: midY - Z_H * dirY },
          { x: midX - Z_W, y: midY + Z_H * dirY },
          { x: midX, y: midY + Z_H * dirY },
        );
      } else {
        const dirX = dx > 0 ? 1 : -1;
        result.push(
          { x: midX - Z_H * dirX, y: midY },
          { x: midX - Z_H * dirX, y: midY - Z_W },
          { x: midX + Z_H * dirX, y: midY + Z_W },
          { x: midX + Z_H * dirX, y: midY },
        );
      }

      result.push(...points.slice(i));
      return result;
    }
    cumLen += segLen;
  }

  return points;
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

function renderAggregationGroup(edges: LayoutEdge[], layout: LayoutResult): string {
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
    `<polygon points="${trunkX - TRI_WIDTH / 2},${triTopY} ${trunkX + TRI_WIDTH / 2},${triTopY} ${trunkX},${triBottomY}" fill="#333" stroke="#333" stroke-width="1"/>`,
  );

  const targetInfos: { tgtId: string; center: Point; topY: number }[] = [];
  for (const edge of edges) {
    const tgtId = edge.targetState ?? edge.targetId;
    const c = findCenter(tgtId, layout);
    const top = findNodeTop(tgtId, layout);
    if (c && top !== null) targetInfos.push({ tgtId, center: c, topY: top });
  }
  if (targetInfos.length === 0) return parts.join('\n');

  const barY = Math.min(...targetInfos.map(t => t.topY)) - 10;

  parts.push(
    `<line x1="${trunkX}" y1="${triBottomY}" x2="${trunkX}" y2="${barY}" ${stroke} fill="none"/>`,
  );

  const childXs = targetInfos.map(t => t.center.x);
  childXs.push(trunkX);
  const barLeft = Math.min(...childXs);
  const barRight = Math.max(...childXs);

  parts.push(
    `<line x1="${barLeft}" y1="${barY}" x2="${barRight}" y2="${barY}" ${stroke} fill="none"/>`,
  );

  for (const { tgtId, center } of targetInfos) {
    const topBorder = findBorderPoint(tgtId, layout, { x: center.x, y: center.y - 1000 }) ?? center;
    parts.push(
      `<line x1="${center.x}" y1="${barY}" x2="${center.x}" y2="${topBorder.y}" ${stroke} fill="none"/>`,
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

function findStateTopCenter(stateId: string, layout: LayoutResult): Point | null {
  for (const n of layout.nodes) {
    for (const s of n.children) {
      if (s.id === stateId) {
        return { x: n.x + s.x + s.width / 2, y: n.y + s.y };
      }
    }
  }
  return null;
}

function findNodeTop(id: string, layout: LayoutResult): number | null {
  for (const n of layout.nodes) {
    if (n.id === id) return n.y;
    for (const s of n.children) {
      if (s.id === id) return n.y + s.y;
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
