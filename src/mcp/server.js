/**
 * src/mcp/server.js — Local MCP stdio server for Rite.
 *
 * Tools:
 *   rite_analyze  — Read configured rule and path scope from a config file
 *   rite_verify   — Run verification using the same core engine as the CLI
 *   rite_report   — Read and render a saved report file
 *
 * Stdout carries MCP protocol messages only. Logs go to stderr.
 * Workspace and file path arguments are validated; no generic shell execution.
 *
 * Start: node src/cli/rite.js mcp  (or rite mcp)
 * Test:  npx @modelcontextprotocol/inspector node src/cli/rite.js mcp
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { validateConfig, verify, ENGINE_VERSION } from '../core/engine.js';
import { loadAdapterFromConfig } from '../core/loader.js';

// ------------------------------------------------------------------ //
// Helpers shared with CLI                                              //
// ------------------------------------------------------------------ //

function safeJson(filePath) {
  try {
    return { ok: true, data: JSON.parse(readFileSync(filePath, 'utf-8')) };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

function renderReportText(report) {
  const lines = [];
  lines.push(`Rite v${ENGINE_VERSION} — ${report.ruleId}`);
  lines.push(`Rule: ${report.rule}`);
  lines.push(`Status: ${report.status}  Generated: ${report.generatedAt}`);
  lines.push('');
  for (const r of report.results) {
    const icon = r.status === 'PASS' ? '✓' : r.status === 'FAIL' ? '✗' : '!';
    lines.push(`${icon} ${r.status.padEnd(5)} [${r.path}] ${r.id}`);
    if (r.failures?.length) {
      for (const f of r.failures) lines.push(`    ${f}`);
    }
    if (r.error) lines.push(`    ERROR: ${r.error.split('\n')[0]}`);
  }
  const total  = report.results.length;
  const passed = report.results.filter(r => r.status === 'PASS').length;
  lines.push('');
  lines.push(`${report.status}: ${passed}/${total} passed`);
  return lines.join('\n');
}

// ------------------------------------------------------------------ //
// Server                                                               //
// ------------------------------------------------------------------ //

export async function startMcpServer() {
  const server = new McpServer({
    name: 'rite',
    version: ENGINE_VERSION,
  });

  // ---- rite_analyze ------------------------------------------------ //
  server.tool(
    'rite_analyze',
    'Read a Rite config file and return its rule, configured entry paths, and case summary.',
    {
      config: z.string().describe('Absolute or relative path to rite.config.json'),
    },
    async ({ config: configArg }) => {
      const configPath = resolve(configArg);
      if (!existsSync(configPath)) {
        return { content: [{ type: 'text', text: `Config not found: ${configPath}` }], isError: true };
      }
      const parsed = safeJson(configPath);
      if (!parsed.ok) {
        return { content: [{ type: 'text', text: `Failed to parse config: ${parsed.error}` }], isError: true };
      }
      const errs = validateConfig(parsed.data);
      if (errs.length) {
        return { content: [{ type: 'text', text: `Config invalid:\n${errs.join('\n')}` }], isError: true };
      }
      const cfg = parsed.data;
      const summary = [
        `ruleId: ${cfg.ruleId}`,
        `rule: ${cfg.rule}`,
        '',
        'Configured paths:',
        ...cfg.paths.map(p => `  ${p.entry} → ${p.sink}  (${p.source})`),
        '',
        `Cases (${cfg.cases.length}):`,
        ...cfg.cases.map(c => `  ${c.id}  [${c.path}]  actor=${c.actor}  expected=${c.expected.decision}`),
      ].join('\n');
      return { content: [{ type: 'text', text: summary }] };
    }
  );

  // ---- rite_verify ------------------------------------------------- //
  server.tool(
    'rite_verify',
    'Run Rite verification using the same core engine as the CLI. Returns the full report as JSON.',
    {
      config: z.string().describe('Absolute or relative path to rite.config.json'),
      out: z.string().optional().describe('Optional path to write the JSON report'),
    },
    async ({ config: configArg, out: outArg }) => {
      const configPath = resolve(configArg);
      if (!existsSync(configPath)) {
        return { content: [{ type: 'text', text: `Config not found: ${configPath}` }], isError: true };
      }
      const parsed = safeJson(configPath);
      if (!parsed.ok) {
        return { content: [{ type: 'text', text: `Failed to parse config: ${parsed.error}` }], isError: true };
      }
      const errs = validateConfig(parsed.data);
      if (errs.length) {
        return { content: [{ type: 'text', text: `Config invalid:\n${errs.join('\n')}` }], isError: true };
      }

      const cfg = parsed.data;
      const loaded = await loadAdapterFromConfig(cfg, configPath);
      if (!loaded.ok) {
        return { content: [{ type: 'text', text: loaded.error }], isError: true };
      }
      const { adapter } = loaded;

      let report;
      try {
        report = await verify(cfg, adapter, { configPath });
      } catch (e) {
        return { content: [{ type: 'text', text: `Engine error: ${e.message}` }], isError: true };
      }

      if (outArg) {
        try {
          writeFileSync(resolve(outArg), JSON.stringify(report, null, 2), 'utf-8');
        } catch (e) {
          process.stderr.write(`rite-mcp: could not write report: ${e.message}\n`);
        }
      }

      const text = renderReportText(report);
      const json = JSON.stringify(report, null, 2);
      return {
        content: [
          { type: 'text', text },
          { type: 'text', text: '\n--- JSON ---\n' + json },
        ],
      };
    }
  );

  // ---- rite_report ------------------------------------------------- //
  server.tool(
    'rite_report',
    'Read and render a saved Rite report JSON file.',
    {
      file: z.string().describe('Absolute or relative path to a Rite report JSON file'),
    },
    async ({ file }) => {
      const filePath = resolve(file);
      if (!existsSync(filePath)) {
        return { content: [{ type: 'text', text: `Report not found: ${filePath}` }], isError: true };
      }
      const parsed = safeJson(filePath);
      if (!parsed.ok) {
        return { content: [{ type: 'text', text: `Failed to parse report: ${parsed.error}` }], isError: true };
      }
      const report = parsed.data;
      if (!report.results || !report.status) {
        return { content: [{ type: 'text', text: 'File does not look like a Rite report.' }], isError: true };
      }
      return { content: [{ type: 'text', text: renderReportText(report) }] };
    }
  );

  // Start transport
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write(`rite-mcp: server started (Rite v${ENGINE_VERSION})\n`);
}
