/**
 * MCP (Model Context Protocol) server that exposes OPM rendering tools.
 *
 * Tools:
 *   render_opd   – YAML model → SVG diagram
 *   generate_opl – YAML model → OPL sentences
 *   validate     – YAML model → validation errors (empty array = valid)
 *
 * Run with:  node dist/mcp-server.js
 * Configure in Claude Code / Claude Desktop via mcpServers settings.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { parse } from 'yaml';
import type { OpmModel } from './types.js';
import { validate } from './validate.js';
import { computeLayout } from './layout.js';
import { renderSvg } from './svg.js';
import { generateOplSentences } from './opl-sentences.js';

const server = new McpServer({
  name: 'opl-renderer',
  version: '0.1.0',
});

const yamlInput = z.object({
  yaml: z.string().describe('OPM model in YAML format (entities + relationships)'),
});

server.tool(
  'render_opd',
  'Render an OPM YAML model into an SVG Object-Process Diagram',
  { yaml: yamlInput.shape.yaml },
  async ({ yaml: yamlStr }) => {
    try {
      const model = parse(yamlStr) as OpmModel;
      const errors = validate(model);
      if (errors.length > 0) {
        return {
          content: [{ type: 'text' as const, text: `Validation errors:\n${errors.map(e => `  ${e.path}: ${e.message}`).join('\n')}` }],
          isError: true,
        };
      }

      const layout = await computeLayout(model);
      const svg = renderSvg(layout);
      const opl = generateOplSentences(model);

      return {
        content: [
          { type: 'text' as const, text: svg },
          { type: 'text' as const, text: `\n\nOPL Sentences:\n${opl.join('\n')}` },
        ],
      };
    } catch (err: unknown) {
      return {
        content: [{ type: 'text' as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }],
        isError: true,
      };
    }
  },
);

server.tool(
  'generate_opl',
  'Generate OPL (Object-Process Language) sentences from an OPM YAML model',
  { yaml: yamlInput.shape.yaml },
  async ({ yaml: yamlStr }) => {
    try {
      const model = parse(yamlStr) as OpmModel;
      const errors = validate(model);
      if (errors.length > 0) {
        return {
          content: [{ type: 'text' as const, text: `Validation errors:\n${errors.map(e => `  ${e.path}: ${e.message}`).join('\n')}` }],
          isError: true,
        };
      }

      const sentences = generateOplSentences(model);
      return {
        content: [{ type: 'text' as const, text: sentences.join('\n') }],
      };
    } catch (err: unknown) {
      return {
        content: [{ type: 'text' as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }],
        isError: true,
      };
    }
  },
);

server.tool(
  'validate_opm',
  'Validate an OPM YAML model and return any errors',
  { yaml: yamlInput.shape.yaml },
  async ({ yaml: yamlStr }) => {
    try {
      const model = parse(yamlStr) as OpmModel;
      const errors = validate(model);
      if (errors.length === 0) {
        return { content: [{ type: 'text' as const, text: 'Model is valid.' }] };
      }
      return {
        content: [{ type: 'text' as const, text: errors.map(e => `${e.path}: ${e.message}`).join('\n') }],
        isError: true,
      };
    } catch (err: unknown) {
      return {
        content: [{ type: 'text' as const, text: `Parse error: ${err instanceof Error ? err.message : String(err)}` }],
        isError: true,
      };
    }
  },
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
