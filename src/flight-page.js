// The /admin/flights page: flight log, personal totals (CSV / print) and certificates.
// Data comes from /api/flights* and /api/certificates*; every value is inserted with textContent.
export function renderFlightPage({ officer, editor }) {
    return `<!DOCTYPE html>
<html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>飛行紀錄簿與證照</title>
<style>
:root{color-scheme:light dark;--bg:#f5f7fa;--fg:#14202b;--card:#fff;--line:#d5dce3;--accent:#0b6bcb;--bad:#c62828;--warn:#b26a00}
@media(prefers-color-scheme:dark){:root{--bg:#10161c;--fg:#e6edf3;--card:#18212a;--line:#2d3945;--accent:#58a6ff;--bad:#ff7b72;--warn:#e3a008}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.5 system-ui,"Noto Sans TC",sans-serif}
main{max-width:1000px;margin:0 auto;padding:16px}h1{font-size:1.4rem}h2{font-size:1.1rem;margin:0 0 8px}
section{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:14px;margin:14px 0}
.tabs{display:flex;gap:8px;flex-wrap:wrap}button,select,input,textarea{font:inherit;color:inherit;background:var(--card);border:1px solid var(--line);border-radius:6px;padding:6px 10px}
button{cursor:pointer}button.primary{background:var(--accent);color:#fff;border-color:var(--accent)}button.on{border-color:var(--accent);color:var(--accent);font-weight:600}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:10px}label{display:flex;flex-direction:column;gap:2px;font-size:.85rem}
.stats{display:flex;gap:12px;flex-wrap:wrap}.stat{border:1px solid var(--line);border-radius:8px;padding:8px 14px;min-width:110px}.stat b{display:block;font-size:1.4rem}
table{width:100%;border-collapse:collapse;font-size:.9rem}th,td{text-align:left;border-bottom:1px solid var(--line);padding:5px 6px;vertical-align:top}
.scroll{overflow-x:auto}.bad{color:var(--bad);font-weight:600}.warn{color:var(--warn);font-weight:600}.muted{opacity:.7}
.hidden{display:none}#msg{position:sticky;top:0;padding:6px;font-weight:600}
@media print{body{background:#fff;color:#000}.noprint,.tabs,form,#msg{display:none!important}section{border:0;padding:0}}
</style></head><body><main>
<h1>飛行紀錄簿與證照</h1><div id="msg" role="status"></div>
<div class="tabs noprint"><button data-tab="log" class="on">飛行紀錄</button><button data-tab="cert">證照</button>${officer ? '<button data-tab="club">全社統計</button>' : ''}<a href="/admin/dashboard" style="margin-left:auto;align-self:center">回後台</a></div>

<div id="tab-log">
<section class="noprint"><h2>新增飛行紀錄</h2><form id="flightForm" class="grid">
${officer ? '<label>社員（幹部代登，留空為自己）<select name="who"><option value="">自己</option></select></label>' : ''}
<label>日期<input type="date" name="date" required></label><label>地點<input name="location" maxlength="100" required></label>
<label>飛行類型<select name="type" required></select></label><label>社團設備（可選）<select name="assetId"><option value="">不使用社團設備</option></select></label>
<label>機型（未選設備時必填）<input name="aircraft" maxlength="100"></label><label>時長（分鐘）<input type="number" name="minutes" min="1" max="1440" required></label>
<label>架次<input type="number" name="sorties" min="1" max="999" value="1"></label><label>天氣<input name="weather" maxlength="100"></label>
<label>備註<input name="note" maxlength="1000"></label><label><span><input type="checkbox" name="incident"> 發生異常或事故</span></label>
<label>事故說明<input name="incidentNote" maxlength="1000"></label><label>&nbsp;<button class="primary">新增</button></label></form></section>
<section><h2>我的飛行統計</h2><div id="mine" class="stats"></div><div class="noprint" style="margin-top:8px"><button id="csvMine">匯出 CSV</button> <button onclick="window.print()">列印</button></div></section>
<section><h2>飛行紀錄</h2><div class="noprint grid"><label>類型<select id="fType"><option value="">全部</option></select></label>${officer ? '<label>範圍<select id="fScope"><option value="mine">只看自己</option><option value="all">全社</option></select></label><label>篩選<select id="fFilter"><option value="">全部</option><option value="incident">只看事故</option><option value="pending">待確認</option></select></label>' : ''}</div>
<div class="scroll"><table><thead><tr><th>日期</th>${officer ? '<th>社員</th>' : ''}<th>地點</th><th>機型</th><th>類型</th><th>分鐘</th><th>架次</th><th>狀態</th><th class="noprint"></th></tr></thead><tbody id="flights"></tbody></table></div></section>
</div>

<div id="tab-cert" class="hidden">
<section class="noprint"><h2>登錄民航局無人機操作證</h2><form id="certForm" class="grid">
${officer ? '<label>社員（幹部代登，留空為自己）<select name="who"><option value="">自己</option></select></label>' : ''}
<label>類別<select name="category" required></select></label><label>證號<input name="certNo" maxlength="60" required></label>
<label>核發日<input type="date" name="issueDate" required></label><label>到期日<input type="date" name="expiryDate" required></label>
<label>證件照片網址（https）<input name="photoUrl" maxlength="500"></label><label>備註<input name="note" maxlength="500"></label>
<label>&nbsp;<button class="primary">新增證照</button></label></form></section>
<section><h2>證照</h2><div class="scroll"><table><thead><tr><th>類別</th>${officer ? '<th>持有人</th>' : ''}<th>證號</th><th>核發</th><th>到期</th><th>狀態</th><th class="noprint"></th></tr></thead><tbody id="certs"></tbody></table></div></section>
${editor ? '<section class="noprint"><h2>證照類別設定</h2><input id="cats" style="width:100%" aria-label="類別，以逗號分隔"><p class="muted">以逗號分隔。</p><button id="saveCats">儲存類別</button></section>' : ''}
</div>
${officer ? `<div id="tab-club" class="hidden">
<section><h2>全社飛行統計</h2><div id="clubStats" class="stats"></div><div class="scroll"><table><thead><tr><th>社員</th><th>時數</th><th>架次</th><th>事故</th></tr></thead><tbody id="byMember"></tbody></table></div>
<h2 style="margin-top:12px">設備累積使用時數</h2><div class="scroll"><table><thead><tr><th>設備</th><th>時數</th><th>架次</th></tr></thead><tbody id="byAsset"></tbody></table></div></section>
<section><h2>全社持證統計</h2><div id="certStats" class="stats"></div></section>
<section><h2>已到期與即將到期</h2><div class="scroll"><table><thead><tr><th>持有人</th><th>類別</th><th>證號</th><th>到期日</th><th>狀態</th></tr></thead><tbody id="expiring"></tbody></table></div></section></div>` : ''}
</main>
<script>
const OFFICER=${officer ? 'true' : 'false'};
let cfg={types:{},assets:[],people:[],certCategories:[]};
const $=s=>document.querySelector(s);
function el(tag,text,cls){const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(cls)e.className=cls;return e}
function say(t,bad){const m=$('#msg');m.textContent=t;m.style.color=bad?'var(--bad)':'inherit';setTimeout(()=>{if(m.textContent===t)m.textContent=''},4000)}
async function api(path,method,body){const r=await fetch(path,{method:method||'GET',headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined});const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error||('錯誤 '+r.status));return d}
const hours=m=>(Math.round(m/6)/10)+' 小時';
function stat(box,label,value){const d=el('div','','stat');d.append(el('b',String(value)),el('span',label));box.append(d)}
function fillSelect(sel,items,first){sel.replaceChildren();if(first!==undefined)sel.append(new Option(first,''));for(const [v,t] of items)sel.append(new Option(t,v))}
const STATUS={valid:['有效',''],expiring90:['90 天內到期','warn'],expiring30:['30 天內到期','warn'],expired:['已到期','bad']};
function formBody(form){const o={};for(const [k,v] of new FormData(form))o[k]=v;o.incident=!!form.incident?.checked;return o}
function applyWho(o){if(o.who){const [u,m]=o.who.split('|');if(u)o.username=u;else o.memberId=m}delete o.who}

async function loadMine(){const s=await api('/api/flights/summary');const box=$('#mine');box.replaceChildren();
 stat(box,'累積飛行時數',hours(s.minutes));stat(box,'已確認時數',hours(s.confirmedMinutes));stat(box,'架次',s.sorties);stat(box,'異常/事故',s.incidents);
 for(const [t,v] of Object.entries(s.byType))if(v.flights)stat(box,(cfg.types[t]||t)+'（'+v.sorties+' 架次）',hours(v.minutes))}
function flightQuery(){const q=new URLSearchParams();const t=$('#fType').value;if(t)q.set('type',t);
 if(OFFICER){if($('#fScope').value==='all')q.set('scope','all');const f=$('#fFilter').value;if(f==='incident')q.set('incident','1');if(f==='pending')q.set('status','pending')}return q}
async function loadFlights(){const list=await api('/api/flights?'+flightQuery());const tb=$('#flights');tb.replaceChildren();
 for(const f of list){const tr=el('tr');tr.append(el('td',f.date));if(OFFICER)tr.append(el('td',f.owner.name||f.owner.username));
  tr.append(el('td',f.location),el('td',f.aircraft),el('td',cfg.types[f.type]||f.type),el('td',String(f.minutes)),el('td',String(f.sorties)));
  const st=el('td',(f.status==='confirmed'?'已確認':'待確認')+(f.incident?' ⚠事故':''),f.incident?'bad':'');if(f.incident&&f.incidentNote)st.title=f.incidentNote;tr.append(st);
  const act=el('td','','noprint');
  if(OFFICER&&f.status!=='confirmed'){const b=el('button','確認');b.onclick=()=>act1('/api/flights/'+f.id+'/confirm','POST');act.append(b)}
  const d=el('button','刪除');d.onclick=()=>{if(confirm('刪除這筆紀錄？'))act1('/api/flights/'+f.id,'DELETE')};act.append(' ',d);tr.append(act);tb.append(tr)}
 if(!list.length){const tr=el('tr');const td=el('td','沒有紀錄','muted');td.colSpan=9;tr.append(td);tb.append(tr)}}
async function act1(p,m){try{await api(p,m);await refresh()}catch(e){say(e.message,1)}}
async function loadCerts(){const list=await api('/api/certificates'+(OFFICER?'?scope=all':''));const tb=$('#certs');tb.replaceChildren();
 for(const c of list){const tr=el('tr');tr.append(el('td',c.category));if(OFFICER)tr.append(el('td',c.owner.name||c.owner.username));
  tr.append(el('td',c.certNo),el('td',c.issueDate),el('td',c.expiryDate));const [t,cls]=STATUS[c.status];tr.append(el('td',t+(c.daysLeft>=0?'（剩 '+c.daysLeft+' 天）':''),cls));
  const act=el('td','','noprint');if(c.photoUrl){const a=el('a','照片');a.href=c.photoUrl;a.rel='noopener noreferrer';a.target='_blank';act.append(a,' ')}
  const d=el('button','刪除');d.onclick=()=>{if(confirm('刪除這張證照？'))act1('/api/certificates/'+c.id,'DELETE')};act.append(d);tr.append(act);tb.append(tr)}}
async function loadClub(){if(!OFFICER)return;const s=await api('/api/flights/summary?scope=all');const box=$('#clubStats');box.replaceChildren();
 stat(box,'全社時數',hours(s.minutes));stat(box,'架次',s.sorties);stat(box,'事故',s.incidents);
 const bm=$('#byMember');bm.replaceChildren();for(const m of s.byMember){const tr=el('tr');tr.append(el('td',m.name||m.username),el('td',hours(m.minutes)),el('td',String(m.sorties)),el('td',String(m.incidents)));bm.append(tr)}
 const ba=$('#byAsset');ba.replaceChildren();for(const a of s.byAsset){const tr=el('tr');tr.append(el('td',a.assetNo+' '+a.assetName),el('td',hours(a.minutes)),el('td',String(a.sorties)));ba.append(tr)}
 const c=await api('/api/certificates/summary');const cb=$('#certStats');cb.replaceChildren();
 stat(cb,'持證社員（有效）',c.validHolders);stat(cb,'有效證照',c.valid+c.expiring90+c.expiring30);stat(cb,'90 天內到期',c.expiring90);stat(cb,'30 天內到期',c.expiring30);stat(cb,'已到期',c.expired);
 for(const [k,v] of Object.entries(c.byCategory))stat(cb,k,v.total);
 const e=await api('/api/certificates/expiring');const tb=$('#expiring');tb.replaceChildren();
 for(const x of [...e.expired,...e.expiring]){const tr=el('tr');const [t,cls]=STATUS[x.status];tr.append(el('td',x.owner.name||x.owner.username),el('td',x.category),el('td',x.certNo),el('td',x.expiryDate),el('td',t,cls));tb.append(tr)}}
async function refresh(){await Promise.all([loadMine(),loadFlights(),loadCerts(),loadClub()])}
for(const b of document.querySelectorAll('[data-tab]'))b.onclick=()=>{for(const x of document.querySelectorAll('[data-tab]'))x.classList.toggle('on',x===b);for(const t of ['log','cert','club'])$('#tab-'+t)?.classList.toggle('hidden',t!==b.dataset.tab)};
$('#flightForm').onsubmit=async e=>{e.preventDefault();const o=formBody(e.target);applyWho(o);try{await api('/api/flights','POST',o);e.target.reset();say('已新增');await refresh()}catch(x){say(x.message,1)}};
$('#certForm').onsubmit=async e=>{e.preventDefault();const o=formBody(e.target);delete o.incident;applyWho(o);try{await api('/api/certificates','POST',o);e.target.reset();say('已新增');await refresh()}catch(x){say(x.message,1)}};
$('#csvMine').onclick=()=>{location.href='/api/flights/export.csv'};
$('#fType').onchange=loadFlights;if(OFFICER){$('#fScope').onchange=loadFlights;$('#fFilter').onchange=loadFlights}
if($('#saveCats'))$('#saveCats').onclick=async()=>{try{await api('/api/certificates/categories','PUT',{categories:$('#cats').value.split(',')});say('已儲存');init()}catch(e){say(e.message,1)}};
async function init(){cfg=await api('/api/flights/config');
 fillSelect($('#flightForm').type,Object.entries(cfg.types));fillSelect($('#fType'),Object.entries(cfg.types),'全部');
 fillSelect($('#flightForm').assetId,cfg.assets.map(a=>[a.id,a.assetNo+' '+a.assetName]),'不使用社團設備');
 fillSelect($('#certForm').category,cfg.certCategories.map(c=>[c,c]));if($('#cats'))$('#cats').value=cfg.certCategories.join(',');
 if(OFFICER)for(const f of [$('#flightForm'),$('#certForm')])fillSelect(f.who,cfg.people.map(p=>[p.username+'|'+p.memberId,(p.name||'')+(p.username?'（'+p.username+'）':'')]),'自己');
 await refresh()}
init().catch(e=>say(e.message,1));
</script></body></html>`;
}
