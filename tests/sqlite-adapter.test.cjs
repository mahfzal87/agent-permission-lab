'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { createAdapter } = require('../adapters/sqlite/index.cjs');
const clone = (x) => JSON.parse(JSON.stringify(x));
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
async function fixture(fn, initial = {}) {
  const adapter = await createAdapter();
  try {
    await adapter.reset({ at: 0, authority: { ...authority, ...initial } });
    await fn(adapter);
  } finally {
    await adapter.dispose();
  }
}
const enqueue = (a, r = request) =>
  a.enqueue({ at: 0, request: clone(r), approval: { revision: 1, intent: clone(r) } });

test('SQLite positive control commits one observed protected row and deduplicates replay', async () =>
  fixture(async (a) => {
    assert.equal((await enqueue(a)).accepted, true);
    assert.equal((await a.execute({ at: 100, requestId: request.id })).decision, 'committed');
    assert.equal((await a.execute({ at: 101, requestId: request.id })).decision, 'duplicate');
    const observed = await a.observe();
    assert.equal(observed.spent, 40);
    assert.equal(observed.ledger.length, 1);
    assert.deepEqual(observed.ledger[0], {
      effectId: 'effect-1',
      requestId: 'R-001',
      key: 'intent-1',
      amount: 40,
      subject: request.subject,
      actor: request.actor,
      action: request.action,
      resource: request.resource,
      audience: request.audience,
      recipient: request.recipient,
      at: 100,
      authorityRevision: 1,
      approvalRevision: 1
    });
  }));
test('SQLite checks revocation after an allowed preflight and again on retry', async () =>
  fixture(async (a) => {
    await enqueue(a);
    assert.equal((await a.preflight({ at: 10, requestId: request.id })).allowed, true);
    await a.changeAuthority({ at: 20, patch: { active: false } });
    for (const at of [30, 40]) {
      const r = await a.execute({ at, requestId: request.id });
      assert.equal(r.decision, 'denied');
      assert.ok(r.reasonCodes.includes('revoked'));
    }
    const s = await a.observe();
    assert.equal(s.authority.revision, 2);
    assert.equal(s.spent, 0);
    assert.equal(s.ledger.length, 0);
  }));
test('SQLite restoration does not write automatically; explicit retry can execute once', async () =>
  fixture(async (a) => {
    await enqueue(a);
    await a.changeAuthority({ at: 10, patch: { active: false } });
    await a.execute({ at: 20, requestId: request.id });
    await a.changeAuthority({ at: 30, patch: { active: true } });
    assert.equal((await a.observe()).ledger.length, 0);
    const r = await a.execute({ at: 40, requestId: request.id });
    assert.equal(r.decision, 'committed');
    assert.equal(r.evidence.authorityRevision, 3);
    assert.equal((await a.execute({ at: 50, requestId: request.id })).decision, 'duplicate');
    assert.equal((await a.observe()).spent, 40);
  }));
test('SQLite expiry is exclusive at commit and restoration does not extend it', async () =>
  fixture(
    async (a) => {
      await enqueue(a);
      await a.changeAuthority({ at: 10, patch: { active: false } });
      await a.changeAuthority({ at: 20, patch: { active: true } });
      const r = await a.execute({ at: 100, requestId: request.id });
      assert.equal(r.decision, 'denied');
      assert.ok(r.reasonCodes.includes('expired'));
      assert.equal((await a.observe()).ledger.length, 0);
    },
    { expiresAt: 100 }
  ));
test('SQLite identity and scope are enforced even when a changed request has fresh approval', async () => {
  for (const field of ['subject', 'actor', 'action', 'resource', 'audience', 'recipient'])
    await fixture(async (a) => {
      await enqueue(a);
      const changed = { ...request, [field]: 'different:' + field };
      await a.changeQueued({
        at: 10,
        requestId: request.id,
        patch: { [field]: changed[field] },
        approval: { revision: 2, intent: changed }
      });
      const r = await a.execute({ at: 20, requestId: request.id });
      assert.equal(r.decision, 'denied', field);
      assert.ok(r.reasonCodes.includes(field + '_mismatch'));
      assert.equal((await a.observe()).spent, 0);
    });
});
test('SQLite binds complete approval and accepts a separately revised in-scope intent', async () =>
  fixture(async (a) => {
    await enqueue(a);
    await a.changeQueued({ at: 10, requestId: request.id, patch: { amount: 60 } });
    const rejected = await a.execute({ at: 20, requestId: request.id });
    assert.ok(rejected.reasonCodes.includes('approved_intent_changed'));
    await a.changeQueued({
      at: 30,
      requestId: request.id,
      patch: {},
      approval: { revision: 2, intent: { ...request, amount: 60 } }
    });
    assert.equal((await a.execute({ at: 40, requestId: request.id })).decision, 'committed');
    const s = await a.observe();
    assert.equal(s.spent, 60);
    assert.equal(s.ledger[0].approvalRevision, 2);
  }));
