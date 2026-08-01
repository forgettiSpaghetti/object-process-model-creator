/**
 * Generates OPL (Object-Process Language) textual sentences from a YAML-based OPM model.
 * Each sentence follows the ISO 19450 grammar for describing entities and their relationships.
 */
import type { OpmModel, Entity, LinkStatement } from './types.js';

/** Produce all OPL sentences for the given model: entity declarations, then relationship sentences. */
export function generateOplSentences(model: OpmModel): string[] {
  const sentences: string[] = [];
  const entityMap = new Map(model.entities.map(e => [e.id, e]));

  for (const e of model.entities) {
    sentences.push(...entityDeclaration(e));
  }

  sentences.push(...relationshipSentences(model.relationships, entityMap));

  return sentences;
}

function entityDeclaration(e: Entity): string[] {
  const lines: string[] = [];
  const article = /^[aeiou]/i.test(e.essence) ? 'an' : 'a';
  lines.push(`${e.name} is ${article} ${e.essence} and ${e.affiliation} ${e.entityType}.`);

  if (e.states && e.states.length > 0) {
    const names = e.states.map(s => s.name);
    lines.push(`${e.name} can be ${joinList(names, 'or')}.`);
    for (const s of e.states) {
      if (s.initial) lines.push(`State ${s.name} is initial.`);
      if (s.final) lines.push(`State ${s.name} is final.`);
      if (s.default) lines.push(`State ${s.name} is default.`);
    }
  }

  return lines;
}

/** Group "consists of" by subject; emit all other relationships individually. */
function relationshipSentences(
  rels: LinkStatement[],
  entityMap: Map<string, Entity>,
): string[] {
  const sentences: string[] = [];
  const name = (id: string) => entityMap.get(id)?.name ?? id;

  // Group aggregation parts by parent, preserving state info
  const aggParts = new Map<string, string[]>();
  const other: LinkStatement[] = [];
  for (const r of rels) {
    if (r.relationship === 'consists of') {
      if (!aggParts.has(r.subject.subjectId)) aggParts.set(r.subject.subjectId, []);
      let partStr = name(r.target.targetId);
      if (r.target.targetState?.targetStateAt) {
        partStr += ` at state ${r.target.targetState.targetStateAt}`;
      }
      aggParts.get(r.subject.subjectId)!.push(partStr);
    } else {
      other.push(r);
    }
  }

  for (const [subjectId, parts] of aggParts) {
    sentences.push(`${name(subjectId)} consists of ${joinList(parts, 'and')}.`);
  }

  for (const r of other) {
    const subj = name(r.subject.subjectId);
    const tgt = name(r.target.targetId);
    const ts = r.target.targetState;

    switch (r.relationship) {
      case 'handles':
        sentences.push(`${subj} handles ${tgt}.`);
        break;
      case 'requires':
        sentences.push(ts?.targetStateAt
          ? `${subj} requires ${tgt} at state ${ts.targetStateAt}.`
          : `${subj} requires ${tgt}.`);
        break;
      case 'yields':
        sentences.push(ts?.targetStateAt
          ? `${subj} yields ${tgt} at state ${ts.targetStateAt}.`
          : `${subj} yields ${tgt}.`);
        break;
      case 'consumes':
        sentences.push(ts?.targetStateAt
          ? `${subj} consumes ${tgt} at state ${ts.targetStateAt}.`
          : `${subj} consumes ${tgt}.`);
        break;
      case 'changes':
        if (ts?.targetStateFrom && ts?.targetStateTo) {
          sentences.push(`${subj} changes ${tgt} from ${ts.targetStateFrom} to ${ts.targetStateTo}.`);
        }
        break;
      case 'invokes':
        sentences.push(`${subj} invokes ${tgt}.`);
        break;
      case 'is a':
        sentences.push(`${subj} is a ${tgt}.`);
        break;
      case 'exhibits':
        sentences.push(`${subj} exhibits ${tgt}.`);
        break;
      default:
        sentences.push(`${subj} ${r.relationship} ${tgt}.`);
    }
  }

  return sentences;
}

function joinList(items: string[], conjunction: string): string {
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]} ${conjunction} ${items[1]}`;
  return items.slice(0, -1).join(', ') + `, ${conjunction} ` + items[items.length - 1];
}
