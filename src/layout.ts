/**
 * Graph layout engine. Converts the YAML-model entities and relationships into
 * positioned nodes and routed edges using ELK.js (Eclipse Layout Kernel).
 *
 * States are laid out manually inside their parent object rectangles (not as
 * ELK children), and state-targeting info is stored on edges for the SVG
 * renderer to adjust endpoints.
 *
 * Pure entity-to-entity aggregation ("consists of" with no targetState) is
 * deliberately NOT left to ELK's general graph layout: a whole and its parts
 * pull toward each other for the comb notation while unrelated procedural
 * edges pull the same part nodes toward wherever their own process flow
 * naturally sits, and a single layered algorithm can't satisfy both at once.
 * Instead each such cluster is laid out locally as a fixed, evenly-spaced
 * comb tree (computeClusterLayout), reserved as one opaque placeholder box
 * during ELK's pass, then expanded back into real node positions afterward.
 * Procedural edges that touch a clustered node are re-routed against the
 * final positions rather than trusting ELK's placeholder-relative route.
 */
import ELK from 'elkjs';
import type { ElkNode, ElkExtendedEdge } from 'elkjs';
import type { OpmModel, Entity, LinkStatement } from './types.js';

export interface LayoutNode {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  entity: Entity;
  children: LayoutState[];
}

export interface LayoutState {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  name: string;
  initial?: boolean;
  final?: boolean;
  default?: boolean;
  parentId: string;
}

export interface LayoutEdge {
  id: string;
  link: LinkStatement;
  sections: { startPoint: Point; endPoint: Point; bendPoints?: Point[] }[];
  sourceId: string;
  targetId: string;
  sourceState?: string;
  targetState?: string;
}

export interface Point {
  x: number;
  y: number;
}

export interface LayoutResult {
  width: number;
  height: number;
  nodes: LayoutNode[];
  edges: LayoutEdge[];
}

const STATE_WIDTH = 100;
const STATE_HEIGHT = 30;
const STATE_PAD = 10;
const LABEL_HEIGHT = 30;
const ENTITY_MIN_WIDTH = 160;
const ENTITY_MIN_HEIGHT = 60;
const AGG_DROP = 55;   // vertical gap reserved below a whole for its participation triangle + spine
const STUB_LEN = 50;   // horizontal branch length from the spine to each part
const SIB_GAP_V = 25;  // vertical gap between stacked siblings in an aggregation cluster

function stateElkId(entityId: string, stateName: string): string {
  return `${entityId}::${stateName}`;
}

function estimateTextWidth(text: string, fontSize: number = 14): number {
  return text.length * fontSize * 0.62 + 20;
}

function layoutStatesManually(states: { name: string; initial?: boolean; final?: boolean; default?: boolean }[]): {
  positions: { name: string; x: number; y: number; width: number; height: number }[];
  totalWidth: number;
  totalHeight: number;
} {
  const cols = Math.min(states.length, 3);
  const rows = Math.ceil(states.length / cols);
  const positions: { name: string; x: number; y: number; width: number; height: number }[] = [];

  for (let i = 0; i < states.length; i++) {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const sw = Math.max(STATE_WIDTH, estimateTextWidth(states[i].name, 12));
    positions.push({
      name: states[i].name,
      x: STATE_PAD + col * (STATE_WIDTH + STATE_PAD),
      y: LABEL_HEIGHT + STATE_PAD + row * (STATE_HEIGHT + STATE_PAD),
      width: sw,
      height: STATE_HEIGHT,
    });
  }

  const totalWidth = cols * (STATE_WIDTH + STATE_PAD) + STATE_PAD;
  const totalHeight = LABEL_HEIGHT + STATE_PAD + rows * (STATE_HEIGHT + STATE_PAD) + STATE_PAD;
  return { positions, totalWidth, totalHeight };
}

function sizeEntity(e: Entity): { width: number; height: number } {
  const labelWidth = estimateTextWidth(e.name, 14);
  const states = e.states ?? [];

  if (e.entityType === 'object' && states.length > 0) {
    const { totalWidth, totalHeight } = layoutStatesManually(states);
    return {
      width: Math.max(ENTITY_MIN_WIDTH, labelWidth, totalWidth + 2 * STATE_PAD),
      height: Math.max(ENTITY_MIN_HEIGHT, totalHeight),
    };
  }
  return { width: Math.max(ENTITY_MIN_WIDTH, labelWidth), height: ENTITY_MIN_HEIGHT };
}

