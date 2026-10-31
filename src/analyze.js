import fs from 'node:fs/promises';
import path from 'node:path';
import { ignoredDirs, binaryExtensions, limits } from './config.js';
import { sha256, posix } from './utils.js';
import { detectDependencies } from './dependencies.js';
import { inspectOop } from './oop.js';
import { inspectPlatforms } from './platforms.js';
import { inspectDeep } from './deep-analysis.js';
import { buildDocumentation } from './documentation.js';
import { buildInsights } from './insights.js';

const codeExts = new Set(['.php','.js','.jsx','.mjs','.cjs','.ts','.tsx','.css','.scss','.sass','.less','.html','.htm','.vue','.svelte','.py','.rb','.java','.cs','.c','.h','.cpp','.cc','.hpp','.go','.rs','.swift','.kt','.kts','.sh','.ps1','.sql','.xml','.yaml','.yml','.json','.toml','.md']);

function classify(ext){
  const map={'.php':'PHP','.js':'JavaScript','.jsx':'JavaScript','.mjs':'JavaScript','.cjs':'JavaScript','.ts':'TypeScript','.tsx':'TypeScript','.py':'Python','.rb':'Ruby','.java':'Java','.cs':'C#','.go':'Go','.rs':'Rust','.c':'C','.h':'C/C++','.cpp':'C++','.cc':'C++','.hpp':'C++','.css':'CSS','.scss':'SCSS','.html':'HTML','.htm':'HTML','.sql':'SQL','.json':'JSON','.md':'Markdown','.yml':'YAML','.yaml':'YAML','.xml':'XML','.sh':'Shell','.ps1':'PowerShell'};
  return map[ext] || (ext ? ext.slice(1).toUpperCase() : '(no extension)');
}
function commentLike(line, ext){
  const s=line.trim(); if(!s) return 'blank';
  if(['.php','.js','.jsx','.ts','.tsx','.java','.cs','.c','.cpp','.cc','.h','.hpp','.go','.rs','.swift','.kt'].includes(ext) && (s.startsWith('//')||s.startsWith('/*')||s.startsWith('*')||s.startsWith('*/'))) return 'comment';
  if(['.py','.rb','.sh','.ps1','.yml','.yaml'].includes(ext) && s.startsWith('#')) return 'comment';
  if(['.html','.htm','.xml'].includes(ext) && (s.startsWith('<!--')||s.endsWith('-->'))) return 'comment';
  return 'code';
}
export async function analyzeTree(root){
  const report={ schemaVersion:'0.8.0', analyzer:'Codebase Inspector', rootName:path.basename(root), totals:{files:0,folders:0,bytes:0,lines:0,codeLines:0,commentLines:0,blankLines:0}, fileTypes:{}, languages:{}, largestFiles:[], files:[], dependencies:[], oop:{classes:0,methods:0,byLanguage:{},symbols:[]}, platforms:{detected:[],wordpress:null,node:null}, deep:null, insights:null, documentation:null };
  const textFiles=[];
  async function walk(dir){
    const entries=await fs.readdir(dir,{withFileTypes:true});
    for(const ent of entries){
      if(ent.isSymbolicLink()) continue;
      if(ent.isDirectory() && ignoredDirs.has(ent.name)) continue;
      const full=path.join(dir,ent.name); const rel=posix(path.relative(root,full));
      if(ent.isDirectory()){ report.totals.folders++; await walk(full); continue; }
      if(!ent.isFile()) continue;
      const st=await fs.stat(full); report.totals.files++; report.totals.bytes+=st.size;
      const ext=path.extname(ent.name).toLowerCase(); const type=ext||'(none)';
      report.fileTypes[type]=(report.fileTypes[type]||0)+1;
      let hash='', lines=null, text=null, binary=binaryExtensions.has(ext) || st.size>limits.maxSingleFileBytes;
      if(!binary){
        const buf=await fs.readFile(full); hash=sha256(buf); if(buf.includes(0)) binary=true; else text=buf.toString('utf8');
      }
      if(text!==null && codeExts.has(ext)){
        const arr=text.split(/\r?\n/); const counts={lines:arr.length,code:0,comment:0,blank:0};
        for(const line of arr) counts[commentLike(line,ext)]++;
        lines=counts; report.totals.lines+=counts.lines; report.totals.codeLines+=counts.code; report.totals.commentLines+=counts.comment; report.totals.blankLines+=counts.blank;
        const lang=classify(ext); const l=report.languages[lang] ||= {files:0,lines:0,code:0,comment:0,blank:0,bytes:0};
        l.files++; l.lines+=counts.lines;l.code+=counts.code;l.comment+=counts.comment;l.blank+=counts.blank;l.bytes+=st.size;
        textFiles.push({path:rel,ext,text,size:st.size});
        const oop=inspectOop(ext,text); if(oop.language){
          const bucket=report.oop.byLanguage[oop.language] ||= {classes:0,methods:0}; bucket.classes+=oop.classes.length; bucket.methods+=oop.methods.length;
          report.oop.classes+=oop.classes.length; report.oop.methods+=oop.methods.length;
          if(oop.classes.length||oop.methods.length) report.oop.symbols.push({path:rel,language:oop.language,classes:oop.classes,methods:oop.methods});
        }
      }
      report.files.push({path:rel,size:st.size,ext:type,binary,hash,lines});
      report.largestFiles.push({path:rel,size:st.size}); report.largestFiles.sort((a,b)=>b.size-a.size); if(report.largestFiles.length>20) report.largestFiles.length=20;
    }
  }
  await walk(root);
  report.dependencies=await detectDependencies(root);
  report.platforms=await inspectPlatforms(root,textFiles);
  report.deep=inspectDeep(textFiles);
  report.insights=buildInsights(report);
  report.documentation=buildDocumentation(report);
  report.oop.symbols=report.oop.symbols.slice(0,1000);
  return report;
}
