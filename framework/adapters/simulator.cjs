'use strict';
const clone = (x) => structuredClone(x);
const fields = ['subject', 'actor', 'action', 'resource', 'audience', 'recipient'];
const same = (a, b) =>
  JSON.stringify(
    Object.keys(a)
      .sort()
      .map((k) => [k, a[k]])
  ) ===
  JSON.stringify(
    Object.keys(b)
      .sort()
      .map((k) => [k, b[k]])
  );
const capabilities = [
  'preflight',
  'authority-change',
  'queued-change',
  'approval-change',
  'multi-request',
  'logical-clock',
  'effect-observation'
];
function createAdapter({ design = 'atomic' } = {}) {
  if (!['atomic', 'cached', 'preflight', 'deny-all'].includes(design))
    throw Error('Unknown simulator design');
  let authority, requests, ledger, spent, time, effectIntents;
  function clock(at) {
    if (!Number.isSafeInteger(at) || at < time) throw Error('Invalid logical clock');
    time = at;
  }
  function stored(id) {
    const r = requests.get(id);
    if (!r) throw Error('Unknown queued request ' + id);
    return r;
  }
  function reasons(row, bind = false) {
    const r = row.request;
    const out = [];
    if (!authority.active) out.push('REVOKED');
    if (time >= authority.expiresAt) out.push('EXPIRED');
    for (const field of fields)
      if (r[field] !== authority[field]) out.push('GRANT_' + field.toUpperCase());
    if (r.childLimit > authority.limit || r.amount > r.childLimit) out.push('DELEGATION_LIMIT');
    if (bind && !same(r, row.approval.intent)) out.push('APPROVED_INTENT_CHANGED');
    return out;
  }
  function budget(row) {
    return spent + row.request.amount > authority.budget ? ['BUDGET'] : [];
  }
  return {
    metadata: {
      id: design,
      label: {
        atomic: 'Current policy, bound intent and idempotent write',
        cached: 'Vulnerable cached grant decision',
        preflight: 'Vulnerable separate preflight',
        'deny-all': 'Negative control: deny every request'
      }[design],
      kind: 'simulator',
      capabilities
    },
    async reset(input) {
      authority = clone(input.authority);
      requests = new Map();
      effectIntents = new Map();
      ledger = [];
      spent = 0;
      time = -1;
      clock(input.at);
    },
    async enqueue({ at, request, approval }) {
      clock(at);
      if (requests.has(request.id)) throw Error('Request already queued');
      const row = { request: clone(request), approval: clone(approval), accepted: false };
      const why = [...reasons(row, design === 'atomic'), ...budget(row)];
      row.accepted = why.length === 0;
      row.initial = { reasons: why, revision: authority.revision };
      requests.set(request.id, row);
      return { accepted: row.accepted, reasonCodes: why };
    },
    async preflight({ at, requestId }) {
      clock(at);
      const row = stored(requestId);
      const why =
        design === 'cached'
          ? row.initial.reasons
          : [...reasons(row, design === 'atomic'), ...budget(row)];
      row.preflight = { reasons: clone(why), revision: authority.revision };
      return { allowed: why.length === 0, reasonCodes: clone(why) };
    },
    async changeAuthority({ at, patch }) {
      clock(at);
      authority = { ...authority, ...clone(patch), revision: authority.revision + 1 };
    },
    async changeQueued({ at, requestId, patch, approval }) {
      clock(at);
      const row = stored(requestId);
      row.request = { ...row.request, ...clone(patch) };
      if (approval) row.approval = clone(approval);
    },
    async execute({ at, requestId }) {
      clock(at);
      const row = stored(requestId);
      const r = row.request;
      let why = [],
        revision = authority.revision;
      const existing = ledger.find((e) => e.key === r.key);
      if (design === 'deny-all') why = ['DENY_ALL'];
      else if (!row.accepted) why = ['ENQUEUE_REJECTED'];
      else if (design === 'cached') {
        why = clone(row.initial.reasons);
        revision = row.initial.revision;
      } else if (design === 'preflight') {
        why = clone(row.preflight?.reasons ?? [...reasons(row), ...budget(row)]);
        revision = row.preflight?.revision ?? authority.revision;
      } else {
        why = reasons(row, true);
        if (existing) {
          if (!same(r, effectIntents.get(r.key) ?? {})) why.push('IDEMPOTENCY_CONFLICT');
        } else why.push(...budget(row));
      }
      const evidence = { authorityRevision: revision, approvalRevision: row.approval.revision };
      if (why.length) return { decision: 'denied', reasonCodes: why, evidence };
      if (design === 'atomic' && existing)
        return { decision: 'duplicate', reasonCodes: ['EXISTING_EFFECT'], evidence };
      if (!effectIntents.has(r.key)) effectIntents.set(r.key, clone(r));
      ledger.push({
        effectId: 'effect-' + (ledger.length + 1),
        requestId: r.id,
        key: r.key,
        amount: r.amount,
        ...Object.fromEntries(fields.map((k) => [k, r[k]])),
        at: time,
        authorityRevision: revision,
        approvalRevision: row.approval.revision
      });
      spent += r.amount;
      return { decision: 'committed', reasonCodes: [], evidence };
    },
    async observe() {
      return clone({
        authority,
        spent,
        ledger,
        requests: [...requests.values()].map(({ request, approval, accepted }) => ({
          request,
          approval,
          accepted
        }))
      });
    },
    async dispose() {
      requests?.clear();
    }
  };
}
module.exports = { createAdapter };
