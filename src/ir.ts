export type Essence = 'physical' | 'informatical';
export type Affiliation = 'systemic' | 'environmental';

export interface State {
  id: string;
  name: string;
  initial?: boolean;
  final?: boolean;
  default?: boolean;
}

export interface OpmObject {
  id: string;
  name: string;
  essence: Essence;
  affiliation: Affiliation;
  states: State[];
}

export interface OpmProcess {
  id: string;
  name: string;
  essence: Essence;
  affiliation: Affiliation;
}

export interface StateRef {
  thing: string;
  state?: string;
}

export interface AggregationLink {
  kind: 'structural';
  subtype: 'aggregation-participation';
  whole: string;
  parts: StateRef[];
}

export interface ExhibitionLink {
  kind: 'structural';
  subtype: 'exhibition-characterization';
  exhibitor: string;
  attribute: string;
}

export interface GeneralizationLink {
  kind: 'structural';
  subtype: 'generalization-specialization';
  general: string;
  special: string;
}

export interface ClassificationLink {
  kind: 'structural';
  subtype: 'classification-instantiation';
  class_: string;
  instance: string;
}

export interface TaggedLink {
  kind: 'structural';
  subtype: 'tagged';
  tag: string;
  source: string;
  target: string;
}

export interface AgentLink {
  kind: 'procedural';
  subtype: 'agent';
  process: string;
  object: string;
  initiates?: boolean;
}

export interface InstrumentLink {
  kind: 'procedural';
  subtype: 'instrument';
  process: string;
  object: string;
  state?: string;
}

export interface ConsumptionLink {
  kind: 'procedural';
  subtype: 'consumption';
  process: string;
  object: string;
  state?: string;
}

export interface ResultLink {
  kind: 'procedural';
  subtype: 'result';
  process: string;
  object: string;
  state?: string;
}

export interface EffectLink {
  kind: 'procedural';
  subtype: 'effect';
  process: string;
  object: string;
  fromState: string;
  toState: string;
}

export interface InvocationLink {
  kind: 'procedural';
  subtype: 'invocation';
  process: string;
  target: string;
}

export type StructuralLink =
  | AggregationLink
  | ExhibitionLink
  | GeneralizationLink
  | ClassificationLink
  | TaggedLink;

export type ProceduralLink =
  | AgentLink
  | InstrumentLink
  | ConsumptionLink
  | ResultLink
  | EffectLink
  | InvocationLink;

export type Link = StructuralLink | ProceduralLink;

export interface OpmMeta {
  opmVersion: string;
  diagram: string;
}

export interface OpmModel {
  meta: OpmMeta;
  objects: OpmObject[];
  processes: OpmProcess[];
  links: Link[];
}
