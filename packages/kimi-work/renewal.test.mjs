import {test,expect} from 'bun:test';
import {_internal as I} from './index.mjs';

const NOW=1900000000000;
const jwt=(sub,exp,tag='fixture')=>'fixture.'+Buffer.from(JSON.stringify({sub,exp:exp/1000,tag})).toString('base64url')+'.fixture';
const account=(uid='fixture-account',tag='old')=>({type:'oauth',source:'kimi-work-desktop',uid,
  access:jwt(uid,NOW-1000,tag),refresh:'synthetic-refresh-'+uid+'-'+tag,expires:NOW-1000});
const rotated=(uid='fixture-account',tag='new',clock=NOW)=>({access_token:jwt(uid,clock+900000,tag),refresh_token:'synthetic-rotated-'+uid+'-'+tag});
const fields=p=>({access:p.access_token,refresh:p.refresh_token,expires:I.expiry(p.access_token)});
const stats={subscriptionBalance:{amountUsedRatio:0.4515,kimiCodeUsedRatio:0.2422,expireTime:'2035-01-01T00:00:00Z'},
  ratelimitCode5h:{ratio:1},ratelimitCode7d:{ratio:1}};
function deferred() {
  let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};
}
function plugin(fetchImpl,extra={}) {
  return I.createPlugin({now:()=>NOW,readSession:()=>{throw Error('No desktop or browser in this fixture');},fetchImpl,...extra});
}

test('host renewal returns only rotated fields and never calls the blind auth.set',async()=>{
  const calls=[];let writes=0;
  const p=plugin(async(url,init)=>{
    calls.push(url);expect(url).toBe(I.REFRESH);
    expect(init.method).toBe('POST');expect(init.redirect).toBe('error');
    expect(new Headers(init.headers).has('authorization')).toBe(false);
    expect(new Headers(init.headers).has('cookie')).toBe(false);
    const headers=new Headers(init.headers);
    expect(headers.get('content-type')).toBe('application/json');
    expect(headers.get('connect-protocol-version')).toBe('1');
    expect(headers.get('user-agent')).toContain('kimi-desktop/3.2.17');
    expect(headers.get('user-agent')).not.toContain('kimi-code-cli');
    expect(headers.get('x-msh-platform')).toBe('mac');
    expect(headers.get('x-msh-version')).toBe('3.2.17');
    expect(headers.get('r-timezone')).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone);
    expect(headers.get('x-language')).toBeTruthy();
    for(const key of ['x-msh-device-id','x-msh-session-id','x-msh-shield-data'])expect(headers.has(key)).toBe(false);
    expect(JSON.parse(init.body)).toEqual({refresh_token:account().refresh});
    return Response.json(rotated());
  },{platform:'darwin',client:{auth:{set:async()=>{writes++;throw Error('Blind writes are forbidden');}}}});
  expect(await p.auth.refresh(account())).toEqual(fields(rotated()));
  expect(calls).toEqual([I.REFRESH]);expect(writes).toBe(0);
});

test('host-save retries reuse the rotated pair without spending the saved old token again',async()=>{
  let calls=0;
  const p=plugin(async()=>{calls++;return Response.json(rotated());});
  expect(await p.auth.refresh(account())).toEqual(fields(rotated()));
  expect(await p.auth.refresh(account())).toEqual(fields(rotated()));
  expect(calls).toBe(1);
});

test('continuing host-save failure advances from the cached refresh even after its access expires',async()=>{
  let clock=NOW;const spent=[];
  const p=plugin(async(url,init)=>{
    spent.push(JSON.parse(init.body).refresh_token);
    return Response.json(rotated('fixture-account','rotation-'+spent.length,clock));
  },{now:()=>clock});
  const first=await p.auth.refresh(account());
  clock+=900000;
  const second=await p.auth.refresh(account());
  expect(spent).toEqual([account().refresh,first.refresh]);
  expect(await p.auth.refresh(account())).toEqual(second);
  expect(await p.auth.refresh({...account(),...first})).toEqual(second);
  expect(spent).toHaveLength(2);
});

