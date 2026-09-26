/**
 * src/instrument/auto-adapter.js — Auto-adapter generator.
 *
 * Given a JS/TS module that exports named functions, wraps each target entry
 * and sink with lightweight instrumentation — no code modification needed.
 *
 * How it works:
 *   1. Dynamically imports the target module.
 *   2. Wraps named entry functions to capture call arguments.
 *   3. Wraps the named sink function to record every invocation.
 *   4. Exposes runCase(caseSpec) using the same adapter contract as rite.adapter.mjs.
 *
 * Limitations:
 *   - Works for ES modules and CJS modules with named exports.
 *   - The sink must be exported OR accessible via a state object returned by a factory.
 *   - Does not handle async generator patterns or prototype-chain dispatch.
 *   - Does not instrument code behind dynamic require() or conditional imports.
 *   - For complex services (dependency injection, class hierarchies), a manual
 *     adapter is still recommended.
 *
 * Usage (programmatic):
 *   import { generateAdapter } from './auto-adapter.js';
 *   const adapter = await generateAdapter({
 *     modulePath: './src/service.js',
 *     factoryFn: 'createService',   // optional: if module exports a factory
 *     factoryArgs: [{ orders: [...] }],
 *     entries: ['customerRefund', 'supportRefund'],
 *     sink: 'issueRefund',          // name to detect in call stack / exports
 *     snapshotFn: 'snapshot',       // optional: for before/after state
 *   });
 *   const report = await verify(config, adapter);
 *
 * Usage (CLI):
 *   rite instrument --module ./src/service.js \
 *                   --factory createService \
 *                   --entries customerRefund,supportRefund \
 *                   --sink issueRefund \
 *                   --snapshot snapshot \
 *                   --out examples/generated/rite.adapter.mjs
 */

import { pathToFileURL } from 'node:url';
import { writeFileSync } from 'node:fs';

// ------------------------------------------------------------------ //
// Effect schema registry                                               //
// ------------------------------------------------------------------ //
// Registered sink schemas validate that effects match before comparison.
// See src/instrument/effect-schema.js for the full registry.

/**
 * @typedef {{
 *   modulePath: string,
 *   factoryFn?: string,
 *   factoryArgs?: unknown[],
 *   entries: string[],
 *   sink: string,
 *   snapshotFn?: string,
 *   seedBuilder?: (caseSpec: object) => object[],
 * }} InstrumentOptions
 */

/**
 * Generate a live adapter object (not a file) by wrapping a loaded module.
 * @param {InstrumentOptions} opts
 * @returns {Promise<{ runCase: (caseSpec: object) => Promise<object> }>}
 */
export async function generateAdapter(opts) {
  const { modulePath, factoryFn, factoryArgs = [], entries, sink, snapshotFn, seedBuilder } = opts;

  const mod = await import(pathToFileURL(modulePath).href);

  return {
    /**
     * runCase — conforms to the rite adapter contract.
     */
    async runCase(caseSpec) {
      const { path: entryName, actor, input } = caseSpec;

      if (!entries.includes(entryName)) {
        throw new Error(`Entry "${entryName}" not in instrumented entries: ${entries.join(', ')}`);
      }

      // Build fixture args — use seedBuilder if provided, else empty
      const seeds = seedBuilder ? seedBuilder(caseSpec) : [];

      // Create a fresh service instance per case
      let instance;
      const capturedSinkCalls = [];

      if (factoryFn) {
        const factory = mod[factoryFn];
        if (typeof factory !== 'function')
          throw new Error(`Factory "${factoryFn}" not found in module`);
        instance = factory(...(seeds.length ? [{ orders: seeds }, ...factoryArgs.slice(1)] : factoryArgs));
      } else {
        // Module-level exports: wrap directly
        instance = mod;
      }

      // Wrap the sink to capture calls
      const originalSink = instance[sink];
      if (typeof originalSink === 'function') {
        instance[sink] = function (...args) {
          const result = originalSink.apply(this, args);
          capturedSinkCalls.push({ args, result });
          return result;
        };
      }
      // Note: if sink is a private closure (most common case), use snapshotFn to infer effects.

      const entryFn = instance[entryName];
      if (typeof entryFn !== 'function')
        throw new Error(`Entry "${entryName}" not found on instance`);

      // Snapshot before
      const snapshotBefore = snapshotFn && typeof instance[snapshotFn] === 'function'
        ? instance[snapshotFn]()
        : null;
      const eventsBefore = snapshotBefore?.events?.length ?? 0;

      // Call entry
      const result = entryFn.call(instance, input, { actorId: actor });

      // Snapshot after
      const snapshotAfter = snapshotFn && typeof instance[snapshotFn] === 'function'
        ? instance[snapshotFn]()
        : null;
      const eventsAfter = snapshotAfter?.events?.length ?? 0;

      // Derive effects from snapshot delta (works for private sinks)
      const newEvents = snapshotAfter?.events
        ? snapshotAfter.events.slice(eventsBefore)
        : capturedSinkCalls.map(c => c.args[0] ?? c.args);

      const effects = newEvents.map(({ refundId: _rid, ...rest }) => rest);

      const orderId = input?.orderId;
      const stateBefore = snapshotBefore?.orders?.find(o => o.id === orderId) ?? null;
      const stateAfter  = snapshotAfter?.orders?.find(o => o.id === orderId) ?? null;
      const stateChanged = JSON.stringify(stateBefore) !== JSON.stringify(stateAfter);

      return {
        decision: result?.ok === true ? 'allow' : 'deny',
        effects,
        stateBefore,
        stateAfter,
        stateChanged,
      };
    },
  };
}

