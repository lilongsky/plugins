import {test,expect} from 'bun:test';
import {_internal as I} from './index.mjs';

const NOW=1900000000000;
const jwt=(sub,exp,tag='fixture')=>'fixture.'+Buffer.from(JSON.stringify({sub,exp:exp/1000,tag})).toString('base64url')+'.fixture';
const account=(uid='fixture-account')=>({type:'oauth',source:'kimi-work-desktop',uid,
  access:jwt(uid,NOW-1000),refresh:'synthetic-refresh-'+uid,expires:NOW-1000});
const rotated=(uid='fixture-account',tag='new')=>({access_token:jwt(uid,NOW+900000,tag),refresh_token:'synthetic-rotated-'+uid+'-'+tag});
const stats={subscriptionBalance:{amountUsedRatio:0.4515,kimiCodeUsedRatio:0.2422,expireTime:'2035-01-01T00:00:00Z'},
  ratelimitCode5h:{ratio:1},ratelimitCode7d:{ratio:1}};
function fixture({auth=account(),fetchImpl,readSession}={}) {
  let saved=structuredClone(auth),saves=0,saveError=false;
  const getAuth=async()=>structuredClone(saved);
  const client={auth:{set:async({path,body})=>{
    expect(path.id).toBe('kimi-work');
    if(saveError)throw Error('synthetic credential must not appear in errors');
    saved=structuredClone(body);saves++;return {data:true};
  }}};
  const p=I.createPlugin({client,readSession:readSession||(()=>{throw Error('No desktop or browser in this fixture');}),fetchImpl,now:()=>NOW});
  return {p,getAuth,client,get saved(){return saved;},get saves(){return saves;},
    set failSave(value){saveError=value;},replace:value=>{saved=value;}};
}

test('expired web credentials rotate and are persisted before membership is queried',async()=>{
  const calls=[];let f;
  f=fixture({fetchImpl:async(url,init)=>{
    calls.push({url,init});
    if(url===I.REFRESH) {
      expect(init.method).toBe('POST');expect(init.redirect).toBe('error');
      expect(init.headers.Authorization).toBeUndefined();expect(init.headers.Cookie).toBeUndefined();
      expect(JSON.parse(init.body)).toEqual({refresh_token:account().refresh});
      return Response.json(rotated());
    }
    expect(f.saves).toBe(1);expect(f.saved.refresh).toBe(rotated().refresh_token);
    expect(init.headers.Authorization).toBe('Bearer '+rotated().access_token);
    return Response.json(stats);
  }});
  const usage=await f.p.auth.usage(f.getAuth);
  expect(calls.map(x=>x.url)).toEqual([I.REFRESH,I.MEMBER+'GetSubscriptionStats']);
  expect(f.saved).toMatchObject({type:'oauth',uid:account().uid,expires:NOW+900000,refresh:rotated().refresh_token});
  expect(usage.windows).toEqual([{name:'月度共享额度',used:45.15},
    {name:'其中 Kimi Code（月度总额占比）',used:24.22,aside:true}]);
  expect(usage.windows.every(x=>!('resetsAt' in x))).toBe(true);
});

test('a server-side 401 refreshes once and retries the same read with the new access token',async()=>{
  const auth=account();auth.expires=NOW+900000;
  const calls=[];
  const f=fixture({auth,fetchImpl:async(url,init)=>{
    calls.push(url);
    if(url===I.REFRESH)return Response.json(rotated());
    return init.headers.Authorization==='Bearer '+auth.access ? new Response('{}',{status:401}) : Response.json(stats);
  }});
  await f.p.auth.usage(f.getAuth);
  expect(calls).toEqual([I.MEMBER+'GetSubscriptionStats',I.REFRESH,I.MEMBER+'GetSubscriptionStats']);
  expect(f.saves).toBe(1);
});

test('a freshly issued access token rejected by membership is not refreshed in a loop',async()=>{
  let refreshes=0;
  const f=fixture({fetchImpl:async url=>url===I.REFRESH ? (refreshes++,Response.json(rotated())) : new Response('{}',{status:401})});
  await expect(f.p.auth.usage(f.getAuth)).rejects.toMatchObject({signIn:'expired'});
  expect(refreshes).toBe(1);expect(f.saves).toBe(1);
});