function buildStateLayouts(entity: Entity): LayoutState[] {
  const states = entity.states ?? [];
  if (entity.entityType !== 'object' || states.length === 0) return [];
  const { positions } = layoutStatesManually(states);
  return positions.map(pos => {
    const st = states.find(s => s.name === pos.name);
    return {
      id: stateElkId(entity.id, pos.name),
      x: pos.x,
      y: pos.y,
      width: pos.width,
      height: pos.height,
      name: pos.name,
      initial: st?.initial,
      final: st?.final,
      default: st?.default,
      parentId: entity.id,
    };
  });
}

interface ClusterBox { x: number; y: number; width: number; height: number }

/**
 * Deterministically lays out a whole and its (possibly nested) pure-entity
 * aggregation parts as a comb tree: the whole at the top, a spine drops from
 * its participation triangle, and its parts stack vertically off that
 * spine — each at its own height, branching sideways via a short horizontal
 * stub — recursing for any part that is itself a whole. Positions are
 * relative to the root whole's own (0,0) top-left corner.
 */
function computeClusterLayout(
  rootId: string,
  entityMap: Map<string, Entity>,
  parentToChildren: Map<string, string[]>,
): { boxes: Map<string, ClusterBox>; width: number; height: number } {
  const boxes = new Map<string, ClusterBox>();

  function collectIds(id: string): string[] {
    const out = [id];
    for (const c of parentToChildren.get(id) ?? []) out.push(...collectIds(c));
    return out;
  }

  function offset(id: string, dx: number, dy: number) {
    const b = boxes.get(id)!;
    boxes.set(id, { ...b, x: b.x + dx, y: b.y + dy });
    for (const c of parentToChildren.get(id) ?? []) offset(c, dx, dy);
  }

  function layoutSubtree(id: string): { width: number; height: number } {
    const size = sizeEntity(entityMap.get(id)!);
    boxes.set(id, { x: 0, y: 0, width: size.width, height: size.height });

    const children = parentToChildren.get(id) ?? [];
    if (children.length === 0) return size;

    const childSizes = children.map(layoutSubtree);
    const branchX = size.width / 2 + STUB_LEN;
    let cursorY = size.height + AGG_DROP;

    for (let i = 0; i < children.length; i++) {
      offset(children[i], branchX, cursorY);
      cursorY += childSizes[i].height + SIB_GAP_V;
    }

    const ids = collectIds(id);
    let minX = 0, maxX = size.width, maxY = size.height;
    for (const cid of ids) {
      const b = boxes.get(cid)!;
      minX = Math.min(minX, b.x);
      maxX = Math.max(maxX, b.x + b.width);
      maxY = Math.max(maxY, b.y + b.height);
    }
    if (minX < 0) {
      for (const cid of ids) {
        const b = boxes.get(cid)!;
        boxes.set(cid, { ...b, x: b.x - minX });
      }
      maxX -= minX;
    }
    return { width: maxX, height: maxY };
  }

  const { width, height } = layoutSubtree(rootId);
  return { boxes, width, height };
}

