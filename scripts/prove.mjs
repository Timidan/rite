#!/usr/bin/env node
/**
 * scripts/prove.mjs — Four-phase authorization proof.
 *
 * Phases:
 *   baseline  — original support-only ownership omission → wrong-owner:support FAIL
 *   fixed     — shared authorization enforced → all PASS
 *   mutation  — ownership guard removed from shared helper → wrong-owner:* FAIL
 *   restored  — exact fixed bytes restored → all PASS
 *
 * Uses only Node built-in modules. Never modifies workspace source files.
 * Creates a temp directory, runs tests there, cleans up in finally.
 * Writes evidence/proof.json and copies to public/evidence/proof.json.
 */

import { createHash } from 'node:crypto';
import {
  mkdtempSync, readFileSync, writeFileSync, copyFileSync,
  mkdirSync, rmSync, existsSync,
} from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir, platform } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

// ------------------------------------------------------------------ //
// Paths                                                                //
// ------------------------------------------------------------------ //
const DOMAIN_SRC     = join(ROOT, 'src', 'refunds.js');
const CASES_SRC      = join(ROOT, 'src', 'cases.js');
const CHECKS_SRC     = join(ROOT, 'src', 'checks.js');
const EFFECTS_SRC    = join(ROOT, 'src', 'instrument', 'effect-schema.js');
const TEST_SRC       = join(ROOT, 'test', 'refunds.test.js');
const POLICY_SRC     = join(ROOT, 'docs', 'policy.md');
const BASELINE_SRC   = join(ROOT, 'evidence', 'baseline', 'refunds.js');
const PKG_SRC        = join(ROOT, 'package.json');
const EVIDENCE_DIR   = join(ROOT, 'evidence');
const PUBLIC_EV_DIR  = join(ROOT, 'public', 'evidence');
const PROOF_OUT      = join(EVIDENCE_DIR, 'proof.json');
const PROOF_PUBLIC   = join(PUBLIC_EV_DIR, 'proof.json');

// ------------------------------------------------------------------ //
// Helpers                                                              //
// ------------------------------------------------------------------ //

function sha256(filePath) {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex');
}

/**
 * Run `node --test` in a temp directory, capture stdout/stderr, exit code.
 * @param {string} tmpDir
 * @param {string} reportPath
 * @returns {{ stdout: string, stderr: string, exitCode: number|null, signal: string|null }}
 */
function runTests(tmpDir, reportPath) {
  const testFile = join(tmpDir, 'test', 'refunds.test.js');
  const env = {
    ...process.env,
    RITE_REPORT_PATH: reportPath,
  };
  const result = spawnSync(
    process.execPath,
    ['--test', testFile],
    { cwd: tmpDir, env, encoding: 'utf-8', maxBuffer: 4 * 1024 * 1024 }
  );
  return {
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    exitCode: result.status,
    signal: result.signal || null,
  };
}

/**
 * Read the structured runner report written by the test adapter.
 * Returns null if the file is absent or unparseable.
 * @param {string} reportPath
 * @returns {object|null}
 */
function readReport(reportPath) {
  if (!existsSync(reportPath)) return null;
  try {
    return JSON.parse(readFileSync(reportPath, 'utf-8'));
  } catch {
    return null;
  }
}

// ------------------------------------------------------------------ //
// Expectation helpers                                                  //
// ------------------------------------------------------------------ //

const EXPECTED_IDS = [
  'valid-owner:customer', 'valid-owner:support',
  'wrong-owner:customer', 'wrong-owner:support',
  'unpaid-order:customer', 'unpaid-order:support',
  'already-refunded:customer', 'already-refunded:support',
  'repeat-request:customer', 'repeat-request:support',
];

/**
 * Verify that the structured report contains exactly the expected result IDs,
 * no ERRORs, successful boundary checks, and a valid status.
 * @param {object|null} report
 * @param {string} phaseId
 * @returns {{ ok: boolean, message: string }}
 */
