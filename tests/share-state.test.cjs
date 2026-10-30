'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const model = require('../engine.js');
const links = require('../share-state.js');

test('a shared retry experiment restores its exact synthetic envelope', () => {
  const original = {
    scenario: 'replay',
    design: 'preflight',
    config: { amount: 40, limit: 100, budget: 120, ttl: 1000, lag: 0 }
  };
  const url = new URL(
    links.serialise('https://example.test/lab/?unrelated=value#old', original, model)
  );
  const restored = links.parse(url.search, model);
  assert.deepEqual(restored, { ...original, warnings: [] });
  assert.equal(url.hash, '#workbench');
  assert.equal(url.searchParams.has('unrelated'), false);
  assert.deepEqual(
    model.run(restored.scenario, restored.design, restored.config),
    model.run(original.scenario, original.design, original.config)
  );
});

test('invalid or unsafe URL values are discarded independently', () => {
  const result = links.parse(
    '?scenario=%3Cscript%3E&design=__proto__&amount=-1&limit=Infinity&budget=&ttl=1e3&lag=0',
    model
  );
  assert.equal(result.scenario, 'race');
  assert.equal(result.design, 'atomic');
  assert.equal(result.config.lag, 0);
  assert.equal(result.warnings.length, 6);
  for (const key of ['amount', 'limit', 'budget', 'ttl'])
    assert.equal(result.config[key], model.defaults[key]);
});

test('serialization rejects invalid numeric state instead of sharing a misleading experiment', () => {
  assert.throws(() =>
    links.serialise(
      'https://example.test',
      { scenario: 'race', design: 'atomic', config: { amount: 0 } },
      model
    )
  );
  assert.throws(() =>
    links.serialise(
      'https://example.test',
      { scenario: 'unknown', design: 'atomic', config: model.defaults },
      model
    )
  );
});
