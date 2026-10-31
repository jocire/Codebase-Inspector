function uniq(values){ return [...new Set(values.filter(Boolean))].sort(); }
function countMatches(text,re){ return [...text.matchAll(re)].length; }
function lineOf(text,index){ return text.slice(0,index).split('\n').length; }
function snippetLine(text,index){ const start=text.lastIndexOf('\n',index)+1; const end=text.indexOf('\n',index); return text.slice(start,end<0?text.length:end).trim().slice(0,240); }

const phpSuperglobals=['_GET','_POST','_REQUEST','_SERVER','_COOKIE','_FILES','_SESSION','_ENV','GLOBALS'];

function inspectPhpFile(file){
  const t=file.text;
  const namespace=t.match(/\bnamespace\s+([^;{]+)[;{]/)?.[1]?.trim()||null;
  const uses=uniq([...t.matchAll(/^\s*use\s+([^;]+);/gm)].flatMap(m=>m[1].split(',').map(x=>x.trim())));
  const declarations=[];
  const classRe=/(?:^|\n)\s*((?:(?:abstract|final|readonly)\s+)*)((class|interface|trait|enum))\s+([A-Za-z_][\w]*)\s*([^\{]*)\{/g;
  for(const m of t.matchAll(classRe)){
    const tail=m[5]||'';
    declarations.push({
      kind:m[2], name:m[4], modifiers:m[1].trim().split(/\s+/).filter(Boolean), line:lineOf(t,m.index),
      extends:tail.match(/\bextends\s+([\\A-Za-z_][\\\w]*)/)?.[1]||null,
      implements:uniq((tail.match(/\bimplements\s+([^\{]+)/)?.[1]||'').split(',').map(x=>x.trim())),
    });
  }
  const functions=[];
  const fnRe=/\b((?:(?:public|protected|private|static|final|abstract)\s+)*)function\s+&?\s*([A-Za-z_][\w]*)\s*\(([^)]*)\)\s*(?::\s*([^\{;]+))?/g;
  for(const m of t.matchAll(fnRe)) functions.push({name:m[2],modifiers:m[1].trim().split(/\s+/).filter(Boolean),parameters:m[3].trim(),returnType:m[4]?.trim()||null,line:lineOf(t,m.index)});
  const properties=[...t.matchAll(/(?:^|\n)\s*(public|protected|private)\s+(static\s+)?(?:readonly\s+)?(?:[?\\\w|&]+\s+)?\$([A-Za-z_]\w*)/g)].map(m=>({name:m[3],visibility:m[1],static:Boolean(m[2]),line:lineOf(t,m.index)}));
  const constants=[...t.matchAll(/\bconst\s+([A-Z_a-z][\w]*)\s*=/g)].map(m=>({name:m[1],line:lineOf(t,m.index)}));
  const superglobals={};
  for(const sg of phpSuperglobals){
    const re=new RegExp(`\\$${sg}\\s*(?:\\[[^\\]]+\\])?`,'g');
    const entries=[];
    for(const m of t.matchAll(re)){
      const after=t.slice(m.index+m[0].length,m.index+m[0].length+12);
      entries.push({line:lineOf(t,m.index),access:/^\s*=/.test(after)?'write':'read',expression:m[0],context:snippetLine(t,m.index)});
    }
    if(entries.length) superglobals[`$${sg}`]=entries;
  }
  const inputFunctions={
    sanitization:uniq([...t.matchAll(/\b(sanitize_[a-z0-9_]+|absint|intval|floatval|wp_unslash|wp_kses(?:_post)?|esc_url_raw)\s*\(/gi)].map(m=>m[1])),
    escaping:uniq([...t.matchAll(/\b(esc_html|esc_attr|esc_url|esc_js|wp_kses(?:_post)?)\s*\(/gi)].map(m=>m[1])),
    nonceChecks:uniq([...t.matchAll(/\b(check_ajax_referer|check_admin_referer|wp_verify_nonce)\s*\(/g)].map(m=>m[1])),
    capabilityChecks:uniq([...t.matchAll(/\b(current_user_can|user_can)\s*\(/g)].map(m=>m[1])),
    sqlPreparation:uniq([...t.matchAll(/\$wpdb->(prepare|esc_like)\s*\(/g)].map(m=>`$wpdb->${m[1]}`)),
  };
  const db={
    wpdbMethods:uniq([...t.matchAll(/\$wpdb->(get_results|get_row|get_var|get_col|query|insert|update|delete|replace|prepare|esc_like)\s*\(/g)].map(m=>m[1])),
    tables:uniq([...t.matchAll(/\$wpdb->(?:prefix\s*\.\s*)?['"]?([A-Za-z0-9_]+)['"]?/g)].map(m=>m[1])),
    directSql:countMatches(t,/\b(?:SELECT|INSERT\s+INTO|UPDATE|DELETE\s+FROM|CREATE\s+TABLE|ALTER\s+TABLE|DROP\s+TABLE)\b/gi),
    dbDelta:countMatches(t,/\bdbDelta\s*\(/g),
  };
  const complexity={
    branches:countMatches(t,/\b(if|elseif|for|foreach|while|case|catch)\b|&&|\|\||\?[^:?]/g),
    todos:countMatches(t,/\b(TODO|FIXME|HACK|XXX)\b/gi),
    evalCalls:countMatches(t,/\beval\s*\(/g),
  };
  return {path:file.path,namespace,uses,declarations,functions,properties,constants,superglobals,inputFunctions,db,complexity};
}

function inspectJsFile(file){
  const t=file.text;
  const imports=uniq([
    ...[...t.matchAll(/\bimport\s+(?:[^'";]+?\s+from\s+)?['"]([^'"]+)['"]/g)].map(m=>m[1]),
    ...[...t.matchAll(/\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g)].map(m=>m[1]),
  ]);
  const exports=uniq([
    ...[...t.matchAll(/\bexport\s+(?:default\s+)?(?:class|function|const|let|var)\s+([A-Za-z_$][\w$]*)/g)].map(m=>m[1]),
    ...[...t.matchAll(/\bexports\.([A-Za-z_$][\w$]*)\s*=|\bmodule\.exports\s*=\s*\{?\s*([A-Za-z_$][\w$]*)?/g)].map(m=>m[1]||m[2]),
  ]);
  const classes=[...t.matchAll(/\bclass\s+([A-Za-z_$][\w$]*)(?:\s+extends\s+([A-Za-z_$][\w$\.]*))?/g)].map(m=>({name:m[1],extends:m[2]||null,line:lineOf(t,m.index)}));
  const functions=[...t.matchAll(/\b(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(([^)]*)\)|\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\(([^)]*)\)\s*=>/g)].map(m=>({name:m[1]||m[3],parameters:(m[2]??m[4]??'').trim(),line:lineOf(t,m.index)}));
  const env=uniq([...t.matchAll(/\bprocess\.env(?:\.([A-Z0-9_]+)|\[['"]([^'"]+)['"]\])/g)].map(m=>m[1]||m[2]));
  const complexity={branches:countMatches(t,/\b(if|for|while|case|catch)\b|&&|\|\||\?[^:?]/g),todos:countMatches(t,/\b(TODO|FIXME|HACK|XXX)\b/gi),evalCalls:countMatches(t,/\beval\s*\(/g),newFunction:countMatches(t,/\bnew\s+Function\s*\(/g)};
  return {path:file.path,imports,exports,classes,functions,environmentVariables:env,complexity};
}

export function inspectDeep(textFiles){
  const phpFiles=textFiles.filter(f=>f.ext==='.php').map(inspectPhpFile);
  const jsFiles=textFiles.filter(f=>['.js','.jsx','.mjs','.cjs','.ts','.tsx'].includes(f.ext)).map(inspectJsFile);
  const superglobals={};
  for(const sg of phpSuperglobals){
    const key=`$${sg}`; const files=[]; let reads=0,writes=0,occurrences=0;
    for(const f of phpFiles){ const e=f.superglobals[key]||[]; if(!e.length)continue; files.push({path:f.path,occurrences:e.length,lines:e.map(x=>x.line),reads:e.filter(x=>x.access==='read').length,writes:e.filter(x=>x.access==='write').length}); occurrences+=e.length; reads+=e.filter(x=>x.access==='read').length; writes+=e.filter(x=>x.access==='write').length; }
    if(occurrences) superglobals[key]={occurrences,reads,writes,files};
  }
  const classes=phpFiles.reduce((n,f)=>n+f.declarations.filter(x=>x.kind==='class').length,0)+jsFiles.reduce((n,f)=>n+f.classes.length,0);
  const interfaces=phpFiles.reduce((n,f)=>n+f.declarations.filter(x=>x.kind==='interface').length,0);
  const traits=phpFiles.reduce((n,f)=>n+f.declarations.filter(x=>x.kind==='trait').length,0);
  const enums=phpFiles.reduce((n,f)=>n+f.declarations.filter(x=>x.kind==='enum').length,0);
  const functions=phpFiles.reduce((n,f)=>n+f.functions.length,0)+jsFiles.reduce((n,f)=>n+f.functions.length,0);
  const riskSignals=[];
  for(const f of phpFiles){
    const inputCount=Object.values(f.superglobals).flat().filter(x=>['$_GET','$_POST','$_REQUEST','$_COOKIE','$_FILES'].some(s=>x.expression.startsWith(s))).length;
    if(inputCount && !f.inputFunctions.sanitization.length) riskSignals.push({severity:'review',rule:'WP-INPUT-001',file:f.path,message:'Request input is accessed, but no common WordPress sanitization function was detected in this file.'});
    if(inputCount && !f.inputFunctions.nonceChecks.length && /wp_ajax_|admin_post_|save_post|register_rest_route/.test(textFiles.find(x=>x.path===f.path)?.text||'')) riskSignals.push({severity:'review',rule:'WP-NONCE-001',file:f.path,message:'Request-handling code accesses input without a common nonce verification call detected in this file.'});
    if(f.db.directSql && f.db.wpdbMethods.some(x=>['query','get_results','get_row','get_var','get_col'].includes(x)) && !f.inputFunctions.sqlPreparation.length) riskSignals.push({severity:'review',rule:'WP-DB-001',file:f.path,message:'Direct SQL / $wpdb read or query usage detected without $wpdb->prepare() in this file.'});
    if(f.complexity.evalCalls) riskSignals.push({severity:'review',rule:'PHP-DYNAMIC-001',file:f.path,message:`eval() detected (${f.complexity.evalCalls}).`});
  }
  for(const f of jsFiles) if(f.complexity.evalCalls||f.complexity.newFunction) riskSignals.push({severity:'review',rule:'JS-DYNAMIC-001',file:f.path,message:`Dynamic code execution detected (eval: ${f.complexity.evalCalls}, new Function: ${f.complexity.newFunction}).`});
  return {
    summary:{classes,interfaces,traits,enums,functions,phpFiles:phpFiles.length,jsTsFiles:jsFiles.length},
    php:{files:phpFiles.filter(f=>f.declarations.length||f.functions.length||Object.keys(f.superglobals).length||f.db.directSql||f.complexity.todos).slice(0,5000),superglobals},
    javascript:{files:jsFiles.filter(f=>f.classes.length||f.functions.length||f.imports.length||f.exports.length).slice(0,5000)},
    riskSignals:riskSignals.slice(0,2000),
    notes:['Risk signals are deterministic review hints, not vulnerability findings.','Structural extraction is parser-lite and may miss dynamic or unusual syntax.'],
  };
}
