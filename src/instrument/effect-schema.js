/**
 * src/instrument/effect-schema.js — Typed effect registry.
 *
 * Defines named sink event schemas. The engine validates adapter-reported
 * effects against the registered schema before structural comparison.
 * This prevents two adapters describing the same event differently from
 * both passing silently.
 *
 * Schema format:
 *   { field: 'type' | ['type', required?] }
 * Types: 'string' | 'number' | 'boolean' | 'object' | 'any'
 *
 * Register your schema in rite.config.json under "effectSchema":
 *   "effectSchema": "refund-event"
 *
 * Or inline in config:
 *   "effectSchema": {
 *     "orderId":    "string",
 *     "actorId":    "string",
 *     "amountCents": "number",
 *     "currency":   "string"
 *   }
 */

// ------------------------------------------------------------------ //
// Built-in schemas                                                     //
// ------------------------------------------------------------------ //

/** @type {Record<string, Record<string, string | [string, boolean]>>} */
const BUILT_IN_SCHEMAS = {
  'refund-event': {
    orderId:     'string',
    actorId:     'string',
    amountCents: 'number',
    currency:    'string',
  },
  'transfer-event': {
    fromAccountId: 'string',
    toAccountId:   'string',
    amountCents:   'number',
    currency:      'string',
  },
  'permission-grant': {
    subjectId:   'string',
    resourceId:  'string',
    permission:  'string',
    grantedBy:   'string',
  },
};

// ------------------------------------------------------------------ //
// Validator                                                            //
// ------------------------------------------------------------------ //

/**
 * Resolve a schema from either a registered name or an inline object.
 * @param {string | Record<string,string> | undefined} schemaRef
 * @returns {Record<string,string> | null}
 */
export function resolveSchema(schemaRef) {
  if (!schemaRef) return null;
  if (typeof schemaRef === 'string') return BUILT_IN_SCHEMAS[schemaRef] ?? null;
  if (typeof schemaRef === 'object') return schemaRef;
  return null;
}

/**
 * Validate one effect object against a schema.
 * Returns an array of violation strings (empty = valid).
 * @param {object} effect
 * @param {Record<string,string>} schema
 * @param {string} context — for error messages
 * @returns {string[]}
 */
export function validateEffect(effect, schema, context = 'effect') {
  const violations = [];
  for (const [field, typeSpec] of Object.entries(schema)) {
    const [expectedType, required = true] = Array.isArray(typeSpec) ? typeSpec : [typeSpec, true];
    const value = /** @type {Record<string,unknown>} */ (effect)[field];
    if (value === undefined || value === null) {
      if (required) violations.push(`${context}.${field}: required field missing`);
      continue;
    }
    if (expectedType === 'any') continue;
    const actualType = typeof value;
    if (actualType !== expectedType)
      violations.push(`${context}.${field}: expected ${expectedType}; got ${actualType} (${JSON.stringify(value)})`);
  }
  // Reject unknown fields — adapters must not smuggle extra data
  for (const key of Object.keys(effect)) {
    if (!(key in schema))
      violations.push(`${context}.${key}: unexpected field not in schema`);
  }
  return violations;
}

/**
 * Validate all effects in a case result against the config schema.
 * Returns all violations across all effects.
 * @param {object[]} effects
 * @param {string | Record<string,string> | undefined} schemaRef
 * @returns {string[]}
 */
export function validateEffects(effects, schemaRef) {
  const schema = resolveSchema(schemaRef);
  if (!schema || !Array.isArray(effects)) return [];
  const violations = [];
  for (let i = 0; i < effects.length; i++) {
    violations.push(...validateEffect(effects[i], schema, `effects[${i}]`));
  }
  return violations;
}

/** @returns {string[]} Names of all built-in schemas */
export function listSchemas() {
  return Object.keys(BUILT_IN_SCHEMAS);
}

// ------------------------------------------------------------------ //
// Unified effect comparison                                            //
// ------------------------------------------------------------------ //

/**
 * Compare observed effects against expected effects and an optional schema.
 * This is the single authoritative comparison used by both the engine and
 * the browser runner — neither re-implements this logic.
 *
 * Checks (in order):
 *   1. Count mismatch — a denial that produces effects always FAIL
 *   2. Per-field structural match against expected values
 *   3. Schema validation (if schemaRef provided)
 *
 * @param {object[]} observed
 * @param {object[]} expected
 * @param {string | Record<string,string> | undefined} [schemaRef]
 * @returns {string[]} failure strings (empty = pass)
 */
export function compareEffects(observed, expected, schemaRef) {
  const failures = [];
  const obs = Array.isArray(observed) ? observed : [];
  const exp = Array.isArray(expected) ? expected : [];

  // 1. Count
  if (obs.length !== exp.length) {
    failures.push(
      `effects count: expected ${exp.length}; observed ${obs.length}` +
      (obs.length > 0 ? ` (first: ${JSON.stringify(obs[0])})` : '')
    );
  }

  // 2. Per-field structural match
  for (let i = 0; i < exp.length; i++) {
    const eEff = exp[i];
    const oEff = obs[i];
    if (!oEff) break; // already caught by count check
    for (const key of Object.keys(eEff)) {
      if (eEff[key] !== oEff[key])
        failures.push(`effects[${i}].${key}: expected ${JSON.stringify(eEff[key])}; observed ${JSON.stringify(oEff[key])}`);
    }
  }

  // 3. Schema validation
  if (schemaRef && obs.length > 0) {
    failures.push(...validateEffects(obs, schemaRef));
  }

  return failures;
}
