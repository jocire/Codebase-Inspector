import path from 'node:path';

function uniq(xs){return [...new Set(xs.filter(Boolean))].sort();}
function topDir(p){const x=String(p).split('/');return x.length>1?x[0]:'(root)';}

export function buildInsights(report){
  const php=report.deep?.php?.files||[];
  const js=report.deep?.javascript?.files||[];
  const modules={};
  for(const f of report.files||[]){const d=topDir(f.path); const m=modules[d]||={name:d,files:0,bytes:0,php:0,jsTs:0,classes:0,functions:0};m.files++;m.bytes+=f.size||0;if(f.ext==='.php')m.php++;if(['.js','.jsx','.mjs','.cjs','.ts','.tsx'].includes(f.ext))m.jsTs++;}
  for(const f of php){const m=modules[topDir(f.path)];if(m){m.classes+=(f.declarations||[]).filter(x=>x.kind==='class').length;m.functions+=(f.functions||[]).length;}}
  for(const f of js){const m=modules[topDir(f.path)];if(m){m.classes+=(f.classes||[]).length;m.functions+=(f.functions||[]).length;}}

  const declarations=[]; const dependencyEdges=[]; const namespaceCounts={};
  for(const f of php){
    for(const d of f.declarations||[]){declarations.push({...d,file:f.path,namespace:f.namespace});}
    if(f.namespace) namespaceCounts[f.namespace]=(namespaceCounts[f.namespace]||0)+1;
    for(const u of f.uses||[]) dependencyEdges.push({from:f.path,to:u,kind:'php-use'});
    for(const d of f.declarations||[]){if(d.extends)dependencyEdges.push({from:`${f.namespace?f.namespace+'\\':''}${d.name}`,to:d.extends,kind:'extends'});for(const i of d.implements||[])dependencyEdges.push({from:`${f.namespace?f.namespace+'\\':''}${d.name}`,to:i,kind:'implements'});}
  }
  for(const f of js)for(const i of f.imports||[])dependencyEdges.push({from:f.path,to:i,kind:'js-import'});
  const hubs={}; for(const e of dependencyEdges)hubs[e.to]=(hubs[e.to]||0)+1;
  const mostReferenced=Object.entries(hubs).sort((a,b)=>b[1]-a[1]).slice(0,100).map(([name,references])=>({name,references}));
  const largeClasses=[];
  for(const f of php){const methods=f.functions||[];for(const d of (f.declarations||[]).filter(x=>x.kind==='class'))largeClasses.push({name:d.name,file:f.path,methods:methods.length,branches:f.complexity?.branches||0});}
  largeClasses.sort((a,b)=>(b.methods+b.branches/10)-(a.methods+a.branches/10));

  const wp=report.platforms?.wordpress; const byFile=wp?.integrationsByFile||[];
  const customTables=[];
  for(const f of byFile){if(f.customTables?.createTable||f.customTables?.dbDelta){customTables.push({path:f.path,createTable:f.customTables?.createTable||0,dbDelta:f.customTables?.dbDelta||0,tables:f.customTables?.tables||[]});}}
  const fieldFiles=[];
  for(const f of byFile){const cf=f.customFields||{}, acf=f.acf||{};const active=(cf.registerPostMeta||0)+(cf.registerMeta||0)+(cf.postMetaReads||0)+(cf.postMetaWrites||0)+(acf.fieldApi||0);if(active)fieldFiles.push({path:f.path,keys:f.customFieldKeys||[],reads:cf.postMetaReads||0,writes:cf.postMetaWrites||0,registered:(cf.registerPostMeta||0)+(cf.registerMeta||0),rest:cf.showInRest||0,auth:cf.authCallback||0,acfCalls:acf.fieldApi||0,acfGroups:acf.localGroups||0,acfRepeater:acf.repeater||0,acfFieldKeys:acf.fieldKeys||[]});}

  const testPatterns=/(^|\/)(tests?|spec|__tests__)(\/|$)|\.(test|spec)\.(js|jsx|ts|tsx|php)$/i;
  const testFiles=(report.files||[]).filter(f=>testPatterns.test(f.path)).map(f=>f.path);
  const toolNames=[]; const depNames=new Set((report.dependencies||[]).map(x=>x.name));
  const probes=[['PHPUnit',['phpunit/phpunit']],['Pest',['pestphp/pest']],['PHPStan',['phpstan/phpstan']],['Psalm',['vimeo/psalm']],['PHPCS/WPCS',['squizlabs/php_codesniffer','wp-coding-standards/wpcs']],['PHPCompatibility',['phpcompatibility/php-compatibility']],['Jest',['jest']],['Vitest',['vitest']],['Playwright',['@playwright/test','playwright']],['Cypress',['cypress']],['ESLint',['eslint']],['TypeScript',['typescript']]];
  for(const [label,names] of probes)if(names.some(n=>depNames.has(n)))toolNames.push(label);
  const scripts=wp?[]:Object.entries(report.platforms?.node?.scripts||{}).filter(([k,v])=>/test|lint|check|type|coverage/i.test(k+' '+v)).map(([k,v])=>`${k}: ${v}`);
  const prodFiles=(report.files||[]).filter(f=>!testPatterns.test(f.path)&&['.php','.js','.jsx','.ts','.tsx'].includes(f.ext)).length;

  const docFiles=(report.files||[]).filter(f=>/^(readme(\.md|\.txt)?|changelog\.md|agents\.md|roadmap\.md|contributing\.md)$/i.test(path.basename(f.path))||/^docs\//i.test(f.path)).map(f=>f.path);
  const docNames=new Set(docFiles.map(p=>path.basename(p).toLowerCase()));
  const publicApiCount=php.reduce((n,f)=>n+(f.functions||[]).filter(fn=>!(fn.modifiers||[]).includes('private')&&!(fn.modifiers||[]).includes('protected')).length+(f.declarations||[]).length,0)+(wp?.integrations?.actionsFired?.length||0)+(wp?.integrations?.filtersApplied?.length||0);
  const phpDocSignals=php.reduce((n,f)=>n+(f.functions||[]).length,0); // denominator proxy; parser-lite does not retain comments.

  const allFieldKeys=wp?.integrations?.customFieldKeys||wp?.integrations?.metaKeys||[];
  const fields=allFieldKeys.map(key=>{const matches=fieldFiles.filter(f=>(f.keys||[]).includes(key)||(f.acfFieldKeys||[]).includes(key));return {key,files:matches.map(x=>x.path),registeredIn:matches.filter(x=>x.registered).map(x=>x.path),restFiles:matches.filter(x=>x.rest).map(x=>x.path),acf:matches.some(x=>(x.acfFieldKeys||[]).includes(key)||x.acfCalls)};});
  return {
    schemaVersion:'1.0',
    architecture:{modules:Object.values(modules).sort((a,b)=>b.files-a.files),namespaces:Object.entries(namespaceCounts).sort((a,b)=>b[1]-a[1]).map(([name,files])=>({name,files})),declarations,dependencyEdges:dependencyEdges.slice(0,5000),mostReferenced,largeClasses:largeClasses.slice(0,100)},
    dataModel:{customTables,customFields:{keys:allFieldKeys,fields,files:fieldFiles,summary:{keys:allFieldKeys.length,files:fieldFiles.length,registered:fieldFiles.reduce((n,x)=>n+x.registered,0),restExposed:fieldFiles.reduce((n,x)=>n+x.rest,0),acfFiles:fieldFiles.filter(x=>x.acfCalls||x.acfGroups).length,repeaterFiles:fieldFiles.filter(x=>x.acfRepeater).length}}},
    tests:{files:testFiles,summary:{testFiles:testFiles.length,productionSourceFiles:prodFiles,ratio:prodFiles?testFiles.length/prodFiles:0},tools:uniq(toolNames),scripts},
    documentationHealth:{files:docFiles,hasReadme:[...docNames].some(x=>x.startsWith('readme')),hasChangelog:docNames.has('changelog.md'),hasAgents:docNames.has('agents.md'),hasRoadmap:docNames.has('roadmap.md'),hasContributing:docNames.has('contributing.md'),docsDirectory:docFiles.some(x=>x.startsWith('docs/')),publicApiSurface:publicApiCount,notes:[`Public API surface proxy: ${publicApiCount} detected declarations/functions/hooks.`, `PHP callable surface proxy: ${phpDocSignals}; comment-level documentation coverage requires a future AST/PHPDoc parser.`]},
  };
}
