import { readFileSync, writeFileSync } from 'fs';
import { parse } from 'yaml';
import type { OpmModel } from './types.js';
import { validate } from './validate.js';
import { computeLayout } from './layout.js';
import { renderSvg } from './svg.js';
import { generateOplSentences } from './opl-sentences.js';

async function main() {
  const args = process.argv.slice(2);
  if (args.length < 1) {
    console.error('Usage: opl-render <input.yaml> [-o output.svg]');
    process.exit(1);
  }

  const inputPath = args[0];
  const outputIdx = args.indexOf('-o');
  const outputPath = outputIdx >= 0 ? args[outputIdx + 1] : inputPath.replace(/\.ya?ml$/i, '.svg');

  const raw = readFileSync(inputPath, 'utf-8');
  const model = parse(raw) as OpmModel;

  const errors = validate(model);
  if (errors.length > 0) {
    console.error('Validation errors:');
    for (const e of errors) {
      console.error(`  ${e.path}: ${e.message}`);
    }
    process.exit(1);
  }

  console.log(`Parsed ${model.entities.length} entities, ${model.relationships.length} relationships`);

  const layout = await computeLayout(model);
  console.log(`Layout: ${Math.round(layout.width)}x${Math.round(layout.height)}, ${layout.nodes.length} nodes, ${layout.edges.length} edges`);

  const svg = renderSvg(layout);
  writeFileSync(outputPath, svg, 'utf-8');
  console.log(`Wrote ${outputPath}`);

  const oplSentences = generateOplSentences(model);
  const oplPath = outputPath.replace(/\.svg$/i, '.opl');
  writeFileSync(oplPath, oplSentences.join('\n') + '\n', 'utf-8');
  console.log(`Wrote ${oplPath}`);

  console.log('\nOPL Sentences:');
  for (const s of oplSentences) {
    console.log(`  ${s}`);
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