test('concurrent usage and host renewal share one refresh token exchange',async()=>{
  let refreshes=0,release;
  const gate=new Promise(resolve=>{release=resolve;});
  const f=fixture({fetchImpl:async url=>{
    if(url!==I.REFRESH)return Response.json(stats);
    refreshes++;await gate;return Response.json(rotated());
  }});
  const first=f.p.auth.refresh(await f.getAuth());
  const usage=f.p.auth.usage(f.getAuth);
  release();
  const [next]=await Promise.all([first,usage]);
  expect(refreshes).toBe(1);expect(next.refresh).toBe(rotated().refresh_token);
  expect(f.saved.refresh).toBe(rotated().refresh_token);
});

test('failed persistence keeps the rotated pair for a save retry without spending the old token again',async()=>{
  let refreshes=0,reads=0;
  const f=fixture({fetchImpl:async url=>{
    if(url===I.REFRESH){refreshes++;return Response.json(rotated());}
    reads++;return Response.json(stats);
  }});
  f.failSave=true;
  await expect(f.p.auth.usage(f.getAuth)).rejects.toMatchObject({code:'kimi_work_auth_store_failed'});
  expect(reads).toBe(0);expect(f.saved.refresh).toBe(account().refresh);
  f.failSave=false;
  await f.p.auth.usage(f.getAuth);
  expect(refreshes).toBe(1);expect(reads).toBe(1);expect(f.saved.refresh).toBe(rotated().refresh_token);
});

test('a new plugin instance uses persisted credentials without a browser or desktop read',async()=>{
  let refreshes=0;
  const f=fixture({fetchImpl:async url=>url===I.REFRESH ? (refreshes++,Response.json(rotated())) : Response.json(stats)});
  await f.p.auth.usage(f.getAuth);
  const p=I.createPlugin({client:f.client,now:()=>NOW,readSession:()=>{throw Error('Desktop unavailable');},fetchImpl:async(url,init)=>{
    expect(url).toBe(I.MEMBER+'GetSubscriptionStats');
    expect(init.headers.Authorization).toBe('Bearer '+rotated().access_token);
    return Response.json(stats);
  }});
  expect((await p.auth.usage(f.getAuth)).windows[0].used).toBe(45.15);
  expect(refreshes).toBe(1);
});

test('legacy account references import the web pair once and retain account metadata',async()=>{
  let imports=0;
  const legacy={source:'kimi-work-desktop',uid:account().uid,accountId:'synthetic alias',access:'',refresh:'',expires:0};
  const f=fixture({auth:legacy,readSession:()=>{imports++;return {uid:legacy.uid,workToken:'synthetic-work',webToken:account().access,webRefresh:account().refresh};},
    fetchImpl:async url=>Response.json(url===I.REFRESH ? rotated() : stats)});
  await f.p.auth.usage(f.getAuth);await f.p.auth.usage(f.getAuth);
  expect(imports).toBe(1);expect(f.saved.accountId).toBe(legacy.accountId);
  expect(JSON.stringify(f.saved)).not.toContain('synthetic-work');
});

test('legacy imports refuse a different desktop account',async()=>{
  let calls=0;
  const f=fixture({auth:{source:'kimi-work-desktop',uid:account().uid},
    readSession:()=>({uid:'different-account',webToken:'synthetic',webRefresh:'synthetic'}),
    fetchImpl:async()=>{calls++;return Response.json(stats);}});
  await expect(f.p.auth.usage(f.getAuth)).rejects.toMatchObject({signIn:'expired'});
  expect(calls).toBe(0);expect(f.saves).toBe(0);
});

test('an account replaced while renewal is running is not overwritten',async()=>{
  let release;
  const gate=new Promise(resolve=>{release=resolve;});
  const f=fixture({fetchImpl:async()=>{await gate;return Response.json(rotated());}});
  const pending=f.p.auth.usage(f.getAuth);
  // Let usage enter the exchange before replacing the login.
  await new Promise(resolve=>setTimeout(resolve,0));
  const replacement={...account(),refresh:'synthetic-new-login'};f.replace(replacement);release();
  await expect(pending).rejects.toMatchObject({signIn:'expired'});
  expect(f.saved).toEqual(replacement);expect(f.saves).toBe(0);
});

