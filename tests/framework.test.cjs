'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { fixtures } = require('../framework/fixtures.cjs');
const { createAdapter } = require('../framework/adapters/simulator.cjs');
const { runSuite, runFixture } = require('../framework/runner.cjs');
const { render } = require('../framework/reporters.cjs');
const root = path.resolve(__dirname, '..');
const fixture = (id) => fixtures.find((f) => f.id === id);
const factory = (design) => () => createAdapter({ design });
function wrap(change) {
  return () => {
    const adapter = createAdapter();
    change(adapter);
    return adapter;
  };
}
function cli(args) {
  return spawnSync(process.execPath, ['bin/permission-lab.cjs', ...args], {
    cwd: root,
    encoding: 'utf8',
    timeout: 5000
  });
}
test('all current-policy fixtures execute and expose before/after evidence', async () => {
  const report = await runSuite(factory('atomic'), fixtures);
  assert.deepEqual(report.summary, { pass: 18, fail: 0, inconclusive: 0, total: 18 });
  for (const r of report.results) {
    assert.ok(r.initial);
    assert.ok(r.steps.some((s) => s.op === 'execute' && s.expected));
    for (const step of r.steps) {
      assert.ok(step.before);
      assert.ok(step.after);
    }
  }
});
test('positive control rejects a deny-everything adapter', async () => {
  const r = await runFixture(factory('deny-all'), fixture('valid-control'));
  assert.equal(r.status, 'FAIL');
  assert.ok(r.failures.some((s) => s.includes('Expected decision committed')));
});
test('cached and separate preflight fail the post-check revocation fixture', async () => {
  for (const design of ['cached', 'preflight']) {
    const r = await runFixture(factory(design), fixture('check-write-race'));
    assert.equal(r.status, 'FAIL', design);
    assert.equal(r.steps.at(-1).after.ledger.length, 1);
  }
});
test('atomic restore accepts an unchanged explicit retry, not an extra effect', async () => {
  const r = await runFixture(factory('atomic'), fixture('restore-and-retry'));
  assert.equal(r.status, 'PASS');
  assert.deepEqual(
    r.steps.filter((s) => s.op === 'execute').map((s) => s.returned.decision),
    ['denied', 'committed', 'duplicate']
  );
  assert.equal(r.steps.at(-1).after.spent, 40);
});
test('changing a committed intent does not defeat the original effect key', async () => {
  const r = await runFixture(factory('atomic'), fixture('changed-replay-intent'));
  assert.equal(r.status, 'PASS');
  assert.equal(r.steps.at(-1).returned.decision, 'denied');
  assert.equal(r.steps.at(-1).after.ledger[0].amount, 40);
});
test('new approval alone cannot expand recipient authority', async () => {
  const rejected = await runFixture(factory('atomic'), fixture('fresh-approval-recipient'));
  const permitted = await runFixture(factory('atomic'), fixture('fresh-grant-and-approval'));
  assert.equal(rejected.status, 'PASS');
  assert.equal(rejected.steps.at(-1).after.ledger.length, 0);
  assert.equal(permitted.status, 'PASS');
  assert.equal(permitted.steps.at(-1).after.ledger[0].recipient, 'customer:other');
});
test('reported commitment without an effect fails observation', async () => {
  const r = await runFixture(
    wrap((a) => {
      a.execute = async () => ({
        decision: 'committed',
        reasonCodes: [],
        evidence: { authorityRevision: 1, approvalRevision: 1 }
      });
    }),
    fixture('valid-control')
  );
  assert.equal(r.status, 'FAIL');
  assert.match(r.failures.join(' '), /effect delta/);
});
test('missing ledger or decision fields never pass', async () => {
  for (const change of [
    (a) => {
      const observe = a.observe;
      a.observe = async () => {
        const s = await observe();
        delete s.ledger;
        return s;
      };
    },
    (a) => {
      a.execute = async () => ({});
    }
  ]) {
    const r = await runFixture(wrap(change), fixture('valid-control'));
    assert.equal(r.status, 'FAIL');
    assert.match(r.failures.join(' '), /Invalid evidence/);
  }
});
test('wrong effect bindings or provenance fail even with correct amount', async () => {
  for (const field of ['actor', 'audience', 'resource', 'authorityRevision', 'approvalRevision']) {
    const r = await runFixture(
      wrap((a) => {
        const observe = a.observe;
        a.observe = async () => {
          const s = await observe();
          if (s.ledger[0]) s.ledger[0][field] = field.endsWith('Revision') ? 99 : 'wrong';
          return s;
        };
      }),
      fixture('valid-control')
    );
    assert.equal(r.status, 'FAIL', field);
    assert.match(r.failures.join(' '), /Committed effect/);
  }
});
test('an adapter cannot secretly replace the trusted queued approval', async () => {
  const r = await runFixture(
    wrap((a) => {
      const change = a.changeQueued;
      a.changeQueued = async (i) =>
        change({
          ...i,
          approval: {
            revision: 2,
            intent: { ...fixture('valid-control').steps[0].input.request, ...i.patch }
          }
        });
    }),
    fixture('changed-amount')
  );
  assert.equal(r.status, 'FAIL');
  assert.match(r.failures.join(' '), /queued request\/approval/);
});
test('unsupported capability is inconclusive and exits 2', async () => {
  const r = await runSuite(
    wrap((a) => {
      a.metadata.capabilities = a.metadata.capabilities.filter((c) => c !== 'authority-change');
    }),
    [fixture('queued-revocation')]
  );
  assert.equal(r.results[0].status, 'INCONCLUSIVE');
  assert.equal(r.summary.pass, 0);
  assert.equal(r.exitCode, 2);
});
test('explicit unsupported operation is inconclusive, other crashes fail', async () => {
  for (const code of ['UNSUPPORTED', 'BROKEN']) {
    const r = await runFixture(
      wrap((a) => {
        a.execute = async () => {
          const e = Error('backend unavailable');
          e.code = code;
          throw e;
        };
      }),
      fixture('valid-control')
    );
    assert.equal(r.status, code === 'UNSUPPORTED' ? 'INCONCLUSIVE' : 'FAIL');
  }
});
test('bounded async operation timeout fails and still calls dispose', async () => {
  let disposed = false;
  const r = await runFixture(
    wrap((a) => {
      a.execute = () => new Promise(() => {});
      a.dispose = async () => {
        disposed = true;
      };
    }),
    fixture('valid-control'),
    { timeoutMs: 20 }
  );
  assert.equal(r.status, 'FAIL');
  assert.match(r.failures.join(' '), /completion is unknown/);
  assert.equal(disposed, true);
});
test('empty or unchecked fixture cannot produce an untested success', async () => {
  const empty = { ...fixture('valid-control'), steps: [] };
  assert.equal((await runFixture(factory('atomic'), empty)).status, 'FAIL');
  const unchecked = structuredClone(fixture('valid-control'));
  delete unchecked.steps.at(-1).expected;
  assert.equal((await runFixture(factory('atomic'), unchecked)).status, 'FAIL');
  await assert.rejects(() => runSuite(factory('atomic'), []), /No fixtures/);
});
test('cleanup failure prevents a pass', async () => {
  const r = await runFixture(
    wrap((a) => {
      a.dispose = async () => {
        throw Error('worker still running');
      };
    }),
    fixture('valid-control')
  );
  assert.equal(r.status, 'FAIL');
  assert.match(r.failures.join(' '), /Cleanup failed/);
});
test('reporters preserve failures and label unsupported cases as skipped', async () => {
  const r = await runSuite(factory('deny-all'), [fixture('valid-control')]);
  r.results[0].failures.push('<bad & "quoted">');
  const xml = render(r, 'junit');
  assert.match(xml, /failures="1"/);
  assert.match(xml, /&lt;bad &amp; &quot;quoted&quot;&gt;/);
  assert.doesNotMatch(xml, /<bad/);
  assert.match(render(r, 'md'), /FAIL/);
  const skipped = await runSuite(
    wrap((a) => {
      a.metadata.capabilities = [];
    }),
    [fixture('valid-control')]
  );
  assert.match(render(skipped, 'junit'), /<skipped/);
});
test('CLI list and custom module run use real catalogue and module contract', () => {
  const listed = cli(['list']);
  assert.equal(listed.status, 0);
  assert.equal(JSON.parse(listed.stdout).fixtures.length, 18);
  const r = cli([
    'run',
    '--adapter',
    './examples/custom-adapter.cjs',
    '--fixture',
    'valid-control'
  ]);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(JSON.parse(r.stdout).results[0].adapter.id, 'example-custom-simulator');
});
test('CLI unsafe failure returns 1; unknown fixture and malformed module return 2', () => {
  assert.equal(cli(['run', '--adapter', 'deny-all', '--fixture', 'valid-control']).status, 1);
  const invalid = cli(['run', '--fixture', 'not-real']);
  assert.equal(invalid.status, 2);
  assert.equal(JSON.parse(invalid.stderr).status, 'INVALID');
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'permission-module-'));
  try {
    const file = path.join(temp, 'bad.cjs');
    fs.writeFileSync(file, 'module.exports={}');
    assert.equal(cli(['run', '--adapter', file]).status, 2);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});