test('SQLite rejects broadened child authority and an amount above the current reduced limit', async () => {
  await fixture(async (a) => {
    await enqueue(a);
    await a.changeQueued({
      at: 10,
      requestId: request.id,
      patch: { childLimit: 110 },
      approval: { revision: 2, intent: { ...request, childLimit: 110 } }
    });
    assert.ok(
      (await a.execute({ at: 20, requestId: request.id })).reasonCodes.includes(
        'delegation_widened'
      )
    );
  });
  await fixture(async (a) => {
    await enqueue(a);
    await a.changeAuthority({ at: 10, patch: { limit: 30 } });
    const r = await a.execute({ at: 20, requestId: request.id });
    assert.equal(r.decision, 'denied');
    assert.ok(r.reasonCodes.includes('amount_outside_grant'));
    assert.equal((await a.observe()).spent, 0);
  });
});
test('SQLite reserves the shared budget at the protected write, not at preflight', async () =>
  fixture(
    async (a) => {
      const second = { ...request, id: 'R-002', key: 'intent-2' };
      await enqueue(a);
      await enqueue(a, second);
      assert.equal((await a.preflight({ at: 10, requestId: request.id })).allowed, true);
      assert.equal((await a.preflight({ at: 20, requestId: second.id })).allowed, true);
      assert.equal((await a.execute({ at: 30, requestId: request.id })).decision, 'committed');
      const r = await a.execute({ at: 40, requestId: second.id });
      assert.equal(r.decision, 'denied');
      assert.ok(r.reasonCodes.includes('budget_exceeded'));
      const s = await a.observe();
      assert.equal(s.spent, 40);
      assert.equal(s.ledger.length, 1);
    },
    { budget: 60 }
  ));
test('SQLite denies conflicting idempotency-key reuse and rechecks revocation before replay', async () =>
  fixture(async (a) => {
    await enqueue(a);
    await a.execute({ at: 10, requestId: request.id });
    await a.changeQueued({
      at: 20,
      requestId: request.id,
      patch: { amount: 60 },
      approval: { revision: 2, intent: { ...request, amount: 60 } }
    });
    assert.ok(
      (await a.execute({ at: 30, requestId: request.id })).reasonCodes.includes(
        'idempotency_conflict'
      )
    );
    await a.changeQueued({
      at: 40,
      requestId: request.id,
      patch: { amount: 40 },
      approval: { revision: 3, intent: clone(request) }
    });
    await a.changeAuthority({ at: 50, patch: { active: false } });
    const r = await a.execute({ at: 60, requestId: request.id });
    assert.equal(r.decision, 'denied');
    assert.ok(r.reasonCodes.includes('revoked'));
    assert.equal((await a.observe()).ledger.length, 1);
  }));
test('SQLite instances are isolated and malformed or backwards-time operations fail without effects', async () => {
  const a = await createAdapter(),
    b = await createAdapter();
  try {
    await a.reset({ at: 0, authority: clone(authority) });
    await b.reset({ at: 0, authority: clone(authority) });
    await enqueue(a);
    await a.execute({ at: 100, requestId: request.id });
    await assert.rejects(
      () => a.changeAuthority({ at: 99, patch: { active: false } }),
      /backwards/
    );
    await assert.rejects(
      () => a.changeAuthority({ at: 110, patch: { active: 'false' } }),
      /boolean/
    );
    assert.equal((await a.observe()).authority.active, true);
    assert.equal((await a.observe()).ledger.length, 1);
    const other = await b.observe();
    assert.equal(other.ledger.length, 0);
    assert.equal(other.requests.length, 0);
    assert.equal(other.spent, 0);
  } finally {
    await a.dispose();
    await b.dispose();
  }
  await assert.rejects(() => a.observe(), /disposed/);
});
test('SQLite rejects zero grant limits and budgets and zero child limits without changing state', async () =>
  fixture(async (a) => {
    for (const field of ['limit', 'budget']) {
      await assert.rejects(
        () => a.changeAuthority({ at: 10, patch: { [field]: 0 } }),
        /safe integer at least 1/
      );
      const unchanged = await a.observe();
      assert.deepEqual(unchanged.authority, authority);
      assert.equal(unchanged.spent, 0);
      assert.equal(unchanged.ledger.length, 0);
    }
    const invalid = { ...request, childLimit: 0 };
    await assert.rejects(
      () => a.enqueue({ at: 10, request: invalid, approval: { revision: 1, intent: invalid } }),
      /safe integer at least 1/
    );
    assert.equal((await a.observe()).requests.length, 0);
    // A valid earlier logical time succeeds, proving failed operations rolled back
    // their clock advancement as well as authority, queue and protected effects.
    assert.equal(
      (
        await a.enqueue({
          at: 1,
          request: clone(request),
          approval: { revision: 1, intent: clone(request) }
        })
      ).accepted,
      true
    );
    assert.equal((await a.execute({ at: 2, requestId: request.id })).decision, 'committed');
    assert.equal((await a.observe()).spent, 40);
  }));
test('SQLite runs real independent-writer lock and concurrent-budget controls', () => {
  const child = spawnSync(
    process.env.PERMISSION_LAB_PYTHON || 'python3',
    [path.join(__dirname, 'sqlite-locking.py')],
    { encoding: 'utf8', timeout: 15000, maxBuffer: 1024 * 1024, shell: false }
  );
  assert.equal(child.status, 0, child.stderr || child.stdout);
  const report = JSON.parse(child.stdout);
  assert.equal(report.writer_lock.blocked, true);
  assert.equal(report.writer_lock.effects, 1);
  assert.equal(report.concurrent_budget.effects, 1);
  assert.equal(report.concurrent_budget.spent, 40);
  assert.deepEqual(report.concurrent_budget.decisions.sort(), ['committed', 'denied']);
  assert.equal(report.rollback.reservation_after_failure, 0);
  assert.equal(report.rollback.effects_after_failure, 0);
  assert.equal(report.rollback.explicit_retry, 'committed');
  assert.equal(report.rollback.effects_after_retry, 1);
});
