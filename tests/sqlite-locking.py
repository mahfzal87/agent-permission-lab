"""Actual local writer exclusion and budget serialisation; synthetic policy."""
import concurrent.futures
import importlib.util
import json
import sqlite3
import sys
import tempfile
import threading
from pathlib import Path

sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location('sqlite_adapter', Path(__file__).resolve().parents[1] / 'adapters/sqlite/backend.py')
backend = importlib.util.module_from_spec(spec)
spec.loader.exec_module(backend)
AUTH = dict(id='grant-1',revision=1,active=True,expiresAt=1000,limit=100,budget=60,
            subject='user:amina',actor='agent:refund-worker',action='refund:create',
            resource='order:1042',audience='payments-api',recipient='customer:1042')
REQUEST = {key: AUTH[key] for key in backend.BINDINGS}
REQUEST.update(id='R-001',key='intent-1',amount=40,childLimit=100)


def prepare(connection, two=False):
    backend.operation(connection,'reset',dict(at=0,authority=AUTH))
    backend.operation(connection,'enqueue',dict(at=0,request=REQUEST,approval=dict(revision=1,intent=REQUEST)))
    if two:
        second = dict(REQUEST,id='R-002',key='intent-2')
        backend.operation(connection,'enqueue',dict(at=0,request=second,approval=dict(revision=1,intent=second)))


def writer_lock_control():
    with tempfile.TemporaryDirectory(prefix='permission-sqlite-lock-') as folder:
        path=str(Path(folder)/'fixture.sqlite3')
        setup=backend.connect(path)
        try: prepare(setup)
        finally: setup.close()
        admin=backend.connect(path,timeout=0.02)
        before_insert=threading.Event()
        allow_insert=threading.Event()
        def execute_with_observed_boundary():
            worker=backend.connect(path)
            def trace(statement):
                # Pause the actual adapter at the protected INSERT, after it has
                # acquired BEGIN IMMEDIATE and reserved the budget in that tx.
                if statement.upper().startswith('INSERT INTO EFFECTS'):
                    before_insert.set()
                    allow_insert.wait(timeout=5)
            worker.set_trace_callback(trace)
            try: return backend.operation(worker,'execute',dict(at=100,requestId='R-001'))
            finally: worker.close()
        try:
            with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
                future=pool.submit(execute_with_observed_boundary)
                try:
                    assert before_insert.wait(timeout=5), 'Worker did not reach protected INSERT'
                    blocked=False
                    try:
                        backend.operation(admin,'changeAuthority',dict(at=90,patch=dict(active=False)))
                    except sqlite3.OperationalError as error:
                        blocked='locked' in str(error).lower()
                    assert blocked, 'Independent authority writer must be blocked by active writer'
                finally: allow_insert.set()
                result=future.result(timeout=5)
            assert result['decision']=='committed'
            backend.operation(admin,'changeAuthority',dict(at=110,patch=dict(active=False)))
            observed=backend.snapshot(admin)
            assert observed['ledger'][0]['authorityRevision']==1
            assert observed['authority']['revision']==2
            return dict(blocked=blocked,effects=len(observed['ledger']),spent=observed['spent'],
                        effect_authority_revision=1,final_authority_revision=2,
                        limitation='The competing authority write was blocked, then committed after the protected write. No committed revocation was ignored.')
        finally:
            allow_insert.set();admin.close()


def concurrent_budget_control():
    with tempfile.TemporaryDirectory(prefix='permission-sqlite-budget-') as folder:
        path=str(Path(folder)/'fixture.sqlite3')
        setup=backend.connect(path)
        try: prepare(setup,two=True)
        finally: setup.close()
        ready=threading.Barrier(2)
        def attempt(request_id):
            connection=backend.connect(path)
            try:
                ready.wait(timeout=5)
                return backend.operation(connection,'execute',dict(at=100,requestId=request_id))
            finally: connection.close()
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
            futures=[pool.submit(attempt,key) for key in ['R-001','R-002']]
            results=[future.result(timeout=10) for future in futures]
        observer=backend.connect(path)
        try: observed=backend.snapshot(observer)
        finally: observer.close()
        assert sorted(r['decision'] for r in results)==['committed','denied']
        assert observed['spent']==40 and len(observed['ledger'])==1
        return dict(decisions=[r['decision'] for r in results],effects=1,spent=40,budget=60,
                    limitation='Two actual local SQLite connections contend; the winning request is deliberately unspecified. No distributed service is exercised.')


def rollback_control():
    with tempfile.TemporaryDirectory(prefix='permission-sqlite-rollback-') as folder:
        connection=backend.connect(str(Path(folder)/'fixture.sqlite3'))
        try:
            prepare(connection)
            connection.execute("CREATE TRIGGER fail_effect BEFORE INSERT ON effects BEGIN SELECT RAISE(ABORT, 'forced test effect failure'); END")
            failed=False
            try: backend.operation(connection,'execute',dict(at=100,requestId='R-001'))
            except sqlite3.IntegrityError as error: failed='forced test effect failure' in str(error)
            assert failed
            observed=backend.snapshot(connection)
            assert observed['spent']==0 and len(observed['ledger'])==0
            connection.execute('DROP TRIGGER fail_effect')
            retry=backend.operation(connection,'execute',dict(at=100,requestId='R-001'))
            observed=backend.snapshot(connection)
            assert retry['decision']=='committed' and observed['spent']==40 and len(observed['ledger'])==1
            return dict(forced_failure=True,reservation_after_failure=0,effects_after_failure=0,
                        explicit_retry=retry['decision'],effects_after_retry=1,
                        limitation='A test-only SQLite trigger aborts the protected INSERT; rollback covers the local reservation and effect only.')
        finally: connection.close()


if __name__=='__main__':
    print(json.dumps(dict(writer_lock=writer_lock_control(),concurrent_budget=concurrent_budget_control(),rollback=rollback_control()),indent=2))
