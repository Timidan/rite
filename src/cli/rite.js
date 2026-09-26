#!/usr/bin/env node
/**
 * src/cli/rite.js — Rite CLI.
 *
 * Commands:
 *   rite init [--dir <path>]           Create starter config and adapter
 *   rite verify --config <file>        Run verification, write report JSON
 *             [--out <file>] [--sarif <file>]
 *   rite report <file>                 Render an existing report to stdout
 *   rite graph --file <file>           Walk entry→sink paths in a JS file
 *             --entries a,b --sink fn
 *   rite instrument --module <file>    Generate a rite.adapter.mjs
 *             --entries a,b --sink fn [--factory fn] [--snapshot fn] [--out <file>]
 *   rite draft --rule <file>           Ask watsonx.ai for candidate config
 *             [--snippet <file>]
 *   rite server [--port 3001]          Start GitHub App Express server
 *   rite mcp                           Start local MCP stdio server
 *
 * Exit codes:
 *   0  PASS
 *   1  FAIL
 *   2  ERROR (config/adapter/runtime problem)
 *   3  Usage error
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';
import { validateConfig, verify, ENGINE_VERSION } from '../core/engine.js';
import { toSarif } from '../core/sarif.js';
import { loadAdapterFromConfig } from '../core/loader.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ------------------------------------------------------------------ //
// Arg parser with declarative flag spec                                //
// ------------------------------------------------------------------ //

/**
 * Parse argv and validate against a flag spec for the given command.
 *
 * @param {string[]} argv
 * @param {Record<string, { required?: string[], optional?: string[], numbers?: string[], positional?: number }>} specs
 *   — map of command → spec; positional = expected positional arg count
 * @returns {{ cmd: string, flags: Record<string,string|true|number>, positional: string[], errors: string[] }}
 */
function parseArgs(argv, specs = {}) {
  const args = argv.slice(2);
  const cmd = args[0] ?? '';
  const rawFlags = {};
  const positional = [];

  for (let i = 1; i < args.length; i++) {
    if (args[i].startsWith('--')) {
      const key = args[i].slice(2);
      const next = args[i + 1];
      rawFlags[key] = (next && !next.startsWith('--')) ? (i++, next) : true;
    } else {
      positional.push(args[i]);
    }
  }

  const spec = specs[cmd] ?? {};
  const errors = [];
  const flags = { ...rawFlags };

  // Coerce number flags
  for (const name of (spec.numbers ?? [])) {
    if (flags[name] !== undefined && flags[name] !== true) {
      const n = Number(flags[name]);
      if (Number.isNaN(n)) errors.push(`--${name} must be a number (got "${flags[name]}")`);
      else flags[name] = n;
    }
  }

  // Check required flags
  for (const name of (spec.required ?? [])) {
    if (!flags[name]) errors.push(`--${name} is required`);
  }

  return { cmd, flags, positional, errors };
}

/** Exit with a usage error if parsed.errors is non-empty. */
function checkArgs(parsed) {
  if (parsed.errors.length) {
    for (const e of parsed.errors) stderr(`  ${e}`);
    process.exit(3);
  }
}

// ------------------------------------------------------------------ //
// Output helpers                                                       //
// ------------------------------------------------------------------ //

function stderr(msg) { process.stderr.write(msg + '\n'); }
function stdout(msg) { process.stdout.write(msg + '\n'); }

function renderReport(report) {
  const width = 68;
  const bar   = '─'.repeat(width);

  stdout('');
  stdout(`  Rite v${ENGINE_VERSION}  ·  ${report.ruleId}`);
  stdout(`  ${bar}`);
  stdout(`  Rule: ${report.rule}`);
  stdout(`  Generated: ${report.generatedAt}`);
  stdout(`  ${bar}`);

  for (const r of report.results) {
    const icon = r.status === 'PASS' ? '✓' : r.status === 'FAIL' ? '✗' : '!';
    stdout(`  ${icon}  ${r.status.padEnd(5)}  [${r.path}]  ${r.id}`);
    if (r.failures?.length) {
      for (const f of r.failures) stdout(`           ${f}`);
    }
    if (r.error) stdout(`           ERROR: ${r.error.split('\n')[0]}`);
  }

  stdout(`  ${bar}`);
  const total  = report.results.length;
  const passed = report.results.filter(r => r.status === 'PASS').length;
  const failed = report.results.filter(r => r.status === 'FAIL').length;
  const errors = report.results.filter(r => r.status === 'ERROR').length;
  stdout(`  ${report.status.padEnd(5)}  ${passed}/${total} passed` +
    (failed ? `  ${failed} failed` : '') +
    (errors ? `  ${errors} errors` : ''));
  stdout('');
}

