'use strict';
const $=id=>document.getElementById(id);
const pages={overview:'总览',opportunities:'机会清单',keywords:'关键词监控',content:'内容追踪',optimizations:'优化记录',monthly:'月度数据表',blog:'博客数据总结表'};
const state={page:'overview',sites:[],snapshots:[],records:[],content:[],keywords:[],overrides:[],ignored:[],notes:{},guidance:{},session:null,admin:false,loading:true,error:null,loadId:0,oppCat:'',editing:null};
const SECTIONS=['overview','opportunities','keywords','content','monthly','pages','blog_summary'];
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt=(v,d=0)=>v==null||Number.isNaN(+v)?'—':Number(v).toLocaleString('zh-CN',{maximumFractionDigits:d});
const percent=(v,d=2)=>v==null?'—':`${fmt(v*100,d)}%`;
const site=()=>state.sites.find(s=>s.id===$('site').value);
const month=()=>$('month').value+'-01';
const shiftMonth=(m,n)=>{const d=new Date(m.slice(0,7)+'-01T00:00:00Z');d.setUTCMonth(d.getUTCMonth()+n);return d.toISOString().slice(0,10);};
const daysIn=m=>new Date(Date.UTC(+m.slice(0,4),+m.slice(5,7),0)).getUTCDate();
const keyPath=u=>{try{const x=new URL(u,'https://x.invalid');return x.pathname+x.search;}catch{return String(u??'');}};
const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Singapore',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
function message(text,error=false){$('notice').innerHTML=text?`<div class="note ${error?'error':''}">${esc(text)}</div>`:'';}
async function request(path,{method='GET',body,auth=false,prefer}={}){
 if(auth&&!state.session)throw Error('请先登录管理员');
 const headers={apikey:SEO_CONFIG.key,'Content-Type':'application/json'};
 if(state.session)headers.Authorization='Bearer '+state.session.access_token;
 if(prefer)headers.Prefer=prefer;
 const r=await fetch(SEO_CONFIG.url+path,{method,headers,body:body===undefined?undefined:JSON.stringify(body)});
 const raw=await r.text();let data;try{data=raw?JSON.parse(raw):null;}catch{throw Error('服务返回无法识别的内容');}
 if(!r.ok){if(r.status===401&&state.session){state.session=null;state.admin=false;state.notes={};state.guidance={};}
  throw Object.assign(Error(data?.msg||data?.message||data?.error_description||`连接失败 (${r.status})`),{code:data?.code});}return data;
}
async function rows(table,query=''){return await request('/rest/v1/'+table+'?'+query);}
async function paged(t,q){let result=[];for(let offset=0;;offset+=500){const batch=await rows(t,q+'&limit=500&offset='+offset);result.push(...batch);if(batch.length<500)return result;}}
function empty(title='尚无该月份数据',detail='待导入原始导出并核对后显示，不将缺失数据记为 0。'){return `<div class="empty"><strong>${esc(title)}</strong>${esc(detail)}</div>`;}
function panel(title,body,extra=''){return `<div class="panel"><div class="topline"><h2>${title}</h2>${extra}</div>${body}</div>`;}
function change(now,prev){if(now==null||prev==null||prev===0)return null;return now/prev-1;}
function changeHtml(v,invert=false){if(v==null)return '<span class="muted">—</span>';const good=invert?v<0:v>0;return `<span class="${v===0?'':good?'positive':'negative'}">${v>0?'+':''}${fmt(v*100,1)}%</span>`;}
function cell(v,type){
 if(type==='pct')return esc(percent(v));
 if(type==='url')return /^https:\/\//.test(v||'')?`<a href="${esc(v)}" target="_blank" rel="noopener noreferrer">${esc(v.replace(/^https:\/\/[^/]+/,'')||'/')}</a>`:esc(v??'—');
 if(type==='change')return changeHtml(v);
 if(type==='pos')return v==null?'—':esc(fmt(v,1));
 if(type==='money')return v==null?'—':'$'+esc(fmt(v,0));
 if(type==='badge')return v?`<span class="badge ${/错位|待|无曝光|未|已发现|已抓取/.test(v)?'pending':''}">${esc(v)}</span>`:'—';
 if(type==='prio')return v?`<span class="badge prio-${v==='高'?'high':v==='中'?'mid':'low'}">${esc(v)}</span>`:'—';
 if(type==='html')return v??'—';
 if(type==='bool')return v?'是':'<span class="muted">否</span>';
 return typeof v==='number'?esc(fmt(v,2)):esc(v??'—');
}
function table(columns,data,{emptyTitle,emptyDetail}={}){if(!data.length)return empty(emptyTitle,emptyDetail);return '<div class="table-wrap"><table><thead><tr>'+columns.map(c=>`<th>${esc(c[1])}</th>`).join('')+'</tr></thead><tbody>'+data.map(row=>'<tr>'+columns.map(([k,,type])=>`<td class="${typeof row[k]==='number'||['pct','pos','money','prio','badge','change','bool'].includes(type)?'nw':''}">${cell(row[k],type)}</td>`).join('')+'</tr>').join('')+'</tbody></table></div>';}
function snapshot(section,siteId=$('site').value,m=month()){return state.snapshots.find(s=>s.section===section&&s.site_id===siteId&&s.month===m);}
function filtered(data){const q=$('search').value.toLowerCase().trim();return q?data.filter(r=>Object.values(r).some(v=>String(v??'').toLowerCase().includes(q))):data;}
function source(s){const notes=state.admin&&state.notes[s?.id];return notes?`<details class="hint"><summary>数据来源与口径${s.published?'':' · 草稿'}</summary><pre class="mono">${esc(JSON.stringify(notes.provenance,null,2))}</pre></details>`:'';}
function card(label,value,subtitle){return `<div class="card"><div class="label">${esc(label)}</div><div class="value">${value}</div><div class="hint">${subtitle}</div></div>`;}
function mom(now,prev,m,{daily=true,invert=false}={}){const c=change(now,prev);if(c==null)return '环比 —';let s='环比 '+changeHtml(c,invert);if(daily&&now!=null&&prev){const d=(now/daysIn(m))/(prev/daysIn(shiftMonth(m,-1)))-1;s+='，日均 '+changeHtml(d,invert);}return s;}
function blogOverview(sid,m){
 const data=snapshot('pages',sid,m)?.payload?.blog_overview||{};
 const previous=snapshot('pages',sid,shiftMonth(m,-1))?.payload?.blog_overview||{};
 const g=data.gsc?.source==='filtered_dates'?data.gsc:{},a=data.ga4||{},n=a.organic||{};
 const pg=g.source&&previous.gsc?.source===g.source?previous.gsc:{};
 const pa=a.full_month&&previous.ga4?.full_month?previous.ga4:{};
 const pn=pa.organic||{};
 const money=v=>v==null?'—':'US$'+fmt(v);
 const seconds=v=>v==null?'—':fmt(v)+' 秒';
 const channelCard=(label,key)=>{
  const row=a[key]||{};
  return card(label,row.sessions==null?'—':fmt(row.sessions)+' <small>会话</small>',
   `订单 ${fmt(row.purchases)}，收入 ${money(row.revenue)}，${mom(row.sessions,pa[key]?.sessions,m,{daily:false})}`);
 };
 const gscNote=g.source?'':'<p class="hint">待导入本月 GSC「网页包含 /blogs/」的整月日期数据。</p>';
 const gaNote=data.ga4&&!a.full_month?`<p class="hint">${esc(a.date_range?`GA4 着陆页数据覆盖 ${a.date_range}`:'GA4 着陆页数据日期范围未确认')}。</p>`:'';
 return `<section class="blog-overview"><h2>博客自然渠道</h2>
  <h3 class="section-title">Google Search Console</h3>${gscNote}<div class="cards">
  ${card('GSC 点击',fmt(g.clicks),mom(g.clicks,pg.clicks,m))}${card('GSC 曝光',fmt(g.impressions),mom(g.impressions,pg.impressions,m))}
  ${card('点击率',percent(g.ctr),'上月 '+percent(pg.ctr))}${card('平均排名',fmt(g.position,1),'上月 '+fmt(pg.position,1))}</div>
  <h3 class="section-title">GA4 自然流量（自然搜索、自然购物、自然社交、自然视频、AI 助手合计）</h3>${gaNote}<div class="cards">
  ${card('自然会话',fmt(n.sessions),mom(n.sessions,pn.sessions,m))}
  ${card('订单',fmt(n.purchases),mom(n.purchases,pn.purchases,m,{daily:false}))}
  ${card('收入',money(n.revenue),mom(n.revenue,pn.revenue,m,{daily:false}))}
  ${card('转化率（订单 ÷ 会话）',percent(n.conversion),'上月 '+percent(pn.conversion))}</div>
  <div class="cards">${channelCard('其中 Google 自然搜索','google_organic')}${channelCard('其中 AI 助手','ai')}
  ${card('平均停留时长',seconds(a.avg_engagement),'上月 '+seconds(pa.avg_engagement))}
  ${card('跳出率',percent(a.bounce_rate),'上月 '+percent(pa.bounce_rate))}</div></section>`;
}

