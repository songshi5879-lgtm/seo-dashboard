'use strict';
const $=id=>document.getElementById(id);
const pages={overview:'总览',opportunities:'机会清单',keywords:'关键词监控',content:'内容追踪',optimizations:'优化记录',monthly:'月度数据表'};
const state={page:'overview',sites:[],snapshots:[],records:[],session:null,admin:false,loading:true,error:null,loadId:0,oppCat:'',editing:null};
const SECTIONS=['overview','opportunities','keywords','content','monthly','pages'];
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt=(v,d=0)=>v==null||Number.isNaN(+v)?'—':Number(v).toLocaleString('zh-CN',{maximumFractionDigits:d});
const percent=(v,d=2)=>v==null?'—':`${fmt(v*100,d)}%`;
const site=()=>state.sites.find(s=>s.id===$('site').value);
const month=()=>$('month').value+'-01';
const shiftMonth=(m,n)=>{const d=new Date(m.slice(0,7)+'-01T00:00:00Z');d.setUTCMonth(d.getUTCMonth()+n);return d.toISOString().slice(0,10);};
const daysIn=m=>new Date(Date.UTC(+m.slice(0,4),+m.slice(5,7),0)).getUTCDate();
const keyPath=u=>{try{const x=new URL(u,'https://x.invalid');return ((x.pathname.replace(/\/+$/,'')||'/')+x.search).toLowerCase();}catch{return String(u||'').toLowerCase();}};
function message(text,error=false){$('notice').innerHTML=text?`<div class="note ${error?'error':''}">${esc(text)}</div>`:'';}
async function request(path,{method='GET',body,auth=false,prefer}={}){
 if(auth&&!state.session)throw Error('请先登录管理员');
 const headers={apikey:SEO_CONFIG.key,'Content-Type':'application/json'};
 if(state.session)headers.Authorization='Bearer '+state.session.access_token;
 if(prefer)headers.Prefer=prefer;
 const r=await fetch(SEO_CONFIG.url+path,{method,headers,body:body===undefined?undefined:JSON.stringify(body)});
 const raw=await r.text();let data;try{data=raw?JSON.parse(raw):null;}catch{throw Error('服务返回无法识别的内容');}
 if(!r.ok){if(r.status===401&&state.session){state.session=null;state.admin=false;}throw Error(data?.msg||data?.message||data?.error_description||`连接失败 (${r.status})`);}return data;
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
function source(s){return s?`<details class="hint"><summary>数据来源与口径${s.published?'':' · 草稿，仅管理员可见'}</summary><pre class="mono">${esc(JSON.stringify(s.provenance,null,2))}</pre></details>`:'';}
function card(label,value,subtitle){return `<div class="card"><div class="label">${esc(label)}</div><div class="value">${value}</div><div class="hint">${subtitle}</div></div>`;}
function mom(now,prev,m,{daily=true,invert=false}={}){const c=change(now,prev);if(c==null)return '环比 —';let s='环比 '+changeHtml(c,invert);if(daily&&now!=null&&prev){const d=(now/daysIn(m))/(prev/daysIn(shiftMonth(m,-1)))-1;s+='，日均 '+changeHtml(d,invert);}return s;}

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
 ${card('Google 自然会话 ÷ GSC 点击',g.clicks&&go.sessions?fmt(go.sessions/g.clicks,2):'—','正常约 1.4–1.6，明显偏离时检查渠道归类')}
 ${card('数据提醒',String((p.checks||[]).length),(p.checks||[]).map(esc).join('<br>')||'无')}</div>`;
 html+=panel('月度趋势',trendTable());
 html+=panel('自然渠道汇总',table([['channel','渠道'],['sessions','会话'],['purchases','订单'],['revenue','收入','money'],['conversion','转化率','pct']],p.ga4?.by_channel||[]));
 html+=panel('来源 / 媒介明细',table([['channel','渠道'],['source_medium','来源 / 媒介'],['sessions','会话'],['purchases','订单'],['revenue','收入','money'],['included','计入自然','bool'],['note','说明']],filtered(p.ga4?.channels||[]))+'<p class="hint">AI 来源无论被 GA4 归到哪个渠道，都按“AI Assistant”计入。bing / search_bra、bing / pla 已确认为 Bing 广告，不计入自然流量。</p>');
 html+=`<div class="grid2">${panel('设备表现',table([['device','设备'],['clicks','点击'],['impressions','曝光'],['ctr','点击率','pct'],['position','排名','pos']],p.devices||[]))}${panel('国家表现（前 15）',table([['country','国家'],['clicks','点击'],['impressions','曝光'],['ctr','点击率','pct'],['position','排名','pos']],p.countries||[]))}</div>`;
 return html+source(s);
}
function trendTable(){
 const sid=$('site').value,ms=[...new Set(state.snapshots.filter(x=>x.site_id===sid&&(x.section==='overview'||x.section==='monthly')&&x.month<=month()).map(x=>x.month))].sort().slice(-12);
 if(!ms.length)return empty('趋势待导入','导入两个月以上的数据后显示按月趋势。');
 const data=ms.map(m=>{const o=snapshot('overview',sid,m)?.payload||{},mo=snapshot('monthly',sid,m)?.payload||{};const g=o.gsc||{},n=o.ga4?.organic||{};
  return {month:m.slice(0,7),clicks:g.clicks??mo.gsc_clicks,impr:g.impressions??mo.gsc_impressions,ctr:g.ctr,pos:g.position,sessions:n.sessions,orders:n.purchases,revenue:n.revenue,ai:o.ga4?.ai?.sessions,kw:mo.rank_total,kwtool:mo.rank_tool};});
 const max=Math.max(1,...data.map(d=>d.clicks||0));
 const bars=`<div class="bars" role="img" aria-label="GSC 点击按月趋势">${data.map(d=>`<div class="bar-item"><strong>${fmt(d.clicks)}</strong><div class="bar" style="height:${Math.max(2,(d.clicks||0)/max*120)}px"></div>${esc(d.month)}</div>`).join('')}</div>`;
 return bars+table([['month','月份'],['clicks','GSC 点击'],['impr','GSC 曝光'],['ctr','点击率','pct'],['pos','平均排名','pos'],['sessions','自然会话'],['orders','订单'],['revenue','收入','money'],['ai','AI 会话'],['kw','关键词总数'],['kwtool','排名工具']],data)+'<p class="hint">2026 年 10 月起关键词总数改用 Semrush，与之前的 Ahrefs 数据不可直接比较。8–9 月为回填数据，部分指标缺失。</p>';
}

// ---------------------------------------------------------------- opportunities
const OPP_GROUPS=['核心页面','下滑页面','排名11–20（产品/集合页）','排名11–20（博客）','排名11–20（其他）','点击率偏低','错位：实际页面≠规划页面','机会词：未规划承接页','互动差','流量高、转化低','流量低、转化高','未收录','新文章无曝光','广告有转化、自然排名弱'];
function opportunities(){
 const s=snapshot('opportunities');const all=s?.payload?.rows||[];
 const counts={};all.forEach(r=>counts[r.category]=(counts[r.category]||0)+1);
 const cats=[...OPP_GROUPS.filter(c=>counts[c]),...Object.keys(counts).filter(c=>!OPP_GROUPS.includes(c))];
 const chips=`<div class="chips"><button class="chip ${state.oppCat?'':'active'}" data-cat="">全部 ${all.length}</button>${cats.map(c=>`<button class="chip ${state.oppCat===c?'active':''}" data-cat="${esc(c)}">${esc(c)} ${counts[c]}</button>`).join('')}</div>`;
 const data=filtered(all.filter(r=>!state.oppCat||r.category===state.oppCat));
 return panel('待处理机会',chips+table([['priority','优先级','prio'],['category','类型'],['page_url','页面','url'],['query','查询词'],['impressions','曝光'],['clicks','点击'],['ctr','点击率','pct'],['position','排名','pos'],['sessions','自然会话'],['purchases','订单'],['evidence','判断依据'],['action','建议动作']],data))
 +panel('判断口径','<ul class="rule-list"><li>核心页面：自然点击前 10，环比跌幅超过 20% 标为高优先级。</li><li>下滑页面：上月点击 ≥20 且下降 ≥20%，按“排名下降 / 点击率下降 / 曝光下降”判断原因，只作排查线索。</li><li>排名 11–20：平均排名 10.5–20.5；曝光门槛 Autel ≥80，Launch 与美国站 ≥30；排除小语种页面。</li><li>点击率偏低：排除购物类长标题查询后，低于本站同排名段平均值的 60%；通用参考值（第 1–3 名 15–30%、4–7 名 5–10%、8–10 名 2–5%）仅作对照。</li><li>错位与机会词：对照关键词归属表。</li><li>互动差：自然会话 ≥20，且平均互动时长低于全站一半或互动率 <50%。</li><li>转化：与本站自然流量整体转化率比较。</li><li>未收录：GSC 导出当天的快照。</li></ul>')+source(s);}

// ---------------------------------------------------------------- keywords
function keywords(){const s=snapshot('keywords');const rs=(s?.payload?.rows||[]).map(r=>({...r,move:r.position!=null&&r.previous_position!=null?r.previous_position-r.position:null}));
 const c={};rs.forEach(r=>c[r.status]=(c[r.status]||0)+1);
 const sum=rs.length?`<div class="status-line">${Object.entries(c).map(([k,v])=>`<span class="badge ${k==='一致'?'':'pending'}">${esc(k)} ${v}</span>`).join('')}</div>`:'';
 return panel('目标词及页面归属',sum+table([['query','关键词'],['position','本月排名','pos'],['previous_position','上月排名','pos'],['move','排名变化','pos'],['impressions','曝光'],['clicks','点击'],['ctr','点击率','pct'],['status','归属状态','badge'],['actual_url','实际页面','url'],['planned_url','规划页面','url']],filtered(rs)))+'<p class="hint">排名变化为正数表示上升。排名取曝光最多的那个页面的平均排名。</p>'+source(s);}

// ---------------------------------------------------------------- content
function content(){const s=snapshot('content');const t=s?.payload?.topics||[];
 return (t.length?panel('主题表现（按篇均点击排序）',table([['topic','主题'],['articles','文章数'],['impressions','曝光'],['clicks','点击'],['clicks_per_article','篇均点击'],['sessions','自然会话']],t)):'')
 +panel('文章表现',table([['title','文章'],['page_url','网址','url'],['published_on','上线日期'],['index_status','收录状态','badge'],['impressions','曝光'],['clicks','点击'],['position','排名','pos'],['sessions','自然会话'],['product_views','商品浏览'],['purchases','订单']],filtered(s?.payload?.rows||[])))
 +'<p class="hint">选题、写作与审核继续在原文章库管理。上线超过 3 周仍无曝光，作为抽查线索，不等同于确认未收录。</p>'+source(s);}

// ---------------------------------------------------------------- optimizations
function pageRow(m,url){const s=snapshot('pages',$('site').value,m);if(!s)return undefined;const k=keyPath(url);return (s.payload.rows||[]).find(r=>keyPath(r.path)===k)||null;}
function cmpCell(before,after,mb,ma){
 if(before===undefined&&after===undefined)return '<span class="muted">缺少前后月份数据</span>';
 const line=(label,k,type)=>{const b=before?.[k],a=after?.[k];const c=k==='gsc_position'?(b!=null&&a!=null?b-a:null):change(a,b);
  const cs=c==null?'—':k==='gsc_position'?`<span class="${c>0?'positive':c<0?'negative':''}">${c>0?'+':''}${fmt(c,1)}</span>`:changeHtml(c);
  return `${label} ${type==='pos'?fmt(b,1):fmt(b)} → ${after===undefined?'待下月':type==='pos'?fmt(a,1):fmt(a)} ${after===undefined?'':cs}`;};
 return `<div class="cmp">${esc(mb.slice(0,7))} → ${esc(ma.slice(0,7))}<br>${line('点击','gsc_clicks')}<br>${line('曝光','gsc_impressions')}<br>${line('排名','gsc_position','pos')}<br>${line('自然会话','ga_sessions')}<br>${line('订单','ga_purchases')}</div>`;}
function optimizations(){
 let html='';const e=state.editing?state.records.find(r=>r.id===state.editing):null;
 if(state.admin)html+=panel(e?'修改优化记录':'新增优化记录',`<form id="record-form" class="record-form"><label>页面网址<input name="page_url" type="url" placeholder="https://${esc(site()?.domain)}/…" required value="${esc(e?.page_url||'')}"></label><label>优化日期<input name="optimized_on" type="date" required value="${esc(e?.optimized_on||new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date()))}"></label><label>优化类型<select name="category">${['Title/Meta','内容','内链','技术','其他'].map(x=>`<option ${e?.category===x?'selected':''}>${x}</option>`).join('')}</select></label><label class="inline"><input name="published" type="checkbox" ${!e||e.published?'checked':''}>公开显示此记录</label><label class="wide">优化内容<textarea name="description" maxlength="5000" required>${esc(e?.description||'')}</textarea></label><div class="wide actions"><button class="primary" type="submit">${e?'保存修改':'保存到数据库'}</button>${e?'<button type="button" id="cancel-edit">取消修改</button>':''}</div></form>`);
 const recs=filtered(state.records.filter(x=>x.site_id===$('site').value)).map(x=>{const m=x.optimized_on.slice(0,7)+'-01',mb=shiftMonth(m,-1),ma=shiftMonth(m,1);
  return {...x,visibility:x.published?'已发布':'草稿',compare:cmpCell(pageRow(mb,x.page_url),pageRow(ma,x.page_url),mb,ma),
   ops:state.admin?`<button class="link" data-edit="${esc(x.id)}">修改</button> <button class="link danger" data-del="${esc(x.id)}">删除</button>`:''};});
 const cols=[['optimized_on','优化日期'],['page_url','页面','url'],['category','类型'],['description','优化内容'],['compare','优化前后（整月对比）','html'],['visibility','状态']];
 if(state.admin)cols.push(['ops','操作','html']);
 html+=panel('优化历史',table(cols,recs,{emptyTitle:'暂无优化记录',emptyDetail:'管理员登录后可在这里新增。'}));
 return html+'<p class="hint">对比取优化当月的前一个月和后一个月的整月数据，不含优化当月。严格的前后各 28 天对比，需要对该页面单独导出对应日期的数据。“待下月”表示后一个月的数据还没导入。</p>';}

// ---------------------------------------------------------------- monthly (department format)
const MONTHLY_ROWS=[['semrush_traffic','网站流量','Semrush（平均自然流量）'],['gsc_clicks',null,'GSC（点击量）'],['gsc_impressions',null,'GSC（曝光量）'],['ahrefs_traffic',null,'Ahrefs（平均自然流量）'],['rank_1_3','关键词','1-3 网站关键词（{t}）'],['rank_4_10',null,'4-10 网站关键词（{t}）'],['rank_11_20',null,'11-20网站关键词（{t}）'],['rank_21_50',null,'21-50网站关键词（{t}）'],['rank_51_plus',null,'51+网站关键词（{t}）'],['rank_total',null,'总数'],['page_optimization','Page优化','优化页面Title, Description, QA']];
function monthlyValue(key,p,siteId,m){
 let v=p?.[key];
 if(key==='page_optimization'&&(v==null||v==='')){const c={};state.records.filter(r=>r.site_id===siteId&&r.optimized_on.slice(0,7)===m.slice(0,7)).forEach(r=>c[r.category]=(c[r.category]||0)+1);v=Object.keys(c).length?Object.entries(c).map(([k,n])=>`${k} ${n} 页`).join('；'):null;}
 if(v==null||v==='')return '';
 if(key==='gsc_impressions'&&typeof v==='number'&&v>=10000)return (+(v/10000).toFixed(2))+'w';
 return typeof v==='number'?String(Math.round(v*100)/100):String(v);}
function monthlyGrid(){
 const ms=[...new Set(state.snapshots.filter(x=>x.section==='monthly'&&x.month<=month()).map(x=>x.month))].sort().slice(-6);
 if(!ms.includes(month()))ms.push(month());
 const sites=[...state.sites].sort((a,b)=>a.sort_order-b.sort_order);
 const out=[];sites.forEach(s=>{const cur=snapshot('monthly',s.id)?.payload;const tool=cur?.rank_tool||'Semrush';
  MONTHLY_ROWS.forEach(([k,cat,label],i)=>{const r={url:i===0?'https://'+s.domain+'/':'',cat:cat||'',label:label.replace('{t}',tool),key:k,site:s.id};ms.forEach(m=>r[m]=monthlyValue(k,snapshot('monthly',s.id,m)?.payload,s.id,m));out.push(r);});});
 return {ms,out};}
function monthly(){
 const {ms,out}=monthlyGrid();const cur=month();
 const head='<tr><th>网址</th><th>调研类目</th><th>工具/工作</th>'+ms.map(m=>`<th class="${m===cur?'current':''}">${esc(m.slice(0,7))}</th>`).join('')+'</tr>';
 const body=out.map((r,i)=>`<tr class="${i%11===0?'group-start':''}"><td>${esc(r.url)}</td><td>${esc(r.cat)}</td><td>${esc(r.label)}</td>`+ms.map(m=>`<td class="${m===cur?'current':''}">${esc(r[m])}</td>`).join('')+'</tr>').join('');
 const missing=out.filter(r=>r[cur]===''&&!['ahrefs_traffic','page_optimization'].includes(r.key)).length;
 return panel('十二站月度汇总',`<div class="topline"><p class="hint">行顺序与部门月度表一致（12 个站 × 11 行 = 132 行）。当月 ${esc(cur.slice(0,7))} 有 ${missing} 个数值缺失，缺失保留为空。</p><div class="actions"><button id="copy-monthly" class="primary">复制当月数值列（132 行）</button><button id="copy-monthly-full">复制整表（含标签）</button></div></div><div class="table-wrap"><table class="monthly">${head}${body}</table></div>`)
 +'<p class="hint">粘贴方法：在部门表格里选中新月份列的第一个数据格（第 2 行），直接粘贴。“Page优化”一行没有手工填写时，按当月优化记录自动汇总。2026 年 10 月起关键词排名分布统一用 Semrush，与之前的 Ahrefs 数据不可直接比较；Semrush 流量如为月末快照，以数据来源说明为准。</p>';}

// ---------------------------------------------------------------- admin import
function adminPanel(){return panel('月度数据导入',`<p class="hint">导入由数据处理脚本（pipeline）生成的 import.json。相同站点、月份、页面会更新同一份快照，历史月份保留。处理步骤见仓库 docs/月度数据导入说明.md。</p><div class="actions"><label>选择 import.json<input id="import-file" type="file" accept=".json,application/json"></label></div><p id="import-preview" class="hint"></p><button id="import-confirm" class="primary" disabled>导入数据库</button>`);}

// ---------------------------------------------------------------- render
function render(){
 $('page-title').textContent=pages[state.page];$('site-domain').textContent=state.page==='monthly'?'全部 12 个站点':site()?.domain||'';
 $('nav').innerHTML=Object.entries(pages).map(([k,v])=>`<button data-page="${k}" class="${k===state.page?'active':''}">${v}</button>`).join('');
 $('login-toggle').textContent=state.admin?'管理员 · 退出':'管理员登录';$('login-toggle').hidden=!!window.SEO_OFFLINE;$('export').hidden=!!window.SEO_OFFLINE;
 $('site').parentElement.hidden=state.page==='monthly';
 if(state.loading){$('content').innerHTML=empty('正在读取数据','请稍候');return;}
 if(state.error){$('content').innerHTML=empty('数据暂时无法读取',state.error);return;}
 const renderers={overview,opportunities,keywords,content,optimizations,monthly};
 $('content').innerHTML=renderers[state.page]()+(state.admin&&state.page==='monthly'?adminPanel():'');
 document.querySelectorAll('[data-page]').forEach(b=>b.onclick=()=>{state.page=b.dataset.page;state.editing=null;render();});
 document.querySelectorAll('[data-cat]').forEach(b=>b.onclick=()=>{state.oppCat=b.dataset.cat;render();});
 document.querySelectorAll('[data-edit]').forEach(b=>b.onclick=()=>{state.editing=b.dataset.edit;render();window.scrollTo({top:0,behavior:'smooth'});});
 document.querySelectorAll('[data-del]').forEach(b=>b.onclick=()=>deleteRecord(b.dataset.del));
 if($('cancel-edit'))$('cancel-edit').onclick=()=>{state.editing=null;render();};
 if($('record-form'))$('record-form').onsubmit=saveRecord;
 if($('copy-monthly'))$('copy-monthly').onclick=()=>copyText(monthlyGrid().out.map(r=>r[month()].replace(/[\t\r\n]/g,' ')).join('\n'),'已复制当月 132 行数值，到部门表格新月份列第一个数据格粘贴。');
 if($('copy-monthly-full'))$('copy-monthly-full').onclick=()=>{const {ms,out}=monthlyGrid();copyText([['网址','调研类目','工具/工作',...ms.map(m=>m.slice(0,7))].join('\t'),...out.map(r=>[r.url,r.cat,r.label,...ms.map(m=>r[m])].map(v=>String(v).replace(/[\t\r\n]/g,' ')).join('\t'))].join('\n'),'已复制整表。');};
 if($('import-file'))$('import-file').onchange=previewImport;
}
async function copyText(text,ok){try{await navigator.clipboard.writeText(text);message(ok);}catch{message('浏览器未允许复制，请使用导出快照。',true);}}
async function load(){const id=++state.loadId;state.loading=true;state.error=null;render();try{
 if(window.SEO_OFFLINE){Object.assign(state,window.SEO_OFFLINE);state.admin=false;state.session=null;}
 else {const [sites,snapshots,records]=await Promise.all([rows('seo_sites','select=*&order=sort_order'),paged('seo_snapshots','select=*&order=month.desc,id'),paged('seo_optimizations','select=*&order=optimized_on.desc,id')]);if(id!==state.loadId)return;state.sites=sites;state.snapshots=snapshots;state.records=records;}
 const selected=$('site').value;$('site').innerHTML=state.sites.filter(x=>x.deep_analysis).map(x=>`<option value="${esc(x.id)}">${esc(x.name)}</option>`).join('');if(state.sites.some(x=>x.id===selected))$('site').value=selected;
 $('connection').textContent=window.SEO_OFFLINE?'离线快照':'数据库已连接';
 }catch(e){state.error=e.message;$('connection').textContent='连接失败';}finally{if(id===state.loadId){state.loading=false;render();}}}
async function saveRecord(event){event.preventDefault();const f=event.currentTarget,b=f.querySelector('button[type=submit]');b.disabled=true;try{const data=Object.fromEntries(new FormData(f));const u=new URL(data.page_url);if(u.protocol!=='https:'||u.hostname.replace(/^www\./,'')!==site().domain.replace(/^www\./,''))throw Error('页面网址必须属于当前站点，并使用 https。');
 const body={site_id:$('site').value,page_url:u.href,optimized_on:data.optimized_on,category:data.category,description:data.description.trim(),published:!!data.published};
 if(state.editing)await request('/rest/v1/seo_optimizations?id=eq.'+encodeURIComponent(state.editing),{method:'PATCH',auth:true,body});
 else await request('/rest/v1/seo_optimizations',{method:'POST',auth:true,body});
 message(state.editing?'优化记录已修改。':'优化记录已保存。');state.editing=null;await load();}catch(e){message(e.message,true);b.disabled=false;}}
async function deleteRecord(id){const r=state.records.find(x=>x.id===id);if(!r||!confirm(`删除这条优化记录？\n${r.optimized_on} ${r.page_url}`))return;try{await request('/rest/v1/seo_optimizations?id=eq.'+encodeURIComponent(id),{method:'DELETE',auth:true});message('已删除。');await load();}catch(e){message(e.message,true);}}
let pendingImport=null;
async function previewImport(){pendingImport=null;$('import-confirm').disabled=true;try{const file=$('import-file').files[0];if(!file)return;if(file.size>20*1024*1024)throw Error('文件超过 20MB，请分站点导入。');const data=JSON.parse(await file.text());if(!Array.isArray(data.snapshots)||!data.snapshots.length)throw Error('缺少 snapshots 数据。');const keys=new Set();for(const r of data.snapshots){if(!state.sites.some(s=>s.id===r.site_id)||!/^\d{4}-(0[1-9]|1[0-2])-01$/.test(r.month)||!SECTIONS.includes(r.section)||!r.payload||typeof r.payload!=='object'||Array.isArray(r.payload)||!r.provenance||typeof r.provenance!=='object'||typeof r.published!=='boolean')throw Error('存在无效站点、月份、页面或缺失的来源/发布状态。');const k=[r.site_id,r.month,r.section].join('|');if(keys.has(k))throw Error('同一个数据包存在重复站点、月份和页面。');keys.add(k);}
 pendingImport=data.snapshots;const months=[...new Set(pendingImport.map(x=>x.month.slice(0,7)))].join('、');$('import-preview').textContent=`待导入 ${pendingImport.length} 份快照（${months}），其中 ${pendingImport.filter(x=>x.published).length} 份将公开；同名快照将更新。`;$('import-confirm').disabled=false;$('import-confirm').onclick=commitImport;}catch(e){$('import-preview').textContent=e.message;}}
async function commitImport(){if(!pendingImport)return;$('import-confirm').disabled=true;try{for(let i=0;i<pendingImport.length;i+=50)await request('/rest/v1/rpc/seo_import_snapshots',{method:'POST',auth:true,body:{items:pendingImport.slice(i,i+50)}});pendingImport=null;message('数据导入成功。');await load();}catch(e){message(e.message,true);if($('import-confirm'))$('import-confirm').disabled=false;}}
function download(name,content,type){const a=document.createElement('a'),u=URL.createObjectURL(new Blob([content],{type}));a.href=u;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(u),1000);}
$('site').onchange=()=>{message('');state.editing=null;render();};$('month').onchange=render;$('search').oninput=render;$('refresh').onclick=()=>{message('');load();};
$('login-toggle').onclick=()=>{if(state.session){state.session=null;state.admin=false;message('已退出管理员。');load();}else $('login-dialog').showModal();};$('cancel-login').onclick=()=>$('login-dialog').close();
$('login-form').onsubmit=async e=>{e.preventDefault();const b=e.currentTarget.querySelector('button[type=submit]');b.disabled=true;$('login-message').textContent='登录中…';try{state.session=await request('/auth/v1/token?grant_type=password',{method:'POST',body:{email:$('email').value,password:$('password').value}});state.admin=await request('/rest/v1/rpc/seo_is_admin',{method:'POST',auth:true,body:{}});$('password').value='';if(!state.admin){state.session=null;throw Error('该账号没有此看板的管理权限。');}$('login-dialog').close();message('已进入管理员模式，登录仅在本次页面会话保留。');await load();}catch(e){state.session=null;state.admin=false;$('login-message').textContent=e.message;}finally{b.disabled=false;}};
$('export').onclick=async()=>{try{if(state.error||state.loading)throw Error('数据未就绪，暂时无法导出。');const data={sites:state.sites,snapshots:state.snapshots.filter(x=>x.published),records:state.records.filter(x=>x.published)};const [css,js]=await Promise.all(['style.css','app.js'].map(async f=>{const r=await fetch('./'+f);if(!r.ok)throw Error('导出资源读取失败');return r.text();}));const copy=document.documentElement.cloneNode(true);copy.querySelector('#month').setAttribute('value',$('month').value);copy.querySelector('#content').innerHTML='';copy.querySelector('#notice').innerHTML='';let html=copy.outerHTML.replace(/<script[\s\S]*?<\/script>/g,'').replace(/<link rel="stylesheet"[^>]*>/,'<style>'+css+'</style>');const inline=JSON.stringify(data).replace(/</g,'\\u003c');html=html.replace('</body>',`<script>window.SEO_CONFIG={};window.SEO_OFFLINE=${inline};<\/script><script>${js.replace(/<\/script/gi,'<\\/script')}<\/script></body>`);download('SEO看板_'+$('month').value+'.html','<!doctype html>'+html,'text/html;charset=utf-8');message('已导出离线快照（只含已发布数据）。');}catch(e){message(e.message,true);}};
load();
