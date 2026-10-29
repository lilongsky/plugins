import {test,expect} from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {_internal as I} from '../index.mjs';

// Where Kimi's Work sign-in is looked for on each system, the way Kimi
// 3.2.21's main process finds daimon-share: <userData>/daimon-storage.json's
// shareDir, else <userData>/daimon-share (#425).
const files=m=>file=>{if(!(file in m))throw Object.assign(Error('ENOENT'),{code:'ENOENT'});return m[file];};

test('each system\'s default, with no pointer',()=>{
  const none=files({});
  expect(I.desktopFile({platform:'win32',home:'C:\\Users\\u',appdata:'C:\\Users\\u\\AppData\\Roaming',read:none}))
    .toBe('C:\\Users\\u\\AppData\\Roaming\\kimi-desktop\\daimon-share\\daimon\\config.json');
  expect(I.desktopFile({platform:'win32',home:'C:\\Users\\u',appdata:'',read:none}))
    .toBe('C:\\Users\\u\\AppData\\Roaming\\kimi-desktop\\daimon-share\\daimon\\config.json');
  expect(I.desktopFile({platform:'darwin',home:'/Users/u',read:none}))
    .toBe('/Users/u/Library/Application Support/kimi-desktop/daimon-share/daimon/config.json');
  expect(I.desktopFile({platform:'linux',home:'/home/u',read:none}))
    .toBe('/home/u/.config/kimi-desktop/daimon-share/daimon/config.json');
});

test('Windows: Kimi installed on another drive keeps daimon-share where its pointer says',()=>{
  // What Kimi 3.2.21 writes for a new user who installed it on D:.
  const read=files({'C:\\Users\\u\\AppData\\Roaming\\kimi-desktop\\daimon-storage.json':
    '\uFEFF'+JSON.stringify({version:1,shareDir:'D:\\KimiData\\daimon-share'})});
  expect(I.desktopFile({platform:'win32',home:'C:\\Users\\u',appdata:'C:\\Users\\u\\AppData\\Roaming',read}))
    .toBe('D:\\KimiData\\daimon-share\\daimon\\config.json');
});

test('macOS and Linux: storage the user moved is followed too',()=>{
  const mac=files({'/Users/u/Library/Application Support/kimi-desktop/daimon-storage.json':JSON.stringify({version:1,shareDir:'/Volumes/X/KimiData/daimon-share'})});
  expect(I.desktopFile({platform:'darwin',home:'/Users/u',read:mac})).toBe('/Volumes/X/KimiData/daimon-share/daimon/config.json');
  const linux=files({'/home/u/.config/kimi-desktop/daimon-storage.json':JSON.stringify({version:1,shareDir:'/data/kimi/daimon-share/'})});
  expect(I.desktopFile({platform:'linux',home:'/home/u',read:linux})).toBe('/data/kimi/daimon-share/daimon/config.json');
});

test('a pointer Kimi would not take leaves the default, as in Kimi',()=>{
  const ptr='C:\\Users\\u\\AppData\\Roaming\\kimi-desktop\\daimon-storage.json',def='C:\\Users\\u\\AppData\\Roaming\\kimi-desktop\\daimon-share\\daimon\\config.json';
  for(const body of ['not json','null','[]','{}',JSON.stringify({shareDir:''}),JSON.stringify({shareDir:'  '}),
    JSON.stringify({shareDir:'KimiData\\daimon-share'}),JSON.stringify({shareDir:42})])
    expect(I.desktopFile({platform:'win32',home:'C:\\Users\\u',appdata:'C:\\Users\\u\\AppData\\Roaming',read:files({[ptr]:body})})).toBe(def);
});

test('the real reader follows a pointer on disk and reads the sign-in there',()=>{
  const home=fs.mkdtempSync(path.join(os.tmpdir(),'kimi-work-ptr-'));
  try{
    const platform=process.platform==='win32'?'win32':process.platform==='darwin'?'darwin':'linux';
    const data=I.userDataDir({home,platform,appdata:path.join(home,'AppData','Roaming')});
    const share=path.join(home,'KimiData','daimon-share');
    fs.mkdirSync(path.join(share,'daimon'),{recursive:true});fs.mkdirSync(data,{recursive:true});
    fs.writeFileSync(path.join(share,'daimon','config.json'),JSON.stringify({credentials:{kimiCode:{apiKey:'synthetic-work',baseUrl:I.BASE},kimiWeb:{accessToken:'synthetic-web',userId:'fixture-user'}}}));
    const opts={home,platform,appdata:path.join(home,'AppData','Roaming')};
    // No pointer: the default folder, which has no sign-in.
    expect(()=>I.readDesktop(I.desktopFile(opts))).toThrow();
    fs.writeFileSync(path.join(data,'daimon-storage.json'),JSON.stringify({version:1,shareDir:share}));
    expect(I.desktopFile(opts)).toBe(path.join(share,'daimon','config.json'));
    expect(I.readDesktop(I.desktopFile(opts)).workToken).toBe('synthetic-work');
  }finally{fs.rmSync(home,{recursive:true,force:true});}
});

test('a failed sign-in says which file it looked for, and a failed Work check is not called a missing sign-in',async()=>{
  const missing=I.createPlugin({readSession:()=>I.readDesktop('/nowhere/kimi-desktop/daimon-share/daimon/config.json')});
  const a=await (await missing.auth.methods[0].authorize()).callback();
  expect(a.type).toBe('failed');
  // the share folder itself is gone, so it is the folder that is named (#444)
  expect(a.error).toContain('/nowhere/kimi-desktop/daimon-share');
  const session={uid:'u',workToken:'synthetic-work-token',webToken:'w'};
  const down=I.createPlugin({readSession:()=>session,fetchImpl:async()=>{throw Object.assign(TypeError('fetch failed'),{cause:{code:'ECONNRESET'}});}});
  const b=await (await down.auth.methods[0].authorize()).callback();
  expect(b.type).toBe('failed');
  expect(b.error).toContain('ECONNRESET');
  expect(b.error).not.toContain('没有可用');
  expect(b.error).not.toContain(session.workToken);
  const gone=I.createPlugin({readSession:()=>session,fetchImpl:async()=>new Response('{}',{status:401})});
  expect((await (await gone.auth.methods[0].authorize()).callback()).error).toContain('过期');
});

for(const [label,fail,detail] of [
  ['HTTP 503',()=>new Response('{}',{status:503}),'HTTP 503'],
  ['timeout',()=>{throw new DOMException('synthetic request timed out','TimeoutError');},'超时'],
])test('a found session with '+label+' is a connection failure, not a missing or expired sign-in',async()=>{
  const session={uid:'fixture-user',workToken:'synthetic-work-key',webToken:'synthetic-web',webRefresh:'synthetic-refresh'};
  let calls=0;
  const p=I.createPlugin({readSession:()=>session,fetchImpl:async()=>{calls++;return fail();}});
  const result=await (await p.auth.methods[0].authorize()).callback();
  expect(result.type).toBe('failed');expect(result.error).toContain(detail);
  expect(result.error).toContain('已找到本机 Kimi Work 登录');
  expect(result.error).not.toContain('没有可用');expect(result.error).not.toContain('登录已过期');
  expect(result.error).not.toContain(session.workToken);expect(result.error).not.toContain(session.webRefresh);
  expect(calls).toBe(1);
});