function verifyReportShape(report, phaseId) {
  if (!report || !report.suiteReport) return { ok: false, message: `${phaseId}: no suiteReport` };
  const sr = report.suiteReport;
  if (!Array.isArray(sr.results) || sr.results.length !== 10)
    return { ok: false, message: `${phaseId}: expected 10 results; got ${sr.results?.length}` };
  for (const id of EXPECTED_IDS) {
    const matches = sr.results.filter(r => r.id === id);
    if (matches.length !== 1)
      return { ok: false, message: `${phaseId}: expected exactly 1 result for ${id}; got ${matches.length}` };
  }
  for (const r of sr.results) {
    if (r.status === 'ERROR')
      return { ok: false, message: `${phaseId}: unexpected ERROR in ${r.id}: ${r.error}` };
  }
  if (!report.boundaryChecks || !Array.isArray(report.boundaryChecks))
    return { ok: false, message: `${phaseId}: missing boundaryChecks` };
  for (const bc of report.boundaryChecks) {
    if (!bc.passed)
      return { ok: false, message: `${phaseId}: boundary check ${bc.id} failed` };
  }
  return { ok: true, message: 'shape ok' };
}

/**
 * For baseline and mutation: a red phase is valid only when the wrong-owner
 * case(s) fail through an observed unauthorized event, and all controls pass.
 */
function verifyBaselineExpectation(report, phaseId, expectedFailIds) {
  const { ok: shapeOk, message: shapeMsg } = verifyReportShape(report, phaseId);
  if (!shapeOk) return { expectationMet: false, message: shapeMsg, witnesses: [] };

  const sr = report.suiteReport;
  const witnesses = [];
  const unexpectedFails = [];
  const missedFails = [];

  for (const r of sr.results) {
    const shouldFail = expectedFailIds.includes(r.id);
    if (shouldFail) {
      if (r.status !== 'FAIL') {
        missedFails.push(r.id);
      } else {
        // Verify there IS an unauthorized event in the failure (behavioral proof).
        const unauthorized = r.failures.some(f =>
          f.includes('new sink event') && f.includes('observed')
        );
        if (!unauthorized) {
          return { expectationMet: false, message: `${r.id}: FAIL but no unauthorized-event witness`, witnesses: [] };
        }
        witnesses.push(r.id);
      }
    } else {
      if (r.status !== 'PASS') unexpectedFails.push(r.id);
    }
  }

  if (missedFails.length > 0)
    return { expectationMet: false, message: `Expected to fail: ${missedFails.join(', ')}`, witnesses };
  if (unexpectedFails.length > 0)
    return { expectationMet: false, message: `Unexpected failures: ${unexpectedFails.join(', ')}`, witnesses };

  return { expectationMet: true, message: 'behavioral failure detected as expected', witnesses };
}

function verifyPassExpectation(report, phaseId) {
  const { ok: shapeOk, message: shapeMsg } = verifyReportShape(report, phaseId);
  if (!shapeOk) return { expectationMet: false, message: shapeMsg, witnesses: [] };
  const sr = report.suiteReport;
  if (sr.status !== 'PASS')
    return { expectationMet: false, message: `Suite status was ${sr.status}`, witnesses: [] };
  return { expectationMet: true, message: 'all checks passed', witnesses: EXPECTED_IDS.slice() };
}

// ------------------------------------------------------------------ //
// Main                                                                 //
// ------------------------------------------------------------------ //

let tmpDir = null;
let overallStatus = 'PASS';
const phases = [];
const startTime = new Date().toISOString();

// Record policy/harness hashes before any phase.
const policyHash    = sha256(POLICY_SRC);
const casesHash     = sha256(CASES_SRC);
const checksHash    = sha256(CHECKS_SRC);
const effectsHash   = sha256(EFFECTS_SRC);
const testHash      = sha256(TEST_SRC);

