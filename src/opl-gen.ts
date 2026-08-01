import type {
  OpmModel,
  OpmObject,
  OpmProcess,
  Link,
  AggregationLink,
  AgentLink,
  InstrumentLink,
  ResultLink,
  ConsumptionLink,
  EffectLink,
  InvocationLink,
} from './ir.js';

export function irToOpl(model: OpmModel): string {
  const lines: string[] = [];

  for (const obj of model.objects) {
    lines.push(thingDecl(obj, 'object'));
    if (obj.states.length > 0) {
      lines.push(stateDef(obj));
      for (const st of obj.states) {
        if (st.initial) lines.push(`State ${st.name} is initial.`);
        if (st.final) lines.push(`State ${st.name} is final.`);
        if (st.default) lines.push(`State ${st.name} is default.`);
      }
    }
  }

  for (const proc of model.processes) {
    lines.push(thingDecl(proc, 'process'));
  }

  for (const link of model.links) {
    const line = linkToOpl(link, model);
    if (line) lines.push(line);
  }

  return lines.join('\n') + '\n';
}

function article(word: string): string {
  return /^[aeiou]/i.test(word) ? 'an' : 'a';
}

function thingDecl(thing: OpmObject | OpmProcess, kind: string): string {
  return `${thing.name} is ${article(thing.essence)} ${thing.essence} and ${thing.affiliation} ${kind}.`;
}

function stateDef(obj: OpmObject): string {
  const names = obj.states.map(s => s.name);
  return `${obj.name} can be ${formatList(names, 'or')}.`;
}

function formatList(items: string[], conjunction: string): string {
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]} ${conjunction} ${items[1]}`;
  return items.slice(0, -1).join(', ') + ` ${conjunction} ` + items[items.length - 1];
}

function findObjectName(id: string, model: OpmModel): string {
  const obj = model.objects.find(o => o.id === id);
  return obj?.name ?? id;
}

function findProcessName(id: string, model: OpmModel): string {
  const proc = model.processes.find(p => p.id === id);
  return proc?.name ?? id;
}

function findStateName(stateId: string, model: OpmModel): string {
  for (const obj of model.objects) {
    for (const st of obj.states) {
      if (st.id === stateId) return st.name;
    }
  }
  return stateId;
}

function linkToOpl(link: Link, model: OpmModel): string | null {
  switch (link.subtype) {
    case 'aggregation-participation':
      return aggregationToOpl(link, model);
    case 'agent':
      return agentToOpl(link, model);
    case 'instrument':
      return instrumentToOpl(link, model);
    case 'result':
      return resultToOpl(link, model);
    case 'consumption':
      return consumptionToOpl(link, model);
    case 'effect':
      return effectToOpl(link, model);
    case 'invocation':
      return invocationToOpl(link, model);
    default:
      return null;
  }
}

function aggregationToOpl(link: AggregationLink, model: OpmModel): string {
  const wholeName = findObjectName(link.whole, model);

  const grouped = new Map<string, string[]>();
  const order: string[] = [];
  for (const p of link.parts) {
    if (!grouped.has(p.thing)) {
      grouped.set(p.thing, []);
      order.push(p.thing);
    }
    if (p.state) {
      grouped.get(p.thing)!.push(findStateName(p.state, model));
    }
  }

  const partStrs = order.map(thingId => {
    const name = findObjectName(thingId, model);
    const states = grouped.get(thingId)!;
    if (states.length === 0) return name;
    if (states.length === 1) return `${name} at state ${states[0]}`;
    return `${name} at states ${formatList(states, 'or')}`;
  });

  return `${wholeName} consists of ${formatList(partStrs, 'and')}.`;
}

function agentToOpl(link: AgentLink, model: OpmModel): string {
  const objName = findObjectName(link.object, model);
  const procName = findProcessName(link.process, model);
  if (link.initiates) {
    return `${objName} initiates and handles ${procName}.`;
  }
  return `${objName} handles ${procName}.`;
}

function instrumentToOpl(link: InstrumentLink, model: OpmModel): string {
  const procName = findProcessName(link.process, model);
  const objName = findObjectName(link.object, model);
  if (link.state) {
    return `${procName} requires ${objName} at state ${findStateName(link.state, model)}.`;
  }
  return `${procName} requires ${objName}.`;
}

function resultToOpl(link: ResultLink, model: OpmModel): string {
  const procName = findProcessName(link.process, model);
  const objName = findObjectName(link.object, model);
  if (link.state) {
    return `${procName} yields ${objName} at state ${findStateName(link.state, model)}.`;
  }
  return `${procName} yields ${objName}.`;
}

function consumptionToOpl(link: ConsumptionLink, model: OpmModel): string {
  const procName = findProcessName(link.process, model);
  const objName = findObjectName(link.object, model);
  if (link.state) {
    return `${procName} consumes ${objName} at state ${findStateName(link.state, model)}.`;
  }
  return `${procName} consumes ${objName}.`;
}

function effectToOpl(link: EffectLink, model: OpmModel): string {
  const procName = findProcessName(link.process, model);
  const objName = findObjectName(link.object, model);
  return `${procName} changes ${objName} from ${findStateName(link.fromState, model)} to ${findStateName(link.toState, model)}.`;
}

function invocationToOpl(link: InvocationLink, model: OpmModel): string {
  const srcName = findProcessName(link.process, model);
  const tgtName = findProcessName(link.target, model);
  return `${srcName} invokes ${tgtName}.`;
}