// ------------------------------------------------------------------ //
// init                                                                 //
// ------------------------------------------------------------------ //

const STARTER_CONFIG = JSON.stringify({
  version: 1,
  ruleId: 'my-rule',
  rule: 'Describe the authorization rule here.',
  adapter: './rite.adapter.mjs',
  paths: [
    { entry: 'myEntry', sink: 'mySink', source: 'src/service.js' },
  ],
  cases: [
    {
      id: 'allow-example',
      path: 'myEntry',
      actor: 'actor-id',
      input: { resourceId: 'resource-1' },
      expected: { decision: 'allow', effects: [], stateChanged: false },
    },
    {
      id: 'deny-example',
      path: 'myEntry',
      actor: 'other-actor',
      input: { resourceId: 'resource-1' },
      expected: { decision: 'deny', effects: [], stateChanged: false },
    },
  ],
}, null, 2);

const STARTER_ADAPTER = `/**
 * rite.adapter.mjs — starter adapter.
 * Implement runCase to call your service and observe effects.
 */

export async function runCase(caseSpec) {
  const { path: entryName, actor, input } = caseSpec;

  // TODO: import your service and create a fresh fixture here.
  // const svc = createMyService({ fixtures: ... });

  // Call the entry function:
  // const result = svc[entryName](input, { actorId: actor });

  // Observe sink events and state:
  // const effects = svc.capturedEffects();
  // const stateChanged = ...;

  throw new Error('Adapter not implemented yet — edit rite.adapter.mjs');

  return {
    decision: 'deny',   // 'allow' | 'deny'
    effects: [],        // array of observed sink events
    stateBefore: null,  // snapshot before call
    stateAfter: null,   // snapshot after call
    stateChanged: false,
  };
}
`;

async function cmdInit({ flags }) {
  const targetDir = resolve(flags.dir ?? '.');
  const configPath = join(targetDir, 'rite.config.json');
  const adapterPath = join(targetDir, 'rite.adapter.mjs');
  const workflowPath = join(targetDir, '.github', 'workflows', 'rite.yml');
  const workflowTemplate = join(__dirname, '..', '..', 'templates', 'rite.yml');

  if (existsSync(configPath) || existsSync(adapterPath) || existsSync(workflowPath)) {
    const rl = createInterface({ input: process.stdin, output: process.stderr });
    const answer = await new Promise(res =>
      rl.question('Rite config, adapter, or workflow already exists. Overwrite? [y/N] ', res)
    );
    rl.close();
    if (!answer.toLowerCase().startsWith('y')) {
      stderr('Aborted.'); process.exit(3);
    }
  }

  mkdirSync(targetDir, { recursive: true });
  mkdirSync(dirname(workflowPath), { recursive: true });
  writeFileSync(configPath, STARTER_CONFIG, 'utf-8');
  writeFileSync(adapterPath, STARTER_ADAPTER, 'utf-8');
  writeFileSync(workflowPath, readFileSync(workflowTemplate, 'utf-8'), 'utf-8');
  stderr(`Created ${configPath}`);
  stderr(`Created ${adapterPath}`);
  stderr(`Created ${workflowPath}`);
  stderr('Edit rite.config.json and rite.adapter.mjs, then run: rite verify --config rite.config.json');
}

// ------------------------------------------------------------------ //
// verify                                                               //
// ------------------------------------------------------------------ //

async function cmdVerify({ flags }) {
  const configArg = flags.config;
  const configPath = resolve(configArg);
  if (!existsSync(configPath)) {
    stderr(`Config not found: ${configPath}`);
    process.exit(2);
  }

  // Parse config
  let config;
  try {
    config = JSON.parse(readFileSync(configPath, 'utf-8'));
  } catch (e) {
    stderr(`Failed to parse config: ${e.message}`);
    process.exit(2);
  }

  // Validate
  const errs = validateConfig(config);
  if (errs.length) {
    stderr('Config validation errors:');
    for (const e of errs) stderr(`  ${e}`);
    process.exit(2);
  }

  // Load adapter via shared loader (bounds-checked, no path traversal)
  const loaded = await loadAdapterFromConfig(config, configPath);
  if (!loaded.ok) { stderr(loaded.error); process.exit(2); }
  const { adapter } = loaded;

  // Run
  let report;
  try {
    report = await verify(config, adapter, { configPath });
  } catch (e) {
    stderr(`Unexpected engine error: ${e.message}`);
    process.exit(2);
  }

  // GitHub Actions provides the triggering commit. Embed it so the server can
  // reject artifacts copied from a different workflow run.
  if (/^[0-9a-f]{40}$/i.test(process.env.GITHUB_SHA ?? '')) {
    report.commitSha = process.env.GITHUB_SHA;
  }

  // Write JSON report
  const outArg = flags.out;
  if (outArg) {
    const outPath = resolve(outArg);
    writeFileSync(outPath, JSON.stringify(report, null, 2), 'utf-8');
    stderr(`Report written to: ${outPath}`);
  }

  // Write SARIF report
  const sarifArg = flags.sarif;
  if (sarifArg) {
    const sarifPath = resolve(sarifArg);
    const sarif = toSarif(report);
    writeFileSync(sarifPath, JSON.stringify(sarif, null, 2), 'utf-8');
    stderr(`SARIF written to: ${sarifPath}`);
  }

  renderReport(report);

  // Exit code by status
  if (report.status === 'PASS') process.exit(0);
  if (report.status === 'FAIL') process.exit(1);
  process.exit(2);
}

