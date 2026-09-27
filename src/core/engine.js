/**
 * src/core/engine.js — Shared verification engine.
 *
 * verify(config, adapter, context) is the single function that owns
 * validation, case execution, effect comparison, and report construction.
 * CLI, MCP, and CI all call this function; none of them re-implement policy.
 *
 * No DOM globals. No React. No Vite-specific globals.
 * Filesystem reads (adapter import, config load) are handled by callers;
 * this module receives already-parsed config and a resolved adapter path.
 */

import { compareEffects } from '../instrument/effect-schema.js';

export const SCHEMA_VERSION = 1;
export const ENGINE_VERSION = '0.1.1';

// ------------------------------------------------------------------ //
// Config validation                                                    //
// ------------------------------------------------------------------ //

const VALID_DECISIONS = new Set(['allow', 'deny']);

/**
 * @typedef {{
 *   version: number,
 *   ruleId: string,
 *   rule: string,
 *   adapter: string,
 *   paths: Array<{ entry: string, sink: string, source: string }>,
 *   cases: Array<{
 *     id: string,
 *     path: string,
 *     actor: string,
 *     input: object,
 *     expected: {
 *       decision: 'allow' | 'deny',
 *       effects: object[],
 *       stateChanged: boolean,
 *     }
 *   }>
 * }} RiteConfig
 */

/**
 * Validate a parsed config object.
 * Returns an array of error strings (empty = valid).
 * @param {unknown} config
 * @returns {string[]}
 */
export function validateConfig(config) {
  const errs = [];
  if (!config || typeof config !== 'object') {
    errs.push('config must be an object');
    return errs;
  }
  const c = /** @type {Record<string,unknown>} */ (config);

  if (c.version !== 1) errs.push(`config.version must be 1 (got ${c.version})`);
  if (typeof c.ruleId !== 'string' || !c.ruleId.trim())
    errs.push('config.ruleId must be a non-empty string');
  if (typeof c.rule !== 'string' || !c.rule.trim())
    errs.push('config.rule must be a non-empty string');
  if (typeof c.adapter !== 'string' || !c.adapter.trim())
    errs.push('config.adapter must be a non-empty string');

  // Paths
  if (!Array.isArray(c.paths) || c.paths.length === 0)
    errs.push('config.paths must be a non-empty array');
  else {
    const pathNames = new Set();
    for (let i = 0; i < c.paths.length; i++) {
      const p = /** @type {Record<string,unknown>} */ (c.paths[i]);
      if (typeof p.entry !== 'string' || !p.entry.trim())
        errs.push(`config.paths[${i}].entry must be a non-empty string`);
      else {
        if (pathNames.has(p.entry)) errs.push(`Duplicate path entry: ${p.entry}`);
        pathNames.add(p.entry);
      }
      if (typeof p.sink !== 'string' || !p.sink.trim())
        errs.push(`config.paths[${i}].sink must be a non-empty string`);
      if (typeof p.source !== 'string' || !p.source.trim())
        errs.push(`config.paths[${i}].source must be a non-empty string`);
    }
  }

  // Cases
  if (!Array.isArray(c.cases) || c.cases.length === 0)
    errs.push('config.cases must be a non-empty array');
  else {
    const caseIds = new Set();
    const configPaths = Array.isArray(c.paths)
      ? new Set(c.paths.map(p => /** @type {Record<string,unknown>} */ (p).entry))
      : new Set();

    for (let i = 0; i < c.cases.length; i++) {
      const cs = /** @type {Record<string,unknown>} */ (c.cases[i]);
      if (typeof cs.id !== 'string' || !cs.id.trim())
        errs.push(`config.cases[${i}].id must be a non-empty string`);
      else {
        if (caseIds.has(cs.id)) errs.push(`Duplicate case id: ${cs.id}`);
        caseIds.add(cs.id);
      }
      if (typeof cs.path !== 'string' || !cs.path.trim())
        errs.push(`config.cases[${i}].path must be a non-empty string`);
      else if (!configPaths.has(cs.path))
        errs.push(`config.cases[${i}].path "${cs.path}" not in config.paths`);
      if (typeof cs.actor !== 'string' || !cs.actor.trim())
        errs.push(`config.cases[${i}].actor must be a non-empty string`);
      if (!cs.input || typeof cs.input !== 'object')
        errs.push(`config.cases[${i}].input must be an object`);

      const exp = /** @type {Record<string,unknown>} */ (cs.expected);
      if (!exp || typeof exp !== 'object')
        errs.push(`config.cases[${i}].expected must be an object`);
      else {
        if (!VALID_DECISIONS.has(/** @type {string} */ (exp.decision)))
          errs.push(`config.cases[${i}].expected.decision must be 'allow'|'deny'`);
        if (!Array.isArray(exp.effects))
          errs.push(`config.cases[${i}].expected.effects must be an array`);
        if (typeof exp.stateChanged !== 'boolean')
          errs.push(`config.cases[${i}].expected.stateChanged must be a boolean`);
      }
    }
  }

  return errs;
}

