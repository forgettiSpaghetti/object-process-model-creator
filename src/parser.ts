import type {
  OpmModel,
  OpmObject,
  OpmProcess,
  Essence,
  Affiliation,
  Link,
  StateRef,
} from './ir.js';
import { nameToId, stateId, flattenList } from './utils.js';

export function parseOpl(input: string): OpmModel {
  const objectMap = new Map<string, OpmObject>();
  const processMap = new Map<string, OpmProcess>();
  const links: Link[] = [];

  const lines = input
    .split('\n')
    .map(l => l.trim())
    .filter(l => l.length > 0);

  for (const line of lines) {
    const noDot = line.endsWith('.') ? line.slice(0, -1) : line;

    if (tryThingDeclaration(noDot, objectMap, processMap)) continue;
    if (tryStateDef(noDot, objectMap)) continue;
    if (tryStateModifier(noDot, objectMap)) continue;
    if (tryConsistsOf(noDot, objectMap, links)) continue;
    if (tryHandles(noDot, objectMap, processMap, links)) continue;
    if (tryRequires(noDot, objectMap, processMap, links)) continue;
    if (tryYields(noDot, objectMap, processMap, links)) continue;
    if (tryInvokes(noDot, processMap, links)) continue;
    if (tryConsumes(noDot, objectMap, processMap, links)) continue;
    if (tryEffect(noDot, objectMap, processMap, links)) continue;
  }

  return {
    meta: { opmVersion: 'ISO-19450', diagram: 'SD' },
    objects: [...objectMap.values()],
    processes: [...processMap.values()],
    links,
  };
}

function ensureObject(
  name: string,
  map: Map<string, OpmObject>,
  essence?: Essence,
  affiliation?: Affiliation,
): OpmObject {
  const id = nameToId(name);
  let obj = map.get(id);
  if (!obj) {
    obj = {
      id,
      name,
      essence: essence ?? 'informatical',
      affiliation: affiliation ?? 'systemic',
      states: [],
    };
    map.set(id, obj);
  } else if (essence && affiliation) {
    obj.essence = essence;
    obj.affiliation = affiliation;
  }
  return obj;
}

function ensureProcess(
  name: string,
  map: Map<string, OpmProcess>,
  essence?: Essence,
  affiliation?: Affiliation,
): OpmProcess {
  const id = nameToId(name);
  let proc = map.get(id);
  if (!proc) {
    proc = {
      id,
      name,
      essence: essence ?? 'informatical',
      affiliation: affiliation ?? 'systemic',
    };
    map.set(id, proc);
  } else if (essence && affiliation) {
    proc.essence = essence;
    proc.affiliation = affiliation;
  }
  return proc;
}

function parseEssence(s: string): Essence {
  return s.toLowerCase() === 'physical' ? 'physical' : 'informatical';
}

function parseAffiliation(s: string): Affiliation {
  return s.toLowerCase() === 'systemic' ? 'systemic' : 'environmental';
}

function tryThingDeclaration(
  line: string,
  objectMap: Map<string, OpmObject>,
  processMap: Map<string, OpmProcess>,
): boolean {
  const m = line.match(
    /^(.+?)\s+is\s+an?\s+(physical|informatical)\s+and\s+(systemic|environmental)\s+(object|process)$/i,
  );
  if (!m) return false;
  const [, name, essStr, affStr, kind] = m;
  const essence = parseEssence(essStr);
  const affiliation = parseAffiliation(affStr);
  if (kind.toLowerCase() === 'object') {
    ensureObject(name, objectMap, essence, affiliation);
  } else {
    ensureProcess(name, processMap, essence, affiliation);
  }
  return true;
}

function tryStateDef(
  line: string,
  objectMap: Map<string, OpmObject>,
): boolean {
  const m = line.match(/^(.+?)\s+can\s+be\s+(.+)$/i);
  if (!m) return false;
  const [, objName, statesStr] = m;
  const obj = ensureObject(objName, objectMap);
  const stateNames = flattenList(statesStr);
  for (const sName of stateNames) {
    const sid = stateId(obj.id, sName);
    if (!obj.states.find(s => s.id === sid)) {
      obj.states.push({ id: sid, name: sName });
    }
  }
  return true;
}

function tryStateModifier(
  line: string,
  objectMap: Map<string, OpmObject>,
): boolean {
  const m = line.match(/^State\s+(.+?)\s+is\s+(initial|final|default)$/i);
  if (!m) return false;
  const [, stateName, modifier] = m;
  const sNameLower = stateName.toLowerCase();
  for (const obj of objectMap.values()) {
    for (const st of obj.states) {
      if (st.name.toLowerCase() === sNameLower) {
        if (modifier.toLowerCase() === 'initial') st.initial = true;
        else if (modifier.toLowerCase() === 'final') st.final = true;
        else if (modifier.toLowerCase() === 'default') st.default = true;
      }
    }
  }
  return true;
}

function parseRhsList(
  text: string,
  objectMap: Map<string, OpmObject>,
): StateRef[] {
  const atStatesMatch = text.match(/^(.+)\s+at\s+states\s+(.+)$/i);
  if (atStatesMatch) {
    const [, beforeAt, statesStr] = atStatesMatch;
    const stateNames = flattenList(statesStr);
    const items = flattenList(beforeAt);
    const stateObjName = items.pop()!;
    const stateObj = ensureObject(stateObjName, objectMap);
    const stateRefs: StateRef[] = stateNames.map(sn => ({
      thing: stateObj.id,
      state: stateId(stateObj.id, sn.trim()),
    }));
    const plainRefs: StateRef[] = items.map(name => ({
      thing: ensureObject(name.trim(), objectMap).id,
    }));
    return [...plainRefs, ...stateRefs];
  }

  const atStateMatch = text.match(/^(.+)\s+at\s+state\s+(\S+)$/i);
  if (atStateMatch) {
    const [, beforeAt, stateName] = atStateMatch;
    const items = flattenList(beforeAt);
    const stateObjName = items.pop()!;
    const stateObj = ensureObject(stateObjName, objectMap);
    const plainRefs: StateRef[] = items.map(name => ({
      thing: ensureObject(name.trim(), objectMap).id,
    }));
    return [
      ...plainRefs,
      { thing: stateObj.id, state: stateId(stateObj.id, stateName.trim()) },
    ];
  }

  const names = flattenList(text);
  return names.map(name => ({
    thing: ensureObject(name.trim(), objectMap).id,
  }));
}

