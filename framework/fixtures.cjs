'use strict';
const clone = (x) => structuredClone(x);
const authority = {
  id: 'grant-1',
  revision: 1,
  active: true,
  expiresAt: 1000,
  limit: 100,
  budget: 120,
  subject: 'user:amina',
  actor: 'agent:refund-worker',
  action: 'refund:create',
  resource: 'order:1042',
  audience: 'payments-api',
  recipient: 'customer:1042'
};
const request = {
  id: 'R-001',
  key: 'intent-1',
  subject: 'user:amina',
  actor: 'agent:refund-worker',
  action: 'refund:create',
  resource: 'order:1042',
  audience: 'payments-api',
  recipient: 'customer:1042',
  amount: 40,
  childLimit: 100
};
const approval = (r = request, revision = 1) => ({ revision, intent: clone(r) });
const q = (at = 0, r = request) => ({
  op: 'enqueue',
  input: { at, request: clone(r), approval: approval(r) }
});
const p = (at = 80, id = 'R-001') => ({ op: 'preflight', input: { at, requestId: id } });
const auth = (at, patch) => ({ op: 'changeAuthority', input: { at, patch } });
const change = (at, patch, newApproval) => ({
  op: 'changeQueued',
  input: {
    at,
    requestId: 'R-001',
    patch,
    ...(newApproval ? { approval: approval({ ...request, ...patch }, 2) } : {})
  }
});
const x = (at, decision, count, spent, id = 'R-001', amount = 40, recipient = 'customer:1042') => ({
  op: 'execute',
  input: { at, requestId: id },
  expected: {
    decision,
    effectCount: count,
    spent,
    ...(decision === 'committed' ? { newEffect: { requestId: id, amount, recipient } } : {})
  }
});
function fixture(id, title, steps, overrides = {}) {
  const capabilities = ['logical-clock', 'effect-observation'];
  for (const step of steps) {
    const cap = {
      preflight: 'preflight',
      changeAuthority: 'authority-change',
      changeQueued: 'queued-change'
    }[step.op];
    if (cap && !capabilities.includes(cap)) capabilities.push(cap);
    if (
      step.input.approval &&
      step.op === 'changeQueued' &&
      !capabilities.includes('approval-change')
    )
      capabilities.push('approval-change');
  }
  if (steps.filter((s) => s.op === 'enqueue').length > 1) capabilities.push('multi-request');
  return {
    id,
    title,
    description:
      'Controlled logical-time fixture. Expected outcomes are explicit observations, not the adapter policy function.',
    requiredCapabilities: capabilities,
    initial: { at: 0, authority: { ...authority, ...overrides } },
    steps
  };
}
const r2 = { ...request, id: 'R-002', key: 'intent-2' };
const fixtures = [
  fixture('valid-control', 'Unchanged valid work must complete', [q(), x(100, 'committed', 1, 40)]),
  fixture('queued-revocation', 'Revocation commits before queued execution', [
    q(),
    auth(30, { active: false }),
    x(100, 'denied', 0, 0)
  ]),
  fixture('retry-after-denial', 'Redelivery does not restore revoked authority', [
    q(),
    auth(30, { active: false }),
    x(100, 'denied', 0, 0),
    x(200, 'denied', 0, 0)
  ]),
  fixture('restore-and-retry', 'Explicit restoration permits unchanged approved retry', [
    q(),
    auth(30, { active: false }),
    x(100, 'denied', 0, 0),
    auth(120, { active: true }),
    x(200, 'committed', 1, 40),
    x(250, 'duplicate', 1, 40)
  ]),
  fixture('changed-amount', 'Changing an approved amount needs another approval', [
    q(),
    change(30, { amount: 60 }),
    x(100, 'denied', 0, 0)
  ]),
  fixture('changed-recipient', 'Changing a recipient needs another approval', [
    q(),
    change(30, { recipient: 'customer:other' }),
    x(100, 'denied', 0, 0)
  ]),
  fixture('fresh-approval-amount', 'New exact approval permits an in-grant amount change', [
    q(),
    change(30, { amount: 60 }, true),
    x(100, 'committed', 1, 60, 'R-001', 60)
  ]),
  fixture('fresh-approval-recipient', 'New approval cannot widen the grant recipient', [
    q(),
    change(30, { recipient: 'customer:other' }, true),
    x(100, 'denied', 0, 0)
  ]),
  fixture('fresh-grant-and-approval', 'New grant and approval can permit another recipient', [
    q(),
    auth(20, { recipient: 'customer:other' }),
    change(30, { recipient: 'customer:other' }, true),
    x(100, 'committed', 1, 40, 'R-001', 40, 'customer:other')
  ]),
  fixture('expiry', 'Authority is invalid at the exact expiry boundary', [
    q(),
    x(1000, 'denied', 0, 0)
  ]),
  fixture('audience', 'A fresh approval cannot widen the authorised audience', [
    q(),
    change(30, { audience: 'analytics-api' }, true),
    x(100, 'denied', 0, 0)
  ]),
  fixture('delegation', 'A child grant cannot exceed its parent', [
    q(0, { ...request, childLimit: 120 }),
    x(100, 'denied', 0, 0)
  ]),
  fixture('replay', 'Repeated delivery creates no second protected effect', [
    q(),
    x(100, 'committed', 1, 40),
    x(200, 'duplicate', 1, 40)
  ]),
  fixture(
    'changed-replay-intent',
    'A reused effect key cannot be assigned a new approved payload',
    [q(), x(100, 'committed', 1, 40), change(130, { amount: 60 }, true), x(200, 'denied', 1, 40)]
  ),
  fixture(
    'shared-budget',
    'Two queued requests share one authoritative budget',
    [
      q(),
      q(10, r2),
      p(80),
      p(85, 'R-002'),
      x(100, 'committed', 1, 40),
      x(110, 'denied', 1, 40, 'R-002')
    ],
    { budget: 60 }
  ),
  fixture('check-write-race', 'Revocation between preflight and write is effective', [
    q(),
    p(),
    auth(90, { active: false }),
    x(100, 'denied', 0, 0)
  ]),
  fixture('revoked-after-success', 'Revoked retry is denied before returning a prior result', [
    q(),
    x(100, 'committed', 1, 40),
    auth(120, { active: false }),
    x(200, 'denied', 1, 40)
  ]),
  fixture('restored-but-expired', 'Restoration does not extend grant lifetime', [
    q(),
    auth(30, { active: false }),
    x(100, 'denied', 0, 0),
    auth(1100, { active: true }),
    x(1300, 'denied', 0, 0)
  ])
];
module.exports = { fixtures, authority, request, approval };
