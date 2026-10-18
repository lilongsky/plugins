import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';

const ID = 'kimi-work';
const BASE = 'https://agent-gw.kimi.com/coding/v1';
const MEMBER = 'https://www.kimi.com/apiv2/kimi.gateway.membership.v2.MembershipService/';
const REFRESH = 'https://auth.kimi.com/api/account.gateway.v1.AuthService/RefreshToken';
const REFRESH_LEAD = 60000;
const {version} = JSON.parse(fs.readFileSync(new URL('./package.json', import.meta.url), 'utf8'));
const UA = 'Magpie Kimi Work provider/' + version;
const expired = () => Object.assign(Error('请先在本机 Kimi 桌面版登录 Work，再重新连接 Kimi Work 供应商。'), {signIn:'expired',code:'kimi_work_login_expired'});
const unavailable = error => Object.assign(Error('Kimi Work 连接失败：' + (error?.cause?.code || error?.message || '未知网络错误'), {cause:error}), {code:'kimi_work_connection_failed'});
const percent = x => typeof x === 'number' && Number.isFinite(x) ? Math.max(0,Math.min(100,x*100)) : undefined;
const storeFailed = () => Object.assign(Error('Kimi Work 无法保存登录凭证，请检查凭证存储后重试。'), {code:'kimi_work_auth_store_failed'});
function tokenClaims(token) {
  try {return JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));} catch {return {};}
}
const expiry = token => Number(tokenClaims(token).exp) * 1000 || 0;

function desktopFile({home=os.homedir(), platform=process.platform, appdata=process.env.APPDATA}={}) {
  const parent=platform==='win32' ? appdata || path.join(home,'AppData','Roaming')
    : platform==='darwin' ? path.join(home,'Library','Application Support') : path.join(home,'.config');
  return path.join(parent,'kimi-desktop','daimon-share','daimon','config.json');
}

// Work credentials still follow the desktop file. Web credentials are imported
// into the host's private auth store and renewed there, never written here.
function readDesktop(file=desktopFile()) {
  try {
    const st=fs.statSync(file);
    if(!st.isFile() || st.size>8*1024*1024) throw expired();
    const doc=JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,''));
    const work=doc.credentials?.kimiCode, web=doc.credentials?.kimiWeb;
    if(typeof work?.apiKey!=='string'||!work.apiKey || typeof web?.accessToken!=='string'||!web.accessToken
      || typeof web.userId!=='string'||!web.userId || work.baseUrl?.replace(/\/$/,'')!==BASE) throw expired();
    return {workToken:work.apiKey,webToken:web.accessToken,
      webRefresh:typeof web.refreshToken==='string' ? web.refreshToken : '',
      uid:createHash('sha256').update('kimi-work-account\0'+web.userId).digest('hex')};
  } catch {throw expired();}
}

function modelRows(payload) {
  if(!Array.isArray(payload?.data)||payload.has_more||payload.data.length>100) throw Error('Kimi Work 模型目录暂不可用。');
  const out={};
  for(const m of payload.data) {
    if(typeof m.id!=='string'||!m.id||m.id.length>256||/[\x00-\x20/]/.test(m.id)) continue;
    const variants=Object.create(null);
    if(m.reasoningEffortOptions!==undefined&&!Array.isArray(m.reasoningEffortOptions))throw Error('Kimi Work 思考档位格式无效。');
    for(const x of m.reasoningEffortOptions||[]) {
      const effort=String(x.effort||'').replace(/^REASONING_EFFORT_/,'').toLowerCase();
      if(!/^[a-z][a-z0-9_-]{0,63}$/.test(effort))throw Error('Kimi Work 思考档位格式无效。');
      variants[effort]={reasoningEffort:effort};
    }
    out[m.id]={id:m.id,name:m.display_name||m.id,
      api:{id:m.id,url:BASE,npm:'@ai-sdk/openai-compatible'},
      // The server lists the plan's maximum XL context; default to standard
      // context rather than silently asking for a more expensive XL session.
      limit:{context:Math.min(Number(m.context_length)||262144,262144),output:32768},
      capabilities:{reasoning:!!m.supports_reasoning,toolcall:true,attachment:!!m.supports_image_in,
        input:{text:true,image:!!m.supports_image_in,video:false,audio:false,pdf:false},output:{text:true}},
      variants};
  }
  if(!Object.keys(out).length)throw Error('Kimi Work 模型目录为空。');
  return out;
}

