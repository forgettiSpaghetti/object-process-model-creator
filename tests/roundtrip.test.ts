import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { parseOpl } from '../src/parser.js';
import { irToOpl } from '../src/opl-gen.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixtureDir = join(__dirname, '..', 'fixtures');

function parseToSets(opl: string) {
  const ir = parseOpl(opl);
  return {
    objectNames: new Set(ir.objects.map(o => o.name)),
    processNames: new Set(ir.processes.map(p => p.name)),
    objectCount: ir.objects.length,
    processCount: ir.processes.length,
    linkCount: ir.links.length,
    stateCount: ir.objects.reduce((sum, o) => sum + o.states.length, 0),
  };
}

describe('round-trip: OPL → IR → OPL → IR', () => {
  const originalOpl = readFileSync(join(fixtureDir, 'simple.opl'), 'utf-8');
  const ir1 = parseOpl(originalOpl);
  const regeneratedOpl = irToOpl(ir1);
  const ir2 = parseOpl(regeneratedOpl);

  it('preserves object count', () => {
    expect(ir2.objects.length).toBe(ir1.objects.length);
  });

  it('preserves process count', () => {
    expect(ir2.processes.length).toBe(ir1.processes.length);
  });

  it('preserves link count', () => {
    expect(ir2.links.length).toBe(ir1.links.length);
  });

  it('preserves all object names', () => {
    const names1 = ir1.objects.map(o => o.name).sort();
    const names2 = ir2.objects.map(o => o.name).sort();
    expect(names2).toEqual(names1);
  });

  it('preserves all process names', () => {
    const names1 = ir1.processes.map(p => p.name).sort();
    const names2 = ir2.processes.map(p => p.name).sort();
    expect(names2).toEqual(names1);
  });

  it('preserves all state definitions', () => {
    for (const obj1 of ir1.objects) {
      const obj2 = ir2.objects.find(o => o.id === obj1.id)!;
      expect(obj2, `object ${obj1.name} missing in round-trip`).toBeDefined();
      const states1 = obj1.states.map(s => s.name).sort();
      const states2 = obj2.states.map(s => s.name).sort();
      expect(states2).toEqual(states1);

      for (const st1 of obj1.states) {
        const st2 = obj2.states.find(s => s.id === st1.id)!;
        expect(st2.initial).toEqual(st1.initial);
        expect(st2.final).toEqual(st1.final);
        expect(st2.default).toEqual(st1.default);
      }
    }
  });

  it('preserves essence and affiliation', () => {
    for (const obj1 of ir1.objects) {
      const obj2 = ir2.objects.find(o => o.id === obj1.id)!;
      expect(obj2.essence).toBe(obj1.essence);
      expect(obj2.affiliation).toBe(obj1.affiliation);
    }
    for (const proc1 of ir1.processes) {
      const proc2 = ir2.processes.find(p => p.id === proc1.id)!;
      expect(proc2.essence).toBe(proc1.essence);
      expect(proc2.affiliation).toBe(proc1.affiliation);
    }
  });

  it('preserves link subtypes distribution', () => {
    const dist1 = linkDistribution(ir1.links);
    const dist2 = linkDistribution(ir2.links);
    expect(dist2).toEqual(dist1);
  });

  it('regenerated OPL re-parses identically', () => {
    const stats1 = parseToSets(originalOpl);
    const stats2 = parseToSets(regeneratedOpl);
    expect(stats2.objectCount).toBe(stats1.objectCount);
    expect(stats2.processCount).toBe(stats1.processCount);
    expect(stats2.linkCount).toBe(stats1.linkCount);
    expect(stats2.stateCount).toBe(stats1.stateCount);
  });
});

function linkDistribution(links: { subtype: string }[]): Record<string, number> {
  const dist: Record<string, number> = {};
  for (const l of links) {
    dist[l.subtype] = (dist[l.subtype] ?? 0) + 1;
  }
  return dist;
}
