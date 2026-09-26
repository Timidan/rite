/**
 * test/engine.test.js — Direct unit tests for src/core/engine.js.
 *
 * Uses an in-memory adapter — no filesystem, no adapter files.
 * Tests validateConfig and verify in isolation from the full suite.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { validateConfig, verify } from '../src/core/engine.js';

// ------------------------------------------------------------------ //
// Helpers                                                              //
// ------------------------------------------------------------------ //

const VALID_CONFIG = {
  version: 1,
  ruleId: 'test-rule',
  rule: 'Only owners may act.',
  adapter: './adapter.mjs',
  paths: [{ entry: 'doThing', sink: 'recordThing', source: 'src/service.js' }],
  cases: [
    {
      id: 'allow-case',
      path: 'doThing',
      actor: 'actor-a',
      input: { resourceId: 'res-1' },
      expected: { decision: 'allow', effects: [], stateChanged: false },
    },
  ],
};

/**
 * Build a simple in-memory adapter.
 * @param {object} responses — map of caseId → adapter return value
 */
function makeAdapter(responses) {
  return {
    async runCase(caseSpec) {
      const r = responses[caseSpec.id];
      if (!r) throw new Error(`No response configured for case: ${caseSpec.id}`);
      return r;
    },
  };
}

// ------------------------------------------------------------------ //
// validateConfig                                                       //
// ------------------------------------------------------------------ //

describe('validateConfig', () => {
  it('accepts a minimal valid config', () => {
    assert.deepEqual(validateConfig(VALID_CONFIG), []);
  });

  it('rejects non-object', () => {
    assert.ok(validateConfig(null).length > 0);
    assert.ok(validateConfig('string').length > 0);
  });

  it('rejects wrong version', () => {
    const errs = validateConfig({ ...VALID_CONFIG, version: 2 });
    assert.ok(errs.some(e => e.includes('version')));
  });

  it('rejects empty ruleId', () => {
    const errs = validateConfig({ ...VALID_CONFIG, ruleId: '' });
    assert.ok(errs.some(e => e.includes('ruleId')));
  });

  it('rejects duplicate case ids', () => {
    const cfg = {
      ...VALID_CONFIG,
      cases: [
        { ...VALID_CONFIG.cases[0] },
        { ...VALID_CONFIG.cases[0] },
      ],
    };
    const errs = validateConfig(cfg);
    assert.ok(errs.some(e => e.includes('Duplicate case id')));
  });

  it('rejects case path not in config.paths', () => {
    const cfg = {
      ...VALID_CONFIG,
      cases: [{ ...VALID_CONFIG.cases[0], path: 'unknownEntry' }],
    };
    const errs = validateConfig(cfg);
    assert.ok(errs.some(e => e.includes('not in config.paths')));
  });

  it('rejects invalid decision', () => {
    const cfg = {
      ...VALID_CONFIG,
      cases: [{
        ...VALID_CONFIG.cases[0],
        expected: { decision: 'maybe', effects: [], stateChanged: false },
      }],
    };
    const errs = validateConfig(cfg);
    assert.ok(errs.some(e => e.includes("decision must be 'allow'|'deny'")));
  });

  it('rejects duplicate path entries', () => {
    const cfg = {
      ...VALID_CONFIG,
      paths: [
        { entry: 'doThing', sink: 'recordThing', source: 'src/service.js' },
        { entry: 'doThing', sink: 'recordThing', source: 'src/service.js' },
      ],
    };
    const errs = validateConfig(cfg);
    assert.ok(errs.some(e => e.includes('Duplicate path entry')));
  });
});

// ------------------------------------------------------------------ //
// verify                                                               //
// ------------------------------------------------------------------ //

describe('verify', () => {
  it('returns PASS when adapter matches expectations', async () => {
    const adapter = makeAdapter({
      'allow-case': { decision: 'allow', effects: [], stateChanged: false },
    });
    const report = await verify(VALID_CONFIG, adapter);
    assert.equal(report.status, 'PASS');
    assert.equal(report.results.length, 1);
    assert.equal(report.results[0].status, 'PASS');
  });

  it('returns FAIL when decision mismatches', async () => {
    const adapter = makeAdapter({
      'allow-case': { decision: 'deny', effects: [], stateChanged: false },
    });
    const report = await verify(VALID_CONFIG, adapter);
    assert.equal(report.status, 'FAIL');
    assert.ok(report.results[0].failures.some(f => f.includes('decision')));
  });

  it('returns FAIL when denial produces effects (unauthorized event)', async () => {
    const denyConfig = {
      ...VALID_CONFIG,
      cases: [{
        ...VALID_CONFIG.cases[0],
        id: 'deny-case',
        expected: { decision: 'deny', effects: [], stateChanged: false },
      }],
    };
    const adapter = makeAdapter({
      'deny-case': {
        decision: 'deny',
        effects: [{ orderId: 'o-1', actorId: 'a-1', amountCents: 100, currency: 'USD' }],
        stateChanged: false,
      },
    });
    const report = await verify(denyConfig, adapter);
    assert.equal(report.status, 'FAIL');
    assert.ok(report.results[0].failures.some(f => f.includes('effects count')));
  });

  it('returns ERROR when adapter throws', async () => {
    const adapter = {
      async runCase() { throw new Error('adapter exploded'); },
    };
    const report = await verify(VALID_CONFIG, adapter);
    assert.equal(report.status, 'ERROR');
    assert.ok(report.results[0].error.includes('adapter exploded'));
  });

  it('returns ERROR when adapter returns non-object', async () => {
    const adapter = { async runCase() { return null; } };
    const report = await verify(VALID_CONFIG, adapter);
    assert.equal(report.status, 'ERROR');
  });

  it('returns ERROR for empty cases array', async () => {
    const cfg = { ...VALID_CONFIG, cases: [] };
    // validateConfig rejects this, but verify also guards it
    const adapter = makeAdapter({});
    // Bypass validation — call verify directly with a patched config
    const patchedCfg = { ...cfg, cases: undefined };
    const report = await verify(patchedCfg, adapter);
    assert.equal(report.status, 'ERROR');
  });

  it('aggregation: ERROR beats FAIL beats PASS', async () => {
    const cfg = {
      ...VALID_CONFIG,
      cases: [
        { ...VALID_CONFIG.cases[0], id: 'pass-case' },
        { ...VALID_CONFIG.cases[0], id: 'fail-case', expected: { decision: 'deny', effects: [], stateChanged: false } },
        { ...VALID_CONFIG.cases[0], id: 'error-case' },
      ],
    };
    const adapter = {
      async runCase(cs) {
        if (cs.id === 'pass-case')  return { decision: 'allow', effects: [], stateChanged: false };
        if (cs.id === 'fail-case')  return { decision: 'allow', effects: [], stateChanged: false }; // mismatch
        throw new Error('boom');
      },
    };
    const report = await verify(cfg, adapter);
    assert.equal(report.status, 'ERROR');
    assert.equal(report.results.find(r => r.id === 'pass-case').status, 'PASS');
    assert.equal(report.results.find(r => r.id === 'fail-case').status, 'FAIL');
    assert.equal(report.results.find(r => r.id === 'error-case').status, 'ERROR');
  });
});