// ---------------------------------------------------------------- overview
function overview(){
 const s=snapshot('overview'),p=s?.payload;if(!p)return empty();
 const prev=snapshot('overview',$('site').value,shiftMonth(month(),-1))?.payload||{};
 const g=p.gsc||{},pg=prev.gsc||{},o=p.ga4?.organic||{},po=prev.ga4?.organic||{},m=month();
 let html=`<h3 class="section-title">Google Search Console</h3><div class="cards">
 ${card('GSC 点击',fmt(g.clicks),mom(g.clicks,pg.clicks,m))}${card('GSC 曝光',fmt(g.impressions),mom(g.impressions,pg.impressions,m))}
 ${card('点击率',percent(g.ctr),'上月 '+percent(pg.ctr))}${card('平均排名',fmt(g.position,1),'上月 '+fmt(pg.position,1)+'（数值越小越好）')}</div>
 <h3 class="section-title">GA4 自然流量（自然搜索、自然购物、自然社交、自然视频、AI 助手合计）</h3><div class="cards">
 ${card('自然会话',fmt(o.sessions),mom(o.sessions,po.sessions,m))}${card('订单',fmt(o.purchases),mom(o.purchases,po.purchases,m,{daily:false}))}
 ${card('收入','$'+fmt(o.revenue,0),mom(o.revenue,po.revenue,m,{daily:false}))}${card('转化率（订单 ÷ 会话）',percent(o.conversion),'上月 '+percent(po.conversion))}</div>`;
 const go=p.ga4?.google_organic||{},ai=p.ga4?.ai||{},pgo=prev.ga4?.google_organic||{},pai=prev.ga4?.ai||{};
 html+=`<div class="cards">${card('其中 Google 自然搜索',fmt(go.sessions)+' <small>会话</small>',`订单 ${fmt(go.purchases)}，收入 $${fmt(go.revenue,0)}；${mom(go.sessions,pgo.sessions,m,{daily:false})}`)}
 ${card('其中 AI 助手',fmt(ai.sessions)+' <small>会话</small>',`订单 ${fmt(ai.purchases)}，收入 $${fmt(ai.revenue,0)}；${mom(ai.sessions,pai.sessions,m,{daily:false})}`)}
 ${card('Google 自然会话 ÷ GSC 点击',g.clicks&&go.sessions!=null?fmt(go.sessions/g.clicks,2):'—',state.admin?esc(state.guidance.session_ratio):'')}
 ${state.admin?card('数据提醒',String((state.notes[s.id]?.checks||[]).length),(state.notes[s.id]?.checks||[]).map(esc).join('<br>')||'无'):''}</div>`;
 html+=blogOverview($('site').value,m);
 html+=panel('月度趋势',trendTable());
 html+=panel('自然渠道汇总',table([['channel','渠道'],['sessions','会话'],['purchases','订单'],['revenue','收入','money'],['conversion','转化率','pct']],p.ga4?.by_channel||[]));
 const channels=(p.ga4?.channels||[]).map(({note,...row},i)=>state.admin?{...row,note:state.notes[s.id]?.channel_notes[i]}:row);
 const channelColumns=[['channel','渠道'],['source_medium','来源 / 媒介'],['sessions','会话'],['purchases','订单'],['revenue','收入','money'],['included','计入自然','bool']];
 if(state.admin)channelColumns.push(['note','说明']);
 html+=panel('来源 / 媒介明细',table(channelColumns,filtered(channels))+(state.admin?`<p class="hint">${esc(state.guidance.channels)}</p>`:''));
 html+=`<div class="grid2">${panel('设备表现',table([['device','设备'],['clicks','点击'],['impressions','曝光'],['ctr','点击率','pct'],['position','排名','pos']],p.devices||[]))}${panel('国家表现（前 15）',table([['country','国家'],['clicks','点击'],['impressions','曝光'],['ctr','点击率','pct'],['position','排名','pos']],p.countries||[]))}</div>`;
 return html+source(s);
}
function trendTable(){
 const sid=$('site').value,ms=[...new Set([...state.snapshots.filter(x=>x.site_id===sid&&(x.section==='overview'||x.section==='monthly')&&x.month<=month()).map(x=>x.month),...state.overrides.filter(x=>x.site_id===sid&&x.grid==='monthly'&&x.month<=month()).map(x=>x.month)])].sort().slice(-12);
 if(!ms.length)return empty('趋势待导入','导入两个月以上的数据后显示按月趋势。');
 const data=ms.map(m=>{const o=snapshot('overview',sid,m)?.payload||{},mo=snapshot('monthly',sid,m)?.payload||{};const g=o.gsc||{},n=o.ga4?.organic||{},O=ovMap('monthly',sid,m),kw=monthlyRaw('rank_total',mo,sid,m,O).v;
  return {month:m.slice(0,7),clicks:g.clicks??monthlyRaw('gsc_clicks',mo,sid,m,O).v,impr:g.impressions??monthlyRaw('gsc_impressions',mo,sid,m,O).v,ctr:g.ctr,pos:g.position,sessions:n.sessions,orders:n.purchases,revenue:n.revenue,ai:o.ga4?.ai?.sessions,kw,kwtool:kw==null?null:'Semrush'};});
 const max=Math.max(1,...data.map(d=>d.clicks||0));
 const bars=`<div class="bars" role="img" aria-label="GSC 点击按月趋势">${data.map(d=>`<div class="bar-item"><strong>${fmt(d.clicks)}</strong><div class="bar" style="height:${Math.max(2,(d.clicks||0)/max*120)}px"></div>${esc(d.month)}</div>`).join('')}</div>`;
 return bars+table([['month','月份'],['clicks','GSC 点击'],['impr','GSC 曝光'],['ctr','点击率','pct'],['pos','平均排名','pos'],['sessions','自然会话'],['orders','订单'],['revenue','收入','money'],['ai','AI 会话'],['kw','关键词总数'],['kwtool','排名工具']],data);
}

// ---------------------------------------------------------------- opportunities
const OPP_GROUPS=['核心页面','下滑页面','同产品合计','排名11–20（产品/集合页）','排名11–20（博客）','排名11–20（其他）','点击率偏低','错位：实际页面≠规划页面','机会词：未规划承接页','互动差','流量高、转化低','流量低、转化高','未收录','新文章无曝光','广告有转化、自然排名弱'];
const IGNORED_OPPORTUNITIES='已忽略';
function opportunities(){
 const s=snapshot('opportunities'),sid=$('site').value;
 const ignored=new Map(state.ignored.filter(r=>r.site_id===sid).map(r=>[r.page_key,r]));
 const all=(s?.payload?.rows||[]).map(({action,...r},i)=>{
  const match=r.page_url&&ignored.get(keyPath(r.page_url));
  const row=match?{...r,category:IGNORED_OPPORTUNITIES,reason:state.admin?match.reason:undefined}:r;
  return state.admin?{...row,action:state.notes[s.id]?.actions[i]}:row;
 });
 const counts={[IGNORED_OPPORTUNITIES]:0};all.forEach(r=>counts[r.category]=(counts[r.category]||0)+1);
 const cats=[...OPP_GROUPS.filter(c=>counts[c]),...Object.keys(counts).filter(c=>!OPP_GROUPS.includes(c))];
 const cat=cats.includes(state.oppCat)?state.oppCat:'';
 const showIgnored=cat===IGNORED_OPPORTUNITIES;
 const chips=`<div class="chips"><button class="chip ${cat?'':'active'}" data-cat="">全部 ${all.length-counts[IGNORED_OPPORTUNITIES]}</button>${cats.map(c=>`<button class="chip ${cat===c?'active':''}" data-cat="${esc(c)}">${esc(c)} ${counts[c]}</button>`).join('')}</div>`;
 const queued=new Set(state.records.filter(r=>r.site_id===sid&&!r.optimized_on).map(r=>keyPath(r.page_url)));
 const data=filtered(all.filter(r=>cat?r.category===cat:r.category!==IGNORED_OPPORTUNITIES)).map(r=>{
   if(!state.admin)return r;
   if(showIgnored)return {...r,queue:`<button class="link nw" data-restore-ignore="${esc(r.page_url)}">恢复</button>`};
   const added=r.page_url&&queued.has(keyPath(r.page_url));
   return {...r,queue:`<div class="opportunity-actions"><button class="link nw" data-queue="${esc(r.page_url)}" ${added||!r.page_url?'disabled':''} ${!r.page_url?'title="该机会暂无页面网址"':''}>${added?'已加入':'加入优化清单'}</button>
   ${r.page_url?`<button class="link muted" data-ignore-page="${esc(r.page_url)}">忽略</button>`:''}</div>`};
  });
 const columns=[['priority','优先级','prio'],['category','类型'],['page_url','页面','url'],['query','查询词'],['impressions','曝光'],['clicks','点击'],['ctr','点击率','pct'],['position','排名','pos'],['sessions','自然会话'],['purchases','订单'],['evidence','判断依据']];
 if(state.admin)columns.push(showIgnored?['reason','忽略原因']:['action','建议动作'],['queue','操作','html']);
 const dialog=state.admin?`<dialog id="ignore-dialog"><form id="ignore-form"><h2>忽略页面</h2><p id="ignore-page"></p>
  <label>忽略原因<textarea name="reason" maxlength="500" required></textarea></label>
  <p id="ignore-error" role="alert"></p>
  <div class="actions"><button type="submit" class="primary">确认忽略</button><button type="button" id="cancel-ignore">取消</button></div></form></dialog>`:'';
 const rules=state.admin&&(state.guidance.opportunities||[]);
 return panel('待处理机会',chips+table(columns,data,showIgnored?{emptyTitle:'本月暂无已忽略的机会',emptyDetail:''}:{}))+dialog
  +(rules?.length?panel('判断口径',`<ul class="rule-list">${rules.map(r=>`<li>${esc(r)}</li>`).join('')}</ul>`):'')+source(s);}

// ---------------------------------------------------------------- editable cells (shared)
const pathOf=u=>{try{const x=new URL(u,'https://x.invalid');return (decodeURI(x.pathname).replace(/\/+$/,'')||'/').toLowerCase();}catch{return String(u||'').toLowerCase();}};
const dur=v=>v==null?'':`${Math.floor(v/60)} 分 ${String(Math.round(v%60)).padStart(2,'0')} 秒`;
const durCopy=v=>{if(v==null)return '';v=Math.round(v);return `${Math.floor(v/3600)}:${String(Math.floor(v%3600/60)).padStart(2,'0')}:${String(v%60).padStart(2,'0')}`;};
function ovMap(grid,siteId,m){const o={};state.overrides.filter(x=>x.grid===grid&&x.site_id===siteId&&x.month===m).forEach(x=>{(o[x.row_key]??={})[x.col]=x.value;});return o;}
function edAttr(kind,{id='',col,type='text',row='',site='',grid='',trigger='dbl',month:mo=''}){return ` data-ed="${kind}" data-trigger="${trigger}" data-id="${esc(id)}" data-col="${esc(col)}" data-type="${type}" data-row="${esc(row)}" data-site="${esc(site)}" data-grid="${esc(grid)}" data-month="${esc(mo)}"`;}
function parseDur(v){let m;if((m=v.match(/^(\d+)\s*分\s*(\d+)\s*秒$/)))return +m[1]*60+ +m[2];if((m=v.match(/^(\d+)\s*秒$/)))return +m[1];if((m=v.match(/^(\d+):(\d{1,2})(?::(\d{1,2}))?$/)))return m[3]!=null?+m[1]*3600+ +m[2]*60+ +m[3]:+m[1]*60+ +m[2];if(/^\d+(\.\d+)?$/.test(v))return Math.round(+v);throw Error('时长可以写成 1:27、0:01:27、87（秒）或 1 分 27 秒');}
const PARSE={
 mnum:v=>{const t=v.replace(/[,\s，]/g,'');const w=/^[\d.]+[wW万]$/.test(t);const n=Number(w?t.slice(0,-1):t);if(!Number.isFinite(n)||n<0)throw Error('请输入数字，曝光量可以写 1.06w');return w?Math.round(n*10000):n;},
 int:v=>{const n=Number(v.replace(/[,\s，]/g,''));if(!Number.isInteger(n)||n<0)throw Error('请输入不小于 0 的整数');return n;},
 num:v=>{const n=Number(v.replace(/[,\s，$]/g,''));if(!Number.isFinite(n))throw Error('请输入数字');return n;},
 pct:v=>{const t=v.replace(/\s/g,'');const n=t.endsWith('%')?Number(t.slice(0,-1))/100:Number(t);if(!Number.isFinite(n))throw Error('请输入百分比，例如 2.5% 或 0.025');return n;},
 pos:v=>{const n=Number(v);if(!Number.isFinite(n)||n<=0)throw Error('排名请输入大于 0 的数字');return n;},
 dur:parseDur,
 date:v=>{if(!/^\d{4}-\d{2}-\d{2}$/.test(v))throw Error('日期格式为 YYYY-MM-DD');return v;},
 text:v=>v,long:v=>v,
 url:(v,ds)=>{const s=state.sites.find(x=>x.id===ds.site)||site();const u=new URL(v.startsWith('/')?'https://'+s.domain+v:v);if(u.protocol!=='https:'||u.hostname.replace(/^www\./,'')!==s.domain.replace(/^www\./,''))throw Error(`网址必须是 https://${s.domain} 下的页面`);return u.href;}};
// Edits are staged in the browser and written to the database only when 更新 is pressed.
let editing=null;const pending=new Map();
const EDIT_PAGES=['keywords','content','monthly','blog'];
const pendKey=ds=>ds.ed==='ov'?['ov',ds.grid,ds.site,ds.month||month(),ds.row,ds.col].join('|'):[ds.ed,ds.id,ds.col].join('|');
function stageValue(ds,raw){
 const parse=PARSE[ds.type]||PARSE.text;let val;
 if(ds.ed==='ov'){val=raw===''?null:raw==='-'||raw==='—'?'':String(parse(raw,ds));}
 else{val=raw===''?null:parse(raw,ds);if(val==null&&(ds.col==='url'||ds.col==='keyword'))throw Error(ds.col==='url'?'网址不能为空':'关键词不能为空');}
 return val;}
