import test from 'node:test';
import assert from 'node:assert/strict';
import {createReadClient,CompatibilityError,ReadClientError} from '../dist/client.js';
const health={ok:true,service:'cryptara',checkedAt:'2026-09-12T00:00:00Z',mockFallbacksEnabled:false,liveModeUsesMockData:false};
const make=options=>createReadClient({baseUrl:'https://example.test',...options});
test('Retry-After is respected with a bounded attempt count',async()=>{
  let count=0;const start=Date.now();
  const c=make({fetch:async()=>++count===1?Response.json({}, {status:429,headers:{'Retry-After':'0.02'}}):Response.json(health)});
  await c.health.get();assert.equal(count,2);assert(Date.now()-start>=18);
  count=0;
  const exhausted=make({retries:2,fetch:async()=>{count++;return Response.json({}, {status:503,headers:{'Retry-After':'0'}})}});
  await assert.rejects(exhausted.health.get(),e=>e.status===503);assert.equal(count,3);
});
test('long Retry-After never triggers an early retry; HTTP-date form is accepted',async()=>{
  let count=0;
  const c=make({maxRetryDelayMs:10,fetch:async()=>{count++;return Response.json({}, {status:429,headers:{'Retry-After':'60'}})}});
  await assert.rejects(c.health.get(),e=>e.status===429);assert.equal(count,1);
  count=0;
  const past=make({fetch:async()=>++count===1?Response.json({}, {status:503,headers:{'Retry-After':new Date(0).toUTCString()}}):Response.json(health)});
  await past.health.get();assert.equal(count,2);
});
test('cancellation interrupts backoff and pre-aborted work makes no request',async()=>{
  let count=0;const ac=new AbortController();
  const c=make({fetch:async()=>{count++;return Response.json({}, {status:429,headers:{'Retry-After':'1'}})}});
  const pending=c.health.get({signal:ac.signal});setTimeout(()=>ac.abort(),10);
  await assert.rejects(pending,e=>e.name==='AbortError');assert.equal(count,1);
  await assert.rejects(c.health.get({signal:ac.signal}),e=>e.name==='AbortError');assert.equal(count,1);
});
test('both client and request cancellation stay effective',async()=>{
  const parent=new AbortController(),child=new AbortController();let received;
  const c=make({signal:parent.signal,fetch:async(_url,init)=>{received=init.signal;parent.abort();return Response.json(health)}});
  await assert.rejects(c.health.get({signal:child.signal}),e=>e.name==='AbortError');assert.equal(received.aborted,true);
});
test('credential handling is explicit and request headers do not leak to the next call',async()=>{
  const captures=[];
  const c=make({headers:{'X-App':'example'},fetch:async(_url,init)=>{captures.push(init);return Response.json(health)}});
  await c.health.get({credentials:'include',headers:{Cookie:'fixture-session'}});await c.health.get();
  assert.equal(captures[0].credentials,'include');assert.equal(captures[0].headers.get('cookie'),'fixture-session');
  assert.equal(captures[1].credentials,'omit');assert.equal(captures[1].headers.get('cookie'),null);
});
test('malformed JSON, legacy HTTP failures and network errors have typed safe outcomes',async()=>{
  const c=make({fetch:async()=>new Response('<html>not JSON</html>')});await assert.rejects(c.health.get(),CompatibilityError);
  const legacy=make({fetch:async()=>Response.json({error:{secret:'must not be retained'}},{status:403})});
  await assert.rejects(legacy.health.get(),e=>e instanceof ReadClientError&&e.status===403&&!JSON.stringify(e).includes('secret'));
  const offline=make({fetch:async()=>{throw Error('credential-in-url')}});
  await assert.rejects(offline.health.get(),e=>e.kind==='transport'&&!e.message.includes('credential'));
});
test('invalid configuration and path traversal fail before fetch',()=>{
  for(const baseUrl of ['file:///etc/passwd','https://user:pass@example.test','https://example.test?x=1'])assert.throws(()=>make({baseUrl}),ReadClientError);
  for(const retries of [-1,4,1.5])assert.throws(()=>make({retries}),ReadClientError);
  const c=make({fetch:async()=>{throw Error('unexpected request')}});
  assert.throws(()=>c.snapshots.get('../health'),ReadClientError);assert.throws(()=>c.history.transactions({limit:NaN}),ReadClientError);
});
