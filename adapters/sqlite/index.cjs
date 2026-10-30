'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const metadata = Object.freeze({
  id: 'sqlite-transaction',
  label: 'SQLite transaction boundary',
  kind: 'database',
  capabilities: [
    'preflight',
    'authority-change',
    'queued-change',
    'approval-change',
    'multi-request',
    'logical-clock',
    'effect-observation'
  ]
});

async function createAdapter(options = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'permission-lab-sqlite-'));
  const database = path.join(directory, 'fixture.sqlite3');
  const backend = path.join(__dirname, 'backend.py');
  const python = options.python || process.env.PERMISSION_LAB_PYTHON || 'python3';
  let disposed = false;
  const children = new Set();
  function call(operation, payload = {}) {
    if (disposed) throw new Error('SQLite adapter has been disposed');
    const input = JSON.stringify({ operation, payload });
    if (Buffer.byteLength(input) > 1024 * 1024)
      throw new Error('SQLite fixture operation exceeds 1 MiB');
    return new Promise((resolve, reject) => {
      const child = spawn(python, [backend, '--database', database], {
        shell: false,
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe']
      });
      children.add(child);
      let stdout = '',
        stderr = '',
        failure = null,
        bytes = 0;
      const fail = (message) => {
        if (!failure) {
          failure = new Error(message);
          failure.code = 'SQLITE_TRANSPORT_ERROR';
        }
        child.kill('SIGTERM');
      };
      const timer = setTimeout(
        () => fail('Python SQLite operation exceeded 15000 ms; completion is unknown'),
        15000
      );
      child.stdout.setEncoding('utf8');
      child.stderr.setEncoding('utf8');
      child.stdout.on('data', (chunk) => {
        bytes += Buffer.byteLength(chunk);
        if (bytes > 4 * 1024 * 1024) fail('SQLite output exceeded 4 MiB');
        else stdout += chunk;
      });
      child.stderr.on('data', (chunk) => {
        bytes += Buffer.byteLength(chunk);
        if (bytes > 4 * 1024 * 1024) fail('SQLite output exceeded 4 MiB');
        else stderr += chunk;
      });
      child.on('error', (error) => {
        failure = new Error('Unable to run Python SQLite adapter: ' + error.message);
        failure.code = 'SQLITE_TRANSPORT_ERROR';
      });
      child.stdin.on('error', (error) => {
        if (error.code !== 'EPIPE') fail('SQLite input failed: ' + error.message);
      });
      child.on('close', (status, signal) => {
        clearTimeout(timer);
        children.delete(child);
        if (failure) {
          reject(failure);
          return;
        }
        let response;
        try {
          response = JSON.parse(stdout);
        } catch {
          const error = new Error(
            'SQLite adapter returned invalid JSON' +
              (signal ? '; process ended with ' + signal : '') +
              (stderr ? ': ' + stderr.trim() : '')
          );
          error.code = 'SQLITE_TRANSPORT_ERROR';
          reject(error);
          return;
        }
        if (status !== 0 || !response.ok) {
          const error = new Error(response.error?.message || 'SQLite subprocess failed');
          error.code = response.error?.code || 'SQLITE_ADAPTER_ERROR';
          reject(error);
          return;
        }
        resolve(response.result);
      });
      child.stdin.end(input);
    });
  }
  return {
    metadata,
    async reset(payload) {
      return call('reset', payload);
    },
    async enqueue(payload) {
      return call('enqueue', payload);
    },
    async preflight(payload) {
      return call('preflight', payload);
    },
    async changeAuthority(payload) {
      return call('changeAuthority', payload);
    },
    async changeQueued(payload) {
      return call('changeQueued', payload);
    },
    async execute(payload) {
      return call('execute', payload);
    },
    async observe() {
      return call('observe');
    },
    async dispose() {
      if (!disposed) {
        disposed = true;
        await Promise.all(
          [...children].map(
            (child) =>
              new Promise((resolve) => {
                if (child.exitCode !== null || child.signalCode !== null) {
                  resolve();
                  return;
                }
                child.once('close', resolve);
                child.kill('SIGTERM');
              })
          )
        );
        fs.rmSync(directory, { recursive: true, force: true });
      }
    }
  };
}

module.exports = { createAdapter, metadata };