function createPlugin({client,readSession=readDesktop,fetchImpl=globalThis.fetch,now=Date.now}={}) {
  const current=auth=>{
    const session=readSession();
    if(auth?.source!=='kimi-work-desktop'||auth.uid!==session.uid)throw expired();
    return session;
  };
  async function jsonRequest(url,token,body,signal) {
    const response=await fetchImpl(url,{method:body===undefined?'GET':'POST',
      headers:{...(token?{Authorization:'Bearer '+token}:{}),'User-Agent':UA,'Accept':'application/json',
        ...(body===undefined?{}:{'Content-Type':'application/json','Connect-Protocol-Version':'1'})},
      ...(body===undefined?{}:{body:JSON.stringify(body)}),signal:signal||AbortSignal.timeout(15000),redirect:'error'});
    if(response.status===401)throw expired();
    if(!response.ok)throw Error('Kimi Work 服务暂不可用（HTTP '+response.status+'）。');
    if(Number(response.headers.get('content-length')||0)>2*1024*1024)throw Error('Kimi Work 响应过大。');
    const text=await response.text();
    if(Buffer.byteLength(text)>2*1024*1024)throw Error('Kimi Work 响应过大。');
    try{return JSON.parse(text);}catch{throw Error('Kimi Work 响应格式无效。');}
  }
  // Share renewal between auth.refresh and usage, including the interval
  // before the host saves auth.refresh's result. Keep a rotated pair in memory
  // if saving fails so a retry never spends the previous refresh token again.
  const renewing=new Map(), renewed=new Map();
  const valid=auth=>auth?.source==='kimi-work-desktop' && typeof auth.uid==='string' && !!auth.uid;
  const latest=auth=>{
    const r=renewed.get(auth.uid);
    return r && (auth.refresh===r.spent || auth.refresh===r.next.refresh) ? {...auth,...r.next} : auth;
  };
  const due=auth=>auth.expires>0 && auth.expires<=now()+REFRESH_LEAD;
  async function save(getAuth, before, next) {
    if(!client?.auth?.set)throw storeFailed();
    const current=await getAuth();
    // Do not restore a login removed or replaced while the request was away.
    if(!valid(current) || current.uid!==before.uid ||
      (current.refresh!==before.refresh && current.refresh!==next.refresh))throw expired();
    try {
      const result=await client.auth.set({path:{id:ID},body:{...current,type:'oauth',
        access:next.access,refresh:next.refresh,expires:next.expires}});
      if(result?.error)throw storeFailed();
    } catch {throw storeFailed();}
  }
  async function webAuth(getAuth) {
    let auth=await getAuth();
    if(!valid(auth))throw expired();
    if(!auth.access || !auth.refresh) {
      const s=current(auth);
      if(!s.webRefresh)throw expired();
      const imported={...auth,access:s.webToken,refresh:s.webRefresh,expires:expiry(s.webToken)};
      await save(getAuth,auth,imported);auth=imported;
    }
    const next=latest(auth);
    if(next.access!==auth.access || next.refresh!==auth.refresh)await save(getAuth,auth,next);
    return next;
  }
  async function renew(auth,force=false) {
    if(!valid(auth) || !auth.access || !auth.refresh)throw expired();
    const pending=renewing.get(auth.uid);
    if(pending) {await pending;return renew(auth,force);}
    const a=latest(auth);
    if(force ? a.access!==auth.access : !due(a))return a;
    const run=(async()=>{
      let j;
      try {j=await jsonRequest(REFRESH,undefined,{refresh_token:a.refresh});}
      catch(error) {
        if(error?.signIn==='expired')throw error;
        throw Error('Kimi Work 登录续期暂不可用，请稍后重试。');
      }
      const access=j.access_token??j.accessToken,refresh=j.refresh_token??j.refreshToken;
      const expires=expiry(access),oldSub=tokenClaims(a.access).sub,newSub=tokenClaims(access).sub;
      if(typeof access!=='string'||!access||typeof refresh!=='string'||!refresh||expires<=now()||!Number.isFinite(expires)
        || (oldSub && newSub && oldSub!==newSub))throw Error('Kimi Work 续期响应格式无效。');
      const pair={access,refresh,expires};
      renewed.set(a.uid,{spent:a.refresh,next:pair});
      return {...a,...pair};
    })();
    renewing.set(a.uid,run);
    try {return await run;} finally {renewing.delete(a.uid);}
  }
  async function membership(getAuth) {
    const before=await webAuth(getAuth);
    // Refuse to consume a refresh token when the host cannot save its result.
    if(due(before) && !client?.auth?.set)throw storeFailed();
    let auth=await renew(before);
    const rotated=auth.access!==before.access || auth.refresh!==before.refresh;
    if(rotated)await save(getAuth,before,auth);
    try {return await jsonRequest(MEMBER+'GetSubscriptionStats',auth.access,{});}
    catch(error) {
      if(error?.signIn!=='expired' || rotated)throw error;
      if(!client?.auth?.set)throw storeFailed();
      const next=await renew(auth,true);
      await save(getAuth,auth,next);
      return jsonRequest(MEMBER+'GetSubscriptionStats',next.access,{});
    }
  }
  return {
    config:async cfg=>{
      cfg.provider??={};
      cfg.provider[ID]??={name:'Kimi Work',npm:'@ai-sdk/openai-compatible',api:BASE,
        models:{'k3-agent':{name:'K3 · Work',limit:{context:262144,output:32768},tool_call:true,reasoning:true}}};
    },
    auth:{
      provider:ID,
      maxConcurrency:1,
      methods:[{type:'oauth',label:'使用本机 Kimi Work 登录',authorize:async()=>({
        url:'',method:'auto',instructions:'导入本机 Work 会员登录，保存并自动续期；不会使用 Kimi Code API Key或修改桌面配置。',
        callback:async()=>{
          try{
            const s=readSession();
            if(!s.webRefresh)throw expired();
            await jsonRequest(BASE+'/models',s.workToken);
            return {type:'success',access:s.webToken,refresh:s.webRefresh,expires:expiry(s.webToken),source:'kimi-work-desktop',
              accountId:'Kimi Work (local)',uid:s.uid};
          }catch{return {type:'failed',error:'没有可用的本机 Kimi Work 登录，请先打开 Kimi 并登录 Work。'};}
        },
      })}],
      refreshLead:REFRESH_LEAD,
      async refresh(auth) {
        if(!valid(auth) || !auth.access || !auth.refresh)return;
        const next=await renew(auth);
        if(next.access!==auth.access || next.refresh!==auth.refresh)
          return {access:next.access,refresh:next.refresh,expires:next.expires};
      },
      loader:async getAuth=>({
        baseURL:BASE,apiKey:'local-desktop-session',
        async fetch(input,init={}) {
          const request=input instanceof Request?new Request(input,init):null;
          const url=new URL(request?request.url:String(input));
          if(url.origin!==new URL(BASE).origin||url.pathname!=='/coding/v1/chat/completions'
            ||url.username||url.password||url.search||url.hash||(request?.method||init.method||'POST')!=='POST') {
            throw Error('Kimi Work 仅接受官方 Work 网关的模型请求。');
          }
          const s=current(await getAuth());
          const headers=new Headers(request?request.headers:init.headers);
          for(const key of ['authorization','x-api-key','cookie','host','content-length','origin'])headers.delete(key);
          headers.set('Authorization','Bearer '+s.workToken);
          headers.set('User-Agent',UA);
          headers.set('Content-Type','application/json');
          // Preserve messages, tools, stream and abort signal. There is no
          // fallback to api.kimi.com, a Code API key, or another provider.
          const options=request?{...init,body:request.body,signal:request.signal,duplex:'half'}:init;
          let response;
          try { response=await fetchImpl(BASE+'/chat/completions',{...options,method:'POST',headers,redirect:'error'}); }
          catch(error) { if(options.signal?.aborted)throw error; throw unavailable(error); }
          if(response.status===401) { await response.body?.cancel(); throw expired(); }
          // Magpie classifies rate vs quota from the upstream response. Keep
          // its wording, reset details and Retry-After instead of guessing.
          return response;
        },
      }),
      usage:async getAuth=>{
        const j=await membership(getAuth);
        const b=j.subscriptionBalance,used=percent(b?.amountUsedRatio);
        const windows=used===undefined?[]:[{name:'月度共享额度',used}];
        const code=percent(b?.kimiCodeUsedRatio);
        if(used!==undefined && code!==undefined)windows.push({name:'其中 Kimi Code（月度总额占比）',used:code,aside:true});
        return {plan:'Kimi Work · 月度共享额度',windows};
      },
    },
    provider:{id:ID,models:async(provider,{auth}={})=>{
      if(auth?.source!=='kimi-work-desktop')return provider.models;
      const s=current(auth);return modelRows(await jsonRequest(BASE+'/models',s.workToken));
    }},
  };
}

export default async function KimiWorkProvider({client}={}){return createPlugin({client});}
export const _internal={createPlugin,readDesktop,desktopFile,modelRows,BASE,MEMBER,REFRESH,REFRESH_LEAD,UA,expiry};
