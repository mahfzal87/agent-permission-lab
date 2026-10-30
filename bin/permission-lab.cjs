#!/usr/bin/env node
'use strict';
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { fixtures } = require('../framework/fixtures.cjs');
const { runSuite } = require('../framework/runner.cjs');
const { render } = require('../framework/reporters.cjs');
const simulator = require('../framework/adapters/simulator.cjs');
const simulatorIds = ['atomic', 'cached', 'preflight', 'deny-all'];
const builtins = [...simulatorIds, 'sqlite'];
function parse(args) {
  const opts = {
    command: args.shift() || 'help',
    adapter: 'atomic',
    fixture: 'all',
    format: 'json',
    timeoutMs: 2000
  };
  while (args.length) {
    const key = args.shift();
    if (key === '--help') {
      opts.command = 'help';
      continue;
    }
    const names = {
      '--adapter': 'adapter',
      '--fixture': 'fixture',
      '--format': 'format',
      '--output': 'output',
      '--timeout-ms': 'timeoutMs'
    };
    if (!names[key] || !args.length || args[0].startsWith('--'))
      throw Error('Unknown option or missing value: ' + key);
    opts[names[key]] = args.shift();
  }
  if (!['json', 'junit', 'md'].includes(opts.format))
    throw Error('Format must be json, junit or md');
  opts.timeoutMs = Number(opts.timeoutMs);
  if (!Number.isSafeInteger(opts.timeoutMs) || opts.timeoutMs < 1 || opts.timeoutMs > 60000)
    throw Error('timeout-ms must be 1 to 60000');
  return opts;
}
function emit(text, output) {
  if (output && output !== '-') {
    const p = path.resolve(output);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, text);
  } else process.stdout.write(text);
}
async function main() {
  const o = parse(process.argv.slice(2));
  if (o.command === 'help') {
    process.stdout.write(
      'Agent Permission Lab\n\nnode bin/permission-lab.cjs list [--format json|md]\nnode bin/permission-lab.cjs run --adapter atomic|cached|preflight|deny-all|sqlite|./adapter.cjs --fixture all|id[,id] --format json|junit|md [--output path] [--timeout-ms 2000]\n\nExit: 0 all selected fixtures pass; 1 one or more failures; 2 invalid request or any inconclusive result without failures. Custom adapter modules execute trusted local code. Async timeouts are not a sandbox or cancellation guarantee.\n'
    );
    return;
  }
  if (o.command === 'list') {
    const catalog = {
      adapters: builtins,
      customAdapter:
        'CommonJS module exporting createAdapter(options). Example: ./examples/custom-adapter.cjs',
      sqliteAdapter: './adapters/sqlite/index.cjs (requires Python 3 with sqlite3)',
      fixtures: fixtures.map(({ id, title, requiredCapabilities }) => ({
        id,
        title,
        requiredCapabilities
      }))
    };
    if (o.format === 'junit') throw Error('JUnit applies to run, not list');
    emit(
      o.format === 'json'
        ? JSON.stringify(catalog, null, 2) + '\n'
        : '# Fixtures\n\n' + fixtures.map((f) => '- `' + f.id + '`: ' + f.title).join('\n') + '\n',
      o.output
    );
    return;
  }
  if (o.command !== 'run') throw Error('Command must be list or run');
  const ids = o.fixture === 'all' ? fixtures.map((f) => f.id) : o.fixture.split(',');
  if (!ids.length || ids.some((id) => !fixtures.some((f) => f.id === id)))
    throw Error('Unknown fixture selection: ' + o.fixture);
  if (new Set(ids).size !== ids.length) throw Error('Duplicate fixture selection');
  let factory, adapterEntry;
  if (simulatorIds.includes(o.adapter)) {
    factory = () => simulator.createAdapter({ design: o.adapter });
    adapterEntry = path.resolve(__dirname, '../framework/adapters/simulator.cjs');
  } else if (o.adapter === 'sqlite') {
    adapterEntry = path.resolve(__dirname, '../adapters/sqlite/index.cjs');
    factory = require(adapterEntry).createAdapter;
  } else {
    const modulePath = path.resolve(o.adapter);
    adapterEntry = modulePath;
    if (!fs.existsSync(modulePath) || !fs.statSync(modulePath).isFile())
      throw Error('Adapter module not found: ' + modulePath);
    const custom = require(modulePath);
    if (typeof custom.createAdapter !== 'function')
      throw Error('Adapter module must export createAdapter(options)');
    factory = custom.createAdapter;
  }
  const report = await runSuite(
    factory,
    ids.map((id) => fixtures.find((f) => f.id === id)),
    { timeoutMs: o.timeoutMs }
  );
  report.adapterSelection = builtins.includes(o.adapter) ? o.adapter : path.basename(o.adapter);
  report.provenance.adapterEntry = {
    name: builtins.includes(o.adapter) ? o.adapter : path.basename(adapterEntry),
    sha256: crypto.createHash('sha256').update(fs.readFileSync(adapterEntry)).digest('hex'),
    scope: 'Entry-file hash only; transitive custom adapter dependencies are not attested.'
  };
  emit(render(report, o.format), o.output);
  process.exitCode = report.exitCode;
}
main().catch((error) => {
  process.stderr.write(
    JSON.stringify({ status: 'INVALID', message: String(error.message || error), exitCode: 2 }) +
      '\n'
  );
  process.exitCode = 2;
});
