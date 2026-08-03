/**
 * Standalone HTML viewer for a rendered OPD: wraps the SVG in a page with
 * basic stats, a legend covering only the relationship types actually used
 * in the model, and a panel of the generated OPL sentences. Written
 * alongside the .svg/.opl outputs, not dependent on either at runtime.
 */
import type { OpmModel, Relationship } from './types.js';
import type { LayoutResult } from './layout.js';
import { OBJECT_COLOR, PROCESS_COLOR } from './svg.js';

interface LegendEntry {
  keys: Relationship[];
  label: string;
  note?: string;
  glyph: string;
}

const LEGEND: LegendEntry[] = [
  {
    keys: ['handles'],
    label: 'agent — handles',
    glyph: '<svg width="26" height="12" viewBox="0 0 26 12"><line x1="1" y1="6" x2="19" y2="6" stroke="#333" stroke-width="1.5"/><circle cx="21" cy="6" r="4" fill="#333"/></svg>',
  },
  {
    keys: ['requires'],
    label: 'instrument — requires',
    glyph: '<svg width="26" height="12" viewBox="0 0 26 12"><line x1="1" y1="6" x2="19" y2="6" stroke="#333" stroke-width="1.5"/><circle cx="21" cy="6" r="4" fill="white" stroke="#333" stroke-width="1.5"/></svg>',
  },
  {
    keys: ['changes'],
    label: 'effect — changes',
    note: 'diagonal, one shared anchor per relationship',
    glyph: '<svg width="26" height="12" viewBox="0 0 26 12"><line x1="1" y1="6" x2="16" y2="6" stroke="#333" stroke-width="1.5"/><path d="M16 1 L 25 6 L 16 11 Z" fill="white" stroke="#333" stroke-width="1.5"/></svg>',
  },
  {
    keys: ['invokes'],
    label: 'invocation — invokes',
    glyph: '<svg width="28" height="12" viewBox="0 0 28 12"><line x1="1" y1="6" x2="14" y2="6" stroke="#333" stroke-width="1.5"/><path d="M14 1 L 19 6 L 14 11 M 21 1 L 26 6 L 21 11" fill="none" stroke="#333" stroke-width="1.5"/></svg>',
  },
  {
    keys: ['yields', 'consumes'],
    label: 'result / consumption — yields, consumes',
    glyph: '<svg width="26" height="12" viewBox="0 0 26 12"><line x1="1" y1="6" x2="16" y2="6" stroke="#333" stroke-width="1.5"/><path d="M16 1 L 25 6 L 16 11 Z" fill="#333"/></svg>',
  },
  {
    keys: ['is a'],
    label: 'inheritance — is a',
    glyph: '<svg width="26" height="12" viewBox="0 0 26 12"><line x1="1" y1="6" x2="16" y2="6" stroke="#333" stroke-width="1.5"/><path d="M25 1 L 16 6 L 25 11 Z" fill="white" stroke="#333" stroke-width="1"/></svg>',
  },
];

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function renderHtml(
  svg: string,
  oplSentences: string[],
  model: OpmModel,
  layout: LayoutResult,
  title: string,
): string {
  const usedRels = new Set(model.relationships.map(r => r.relationship));
  const legendRows = LEGEND.filter(e => e.keys.some(k => usedRels.has(k)));
  const hasAggregation = usedRels.has('consists of');

  const legendHtml = [
    `<span class="legend-item"><span class="swatch-object"></span> object</span>`,
    `<span class="legend-item"><span class="swatch-process"></span> process</span>`,
    `<span class="legend-sep"></span>`,
    ...legendRows.map(e => `<span class="legend-item">${e.glyph} ${esc(e.label)}${e.note ? ` <span class="legend-note">(${esc(e.note)})</span>` : ''}</span>`),
    ...(hasAggregation ? [
      `<span class="legend-sep"></span>`,
      `<span class="legend-item"><svg width="20" height="14" viewBox="0 0 20 14"><polygon points="10,1 3,12 17,12" fill="#333"/></svg> aggregation — consists of <span class="legend-note">(parts fan out off a spine below the whole)</span></span>`,
    ] : []),
  ].join('\n    ');

  const sentencesHtml = oplSentences.map(s => `<p>${esc(s)}</p>`).join('\n      ');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<style>
  :root {
    --bg: #f2f5f1;
    --surface: #ffffff;
    --surface-2: #eef1ec;
    --border: #d7ded5;
    --text: #1c2620;
    --text-muted: #5c6b60;
    --mono: ui-monospace, "SF Mono", "Cascadia Code", Menlo, Consolas, monospace;
    --sans: -apple-system, BlinkMacSystemFont, "Segoe UI", ui-sans-serif, sans-serif;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #10140f;
      --surface: #171d16;
      --surface-2: #1d241b;
      --border: #2c362a;
      --text: #e6ece4;
      --text-muted: #93a390;
    }
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    background: var(--bg);
    color: var(--text);
    font-family: var(--sans);
    padding: 32px 20px 60px;
  }
  main {
    max-width: 1400px;
    margin: 0 auto;
    display: flex;
    flex-direction: column;
    gap: 18px;
  }
  header {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: 8px 20px;
    padding-bottom: 14px;
    border-bottom: 1px solid var(--border);
  }
  header h1 {
    font-family: var(--mono);
    font-size: 15px;
    font-weight: 600;
    margin: 0;
    letter-spacing: -0.01em;
  }
  .stats {
    display: flex;
    gap: 16px;
    font-family: var(--mono);
    font-size: 12.5px;
    color: var(--text-muted);
    font-variant-numeric: tabular-nums;
  }
  .stats b { color: var(--text); font-weight: 600; }
  .body-grid {
    display: grid;
    grid-template-columns: 1fr 320px;
    gap: 18px;
    align-items: start;
  }
  @media (max-width: 900px) {
    .body-grid { grid-template-columns: 1fr; }
  }
  .canvas {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 10px;
    padding: 24px;
    overflow-x: auto;
  }
  .canvas svg { display: block; margin: 0 auto; max-width: 100%; height: auto; }
  .sentences {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 10px;
    padding: 18px 20px;
    max-height: 80vh;
    overflow-y: auto;
  }
  .sentences h2 {
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-muted);
    margin: 0 0 12px;
    font-weight: 600;
  }
  .sentences p {
    margin: 0 0 9px;
    font-size: 13.5px;
    line-height: 1.5;
  }
  .legend {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    padding: 14px 18px;
    background: var(--surface-2);
    border: 1px solid var(--border);
    border-radius: 10px;
  }
  .legend-item {
    display: flex;
    align-items: center;
    gap: 7px;
    font-size: 12.5px;
    color: var(--text-muted);
    white-space: nowrap;
  }
  .legend-note { opacity: .7; }
  .legend-item svg { flex-shrink: 0; }
  .legend-sep {
    width: 1px;
    align-self: stretch;
    background: var(--border);
    margin: 2px 2px;
  }
  .swatch-object, .swatch-process {
    display: inline-block;
    width: 11px;
    height: 11px;
    border-radius: 2px;
  }
  .swatch-object { background: ${OBJECT_COLOR}; }
  .swatch-process { background: ${PROCESS_COLOR}; border-radius: 50%; }
</style>
</head>
<body>
<main>
  <header>
    <h1>${esc(title)}</h1>
    <div class="stats">
      <span><b>${layout.nodes.length}</b> nodes</span>
      <span><b>${layout.edges.length}</b> edges</span>
      <span><b>${Math.round(layout.width)}×${Math.round(layout.height)}</b></span>
    </div>
  </header>

  <div class="body-grid">
    <div class="canvas">
${svg}
    </div>
    <div class="sentences">
      <h2>OPL Sentences</h2>
      ${sentencesHtml}
    </div>
  </div>

  <div class="legend">
    ${legendHtml}
  </div>
</main>
</body>
</html>
`;
}
