/**
 * src/core/loader.js — Shared adapter loader.
 *
 * Resolves, bounds-checks, and imports a Rite adapter from a config-relative
 * path. Used by the CLI, MCP server, and GitHub server — none of them
 * re-implement path validation or the pathToFileURL import pattern.
 *
 * No DOM globals. No React. Pure Node.js (fs + url + path).
 */

import { existsSync } from 'node:fs';
import { resolve, relative, isAbsolute, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * @typedef {{
 *   ok: true,
 *   adapter: { runCase: (caseSpec: object) => Promise<object> },
 *   adapterPath: string,
 * } | {
 *   ok: false,
 *   error: string,
 * }} LoadResult
 */

/**
 * Load a Rite adapter from a path relative to the config file's directory.
 *
 * Validates:
 *   - adapterRel does not escape the configDir (no path traversal)
 *   - The resolved file exists
 *   - The loaded module exports a runCase() function
 *
 * @param {string} configDir   — absolute directory containing rite.config.json
 * @param {string} adapterRel  — config.adapter value (relative path)
 * @returns {Promise<LoadResult>}
 */
export async function loadAdapter(configDir, adapterRel) {
  // Bounds check — adapter must stay inside config dir
  const adapterPath = resolve(configDir, adapterRel);
  const rel = relative(configDir, adapterPath);
  if (isAbsolute(rel) || rel.startsWith('..')) {
    return { ok: false, error: `Adapter path escapes the config directory: ${adapterRel}` };
  }

  if (!existsSync(adapterPath)) {
    return { ok: false, error: `Adapter not found: ${adapterPath}` };
  }

  let adapter;
  try {
    adapter = await import(pathToFileURL(adapterPath).href);
  } catch (e) {
    return { ok: false, error: `Failed to load adapter: ${e.message}` };
  }

  if (typeof adapter.runCase !== 'function') {
    return { ok: false, error: `Adapter must export runCase() — not found in ${adapterPath}` };
  }

  return { ok: true, adapter, adapterPath };
}

/**
 * Convenience: load adapter from a fully-parsed config object + config file path.
 * @param {object} config  — validated RiteConfig
 * @param {string} configPath  — absolute path to the config file
 * @returns {Promise<LoadResult>}
 */
export async function loadAdapterFromConfig(config, configPath) {
  return loadAdapter(dirname(configPath), config.adapter);
}