try {
  // Create isolated temp directory.
  tmpDir = mkdtempSync(join(tmpdir(), 'rite-prove-'));
  console.log(`[rite-prove] Temp dir: ${tmpDir}`);

  // Set up temp directory structure.
  mkdirSync(join(tmpDir, 'src'), { recursive: true });
  mkdirSync(join(tmpDir, 'src', 'instrument'), { recursive: true });
  mkdirSync(join(tmpDir, 'test'), { recursive: true });

  // Copy immutable files (policy, cases, checks, tests, package).
  copyFileSync(CASES_SRC, join(tmpDir, 'src', 'cases.js'));
  copyFileSync(CHECKS_SRC, join(tmpDir, 'src', 'checks.js'));
  copyFileSync(EFFECTS_SRC, join(tmpDir, 'src', 'instrument', 'effect-schema.js'));
  copyFileSync(TEST_SRC, join(tmpDir, 'test', 'refunds.test.js'));
  // Minimal package.json so Node resolves imports correctly.
  writeFileSync(join(tmpDir, 'package.json'), JSON.stringify({ type: 'module' }, null, 2));

  // ---------------------------------------------------------------- //
  // PHASE 1: BASELINE                                                  //
  // ---------------------------------------------------------------- //
  console.log('\n[rite-prove] Phase: baseline');
  copyFileSync(BASELINE_SRC, join(tmpDir, 'src', 'refunds.js'));
  const baselineHash = sha256(join(tmpDir, 'src', 'refunds.js'));
  const baselineReportPath = join(tmpDir, 'baseline-report.json');
  const baseline = runTests(tmpDir, baselineReportPath);
  const baselineReport = readReport(baselineReportPath);
  const baselineExpect = verifyBaselineExpectation(baselineReport, 'baseline', ['wrong-owner:support']);

  const baselineResultStatus = (() => {
    if (!baselineReport?.suiteReport) return 'ERROR';
    return baselineReport.suiteReport.status;
  })();

  console.log(`  exit: ${baseline.exitCode}, signal: ${baseline.signal}`);
  console.log(`  expectation met: ${baselineExpect.expectationMet}`);
  console.log(`  witnesses: ${baselineExpect.witnesses.join(', ')}`);

  // Write baseline stdout to evidence.
  writeFileSync(join(EVIDENCE_DIR, 'baseline-stdout.txt'), baseline.stdout + '\n' + baseline.stderr);

  phases.push({
    id: 'baseline',
    label: 'Baseline (support ownership omission)',
    command: `node --test test/refunds.test.js`,
    exitCode: baseline.exitCode,
    signal: baseline.signal,
    sourceHash: baselineHash,
    resultStatus: baselineResultStatus,
    expectationMet: baselineExpect.expectationMet,
    witnesses: baselineExpect.witnesses,
    results: baselineReport?.suiteReport?.results ?? null,
  });

  if (!baselineExpect.expectationMet) {
    console.error(`[rite-prove] BASELINE expectation not met: ${baselineExpect.message}`);
    overallStatus = 'FAIL';
  }

  // ---------------------------------------------------------------- //
  // PHASE 2: FIXED                                                     //
  // ---------------------------------------------------------------- //
  console.log('\n[rite-prove] Phase: fixed');
  copyFileSync(DOMAIN_SRC, join(tmpDir, 'src', 'refunds.js'));
  const fixedHash = sha256(join(tmpDir, 'src', 'refunds.js'));
  const fixedReportPath = join(tmpDir, 'fixed-report.json');
  const fixed = runTests(tmpDir, fixedReportPath);
  const fixedReport = readReport(fixedReportPath);
  const fixedExpect = verifyPassExpectation(fixedReport, 'fixed');

  const fixedResultStatus = (() => {
    if (!fixedReport?.suiteReport) return 'ERROR';
    return fixedReport.suiteReport.status;
  })();

  console.log(`  exit: ${fixed.exitCode}, signal: ${fixed.signal}`);
  console.log(`  expectation met: ${fixedExpect.expectationMet}`);

  writeFileSync(join(EVIDENCE_DIR, 'fixed-stdout.txt'), fixed.stdout + '\n' + fixed.stderr);

  phases.push({
    id: 'fixed',
    label: 'Fixed (shared authorization enforced)',
    command: `node --test test/refunds.test.js`,
    exitCode: fixed.exitCode,
    signal: fixed.signal,
    sourceHash: fixedHash,
    resultStatus: fixedResultStatus,
    expectationMet: fixedExpect.expectationMet,
    witnesses: fixedExpect.witnesses,
    results: fixedReport?.suiteReport?.results ?? null,
  });

  if (!fixedExpect.expectationMet) {
    console.error(`[rite-prove] FIXED expectation not met: ${fixedExpect.message}`);
    overallStatus = 'FAIL';
  }

  // ---------------------------------------------------------------- //
  // PHASE 3: MUTATION                                                  //
  // ---------------------------------------------------------------- //
  console.log('\n[rite-prove] Phase: mutation (remove ownership guard)');
  const fixedSource = readFileSync(join(tmpDir, 'src', 'refunds.js'), 'utf-8');

  // Strip the block between RITE:OWNERSHIP_GUARD_START and RITE:OWNERSHIP_GUARD_END sentinels.
  // Using sentinels makes the mutation survive any reformatting of the guard line.
  const START_SENTINEL = '// RITE:OWNERSHIP_GUARD_START';
  const END_SENTINEL   = '// RITE:OWNERSHIP_GUARD_END';
  const startIdx = fixedSource.indexOf(START_SENTINEL);
  const endIdx   = fixedSource.indexOf(END_SENTINEL);

  if (startIdx === -1 || endIdx === -1 || startIdx >= endIdx) {
    console.error(`[rite-prove] MUTATION: sentinel comments not found in refunds.js. Add RITE:OWNERSHIP_GUARD_START/END around the ownership check.`);
    overallStatus = 'FAIL';
    phases.push({
      id: 'mutation',
      label: 'Ownership-check mutation detected',
      command: `node --test test/refunds.test.js`,
      exitCode: null,
      signal: null,
      sourceHash: null,
      resultStatus: 'ERROR',
      expectationMet: false,
      witnesses: [],
      results: null,
      processError: `Sentinel comments RITE:OWNERSHIP_GUARD_START/END not found. Source drifted.`,
    });
  } else {
    // Remove everything between (and including) the sentinel lines
    const beforeBlock = fixedSource.slice(0, startIdx);
    const afterBlock  = fixedSource.slice(endIdx + END_SENTINEL.length);
    const mutantSource = beforeBlock + '    // RITE:OWNERSHIP_GUARD — MUTATION: guard removed\n' + afterBlock;
    writeFileSync(join(tmpDir, 'src', 'refunds.js'), mutantSource);
    const mutantHash = sha256(join(tmpDir, 'src', 'refunds.js'));
    const mutantReportPath = join(tmpDir, 'mutation-report.json');
    const mutation = runTests(tmpDir, mutantReportPath);
    const mutationReport = readReport(mutantReportPath);
    const mutationExpect = verifyBaselineExpectation(
      mutationReport, 'mutation',
      ['wrong-owner:customer', 'wrong-owner:support']
    );

    const mutationResultStatus = (() => {
      if (!mutationReport?.suiteReport) return 'ERROR';
      return mutationReport.suiteReport.status;
    })();

    console.log(`  exit: ${mutation.exitCode}, signal: ${mutation.signal}`);
    console.log(`  expectation met: ${mutationExpect.expectationMet}`);
    console.log(`  witnesses: ${mutationExpect.witnesses.join(', ')}`);

    writeFileSync(join(EVIDENCE_DIR, 'mutation-stdout.txt'), mutation.stdout + '\n' + mutation.stderr);

    phases.push({
      id: 'mutation',
      label: 'Ownership-check mutation detected',
      command: `node --test test/refunds.test.js`,
      exitCode: mutation.exitCode,
      signal: mutation.signal,
      sourceHash: mutantHash,
      resultStatus: mutationResultStatus,
      expectationMet: mutationExpect.expectationMet,
      witnesses: mutationExpect.witnesses,
      results: mutationReport?.suiteReport?.results ?? null,
    });

    if (!mutationExpect.expectationMet) {
      console.error(`[rite-prove] MUTATION expectation not met: ${mutationExpect.message}`);
      overallStatus = 'FAIL';
    }
  }

  // ---------------------------------------------------------------- //
  // PHASE 4: RESTORED                                                  //
  // ---------------------------------------------------------------- //
  console.log('\n[rite-prove] Phase: restored');
  copyFileSync(DOMAIN_SRC, join(tmpDir, 'src', 'refunds.js'));
  const restoredHash = sha256(join(tmpDir, 'src', 'refunds.js'));
  const restoredReportPath = join(tmpDir, 'restored-report.json');
  const restored = runTests(tmpDir, restoredReportPath);
  const restoredReport = readReport(restoredReportPath);
  const restoredExpect = verifyPassExpectation(restoredReport, 'restored');

  const restoredResultStatus = (() => {
    if (!restoredReport?.suiteReport) return 'ERROR';
    return restoredReport.suiteReport.status;
  })();

  console.log(`  exit: ${restored.exitCode}, signal: ${restored.signal}`);
  console.log(`  expectation met: ${restoredExpect.expectationMet}`);

  writeFileSync(join(EVIDENCE_DIR, 'restored-stdout.txt'), restored.stdout + '\n' + restored.stderr);

  phases.push({
    id: 'restored',
    label: 'Restored (exact fixed bytes)',
    command: `node --test test/refunds.test.js`,
    exitCode: restored.exitCode,
    signal: restored.signal,
    sourceHash: restoredHash,
    resultStatus: restoredResultStatus,
    expectationMet: restoredExpect.expectationMet,
    witnesses: restoredExpect.witnesses,
    results: restoredReport?.suiteReport?.results ?? null,
  });

  if (!restoredExpect.expectationMet) {
    console.error(`[rite-prove] RESTORED expectation not met: ${restoredExpect.message}`);
    overallStatus = 'FAIL';
  }

  // ---------------------------------------------------------------- //
  // Integrity check: policy/harness hashes must be unchanged           //
  // ---------------------------------------------------------------- //
  const policyHashAfter  = sha256(POLICY_SRC);
  const casesHashAfter   = sha256(CASES_SRC);
  const checksHashAfter  = sha256(CHECKS_SRC);
  const effectsHashAfter = sha256(EFFECTS_SRC);
  const testHashAfter    = sha256(TEST_SRC);

  if (policyHashAfter !== policyHash || casesHashAfter !== casesHash ||
      checksHashAfter !== checksHash || effectsHashAfter !== effectsHash ||
      testHashAfter !== testHash) {
    console.error('[rite-prove] INTEGRITY: policy/harness hashes changed during proof run!');
    overallStatus = 'FAIL';
  }

  // Verify workspace domain source was NOT modified.
  const workspaceDomainHash = sha256(DOMAIN_SRC);
  const fixedPhase = phases.find(p => p.id === 'fixed');
  if (fixedPhase && workspaceDomainHash !== fixedPhase.sourceHash) {
    console.error('[rite-prove] INTEGRITY: workspace refunds.js was modified during proof run!');
    overallStatus = 'FAIL';
  }

  // ---------------------------------------------------------------- //
  // Write proof.json                                                   //
  // ---------------------------------------------------------------- //
  const proof = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    status: overallStatus,
    runtime: {
      node: process.version,
      platform: platform(),
    },
    scope: {
      entryPaths: ['customerRefund', 'supportRefund'],
      domainFile: 'src/refunds.js',
      testFile: 'test/refunds.test.js',
      casesFile: 'src/cases.js',
      checksFile: 'src/checks.js',
      effectsFile: 'src/instrument/effect-schema.js',
    },
    hashes: {
      policy: policyHash,
      cases: casesHash,
      checks: checksHash,
      effects: effectsHash,
      test: testHash,
    },
    phases,
  };

  mkdirSync(EVIDENCE_DIR, { recursive: true });
  mkdirSync(PUBLIC_EV_DIR, { recursive: true });
  writeFileSync(PROOF_OUT, JSON.stringify(proof, null, 2));
  copyFileSync(PROOF_OUT, PROOF_PUBLIC);

  console.log(`\n[rite-prove] Proof written to: ${PROOF_OUT}`);
  console.log(`[rite-prove] Overall status: ${overallStatus}`);

} finally {
  // Clean up only the temp directory created by this script.
  if (tmpDir && existsSync(tmpDir)) {
    try {
      rmSync(tmpDir, { recursive: true, force: true });
      console.log(`[rite-prove] Temp dir cleaned: ${tmpDir}`);
    } catch (e) {
      console.warn(`[rite-prove] Could not clean temp dir: ${e.message}`);
    }
  }
}

if (overallStatus !== 'PASS') {
  process.exit(1);
}