// ------------------------------------------------------------------ //
// Case execution                                                       //
// ------------------------------------------------------------------ //

/**
 * @typedef {{
 *   id: string,
 *   path: string,
 *   status: 'PASS'|'FAIL'|'ERROR',
 *   expected: object,
 *   observed: object,
 *   failures: string[],
 *   error: string | null,
 * }} CaseResult
 */

/**
 * Run one case through the adapter.
 * The adapter is responsible for all isolation and fixture setup.
 * @param {object} caseSpec
 * @param {object} adapter  — { runCase }
 * @returns {Promise<CaseResult>}
 */
async function runOneCase(caseSpec, adapter) {
  const result = {
    id: caseSpec.id,
    path: caseSpec.path,
    status: /** @type {'PASS'|'FAIL'|'ERROR'} */ ('PASS'),
    expected: caseSpec.expected,
    observed: null,
    failures: [],
    error: null,
  };

  let observed;
  try {
    observed = await adapter.runCase(caseSpec);
  } catch (err) {
    result.status = 'ERROR';
    result.error = err instanceof Error ? `${err.message}\n${err.stack}` : String(err);
    return result;
  }

  if (!observed || typeof observed !== 'object') {
    result.status = 'ERROR';
    result.error = `Adapter returned non-object: ${JSON.stringify(observed)}`;
    return result;
  }

  result.observed = observed;

  const exp = caseSpec.expected;
  const failures = [];

  // 1. Decision
  const observedDecision = observed.decision;
  if (observedDecision !== exp.decision)
    failures.push(`decision: expected "${exp.decision}"; observed "${observedDecision}"`);

  // 2–4. Effects: count + structural match + schema (unified via compareEffects)
  const observedEffects = Array.isArray(observed.effects) ? observed.effects : [];
  failures.push(...compareEffects(observedEffects, exp.effects, caseSpec.effectSchema));

  // 5. State change
  const observedStateChanged = observed.stateChanged;
  if (observedStateChanged !== exp.stateChanged)
    failures.push(`stateChanged: expected ${exp.stateChanged}; observed ${observedStateChanged}`);

  result.failures = failures;
  result.status = failures.length > 0 ? 'FAIL' : 'PASS';
  return result;
}

// ------------------------------------------------------------------ //
// Main verify function                                                 //
// ------------------------------------------------------------------ //

/**
 * @typedef {{
 *   schemaVersion: number,
 *   engineVersion: string,
 *   ruleId: string,
 *   rule: string,
 *   configuredPaths: Array<{ entry: string, sink: string, source: string }>,
 *   generatedAt: string,
 *   status: 'PASS'|'FAIL'|'ERROR',
 *   results: CaseResult[],
 *   error: string | null,
 * }} VerifyReport
 */

/**
 * Run the full verification against a loaded adapter.
 * Returns a VerifyReport regardless of pass/fail.
 *
 * @param {RiteConfig} config
 * @param {{ runCase: (caseSpec: object) => Promise<object> }} adapter
 * @param {{ configPath?: string }} [context]
 * @returns {Promise<VerifyReport>}
 */
export async function verify(config, adapter, context = {}) {
  const report = {
    schemaVersion: SCHEMA_VERSION,
    engineVersion: ENGINE_VERSION,
    ruleId: config.ruleId,
    rule: config.rule,
    configuredPaths: config.paths,
    generatedAt: new Date().toISOString(),
    status: /** @type {'PASS'|'FAIL'|'ERROR'} */ ('PASS'),
    results: [],
    error: null,
  };

  if (!config.cases?.length) {
    report.status = 'ERROR';
    report.error = 'No cases configured.';
    return report;
  }

  for (const caseSpec of config.cases) {
    const result = await runOneCase(caseSpec, adapter);
    report.results.push(result);
  }

  // Aggregate: ERROR > FAIL > PASS
  let status = 'PASS';
  for (const r of report.results) {
    if (r.status === 'ERROR') { status = 'ERROR'; break; }
    if (r.status === 'FAIL') status = 'FAIL';
  }
  report.status = /** @type {'PASS'|'FAIL'|'ERROR'} */ (status);

  return report;
}
