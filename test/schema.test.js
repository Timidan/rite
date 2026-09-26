/**
 * test/schema.test.js — Direct unit tests for src/instrument/effect-schema.js.
 *
 * Tests validateEffect, validateEffects, resolveSchema, and compareEffects
 * with known inputs — no service, no adapter, no filesystem.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveSchema,
  validateEffect,
  validateEffects,
  compareEffects,
  listSchemas,
} from '../src/instrument/effect-schema.js';

describe('resolveSchema', () => {
  it('resolves a named built-in schema', () => {
    const schema = resolveSchema('refund-event');
    assert.ok(schema);
    assert.ok('orderId' in schema);
    assert.ok('amountCents' in schema);
  });

  it('returns null for unknown name', () => {
    assert.equal(resolveSchema('unknown-schema'), null);
  });

  it('passes through an inline object schema', () => {
    const inline = { foo: 'string', bar: 'number' };
    assert.deepEqual(resolveSchema(inline), inline);
  });

  it('returns null for undefined', () => {
    assert.equal(resolveSchema(undefined), null);
  });
});

describe('listSchemas', () => {
  it('returns an array of built-in schema names', () => {
    const names = listSchemas();
    assert.ok(Array.isArray(names));
    assert.ok(names.includes('refund-event'));
  });
});

describe('validateEffect', () => {
  const schema = { orderId: 'string', amountCents: 'number' };

  it('passes a valid effect', () => {
    const violations = validateEffect({ orderId: 'o-1', amountCents: 100 }, schema);
    assert.deepEqual(violations, []);
  });

  it('reports wrong type', () => {
    const v = validateEffect({ orderId: 123, amountCents: 100 }, schema);
    assert.ok(v.some(s => s.includes('orderId') && s.includes('number')));
  });

  it('reports missing required field', () => {
    const v = validateEffect({ amountCents: 100 }, schema);
    assert.ok(v.some(s => s.includes('orderId') && s.includes('missing')));
  });

  it('reports unexpected extra field', () => {
    const v = validateEffect({ orderId: 'o-1', amountCents: 100, extra: 'bad' }, schema);
    assert.ok(v.some(s => s.includes('extra') && s.includes('unexpected')));
  });
});

describe('validateEffects', () => {
  it('validates all effects and collects violations', () => {
    const violations = validateEffects(
      [{ orderId: 'o-1', amountCents: 'wrong-type' }],
      'refund-event'
    );
    assert.ok(violations.length > 0);
    assert.ok(violations.some(v => v.includes('amountCents')));
  });

  it('returns empty array for no schema', () => {
    assert.deepEqual(validateEffects([{ anything: true }], undefined), []);
  });

  it('returns empty array for empty effects', () => {
    assert.deepEqual(validateEffects([], 'refund-event'), []);
  });
});

describe('compareEffects', () => {
  const observed = [{ orderId: 'o-1', actorId: 'a-1', amountCents: 4900, currency: 'USD' }];
  const expected = [{ orderId: 'o-1', actorId: 'a-1', amountCents: 4900, currency: 'USD' }];

  it('passes when effects match', () => {
    assert.deepEqual(compareEffects(observed, expected), []);
  });

  it('fails on count mismatch', () => {
    const f = compareEffects([], expected);
    assert.ok(f.some(s => s.includes('effects count')));
    assert.ok(f.some(s => s.includes('expected 1')));
  });

  it('fails when a denial produces effects (0 expected, 1 observed)', () => {
    const f = compareEffects(observed, []);
    assert.ok(f.some(s => s.includes('effects count')));
    assert.ok(f.some(s => s.includes('observed 1')));
    // The first observed effect should be included in the message
    assert.ok(f.some(s => s.includes('orderId')));
  });

  it('fails on field mismatch', () => {
    const wrong = [{ orderId: 'o-1', actorId: 'a-1', amountCents: 99, currency: 'USD' }];
    const f = compareEffects(wrong, expected);
    assert.ok(f.some(s => s.includes('amountCents')));
  });

  it('reports schema violations when schemaRef provided', () => {
    const withBadType = [{ orderId: 'o-1', actorId: 'a-1', amountCents: 'oops', currency: 'USD' }];
    const expectedForSchema = [{ orderId: 'o-1', actorId: 'a-1', amountCents: 'oops', currency: 'USD' }];
    const f = compareEffects(withBadType, expectedForSchema, 'refund-event');
    assert.ok(f.some(s => s.includes('amountCents')));
  });

  it('handles non-array inputs gracefully', () => {
    // Should not throw — treats non-arrays as empty
    assert.doesNotThrow(() => compareEffects(null, null));
    assert.doesNotThrow(() => compareEffects(undefined, undefined));
  });
});
