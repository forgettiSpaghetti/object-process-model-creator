/** Core type definitions for the YAML-based OPM model (ISO 19450). */

export interface State {
  name: string;
  initial?: boolean;
  final?: boolean;
  default?: boolean;
}

export interface Entity {
  id: string;
  entityType: 'object' | 'process';
  name: string;
  essence: 'physical' | 'informatical';
  affiliation: 'systemic' | 'environmental';
  states?: State[];
}

export interface SubjectRef {
  subjectId: string;
  subjectState?: string;
}

export interface TargetState {
  targetStateFrom?: string;
  targetStateTo?: string;
  targetStateAt?: string;
}

export interface TargetRef {
  targetId: string;
  targetState?: TargetState;
}

export type Relationship =
  | 'consists of'
  | 'exhibits'
  | 'is a'
  | 'is an instance of'
  | 'relates to'
  | 'is equivalent to'
  | 'invokes'
  | 'occurs if'
  | 'yields'
  | 'affects'
  | 'requires'
  | 'consumes'
  | 'handles'
  | 'changes';

export interface LinkStatement {
  id: string;
  subject: SubjectRef;
  target: TargetRef;
  relationship: Relationship;
}

export interface OpmModel {
  entities: Entity[];
  relationships: LinkStatement[];
}
