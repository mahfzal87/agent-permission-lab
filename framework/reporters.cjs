'use strict';
const xml = (s) =>
  String(s)
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
    .replace(
      /[&<>"']/g,
      (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]
    );
const md = (s) =>
  String(s)
    .replace(/[<>]/g, (c) => (c === '<' ? '&lt;' : '&gt;'))
    .replace(/\|/g, '\\|')
    .replace(/[\r\n]+/g, ' ');
function render(report, format = 'json') {
  if (format === 'json') return JSON.stringify(report, null, 2) + '\n';
  if (format === 'junit') {
    const rows = report.results.map((r) => {
      let text = '';
      if (r.status === 'FAIL')
        text =
          '<failure message="' +
          xml(r.failures[0] || 'Fixture failed') +
          '">' +
          xml(r.failures.join('\n')) +
          '</failure>';
      if (r.status === 'INCONCLUSIVE')
        text = '<skipped message="' + xml(r.limitations.join('; ')) + '"/>';
      return (
        '<testcase classname="' +
        xml(r.adapter?.id || 'adapter') +
        '" name="' +
        xml(r.fixture) +
        '">' +
        text +
        '</testcase>'
      );
    });
    return (
      '<?xml version="1.0" encoding="UTF-8"?>\n<testsuite name="Agent Permission Lab" tests="' +
      report.summary.total +
      '" failures="' +
      report.summary.fail +
      '" skipped="' +
      report.summary.inconclusive +
      '">\n<properties><property name="scope" value="' +
      xml(report.scope) +
      '"/><property name="node" value="' +
      xml(report.environment?.node || 'unknown') +
      '"/><property name="platform" value="' +
      xml(report.environment?.platform || 'unknown') +
      '"/><property name="fixture_catalogue_sha256" value="' +
      xml(report.provenance?.sourceHashes?.['fixtures.cjs'] || 'unknown') +
      '"/></properties>\n' +
      rows.join('\n') +
      '\n</testsuite>\n'
    );
  }
  if (format === 'md') {
    const lines = [
      '# Agent Permission Lab results',
      '',
      report.scope,
      '',
      `PASS: ${report.summary.pass}; FAIL: ${report.summary.fail}; INCONCLUSIVE: ${report.summary.inconclusive}. Exit code: ${report.exitCode}.`,
      '',
      '| Fixture | Adapter kind | Result | Evidence |',
      '|---|---|---|---|'
    ];
    for (const r of report.results)
      lines.push(
        `| ${md(r.fixture)} | ${md(r.adapter?.kind || 'unknown')} | ${r.status} | ${md([...r.failures, ...r.limitations].join('; ') || 'All expected observations matched')} |`
      );
    lines.push(
      '',
      `Environment: Node ${report.environment?.node || 'unknown'}, ${report.environment?.platform || 'unknown'} ${report.environment?.arch || ''}.`,
      `Fixture catalogue SHA-256: ${report.provenance?.sourceHashes?.['fixtures.cjs'] || 'unknown'}.`,
      '',
      'JSON reports contain before/after authoritative snapshots and returned decisions. Passing these fixtures is not certification or proof of untested behaviour.',
      ''
    );
    return lines.join('\n');
  }
  throw Error('Unknown report format ' + format);
}
module.exports = { render };
