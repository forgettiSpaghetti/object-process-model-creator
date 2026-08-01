import { describe, it, expect } from 'vitest';
import type { OpmModel } from '../src/ir.js';

describe('IR schema', () => {
  it('accepts a valid minimal model', () => {
    const model: OpmModel = {
      meta: { opmVersion: 'ISO-19450', diagram: 'SD' },
      objects: [
        {
          id: 'asset',
          name: 'Asset',
          essence: 'physical',
          affiliation: 'environmental',
          states: [
            { id: 'asset.owned', name: 'owned', initial: true },
            { id: 'asset.granted', name: 'granted', final: true },
          ],
        },
      ],
      processes: [
        {
          id: 'granting',
          name: 'Granting',
          essence: 'informatical',
          affiliation: 'systemic',
        },
      ],
      links: [
        {
          kind: 'structural',
          subtype: 'aggregation-participation',
          whole: 'charity',
          parts: [{ thing: 'asset', state: 'asset.granted' }],
        },
        {
          kind: 'procedural',
          subtype: 'agent',
          process: 'granting',
          object: 'donor',
          initiates: true,
        },
        {
          kind: 'procedural',
          subtype: 'result',
          process: 'granting',
          object: 'asset',
          state: 'asset.granted',
        },
        {
          kind: 'procedural',
          subtype: 'invocation',
          process: 'granting',
          target: 'charity-vetting',
        },
      ],
    };

    expect(model.objects).toHaveLength(1);
    expect(model.processes).toHaveLength(1);
    expect(model.links).toHaveLength(4);
    expect(model.objects[0].states).toHaveLength(2);
  });
});