test('concurrent renewal of the exact input pair shares one exchange',async()=>{
  const gate=deferred(),entered=deferred();let calls=0;
  const p=plugin(async()=>{calls++;entered.resolve();await gate.promise;return Response.json(rotated());});
  const one=p.auth.refresh(account());await entered.promise;
  const two=p.auth.refresh(account());gate.resolve();
  expect(await one).toEqual(fields(rotated()));expect(await two).toEqual(fields(rotated()));
  expect(calls).toBe(1);
});

test('same-uid reconnects with independent due credentials have independent pending work and caches',async()=>{
  const gate=deferred(),entered=deferred(),old=account(),reconnected=account('fixture-account','reconnected');
  const spent=[];
  const p=plugin(async(url,init)=>{
    const token=JSON.parse(init.body).refresh_token;spent.push(token);
    if(token===old.refresh){entered.resolve();await gate.promise;return Response.json(rotated('fixture-account','old-lineage'));}
    return Response.json(rotated('fixture-account','new-lineage'));
  });
  const oldRun=p.auth.refresh(old);await entered.promise;
  const fresh=await p.auth.refresh(reconnected);gate.resolve();const previous=await oldRun;
  expect(fresh).toEqual(fields(rotated('fixture-account','new-lineage')));
  expect(previous).toEqual(fields(rotated('fixture-account','old-lineage')));
  expect(await p.auth.refresh(reconnected)).toEqual(fresh);
  expect(await p.auth.refresh(old)).toEqual(previous);
  expect(spent).toEqual([old.refresh,reconnected.refresh]);
});

test('old pending 401 does not block or expire a same-uid fresh reconnect',async()=>{
  const gate=deferred(),entered=deferred(),old=account();
  const fresh={...old,...fields(rotated('fixture-account','reconnected'))};
  let reads=0;
  const p=plugin(async url=>{
    if(url!==I.REFRESH){reads++;return Response.json(stats);}
    entered.resolve();await gate.promise;return new Response('{}',{status:401});
  });
  const oldRun=p.auth.refresh(old).catch(error=>error);await entered.promise;
  const outcome=await Promise.race([
    Promise.all([p.auth.refresh(fresh),p.auth.usage(async()=>fresh)]).then(value=>({value})),
    new Promise(resolve=>setTimeout(()=>resolve({blocked:true}),50)),
  ]);
  gate.resolve();const oldError=await oldRun;
  expect(outcome.blocked).toBeUndefined();expect(outcome.value[0]).toBeUndefined();
  expect(outcome.value[1].windows[0].used).toBe(45.15);expect(reads).toBe(1);
  expect(oldError).toMatchObject({signIn:'kept',code:'kimi_work_membership_expired'});
});

test('paired usage keeps Work signed in and asks to reconnect after a membership 401 without rotation or writes',async()=>{
  let writes=0;const calls=[];
  const fresh={...account(),...fields(rotated())};
  const p=plugin(async url=>{calls.push(url);return new Response('{}',{status:401});},
    {client:{auth:{set:async()=>{writes++;}}}});
  const usage=await p.auth.usage(async()=>fresh);
  expect(usage).toMatchObject({signIn:'kept',windows:[]});
  expect(usage.error).toContain('重新连接 Kimi Work');
  expect(usage.error).not.toMatch(/sign-in has (expired|lapsed)|sign in again/i);
  expect(calls).toEqual([I.MEMBER+'GetSubscriptionStats']);expect(writes).toBe(0);
});

test('completion after logout or replacement only returns fields for the host conditional commit',async()=>{
  for(const replacement of [undefined,account('fixture-account','replacement')]) {
    const gate=deferred(),entered=deferred();let saved=account(),writes=0;
    const p=plugin(async()=>{entered.resolve();await gate.promise;return Response.json(rotated());},
      {client:{auth:{set:async({body})=>{saved=body;writes++;}}}});
    const pending=p.auth.refresh(saved);await entered.promise;saved=replacement;gate.resolve();
    expect(await pending).toEqual(fields(rotated()));
    expect(saved).toEqual(replacement);expect(writes).toBe(0);
  }
});

