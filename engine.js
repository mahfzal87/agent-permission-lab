/* Deterministic teaching model. No network, tokens or real money. */
(function(root){
'use strict';
const designs={cached:{name:'Task-start approval',short:'Cached',description:'Validate at enqueue. Reuse that decision at the write. No idempotency guard.'},preflight:{name:'Separate preflight check',short:'Preflight',description:'Re-evaluate before the write using a replica. The check and write remain separate. No idempotency guard.'},atomic:{name:'Atomic policy + write',short:'Atomic',description:'Re-evaluate against authoritative state, bind the approved intent, and deduplicate inside the same simulated transaction as the ledger write.'}};
const scenarios=[
{id:'race',name:'The check / write race',tag:'TOCTOU',description:'Revocation arrives after preflight has allowed the request, but before the ledger write.',lesson:'A fresh check is still a snapshot. The authority change and protected write need a defined ordering at a trusted boundary.',events:[[0,'queue'],[80,'check'],[90,'revoke'],[100,'commit']]},
{id:'lag',name:'The stale replica',tag:'Consistency',description:'Authority is revoked centrally. The worker checks a replica that has not caught up.',lesson:'Bypassing a decision cache does not necessarily remove replication lag. Make the required revision or freshness contract explicit.',events:[[0,'queue'],[30,'revoke'],[80,'check'],[100,'commit']]},
{id:'replay',name:'The retry that pays twice',tag:'Idempotency',description:'The first write succeeds. An acknowledgement is lost, so the same request is delivered again.',lesson:'Authorisation and idempotency answer different questions. Set the budget to £120 to expose duplicate writes in the preflight design; a smaller budget can mask the missing guard.',events:[[0,'queue'],[80,'check'],[100,'commit'],[150,'retry'],[180,'check'],[200,'commit']]},
{id:'drift',name:'An approval changes shape',tag:'Intent binding',description:'A human approves one amount. The queued payload changes before execution, while remaining within the delegated limit.',lesson:'Bind approval to the exact action, resource, amount and recipient. Being within a spending limit is not the same as having this intent approved.',events:[[0,'queue'],[40,'mutate'],[80,'check'],[100,'commit']]},
{id:'expiry',name:'Authority expires in the queue',tag:'Lifetime',description:'A worker resumes after the delegated grant expires.',lesson:'Evaluate expiry at the protected action, not just when work enters a queue. Define clock skew and the exact expiry boundary.',events:[[0,'queue'],[1200,'check'],[1220,'commit']]},
{id:'audience',name:'The wrong destination',tag:'Audience',description:'A refund request is rerouted to a different service after enqueue.',lesson:'A valid identity does not imply authority for every recipient. Check the intended audience at the resource boundary.',events:[[0,'queue'],[40,'reroute'],[80,'check'],[100,'commit']]},
{id:'delegation',name:'The delegate exceeds its grant',tag:'Attenuation',description:'A child agent requests more authority than its parent was allowed to delegate.',lesson:'Effective authority is constrained by every grant in the chain. A child cannot create permission its parent never had.',events:[[0,'widen'],[10,'queue'],[80,'check'],[100,'commit']]},
{id:'budget',name:'Two approvals, one budget',tag:'Concurrency',description:'Two requests each fit the remaining budget when checked. Both attempt to spend it.',lesson:'A budget check and reservation must share an atomic boundary. Two individually valid decisions can violate a shared invariant.',events:[[0,'queue'],[10,'queue2'],[80,'check'],[85,'check2'],[100,'commit'],[110,'commit2']]},
{id:'valid',name:'The control: valid authority',tag:'Baseline',description:'An unchanged request executes while its authority remains valid.',lesson:'A control prevents a deny-everything implementation from looking secure. Valid work must still complete.',events:[[0,'queue'],[80,'check'],[100,'commit']]}
];
const defaults={amount:40,limit:100,budget:60,ttl:1000,lag:200};
const copy=x=>JSON.parse(JSON.stringify(x));
function normalise(input={}){const c={...defaults,...input};for(const k of Object.keys(defaults)){c[k]=Number(c[k]);if(!Number.isSafeInteger(c[k])||c[k]<0||c[k]>100000)throw Error('Invalid '+k);}if(c.amount<=0||c.limit<=0||c.budget<=0||c.ttl<=0)throw Error('Amount, limit, budget and lifetime must be positive.');return c;}
function run(id='race',design='atomic',input={}){
const config=normalise(input),scenario=scenarios.find(x=>x.id===id);if(!scenario||!designs[design])throw Error('Unknown experiment');
const s={time:0,revision:1,revoked:false,replicaRevision:1,replicaRevoked:false,revokedAt:null,spent:0,ledger:[],requests:{},trace:[],violations:[],childLimit:config.limit};
function fingerprint(r){return JSON.stringify([r.subject,r.actor,r.action,r.resource,r.audience,r.amount,r.recipient]);}
function request(key){const r={id:key,key:'intent-'+key,subject:'user:amina',actor:'agent:refund-worker',chain:['user:amina','agent:support','agent:refund-worker'],action:'refund:create',resource:'order:1042',audience:'payments-api',recipient:'customer:1042',amount:config.amount,capturedRevision:s.revision};r.approvedIntent=fingerprint(r);return r;}
function checks(r,view='authority',bind=false){const revoked=view==='replica'?s.replicaRevoked:s.revoked;return [
{rule:'Delegation',ok:s.childLimit<=config.limit&&r.amount<=s.childLimit,observed:`parent ≤ £${config.limit}; child ≤ £${s.childLimit}; request £${r.amount}`},
{rule:'Audience',ok:r.audience==='payments-api',observed:r.audience},
{rule:'Scope & resource',ok:r.action==='refund:create'&&r.resource==='order:1042',observed:r.action+' on '+r.resource},
{rule:'Grant lifetime',ok:s.time<config.ttl,observed:`t=${s.time}ms; expires=${config.ttl}ms (exclusive)`},
{rule:'Revocation',ok:!revoked,observed:`${view}; revision ${view==='replica'?s.replicaRevision:s.revision}; ${revoked?'revoked':'active'}`},
{rule:'Shared budget',ok:s.spent+r.amount<=config.budget,observed:`£${s.spent} + £${r.amount} ≤ £${config.budget}`},
...(bind?[{rule:'Approved intent',ok:fingerprint(r)===r.approvedIntent,observed:fingerprint(r)===r.approvedIntent?'Exact approved payload':'Payload differs from approval'}]:[])
];}
function evidence(type,lane,message,rules=[]){s.trace.push({step:s.trace.length+1,time:s.time,type,lane,message,checks:copy(rules),state:copy({revision:s.revision,revoked:s.revoked,replicaRevision:s.replicaRevision,replicaRevoked:s.replicaRevoked,spent:s.spent,ledger:s.ledger,requests:s.requests,childLimit:s.childLimit}),violations:[...s.violations]});}
for(const [time,event] of scenario.events){s.time=time;if(s.revokedAt!==null&&time>=s.revokedAt+config.lag){s.replicaRevision=s.revision;s.replicaRevoked=true;}
const key=event.endsWith('2')?'R-002':'R-001';
if(event==='widen'){s.childLimit=config.limit+20;evidence('fault','delegate','Child grant widened beyond parent authority.');continue;}
if(event.startsWith('queue')){const r=request(key);s.requests[key]=r;r.initial=checks(r);r.accepted=r.initial.every(x=>x.ok);evidence(r.accepted?'allow':'deny','queue',`${key}: ${r.accepted?'accepted into queue':'rejected at enqueue'}. No ledger write.`,r.initial);continue;}
const r=s.requests[key];
if(event==='revoke'){s.revoked=true;s.revision++;s.revokedAt=time;evidence('fault','authority',`Authoritative grant revoked at revision ${s.revision}. Replica visibility delayed by ${config.lag}ms.`);continue;}
if(event==='mutate'){r.amount=Math.min(config.amount+20,config.limit);if(r.amount===config.amount)r.recipient='customer:other';evidence('fault','delegate','Queued payload changed after human approval.');continue;}
if(event==='reroute'){r.audience='analytics-api';evidence('fault','delegate','Request rerouted to analytics-api.');continue;}
if(event==='retry'){evidence('fault','queue','Acknowledgement lost. Same idempotency key redelivered.');continue;}
if(event.startsWith('check')){r.preflight=checks(r,design==='preflight'?'replica':'authority');r.preflightAllowed=r.preflight.every(x=>x.ok);if(design==='cached')evidence('observe','gate',`${key}: no fresh check in task-start design.`);else if(design==='atomic')evidence('observe','gate',`${key}: worker preflight is advisory; commit will independently evaluate.`,r.preflight);else evidence(r.preflightAllowed?'allow':'deny','gate',`${key}: separate preflight ${r.preflightAllowed?'allowed':'denied'} using replica revision ${s.replicaRevision}.`,r.preflight);continue;}
if(event.startsWith('commit')){
if(!r.accepted){evidence('deny','ledger',`${key}: cannot execute a request rejected at enqueue.`);continue;}
if(design==='atomic'&&s.ledger.some(x=>x.key===r.key)){evidence('dedupe','ledger',`${key}: existing result returned. No second ledger write.`);continue;}
const rules=design==='cached'?r.initial:design==='preflight'?r.preflight:checks(r,'authority',true);
const allowed=rules.every(x=>x.ok);if(!allowed){evidence('deny','ledger',`${key}: write denied. ${rules.filter(x=>!x.ok).map(x=>x.rule).join(', ')}.`,rules);continue;}
const current=checks(r,'authority',true);const failures=current.filter(x=>!x.ok).map(x=>x.rule);if(s.ledger.some(x=>x.key===r.key))failures.push('Duplicate side effect');
for(const violation of failures)if(!s.violations.includes(violation))s.violations.push(violation);
s.ledger.push({request:key,key:r.key,amount:r.amount,time:s.time,revision:s.revision});s.spent+=r.amount;
evidence(failures.length?'unsafe':'commit','ledger',`${key}: £${r.amount} written${failures.length?'; invariant violated: '+failures.join(', '):'; invariants satisfied'}.`,design==='atomic'?rules:current);
}
}
return {scenario:id,design,config,trace:s.trace,ledger:s.ledger,violations:s.violations,spent:s.spent,safe:s.violations.length===0};
}
const api={designs,scenarios,defaults,run,normalise};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.PermissionLab=api;
})(typeof window==='undefined'?{}:window);
