import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { parseOpl } from '../src/parser.js';
import type { AggregationLink, AgentLink, InstrumentLink, ResultLink, InvocationLink, EffectLink, ConsumptionLink } from '../src/ir.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixtureDir = join(__dirname, '..', 'fixtures');

describe('parser — individual templates', () => {
  it('parses object declaration', () => {
    const ir = parseOpl('Donor is a physical and environmental object.');
    expect(ir.objects).toHaveLength(1);
    expect(ir.objects[0]).toMatchObject({
      id: 'donor',
      name: 'Donor',
      essence: 'physical',
      affiliation: 'environmental',
    });
  });

  it('parses process declaration', () => {
    const ir = parseOpl('Contributing is an informatical and systemic process.');
    expect(ir.processes).toHaveLength(1);
    expect(ir.processes[0]).toMatchObject({
      id: 'contributing',
      name: 'Contributing',
      essence: 'informatical',
      affiliation: 'systemic',
    });
  });

  it('parses multi-word names', () => {
    const ir = parseOpl('Donor-advised Fund is a physical and systemic object.');
    expect(ir.objects[0]).toMatchObject({
      id: 'donor-advised-fund',
      name: 'Donor-advised Fund',
    });
  });

  it('parses state definitions', () => {
    const ir = parseOpl(
      'Asset is a physical and environmental object.\n' +
      'Asset can be donated, granted, invested, liquid or owned.',
    );
    expect(ir.objects[0].states).toHaveLength(5);
    const names = ir.objects[0].states.map(s => s.name);
    expect(names).toEqual(['donated', 'granted', 'invested', 'liquid', 'owned']);
  });

  it('parses state initial modifier', () => {
    const ir = parseOpl(
      'Asset is a physical and environmental object.\n' +
      'Asset can be donated or owned.\n' +
      'State owned is initial.',
    );
    const owned = ir.objects[0].states.find(s => s.name === 'owned');
    expect(owned?.initial).toBe(true);
    const donated = ir.objects[0].states.find(s => s.name === 'donated');
    expect(donated?.initial).toBeUndefined();
  });

  it('parses state final modifier', () => {
    const ir = parseOpl(
      'Asset is a physical and environmental object.\n' +
      'Asset can be granted or owned.\n' +
      'State granted is final.',
    );
    const granted = ir.objects[0].states.find(s => s.name === 'granted');
    expect(granted?.final).toBe(true);
  });

  it('parses simple consists of', () => {
    const ir = parseOpl(
      'Donor is a physical and environmental object.\n' +
      'Donor-owned Investment Account is a physical and environmental object.\n' +
      'Donor consists of Donor-owned Investment Account.',
    );
    expect(ir.links).toHaveLength(1);
    const link = ir.links[0] as AggregationLink;
    expect(link.subtype).toBe('aggregation-participation');
    expect(link.whole).toBe('donor');
    expect(link.parts).toEqual([{ thing: 'donor-owned-investment-account' }]);
  });

  it('parses consists of with state', () => {
    const ir = parseOpl(
      'Charity is a physical and environmental object.\n' +
      'Asset is a physical and environmental object.\n' +
      'Asset can be granted.\n' +
      'Charity consists of Asset at state granted.',
    );
    const link = ir.links[0] as AggregationLink;
    expect(link.parts).toEqual([{ thing: 'asset', state: 'asset.granted' }]);
  });

  it('parses consists of with multiple states', () => {
    const ir = parseOpl(
      'Donor-advised Fund is a physical and systemic object.\n' +
      'Asset is a physical and environmental object.\n' +
      'Asset can be donated, invested or liquid.\n' +
      'Donor-advised Fund consists of Asset at states donated, invested or liquid.',
    );
    const link = ir.links[0] as AggregationLink;
    expect(link.parts).toHaveLength(3);
    expect(link.parts.map(p => p.state)).toEqual([
      'asset.donated',
      'asset.invested',
      'asset.liquid',
    ]);
  });

  it('parses consists of with two objects', () => {
    const ir = parseOpl(
      'Donor-advised Fund Sponsor is a physical and systemic object.\n' +
      'Donor-advised Fund is a physical and systemic object.\n' +
      'Investment Products is a physical and systemic object.\n' +
      'Donor-advised Fund Sponsor consists of Donor-advised Fund and Investment Products.',
    );
    const link = ir.links[0] as AggregationLink;
    expect(link.whole).toBe('donor-advised-fund-sponsor');
    expect(link.parts).toHaveLength(2);
    expect(link.parts.map(p => p.thing)).toEqual([
      'donor-advised-fund',
      'investment-products',
    ]);
  });

  it('parses single handler', () => {
    const ir = parseOpl(
      'Donor-advised Fund Sponsor is a physical and systemic object.\n' +
      'Investing is an informatical and systemic process.\n' +
      'Donor-advised Fund Sponsor handles Investing.',
    );
    const link = ir.links[0] as AgentLink;
    expect(link.subtype).toBe('agent');
    expect(link.object).toBe('donor-advised-fund-sponsor');
    expect(link.process).toBe('investing');
    expect(link.initiates).toBeUndefined();
  });

  it('parses multiple handlers', () => {
    const ir = parseOpl(
      'Donor is a physical and environmental object.\n' +
      'Donor-advised Fund Sponsor is a physical and systemic object.\n' +
      'Contributing is an informatical and systemic process.\n' +
      'Donor and Donor-advised Fund Sponsor handle Contributing.',
    );
    const agentLinks = ir.links.filter(l => l.subtype === 'agent') as AgentLink[];
    expect(agentLinks).toHaveLength(2);
    expect(agentLinks.map(l => l.object).sort()).toEqual([
      'donor',
      'donor-advised-fund-sponsor',
    ]);
  });

  it('parses initiates and handles', () => {
    const ir = parseOpl(
      'Donor is a physical and environmental object.\n' +
      'Granting is an informatical and systemic process.\n' +
      'Donor initiates and handles Granting.',
    );
    const link = ir.links[0] as AgentLink;
    expect(link.subtype).toBe('agent');
    expect(link.initiates).toBe(true);
    expect(link.object).toBe('donor');
  });

  it('parses simple requires', () => {
    const ir = parseOpl(
      'Contributing is an informatical and systemic process.\n' +
      'Donor-advised Fund is a physical and systemic object.\n' +
      'Donor-owned Investment Account is a physical and environmental object.\n' +
      'Contributing requires Donor-advised Fund and Donor-owned Investment Account.',
    );
    const instLinks = ir.links.filter(l => l.subtype === 'instrument') as InstrumentLink[];
    expect(instLinks).toHaveLength(2);
    expect(instLinks.map(l => l.object).sort()).toEqual([
      'donor-advised-fund',
      'donor-owned-investment-account',
    ]);
  });

  it('parses requires with state-specified object', () => {
    const ir = parseOpl(
      'Investing is an informatical and systemic process.\n' +
      'Donor-advised Fund is a physical and systemic object.\n' +
      'Investment Products is a physical and systemic object.\n' +
      'Asset is a physical and environmental object.\n' +
      'Asset can be liquid.\n' +
      'Investing requires Donor-advised Fund, Investment Products, and Asset at state liquid.',
    );
    const instLinks = ir.links.filter(l => l.subtype === 'instrument') as InstrumentLink[];
    expect(instLinks).toHaveLength(3);
    const assetInst = instLinks.find(l => l.object === 'asset')!;
    expect(assetInst.state).toBe('asset.liquid');
    const noStateLinks = instLinks.filter(l => !l.state);
    expect(noStateLinks).toHaveLength(2);
  });

  it('parses yields with state', () => {
    const ir = parseOpl(
      'Investing is an informatical and systemic process.\n' +
      'Asset is a physical and environmental object.\n' +
      'Asset can be invested.\n' +
      'Investing yields Asset at state invested.',
    );
    const link = ir.links[0] as ResultLink;
    expect(link.subtype).toBe('result');
    expect(link.object).toBe('asset');
    expect(link.state).toBe('asset.invested');
  });

  it('parses invokes', () => {
    const ir = parseOpl(
      'Contributing is an informatical and systemic process.\n' +
      'Liquidating is an informatical and systemic process.\n' +
      'Contributing invokes Liquidating.',
    );
    const link = ir.links[0] as InvocationLink;
    expect(link.subtype).toBe('invocation');
    expect(link.process).toBe('contributing');
    expect(link.target).toBe('liquidating');
  });

  it('parses consumes', () => {
    const ir = parseOpl(
      'Eating is an informatical and systemic process.\n' +
      'Food is a physical and environmental object.\n' +
      'Eating consumes Food.',
    );
    const link = ir.links[0] as ConsumptionLink;
    expect(link.subtype).toBe('consumption');
    expect(link.process).toBe('eating');
    expect(link.object).toBe('food');
  });

  it('parses changes from to (effect)', () => {
    const ir = parseOpl(
      'Liquidating is an informatical and systemic process.\n' +
      'Asset is a physical and environmental object.\n' +
      'Asset can be donated or liquid.\n' +
      'Liquidating changes Asset from donated to liquid.',
    );
    const link = ir.links[0] as EffectLink;
    expect(link.subtype).toBe('effect');
    expect(link.process).toBe('liquidating');
    expect(link.object).toBe('asset');
    expect(link.fromState).toBe('asset.donated');
    expect(link.toState).toBe('asset.liquid');
  });
});

