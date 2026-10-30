'use strict';
const { isDeepStrictEqual } = require('node:util');
const schema = require('./schema.cjs');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const hash = (value) => crypto.createHash('sha256').update(value).digest('hex');
const copy = (x) => structuredClone(x);
async function bounded(fn, timeoutMs, label) {
  let timer;
  try {
    return await Promise.race([
      Promise.resolve().then(fn),
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          const e = Error(label + ' exceeded ' + timeoutMs + 'ms; operation completion is unknown');
          e.code = 'TIMEOUT';
          reject(e);
        }, timeoutMs);
      })
    ]);
  } finally {
    clearTimeout(timer);
  }
}
function oracle(expected, returned, after, before) {
  const errors = [];
  if (returned.decision !== expected.decision)
    errors.push('Expected decision ' + expected.decision + ', observed ' + returned.decision);
  if (after.ledger.length !== expected.effectCount)
    errors.push('Expected ' + expected.effectCount + ' effects, observed ' + after.ledger.length);
  if (after.spent !== expected.spent)
    errors.push('Expected spent ' + expected.spent + ', observed ' + after.spent);
  if (expected.newEffect) {
    const row = after.ledger[before.ledger.length];
    for (const [key, value] of Object.entries(expected.newEffect))
      if (!row || !isDeepStrictEqual(row[key], value))
        errors.push('New effect ' + key + ' does not match fixture expectation');
  }
  return errors;
}
async function runFixture(factory, fixture, { timeoutMs = 2000, adapterOptions = {} } = {}) {
  const result = {
    fixture: fixture.id,
    title: fixture.title,
    status: 'PASS',
    failures: [],
    steps: [],
    limitations: [],
    adapter: null
  };
  let adapter;
  const call = (method, input) => bounded(() => adapter[method](input), timeoutMs, method);
  try {
    if (!Array.isArray(fixture.steps) || !fixture.steps.some((s) => s.op === 'execute'))
      throw Error('Fixture has no protected-action checks; untested success is forbidden');
    for (const step of fixture.steps)
      if (
        step.op === 'execute' &&
        (!step.expected ||
          !['committed', 'denied', 'duplicate'].includes(step.expected.decision) ||
          !Number.isSafeInteger(step.expected.effectCount) ||
          !Number.isSafeInteger(step.expected.spent))
      )
        throw Error('Every execute requires explicit independent expected outcomes');
    adapter = await bounded(() => factory(copy(adapterOptions)), timeoutMs, 'createAdapter');
    schema.instance(adapter);
    result.adapter = copy(adapter.metadata);
    const missing = fixture.requiredCapabilities.filter(
      (c) => !adapter.metadata.capabilities.includes(c)
    );
    if (missing.length) {
      result.status = 'INCONCLUSIVE';
      result.limitations.push('Unsupported capabilities: ' + missing.join(', '));
      return result;
    }
    await call('reset', copy(fixture.initial));
    let before = copy(schema.snapshot(await call('observe')));
    if (before.ledger.length || before.spent)
      throw Error('reset did not isolate an empty effect ledger');
    const expectedRequests = new Map();
    let expectedAuthority = copy(fixture.initial.authority);
    for (const [key, value] of Object.entries(expectedAuthority))
      if (!isDeepStrictEqual(before.authority[key], value))
        throw Error('reset authority differs from fixture: ' + key);
    result.initial = before;
    for (const step of fixture.steps) {
      const row = { op: step.op, input: copy(step.input), before: copy(before) };
      result.steps.push(row);
      const returned = await call(step.op, copy(step.input));
      schema.result(step.op, returned);
      row.returned = returned === undefined ? null : copy(returned);
      const after = copy(schema.snapshot(await call('observe')));
      row.after = after;
      schema.transition(step.op, before, after, returned);
      if (step.op === 'enqueue')
        expectedRequests.set(step.input.request.id, {
          request: copy(step.input.request),
          approval: copy(step.input.approval),
          accepted: returned.accepted
        });
      if (step.op === 'changeQueued') {
        const q = expectedRequests.get(step.input.requestId);
        if (!q) throw Error('Fixture edits an unknown queued request');
        q.request = { ...q.request, ...copy(step.input.patch) };
        if (step.input.approval) q.approval = copy(step.input.approval);
      }
      if (after.requests.length !== expectedRequests.size)
        throw Error('Observed queue count differs from completed fixture operations');
      for (const observed of after.requests) {
        const expected = expectedRequests.get(observed.request.id);
        if (
          !expected ||
          !isDeepStrictEqual(observed.request, expected.request) ||
          !isDeepStrictEqual(observed.approval, expected.approval) ||
          observed.accepted !== expected.accepted
        )
          throw Error(
            'Observed queued request/approval differs from trusted fixture: ' + observed.request.id
          );
      }
      if (step.op === 'changeAuthority')
        expectedAuthority = {
          ...expectedAuthority,
          ...copy(step.input.patch),
          revision: expectedAuthority.revision + 1
        };
      for (const [key, value] of Object.entries(expectedAuthority))
        if (!isDeepStrictEqual(after.authority[key], value))
          throw Error('Authoritative state differs from completed operation: ' + key);
      if (step.op === 'execute') {
        const approved = expectedRequests.get(step.input.requestId);
        if (
          returned.evidence.authorityRevision !== expectedAuthority.revision ||
          returned.evidence.approvalRevision !== approved.approval.revision
        )
          throw Error(
            'Returned decision evidence does not match current fixture authority and approval revisions'
          );
      }
      if (step.op === 'execute' && returned.decision === 'committed') {
        const effect = after.ledger[before.ledger.length];
        const approved = expectedRequests.get(step.input.requestId);
        for (const k of [
          'key',
          'subject',
          'actor',
          'action',
          'resource',
          'audience',
          'recipient',
          'amount'
        ])
          if (!isDeepStrictEqual(effect[k], approved.request[k]))
            throw Error('Committed effect differs from requested ' + k);
        if (
          effect.requestId !== step.input.requestId ||
          effect.at !== step.input.at ||
          effect.authorityRevision !== expectedAuthority.revision ||
          effect.approvalRevision !== approved.approval.revision
        )
          throw Error('Committed effect provenance does not match fixture context');
      }
      if (step.expected) {
        row.expected = copy(step.expected);
        const issues = oracle(step.expected, returned, after, before);
        row.failures = issues;
        result.failures.push(...issues.map((e) => step.op + ' at ' + step.input.at + ': ' + e));
      }
      before = after;
    }
    if (result.failures.length) result.status = 'FAIL';
  } catch (error) {
    result.status =
      error.code === 'UNSUPPORTED' && !result.failures.length ? 'INCONCLUSIVE' : 'FAIL';
    const message = String(error.message || error);
    (result.status === 'INCONCLUSIVE' ? result.limitations : result.failures).push(message);
  } finally {
    if (adapter && typeof adapter.dispose === 'function') {
      try {
        await bounded(() => adapter.dispose(), timeoutMs, 'dispose');
      } catch (e) {
        result.status = 'FAIL';
        result.failures.push('Cleanup failed: ' + String(e.message || e));
      }
    }
  }
  return result;
}
async function runSuite(factory, fixtures, options = {}) {
  if (!fixtures.length) throw Error('No fixtures selected');
  const results = [];
  for (const fixture of fixtures) results.push(await runFixture(factory, fixture, options));
  const summary = { pass: 0, fail: 0, inconclusive: 0, total: results.length };
  for (const r of results) summary[r.status.toLowerCase()]++;
  const exitCode = summary.fail ? 1 : summary.inconclusive ? 2 : 0;
  return {
    schemaVersion: 1,
    frameworkVersion: require('../package.json').version,
    environment: { node: process.version, platform: process.platform, arch: process.arch },
    provenance: {
      sourceHashes: Object.fromEntries(
        ['fixtures.cjs', 'runner.cjs', 'schema.cjs'].map((name) => [
          name,
          hash(fs.readFileSync(path.join(__dirname, name)))
        ])
      ),
      selectedFixtureHashes: Object.fromEntries(
        fixtures.map((f) => [f.id, hash(JSON.stringify(f))])
      ),
      timeoutMs: options.timeoutMs ?? 2000
    },
    framework: 'Agent Permission Lab conformance exercises',
    generatedAt: new Date().toISOString(),
    scope:
      'Bounded fixture observations. Not a security certification, production guarantee or proof of protocol compliance.',
    summary,
    exitCode,
    results
  };
}
module.exports = { runFixture, runSuite, oracle, bounded };