function stage(td,raw){
 const ds={...td.dataset},k=pendKey(ds),prev=pending.get(k),orig=prev?prev.orig:(td.dataset.raw??'');
 if(raw.trim()===orig.trim()){pending.delete(k);return;}
 const val=stageValue(ds,raw.trim());
 pending.set(k,{ds,raw:raw.trim(),val,orig,page:state.page,month:ds.month||month()});}
function startEdit(td,ev){
 if(ev&&(ev.target.closest('.cell-input')||(td.dataset.trigger==='click'&&ev.target.closest('a'))))return;
 if(!state.admin){message('登录管理员后可以编辑单元格。');return;}
 if(editing)return;
 const type=td.dataset.type,cur=td.dataset.raw??'',long=type==='long';
 const el=document.createElement(long?'textarea':'input');el.className='cell-input';if(type==='date')el.type='date';el.value=cur;
 td.classList.add('editing');td.innerHTML='';td.appendChild(el);
 let done=false;
 const finish=(keep,fromBlur)=>{if(done)return;
  if(keep){try{if(el.value.trim()!==cur.trim())stage(td,el.value);}catch(e){message(e.message,true);if(!fromBlur){el.focus();return;}}}
  done=true;editing=null;render();};
 editing={td,finish};if($('pending-save')){$('pending-save').disabled=$('pending-cancel').disabled=false;}el.focus();if(type!=='date'&&el.select)el.select();
 el.onkeydown=e=>{if(e.key==='Escape'){e.preventDefault();finish(false);}else if(e.key==='Enter'&&(!long||e.ctrlKey||e.metaKey)){e.preventDefault();finish(true);}};
 el.onblur=()=>finish(true,true);}
// While a cell is open, pressing another cell or a page button first keeps the typed value,
// then continues with what was pressed (the page is redrawn in between).
document.addEventListener('mousedown',e=>{
 if(!editing||editing.td.contains(e.target))return;
 const cell=e.target.closest('[data-ed]'),btn=e.target.closest('button[id]');
 if(!cell&&!btn)return;
 e.preventDefault();const k=cell?.dataset.k,id=btn?.id;editing.finish(true,true);
 if(k){const n=document.querySelector(`[data-k="${CSS.escape(k)}"]`);if(n)startEdit(n);}else if(id)$(id)?.click();},true);
function pagePending(){return [...pending.entries()].filter(([,v])=>v.page===state.page);}
function viewWithPending(fn){
 if(!pending.size)return fn();
 const base={content:state.content,keywords:state.keywords,overrides:state.overrides};
 const patch=(list,ed)=>list.map(r=>{let x=r;pending.forEach(v=>{if(v.ds.ed===ed&&String(r.id)===v.ds.id){x=x===r?{...r}:x;x[v.ds.col]=v.val;}});return x;});
 let ov=state.overrides;
 pending.forEach(v=>{if(v.ds.ed!=='ov')return;const d=v.ds,m=v.month;ov=ov.filter(o=>!(o.grid===d.grid&&o.site_id===d.site&&o.month===m&&o.row_key===d.row&&o.col===d.col));
  if(v.val!==null)ov=[...ov,{grid:d.grid,site_id:d.site,month:m,row_key:d.row,col:d.col,value:v.val}];});
 Object.assign(state,{content:patch(base.content,'content'),keywords:patch(base.keywords,'keyword'),overrides:ov});
 try{return fn();}finally{Object.assign(state,base);}}
async function savePending(){
 const items=pagePending();if(!items.length)return;
 $('pending-save').disabled=$('pending-cancel').disabled=true;$('pending-save').textContent='保存中…';
 const doneKeys=[];
 try{
  for(const [ed,table,list] of [['content','seo_content',state.content],['keyword','seo_keywords',state.keywords]]){
   const byId={};items.filter(([,v])=>v.ds.ed===ed).forEach(([k,v])=>{(byId[v.ds.id]??={body:{},keys:[]}).body[v.ds.col]=v.val;byId[v.ds.id].keys.push(k);});
   for(const [id,g] of Object.entries(byId)){
    const [row]=await request(`/rest/v1/${table}?id=eq.${encodeURIComponent(id)}`,{method:'PATCH',auth:true,body:g.body,prefer:'return=representation'});
    const i=list.findIndex(x=>String(x.id)===id);if(row&&i>=0)list[i]=row;doneKeys.push(...g.keys);}}
  const ov=items.filter(([,v])=>v.ds.ed==='ov'),same=(o,v)=>o.grid===v.ds.grid&&o.site_id===v.ds.site&&o.month===v.month&&o.row_key===v.ds.row&&o.col===v.ds.col;
  const ups=ov.filter(([,v])=>v.val!==null);
  if(ups.length){const rows=await request('/rest/v1/seo_cell_overrides?on_conflict=grid,site_id,month,row_key,col',{method:'POST',auth:true,
    body:ups.map(([,v])=>({grid:v.ds.grid,site_id:v.ds.site,month:v.month,row_key:v.ds.row,col:v.ds.col,value:v.val})),prefer:'resolution=merge-duplicates,return=representation'});
   state.overrides=state.overrides.filter(o=>!ups.some(([,v])=>same(o,v))).concat(rows||[]);doneKeys.push(...ups.map(([k])=>k));}
  const dels=ov.filter(([,v])=>v.val===null),ids=state.overrides.filter(o=>dels.some(([,v])=>same(o,v))).map(o=>o.id);
  if(ids.length)await request(`/rest/v1/seo_cell_overrides?id=in.(${ids.join(',')})`,{method:'DELETE',auth:true});
  state.overrides=state.overrides.filter(o=>!ids.includes(o.id));doneKeys.push(...dels.map(([k])=>k));
  doneKeys.forEach(k=>pending.delete(k));message(`已保存 ${items.length} 处修改。`);
 }catch(e){doneKeys.forEach(k=>pending.delete(k));message(`保存失败：${e.message}。${doneKeys.length?`已保存 ${doneKeys.length} 处，`:''}其余修改还在，可以再点“更新”。`,true);}
 render();}
function cancelPending(){const items=pagePending();if(!items.length)return;items.forEach(([k])=>pending.delete(k));message(`已取消 ${items.length} 处修改。`);render();}
function editBar(){const n=pagePending().length,other={};pending.forEach(v=>{if(v.page!==state.page)other[v.page]=(other[v.page]||0)+1;});
 const elsewhere=Object.entries(other).map(([pg,c])=>`“${pages[pg]}”页还有 ${c} 处未保存`).join('，');
 return `<div class="edit-bar${n?' dirty':''}"><span>${n?`有 <b>${n}</b> 处修改还没保存（浅蓝色格子）`:'双击格子修改（关键词表单击），可以连续改多处，最后点“更新”一次保存'}${elsewhere?`；${esc(elsewhere)}`:''}</span><div class="actions"><button id="pending-save" class="primary"${n?'':' disabled'}>更新${n?`（${n}）`:''}</button><button id="pending-cancel"${n?'':' disabled'}>取消编辑</button></div></div>`;}
window.addEventListener('beforeunload',e=>{if(pending.size){e.preventDefault();e.returnValue='';}});
function editTable(cols,data,{emptyTitle,emptyDetail,cls=''}={}){
 if(!data.length)return empty(emptyTitle,emptyDetail);
 return `<div class="table-wrap"><table class="edit-table ${cls}"><thead><tr>`+cols.map(c=>`<th class="${c.cls||''}">${esc(c.label)}</th>`).join('')+'</tr></thead><tbody>'+data.map(r=>'<tr>'+cols.map(c=>{const x=c.cell(r)||{};const k=[c.cls,x.cls,x.ed&&state.admin?'editable':'',x.ov?'ov':''].filter(Boolean).join(' ');
  return `<td class="${k}"${x.ed?x.ed+` data-raw="${esc(x.raw??'')}"`:''}${x.title||x.ov?` title="${esc(x.title||'手动填写的值；清空后恢复为导入的数据')}"`:''}>${x.html??''}</td>`;}).join('')+'</tr>').join('')+'</tbody></table></div>';}
const urlCell=v=>v?`<a href="${esc(v)}" target="_blank" rel="noopener noreferrer">${esc(decodeURI(v.replace(/^https:\/\/[^/]+/,''))||'/')}</a>`:'';
const lenNote=v=>v?` <small class="len">${[...v].length}</small>`:'';

// ---------------------------------------------------------------- keywords (monitor list)
function kwMetrics(siteId,m){const map={};(snapshot('keywords',siteId,m)?.payload?.rows||[]).forEach(r=>map[String(r.query).trim().toLowerCase()]=r);return map;}
function keywords(){
 const sid=$('site').value,m=month(),cur=kwMetrics(sid,m),prev=kwMetrics(sid,shiftMonth(m,-1)),O=ovMap('keywords',sid,m),Op=ovMap('keywords',sid,shiftMonth(m,-1));
 const list=state.keywords.filter(k=>k.site_id===sid).sort((a,b)=>(a.sort_order-b.sort_order)||(a.id-b.id));
 const num=(o,k,f)=>o?.[k]!==undefined?{v:o[k]===''?null:Number(o[k]),ov:true}:{v:f??null,ov:false};
 const rowsData=filtered(list.map(k=>{const q=k.keyword.trim().toLowerCase(),c=cur[q],p=prev[q],o=O[q],op=Op[q];
  const clicks=num(o,'clicks',c?.clicks),ctr=num(o,'ctr',c?.ctr??(c?.impressions?c.clicks/c.impressions:null)),pos=num(o,'position',c?.position);
  const pp=num(o,'prev_position',num(op,'position',p?.position??c?.previous_position).v);
  return {k,q,keyword:k.keyword,target:k.target_url,volume:k.volume,clicks,ctr,pos,pp,actual:c?.actual_url,status:c?.status};}));
 const hasPrev=!!snapshot('keywords',sid,shiftMonth(m,-1));
 const trend=r=>{const a=r.pos.v,b=r.pp.v;if(a==null)return '<span class="muted">本月无数据</span>';if(b==null)return hasPrev?'<span class="badge">新进入</span>':'<span class="muted">—</span>';const d=b-a;if(Math.abs(d)<1)return '<span class="muted">→ 持平</span>';return d>0?`<span class="positive">↑ ${fmt(d,1)}</span>`:`<span class="negative">↓ ${fmt(-d,1)}</span>`;};
 const E=(r,col,type,trigger='click')=>edAttr(col==='keyword'||col==='target_url'||col==='volume'?'keyword':'ov',{id:r.k.id,col,type,row:r.q,site:sid,grid:'keywords',trigger});
 const cols=[
  {label:'关键词',cell:r=>({html:esc(r.keyword),raw:r.keyword,ed:E(r,'keyword','text')})},
  {label:'目标页面',cell:r=>({html:urlCell(r.target)+(r.status==='错位'&&r.actual?`<br><small class="muted">实际排名页：${esc(decodeURI(r.actual.replace(/^https:\/\/[^/]+/,'')))}</small>`:''),raw:r.target||'',ed:E(r,'target_url','url')})},
  {label:'搜索量',cls:'nw num',cell:r=>({html:r.volume==null?'':fmt(r.volume),raw:r.volume??'',ed:E(r,'volume','int')})},
  {label:'点击量',cls:'nw num',cell:r=>({html:r.clicks.v==null?'':fmt(r.clicks.v),raw:r.clicks.v??'',ed:E(r,'clicks','int'),ov:r.clicks.ov})},
  {label:'点击率',cls:'nw num',cell:r=>({html:r.ctr.v==null?'':percent(r.ctr.v),raw:r.ctr.v==null?'':fmt(r.ctr.v*100,2)+'%',ed:E(r,'ctr','pct'),ov:r.ctr.ov})},
  {label:'当前排名',cls:'nw num',cell:r=>({html:r.pos.v==null?'':fmt(r.pos.v,1),raw:r.pos.v??'',ed:E(r,'position','pos'),ov:r.pos.ov})},
  {label:'上月排名',cls:'nw num',cell:r=>({html:r.pp.v==null?'':fmt(r.pp.v,1),raw:r.pp.v??'',ed:E(r,'prev_position','pos'),ov:r.pp.ov})},
  {label:'趋势',cls:'nw',cell:r=>({html:trend(r)})}];
 if(state.admin)cols.push({label:'',cls:'nw',cell:r=>({html:`<button class="link danger" data-del-kw="${r.k.id}">删除</button>`})});
 const add=state.admin?`<form id="kw-add" class="inline-add"><input name="keyword" placeholder="新关键词" required maxlength="300"><input name="target_url" placeholder="目标页面（网址或 /路径，可留空）"><input name="volume" placeholder="搜索量（可留空）" inputmode="numeric"><button class="primary" type="submit">添加</button></form>`:'';
 const s=snapshot('keywords');
 return panel(`核心关键词（${list.length} 个）`,`<p class="hint">建议保持 20–50 个最重要的词。${state.admin?'单击单元格修改，可以连续改多处，改完点上方“更新”一次保存，“取消编辑”放弃这次所有修改。点击量、点击率和排名每月导入后自动更新；手动改过的格子标为浅黄色，清空即恢复为导入数据，填“-”表示留空。':'登录管理员后可编辑。'}</p>`+add+editTable(cols,rowsData,{emptyTitle:'还没有关键词',emptyDetail:'管理员登录后在上方添加。'}))
 +`<p class="hint">点击量、点击率、排名来自当月 GSC 查询词×着陆页明细，排名取曝光最多的那个页面的平均排名；上月排名取上个月导入的数据。趋势按排名变化计算，变化不到 1 名记为持平。搜索量为手动维护（Semrush，美国库）。${s?'':' 本月还没有导入关键词数据。'}</p>`+source(s);}

