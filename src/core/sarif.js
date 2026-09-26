/**
 * src/core/sarif.js — SARIF 2.1.0 output formatter.
 *
 * Converts a Rite VerifyReport into a SARIF document suitable for upload
 * to GitHub Code Scanning via `actions/upload-sarif`.
 *
 * Spec: https://docs.oasis-open.org/sarif/sarif/v2.1.0/sarif-v2.1.0.html
 * GitHub upload: https://docs.github.com/en/code-security/code-scanning/integrating-with-code-scanning/uploading-a-sarif-file-to-github
 *
 * Usage:
 *   rite verify --config rite.config.json --sarif results.sarif
 *
 * SARIF level mapping:
 *   FAIL  → error   (blocks merge when uploaded as a required check)
 *   ERROR → error
 *   PASS  → note    (informational, does not block)
 */

import { ENGINE_VERSION } from './engine.js';

const SARIF_SCHEMA = 'https://raw.githubusercontent.com/oasis-tcs/sarif-spec/master/Schemata/sarif-schema-2.1.0.json';
const SARIF_VERSION = '2.1.0';

/**
 * @typedef {import('./engine.js').VerifyReport} VerifyReport
 * @typedef {import('./engine.js').CaseResult} CaseResult
 */

/**
 * Map a case status to a SARIF notification level.
 * @param {'PASS'|'FAIL'|'ERROR'} status
 * @returns {'error'|'warning'|'note'}
 */
function toLevel(status) {
  if (status === 'PASS') return 'note';
  return 'error';
}

/**
 * Build a SARIF result for one case.
 * @param {CaseResult} r
 * @param {string} ruleId
 * @returns {object}
 */
function buildResult(r, ruleId) {
  const level = toLevel(r.status);
  const message = r.status === 'PASS'
    ? `${r.id}: authorization check passed on path "${r.path}".`
    : r.status === 'ERROR'
      ? `${r.id}: case execution error on path "${r.path}": ${r.error?.split('\n')[0]}`
      : `${r.id}: authorization check FAILED on path "${r.path}". ${r.failures.join(' | ')}`;

  return {
    ruleId,
    level,
    message: { text: message },
    locations: [
      {
        physicalLocation: {
          artifactLocation: {
            uri: r.observed?.sourceFile ?? 'src/refunds.js',
            uriBaseId: '%SRCROOT%',
          },
        },
        logicalLocations: [
          { name: r.path, kind: 'function' },
        ],
      },
    ],
    partialFingerprints: {
      'rite/caseId': r.id,
      'rite/path': r.path,
    },
  };
}

/**
 * Convert a VerifyReport to a SARIF 2.1.0 document.
 * @param {VerifyReport} report
 * @returns {object} — serialize with JSON.stringify
 */
export function toSarif(report) {
  const ruleId = report.ruleId ?? 'rite-authorization';

  const rules = [
    {
      id: ruleId,
      name: 'RiteAuthorizationCheck',
      shortDescription: { text: report.rule ?? 'Authorization rule check' },
      fullDescription: {
        text: `Rite checks that the written authorization rule holds across all configured entry paths. Rule: ${report.rule}`,
      },
      defaultConfiguration: { level: 'error' },
      helpUri: 'https://github.com/timidan/rite',
      properties: {
        tags: ['security', 'authorization', 'access-control'],
        precision: 'high',
        'security-severity': '8.0',  // CVSS-style; IDOR is typically 7-9
      },
    },
  ];

  const results = (report.results ?? []).map(r => buildResult(r, ruleId));

  return {
    $schema: SARIF_SCHEMA,
    version: SARIF_VERSION,
    runs: [
      {
        tool: {
          driver: {
            name: 'Rite',
            version: ENGINE_VERSION,
            informationUri: 'https://github.com/timidan/rite',
            rules,
          },
        },
        results,
        automationDetails: {
          id: `rite/${report.ruleId ?? 'check'}/${report.generatedAt}`,
        },
        columnKind: 'utf16CodeUnits',
      },
    ],
  };
}
