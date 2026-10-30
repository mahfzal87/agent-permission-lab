(() => {
  'use strict';
  const { scenarios, designs, defaults, run } = PermissionLab,
    $ = (id) => document.getElementById(id);
  let scenario = 'race',
    result,
    cursor = -1,
    revealed = -1,
    timer = null,
    playing = false;
  const esc = (x) =>
    String(x).replace(
      /[&<>"']/g,
      (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
    );
  $('scenarios').innerHTML = scenarios
    .map(
      (s) =>
        `<button class="scenario" data-scenario="${s.id}" aria-pressed="false"><span>${s.tag}</span>${s.name}</button>`
    )
    .join('');
  $('design').innerHTML = Object.entries(designs)
    .map(
      ([id, d]) => `<option value="${id}" ${id === 'atomic' ? 'selected' : ''}>${d.name}</option>`
    )
    .join('');
  function config() {
    return Object.fromEntries(Object.keys(defaults).map((k) => [k, Number($(k).value)]));
  }
  function stop() {
    clearTimeout(timer);
    timer = null;
    playing = false;
    $('play').textContent = cursor >= 0 ? 'Replay experiment' : 'Run experiment';
  }
  function prepare() {
    stop();
    cursor = -1;
    revealed = -1;
    $('play').textContent = 'Run experiment';
    $('share-panel').hidden = true;
    $('share-url').value = '';
    $('share-status').textContent = '';
    $('error').textContent = '';
    try {
      result = run(scenario, $('design').value, config());
    } catch (e) {
      result = null;
      $('error').textContent = e.message;
    }
    const s = scenarios.find((x) => x.id === scenario);
    $('tag').textContent = s.tag;
    $('scenario-title').textContent = s.name;
    $('description').textContent = s.description;
    $('lesson').textContent = s.lesson;
    $('design-description').textContent = designs[$('design').value].description;
    document
      .querySelectorAll('[data-scenario]')
      .forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.scenario === scenario)));
    render();
  }
  function inspect(i) {
    cursor = i;
    revealed = Math.max(revealed, i);
    render();
  }
  function render() {
    const event = result?.trace[cursor],
      state = event?.state;
    $('progress').textContent = result
      ? `${cursor + 1} / ${result.trace.length} events`
      : 'Fix the envelope';
    $('step').disabled = !result || playing || cursor >= result.trace.length - 1;
    $('export').disabled = !result;
    $('share').disabled = !result;
    $('play').disabled = !result;
    $('trace').innerHTML = result
      ? result.trace
          .slice(0, revealed + 1)
          .map(
            (e, i) =>
              `<li data-type="${e.type}"><button data-event="${i}" aria-pressed="${i === cursor}"><time>${e.time}ms</time><span>${esc(e.message)}</span></button></li>`
          )
          .join('')
      : '';
    $('queue-state').textContent = state
      ? `${Object.keys(state.requests).length} request(s)`
      : 'No queued request';
    $('authority-state').textContent = state
      ? `Authority r${state.revision} / replica r${state.replicaRevision}`
      : 'Authority r1 / replica r1';
    $('ledger-state').textContent = state
      ? `£${state.spent} / ${state.ledger.length} write(s)`
      : '£0 written';
    $('chain-state').textContent = `Child ≤ £${state?.childLimit ?? config().limit}`;
    document.querySelectorAll('[data-lane]').forEach((n) => {
      n.classList.toggle(
        'active',
        n.dataset.lane === (event?.lane === 'authority' ? 'gate' : event?.lane)
      );
      n.classList.toggle('unsafe', event?.type === 'unsafe' && n.dataset.lane === 'ledger');
    });
    $('outcome').className = event?.violations.length
      ? 'unsafe'
      : event && cursor === result.trace.length - 1
        ? 'safe'
        : '';
    $('outcome').textContent = !event
      ? 'Choose Run experiment, or Step to inspect each event.'
      : cursor === result.trace.length - 1
        ? result.safe
          ? `Invariants preserved. £${result.spent} written across ${result.ledger.length} effect(s).`
          : `Invariant violation: ${result.violations.join(', ')}. £${result.spent} written.`
        : event.message;
    $('event-time').textContent = event
      ? `Event ${event.step} / ${event.time}ms`
      : 'Select an event';
    $('evidence').innerHTML = event
      ? event.checks.length
        ? event.checks
            .map(
              (c) =>
                `<div class="check"><span class="${c.ok ? 'pass' : 'fail'}">${c.ok ? '✓' : '×'}</span><div>${esc(c.rule)}<small>${esc(c.observed)}</small></div></div>`
            )
            .join('')
        : `<p>${esc(event.message)}</p>`
      : '<p>Every event retains a snapshot. Select a trace row to inspect the state at that moment.</p>';
    const r = state?.requests['R-001'];
    $('envelope').textContent = r
      ? JSON.stringify(
          {
            subject: r.subject,
            actor: r.actor,
            delegation: r.chain,
            action: r.action,
            resource: r.resource,
            audience: r.audience,
            amount: r.amount,
            recipient: r.recipient,
            idempotency_key: r.key,
            grant_expires_ms: config().ttl,
            captured_revision: r.capturedRevision,
            approved_intent: JSON.parse(r.approvedIntent)
          },
          null,
          2
        )
      : 'No request yet.';
  }
  $('scenarios').addEventListener('click', (e) => {
    const b = e.target.closest('[data-scenario]');
    if (b) {
      scenario = b.dataset.scenario;
      prepare();
    }
  });
  $('trace').addEventListener('click', (e) => {
    const b = e.target.closest('[data-event]');
    if (b) {
      stop();
      inspect(Number(b.dataset.event));
    }
  });
  $('design').addEventListener('change', prepare);
  Object.keys(defaults).forEach((k) =>
    $(k).addEventListener('input', () => {
      prepare();
      $('matrix').innerHTML =
        '<tr><td colspan="4">Envelope changed. Run the suite again.</td></tr>';
    })
  );
  $('reset').onclick = prepare;
  $('step').onclick = () => {
    if (result && cursor < result.trace.length - 1) inspect(cursor + 1);
  };
  $('play').onclick = () => {
    if (playing) {
      stop();
      render();
      return;
    }
    prepare();
    if (!result) return;
    playing = true;
    $('play').textContent = 'Pause';
    const tick = () => {
      inspect(cursor + 1);
      if (cursor >= result.trace.length - 1) {
        stop();
        render();
        return;
      }
      timer = setTimeout(tick, 650);
    };
    tick();
  };
  $('compare').onclick = () => {
    try {
      const cfg = config();
      $('matrix').innerHTML = scenarios
        .map(
          (s) =>
            `<tr><td>${esc(s.name)}</td>${Object.keys(designs)
              .map((d) => {
                const r = run(s.id, d, cfg);
                return `<td><button class="${r.safe ? 'pass' : 'fail'}" data-load="${s.id}:${d}">${r.safe ? 'Preserved' : 'Violated'}</button><small>£${r.spent} · ${r.ledger.length} write(s)</small></td>`;
              })
              .join('')}</tr>`
        )
        .join('');
    } catch (e) {
      $('error').textContent = e.message;
    }
  };
  $('matrix').onclick = (e) => {
    const b = e.target.closest('[data-load]');
    if (!b) return;
    [scenario, $('design').value] = b.dataset.load.split(':');
    prepare();
    inspect(result.trace.length - 1);
    $('workbench').scrollIntoView({
      behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth'
    });
  };
  $('export').onclick = () => {
    if (!result) return;
    const blob = new Blob(
        [
          JSON.stringify(
            {
              model: 'agent-permission-lab-v2',
              note: 'Synthetic deterministic simulation; not a real system trace.',
              ...result
            },
            null,
            2
          )
        ],
        { type: 'application/json' }
      ),
      url = URL.createObjectURL(blob),
      a = document.createElement('a');
    a.href = url;
    a.download = `permission-lab-${scenario}-${result.design}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  $('share').onclick = async () => {
    if (!result) return;
    const url = PermissionLabLinks.serialise(
      location.href,
      { scenario, design: $('design').value, config: config() },
      PermissionLab
    );
    $('share-panel').hidden = false;
    $('share-url').value = url;
    try {
      await navigator.clipboard.writeText(url);
      $('share-status').textContent =
        'Link copied. It restores the experiment, design and synthetic inputs.';
    } catch {
      $('share-status').textContent =
        'Select and copy the link above. It restores the same synthetic inputs.';
      $('share-url').focus();
      $('share-url').select();
    }
  };
  const linked = PermissionLabLinks.parse(location.search, PermissionLab);
  scenario = linked.scenario;
  $('design').value = linked.design;
  Object.entries(linked.config).forEach(([key, value]) => ($(key).value = value));
  prepare();
  $('link-warning').textContent = linked.warnings.join(' ');
})();