// ---------------------------------------------------------------- content tracking
function latestOpt(siteId,url){const k=keyPath(url);let best=null;state.records.forEach(r=>{if(r.site_id===siteId&&r.optimized_on&&keyPath(r.page_url)===k&&(!best||r.optimized_on>best))best=r.optimized_on;});return best;}
function content(){
 const sid=$('site').value,m=month(),cs=snapshot('content',sid,m),ps=snapshot('pages',sid,m);
 const perf={};(cs?.payload?.rows||[]).forEach(r=>perf[pathOf(r.page_url)]=r);
 const pagePos={};(ps?.payload?.rows||[]).forEach(r=>{const k=pathOf(r.path);if(!(k in pagePos))pagePos[k]=r.gsc_position;});
 const list=state.content.filter(c=>c.site_id===sid).sort((a,b)=>(a.sort_order-b.sort_order)||(a.id-b.id));
 const data=filtered(list.map(c=>({...c,_opt:latestOpt(sid,c.url)})));
 const E=(r,col,type)=>edAttr('content',{id:r.id,col,type,site:sid});
 const rank=r=>{const p=perf[pathOf(r.url)];if(p?.kw_position!=null)return {html:fmt(p.kw_position,1),title:`主关键词“${p.main_keyword}”在该页的平均排名（曝光 ${fmt(p.kw_impressions)}）`};
  const pp=p?.position??pagePos[pathOf(r.url)];return pp!=null?{html:`${fmt(pp,1)} <small class="muted">页均</small>`,title:'主关键词本月在该页没有曝光，显示的是页面整体平均排名'}:{};};
 const cols=[
  {label:'H1 标题',cls:'w-l',cell:r=>({html:esc(r.h1||''),raw:r.h1||'',ed:E(r,'h1','long')})},
  {label:'URL',cls:'w-m',cell:r=>({html:urlCell(r.url),raw:r.url,ed:E(r,'url','url')})},
  {label:'主关键词',cls:'w-s',cell:r=>({html:esc(r.main_keyword||''),raw:r.main_keyword||'',ed:E(r,'main_keyword','text')})},
  {label:'Title',cls:'w-l',cell:r=>({html:esc(r.title||'')+lenNote(r.title),raw:r.title||'',ed:E(r,'title','long')})},
  {label:'Meta',cls:'w-xl',cell:r=>({html:esc(r.meta||'')+lenNote(r.meta),raw:r.meta||'',ed:E(r,'meta','long')})},
  {label:'发布日期',cls:'nw',cell:r=>({html:esc(r.published_on||''),raw:r.published_on||'',ed:E(r,'published_on','date')})},
  {label:'上次更新',cls:'nw',cell:r=>{const v=[r.last_updated,r._opt].filter(Boolean).sort().pop();return {html:esc(v||'')+(v&&v===r._opt&&v!==r.last_updated?' <small class="muted">优化记录</small>':''),raw:r.last_updated||'',ed:E(r,'last_updated','date'),title:r._opt?`优化记录里最近一次：${r._opt}`:''};}},
  {label:'当前排名',cls:'nw num',cell:rank},
  {label:'Outlinks',cls:'nw num',cell:r=>({html:r.outlinks??'',raw:r.outlinks??'',ed:E(r,'outlinks','int')})},
  {label:'Inlinks',cls:'nw num',cell:r=>({html:r.inlinks??'',raw:r.inlinks??'',ed:E(r,'inlinks','int')})},
  {label:'主题',cls:'w-s',cell:r=>({html:esc(r.topic||''),raw:r.topic||'',ed:E(r,'topic','text')})},
  {label:'备注',cls:'w-m',cell:r=>({html:esc(r.notes||''),raw:r.notes||'',ed:E(r,'notes','long')})}];
 if(state.admin)cols.push({label:'',cls:'nw',cell:r=>({html:`<button class="link danger" data-del-content="${r.id}">删除</button>`})});
 const add=state.admin?`<form id="content-add" class="inline-add"><input name="url" placeholder="新文章网址 https://${esc(site()?.domain)}/blogs/…" required><input name="main_keyword" placeholder="主关键词（可留空）"><button class="primary" type="submit">添加一行</button></form>`:'';
 const t=cs?.payload?.topics||[];
 return panel(`内容追踪（${list.length} 篇）`,`<p class="hint">${state.admin?'双击单元格修改，可以连续改多处，改完点上方“更新”一次保存，“取消编辑”放弃这次所有修改。':'登录管理员后可双击单元格编辑。'}“上次更新”取手动填写的日期和优化记录里最近一次中较晚的那个。Title、Meta 后的小字是字符数。</p>`+add+editTable(cols,data,{emptyTitle:'还没有内容',emptyDetail:'管理员登录后在上方添加。',cls:'content-table'}))
 +`<p class="hint">当前排名：优先显示主关键词在该页的 GSC 平均排名；主关键词本月没有曝光时，显示页面整体平均排名（标“页均”）。${cs?'':'本月还没有导入 GSC 数据，排名为空。'}主题对应博客计划表的“集群”，备注默认取“植入产品”。</p>`
 +(t.length?panel('主题表现（按篇均点击排序）',table([['topic','主题'],['articles','文章数'],['impressions','曝光'],['clicks','点击'],['clicks_per_article','篇均点击'],['sessions','自然会话']],t)):'')+source(cs);}

