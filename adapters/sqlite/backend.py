"""Synthetic authority, real SQLite rows. No external service or credentials.

The protected effect is one row in this database. A supplied monotonic logical
clock models expiry; this is not a wall-clock or distributed timing guarantee.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import sqlite3
import sys

MAX_SAFE = 9007199254740991
BINDINGS = ('subject', 'actor', 'action', 'resource', 'audience', 'recipient')
AUTHORITY_KEYS = ('id', 'revision', 'active', 'expiresAt', 'limit', 'budget') + BINDINGS


def encode(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), allow_nan=False)


def fingerprint(value):
    return hashlib.sha256(encode(value).encode('utf-8')).hexdigest()


def integer(value, label, minimum=0):
    if type(value) is not int or not minimum <= value <= MAX_SAFE:
        raise ValueError(label + ' must be a safe integer at least ' + str(minimum))
    return value


def nonempty(value, label):
    if not isinstance(value, str) or not value.strip():
        raise ValueError(label + ' must be a non-empty string')
    return value


def authority_valid(authority):
    if not isinstance(authority, dict) or any(k not in authority for k in AUTHORITY_KEYS):
        raise ValueError('Authority is missing required contract fields')
    nonempty(authority['id'], 'authority.id')
    integer(authority['revision'], 'authority.revision', 1)
    if type(authority['active']) is not bool:
        raise ValueError('authority.active must be a boolean')
    for key in ('expiresAt', 'limit', 'budget'):
        integer(authority[key], 'authority.' + key, 0 if key == 'expiresAt' else 1)
    for key in BINDINGS:
        nonempty(authority[key], 'authority.' + key)


def request_valid(request):
    if not isinstance(request, dict):
        raise ValueError('request must be an object')
    for key in ('id', 'key') + BINDINGS:
        nonempty(request.get(key), 'request.' + key)
    integer(request.get('amount'), 'request.amount', 1)
    integer(request.get('childLimit'), 'request.childLimit', 1)


def approval_valid(approval):
    if not isinstance(approval, dict):
        raise ValueError('approval must be an object')
    integer(approval.get('revision'), 'approval.revision', 1)
    request_valid(approval.get('intent'))


def connect(path, timeout=5.0):
    connection = sqlite3.connect(path, isolation_level=None, timeout=timeout)
    connection.row_factory = sqlite3.Row
    connection.execute('PRAGMA foreign_keys = ON')
    return connection


def current(connection):
    row = connection.execute('SELECT document, spent FROM authority WHERE singleton=1').fetchone()
    if row is None:
        raise ValueError('Adapter must be reset before use')
    return json.loads(row['document']), row['spent']


def read_request(connection, request_id):
    row = connection.execute('SELECT * FROM requests WHERE request_id=?', (request_id,)).fetchone()
    if row is None:
        raise ValueError('Unknown requestId')
    return row, json.loads(row['document']), {'revision': row['approval_revision'], 'intent': json.loads(row['approved_intent'])}


def policy(authority, request, approval, at):
    reasons = []
    if not authority['active']:
        reasons.append('revoked')
    if at >= authority['expiresAt']:
        reasons.append('expired')
    for key in BINDINGS:
        if request[key] != authority[key]:
            reasons.append(key + '_mismatch')
    if request['childLimit'] > authority['limit']:
        reasons.append('delegation_widened')
    if request['amount'] > min(request['childLimit'], authority['limit']):
        reasons.append('amount_outside_grant')
    if fingerprint(request) != fingerprint(approval['intent']):
        reasons.append('approved_intent_changed')
    return reasons


def advance_clock(connection, at):
    integer(at, 'at')
    previous = connection.execute('SELECT logical_at FROM clock WHERE singleton=1').fetchone()[0]
    if at < previous:
        raise ValueError('Logical time cannot move backwards')
    connection.execute('UPDATE clock SET logical_at=? WHERE singleton=1', (at,))


def reset(connection, payload):
    authority = payload['authority']
    authority_valid(authority)
    at = integer(payload['at'], 'at')
    connection.executescript('''
      BEGIN IMMEDIATE;
      DROP TABLE IF EXISTS effects;
      DROP TABLE IF EXISTS requests;
      DROP TABLE IF EXISTS authority;
      DROP TABLE IF EXISTS clock;
      CREATE TABLE authority (
        singleton INTEGER PRIMARY KEY CHECK(singleton=1),
        document TEXT NOT NULL, spent INTEGER NOT NULL CHECK(spent>=0));
      CREATE TABLE clock (singleton INTEGER PRIMARY KEY CHECK(singleton=1), logical_at INTEGER NOT NULL);
      CREATE TABLE requests (
        request_id TEXT PRIMARY KEY, document TEXT NOT NULL,
        approved_intent TEXT NOT NULL, approval_revision INTEGER NOT NULL,
        accepted INTEGER NOT NULL CHECK(accepted IN (0,1)), enqueue_reasons TEXT NOT NULL);
      CREATE TABLE effects (
        sequence INTEGER PRIMARY KEY AUTOINCREMENT,
        request_id TEXT NOT NULL REFERENCES requests(request_id),
        idempotency_key TEXT NOT NULL UNIQUE,
        document TEXT NOT NULL, intent_hash TEXT NOT NULL,
        amount INTEGER NOT NULL CHECK(amount>0), logical_at INTEGER NOT NULL,
        authority_revision INTEGER NOT NULL, approval_revision INTEGER NOT NULL);
    ''')
    connection.execute('INSERT INTO authority VALUES (1,?,0)', (encode(authority),))
    connection.execute('INSERT INTO clock VALUES (1,?)', (at,))
    connection.commit()
    return None


def snapshot(connection):
    connection.execute('BEGIN')
    try:
        authority, spent = current(connection)
        requests = []
        for row in connection.execute('SELECT * FROM requests ORDER BY rowid'):
            requests.append({'request': json.loads(row['document']),
                             'approval': {'revision': row['approval_revision'], 'intent': json.loads(row['approved_intent'])},
                             'accepted': bool(row['accepted'])})
        ledger = []
        for row in connection.execute('SELECT * FROM effects ORDER BY sequence'):
            request = json.loads(row['document'])
            effect = {'effectId': 'effect-' + str(row['sequence']), 'requestId': row['request_id'],
                      'key': row['idempotency_key'], 'amount': row['amount'], 'at': row['logical_at'],
                      'authorityRevision': row['authority_revision'], 'approvalRevision': row['approval_revision']}
            effect.update({key: request[key] for key in BINDINGS})
            ledger.append(effect)
        if spent != sum(effect['amount'] for effect in ledger):
            raise ValueError('Stored budget reservation does not match committed effects')
        connection.commit()
        return {'authority': authority, 'spent': spent, 'requests': requests, 'ledger': ledger}
    except Exception:
        connection.rollback()
        raise


def operation(connection, name, payload):
    if name == 'reset':
        return reset(connection, payload)
    if name == 'observe':
        return snapshot(connection)
    connection.execute('BEGIN IMMEDIATE')
    try:
        at = payload['at']
        advance_clock(connection, at)
        authority, spent = current(connection)
        if name == 'enqueue':
            request, approval = payload['request'], payload['approval']
            request_valid(request)
            approval_valid(approval)
            reasons = policy(authority, request, approval, at)
            if spent + request['amount'] > authority['budget']:
                reasons.append('budget_exceeded')
            connection.execute('INSERT INTO requests VALUES (?,?,?,?,?,?)',
                               (request['id'], encode(request), encode(approval['intent']), approval['revision'], int(not reasons), encode(reasons)))
            result = {'accepted': not reasons, 'reasonCodes': reasons}
        elif name == 'changeAuthority':
            patch = payload['patch']
            if not isinstance(patch, dict) or set(patch) - set(AUTHORITY_KEYS) or 'revision' in patch or 'id' in patch:
                raise ValueError('Authority patch may change policy fields, not id or revision')
            authority.update(patch)
            authority['revision'] += 1
            authority_valid(authority)
            connection.execute('UPDATE authority SET document=? WHERE singleton=1', (encode(authority),))
            result = None
        elif name == 'changeQueued':
            row, request, approval = read_request(connection, payload['requestId'])
            patch = payload['patch']
            if not isinstance(patch, dict) or 'id' in patch:
                raise ValueError('Queued patch must be an object and cannot rename request id')
            request.update(patch)
            request_valid(request)
            if 'approval' in payload:
                replacement = payload['approval']
                approval_valid(replacement)
                if replacement['revision'] <= approval['revision']:
                    raise ValueError('A replacement approval requires a higher revision')
                approval = replacement
            connection.execute('UPDATE requests SET document=?, approved_intent=?, approval_revision=? WHERE request_id=?',
                               (encode(request), encode(approval['intent']), approval['revision'], payload['requestId']))
            result = None
        elif name in ('preflight', 'execute'):
            row, request, approval = read_request(connection, payload['requestId'])
            reasons = policy(authority, request, approval, at)
            if not row['accepted']:
                reasons.insert(0, 'not_accepted')
            existing = connection.execute('SELECT intent_hash FROM effects WHERE idempotency_key=?', (request['key'],)).fetchone()
            if existing is not None and existing['intent_hash'] != fingerprint(request):
                reasons.append('idempotency_conflict')
            if existing is None and spent + request['amount'] > authority['budget']:
                reasons.append('budget_exceeded')
            if name == 'preflight':
                result = {'allowed': not reasons, 'reasonCodes': reasons}
            else:
                if reasons:
                    decision = 'denied'
                elif existing is not None:
                    decision = 'duplicate'
                else:
                    # The authoritative state, reservation and protected row share
                    # this BEGIN IMMEDIATE transaction. No external effect occurs.
                    connection.execute('UPDATE authority SET spent=spent+? WHERE singleton=1', (request['amount'],))
                    connection.execute('INSERT INTO effects(request_id,idempotency_key,document,intent_hash,amount,logical_at,authority_revision,approval_revision) VALUES (?,?,?,?,?,?,?,?)',
                                       (request['id'], request['key'], encode(request), fingerprint(request), request['amount'], at, authority['revision'], approval['revision']))
                    decision = 'committed'
                result = {'decision': decision, 'reasonCodes': reasons,
                          'evidence': {'authorityRevision': authority['revision'], 'approvalRevision': approval['revision']}}
        else:
            raise ValueError('Unknown operation')
        connection.commit()
        return result
    except Exception:
        connection.rollback()
        raise


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--database', required=True)
    args = parser.parse_args()
    connection = None
    try:
        envelope = json.load(sys.stdin)
        connection = connect(args.database)
        result = operation(connection, envelope['operation'], envelope.get('payload', {}))
        print(encode({'ok': True, 'result': result}))
    except Exception as error:
        if connection is not None:
            connection.rollback()
        print(encode({'ok': False, 'error': {'code': 'SQLITE_ADAPTER_ERROR', 'message': str(error)}}))
        return 1
    finally:
        if connection is not None:
            connection.close()
    return 0


if __name__ == '__main__':
    sys.exit(main())
