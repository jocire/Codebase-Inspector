import express from 'express';
import multer from 'multer';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { limits } from './config.js';
import { extractZip } from './extract.js';
import { analyzeTree } from './analyze.js';
import { compareReports } from './compare.js';

const __dirname=path.dirname(fileURLToPath(import.meta.url));
const app=express();
const upload=multer({dest:path.join(os.tmpdir(),'codebase-inspector-upload'),limits:{fileSize:limits.maxUploadBytes,files:2}});
app.use((req,res,next)=>{ res.set('Cache-Control','no-store'); next(); });
app.use(express.static(path.join(__dirname,'../public')));
app.use(express.json({limit:'1mb'}));

async function prepare(file){
  if(!file?.originalname?.toLowerCase().endsWith('.zip')) throw new Error('Only ZIP archives are supported');
  const started=performance.now();
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'codebase-inspector-'));
  const t0=performance.now();
  const extraction=await extractZip(file.path,dir);
  const t1=performance.now();
  const entries=await fs.readdir(dir,{withFileTypes:true});
  const root=entries.length===1&&entries[0].isDirectory()?path.join(dir,entries[0].name):dir;
  const report=await analyzeTree(root);
  const ended=performance.now();
  return {dir,root,report,run:{archive:file.originalname,extractedFiles:extraction.files,extractedBytes:extraction.bytes,extractMs:Math.round(t1-t0),analyzeMs:Math.round(ended-t1),totalMs:Math.round(ended-started),warnings:[]}};
}
async function cleanup(items){ for(const item of items){ if(!item)continue; await fs.rm(item.dir,{recursive:true,force:true}).catch(()=>{}); } }

app.post('/api/analyze',upload.single('archive'),async(req,res)=>{ let item; try { item=await prepare(req.file); res.json({...item.report,run:item.run}); } catch(e){ res.status(400).json({error:e.message,run:{status:'error'}}); } finally { await cleanup([item]); if(req.file) await fs.rm(req.file.path,{force:true}).catch(()=>{}); } });
app.post('/api/compare',upload.fields([{name:'before',maxCount:1},{name:'after',maxCount:1}]),async(req,res)=>{ let a,b; const files=[...(req.files?.before||[]),...(req.files?.after||[])]; try { const mode=req.body?.comparisonType==='codebases'?'codebases':'versions'; const started=performance.now(); a=await prepare(req.files?.before?.[0]); b=await prepare(req.files?.after?.[0]); const compareStarted=performance.now(); const comparison=await compareReports(a.root,b.root,a.report,b.report,mode); const totalMs=Math.round(performance.now()-started); res.json({comparisonType:mode,before:a.report,after:b.report,comparison,run:{status:'ok',totalMs,compareMs:Math.round(performance.now()-compareStarted),before:a.run,after:b.run,warnings:[]}}); } catch(e){ res.status(400).json({error:e.message,run:{status:'error'}}); } finally { await cleanup([a,b]); for(const f of files) await fs.rm(f.path,{force:true}).catch(()=>{}); } });
app.get('/api/health',(_,res)=>res.json({ok:true,version:'0.8.1',id:crypto.randomUUID()}));
app.listen(process.env.PORT||4178,()=>console.log(`Codebase Inspector: http://localhost:${process.env.PORT||4178}`));