for(const fields of [{},{access:'',refresh:'',expires:0}])
  test('reference-only legacy usage reads desktop webToken without reconnect, migration or rotation: '+JSON.stringify(fields),async()=>{
    let reads=0,writes=0;const calls=[];
    const legacy={type:'oauth',source:'kimi-work-desktop',uid:account().uid,...fields},before=structuredClone(legacy);
    const desktopAccess=rotated('fixture-account','desktop').access_token;
    const p=plugin(async(url,init)=>{calls.push(url);expect(init.headers.Authorization).toBe('Bearer '+desktopAccess);return Response.json(stats);},{
      readSession:()=>{reads++;return {uid:legacy.uid,webToken:desktopAccess,webRefresh:'unspent-desktop-refresh'};},
      client:{auth:{set:async()=>{writes++;}}},
    });
    expect(await p.auth.refresh(legacy)).toBeUndefined();
    expect(reads).toBe(0);expect(calls).toEqual([]);
    const usage=await p.auth.usage(async()=>legacy);
    expect(usage).toEqual({plan:'月度共享额度',windows:[{name:'本月',used:45.15,display:'Code 已用 24.22%（占总额）'}]});
    expect(legacy).toEqual(before);expect(reads).toBe(1);expect(writes).toBe(0);
    expect(calls).toEqual([I.MEMBER+'GetSubscriptionStats']);
  });

test('legacy usage rereads the desktop access after a rotation without copying its refresh',async()=>{
  const legacy={type:'oauth',source:'kimi-work-desktop',uid:'fixture-account'};let token='synthetic-desktop-first';
  const sent=[];const p=plugin(async(url,init)=>{expect(url).toBe(I.MEMBER+'GetSubscriptionStats');sent.push(init.headers.Authorization);return Response.json(stats);},{
    readSession:()=>({uid:legacy.uid,webToken:token,webRefresh:'unspent-desktop-refresh'}),
  });
  await p.auth.usage(async()=>legacy);token='synthetic-desktop-next';await p.auth.usage(async()=>legacy);
  expect(sent).toEqual(['Bearer synthetic-desktop-first','Bearer synthetic-desktop-next']);
  expect(legacy).toEqual({type:'oauth',source:'kimi-work-desktop',uid:'fixture-account'});
});

test('a desktop without refresh still signs in as a usable reference-only account',async()=>{
  const session={uid:'fixture-account',workToken:'synthetic-work-key',webToken:'synthetic-web-access'},calls=[];
  const p=plugin(async(url,init)=>{calls.push(url);return Response.json(url===I.BASE+'/models'?{data:[]}:stats);},{readSession:()=>session});
  const auth=await (await p.auth.methods[0].authorize()).callback();
  expect(auth).toMatchObject({type:'success',source:'kimi-work-desktop',uid:session.uid,accountId:'Kimi Work · fixtur',access:'',refresh:'',expires:0});
  expect((await p.auth.usage(async()=>auth)).windows[0].used).toBe(45.15);
  expect(calls).toEqual([I.BASE+'/models',I.MEMBER+'GetSubscriptionStats']);
});

test('another plugin instance reads the pair persisted by the host without desktop or browser access',async()=>{
  const p=plugin(async()=>Response.json(rotated()));
  const saved={...account(),...await p.auth.refresh(account())};
  const next=plugin(async(url,init)=>{
    expect(url).toBe(I.MEMBER+'GetSubscriptionStats');
    expect(init.headers.Authorization).toBe('Bearer '+saved.access);return Response.json(stats);
  });
  expect(await next.auth.refresh(saved)).toBeUndefined();
  const usage=await next.auth.usage(async()=>saved);
  expect(usage.plan).toBe('月度共享额度');
  expect(usage.windows).toEqual([{name:'本月',used:45.15,display:'Code 已用 24.22%（占总额）'}]);
  expect(usage.windows.every(w=>!('resetsAt' in w))).toBe(true);
});

