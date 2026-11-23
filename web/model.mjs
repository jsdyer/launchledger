export const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
export const TRACKED = [['net','Reported time'], ['precision','Time precision'], ['status','Status'], ['windowStart','Window start'], ['windowEnd','Window end'], ['pad','Pad'], ['location','Location'], ['provider','Provider'], ['rocket','Rocket'], ['failureReason','Failure reason']];

export function validateCapture(data) {
  if (!data || data.schemaVersion !== 1 || !Number.isFinite(Date.parse(data.capturedAt)) || !Array.isArray(data.launches) || data.launches.length > 1000 || !data.scope || typeof data.coverage?.partial !== 'boolean') throw new Error('This is not a Launch Ledger receipt.');
  const ids = new Set();
  for (const row of data.launches) {
    if (!UUID.test(row.id) || ids.has(row.id) || typeof row.name !== 'string' || !row.name || typeof row.status?.name !== 'string' || typeof row.precision?.name !== 'string' || typeof row.provider !== 'string' || typeof row.pad !== 'string') throw new Error('The receipt has incomplete or duplicate launch records.');
    for (const field of ['net','windowStart','windowEnd','lastUpdated']) if (row[field] != null && !Number.isFinite(Date.parse(row[field]))) throw new Error('The receipt has an invalid timestamp.');
    ids.add(row.id);
  }
  return data;
}

export function value(row, key) { return typeof row?.[key] === 'object' ? row[key]?.name || '' : row?.[key] || ''; }
export function changes(before, after) {
  if (!before || !after || before.id !== after.id) return [];
  return TRACKED.filter(([key]) => value(before,key) !== value(after,key)).map(([key,label]) => ({key,label,before:value(before,key),after:value(after,key)}));
}
export function comparison(current, baseline) {
  if (!baseline) return {changed:[],added:[],absent:[],matched:0};
  const previous = new Map(baseline.launches.map(row=>[row.id,row]));
  const present = new Set(current.launches.map(row=>row.id));
  const changed=[], added=[];
  let matched=0;
  for (const row of current.launches) {
    const before=previous.get(row.id);
    if (!before) added.push(row); else { matched++; const diff=changes(before,row); if(diff.length) changed.push({row,before,diff}); }
  }
  return {changed,added,absent:baseline.launches.filter(row=>!present.has(row.id)),matched};
}
export function filterLaunches(rows, filters={}) {
  const q=(filters.query||'').trim().toLowerCase();
  return rows.filter(row=>(!q || [row.name,row.rocket,row.mission,row.pad,row.location,row.provider,row.id].some(v=>String(v||'').toLowerCase().includes(q))) && (!filters.provider || row.provider===filters.provider) && (!filters.status || row.status.name===filters.status) && (!filters.pad || row.pad===filters.pad) && (!filters.from || (row.net||'').slice(0,10)>=filters.from) && (!filters.through || (row.net||'9999').slice(0,10)<=filters.through) && (!filters.changedOnly || filters.changedIds?.has(row.id)));
}
export function formatTime(input, precision='Minute') {
  if (!input) return 'Not supplied';
  const d=new Date(input);
  if (!Number.isFinite(d.getTime())) return 'Not supplied';
  const p=precision.toLowerCase();
  const y=d.getUTCFullYear(), month=d.toLocaleDateString('en-CA',{month:'short',timeZone:'UTC'});
  if(p.includes('year')) return `${y} · year precision`;
  if(p.includes('quarter')) return `Q${Math.floor(d.getUTCMonth()/3)+1} ${y} · quarter precision`;
  if(p.includes('month')) return `${month} ${y} · month precision`;
  const date=d.toLocaleDateString('en-CA',{year:'numeric',month:'short',day:'numeric',timeZone:'UTC'});
  if(p.includes('day')) return `${date} · day precision`;
  if(p.includes('hour')) return `${date}, ${String(d.getUTCHours()).padStart(2,'0')}:00 UTC · hour precision`;
  return `${date}, ${d.toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit',...(p==='second'?{second:'2-digit'}:{}),timeZone:'UTC'})} UTC${p==='not supplied'?' · precision unknown':''}`;
}
export function shiftText(before, after) {
  if(!before?.net || !after?.net || before.net===after.net) return '';
  const exact = p=>['minute','second'].includes(p.toLowerCase());
  if(!exact(before.precision.name)||!exact(after.precision.name)) return 'Reported time changed; precision may be broad.';
  const minutes=(Date.parse(after.net)-Date.parse(before.net))/60000;
  const amount=Math.abs(minutes), unit=amount>=1440?'days':amount>=60?'hours':'minutes';
  const n=amount/(unit==='days'?1440:unit==='hours'?60:1);
  return `${new Intl.NumberFormat('en-CA',{maximumFractionDigits:1}).format(n)} ${unit} ${minutes>0?'later':'earlier'} in this capture`;
}
export function sourceUrl(row) { return UUID.test(row?.id) ? `https://ll.thespacedevs.com/2.3.0/launches/${row.id}/` : null; }
export function toCsv(rows) {
  const cell=v=>{let s=String(v??'');if(/^[=+@\-\t\r]/.test(s))s="'"+s; return '"'+s.replaceAll('"','""')+'"';};
  const cols=[['id','Launch UUID'],['name','Launch'],['net','Reported time UTC'],['precision','Time precision'],['status','Provider status'],['provider','Provider'],['rocket','Rocket'],['pad','Pad'],['location','Location'],['lastUpdated','Provider updated UTC']];
  return [cols.map(x=>cell(x[1])).join(','),...rows.map(row=>cols.map(([key])=>cell(value(row,key))).join(','))].join('\r\n');
}