// ---------------------------------------------------------------- blog summary sheet (department format, columns A–N)
const BLOG_BLOCKS=[{sid:'autelonline',brand:'AUTEL',idx:'/blogs/news',layout:'A'},{sid:'launchx431online',brand:'LAUNCH',idx:'/blogs/news',layout:'B'},{sid:'otofix',brand:'OTOFIX',idx:'/blogs/otofix-blog',layout:null}];
const BS_HEAD=['品牌','上传日期','文章话题','URL','Blog URL','Word count 总词数','Stop Word count 停用词数','出词量','浏览次数','活跃用户','每位活跃用户的浏览量','每位活跃用户的平均互动时长','是否收录','是否请求编入索引'];
const IDX_HEAD=['指数','活跃用户','会话数','关键事件数','总收入','感兴趣的会话数','每次会话的平均互动时长','每次会话的事件数','感兴趣的会话占比','事件数','会话关键事件率','跳出率'];
const IDX_KEYS=[null,'users','sessions','key_events','revenue','engaged','eng_per_session','events_per_session','engaged_rate','events','key_event_rate','bounce'];
const IDX_TYPES=[null,'int','int','int','money','int','dur','num2','pct','int','pct','pct'];
function blogSheet(m){
 const rows=[],blocks=[],mEnd=m.slice(0,8)+String(daysIn(m)).padStart(2,'0');
 const C=(v,t='text',x={})=>({v,t,...x});
 const add=(cells,cls='')=>{const row=Array.from({length:14},(_,i)=>cells[i]||C(null));row.cls=cls;row.n=rows.length+1;rows.push(row);return row.n;};
 for(const b of BLOG_BLOCKS){
  const st=state.sites.find(s=>s.id===b.sid);if(!st)continue;
  const snap=snapshot('blog_summary',b.sid,m),p=snap?.payload||{},pages=p.pages||{},O=ovMap('blog_summary',b.sid,m);
  const pick=(row,col,f,num=true)=>{const o=O[row]?.[col];return o===undefined?{v:f??null,ov:false}:{v:o===''?null:num?Number(o):o,ov:true};};
  const OV=(row,col,type,o)=>({ed:edAttr('ov',{col,type,row,site:b.sid,grid:'blog_summary'}),raw:o.v==null?'':type==='dur'?durCopy(o.v):String(o.v),ov:o.ov});
  const start=rows.length;add(BS_HEAD.map(h=>C(h,'head')),'head');
  const list=state.content.filter(c=>c.site_id===b.sid&&pathOf(c.url).includes('/blogs/')&&pathOf(c.url)!==b.idx&&(c.published_on?c.published_on<=mEnd:!!pages[pathOf(c.url)])).sort((x,y)=>(x.sort_order-y.sort_order)||(x.id-y.id));
  const items=[{path:b.idx,url:'https://'+st.domain+b.idx},...list.map(c=>({c,path:pathOf(c.url),url:c.url}))];
  const first=rows.length+1;let sumV=0,sumU=0,sumLU=0,missing=0;
  for(const d of items){const n=rows.length+1,pg=pages[d.path]||{},c=d.c;
   const V=pick(d.path,'views',pg.views),U=pick(d.path,'users',pg.users),L=pick(d.path,'eng',pg.eng),X=pick(d.path,'indexed',p.indexed?.[d.path],false);
   if(c&&V.v==null)missing++;sumV+=V.v||0;sumU+=U.v||0;sumLU+=(L.v||0)*(U.v||0);
   const CE=(col,type,v)=>c?{ed:edAttr('content',{id:c.id,col,type,site:b.sid}),raw:v??''}:{};
   add([C(b.brand),C(c?.published_on||null,'date',CE('published_on','date',c?.published_on)),C(c?.title_cn||null,'text',CE('title_cn','text',c?.title_cn)),C(d.path),C(d.url,'url'),
    C(c?.word_count??null,'int',CE('word_count','int',c?.word_count)),C(c?.stop_words??null,'int',CE('stop_words','int',c?.stop_words)),
    C(c?.word_count!=null&&c?.stop_words!=null?c.word_count-c.stop_words:null,'int',{f:`=IF(OR(F${n}="",G${n}=""),"",F${n}-G${n})`}),
    C(V.v,'int',OV(d.path,'views','int',V)),C(U.v,'int',OV(d.path,'users','int',U)),C(V.v!=null&&U.v?V.v/U.v:null,'num2',{f:`=IFERROR(I${n}/J${n},"")`}),
    C(L.v,'dur',OV(d.path,'eng','dur',L)),C(X.v||null,'text',OV(d.path,'indexed','text',X)),C(c?.index_requested||null,'text',CE('index_requested','text',c?.index_requested))],c?'':'idx');}
  const last=rows.length,t=last+1,T=pick('__total','users',p.blog_users);
  add([,,,,,,,C('总计','label'),C(sumV,'int',{f:`=SUM(I${first}:I${last})`}),C(T.v,'int',{...OV('__total','users','int',T),title:'博客页面去重活跃用户（GA4 网页和屏幕报告筛选 /blogs/ 后的总计），导出文件里没有，需要手动填写'}),
   C(T.v?sumV/T.v:null,'num2',{f:`=IFERROR(I${t}/J${t},"")`}),C(T.v?sumLU/T.v:null,'dur',{f:`=IFERROR(SUMPRODUCT(L${first}:L${last},J${first}:J${last})/J${t},"")`}),C('页面用户累加(人次)','label'),C(sumU,'int',{f:`=SUM(J${first}:J${last})`})],'total');
  const s=p.site||{},BV=pick('__site','views',s.views),BU=pick('__site','users',s.users),BK=pick('__site','vpu',null),BL=pick('__site','eng',s.eng),bl=t+1;
  add([,,,,,,,C('全站基准(GA4填)','label'),C(BV.v,'int',OV('__site','views','int',BV)),C(BU.v,'int',OV('__site','users','int',BU)),(BK.ov?C(BK.v,'num2',OV('__site','vpu','num',BK)):C(BV.v!=null&&BU.v?BV.v/BU.v:null,'num2',{f:`=IFERROR(I${bl}/J${bl},"")`})),C(BL.v,'dur',OV('__site','eng','dur',BL))],'base');
  const kT=T.v?sumV/T.v:null,lT=T.v?sumLU/T.v:null,r=(a,b2)=>a!=null&&b2?a/b2:null,kB=BK.ov?BK.v:(BV.v!=null&&BU.v?BV.v/BU.v:null);
  add([,,,,,,,C('占比 / 对比','label'),C(r(sumV,BV.v),'share',{f:`=IF(I${bl}="","",I${t}/I${bl})`}),C(r(T.v,BU.v),'share',{f:`=IF(J${bl}="","",J${t}/J${bl})`}),
   C(r(kT,kB)!=null?r(kT,kB)-1:null,'diff',{f:`=IF(K${bl}="","",K${t}/K${bl}-1)`}),C(r(lT,BL.v)!=null?r(lT,BL.v)-1:null,'diff',{f:`=IF(L${bl}="","",L${t}/L${bl}-1)`})],'ratio');
  blocks.push({title:`${b.brand} 博客（${st.domain}）`,from:start,to:rows.length,snap,missing,articles:list.length});add([],'gap');}
 for(const b of BLOG_BLOCKS.filter(x=>x.layout)){
  const snap=snapshot('blog_summary',b.sid,m),acq=snap?.payload?.acq||{},O=ovMap('blog_summary',b.sid,m),start=rows.length,A=b.layout==='A';
  add(IDX_HEAD.map((h,i)=>C(i===1&&!A?'':h,'head')),'head');
  const lines=[];
  for(const [rk,label] of [['__acq_blog','博客引流数据(GA4填)'],['__acq_site','全站基准(GA4填)']]){
   const src=acq[rk==='__acq_blog'?'blog':'site']||{},n=rows.length+1,v={},ovs={};
   IDX_KEYS.forEach(k=>{if(!k)return;const o=O[rk]?.[k];v[k]=o===undefined?src[k]??null:o===''?null:Number(o);ovs[k]=o!==undefined;});
   const S=v.sessions,der=(k,val)=>ovs[k]?v[k]:val??v[k];
   v.events_per_session=der('events_per_session',v.events!=null&&S?v.events/S:null);v.engaged_rate=der('engaged_rate',v.engaged!=null&&S?v.engaged/S:null);
   v.key_event_rate=der('key_event_rate',v.key_events!=null&&S?v.key_events/S:null);v.bounce=der('bounce',v.engaged_rate!=null?1-v.engaged_rate:null);
   const F={events_per_session:v.events!=null&&S&&!ovs.events_per_session?`=IFERROR(J${n}/C${n},"")`:null,engaged_rate:v.engaged!=null&&S&&!ovs.engaged_rate?`=IFERROR(F${n}/C${n},"")`:null,
    key_event_rate:v.key_events!=null&&S&&!ovs.key_event_rate?`=IFERROR(D${n}/C${n},"")`:null,bounce:v.engaged_rate!=null&&!ovs.bounce?`=IFERROR(1-I${n},"")`:null};
   const cells=IDX_KEYS.map((k,i)=>{if(!k)return C(rk==='__acq_blog'?b.brand:null);if(!A&&k==='users')return C(label,'label');
    const t=IDX_TYPES[i],type=t==='money'||t==='num2'?'num':t;if(F[k])return C(v[k],t,{f:F[k]});return C(v[k],t,{ed:edAttr('ov',{col:k,type,row:rk,site:b.sid,grid:'blog_summary'}),raw:v[k]==null?'':t==='dur'?durCopy(v[k]):t==='pct'?fmt(v[k]*100,2)+'%':String(v[k]),ov:ovs[k]});});
   if(A)cells[12]=C(label,'label');lines.push({n,v});add(cells,rk==='__acq_blog'?'':'base');}
  const [bn,sn]=lines,rc=[];
  IDX_KEYS.forEach((k,i)=>{if(!k){rc.push(C(null));return;}const col='ABCDEFGHIJKL'[i];if(!A&&k==='users'){rc.push(C('占比 / 对比','label'));return;}
   const diff=['eng_per_session','events_per_session','engaged_rate','key_event_rate','bounce'].includes(k),a=bn.v[k],z=sn.v[k];
   rc.push(C(a!=null&&z?a/z-(diff?1:0):null,diff?'diff':'share',{f:`=IF(${col}${sn.n}="","",${col}${bn.n}/${col}${sn.n}${diff?'-1':''})`}));});
  if(A)rc[12]=C('占比 / 对比','label');add(rc,'ratio');
  blocks.push({title:`指数 · ${b.brand}`,from:start,to:rows.length,snap,index:true});add([],'gap');}
 rows.pop();return {rows,blocks};}
function sheetDisplay(c){const v=c.v;if(v==null||v==='')return '';
 switch(c.t){case 'int':return esc(fmt(v));case 'num2':return esc(fmt(v,2));case 'money':return esc(fmt(v,2));case 'dur':return esc(dur(v));case 'pct':return esc(percent(v));
  case 'share':return esc('占总数的 '+percent(v));case 'diff':return esc(Math.abs(v)<5e-5?'与平均值持平':(v>0?'比平均值高 ':'比平均值低 ')+percent(Math.abs(v)));
  case 'url':return urlCell(v);case 'date':return esc(v);default:return esc(v);}}
function sheetCopy(c,formulas){if(formulas&&c.f)return c.f;const v=c.v;if(v==null||v==='')return '';
 switch(c.t){case 'int':return String(Math.round(v));case 'num2':return String(Math.round(v*100)/100);case 'money':return String(Math.round(v*100)/100);case 'dur':return durCopy(v);
  case 'pct':case 'share':case 'diff':return String(Math.round(v*10000)/10000);case 'date':{const [y,mo,d]=v.split('-');return `${y}/${+mo}/${+d}`;}default:return String(v).replace(/[\t\r\n]+/g,' ');}}
