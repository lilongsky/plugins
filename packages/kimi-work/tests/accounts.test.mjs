import {test,expect} from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {_internal as I} from '../index.mjs';

// Kimi's own files, as Kimi 3.2.21 writes them: <daimon>/config.json with
// the signed-in user's Work key and web sign-in, and <daimon>/kimi-code-key.json,
// one minted Work key per Kimi user that has used Work here, the user in
// use first ({"v":2,"keys":[{userId,apiKey,keyId?}]}).
function kimiHome() {
  const home=fs.mkdtempSync(path.join(os.tmpdir(),'kimi-work-acct-'));
  const platform=process.platform==='win32'?'win32':process.platform==='darwin'?'darwin':'linux';
  const opts={home,platform,appdata:path.join(home,'AppData','Roaming')};
  const data=I.userDataDir(opts),share=path.join(home,'KimiData','daimon-share'),daimon=path.join(share,'daimon');
  fs.mkdirSync(daimon,{recursive:true});fs.mkdirSync(data,{recursive:true});
  // the pointer Kimi writes for an install on another drive (#425, #444)
  fs.writeFileSync(path.join(data,'daimon-storage.json'),JSON.stringify({version:1,shareDir:share}));
  const signIn=(userId,keys)=>{
    fs.writeFileSync(path.join(daimon,'config.json'),JSON.stringify({credentials:{
      kimiCode:{apiKey:keys[0].apiKey,baseUrl:I.BASE},kimiWeb:{accessToken:'web-'+userId,userId}}}));
    fs.writeFileSync(path.join(daimon,'kimi-code-key.json'),JSON.stringify({v:2,keys}));
  };
  return {home,opts,share,daimon,signIn,read:()=>I.readDesktop(I.desktopFile(opts)),done:()=>fs.rmSync(home,{recursive:true,force:true})};
}
const chat=loader=>loader.fetch(I.BASE+'/chat/completions',{method:'POST',body:'{"model":"k3-agent","messages":[]}'});

// #444 (kongbai01203): daimon-storage.json readable, the folder it names
// moved or deleted afterwards. 0.1.12 called that a lapsed sign-in.
test('a share folder that is gone says which folder, leaves the sign-in unmarked, and comes back when the folder does',async()=>{
  const k=kimiHome();
  try {
    k.signIn('user-a',[{userId:'user-a',apiKey:'key-a'}]);
    let calls=0;
    const p=I.createPlugin({readSession:k.read,fetchImpl:async()=>{calls++;return new Response('{}');}});
    const a=await (await p.auth.methods[0].authorize()).callback();
    expect(a.type).toBe('success');
    const loader=await p.auth.loader(async()=>a);
    calls=0;
    const moved=k.share+'.moved';
    fs.renameSync(k.share,moved);
    let err;
    try {await chat(loader);} catch(e) {err=e;}
    expect(err?.code).toBe('kimi_work_share_missing');
    expect(err?.signIn).toBe('kept');
    expect(err?.message).toContain(k.share);
    expect(err?.message).toContain('放回原处');
    expect(calls).toBe(0);
    await expect(p.auth.usage(async()=>a)).rejects.toMatchObject({code:'kimi_work_share_missing',signIn:'kept'});
    const again=await (await p.auth.methods[0].authorize()).callback();
    expect(again.type).toBe('failed');
    expect(again.error).toContain(k.share);
    expect(again.error).not.toContain('没有可用');
    // put back: the same account works with no new sign-in
    fs.renameSync(moved,k.share);
    expect((await chat(loader)).status).toBe(200);
    expect(calls).toBe(1);
  } finally {k.done();}
});

test('the reporter\'s Windows path: D:\\KimiData\\daimon-share gone is named as the folder',()=>{
  let err;
  try {I.readDesktop('D:\\KimiData\\daimon-share\\daimon\\config.json');} catch(e) {err=e;}
  expect(err?.code).toBe('kimi_work_share_missing');
  expect(err?.message).toContain('D:\\KimiData\\daimon-share');
});