// ------------------------------------------------------------------ //
// report                                                               //
// ------------------------------------------------------------------ //

async function cmdReport({ positional }) {
  const filePath = positional[0];
  if (!filePath) {
    stderr('Usage: rite report <file>');
    process.exit(3);
  }
  const resolved = resolve(filePath);
  if (!existsSync(resolved)) {
    stderr(`Report not found: ${resolved}`);
    process.exit(2);
  }
  let report;
  try {
    report = JSON.parse(readFileSync(resolved, 'utf-8'));
  } catch (e) {
    stderr(`Failed to parse report: ${e.message}`);
    process.exit(2);
  }
  if (!report.results || !report.status) {
    stderr('File does not look like a Rite report (missing results or status).');
    process.exit(2);
  }
  renderReport(report);
  process.exit(0);
}

// ------------------------------------------------------------------ //
// graph                                                                //
// ------------------------------------------------------------------ //

async function cmdGraph({ flags }) {
  const fileArg    = flags.file;
  const entriesArg = flags.entries;
  const sinkArg    = flags.sink;
  const filePath   = resolve(fileArg);
  if (!existsSync(filePath)) { stderr(`File not found: ${filePath}`); process.exit(2); }

  const { walkFile, formatWalkResult } = await import('../graph/walker.js');
  const entries = entriesArg.split(',').map(s => s.trim()).filter(Boolean);
  const result = walkFile({ file: filePath, entries, sink: sinkArg });

  stdout(formatWalkResult(result));
  stdout('');
  for (const t of result.traces) {
    const status = t.found ? 'REACHES SINK' : 'NO PATH FOUND';
    stderr(`  ${t.entry} → ${sinkArg}: ${status}`);
  }
}

// ------------------------------------------------------------------ //
// instrument                                                           //
// ------------------------------------------------------------------ //

async function cmdInstrument({ flags }) {
  const moduleArg   = flags.module;
  const entriesArg  = flags.entries;
  const sinkArg     = flags.sink;
  const factoryArg  = flags.factory;
  const snapshotArg = flags.snapshot;
  const outArg      = flags.out ?? 'rite.adapter.mjs';
  const modulePath  = resolve(moduleArg);
  if (!existsSync(modulePath)) { stderr(`Module not found: ${modulePath}`); process.exit(2); }

  const { writeAdapterFile } = await import('../instrument/auto-adapter.js');
  const entries = entriesArg.split(',').map(s => s.trim()).filter(Boolean);
  const outPath = resolve(outArg);

  // Relative path from the output file back to the module
  const { relative: rel, dirname: dn } = await import('node:path');
  const relModPath = './' + rel(dn(outPath), modulePath).replace(/\\/g, '/');

  writeAdapterFile({
    modulePath, outPath, relativeModulePath: relModPath,
    entries, sink: sinkArg,
    factoryFn: factoryArg, snapshotFn: snapshotArg,
  });

  stderr(`Generated adapter: ${outPath}`);
  stderr('Edit the SEEDS map and seed loader, then run: rite verify --config rite.config.json');
}

// ------------------------------------------------------------------ //
// draft                                                                //
// ------------------------------------------------------------------ //