function tryConsistsOf(
  line: string,
  objectMap: Map<string, OpmObject>,
  links: Link[],
): boolean {
  const m = line.match(/^(.+?)\s+consists\s+of\s+(.+)$/i);
  if (!m) return false;
  const [, wholeName, partsStr] = m;
  const whole = ensureObject(wholeName, objectMap);
  const parts = parseRhsList(partsStr, objectMap);

  links.push({
    kind: 'structural',
    subtype: 'aggregation-participation',
    whole: whole.id,
    parts,
  });
  return true;
}

function tryHandles(
  line: string,
  objectMap: Map<string, OpmObject>,
  processMap: Map<string, OpmProcess>,
  links: Link[],
): boolean {
  const initiatesMatch = line.match(
    /^(.+?)\s+initiates\s+and\s+handles\s+(.+)$/i,
  );
  if (initiatesMatch) {
    const [, objName, procName] = initiatesMatch;
    const obj = ensureObject(objName.trim(), objectMap);
    const proc = ensureProcess(procName.trim(), processMap);
    links.push({
      kind: 'procedural',
      subtype: 'agent',
      process: proc.id,
      object: obj.id,
      initiates: true,
    });
    return true;
  }

  const handleMatch = line.match(
    /^(.+?)\s+handles?\s+(.+)$/i,
  );
  if (!handleMatch) return false;
  const [, agentsStr, procName] = handleMatch;
  const proc = ensureProcess(procName.trim(), processMap);
  const agentNames = flattenList(agentsStr);
  for (const aName of agentNames) {
    const obj = ensureObject(aName.trim(), objectMap);
    links.push({
      kind: 'procedural',
      subtype: 'agent',
      process: proc.id,
      object: obj.id,
    });
  }
  return true;
}

function tryRequires(
  line: string,
  objectMap: Map<string, OpmObject>,
  processMap: Map<string, OpmProcess>,
  links: Link[],
): boolean {
  const m = line.match(/^(.+?)\s+requires\s+(.+)$/i);
  if (!m) return false;
  const [, procName, itemsStr] = m;
  const proc = ensureProcess(procName.trim(), processMap);
  const refs = parseRhsList(itemsStr, objectMap);
  for (const ref of refs) {
    links.push({
      kind: 'procedural',
      subtype: 'instrument',
      process: proc.id,
      object: ref.thing,
      ...(ref.state ? { state: ref.state } : {}),
    });
  }
  return true;
}

function tryYields(
  line: string,
  objectMap: Map<string, OpmObject>,
  processMap: Map<string, OpmProcess>,
  links: Link[],
): boolean {
  const m = line.match(/^(.+?)\s+yields\s+(.+)$/i);
  if (!m) return false;
  const [, procName, itemsStr] = m;
  const proc = ensureProcess(procName.trim(), processMap);
  const refs = parseRhsList(itemsStr, objectMap);
  for (const ref of refs) {
    links.push({
      kind: 'procedural',
      subtype: 'result',
      process: proc.id,
      object: ref.thing,
      ...(ref.state ? { state: ref.state } : {}),
    });
  }
  return true;
}

function tryInvokes(
  line: string,
  processMap: Map<string, OpmProcess>,
  links: Link[],
): boolean {
  const m = line.match(/^(.+?)\s+invokes\s+(.+)$/i);
  if (!m) return false;
  const [, srcName, tgtName] = m;
  const src = ensureProcess(srcName.trim(), processMap);
  const tgt = ensureProcess(tgtName.trim(), processMap);
  links.push({
    kind: 'procedural',
    subtype: 'invocation',
    process: src.id,
    target: tgt.id,
  });
  return true;
}

function tryConsumes(
  line: string,
  objectMap: Map<string, OpmObject>,
  processMap: Map<string, OpmProcess>,
  links: Link[],
): boolean {
  const m = line.match(/^(.+?)\s+consumes\s+(.+)$/i);
  if (!m) return false;
  const [, procName, itemsStr] = m;
  const proc = ensureProcess(procName.trim(), processMap);
  const refs = parseRhsList(itemsStr, objectMap);
  for (const ref of refs) {
    links.push({
      kind: 'procedural',
      subtype: 'consumption',
      process: proc.id,
      object: ref.thing,
      ...(ref.state ? { state: ref.state } : {}),
    });
  }
  return true;
}

function tryEffect(
  line: string,
  objectMap: Map<string, OpmObject>,
  processMap: Map<string, OpmProcess>,
  links: Link[],
): boolean {
  const m = line.match(
    /^(.+?)\s+changes\s+(.+?)\s+from\s+(.+?)\s+to\s+(.+)$/i,
  );
  if (!m) return false;
  const [, procName, objName, fromState, toState] = m;
  const proc = ensureProcess(procName.trim(), processMap);
  const obj = ensureObject(objName.trim(), objectMap);
  links.push({
    kind: 'procedural',
    subtype: 'effect',
    process: proc.id,
    object: obj.id,
    fromState: stateId(obj.id, fromState.trim()),
    toState: stateId(obj.id, toState.trim()),
  });
  return true;
}