for(const status of [429,503])test('transient refresh HTTP '+status+' does not declare the login expired',async()=>{
  const p=plugin(async()=>new Response('synthetic secret response',{status}));
  try {await p.auth.refresh(account());throw Error('expected failure');}
  catch(error) {expect(error.signIn).toBeUndefined();expect(error.message).not.toContain('synthetic secret');}
});

test('refused membership renewal and usage keep the independent Work credential usable',async()=>{
  const auth=account(),before=structuredClone(auth),calls=[];let writes=0;
  const p=plugin(async(url,init)=>{
    calls.push(url);
    if(url===I.REFRESH||url===I.MEMBER+'GetSubscriptionStats')return new Response('synthetic secret response',{status:401});
    expect(url).toBe(I.BASE+'/chat/completions');
    expect(new Headers(init.headers).get('authorization')).toBe('Bearer synthetic-work-key');
    return new Response('synthetic Work answer');
  },{readSession:()=>({uid:auth.uid,workToken:'synthetic-work-key'}),client:{auth:{set:async()=>{writes++;}}}});
  const error=await p.auth.refresh(auth).catch(error=>error);
  expect(error).toMatchObject({signIn:'kept',code:'kimi_work_membership_expired',status:401});
  expect(error.message).not.toMatch(/sign-in has (expired|lapsed)|sign in again/i);
  expect(error.message).toContain('重新连接 Kimi Work');
  expect(error.message).toContain('magpie plugin login kimi-work');
  expect(error.message).not.toContain('synthetic secret response');
  expect(await p.auth.usage(async()=>auth)).toMatchObject({signIn:'kept',windows:[]});
  const loader=await p.auth.loader(async()=>auth);
  expect(await (await loader.fetch(I.BASE+'/chat/completions',{method:'POST',body:'{}'})).text()).toBe('synthetic Work answer');
  expect(calls).toEqual([I.REFRESH,I.MEMBER+'GetSubscriptionStats',I.BASE+'/chat/completions']);
  expect(auth).toEqual(before);expect(writes).toBe(0);
});

test('network errors during refresh do not reveal request credentials',async()=>{
  const p=plugin(async()=>{throw Error('synthetic secret request');});
  await expect(p.auth.refresh(account())).rejects.toThrow('登录续期暂不可用');
});

for(const [name,payload] of [['missing refresh',{access_token:rotated().access_token}],['other account',rotated('different-account')],
  ['expired access',{access_token:jwt(account().uid,NOW-1),refresh_token:'synthetic expired'}],['null response',null],
  ['null JWT claims',{access_token:'fixture.'+Buffer.from('null').toString('base64url')+'.fixture',refresh_token:'synthetic'}]])
  test('invalid rotated pair is rejected: '+name,async()=>{
    const p=plugin(async()=>Response.json(payload));
    await expect(p.auth.refresh(account())).rejects.toThrow('续期响应格式无效');
  });

test('different accounts renew independently',async()=>{
  const spent=[];
  const p=plugin(async(url,init)=>{
    const token=JSON.parse(init.body).refresh_token;spent.push(token);
    return Response.json(rotated(token.includes('account-a')?'account-a':'account-b'));
  });
  const results=await Promise.all(['account-a','account-b'].map(uid=>p.auth.refresh(account(uid))));
  expect(spent).toHaveLength(2);
  expect(results.map(x=>x.refresh)).toEqual(['account-a','account-b'].map(uid=>rotated(uid).refresh_token));
});

test('missing monthly data stays unknown instead of using Code short-window counters',async()=>{
  const p=plugin(async()=>Response.json({ratelimitCode5h:{ratio:0.5},ratelimitCode7d:{ratio:0.8}}));
  expect((await p.auth.usage(async()=>({...account(),...fields(rotated())}))).windows).toEqual([]);
});
