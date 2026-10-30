'use strict';
const { isDeepStrictEqual } = require('node:util');
const capabilities = [
  'preflight',
  'authority-change',
  'queued-change',
  'approval-change',
  'multi-request',
  'logical-clock',
  'effect-observation'
];
function fail(message) {
  throw Error('Invalid evidence: ' + message);
}
function object(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    fail(label + ' must be an object');
}
function text(value, label) {
  if (typeof value !== 'string' || !value.trim() || value.length > 2048)
    fail(label + ' must be a nonempty bounded string');
}
function integer(value, label, min = 0) {
  if (!Number.isSafeInteger(value) || value < min)
    fail(label + ' must be a safe integer >= ' + min);
}
function boolean(value, label) {
  if (typeof value !== 'boolean') fail(label + ' must be boolean');
}
function strings(value, label) {
  if (
    !Array.isArray(value) ||
    value.length > 100 ||
    value.some((x) => typeof x !== 'string' || x.length > 2048)
  )
    fail(label + ' must be bounded strings');
}
const identityFields = ['subject', 'actor', 'action', 'resource', 'audience', 'recipient'];
function request(r, label = 'request') {
  object(r, label);
  for (const k of ['id', 'key', ...identityFields]) text(r[k], label + '.' + k);
  integer(r.amount, label + '.amount', 1);
  integer(r.childLimit, label + '.childLimit', 1);
}
function approval(a, label = 'approval') {
  object(a, label);
  integer(a.revision, label + '.revision', 1);
  request(a.intent, label + '.intent');
}
function authority(a) {
  object(a, 'authority');
  for (const k of ['id', ...identityFields]) text(a[k], 'authority.' + k);
  for (const k of ['revision', 'limit', 'budget']) integer(a[k], 'authority.' + k, 1);
  integer(a.expiresAt, 'authority.expiresAt');
  boolean(a.active, 'authority.active');
}
function snapshot(s) {
  object(s, 'snapshot');
  authority(s.authority);
  integer(s.spent, 'spent');
  for (const k of ['ledger', 'requests'])
    if (!Array.isArray(s[k]) || s[k].length > 1000) fail(k + ' must be an array with <=1000 rows');
  const ids = new Set();
  for (const e of s.ledger) {
    object(e, 'effect');
    for (const k of ['effectId', 'requestId', 'key', ...identityFields]) text(e[k], 'effect.' + k);
    for (const k of ['amount', 'authorityRevision', 'approvalRevision'])
      integer(e[k], 'effect.' + k, 1);
    integer(e.at, 'effect.at');
    if (ids.has(e.effectId)) fail('effectId must be unique');
    ids.add(e.effectId);
  }
  const total = s.ledger.reduce((sum, e) => sum + e.amount, 0);
  if (!Number.isSafeInteger(total) || total !== s.spent)
    fail('spent must equal observed ledger sum');
  const queueIds = new Set();
  for (const row of s.requests) {
    object(row, 'queued row');
    request(row.request);
    approval(row.approval);
    boolean(row.accepted, 'accepted');
    if (queueIds.has(row.request.id)) fail('queued request IDs must be unique');
    queueIds.add(row.request.id);
  }
  return s;
}
function result(op, r) {
  if (op === 'enqueue' || op === 'preflight') {
    object(r, op + ' result');
    boolean(r[op === 'enqueue' ? 'accepted' : 'allowed'], op + ' outcome');
    strings(r.reasonCodes, 'reasonCodes');
  }
  if (op === 'execute') {
    object(r, 'execute result');
    if (!['committed', 'denied', 'duplicate'].includes(r.decision))
      fail('execute decision is required');
    strings(r.reasonCodes, 'reasonCodes');
    object(r.evidence, 'execute evidence');
    integer(r.evidence.authorityRevision, 'evidence.authorityRevision', 1);
    integer(r.evidence.approvalRevision, 'evidence.approvalRevision', 1);
  }
}
function instance(a) {
  object(a, 'adapter');
  object(a.metadata, 'metadata');
  text(a.metadata.id, 'metadata.id');
  text(a.metadata.label, 'metadata.label');
  if (!['simulator', 'database', 'integration'].includes(a.metadata.kind)) fail('metadata.kind');
  strings(a.metadata.capabilities, 'capabilities');
  for (const c of a.metadata.capabilities)
    if (!capabilities.includes(c)) fail('unknown capability ' + c);
  for (const m of ['reset', 'enqueue', 'execute', 'observe', 'dispose'])
    if (typeof a[m] !== 'function') fail('missing method ' + m);
  for (const [c, m] of [
    ['preflight', 'preflight'],
    ['authority-change', 'changeAuthority'],
    ['queued-change', 'changeQueued'],
    ['approval-change', 'changeQueued']
  ])
    if (a.metadata.capabilities.includes(c) && typeof a[m] !== 'function')
      fail('capability ' + c + ' requires ' + m);
}
function transition(op, before, after, returned) {
  if (before) {
    if (
      after.ledger.length < before.ledger.length ||
      !isDeepStrictEqual(after.ledger.slice(0, before.ledger.length), before.ledger)
    )
      fail('observed effects were removed or altered');
    const added = after.ledger.length - before.ledger.length;
    if (op !== 'execute' && added !== 0) fail('non-execute operation created a protected effect');
    if (op === 'execute') {
      const expected = returned.decision === 'committed' ? 1 : 0;
      if (added !== expected) fail('decision does not match observed effect delta');
    }
  }
}
module.exports = { snapshot, result, instance, transition, authority, request, approval };