async function cmdDraft({ flags }) {
  const ruleArg    = flags.rule;
  const snippetArg = flags.snippet;
  const rulePath   = resolve(ruleArg);
  if (!existsSync(rulePath)) { stderr(`Rule file not found: ${rulePath}`); process.exit(2); }
  const rule = readFileSync(rulePath, 'utf-8').trim();

  let snippet = '';
  if (snippetArg) {
    const snippetPath = resolve(snippetArg);
    if (!existsSync(snippetPath)) { stderr(`Snippet file not found: ${snippetPath}`); process.exit(2); }
    snippet = readFileSync(snippetPath, 'utf-8');
    stderr(`Sending ${snippet.length} chars of snippet to watsonx.ai (review before continuing).`);
    // Give developer a chance to cancel
    const rl = createInterface({ input: process.stdin, output: process.stderr });
    const answer = await new Promise(res =>
      rl.question('Confirm sending this snippet to IBM watsonx.ai? [y/N] ', res)
    );
    rl.close();
    if (!answer.toLowerCase().startsWith('y')) { stderr('Aborted.'); process.exit(3); }
  }

  const { draftCases } = await import('../watsonx/draft.js');
  stderr('Calling watsonx.ai…');
  const result = await draftCases({ rule, snippet });

  if (!result.available) {
    stderr(`watsonx.ai not available: ${result.reason}`);
    stderr('Set IBMCLOUD_API_KEY and WATSONX_PROJECT_ID to enable AI drafting.');
    stderr('Verification works fully without this step.');
    process.exit(2);
  }

  stdout('');
  stdout('=== watsonx.ai draft (hypothesis — review before use) ===');
  stdout(`Model: ${result.modelId}`);
  stdout('');
  stdout('Suggested paths:');
  for (const p of result.paths)
    stdout(`  ${p.entry} → ${p.sink}  (${p.source})${p.hypothesis ? '  [hypothesis]' : ''}`);
  stdout('');
  stdout('Suggested cases:');
  for (const c of result.cases)
    stdout(`  ${c.id}  [${c.path}]  ${c.expected?.decision}  — ${c.reason}`);
  stdout('');
  stdout('Full JSON diff (copy into rite.config.json after review):');
  stdout(JSON.stringify({ paths: result.paths, cases: result.cases }, null, 2));
  stdout('');
  stderr('Label: hypothesis. Review all citations. Do not merge into config without approval.');
}

// ------------------------------------------------------------------ //
// server                                                               //
// ------------------------------------------------------------------ //

async function cmdServer({ flags }) {
  const port = Number(flags.port ?? process.env.PORT ?? 3001);
  try {
    const { startGitHubServer } = await import('../github/server.js');
    await startGitHubServer({ port });
    // Keep process alive
    await new Promise(() => {});
  } catch (e) {
    stderr(`rite server: ${e.message}`);
    process.exit(2);
  }
}

// ------------------------------------------------------------------ //
// mcp                                                                  //
// ------------------------------------------------------------------ //

async function cmdMcp() {
  const { startMcpServer } = await import('../mcp/server.js');
  await startMcpServer();
}

// ------------------------------------------------------------------ //
// Entry                                                                //
// ------------------------------------------------------------------ //

const USAGE = `
Rite v${ENGINE_VERSION} — Authorization checks for the paths tests miss.

Usage:
  rite init [--dir <path>]
  rite verify --config <file> [--out <file>] [--sarif <file>]
  rite report <file>
  rite graph --file <js-file> --entries fn1,fn2 --sink sinkFn
  rite instrument --module <file> --entries fn1,fn2 --sink sinkFn [--factory fn] [--snapshot fn] [--out adapter.mjs]
  rite draft --rule <file> [--snippet <file>]
  rite server [--port 3001]
  rite mcp

Commands:
  init        Create a starter rite.config.json and rite.adapter.mjs
  verify      Run verification (exit 0=PASS, 1=FAIL, 2=ERROR); optionally write --sarif
  report      Render an existing JSON report file
  graph       Walk a JS file and trace entry→sink call paths (static, single-file)
  instrument  Generate a rite.adapter.mjs for a JS module
  draft       Ask watsonx.ai for candidate paths and cases (requires IBM Cloud creds)
  server      Start GitHub App Express server (requires env vars — see src/github/app.js)
  mcp         Start a local MCP stdio server
`.trim();

const FLAG_SPECS = {
  verify:     { required: ['config'], optional: ['out', 'sarif'] },
  graph:      { required: ['file', 'entries', 'sink'] },
  instrument: { required: ['module', 'entries', 'sink'], optional: ['factory', 'snapshot', 'out'] },
  draft:      { required: ['rule'], optional: ['snippet'] },
  server:     { numbers: ['port'], optional: ['port'] },
};

const parsed = parseArgs(process.argv, FLAG_SPECS);

switch (parsed.cmd) {
  case 'init':       await cmdInit(parsed);       break;
  case 'verify':     checkArgs(parsed); await cmdVerify(parsed);     break;
  case 'report':     await cmdReport(parsed);     break;
  case 'graph':      checkArgs(parsed); await cmdGraph(parsed);      break;
  case 'instrument': checkArgs(parsed); await cmdInstrument(parsed); break;
  case 'draft':      checkArgs(parsed); await cmdDraft(parsed);      break;
  case 'server':     checkArgs(parsed); await cmdServer(parsed);     break;
  case 'mcp':        await cmdMcp();              break;
  default:
    stderr(USAGE);
    process.exit(parsed.cmd ? 3 : 0);
}