describe('parser — golden fixture (simple.opl)', () => {
  const opl = readFileSync(join(fixtureDir, 'simple.opl'), 'utf-8');
  const ir = parseOpl(opl);

  it('parses 4 objects', () => {
    expect(ir.objects).toHaveLength(4);
    const names = ir.objects.map(o => o.name).sort();
    expect(names).toEqual(['Bread', 'Flour', 'Water', 'Yeast']);
  });

  it('parses 2 processes', () => {
    expect(ir.processes).toHaveLength(2);
    const names = ir.processes.map(p => p.name).sort();
    expect(names).toEqual(['Baking', 'Mixing']);
  });

  it('parses 2 states on Bread', () => {
    const bread = ir.objects.find(o => o.id === 'bread')!;
    expect(bread.states).toHaveLength(2);
    const stateNames = bread.states.map(s => s.name).sort();
    expect(stateNames).toEqual(['baked', 'raw']);
  });

  it('marks raw as initial', () => {
    const bread = ir.objects.find(o => o.id === 'bread')!;
    const raw = bread.states.find(s => s.name === 'raw')!;
    expect(raw.initial).toBe(true);
  });

  it('marks baked as final', () => {
    const bread = ir.objects.find(o => o.id === 'bread')!;
    const baked = bread.states.find(s => s.name === 'baked')!;
    expect(baked.final).toBe(true);
  });

  it('all essence/affiliation values are correct', () => {
    const bread = ir.objects.find(o => o.id === 'bread')!;
    expect(bread.essence).toBe('physical');
    expect(bread.affiliation).toBe('systemic');

    const flour = ir.objects.find(o => o.id === 'flour')!;
    expect(flour.essence).toBe('physical');
    expect(flour.affiliation).toBe('environmental');

    const baking = ir.processes.find(p => p.id === 'baking')!;
    expect(baking.essence).toBe('informatical');
    expect(baking.affiliation).toBe('systemic');
  });

  it('has correct aggregation links', () => {
    const aggLinks = ir.links.filter(
      l => l.subtype === 'aggregation-participation',
    ) as AggregationLink[];
    expect(aggLinks.length).toBe(1);
  });

  it('has correct instrument links', () => {
    const instLinks = ir.links.filter(
      l => l.subtype === 'instrument',
    ) as InstrumentLink[];
    expect(instLinks.length).toBe(2);
  });

  it('has correct effect link', () => {
    const effectLinks = ir.links.filter(
      l => l.subtype === 'effect',
    ) as EffectLink[];
    expect(effectLinks.length).toBe(1);
    expect(effectLinks[0].fromState).toBe('bread.raw');
    expect(effectLinks[0].toState).toBe('bread.baked');
  });

  it('has correct invocation link', () => {
    const invLinks = ir.links.filter(
      l => l.subtype === 'invocation',
    ) as InvocationLink[];
    expect(invLinks.length).toBe(1);
    expect(invLinks[0].process).toBe('baking');
    expect(invLinks[0].target).toBe('mixing');
  });

  it('all state-specified links resolve to real state ids', () => {
    const allStateIds = new Set<string>();
    for (const obj of ir.objects) {
      for (const st of obj.states) {
        allStateIds.add(st.id);
      }
    }

    for (const link of ir.links) {
      if (link.subtype === 'aggregation-participation') {
        for (const part of link.parts) {
          if (part.state) {
            expect(allStateIds.has(part.state),
              `aggregation state ${part.state} should exist`).toBe(true);
          }
        }
      }
      if ('state' in link && link.state) {
        expect(allStateIds.has(link.state as string),
          `link state ${link.state} should exist`).toBe(true);
      }
    }
  });

  it('total link count is correct', () => {
    expect(ir.links).toHaveLength(5);
  });
});