test('a share folder with no sign-in in it is still a missing sign-in',()=>{
  const k=kimiHome();
  try {
    let err;
    try {k.read();} catch(e) {err=e;}
    expect(err?.code).toBe('kimi_work_login_expired');
    expect(err?.missing).toBe(true);
  } finally {k.done();}
});

// #440 (kongbai01203): a second Kimi user signed in made the first one's
// account fail, since only the user Kimi is signed in to was served.
test('two Kimi users signed in one after the other are both served, each with its own Work key',async()=>{
  const k=kimiHome();
  try {
    const calls=[];
    const p=I.createPlugin({readSession:k.read,fetchImpl:async(url,init)=>{calls.push({url:String(url),auth:new Headers(init.headers).get('authorization')});return new Response('{}');}});
    k.signIn('user-a',[{userId:'user-a',apiKey:'key-a',keyId:'id-a'}]);
    const a=await (await p.auth.methods[0].authorize()).callback();
    // Kimi switched to user B: B's key minted and put first, A's kept
    k.signIn('user-b',[{userId:'user-b',apiKey:'key-b'},{userId:'user-a',apiKey:'key-a',keyId:'id-a'}]);
    const b=await (await p.auth.methods[0].authorize()).callback();
    expect(a.type).toBe('success');expect(b.type).toBe('success');
    expect(a.uid).not.toBe(b.uid);
    expect(a.accountId).not.toBe(b.accountId);
    calls.length=0;
    await chat(await p.auth.loader(async()=>a));
    await chat(await p.auth.loader(async()=>b));
    expect(calls.map(c=>c.auth)).toEqual(['Bearer key-a','Bearer key-b']);
    // A's allowance needs A's web sign-in, which Kimi no longer holds
    calls.length=0;
    const u=await p.auth.usage(async()=>a);
    expect(u.signIn).toBe('kept');
    expect(u.error).toContain('切换到它');
    expect(calls).toHaveLength(0);
    // A's key gone from Kimi's store (agent-gw refused it): A can't be served
    k.signIn('user-b',[{userId:'user-b',apiKey:'key-b'}]);
    await expect(chat(await p.auth.loader(async()=>a))).rejects.toMatchObject({signIn:'expired',code:'kimi_work_account_not_here'});
    expect(calls).toHaveLength(0);
  } finally {k.done();}
});

test('an away account\'s key the gateway refuses says to switch to it in Kimi',async()=>{
  const k=kimiHome();
  try {
    k.signIn('user-b',[{userId:'user-b',apiKey:'key-b'},{userId:'user-a',apiKey:'key-a'}]);
    const p=I.createPlugin({readSession:k.read,fetchImpl:async()=>new Response('{}',{status:401})});
    const uidA=I.readKeys(path.join(k.daimon,'kimi-code-key.json'));
    const a=Object.keys(uidA).find(u=>uidA[u]==='key-a');
    const auth={type:'oauth',source:'kimi-work-desktop',uid:a};
    let err;
    try {await chat(await p.auth.loader(async()=>auth));} catch(e) {err=e;}
    expect(err?.code).toBe('kimi_work_account_not_here');
    expect(err?.message).toContain('失效');
  } finally {k.done();}
});

test('the key store is read as Kimi reads it',()=>{
  const k=kimiHome();
  try {
    const f=path.join(k.daimon,'kimi-code-key.json');
    for(const body of ['not json','{}',JSON.stringify({v:1,keys:[{userId:'u',apiKey:'k'}]}),JSON.stringify({v:2,keys:{}})]) {
      fs.writeFileSync(f,body);
      expect(Object.keys(I.readKeys(f))).toHaveLength(0);
    }
    fs.writeFileSync(f,JSON.stringify({v:2,keys:[{userId:'u',apiKey:'first'},{userId:'u',apiKey:'second'},{userId:'',apiKey:'x'},{userId:'w'},null]}));
    expect(Object.values(I.readKeys(f))).toEqual(['first']);
    expect(Object.keys(I.readKeys(path.join(k.daimon,'none.json')))).toHaveLength(0);
  } finally {k.done();}
});