test('renewal preserves account metadata changed while the exchange is running',async()=>{
  let release,entered;
  const gate=new Promise(resolve=>{release=resolve;}),started=new Promise(resolve=>{entered=resolve;});
  const f=fixture({fetchImpl:async url=>{
    if(url!==I.REFRESH)return Response.json(stats);
    entered();await gate;return Response.json(rotated());
  }});
  const pending=f.p.auth.usage(f.getAuth);await started;
  f.replace({...f.saved,accountId:'updated synthetic alias'});release();await pending;
  expect(f.saved.accountId).toBe('updated synthetic alias');
  expect(f.saved.refresh).toBe(rotated().refresh_token);
});

for(const status of [429,503])test('transient refresh HTTP '+status+' preserves the saved login',async()=>{
  const f=fixture({fetchImpl:async()=>new Response('synthetic secret response',{status})});
  try {await f.p.auth.usage(f.getAuth);throw Error('expected failure');}
  catch(error) {expect(error.signIn).toBeUndefined();expect(error.message).not.toContain('synthetic secret');}
  expect(f.saved).toEqual(account());expect(f.saves).toBe(0);
});

test('a refused refresh requires sign-in without revealing its response',async()=>{
  const f=fixture({fetchImpl:async()=>new Response('synthetic secret response',{status:401})});
  await expect(f.p.auth.usage(f.getAuth)).rejects.toMatchObject({signIn:'expired',code:'kimi_work_login_expired'});
  expect(f.saved).toEqual(account());expect(f.saves).toBe(0);
});

test('network errors during refresh do not expose request credentials',async()=>{
  const f=fixture({fetchImpl:async()=>{throw Error('synthetic secret request');}});
  await expect(f.p.auth.usage(f.getAuth)).rejects.toThrow('登录续期暂不可用');
  expect(f.saved).toEqual(account());
});

for(const payload of [{access_token:rotated().access_token},rotated('different-account'),
  {access_token:jwt(account().uid,NOW-1),refresh_token:'synthetic expired'}])test('invalid rotated pairs never replace the saved login '+JSON.stringify(Object.keys(payload)),async()=>{
  const f=fixture({fetchImpl:async()=>Response.json(payload)});
  await expect(f.p.auth.usage(f.getAuth)).rejects.toThrow('续期响应格式无效');
  expect(f.saved).toEqual(account());expect(f.saves).toBe(0);
});

test('without persistence support an expired pair is not consumed',async()=>{
  let calls=0;
  const p=I.createPlugin({now:()=>NOW,fetchImpl:async()=>{calls++;return Response.json(rotated());}});
  await expect(p.auth.usage(async()=>account())).rejects.toMatchObject({code:'kimi_work_auth_store_failed'});
  expect(calls).toBe(0);
});

test('two accounts renew independently and save to their own host account scopes',async()=>{
  const saved=new Map(['account-a','account-b'].map(uid=>[uid,account(uid)]));
  const calls=[];
  const p=I.createPlugin({now:()=>NOW,client:{auth:{set:async({body})=>{saved.set(body.uid,body);}}},fetchImpl:async(url,init)=>{
    if(url!==I.REFRESH)return Response.json(stats);
    const refresh=JSON.parse(init.body).refresh_token;calls.push(refresh);
    return Response.json(rotated(refresh.endsWith('account-a')?'account-a':'account-b'));
  }});
  await Promise.all([...saved.keys()].map(uid=>p.auth.usage(async()=>saved.get(uid))));
  expect(calls).toHaveLength(2);
  for(const uid of saved.keys())expect(saved.get(uid).refresh).toBe(rotated(uid).refresh_token);
});

test('missing monthly data stays unknown and Code short-window counters are not substituted',async()=>{
  const auth={...account(),expires:NOW+900000};
  const f=fixture({auth,fetchImpl:async()=>Response.json({ratelimitCode5h:{ratio:0.5},ratelimitCode7d:{ratio:0.8}})});
  expect((await f.p.auth.usage(f.getAuth)).windows).toEqual([]);
});