test('CLI writes only the explicitly requested report path', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'permission-report-'));
  try {
    const file = path.join(temp, 'report.xml');
    const r = cli(['run', '--fixture', 'valid-control', '--format', 'junit', '--output', file]);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout, '');
    assert.match(fs.readFileSync(file, 'utf8'), /<testcase/);
    assert.deepEqual(fs.readdirSync(temp), ['report.xml']);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test('returned execution evidence must match trusted current revisions', async () => {
  for (const id of ['valid-control', 'queued-revocation', 'replay']) {
    const r = await runFixture(
      wrap((a) => {
        const execute = a.execute;
        a.execute = async (input) => ({
          ...(await execute(input)),
          evidence: { authorityRevision: 999, approvalRevision: 999 }
        });
      }),
      fixture(id)
    );
    assert.equal(r.status, 'FAIL', id);
    assert.match(r.failures.join(' '), /Returned decision evidence/);
  }
});
test('later unsupported operation cannot hide an earlier observed failure', async () => {
  const report = await runSuite(
    wrap((a) => {
      let calls = 0;
      const execute = a.execute;
      a.execute = async (input) => {
        calls++;
        if (calls === 2) {
          const e = Error('later operation unsupported');
          e.code = 'UNSUPPORTED';
          throw e;
        }
        const returned = await execute(input);
        return { ...returned, decision: 'duplicate' };
      };
    }),
    [fixture('restore-and-retry')]
  );
  assert.equal(report.exitCode, 1);
  assert.equal(report.results[0].status, 'FAIL');
  assert.ok(report.results[0].failures.some((s) => s.includes('Expected decision denied')));
  assert.match(render(report, 'junit'), /<failure /);
  assert.doesNotMatch(render(report, 'junit'), /<skipped/);
});
test('optional preflight does not exclude adapters from unrelated fixtures', async () => {
  const noPreflight = wrap((a) => {
    delete a.preflight;
    a.metadata.capabilities = a.metadata.capabilities.filter((c) => c !== 'preflight');
  });
  const ordinary = fixtures.filter((f) => !['check-write-race', 'shared-budget'].includes(f.id));
  const report = await runSuite(noPreflight, ordinary);
  assert.equal(report.summary.pass, 16);
  assert.equal(report.exitCode, 0);
  for (const id of ['check-write-race', 'shared-budget'])
    assert.equal((await runFixture(noPreflight, fixture(id))).status, 'INCONCLUSIVE');
});
test('expiry fixture executes at the exclusive boundary', async () => {
  const f = fixture('expiry');
  assert.equal(f.steps.at(-1).input.at, f.initial.authority.expiresAt);
  const r = await runFixture(
    wrap((a) => {
      const execute = a.execute;
      a.execute = async (input) => execute({ ...input, at: input.at - 1 });
    }),
    f
  );
  assert.equal(r.status, 'FAIL');
});
test('CLI advertises sqlite and reports reproducible safe provenance', () => {
  const catalog = JSON.parse(cli(['list']).stdout);
  assert.ok(catalog.adapters.includes('sqlite'));
  const result = cli(['run', '--fixture', 'valid-control']);
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.environment.node, process.version);
  assert.match(report.provenance.sourceHashes['fixtures.cjs'], /^[a-f0-9]{64}$/);
  assert.match(report.provenance.selectedFixtureHashes['valid-control'], /^[a-f0-9]{64}$/);
  assert.match(report.provenance.adapterEntry.sha256, /^[a-f0-9]{64}$/);
  assert.doesNotMatch(JSON.stringify(report.provenance), /\/Users\/|\/private\//);
});

test('audience fixture isolates authorisation from approved intent binding', async () => {
  const fixtureCase = fixture('audience');
  const edit = fixtureCase.steps.find((s) => s.op === 'changeQueued');
  assert.equal(edit.input.approval.intent.audience, 'analytics-api');
  assert.equal(fixtureCase.initial.authority.audience, 'payments-api');
  const vm = require('node:vm');
  const filename = path.join(root, 'framework/adapters/simulator.cjs');
  const source = fs.readFileSync(filename, 'utf8');
  const marker = /for\s*\(\s*const\s+field\s+of\s+fields\s*\)/;
  assert.match(source, marker);
  const mutant = source.replace(marker, "for (const field of fields.filter(k => k !== 'audience'))");
  const module = { exports: {} };
  vm.runInNewContext(
    mutant,
    { module, exports: module.exports, structuredClone },
    { filename: 'audience-check-disabled-mutant.cjs' }
  );
  const result = await runFixture(() => module.exports.createAdapter(), fixtureCase);
  assert.equal(result.status, 'FAIL');
  assert.match(result.failures.join(' '), /Expected decision denied/);
  assert.equal(result.steps.at(-1).after.ledger.length, 1);
});
