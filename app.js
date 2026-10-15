(() => {
  'use strict';
  const el = id => document.getElementById(id);
  let queued = false, revoked = false, done = false, running = false;
  let timers = [];
  function log(message) {
    const item = document.createElement('li');
    item.textContent = message;
    el('log').append(item);
  }
  function highlight(id, state = 'active') {
    document.querySelectorAll('.node').forEach(node => node.classList.remove('active', 'blocked'));
    el(id).parentElement.classList.add(state);
  }
  function controls() {
    el('queue').disabled = running || queued;
    el('revoke').disabled = running || !queued || revoked || done;
    el('commit').disabled = running || !queued || done;
    el('run').disabled = running;
    el('run').textContent = running ? 'Scenario running…' : done ? 'Run again' : 'Run full scenario';
  }
  function reset() {
    timers.forEach(clearTimeout);
    timers = [];
    queued = revoked = done = running = false;
    el('agent').textContent = 'Ready to request refund';
    el('authority').textContent = 'Active · version 1';
    el('ledger').textContent = 'No side effect';
    el('result').textContent = 'Run the full scenario, or use the three steps below.';
    el('result').style.background = '#d6eeee';
    el('hint').textContent = 'Start with Queue refund. Revoke and Commit become available after a request is queued.';
    el('log').replaceChildren();
    document.querySelectorAll('.node').forEach(node => node.classList.remove('active', 'blocked'));
    controls();
  }
  function queue() {
    if (queued) return;
    queued = true;
    el('agent').textContent = '£40 refund queued';
    el('result').textContent = 'Approval captured at version 1. The money has not moved.';
    el('hint').textContent = 'Next: revoke authority to test a stale approval, or commit now to test valid authority.';
    highlight('agent');
    log('Queued refund R-001 under authority version 1. No ledger write.');
    controls();
  }
  function revoke() {
    if (!queued || revoked || done) return;
    revoked = true;
    el('authority').textContent = 'Revoked · version 2';
    el('result').textContent = 'Authority changed. The queued request still carries version 1.';
    el('hint').textContent = 'Next: attempt the commit. Will the backend trust the stale approval?';
    highlight('authority', 'blocked');
    log('Authority revoked: current version is 2.');
    controls();
  }
  function commit() {
    if (!queued || done) return;
    done = true;
    const deny = revoked && el('mode').value === 'boundary';
    el('agent').textContent = deny ? 'Request blocked' : 'Request completed';
    el('ledger').textContent = deny ? 'No side effect' : '£40 refund committed';
    el('result').textContent = deny ? 'Blocked. Stale approval did not become a payment.' : revoked ? 'Failure: £40 committed after authority was revoked.' : 'Allowed. Authority was still active at commit.';
    el('result').style.background = revoked && !deny ? '#f4dce1' : '#d6eeee';
    el('hint').textContent = 'Change the strategy above to compare, or choose Run again. Reset starts a fresh manual test.';
    highlight('ledger', revoked && !deny ? 'blocked' : 'active');
    log(deny ? 'Denied R-001: captured version 1 differs from current version 2. Ledger unchanged.' : revoked ? 'Committed R-001 using stale version 1. This is the unsafe comparison.' : 'Committed R-001 with valid authority version 1.');
    controls();
  }
  el('queue').addEventListener('click', queue);
  el('revoke').addEventListener('click', revoke);
  el('commit').addEventListener('click', commit);
  el('reset').addEventListener('click', reset);
  el('mode').addEventListener('change', reset);
  el('run').addEventListener('click', () => {
    reset();
    running = true;
    queue();
    timers.push(setTimeout(revoke, 800));
    timers.push(setTimeout(() => { running = false; commit(); }, 1600));
  });
  reset();
})();
