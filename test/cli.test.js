import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

describe('rite init', () => {
  it('creates config, adapter, and a portable workflow', () => {
    const target = mkdtempSync(join(tmpdir(), 'rite-init-'));
    const cli = resolve('src/cli/rite.js');
    const result = spawnSync(process.execPath, [cli, 'init', '--dir', target], { encoding: 'utf8' });

    assert.equal(result.status, 0, result.stderr);
    assert.doesNotThrow(() => JSON.parse(readFileSync(join(target, 'rite.config.json'), 'utf8')));
    assert.match(readFileSync(join(target, 'rite.adapter.mjs'), 'utf8'), /export async function runCase/);
    assert.match(
      readFileSync(join(target, '.github', 'workflows', 'rite.yml'), 'utf8'),
      /npx --yes @timidan\/rite@0\.1\.0 verify/
    );
  });
});