export async function computeLayout(model: OpmModel): Promise<LayoutResult> {
  const elk = new ELK();
  const entityMap = new Map(model.entities.map(e => [e.id, e]));

  // --- Identify pure entity-to-entity aggregation clusters ---
  const parentToChildren = new Map<string, string[]>();
  const childToParent = new Map<string, string>();
  for (const rel of model.relationships) {
    if (rel.relationship !== 'consists of' || rel.target.targetState) continue;
    const parent = rel.subject.subjectId;
    const child = rel.target.targetId;
    if (childToParent.has(child)) continue; // ambiguous multi-parent case: leave as a free node
    childToParent.set(child, parent);
    if (!parentToChildren.has(parent)) parentToChildren.set(parent, []);
    parentToChildren.get(parent)!.push(child);
  }

  const clusterRoots = [...parentToChildren.keys()].filter(id => !childToParent.has(id));
  const clusterOf = new Map<string, { boxes: Map<string, ClusterBox>; width: number; height: number }>();
  const rootOfEntity = new Map<string, string>();
  for (const root of clusterRoots) {
    const cluster = computeClusterLayout(root, entityMap, parentToChildren);
    clusterOf.set(root, cluster);
    for (const id of cluster.boxes.keys()) rootOfEntity.set(id, root);
  }

  // A descendant (not the root itself) has no ELK node identity of its own —
  // it was absorbed into its cluster's placeholder box. An edge touching one
  // has nothing correct to route against during layout, so rather than
  // redirect it to the cluster root (which would make every process that
  // touches ANY part look equally "close" to the whole, distorting layering
  // for parts that are actually deep in an unrelated procedural chain), it's
  // left out of ELK's graph entirely and routed later via the SVG renderer's
  // generic fallback against final positions — same as it already was in
  // practice, since a cluster-touching edge's ELK-computed route was always
  // discarded anyway (see `touchesCluster` below).
  const isDescendant = (id: string) => rootOfEntity.has(id) && !clusterRoots.includes(id);

  // --- Build ELK pass: normal entities + one placeholder box per cluster root ---
  const elkChildren: ElkNode[] = [];
  for (const e of model.entities) {
    if (rootOfEntity.has(e.id) && !clusterRoots.includes(e.id)) continue; // absorbed into a cluster
    if (clusterRoots.includes(e.id)) {
      const cluster = clusterOf.get(e.id)!;
      elkChildren.push({ id: e.id, width: cluster.width, height: cluster.height, labels: [{ text: e.name }] });
      continue;
    }
    const size = sizeEntity(e);
    elkChildren.push({ id: e.id, width: size.width, height: size.height, labels: [{ text: e.name }] });
  }

  const elkEdges: ElkExtendedEdge[] = [];
  const edgeStateInfo = new Map<string, { sourceState?: string; targetState?: string }>();
  const edgeReal = new Map<string, { sourceId: string; targetId: string }>();
  const directEdges: LayoutEdge[] = [];

  for (const rel of model.relationships) {
    const realSourceId = rel.subject.subjectId;
    const realTargetId = rel.target.targetId;
    const ts = rel.target.targetState;

    if (rel.relationship === 'consists of' && !ts) {
      continue; // pure entity aggregation: never ELK-routed, synthesized directly below
    }

    if (rel.relationship === 'changes' && ts?.targetStateFrom && ts?.targetStateTo) {
      const fromId = `${rel.id}-from`;
      const toId = `${rel.id}-to`;

      // A "changes" relationship touching a cluster (root or descendant)
      // is bypassed entirely: its two synthetic edges (state-before ->
      // process, process -> state-after) form a 2-node cycle, and when one
      // side is the cluster root — whose ELK placeholder is inflated to
      // the whole cluster's height — whichever edge direction survives
      // still forces the process into the layer *after that entire
      // placeholder*, not just after the root's own header. Breaking the
      // cycle deterministically (tried first) didn't change that: ELK
      // still enforces target-layer > source-layer regardless of which
      // direction is kept. So the process is freed to position off its
      // other real connections instead, same as descendant-touching edges.
      if (rootOfEntity.has(realSourceId) || rootOfEntity.has(realTargetId)) {
        directEdges.push({
          id: fromId, link: rel, sourceId: realTargetId, targetId: realSourceId,
          sourceState: stateElkId(realTargetId, ts.targetStateFrom), sections: [],
        });
        directEdges.push({
          id: toId, link: rel, sourceId: realSourceId, targetId: realTargetId,
          targetState: stateElkId(realTargetId, ts.targetStateTo), sections: [],
        });
        continue;
      }

      elkEdges.push({ id: fromId, sources: [realTargetId], targets: [realSourceId] });
      edgeReal.set(fromId, { sourceId: realTargetId, targetId: realSourceId });
      edgeStateInfo.set(fromId, { sourceState: stateElkId(realTargetId, ts.targetStateFrom) });

      elkEdges.push({ id: toId, sources: [realSourceId], targets: [realTargetId] });
      edgeReal.set(toId, { sourceId: realSourceId, targetId: realTargetId });
      edgeStateInfo.set(toId, { targetState: stateElkId(realTargetId, ts.targetStateTo) });
      continue;
    }

    if (isDescendant(realSourceId) || isDescendant(realTargetId)) {
      directEdges.push({
        id: rel.id,
        link: rel,
        sourceId: realSourceId,
        targetId: realTargetId,
        sourceState: rel.subject.subjectState ? stateElkId(realSourceId, rel.subject.subjectState) : undefined,
        targetState: ts?.targetStateAt ? stateElkId(realTargetId, ts.targetStateAt) : undefined,
        sections: [],
      });
      continue;
    }

    elkEdges.push({
      id: rel.id,
      sources: [realSourceId],
      targets: [realTargetId],
      // Aggregation edges (state-scoped ones still routed through ELK) are
      // rendered as a hand-drawn comb, not ELK's path, but still influence
      // layering: prioritizing them keeps parts pulled close to their whole.
      ...(rel.relationship === 'consists of' ? { layoutOptions: { 'elk.priority': '10' } } : {}),
    });
    edgeReal.set(rel.id, { sourceId: realSourceId, targetId: realTargetId });

    const info: { sourceState?: string; targetState?: string } = {};
    if (rel.subject.subjectState) {
      info.sourceState = stateElkId(realSourceId, rel.subject.subjectState);
    }
    if (ts?.targetStateAt) {
      info.targetState = stateElkId(realTargetId, ts.targetStateAt);
    }
    if (info.sourceState || info.targetState) {
      edgeStateInfo.set(rel.id, info);
    }
  }

  const graph: ElkNode = {
    id: 'root',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': 'DOWN',
      'elk.spacing.nodeNode': '60',
      'elk.spacing.edgeNode': '36',
      'elk.layered.spacing.nodeNodeBetweenLayers': '80',
      'elk.layered.crossingMinimization.strategy': 'LAYER_SWEEP',
      // Without this, YAML declaration order only weakly seeds crossing
      // minimization; ELK is free to reorder nodes/edges however it likes
      // as long as the crossing count doesn't improve by reordering. With
      // it, declared order becomes a real, controllable lever for sequencing
      // within a layer and for tie-breaking between equally-valid layouts.
      'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES',
      'elk.layered.nodePlacement.strategy': 'NETWORK_SIMPLEX',
      // Post-layering compaction pulls nodes toward shorter edges instead of
      // leaving them spread across the full width of their layer — reduces
      // canvas sprawl and wasted whitespace without touching the routing.
      'elk.layered.compaction.postCompaction.strategy': 'EDGE_LENGTH',
      'elk.edgeRouting': 'ORTHOGONAL',
      // Wider edge-to-edge and edge-to-node channels so parallel runs don't
      // collapse into a near-coincident single stroke.
      'elk.spacing.edgeEdge': '22',
      'elk.layered.spacing.edgeEdgeBetweenLayers': '28',
    },
    children: elkChildren,
    edges: elkEdges,
  };

  const laid = await elk.layout(graph);

  // --- Flatten nodes: normal entities as-is, cluster placeholders expanded ---
  const nodes: LayoutNode[] = [];
  for (const child of laid.children ?? []) {
    if (clusterRoots.includes(child.id)) {
      const cluster = clusterOf.get(child.id)!;
      const rootAbsX = child.x ?? 0;
      const rootAbsY = child.y ?? 0;
      for (const [id, box] of cluster.boxes) {
        const entity = entityMap.get(id)!;
        const absX = rootAbsX + box.x;
        const absY = rootAbsY + box.y;
        nodes.push({
          id,
          x: absX,
          y: absY,
          width: box.width,
          height: box.height,
          entity,
          children: buildStateLayouts(entity),
        });
      }
      continue;
    }

    const entity = entityMap.get(child.id)!;
    nodes.push({
      id: child.id,
      x: child.x ?? 0,
      y: child.y ?? 0,
      width: child.width ?? ENTITY_MIN_WIDTH,
      height: child.height ?? ENTITY_MIN_HEIGHT,
      entity,
      children: buildStateLayouts(entity),
    });
  }

  // --- Build edges: pure aggregation synthesized directly, others from ELK ---
  const edges: LayoutEdge[] = [];

  for (const rel of model.relationships) {
    if (rel.relationship === 'consists of' && !rel.target.targetState) {
      edges.push({
        id: rel.id,
        link: rel,
        sourceId: rel.subject.subjectId,
        targetId: rel.target.targetId,
        sections: [],
      });
    }
  }

  edges.push(...directEdges);

  for (const edge of laid.edges ?? []) {
    const ext = edge as ElkExtendedEdge;
    const rel = model.relationships.find(r =>
      r.id === ext.id || ext.id.startsWith(r.id + '-'),
    );
    if (!rel) continue;
    const real = edgeReal.get(ext.id);
    if (!real) continue;

    const info = edgeStateInfo.get(ext.id);
    // A clustered node's final position differs from the placeholder ELK
    // routed against, so its edges are re-derived from real positions
    // (via the SVG renderer's generic border-to-border fallback) instead.
    const touchesCluster = rootOfEntity.has(real.sourceId) || rootOfEntity.has(real.targetId);

    edges.push({
      id: ext.id,
      link: rel,
      sourceId: real.sourceId,
      targetId: real.targetId,
      sourceState: info?.sourceState,
      targetState: info?.targetState,
      sections: touchesCluster ? [] : (ext.sections ?? []).map(s => ({
        startPoint: s.startPoint,
        endPoint: s.endPoint,
        bendPoints: s.bendPoints,
      })),
    });
  }

  const width = Math.max(laid.width ?? 800, ...nodes.map(n => n.x + n.width));
  const height = Math.max(laid.height ?? 600, ...nodes.map(n => n.y + n.height));

  return { width, height, nodes, edges };
}
