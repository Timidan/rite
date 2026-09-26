import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { hasRiteWorkflow, validateReportBinding } from '../src/github/server.js';
import { buildInstallUrl, checkEnv } from '../src/github/app.js';

const sha = 'a'.repeat(40);
const report = { schemaVersion: 1, status: 'PASS', results: [], commitSha: sha };

describe('GitHub report binding', () => {
  it('accepts only a report bound to the workflow run commit', () => {
    assert.equal(validateReportBinding(report, sha).valid, true);
    assert.equal(validateReportBinding({ ...report, commitSha: undefined }, sha).valid, false);
    assert.equal(validateReportBinding(report, 'b'.repeat(40)).valid, false);
  });
});

it('accepts a private-key file in the GitHub App environment', () => {
  const names = [
    'GITHUB_APP_ID', 'GITHUB_APP_CLIENT_ID', 'GITHUB_APP_CLIENT_SECRET',
    'GITHUB_APP_PRIVATE_KEY', 'GITHUB_APP_PRIVATE_KEY_FILE',
    'RITE_SESSION_SECRET', 'RITE_PUBLIC_URL',
  ];
  const previous = Object.fromEntries(names.map(name => [name, process.env[name]]));
  try {
    for (const name of names) process.env[name] = 'test';
    delete process.env.GITHUB_APP_PRIVATE_KEY;
    assert.deepEqual(checkEnv(), { ok: true, missing: [] });
  } finally {
    for (const name of names) {
      if (previous[name] === undefined) delete process.env[name];
      else process.env[name] = previous[name];
    }
  }
});

it('preserves CSRF state through the GitHub installation URL', () => {
  const url = new URL(buildInstallUrl('state with spaces'));
  assert.equal(url.origin, 'https://github.com');
  assert.equal(url.pathname, '/apps/rite-authorization-check/installations/new');
  assert.equal(url.searchParams.get('state'), 'state with spaces');
});

it('recognizes only the generated Rite workflow path', () => {
  assert.equal(hasRiteWorkflow([{ path: '.github/workflows/rite.yml' }]), true);
  assert.equal(hasRiteWorkflow([{ path: '.github/workflows/tests.yml' }]), false);
});
