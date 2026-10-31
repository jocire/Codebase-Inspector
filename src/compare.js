import fs from 'node:fs/promises';
import path from 'node:path';
import { limits } from './config.js';

function index(report){ return new Map(report.files.map(f=>[f.path,f])); }
function pct(part,total){ return total ? Math.round((part/total)*1000)/10 : 0; }
function lineDiff(a,b){
  const A=a.split(/\r?\n/), B=b.split(/\r?\n/); const n=A.length,m=B.length;
  if(n*m>400000) return {omitted:true,reason:'File is too large for inline LCS diff'};
  const dp=Array.from({length:n+1},()=>new Uint32Array(m+1));
  for(let i=n-1;i>=0;i--) for(let j=m-1;j>=0;j--) dp[i][j]=A[i]===B[j]?dp[i+1][j+1]+1:Math.max(dp[i+1][j],dp[i][j+1]);
  let i=0,j=0, added=0,removed=0; const hunks=[];
  while(i<n||j<m){
    if(i<n&&j<m&&A[i]===B[j]) { i++;j++; continue; }
    if(j<m&&(i===n||dp[i][j+1]>=dp[i+1]?.[j])) { added++; if(hunks.length<300) hunks.push({type:'add',newLine:j+1,text:B[j]}); j++; }
    else { removed++; if(hunks.length<300) hunks.push({type:'remove',oldLine:i+1,text:A[i]}); i++; }
  }
  return {added,removed,hunks,truncated:hunks.length>=300};
}
function dependencyComparison(a,b){
  const depKey=d=>`${d.ecosystem}:${d.name}:${d.kind}`; const da=new Map(a.dependencies.map(d=>[depKey(d),d])), db=new Map(b.dependencies.map(d=>[depKey(d),d]));
  const result={added:[],removed:[],changed:[],shared:[]};
  for(const [k,d] of da){ if(!db.has(k)) result.removed.push(d); else { result.shared.push({left:d,right:db.get(k)}); if(d.version!==db.get(k).version) result.changed.push({name:d.name,ecosystem:d.ecosystem,from:d.version,to:db.get(k).version,kind:d.kind}); } }
  for(const [k,d] of db) if(!da.has(k)) result.added.push(d);
  return result;
}
function metricDelta(a,b){ const delta={}; for(const k of new Set([...Object.keys(a.totals||{}),...Object.keys(b.totals||{})])) delta[k]=(b.totals?.[k]||0)-(a.totals?.[k]||0); return delta; }
function structuralDelta(a,b){ const out={}, A=a.deep?.summary||{}, B=b.deep?.summary||{}; for(const k of new Set([...Object.keys(A),...Object.keys(B)])) out[k]=(B[k]||0)-(A[k]||0); return out; }
function languageComparison(a,b){ const names=[...new Set([...Object.keys(a.languages||{}),...Object.keys(b.languages||{})])].sort(); return names.map(name=>({name,left:a.languages?.[name]||null,right:b.languages?.[name]||null})); }
function platformComparison(a,b){ return {left:a.platforms?.detected||[],right:b.platforms?.detected||[],shared:(a.platforms?.detected||[]).filter(x=>(b.platforms?.detected||[]).includes(x))}; }

export async function compareReports(aRoot,bRoot,a,b,mode='versions'){
  const A=index(a),B=index(b), common=[...A.keys()].filter(p=>B.has(p));
  const deps=dependencyComparison(a,b), delta=metricDelta(a,b), structural=structuralDelta(a,b);
  if(mode==='codebases'){
    const identical=common.filter(p=>A.get(p).hash&&A.get(p).hash===B.get(p).hash);
    const leftOnly=[...A.keys()].filter(p=>!B.has(p)), rightOnly=[...B.keys()].filter(p=>!A.has(p));
    const union=new Set([...A.keys(),...B.keys()]).size;
    const depUnion=new Set([...a.dependencies.map(d=>`${d.ecosystem}:${d.name}`),...b.dependencies.map(d=>`${d.ecosystem}:${d.name}`)]).size;
    const sharedDepNames=new Set(deps.shared.map(x=>`${x.left.ecosystem}:${x.left.name}`)).size;
    return {kind:'codebases',summary:{leftFiles:A.size,rightFiles:B.size,commonPaths:common.length,identicalCommonFiles:identical.length,leftOnly:leftOnly.length,rightOnly:rightOnly.length,pathOverlapPercent:pct(common.length,union),dependencyOverlapPercent:pct(sharedDepNames,depUnion)},leftOnly,rightOnly,commonPaths:common,identicalCommonFiles:identical,delta,structuralDelta:structural,languages:languageComparison(a,b),platforms:platformComparison(a,b),dependencies:deps,diffs:[]};
  }
  const added=[],removed=[],modified=[],unchanged=[];
  for(const [p,f] of A){ if(!B.has(p)) removed.push(p); else if(f.hash && B.get(p).hash && f.hash===B.get(p).hash) unchanged.push(p); else if(f.size!==B.get(p).size || f.hash!==B.get(p).hash) modified.push(p); else unchanged.push(p); }
  for(const p of B.keys()) if(!A.has(p)) added.push(p);
  const diffs=[];
  for(const p of modified.slice(0,limits.maxDiffFiles)){
    const fa=A.get(p),fb=B.get(p); if(fa.binary||fb.binary||fa.size>limits.maxDiffFileBytes||fb.size>limits.maxDiffFileBytes) { diffs.push({path:p,omitted:true,reason:'Binary or too large'}); continue; }
    try { const [ta,tb]=await Promise.all([fs.readFile(path.join(aRoot,p),'utf8'),fs.readFile(path.join(bRoot,p),'utf8')]); diffs.push({path:p,...lineDiff(ta,tb)}); } catch { diffs.push({path:p,omitted:true,reason:'Could not read file'}); }
  }
  const wpChanges={}, aWp=a.platforms?.wordpress?.integrations||{}, bWp=b.platforms?.wordpress?.integrations||{};
  for(const k of new Set([...Object.keys(aWp),...Object.keys(bWp)])){ const aa=new Set(aWp[k]||[]),bb=new Set(bWp[k]||[]); wpChanges[k]={added:[...bb].filter(x=>!aa.has(x)),removed:[...aa].filter(x=>!bb.has(x))}; }
  const superglobalDelta={}, aS=a.deep?.php?.superglobals||{}, bS=b.deep?.php?.superglobals||{};
  for(const k of new Set([...Object.keys(aS),...Object.keys(bS)])) superglobalDelta[k]=(bS[k]?.occurrences||0)-(aS[k]?.occurrences||0);
  return {kind:'versions',summary:{added:added.length,removed:removed.length,modified:modified.length,unchanged:unchanged.length},added,removed,modified,unchanged,delta,structuralDelta:structural,superglobalDelta,wordpressIntegrationChanges:wpChanges,dependencies:deps,diffs};
}
