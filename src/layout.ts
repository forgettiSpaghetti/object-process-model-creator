/**
 * Graph layout engine. Converts the YAML-model entities and relationships into
 * positioned nodes and routed edges using ELK.js (Eclipse Layout Kernel).
 *
 * States are laid out manually inside their parent object rectangles (not as
 * ELK children), and state-targeting info is stored on edges for the SVG
 * renderer to adjust endpoints.
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

export async function computeLayout(model: OpmModel): Promise<LayoutResult> {
  const elk = new ELK();
  const entityMap = new Map(model.entities.map(e => [e.id, e]));

  const elkChildren: ElkNode[] = model.entities.map(e => {
    const labelWidth = estimateTextWidth(e.name, 14);
    const states = e.states ?? [];

    if (e.entityType === 'object' && states.length > 0) {
      const { totalWidth, totalHeight } = layoutStatesManually(states);
      const w = Math.max(ENTITY_MIN_WIDTH, labelWidth, totalWidth + 2 * STATE_PAD);
      const h = Math.max(ENTITY_MIN_HEIGHT, totalHeight);
      return { id: e.id, width: w, height: h, labels: [{ text: e.name }] };
    }

    const w = Math.max(ENTITY_MIN_WIDTH, labelWidth);
    const h = ENTITY_MIN_HEIGHT;
    return { id: e.id, width: w, height: h, labels: [{ text: e.name }] };
  });

  const elkEdges: ElkExtendedEdge[] = [];
  const edgeStateInfo = new Map<string, { sourceState?: string; targetState?: string }>();

  for (const rel of model.relationships) {
    const sourceId = rel.subject.subjectId;
    const targetId = rel.target.targetId;
    const ts = rel.target.targetState;

    if (rel.relationship === 'changes' && ts?.targetStateFrom && ts?.targetStateTo) {
      elkEdges.push({ id: `${rel.id}-from`, sources: [targetId], targets: [sourceId] });
      edgeStateInfo.set(`${rel.id}-from`, { sourceState: stateElkId(targetId, ts.targetStateFrom) });
      elkEdges.push({ id: `${rel.id}-to`, sources: [sourceId], targets: [targetId] });
      edgeStateInfo.set(`${rel.id}-to`, { targetState: stateElkId(targetId, ts.targetStateTo) });
      continue;
    }

    elkEdges.push({ id: rel.id, sources: [sourceId], targets: [targetId] });

    const info: { sourceState?: string; targetState?: string } = {};
    if (rel.subject.subjectState) {
      info.sourceState = stateElkId(sourceId, rel.subject.subjectState);
    }
    if (ts?.targetStateAt) {
      info.targetState = stateElkId(targetId, ts.targetStateAt);
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
      'elk.spacing.edgeNode': '30',
      'elk.layered.spacing.nodeNodeBetweenLayers': '80',
      'elk.layered.crossingMinimization.strategy': 'LAYER_SWEEP',
      'elk.edgeRouting': 'ORTHOGONAL',
      'elk.spacing.edgeEdge': '15',
      'elk.layered.spacing.edgeEdgeBetweenLayers': '20',
    },
    children: elkChildren,
    edges: elkEdges,
  };

  const laid = await elk.layout(graph);

  const stateLayoutMap = new Map<string, { x: number; y: number; width: number; height: number; parentId: string }>();

  const nodes: LayoutNode[] = [];
  for (const child of laid.children ?? []) {
    const entity = entityMap.get(child.id)!;
    const stateLayouts: LayoutState[] = [];
    const states = entity.states ?? [];

    if (entity.entityType === 'object' && states.length > 0) {
      const { positions } = layoutStatesManually(states);
      for (const pos of positions) {
        const st = states.find(s => s.name === pos.name);
        const sId = stateElkId(entity.id, pos.name);
        const layout: LayoutState = {
          id: sId,
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
        stateLayouts.push(layout);
        stateLayoutMap.set(sId, {
          x: (child.x ?? 0) + pos.x,
          y: (child.y ?? 0) + pos.y,
          width: pos.width,
          height: pos.height,
          parentId: entity.id,
        });
      }
    }

    nodes.push({
      id: child.id,
      x: child.x ?? 0,
      y: child.y ?? 0,
      width: child.width ?? ENTITY_MIN_WIDTH,
      height: child.height ?? ENTITY_MIN_HEIGHT,
      entity,
      children: stateLayouts,
    });
  }

  const edges: LayoutEdge[] = [];
  for (const edge of laid.edges ?? []) {
    const ext = edge as ElkExtendedEdge;
    const rel = model.relationships.find(r =>
      r.id === ext.id || ext.id.startsWith(r.id + '-'),
    );
    if (!rel) continue;

    const info = edgeStateInfo.get(ext.id);

    edges.push({
      id: ext.id,
      link: rel,
      sourceId: ext.sources[0],
      targetId: ext.targets[0],
      sourceState: info?.sourceState,
      targetState: info?.targetState,
      sections: (ext.sections ?? []).map(s => ({
        startPoint: s.startPoint,
        endPoint: s.endPoint,
        bendPoints: s.bendPoints,
      })),
    });
  }

  return {
    width: laid.width ?? 800,
    height: laid.height ?? 600,
    nodes,
    edges,
  };
}
