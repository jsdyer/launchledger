import {validateCapture,comparison,changes,filterLaunches,formatTime,shiftText,sourceUrl,toCsv} from './model.mjs';
const $=id=>document.getElementById(id);
const el=(tag,text,className)=>{const n=document.createElement(tag); if(text!==undefined)n.textContent=text;if(className)n.className=className;return n;};
const captures=new Map();
let index, current, baseline, currentKey='', baselineKey='', selected='', shown=[], generation=0;
function announce(text,error=false){$('notice').textContent=text;$('notice').classList.toggle('error',error);}
async function readJson(path){const r=await fetch(path,{cache:'no-cache'});if(!r.ok)throw new Error(`Could not load the retained data (HTTP ${r.status}).`);return r.json();}
async function load(key){if(captures.has(key))return captures.get(key);if(!/^\d{8}T\d{6}Z-[a-f0-9]{8}\.json$/.test(key))throw new Error('Invalid archive filename.');const data=validateCapture(await readJson('./data/'+key));captures.set(key,data);return data;}
function entries(){return [...index.captures].sort((a,b)=>b.capturedAt.localeCompare(a.capturedAt));}
function fillSelect(id,values,label){const node=$(id),previous=node.value;node.replaceChildren(new Option(label,''),...values.map(v=>new Option(v,v)));if(values.includes(previous))node.value=previous;}
function captureOptions(){const node=$('capture-select');node.replaceChildren(...entries().map(e=>new Option(`${formatTime(e.capturedAt)} · ${e.count} launches${e.imported?' · imported':''}`,e.file)));node.value=currentKey;node.disabled=false;}
function baselineOptions(){const candidates=entries().filter(e=>e.capturedAt<current.capturedAt);$('baseline-select').replaceChildren(new Option('No comparison',''),...candidates.map(e=>new Option(formatTime(e.capturedAt)+(e.imported?' · imported':''),e.file)));$('baseline-select').disabled=true;return candidates;}
function scopeText(data){const s=data.scope;return `${s.from || 'Unspecified'} to ${s.through || 'unspecified'}${s.search?' · Search: '+s.search:''}${s.providerId?' · Provider ID: '+s.providerId:''}${s.watchIds?.length?' · '+s.watchIds.length+' watched UUIDs':''}. ${data.coverage.partial?'Partial window: '+data.coverage.windowCount+' of '+data.coverage.sourceCount+' source matches.':'Complete configured window.'}`;}
async function selectCapture(key){
  const token=++generation;announce('Loading the selected capture…');
  try{
    const next=await load(key);if(token!==generation)return;
    current=next;currentKey=key;captureOptions();
    const candidates=baselineOptions();baseline=null;baselineKey='';
    if(candidates.length){try{const old=await load(candidates[0].file);if(token!==generation)return;baseline=old;baselineKey=candidates[0].file;$('baseline-select').value=baselineKey;}catch(error){announce(error.message+' Comparison unavailable; selected capture is intact.',true);}}
    $('baseline-select').disabled=!candidates.length;
    selected='';
    fillSelect('provider',[...new Set(current.launches.map(r=>r.provider))].sort(),'All providers');
    fillSelect('status',[...new Set(current.launches.map(r=>r.status.name))].sort(),'All statuses');
    fillSelect('pad',[...new Set(current.launches.map(r=>r.pad))].sort(),'All pads');
    $('scope-text').textContent=scopeText(current);
    $('export-json').disabled=false;$('export-csv').disabled=false;
    render(); describe();
  }catch(error){if(token===generation){$('capture-select').value=currentKey;announce(error.message+' Your previous capture is unchanged.',true);}}
}
function describe(){
  const diff=comparison(current,baseline);const stale=Date.now()-Date.parse(index.lastSuccessfulAt)>3*86400000;
  let message=baseline?`${diff.matched} launches appear in both captures; ${diff.changed.length} changed and ${diff.added.length} are new to the selected capture.`:'This is the first available capture for comparison. Schedule history begins here; there is no invented earlier baseline.';
  if(baseline && (JSON.stringify(current.scope)!==JSON.stringify(baseline.scope)||current.coverage.partial||baseline.coverage.partial))message+=' Coverage can differ between captures; only matching launch UUIDs are compared.';
  if(stale)message+=' The latest published capture is over three days old. Check the workflow for collection delays.';
  if(current.coverage.partial)message+=' This configured window exceeds its page limit; increase maxPages within the request budget to collect more.';
  announce(message,stale);
}
function render(){
  if(!current)return;
  const diff=comparison(current,baseline), changedIds=new Set(diff.changed.map(x=>x.row.id));
  if(!baseline)$('changed-only').checked=false;
  shown=filterLaunches(current.launches,{query:$('search').value,provider:$('provider').value,status:$('status').value,pad:$('pad').value,from:$('date-from').value,through:$('date-through').value,changedOnly:$('changed-only').checked,changedIds});
  $('launch-count').textContent=current.launches.length;$('change-count').textContent=baseline?diff.changed.length:'—';$('capture-count').textContent=index.captures.length;
  $('changed-only').disabled=!baseline;
  if(!shown.some(r=>r.id===selected))selected=shown[0]?.id||'';
  const list=$('launch-list');list.replaceChildren();
  for(const row of shown){const b=el('button',undefined,'launch'+(row.id===selected?' selected':''));b.type='button';b.dataset.id=row.id;b.setAttribute('aria-pressed',String(row.id===selected));const status=el('span',row.status.name,'launch-status'+(row.status.id===3?' success':''));b.append(status);if(changedIds.has(row.id))b.append(el('span','Changed','changed-tag'));b.append(el('span',row.name,'launch-name'),el('span',[row.provider,row.location].filter(Boolean).join(' · '),'launch-meta'),el('span',formatTime(row.net,row.precision.name),'launch-time'));b.addEventListener('click',()=>{selected=row.id;render();});list.append(b);}
  $('result-count').textContent=`${shown.length} / ${current.launches.length}`;$('empty').hidden=shown.length>0;
  $('absence-panel').hidden=!diff.absent.length;$('absence-title').textContent=`${diff.absent.length} earlier records outside this capture`;$('absence-list').replaceChildren(...diff.absent.map(r=>el('li',r.name)));
  renderDetail();
}
function renderDetail(){
  const row=current.launches.find(r=>r.id===selected), node=$('detail');node.replaceChildren(el('p','LAUNCH RECORD','eyebrow'));
  const title=el('h3',row?.name||'No launch selected');title.id='detail-title';node.append(title);
  if(!row){node.append(el('p','Clear a filter or choose a different capture to inspect a launch.'));return;}
  node.append(el('span',row.status.name,'launch-status'+(row.status.id===3?' success':'')),el('p',formatTime(row.net,row.precision.name),'selected-date'),el('p',`Provider-reported time · ${row.precision.name} precision`,'precision-note'));
  if(row.precision.description)node.append(el('p',row.precision.description,'precision-note'));
  if(row.mission)node.append(el('p',row.mission));
  const dl=el('dl');for(const [label,text] of [['Provider',row.provider],['Rocket',row.rocket],['Launch pad',row.pad],['Location',row.location],['Mission type',row.missionType],['Orbit',row.orbit],['Window',formatTime(row.windowStart)+' to '+formatTime(row.windowEnd)],['Source updated',formatTime(row.lastUpdated)],['Captured',formatTime(current.capturedAt)]]){dl.append(el('dt',label),el('dd',text||'Not supplied'));}node.append(dl);
  if(row.status.description)node.append(el('p',row.status.description));if(row.failureReason)node.append(el('p','Provider failure note: '+row.failureReason));
  const a=el('a','Open provider record','source-link');a.href=sourceUrl(row);a.target='_blank';a.rel='noopener noreferrer';node.append(a);
  const previous=baseline?.launches.find(r=>r.id===row.id), diff=changes(previous,row);
  if(diff.length){const box=el('div',undefined,'diff-block');box.append(el('h4','Changes since comparison'));const shift=shiftText(previous,row);if(shift)box.append(el('p',shift));const ul=el('ul');for(const d of diff){const date=['net','windowStart','windowEnd'].includes(d.key);ul.append(el('li',`${d.label}: ${date?formatTime(d.before,d.key==='net'?previous.precision.name:'Minute'):d.before||'Not supplied'} → ${date?formatTime(d.after,d.key==='net'?row.precision.name:'Minute'):d.after||'Not supplied'}`));}box.append(ul);node.append(box);}
  else if(baseline)node.append(el('p',previous?'Tracked fields are unchanged from the comparison capture.':'This launch was not present in the comparison capture. That does not establish when it was first announced.','history-empty'));
  node.append(el('h4','Retained observations','timeline-heading'));
  const observations=[...captures.values()].filter(c=>c.capturedAt<=current.capturedAt).map(c=>({at:c.capturedAt,row:c.launches.find(r=>r.id===row.id)})).filter(x=>x.row).sort((a,b)=>b.at.localeCompare(a.at));
  const timeline=el('ol',undefined,'timeline');for(const o of observations){const li=el('li');li.append(el('strong',formatTime(o.at)),el('span',formatTime(o.row.net,o.row.precision.name)),el('span',o.row.status.name));timeline.append(li);}node.append(timeline);
  const unloaded=entries().filter(e=>e.capturedAt<=current.capturedAt&&!captures.has(e.file));
  if(unloaded.length){const b=el('button',`Load ${unloaded.length} more retained captures`);b.type='button';b.addEventListener('click',async()=>{b.disabled=true;b.textContent='Loading retained history…';try{for(let i=0;i<unloaded.length;i+=4){await Promise.all(unloaded.slice(i,i+4).map(e=>load(e.file)));}renderDetail();}catch(error){announce(error.message+' Loaded history remains available.',true);renderDetail();}});node.append(b);}
  if(observations.length===1)node.append(el('p','One retained observation so far. Later captures will reveal schedule and status changes.','history-empty'));
  node.append(el('p','Launch UUID: '+row.id,'uuid'));
}
function download(name,data,type){const url=URL.createObjectURL(new Blob([data],{type}));const a=el('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
$('capture-select').addEventListener('change',e=>selectCapture(e.target.value));
$('baseline-select').addEventListener('change',async e=>{const key=e.target.value,token=++generation;try{const next=key?await load(key):null;if(token!==generation)return;baseline=next;baselineKey=key;render();describe();}catch(error){if(token===generation){$('baseline-select').value=baselineKey;announce(error.message+' Previous comparison is unchanged.',true);}}});
for(const id of ['search','provider','status','pad','date-from','date-through','changed-only'])$(id).addEventListener('input',render);
$('reset').addEventListener('click',()=>{for(const id of ['search','provider','status','pad','date-from','date-through'])$(id).value='';$('changed-only').checked=false;render();});
$('export-json').addEventListener('click',()=>download(`launchledger-${current.capturedAt.slice(0,10)}.json`,JSON.stringify(current,null,2),'application/json'));
$('export-csv').addEventListener('click',()=>download(`launchledger-${current.capturedAt.slice(0,10)}.csv`,toCsv(shown),'text/csv;charset=utf-8'));
$('import-json').addEventListener('change',async e=>{const f=e.target.files[0];if(!f)return;try{if(f.size>5_000_000)throw new Error('The import limit is 5 MB.');const data=validateCapture(JSON.parse(await f.text()));const key='import-'+crypto.randomUUID();captures.set(key,data);index??={captures:[],lastSuccessfulAt:data.capturedAt,firstCapturedAt:data.capturedAt};index.captures.push({file:key,capturedAt:data.capturedAt,count:data.launches.length,imported:true});await selectCapture(key);announce('Imported into this tab only. The public archive is unchanged. '+(baseline?'You can compare the selected captures.':'Add an earlier receipt to compare.'));}catch(error){announce(error.message+' Previous records are unchanged.',true);}finally{e.target.value='';}});
async function start(){try{index=await readJson('./data/index.json');if(index.schemaVersion!==1||!Array.isArray(index.captures)||!index.captures.length||index.captures.length>365)throw new Error('No valid retained capture index is available.');$('latest-date').textContent=formatTime(index.lastSuccessfulAt);$('history-note').textContent=`Collection began ${formatTime(index.firstCapturedAt)}. The page retains up to ${index.retentionLimit} captures. Earlier announcements cannot be reconstructed from today's record; download receipts you want to keep.`;await selectCapture(entries()[0].file);}catch(error){announce(error.message+' You can import a saved Launch Ledger capture.',true);}}
start();
