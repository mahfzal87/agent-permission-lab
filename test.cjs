const assert=require('node:assert/strict');const {run,scenarios,designs}=require('./engine.js');let tests=0;function check(name,fn){fn();tests++;console.log('PASS '+name)}
check('Atomic preserves all default fault invariants',()=>{for(const s of scenarios)assert.equal(run(s.id,'atomic').safe,true,s.id)});
check('Both vulnerable designs expose check/write and replica races',()=>{for(const d of ['cached','preflight'])for(const s of ['race','lag'])assert.ok(run(s,d).violations.includes('Revocation'))});
check('Zero lag fixes stale-replica read but not post-check revocation',()=>{assert.equal(run('lag','preflight',{lag:0}).spent,0);assert.equal(run('race','preflight',{lag:0}).safe,false)});
check('Independent budget guard can mask replay, larger budget exposes it',()=>{assert.equal(run('replay','preflight').ledger.length,1);assert.equal(run('replay','preflight',{budget:120}).ledger.length,2);assert.equal(run('replay','atomic',{budget:120}).ledger.length,1)});
check('All designs allow valid control',()=>{for(const d of Object.keys(designs))assert.equal(run('valid',d).spent,40)});
check('Expired authority never commits with atomic design',()=>{assert.equal(run('expiry','atomic').spent,0);assert.ok(run('expiry','cached').violations.includes('Grant lifetime'));assert.equal(run('valid','atomic',{ttl:100}).spent,0)});
check('Intent binding catches an in-scope mutated amount',()=>{assert.equal(run('drift','atomic').spent,0);assert.ok(run('drift','preflight').violations.includes('Approved intent'))});
check('Audience rerouting is caught by fresh checks',()=>{assert.equal(run('audience','preflight').spent,0);assert.equal(run('audience','atomic').spent,0);assert.ok(run('audience','cached').violations.includes('Audience'))});
check('Delegation cannot widen parent authority',()=>{for(const d of Object.keys(designs))assert.equal(run('delegation',d).spent,0)});
check('Concurrent budget consumption serialises under atomic design',()=>{assert.equal(run('budget','atomic').spent,40);assert.equal(run('budget','preflight').spent,80)});
check('Snapshots retain original approval after mutation',()=>{let r=run('drift','cached');assert.equal(r.trace[0].state.requests['R-001'].amount,40);assert.equal(r.trace[1].state.requests['R-001'].amount,60)});
check('Deterministic output and strict envelope validation',()=>{assert.deepEqual(run('race'),run('race'));for(const amount of [NaN,-1,0,Infinity,1.5,100001])assert.throws(()=>run('valid','atomic',{amount}))});
check('Parameter sweep preserves atomic invariants and sums',()=>{for(const amount of [1,40,100])for(const budget of [1,60,200])for(const ttl of [1,90,100,1500])for(const lag of [0,80,200])for(const s of scenarios){const r=run(s.id,'atomic',{amount,budget,ttl,lag});assert.equal(r.safe,true);assert.equal(r.spent,r.ledger.reduce((a,x)=>a+x.amount,0));assert.ok(r.spent<=budget)}});
console.log(`${tests} test groups passed; 972 atomic scenario/parameter combinations checked.`);