// ------------------------------------------------------------------ //
// File generator — write a static adapter file                        //
// ------------------------------------------------------------------ //

/**
 * Generate and write a rite.adapter.mjs file for a given module.
 * The generated file is a fully self-contained adapter that can be committed.
 * @param {InstrumentOptions & { outPath: string, relativeModulePath: string }} opts
 */
export function writeAdapterFile(opts) {
  const { entries, sink, snapshotFn, factoryFn, outPath, relativeModulePath } = opts;

  const importLine = factoryFn
    ? `import { ${factoryFn} } from '${relativeModulePath}';`
    : `import * as mod from '${relativeModulePath}';`;

  const instanceExpr = factoryFn
    ? `${factoryFn}({ orders: seedsForCase(input.orderId) })`
    : `mod`;

  const snapshotBefore = snapshotFn
    ? `const snapBefore = instance.${snapshotFn}();`
    : `const snapBefore = { events: [], orders: [] };`;

  const snapshotAfter = snapshotFn
    ? `const snapAfter = instance.${snapshotFn}();`
    : `const snapAfter = { events: [], orders: [] };`;

  const entryDispatch = entries.map(e =>
    `  if (entryName === '${e}') result = instance.${e}(input, { actorId: actor });`
  ).join('\n');

  const content = `/**
 * rite.adapter.mjs — Auto-generated by \`rite instrument\`.
 * Edit seed definitions and the SEEDS map to match your fixtures.
 * Generated: ${new Date().toISOString()}
 */

${importLine}

// TODO: populate SEEDS with your fixture data.
const SEEDS = {
  'example-id': {
    id: 'example-id',
    ownerId: 'actor-owner',
    paymentStatus: 'paid',
    amountCents: 1000,
    currency: 'USD',
    refunded: false,
  },
};

function seedsForCase(resourceId) {
  const seed = SEEDS[resourceId];
  if (!seed) throw new Error(\`No seed for: \${resourceId}\`);
  return [{ ...seed }];
}

export async function runCase(caseSpec) {
  const { path: entryName, actor, input } = caseSpec;
  const instance = ${instanceExpr};
  ${snapshotBefore}
  let result;
${entryDispatch}
  else throw new Error(\`Unknown entry: \${entryName}\`);
  ${snapshotAfter}
  const newEvents = snapAfter.events.slice(snapBefore.events.length);
  const effects = newEvents.map(({ refundId: _rid, ...rest }) => rest);
  const orderId = input?.orderId ?? input?.resourceId;
  const stateBefore = snapBefore.orders?.find(o => o.id === orderId) ?? null;
  const stateAfter  = snapAfter.orders?.find(o => o.id === orderId) ?? null;
  const stateChanged = JSON.stringify(stateBefore) !== JSON.stringify(stateAfter);
  return {
    decision: result?.ok === true ? 'allow' : 'deny',
    effects,
    stateBefore,
    stateAfter,
    stateChanged,
  };
}
`;

  writeFileSync(outPath, content, 'utf-8');
}
