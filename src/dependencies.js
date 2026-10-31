import fs from 'node:fs/promises';
import path from 'node:path';
import { exists } from './utils.js';

async function json(file){ try { return JSON.parse(await fs.readFile(file,'utf8')); } catch { return null; } }
function pushObj(out, ecosystem, source, obj, kind){
  for (const [name, version] of Object.entries(obj || {})) out.push({ ecosystem, source, kind, name, version:String(version) });
}
export async function detectDependencies(root){
  const out = [];
  const pkg = path.join(root,'package.json');
  if (await exists(pkg)) { const j=await json(pkg); pushObj(out,'npm','package.json',j?.dependencies,'runtime'); pushObj(out,'npm','package.json',j?.devDependencies,'dev'); pushObj(out,'npm','package.json',j?.peerDependencies,'peer'); }
  const composer = path.join(root,'composer.json');
  if (await exists(composer)) { const j=await json(composer); pushObj(out,'composer','composer.json',j?.require,'runtime'); pushObj(out,'composer','composer.json',j?.['require-dev'],'dev'); }
  const req = path.join(root,'requirements.txt');
  if (await exists(req)) for (const line of (await fs.readFile(req,'utf8')).split(/\r?\n/)) { const s=line.trim(); if(!s||s.startsWith('#')) continue; const m=s.match(/^([^<>=!~\s]+)\s*(.*)$/); if(m) out.push({ecosystem:'pip',source:'requirements.txt',kind:'runtime',name:m[1],version:m[2]||'*'}); }
  const go = path.join(root,'go.mod');
  if (await exists(go)) { const text=await fs.readFile(go,'utf8'); for (const m of text.matchAll(/^\s*([^\s()]+)\s+(v[^\s]+)\s*$/gm)) if(!['module','go','require'].includes(m[1])) out.push({ecosystem:'go',source:'go.mod',kind:'runtime',name:m[1],version:m[2]}); }
  const cargo = path.join(root,'Cargo.toml');
  if (await exists(cargo)) { const text=await fs.readFile(cargo,'utf8'); const block=text.match(/\[dependencies\]([\s\S]*?)(?:\n\[|$)/)?.[1]||''; for(const line of block.split(/\r?\n/)){ const m=line.match(/^\s*([\w-]+)\s*=\s*(.+)$/); if(m) out.push({ecosystem:'cargo',source:'Cargo.toml',kind:'runtime',name:m[1],version:m[2].trim()}); } }
  return out;
}
