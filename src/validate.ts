/**
 * Schema validator for OPM YAML models. Checks structural correctness:
 * required fields, valid enum values, referential integrity for entity/state IDs,
 * and relationship-specific constraints (e.g. "changes" requires from/to states).
 */
import type { OpmModel, Entity, LinkStatement } from './types.js';

export interface ValidationError {
  path: string;
  message: string;
}

const VALID_RELATIONSHIPS = new Set([
  'consists of', 'exhibits', 'is a', 'is an instance of', 'relates to',
  'is equivalent to', 'invokes', 'occurs if', 'yields', 'affects',
  'requires', 'consumes', 'handles', 'changes',
]);

export function validate(model: OpmModel): ValidationError[] {
  const errors: ValidationError[] = [];
  const entityIds = new Map<string, Entity>();

  if (!Array.isArray(model.entities)) {
    errors.push({ path: 'entities', message: 'entities must be an array' });
    return errors;
  }
  if (!Array.isArray(model.relationships)) {
    errors.push({ path: 'relationships', message: 'relationships must be an array' });
    return errors;
  }

  for (let i = 0; i < model.entities.length; i++) {
    const e = model.entities[i];
    const p = `entities[${i}]`;

    if (!e.id) errors.push({ path: `${p}.id`, message: 'id is required' });
    if (!e.name) errors.push({ path: `${p}.name`, message: 'name is required' });
    if (e.entityType !== 'object' && e.entityType !== 'process') {
      errors.push({ path: `${p}.entityType`, message: `must be "object" or "process", got "${e.entityType}"` });
    }
    if (e.essence !== 'physical' && e.essence !== 'informatical') {
      errors.push({ path: `${p}.essence`, message: `must be "physical" or "informatical", got "${e.essence}"` });
    }
    if (e.affiliation !== 'systemic' && e.affiliation !== 'environmental') {
      errors.push({ path: `${p}.affiliation`, message: `must be "systemic" or "environmental", got "${e.affiliation}"` });
    }

    if (entityIds.has(e.id)) {
      errors.push({ path: `${p}.id`, message: `duplicate id "${e.id}"` });
    }
    entityIds.set(e.id, e);

    if (e.entityType === 'process' && e.states && e.states.length > 0) {
      errors.push({ path: `${p}.states`, message: 'processes cannot have states' });
    }

    if (e.states) {
      const stateNames = new Set<string>();
      for (let j = 0; j < e.states.length; j++) {
        const s = e.states[j];
        if (!s.name) errors.push({ path: `${p}.states[${j}].name`, message: 'state name is required' });
        if (stateNames.has(s.name)) {
          errors.push({ path: `${p}.states[${j}].name`, message: `duplicate state name "${s.name}"` });
        }
        stateNames.add(s.name);
      }
    }
  }

  for (let i = 0; i < model.relationships.length; i++) {
    const r = model.relationships[i];
    const p = `relationships[${i}]`;

    if (!r.id) errors.push({ path: `${p}.id`, message: 'id is required' });
    if (!r.subject?.subjectId) {
      errors.push({ path: `${p}.subject.subjectId`, message: 'subjectId is required' });
    }
    if (!r.target?.targetId) {
      errors.push({ path: `${p}.target.targetId`, message: 'targetId is required' });
    }
    if (!VALID_RELATIONSHIPS.has(r.relationship)) {
      errors.push({ path: `${p}.relationship`, message: `unknown relationship "${r.relationship}"` });
    }

    const subj = entityIds.get(r.subject?.subjectId);
    const tgt = entityIds.get(r.target?.targetId);

    if (r.subject?.subjectId && !subj) {
      errors.push({ path: `${p}.subject.subjectId`, message: `references unknown entity "${r.subject.subjectId}"` });
    }
    if (r.target?.targetId && !tgt) {
      errors.push({ path: `${p}.target.targetId`, message: `references unknown entity "${r.target.targetId}"` });
    }

    if (r.subject?.subjectState && subj) {
      if (subj.entityType !== 'object') {
        errors.push({ path: `${p}.subject.subjectState`, message: 'subjectState only valid when subject is an object' });
      } else {
        const stateNames = new Set((subj.states ?? []).map(s => s.name));
        if (!stateNames.has(r.subject.subjectState)) {
          errors.push({ path: `${p}.subject.subjectState`, message: `state "${r.subject.subjectState}" not found on "${subj.id}"` });
        }
      }
    }

    if (r.target?.targetState && tgt) {
      const ts = r.target.targetState;
      if (tgt.entityType !== 'object') {
        errors.push({ path: `${p}.target.targetState`, message: 'targetState only valid when target is an object' });
      } else {
        const stateNames = new Set((tgt.states ?? []).map(s => s.name));
        if (ts.targetStateAt && !stateNames.has(ts.targetStateAt)) {
          errors.push({ path: `${p}.target.targetState.targetStateAt`, message: `state "${ts.targetStateAt}" not found on "${tgt.id}"` });
        }
        if (ts.targetStateFrom && !stateNames.has(ts.targetStateFrom)) {
          errors.push({ path: `${p}.target.targetState.targetStateFrom`, message: `state "${ts.targetStateFrom}" not found on "${tgt.id}"` });
        }
        if (ts.targetStateTo && !stateNames.has(ts.targetStateTo)) {
          errors.push({ path: `${p}.target.targetState.targetStateTo`, message: `state "${ts.targetStateTo}" not found on "${tgt.id}"` });
        }
        if (ts.targetStateFrom && ts.targetStateTo && ts.targetStateFrom === ts.targetStateTo) {
          errors.push({ path: `${p}.target.targetState`, message: 'targetStateFrom and targetStateTo cannot be the same' });
        }
      }

      if (r.relationship === 'changes') {
        if (!ts.targetStateFrom || !ts.targetStateTo) {
          errors.push({ path: `${p}.target.targetState`, message: '"changes" requires both targetStateFrom and targetStateTo' });
        }
      }
    }
  }

  return errors;
}