const shiftRefs=(f,off)=>off?f.replace(/(^|[^A-Z$])([A-N])(\d+)(?![\d(])/g,(m,a,col,n)=>a+col+(+n+off)):f;
function sheetTSV(rows,formulas=false,off=0){return rows.map(r=>r.cls==='gap'?'':r.map(c=>{const v=sheetCopy(c,formulas);return formulas&&c.f?shiftRefs(v,off):v;}).join('\t').replace(/\t+$/,'')).join('\n');}
function blogCopy(from,to,title){const withF=$('blog-copy-mode')?.value!=='values',start=Math.max(1,parseInt($('blog-copy-row')?.value,10)||1),rows=state.blogSheet.rows.slice(from,to);
 copyText(sheetTSV(rows,withF,start-(from+1)),`已复制${title}（${withF?`含公式，请粘贴到第 ${start} 行的 A 列`:'数值'}）。`);}
function blogSummary(){
 const m=month(),{rows,blocks}=blogSheet(m);state.blogSheet={rows,blocks};
 const render1=(r)=>`<tr class="${r.cls}">`+r.map((c,i)=>{const k=[c.t==='head'?'':isNumT(c.t)?'num':'',c.ed&&state.admin?'editable':'',c.ov?'ov':'',c.f&&!c.ed?'calc':''].filter(Boolean).join(' ');
  const tag=c.t==='head'?'th':'td';return `<${tag} class="${k}"${c.ed?c.ed+` data-raw="${esc(c.raw??'')}"`:''}${c.title||c.ov||c.f?` title="${esc(c.title||(c.ov?'手动填写的值；清空后恢复为导入的数据':'公式（自动计算）：'+c.f))}"`:''}>${sheetDisplay(c)}</${tag}>`;}).join('')+'</tr>';
 const letters='<tr class="letters">'+'ABCDEFGHIJKLMN'.split('').map(x=>`<td>${x}</td>`).join('')+'</tr>';
 let html=panel('博客数据总结表',`<div class="topline"><p class="hint">格式与部门会议表一致（A–N 列，O 列以后不包含）。${state.admin?'双击白色格子可以编辑：文章信息改的是内容追踪表；浏览、用户、时长、收录、基准、指数改的是本月的手动值（浅黄色），清空即恢复为导入的数据，填“-”表示留空。':'登录管理员后可双击编辑。'}</p></div>`
  +`<div class="copy-bar"><label>复制方式<select id="blog-copy-mode"><option value="formulas">含公式（和模板一样会自动计算）</option><option value="values">仅数值</option></select></label><label>粘贴到第几行（A 列）<input id="blog-copy-row" type="number" min="1" value="${esc(state.blogCopyRow||1)}"></label><button id="copy-blog" class="primary">复制整表</button></div>`
  +'<p class="hint">灰色斜体的格子是公式：出词量、每位活跃用户浏览量、总计、全站基准的人均浏览量、占比/对比，以及指数里的比率，填好或更新数据后会自动重算，鼠标停在格子上能看到公式。含公式复制时，公式里的行号按“粘贴到第几行”计算：整表复制填整表要贴到的起始行，单块复制填这一块表头要贴到的行。</p>');
 blocks.forEach((b,i)=>{const s=b.snap;const meta=b.index?'':`${b.articles} 篇文章${b.missing?`，其中 ${b.missing} 篇缺浏览数据`:''}`;
  html+=panel(esc(b.title),`<div class="topline"><p class="hint">${meta}${s?'':'本月还没有导入这部分数据。'}${s?.payload?.date_range?' 数据范围：'+esc(s.payload.date_range):''}</p><button data-copy-block="${i}">复制本块</button></div><div class="table-wrap"><table class="sheet">${letters}${rows.slice(b.from,b.to).map(render1).join('')}</table></div>`);});
 return html+'<p class="hint">文章行来自内容追踪表：该站 /blogs/ 下、发布日期在本月月底以前的文章（没有发布日期但本月有浏览数据的也会列出）。浏览次数、活跃用户、每位活跃用户平均互动时长来自 GA4“网页和屏幕”报告；是否收录按 GSC 未编入索引导出和当月曝光判断；指数来自 GA4“流量获取”报告（博客行为着陆页包含 /blogs/ 的会话）。GA4 导出不带总计行，博客去重活跃用户、全站活跃用户和全站平均互动时长需要手动填写。</p>';}
const isNumT=t=>['int','num2','money','dur','pct','share','diff'].includes(t);

// ---------------------------------------------------------------- optimizations
const OPT_CATEGORIES=['Title/Meta','内容','内链','技术','其他'];
const MAX_NEW_RECORDS=10;
const recordDrafts=new Map();
const savingRecordSites=new Set();
function completePages(s){
 const days=snapshot('overview',s.site_id,s.month)?.payload?.gsc?.days;
 return s.provenance?.gsc_full_month??(days==null||days===daysIn(s.month));
}
function comparisonMonths(record,records,snapshots,currentMonth){
 const optimized=record.optimized_on.slice(0,7)+'-01';
 const later=records.filter(r=>r.optimized_on>record.optimized_on&&keyPath(r.page_url)===keyPath(record.page_url))
  .map(r=>r.optimized_on).sort()[0];
 const end=later?later.slice(0,7)+'-01':currentMonth;
 const before=shiftMonth(optimized,-1),firstAfter=shiftMonth(optimized,1);
 const after=snapshots.filter(s=>s.month>=firstAfter&&s.month<currentMonth&&s.month<end)
  .map(s=>s.month).sort().at(-1);
 return {before,after,firstAfter,closed:!!later&&end<=currentMonth};
}
function cmpCell(record,records,snapshots){
 const {before,after,firstAfter,closed}=comparisonMonths(record,records,snapshots,today().slice(0,7)+'-01');
 const path=keyPath(record.page_url);
 const pageAt=m=>{
  const s=snapshots.find(x=>x.month===m);
  const row=s?.payload?.rows?.find(r=>keyPath(r.path)===path);
  const range=s?.provenance?.ga4_landing_date_range;
  const partial=range&&range!==`${m} 至 ${m.slice(0,8)+String(daysIn(m)).padStart(2,'0')}`;
  return {s,row,partial};
 };
 const b=pageAt(before),a=pageAt(after);
 const line=(label,k,digits=0)=>{
  const ga=k.startsWith('ga_'),bv=ga&&b.partial?null:b.row?.[k],av=ga&&a.partial?null:a.row?.[k];
  const rank=k==='gsc_position',delta=rank&&bv!=null&&av!=null?bv-av:change(av,bv);
  const changeLabel=rank&&delta!=null?` <span class="${delta>0?'positive':delta<0?'negative':''}">${delta>0?'+':''}${fmt(delta,1)}</span>`:delta==null?'':' '+changeHtml(delta);
  return `${label} ${fmt(bv,digits)} → ${fmt(av,digits)}${changeLabel}`;
 };
 const query=(label,k)=>{const show=v=>v?`${esc(v.query)}（${fmt(v.value)}）`:'—';return `${label} ${show(b.row?.[k])} → ${show(a.row?.[k])}`;};
 const statuses=[];
 if(!b.s)statuses.push('优化前完整月尚无数据');
 if(!after)statuses.push(closed?'两次优化之间暂无可用的完整月数据':`等待 ${firstAfter.slice(0,7)} 或之后的完整月数据`);
 if(b.partial||a.partial)statuses.push('部分月份缺少整月页面 GA4 数据');
 return `<div class="cmp"><strong>${esc(before.slice(0,7))} → ${after?esc(after.slice(0,7)):'—'}</strong><br>${line('点击','gsc_clicks')}<br>${line('曝光','gsc_impressions')}<br>${line('排名','gsc_position',1)}<br>${line('自然会话','ga_sessions')}<br>${line('订单','ga_purchases')}<br>${query('曝光量最高的 query','top_query_impressions')}<br>${query('点击次数最多的 query','top_query_clicks')}${statuses.map(s=>`<br><span class="muted">${esc(s)}</span>`).join('')}</div>`;
}
function recordFields(record){
 const date=record?.optimized_on||'';
 return `<label>优化日期<input name="optimized_on" type="date" max="${today()}" required value="${esc(date)}"></label>
 <label>优化类型<select name="category" required><option value="">请选择</option>${OPT_CATEGORIES.map(x=>`<option ${record?.category===x?'selected':''}>${x}</option>`).join('')}</select></label>
 <label class="inline"><input name="published" type="checkbox" ${!record||record.published?'checked':''}>公开显示此记录</label>
 <label class="wide">优化内容（选填）<textarea name="description" maxlength="5000">${esc(record?.description||'')}</textarea></label>`;
}
function recordUrlField(record,readonly=false){
 return `<label>页面网址<input name="page_url" type="url" placeholder="https://${esc(site()?.domain)}/…" required value="${esc(record.page_url||'')}" ${readonly?'readonly':''}></label>`;
}
function newRecordForm(sid){
 const drafts=recordDrafts.get(sid)||[],full=drafts.length>=MAX_NEW_RECORDS;
 const cards=drafts.map((draft,index)=>`<section class="record-draft" data-record-draft="${index}">
  <div class="record-draft-heading"><h3>记录 ${index+1}</h3><button type="button" class="link danger" data-remove-draft="${index}" aria-label="移除记录 ${index+1}">移除</button></div>
  <div class="record-form record-draft-fields">${recordUrlField(draft)}${recordFields(draft)}</div>
 </section>`).join('');
 return `<form id="new-record-form"><fieldset ${savingRecordSites.has(sid)?'disabled':''}>
  ${cards}<button type="button" id="add-record-draft" ${full?'disabled':''}>${full?'已添加 10 条':'＋ 新增一条'}</button>
  <div class="record-draft-footer"><button type="submit" class="primary" ${drafts.length?'':'disabled'}>保存记录</button><span class="muted">${drafts.length} / ${MAX_NEW_RECORDS} 条</span></div>
 </fieldset></form>`;
}
function bindNewRecordForm(form,sid){
 form.oninput=event=>{
  const field=event.target,card=field.closest('[data-record-draft]');
  if(card&&field.name)recordDrafts.get(sid)[Number(card.dataset.recordDraft)][field.name]=field.type==='checkbox'?field.checked:field.value;
 };
 $('add-record-draft').onclick=()=>{
  const drafts=recordDrafts.get(sid)||[];
  if(drafts.length>=MAX_NEW_RECORDS||savingRecordSites.has(sid))return;
  drafts.push({id:crypto.randomUUID(),published:true});
  recordDrafts.set(sid,drafts);
  render();
  $('new-record-form').querySelector('[data-record-draft]:last-of-type input').focus();
 };
 form.querySelectorAll('[data-remove-draft]').forEach(button=>button.onclick=()=>{
  recordDrafts.get(sid).splice(Number(button.dataset.removeDraft),1);
  render();
  $('add-record-draft').focus();
 });
 form.onsubmit=saveNewRecords;
}
function optimizations(){
 let html='';
 const sid=$('site').value,all=state.records.filter(r=>r.site_id===sid),e=all.find(r=>r.id===state.editing);
 const completed=all.filter(r=>r.optimized_on),snapshots=state.snapshots.filter(s=>s.site_id===sid&&s.section==='pages'&&completePages(s));
 const actions=(r,label)=>`<button class="link" data-edit="${esc(r.id)}">${label}</button> <button class="link danger" data-del="${esc(r.id)}">删除</button>`;
 if(state.admin){
  html+=e?panel(e.optimized_on?'修改优化记录':'补充优化记录',`<form id="record-form" class="record-form">${recordUrlField(e,!e.optimized_on)}${recordFields(e)}<div class="wide actions"><button class="primary" type="submit">保存记录</button><button type="button" id="cancel-edit">取消修改</button></div></form>`):panel('新增优化记录',newRecordForm(sid));
  const queue=filtered(all.filter(r=>!r.optimized_on)).map(r=>({...r,ops:actions(r,'补充记录')}));
  html+=panel('优化清单',table([['page_url','页面','url'],['ops','操作','html']],queue,{emptyTitle:'暂无待补充的页面',emptyDetail:'可从机会清单加入页面。'}));
 }
 const recs=filtered(completed).map(r=>({...r,visibility:r.published?'已发布':'草稿',
  compare:cmpCell(r,completed,snapshots),ops:state.admin?actions(r,'修改'):''}));
 const cols=[['optimized_on','优化日期'],['page_url','页面','url'],['category','类型'],['description','优化内容'],['compare','优化前后（整月对比）','html'],['visibility','状态']];
 if(state.admin)cols.push(['ops','操作','html']);
 html+=panel('优化历史',table(cols,recs,{emptyTitle:'暂无优化记录',emptyDetail:'管理员登录后可在这里新增。'}));
 return html+(state.admin?'<p class="hint">优化前取上一个自然月。优化后取最近已导入的完整月，截止同一页面下次优化的前一个月。Query 取当月查询词×页面明细。</p>':'');}

// ---------------------------------------------------------------- monthly (department format)
const MONTHLY_ROWS=[['semrush_traffic','网站流量','Semrush（平均自然流量）'],['gsc_clicks',null,'GSC（点击量）'],['gsc_impressions',null,'GSC（曝光量）'],['ahrefs_traffic',null,'Ahrefs（平均自然流量）'],['rank_1_3','关键词','1-3 网站关键词（{t}）'],['rank_4_10',null,'4-10 网站关键词（{t}）'],['rank_11_20',null,'11-20网站关键词（{t}）'],['rank_21_50',null,'21-50网站关键词（{t}）'],['rank_51_plus',null,'51+网站关键词（{t}）'],['rank_total',null,'总数'],['page_optimization','Page优化','优化页面Title, Description, QA']];
const SERP_ROWS=[['ai_overview',null,'AI Overview'],['serp_featured_results',null,'SERP 精选结果']];
const MONTHLY_DISPLAY_ROWS=MONTHLY_ROWS.flatMap(row=>row[0]==='rank_51_plus'?[row,...SERP_ROWS]:[row]);
const DEPARTMENT_KEYS=new Set(MONTHLY_ROWS.map(([key])=>key));
const RANK_KEYS=['rank_1_3','rank_4_10','rank_11_20','rank_21_50','rank_51_plus'];
function monthlyRaw(key,p,siteId,m,O){
 const o=O[key]?.value;if(o!==undefined)return {v:o===''?null:key==='page_optimization'?o:Number(o),ov:true};
 if(key==='rank_total'){const vals=RANK_KEYS.map(k=>monthlyRaw(k,p,siteId,m,O)),any=vals.some(x=>x.v!=null);
  if(any&&(vals.some(x=>x.ov)||p?.rank_total==null))return {v:vals.reduce((a,x)=>a+(x.v||0),0),calc:true};}
 let v=p?.[key];
 if(key==='page_optimization'&&(v==null||v==='')){const c={};state.records.filter(r=>r.site_id===siteId&&r.optimized_on?.slice(0,7)===m.slice(0,7)).forEach(r=>c[r.category]=(c[r.category]||0)+1);v=Object.keys(c).length?Object.entries(c).map(([k,n])=>`${k} ${n} 页`).join('；'):null;return {v,auto:v!=null};}
 return {v:v===''?null:v??null};}
function monthlyText(key,v){
 if(v==null||v==='')return '';
 if(key==='gsc_impressions'&&typeof v==='number'&&v>=10000)return (+(v/10000).toFixed(2))+'w';
 return typeof v==='number'?String(Math.round(v*100)/100):String(v);}
function monthlyGrid(){
 const ms=[...new Set([...state.snapshots.filter(x=>x.section==='monthly'&&x.month<=month()).map(x=>x.month),...state.overrides.filter(x=>x.grid==='monthly'&&x.month<=month()).map(x=>x.month)])].sort().slice(-6);
 if(!ms.includes(month()))ms.push(month());ms.sort();
 const sites=[...state.sites].sort((a,b)=>a.sort_order-b.sort_order);
 const out=[];sites.forEach(s=>{const tool='Semrush';const O={};ms.forEach(m=>O[m]=ovMap('monthly',s.id,m));
  MONTHLY_DISPLAY_ROWS.forEach(([k,cat,label],i)=>{const r={url:i===0?'https://'+s.domain+'/':'',cat:cat||'',label:label.replace('{t}',tool),key:k,site:s.id,cells:{}};
   ms.forEach(m=>{const x=monthlyRaw(k,snapshot('monthly',s.id,m)?.payload,s.id,m,O[m]);r.cells[m]=x;r[m]=monthlyText(k,x.v);});out.push(r);});});
 return {ms,out};}
function departmentGrid(){
 const {ms,out}=viewWithPending(monthlyGrid);
 return {ms,out:out.filter(r=>DEPARTMENT_KEYS.has(r.key))};
}
function monthly(){
 const {ms,out}=monthlyGrid();const cur=month();
 const head='<tr><th>网址</th><th>调研类目</th><th>工具/工作</th>'+ms.map(m=>`<th class="${m===cur?'current':''}">${esc(m.slice(0,7))}</th>`).join('')+'</tr>';
 const body=out.map(r=>`<tr class="${r.url?'group-start':''}"><td>${esc(r.url)}</td><td>${esc(r.cat)}</td><td>${esc(r.label)}</td>`+ms.map(m=>{const x=r.cells[m],type=r.key==='page_optimization'?'text':'mnum';
  const tip=x.ov?'手动填写的值；清空后恢复为导入的数据':x.calc?'自动计算：五个排名区间相加（手动填写可覆盖）':x.auto?'按当月优化记录自动汇总（手动填写可覆盖）':'';
  const raw=x.ov?(x.v==null?'-':String(x.v)):'';
  return `<td class="${[m===cur?'current':'',state.admin?'editable':'',x.ov?'ov':'',x.calc||x.auto?'calc':''].filter(Boolean).join(' ')}"${edAttr('ov',{col:'value',type,row:r.key,site:r.site,grid:'monthly',month:m})} data-raw="${esc(x.ov?raw:(x.v==null||x.auto?'':String(x.v)))}"${tip?` title="${esc(tip)}"`:''}>${esc(r[m])}</td>`;}).join('')+'</tr>').join('');
 const missing=out.filter(r=>r[cur]===''&&!['ahrefs_traffic','page_optimization'].includes(r.key)).length;
 return panel('十二站月度汇总',`<div class="topline"><p class="hint">${esc(cur.slice(0,7))} 有 ${missing} 个数值缺失。${state.admin?'双击数值格填写，可连续填写后统一更新。':''}</p><div class="actions"><button id="copy-monthly" class="primary">复制当月数值列（132 行）</button><button id="copy-monthly-full">复制整表（含标签）</button></div></div><div class="table-wrap"><table class="monthly">${head}${body}</table></div>`)
 +'<p class="hint">复制按钮使用部门表的 132 行格式。AI Overview 和 SERP 精选结果仅在看板显示。</p>';}

// ---------------------------------------------------------------- admin import
function adminPanel(){return panel('月度数据导入',`<p class="hint">导入由数据处理脚本（pipeline）生成的 import.json。相同站点、月份、页面会更新同一份快照，历史月份保留。处理步骤见仓库 docs/月度数据导入说明.md。</p><div class="actions"><label>选择 import.json<input id="import-file" type="file" accept=".json,application/json"></label></div><p id="import-preview" class="hint"></p><button id="import-confirm" class="primary" disabled>导入数据库</button>`);}

// ---------------------------------------------------------------- render
function render(){
 editing=null;
 const scroll=[...document.querySelectorAll('#content .table-wrap')].map(w=>w.scrollLeft);
 $('page-title').textContent=pages[state.page];$('site-domain').textContent=state.page==='monthly'?'全部 12 个站点':state.page==='blog'?'Autel · Launch · Otofix 博客':site()?.domain||'';
 $('nav').innerHTML=Object.entries(pages).map(([k,v])=>`<button data-page="${k}" class="${k===state.page?'active':''}">${v}</button>`).join('');
 $('login-toggle').textContent=state.admin?'管理员 · 退出':'管理员登录';$('login-toggle').hidden=!!window.SEO_OFFLINE;$('export').hidden=!!window.SEO_OFFLINE;
 $('site').parentElement.hidden=state.page==='monthly'||state.page==='blog';
 if(state.loading){$('content').innerHTML=empty('正在读取数据','请稍候');return;}
 if(state.error){$('content').innerHTML=empty('数据暂时无法读取',state.error);return;}
 const renderers={overview,opportunities,keywords,content,optimizations,monthly,blog:blogSummary};
 const gaRange=['content','opportunities'].includes(state.page)?snapshot('pages')?.provenance?.ga4_landing_date_range:null;
 $('content').innerHTML=(state.admin&&EDIT_PAGES.includes(state.page)?editBar():'')+(gaRange?`<p class="note">页面级 GA4 数据范围：${esc(gaRange)}。GSC 为整月；页面会话、商品浏览、加购、订单、收入和互动指标不代表整月。</p>`:'')+viewWithPending(()=>renderers[state.page]())+(state.admin&&state.page==='monthly'?adminPanel():'');
 document.querySelectorAll('[data-ed]').forEach(td=>{const k=pendKey(td.dataset);td.dataset.k=k;if(pending.has(k)){td.classList.add('pending');td.title='已修改，点上方“更新”后保存';}});
 if($('pending-save')){$('pending-save').onclick=savePending;$('pending-cancel').onclick=cancelPending;}
 document.querySelectorAll('#content .table-wrap').forEach((w,i)=>{if(scroll[i])w.scrollLeft=scroll[i];});
 document.querySelectorAll('[data-ed]').forEach(td=>{td[td.dataset.trigger==='click'?'onclick':'ondblclick']=e=>startEdit(td,e);});
 document.querySelectorAll('[data-del-kw]').forEach(b=>b.onclick=()=>deleteRow('seo_keywords',b.dataset.delKw));
 document.querySelectorAll('[data-del-content]').forEach(b=>b.onclick=()=>deleteRow('seo_content',b.dataset.delContent));
 if($('kw-add'))$('kw-add').onsubmit=addKeyword;
 if($('content-add'))$('content-add').onsubmit=addContent;
 if($('blog-copy-mode')){$('blog-copy-mode').value=state.blogCopyMode||'formulas';$('blog-copy-mode').onchange=e=>state.blogCopyMode=e.target.value;$('blog-copy-row').oninput=e=>state.blogCopyRow=e.target.value;}
 if($('copy-blog'))$('copy-blog').onclick=()=>blogCopy(0,state.blogSheet.rows.length,'整表');
 document.querySelectorAll('[data-copy-block]').forEach(b=>b.onclick=()=>{const k=state.blogSheet.blocks[+b.dataset.copyBlock];blogCopy(k.from,k.to,'“'+k.title+'”');});
 document.querySelectorAll('[data-page]').forEach(b=>b.onclick=()=>{state.page=b.dataset.page;state.editing=null;render();});
 document.querySelectorAll('[data-cat]').forEach(b=>b.onclick=()=>{state.oppCat=b.dataset.cat;render();});
 document.querySelectorAll('[data-edit]').forEach(b=>b.onclick=()=>{state.editing=b.dataset.edit;render();window.scrollTo({top:0,behavior:'smooth'});});
 document.querySelectorAll('[data-del]').forEach(b=>b.onclick=()=>deleteRecord(b.dataset.del));
 document.querySelectorAll('[data-queue]').forEach(b=>b.onclick=()=>addToQueue(b));
 if($('ignore-form'))bindOpportunityIgnores();
 if($('cancel-edit'))$('cancel-edit').onclick=()=>{state.editing=null;render();};
 if($('record-form'))$('record-form').onsubmit=saveRecord;
 if($('new-record-form'))bindNewRecordForm($('new-record-form'),$('site').value);
 if($('copy-monthly'))$('copy-monthly').onclick=()=>copyText(departmentGrid().out.map(r=>r[month()].replace(/[\t\r\n]/g,' ')).join('\n'),'已复制当月 132 行数值，到部门表格新月份列第一个数据格粘贴。');
 if($('copy-monthly-full'))$('copy-monthly-full').onclick=()=>{const {ms,out}=departmentGrid();copyText([['网址','调研类目','工具/工作',...ms.map(m=>m.slice(0,7))].join('\t'),...out.map(r=>[r.url,r.cat,r.label,...ms.map(m=>r[m])].map(v=>String(v).replace(/[\t\r\n]/g,' ')).join('\t'))].join('\n'),'已复制整表。');};
 if($('import-file'))$('import-file').onchange=previewImport;
}
async function copyText(text,ok){try{await navigator.clipboard.writeText(text);message(ok);}catch{message('浏览器未允许复制，请使用导出快照。',true);}}
async function load(){const id=++state.loadId;state.loading=true;state.error=null;render();try{
 if(window.SEO_OFFLINE){Object.assign(state,window.SEO_OFFLINE);state.admin=false;state.session=null;}
 else {const [sites,snapshots,records,content,keywords,overrides,privateNotes,guidance,ignored]=await Promise.all([
  rows('seo_sites','select=*&order=sort_order'),paged('seo_snapshots','select=*&order=month.desc,id'),
  paged('seo_optimizations','select=*&order=optimized_on.desc.nullslast,id'),paged('seo_content','select=*&order=site_id,sort_order,id'),
  paged('seo_keywords','select=*&order=site_id,sort_order,id'),paged('seo_cell_overrides','select=*&order=id'),
  state.admin?paged('seo_snapshot_notes','select=*&order=snapshot_id'):[],
  state.admin?request('/rest/v1/rpc/seo_dashboard_guidance',{method:'POST',auth:true,body:{}}):{},
  paged(state.admin?'seo_opportunity_ignores':'seo_opportunity_ignore_status','select=*&order=site_id,page_key')
 ]);if(id!==state.loadId)return;
 Object.assign(state,{sites,snapshots,records,content,keywords,overrides,ignored,guidance:guidance||{},
  notes:Object.fromEntries(privateNotes.map(n=>[n.snapshot_id,n]))});}
 const selected=$('site').value;$('site').innerHTML=state.sites.filter(x=>x.deep_analysis).map(x=>`<option value="${esc(x.id)}">${esc(x.name)}</option>`).join('');if(state.sites.some(x=>x.id===selected))$('site').value=selected;
 $('connection').textContent=window.SEO_OFFLINE?'离线快照':'数据库已连接';
 }catch(e){state.error=e.message;$('connection').textContent='连接失败';}finally{if(id===state.loadId){state.loading=false;render();}}}
function recordUrl(raw,s){
 const invalid=()=>Error(`页面网址必须属于 ${s.domain}，并使用 https。`);
 let u;try{u=new URL(raw);}catch{throw invalid();}
 if(u.protocol!=='https:'||u.hostname.replace(/^www\./,'')!==s.domain.replace(/^www\./,'')||u.username||u.password||u.port)throw invalid();
 return 'https://'+s.domain+keyPath(u);
}
function bindOpportunityIgnores(){
 const dialog=$('ignore-dialog'),form=$('ignore-form');
 const reason=form.elements.reason,submit=form.querySelector('[type=submit]');
 document.querySelectorAll('[data-ignore-page]').forEach(button=>button.onclick=()=>{
  form.reset();
  reason.setCustomValidity('');
  $('ignore-error').textContent='';
  form.dataset.pageUrl=button.dataset.ignorePage;
  $('ignore-page').textContent=button.dataset.ignorePage;
  dialog.showModal();
 });
 $('cancel-ignore').onclick=()=>{if(!submit.disabled)dialog.close();};
 dialog.oncancel=event=>{if(submit.disabled)event.preventDefault();};
 reason.oninput=()=>reason.setCustomValidity('');
 form.onsubmit=async event=>{
  event.preventDefault();
  const value=reason.value.trim();
  if(!value){reason.setCustomValidity('请填写忽略原因。');reason.reportValidity();return;}
  submit.disabled=true;
  try{
   const s=site(),page_key=keyPath(recordUrl(form.dataset.pageUrl,s));
   await request('/rest/v1/seo_opportunity_ignores?on_conflict=site_id,page_key',{
    method:'POST',auth:true,body:{site_id:s.id,page_key,reason:value},prefer:'resolution=ignore-duplicates'
   });
   dialog.close();
   message('已移至「已忽略」。');
   await load();
  }catch(error){
   if(state.admin)$('ignore-error').textContent=error.message;
   else {message(error.message,true);render();}
  }
  finally{submit.disabled=false;}
 };
 document.querySelectorAll('[data-restore-ignore]').forEach(button=>button.onclick=async()=>{
  const sid=$('site').value,page_key=keyPath(button.dataset.restoreIgnore);
  button.disabled=true;
  try{
   await request('/rest/v1/seo_opportunity_ignores?site_id=eq.'+encodeURIComponent(sid)+'&page_key=eq.'+encodeURIComponent(page_key),{method:'DELETE',auth:true});
   message('已恢复到原分类。');
   await load();
  }catch(error){message(error.message,true);button.disabled=false;if(!state.admin)render();}
 });
}
function recordPayload(data,s){
 if(!data.optimized_on||data.optimized_on>today()||!OPT_CATEGORIES.includes(data.category))throw Error('请填写有效的优化日期和类型。');
 return {site_id:s.id,page_url:recordUrl(data.page_url,s),optimized_on:data.optimized_on,
  category:data.category,description:(data.description||'').trim(),published:!!data.published};
}
async function saveRecord(event){
 event.preventDefault();const f=event.currentTarget,b=f.querySelector('button[type=submit]'),s=site(),id=state.editing;
 b.disabled=true;
 try{
  const body=recordPayload(Object.fromEntries(new FormData(f)),s);
  await request('/rest/v1/seo_optimizations?id=eq.'+encodeURIComponent(id),{method:'PATCH',auth:true,body});
  message('优化记录已更新。');state.editing=null;await load();
 }catch(e){message(e.message,true);b.disabled=false;if(!state.admin)render();}
}
async function saveNewRecords(event){
 event.preventDefault();
 const s=site(),drafts=recordDrafts.get(s.id);
 if(!drafts?.length||savingRecordSites.has(s.id))return;
 const fieldset=event.currentTarget.querySelector('fieldset');
 try{
  const body=drafts.map((draft,index)=>{
   try{return {...recordPayload(draft,s),id:draft.id};}
   catch(error){throw Error(`第 ${index+1} 条记录：${error.message}`);}
  });
  savingRecordSites.add(s.id);
  fieldset.disabled=true;
  await request('/rest/v1/seo_optimizations?on_conflict=id',{method:'POST',auth:true,body,prefer:'resolution=ignore-duplicates'});
  recordDrafts.delete(s.id);
  message(`已保存 ${body.length} 条优化记录。`);
 }catch(error){
  message(error.message,true);
  savingRecordSites.delete(s.id);
  render();
  return;
 }
 savingRecordSites.delete(s.id);
 await load();
}
async function addToQueue(button){
 const s=site();button.disabled=true;
 try{
  const page_url=recordUrl(button.dataset.queue,s);
  const [row]=await request('/rest/v1/seo_optimizations',{method:'POST',auth:true,
   body:{site_id:s.id,page_url,published:false},prefer:'return=representation'});
  state.records.push(row);message('已加入优化清单，可在“优化记录”补充信息。');render();
 }catch(e){
  if(e.code==='23505'){message('该页面已在优化清单。');await load();}
  else {message(e.message,true);button.disabled=false;if(!state.admin)render();}
 }
}
async function deleteRecord(id){const r=state.records.find(x=>x.id===id);if(!r||!confirm(`删除这条优化记录？\n${r.optimized_on} ${r.page_url}`))return;try{await request('/rest/v1/seo_optimizations?id=eq.'+encodeURIComponent(id),{method:'DELETE',auth:true});message('已删除。');await load();}catch(e){message(e.message,true);}}
async function deleteRow(table,id){const list=table==='seo_content'?state.content:state.keywords,r=list.find(x=>String(x.id)===String(id));if(!r||!confirm(`删除这一行？\n${r.keyword||r.url}`))return;
 try{await request(`/rest/v1/${table}?id=eq.${encodeURIComponent(id)}`,{method:'DELETE',auth:true});list.splice(list.indexOf(r),1);[...pending.entries()].forEach(([k,v])=>{if(v.ds.id===String(id)&&v.ds.ed===(table==='seo_content'?'content':'keyword'))pending.delete(k);});message('已删除。');render();}catch(e){message(e.message,true);}}
const nextOrder=list=>list.reduce((a,x)=>Math.max(a,x.sort_order||0),0)+1;
async function addKeyword(e){e.preventDefault();const f=e.currentTarget,d=Object.fromEntries(new FormData(f)),sid=$('site').value;try{
 const kw=d.keyword.trim();if(!kw)throw Error('请填写关键词');if(state.keywords.some(k=>k.site_id===sid&&k.keyword.trim().toLowerCase()===kw.toLowerCase()))throw Error('这个关键词已经在列表里了');
 const body={site_id:sid,keyword:kw,target_url:d.target_url.trim()?PARSE.url(d.target_url.trim(),{site:sid}):null,volume:d.volume.trim()?PARSE.int(d.volume.trim()):null,sort_order:nextOrder(state.keywords.filter(k=>k.site_id===sid))};
 const [row]=await request('/rest/v1/seo_keywords',{method:'POST',auth:true,body,prefer:'return=representation'});state.keywords.push(row);message('已添加关键词，下次导入月度数据后会自动带出点击和排名。');render();}catch(err){message(err.message,true);}}
async function addContent(e){e.preventDefault();const f=e.currentTarget,d=Object.fromEntries(new FormData(f)),sid=$('site').value;try{
 const url=PARSE.url(d.url.trim(),{site:sid});if(state.content.some(c=>c.site_id===sid&&pathOf(c.url)===pathOf(url)))throw Error('这个网址已经在表里了');
 const [row]=await request('/rest/v1/seo_content',{method:'POST',auth:true,body:{site_id:sid,url,main_keyword:d.main_keyword.trim()||null,sort_order:nextOrder(state.content.filter(c=>c.site_id===sid))},prefer:'return=representation'});
 state.content.push(row);message('已添加，双击各列补充信息。');render();}catch(err){message(err.message,true);}}
let pendingImport=null;
async function previewImport(){pendingImport=null;$('import-confirm').disabled=true;try{const file=$('import-file').files[0];if(!file)return;if(file.size>20*1024*1024)throw Error('文件超过 20MB，请分站点导入。');const data=JSON.parse(await file.text());if(!Array.isArray(data.snapshots)||!data.snapshots.length)throw Error('缺少 snapshots 数据。');const keys=new Set();for(const r of data.snapshots){if(!state.sites.some(s=>s.id===r.site_id)||!/^\d{4}-(0[1-9]|1[0-2])-01$/.test(r.month)||!SECTIONS.includes(r.section)||!r.payload||typeof r.payload!=='object'||Array.isArray(r.payload)||!r.provenance||typeof r.provenance!=='object'||typeof r.published!=='boolean')throw Error('存在无效站点、月份、页面或缺失的来源/发布状态。');const k=[r.site_id,r.month,r.section].join('|');if(keys.has(k))throw Error('同一个数据包存在重复站点、月份和页面。');keys.add(k);}
 pendingImport=data.snapshots;const months=[...new Set(pendingImport.map(x=>x.month.slice(0,7)))].join('、');$('import-preview').textContent=`待导入 ${pendingImport.length} 份快照（${months}），其中 ${pendingImport.filter(x=>x.published).length} 份将公开；同名快照将更新。`;$('import-confirm').disabled=false;$('import-confirm').onclick=commitImport;}catch(e){$('import-preview').textContent=e.message;}}
async function commitImport(){if(!pendingImport)return;$('import-confirm').disabled=true;try{for(let i=0;i<pendingImport.length;i+=50)await request('/rest/v1/rpc/seo_import_snapshots',{method:'POST',auth:true,body:{items:pendingImport.slice(i,i+50)}});pendingImport=null;message('数据导入成功。');await load();}catch(e){message(e.message,true);if($('import-confirm'))$('import-confirm').disabled=false;}}
function download(name,content,type){const a=document.createElement('a'),u=URL.createObjectURL(new Blob([content],{type}));a.href=u;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(u),1000);}
function publicSnapshots(){
 return state.snapshots.filter(s=>s.published).map(s=>{
  const {checks,...payload}=s.payload;
  const {ga4_landing_date_range,gsc_full_month}=s.provenance||{};
  if(s.section==='opportunities'&&payload.rows)payload.rows=payload.rows.map(({action,...row})=>row);
  if(s.section==='overview'&&payload.ga4?.channels)payload.ga4={...payload.ga4,channels:payload.ga4.channels.map(({note,...row})=>row)};
  return {...s,payload,provenance:{ga4_landing_date_range,gsc_full_month}};
 });
}
$('site').onchange=()=>{message('');state.editing=null;render();};$('month').onchange=render;$('search').oninput=render;$('refresh').onclick=()=>{message('');load();};
$('login-toggle').onclick=()=>{if(state.session){state.session=null;state.admin=false;state.notes={};state.guidance={};message('已退出管理员。');load();}else $('login-dialog').showModal();};$('cancel-login').onclick=()=>$('login-dialog').close();
$('login-form').onsubmit=async e=>{e.preventDefault();const b=e.currentTarget.querySelector('button[type=submit]');b.disabled=true;$('login-message').textContent='登录中…';try{state.session=await request('/auth/v1/token?grant_type=password',{method:'POST',body:{email:$('email').value,password:$('password').value}});state.admin=await request('/rest/v1/rpc/seo_is_admin',{method:'POST',auth:true,body:{}});$('password').value='';if(!state.admin){state.session=null;throw Error('该账号没有此看板的管理权限。');}$('login-dialog').close();message('已进入管理员模式，登录仅在本次页面会话保留。');await load();}catch(e){state.session=null;state.admin=false;$('login-message').textContent=e.message;}finally{b.disabled=false;}};
$('export').onclick=async()=>{try{if(state.error||state.loading)throw Error('数据未就绪，暂时无法导出。');const data={sites:state.sites,snapshots:publicSnapshots(),records:state.records.filter(x=>x.published),ignored:state.ignored.map(({site_id,page_key})=>({site_id,page_key})),content:state.content,keywords:state.keywords,overrides:state.overrides};const [css,js]=await Promise.all(['style.css','app.js'].map(async f=>{const r=await fetch('./'+f);if(!r.ok)throw Error('导出资源读取失败');return r.text();}));const copy=document.documentElement.cloneNode(true);copy.querySelector('#month').setAttribute('value',$('month').value);copy.querySelector('#content').innerHTML='';copy.querySelector('#notice').innerHTML='';let html=copy.outerHTML.replace(/<script[\s\S]*?<\/script>/g,'').replace(/<link rel="stylesheet"[^>]*>/,'<style>'+css+'</style>');const inline=JSON.stringify(data).replace(/</g,'\\u003c');html=html.replace('</body>',`<script>window.SEO_CONFIG={};window.SEO_OFFLINE=${inline};<\/script><script>${js.replace(/<\/script/gi,'<\\/script')}<\/script></body>`);download('SEO看板_'+$('month').value+'.html','<!doctype html>'+html,'text/html;charset=utf-8');message('已导出离线快照（只含已发布数据）。');}catch(e){message(e.message,true);}};
load();
