const $ = (selector) => document.querySelector(selector);
const results = $('#results');
const status = $('#status');
const exportBar = $('#exportBar');
const APP_VERSION = '0.8.1';
let backendReady = true;

async function verifyBackend() {
  try {
    const response = await fetch('/api/health', { cache: 'no-store' });
    const data = await response.json();
    if (!response.ok || data.version !== APP_VERSION) {
      backendReady = false;
      status.textContent = `Backend version mismatch: UI ${APP_VERSION}, server ${data.version || 'unknown'}. Stop the old Node process and restart this release.`;
    }
  } catch (error) {
    backendReady = false;
    status.textContent = `Backend health check failed: ${error.message}`;
  }
}
verifyBackend();

const selectedFiles = { single: null, before: null, after: null };
let exportState = null;
let runTimer = null;
function formatDuration(ms){ const sec=Math.max(0,ms)/1000; return sec<60?`${sec.toFixed(sec<10?1:0)} s`:`${Math.floor(sec/60)}m ${Math.round(sec%60)}s`; }
function estimateRange(fileCountBytes, multiplier=1){
  const mb=Math.max(1,fileCountBytes/(1024*1024));
  const low=Math.max(2,Math.round((2+mb*0.35)*multiplier));
  const high=Math.max(low+2,Math.round((5+mb*1.0)*multiplier));
  return `Typical estimate: ~${low}–${high} s`; 
}
function startRunStatus(title, estimate, stages){
  const box=$('#analysisStatus'); box.hidden=false; box.classList.remove('status-error','status-success');
  $('#statusTitle').textContent=title; $('#statusEstimate').textContent=estimate||''; $('#statusDetails').innerHTML='';
  const started=performance.now(); let stage=0; let progress=8;
  $('#progressFill').style.width=`${progress}%`; $('#statusStage').textContent=stages?.[0]||'Starting…'; $('#statusElapsed').textContent='Elapsed: 0.0 s';
  clearInterval(runTimer); runTimer=setInterval(()=>{
    const elapsed=performance.now()-started; $('#statusElapsed').textContent=`Elapsed: ${formatDuration(elapsed)}`;
    progress=Math.min(91,progress+Math.max(.3,(91-progress)*.025)); $('#progressFill').style.width=`${progress}%`;
    const next=Math.min((stages?.length||1)-1,Math.floor((progress/92)*(stages?.length||1)));
    if(next!==stage){stage=next;$('#statusStage').textContent=stages?.[stage]||'Analyzing…';}
  },250);
  return started;
}
function finishRunStatus({ok=true,title,run,details=[]}){
  clearInterval(runTimer); runTimer=null; const box=$('#analysisStatus'); box.hidden=false; box.classList.toggle('status-error',!ok); box.classList.toggle('status-success',ok);
  $('#statusTitle').textContent=title; $('#progressFill').style.width='100%'; $('#statusStage').textContent=ok?'Completed':'Stopped with an error';
  if(run?.totalMs!=null) $('#statusElapsed').textContent=`Elapsed: ${formatDuration(run.totalMs)}`;
  $('#statusEstimate').textContent='';
  const rows=[...(details||[])]; if(run?.warnings?.length) rows.push(`${run.warnings.length} warning(s)`);
  $('#statusDetails').innerHTML=rows.length?rows.map(x=>`<span>${esc(x)}</span>`).join(''):'';
}
function comparisonType(){ return document.querySelector('input[name="comparisonType"]:checked')?.value==='codebases'?'codebases':'versions'; }
function syncCompareTypeUI(){
  const different=comparisonType()==='codebases';
  $('#beforeTitle').textContent=different?'Codebase A':'Earlier version'; $('#afterTitle').textContent=different?'Codebase B':'Newer version';
  $('#compareBtn').textContent=different?'Compare codebases':'Compare versions';
}
for(const radio of document.querySelectorAll('input[name="comparisonType"]')) radio.addEventListener('change',syncCompareTypeUI);
syncCompareTypeUI();

for (const tab of document.querySelectorAll('.tab')) {
  tab.onclick = () => {
    document.querySelectorAll('.tab').forEach((item) => item.classList.remove('active'));
    tab.classList.add('active');
    $('#analyzeView').hidden = tab.dataset.mode !== 'analyze';
    $('#compareView').hidden = tab.dataset.mode !== 'compare';
    results.innerHTML = '';
    status.textContent = '';
    exportState = null;
    exportBar.hidden = true;
  };
}

const n = (value) => new Intl.NumberFormat().format(value || 0);
const bytes = (value) => {
  const units = ['B', 'KB', 'MB', 'GB'];
  let unit = 0, size = value || 0;
  while (size >= 1024 && unit < units.length - 1) { size /= 1024; unit++; }
  return `${size.toFixed(unit ? 1 : 0)} ${units[unit]}`;
};
const esc = (value) => escapeHtml(value ?? '');
const tags = (items) => items?.length ? `<div class="tag-list">${items.map((x) => `<span class="tag">${esc(x)}</span>`).join('')}</div>` : '<span class="muted">None detected.</span>';
const yesNo = (value) => `<span class="${value ? 'yes' : 'no'}">${value ? 'Yes' : 'No'}</span>`;

function cards(report) {
  const totals = report.totals;
  return `<div class="cards">${[
    ['Files in codebase', n(totals.files)], ['Folders', n(totals.folders)], ['Extracted size', bytes(totals.bytes)],
    ['Lines', n(totals.lines)], ['Code lines', n(totals.codeLines)], ['Classes', n(report.oop.classes)],
    ['Methods', n(report.oop.methods)], ['Dependencies', n(report.dependencies.length)],
  ].map(([label, value]) => `<div class="card"><b>${value}</b><span>${label}</span></div>`).join('')}</div>`;
}

function table(rows, columns) {
  if (!rows?.length) return '<span class="muted">No entries detected.</span>';
  return `<table><thead><tr>${columns.map((column) => `<th>${column[0]}</th>`).join('')}</tr></thead><tbody>${rows.map((row) => `<tr>${columns.map((column) => `<td>${column[1](row)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
}

function wordpressPanel(wp, documentation, insights) {
  if (!wp) return '';
  const identity=wp.plugin||wp.theme||{}, ints=wp.integrations||{}, cf=documentation?.developerGuide?.customFields, cfi=insights?.dataModel?.customFields;
  const byFile=wp.integrationsByFile||[];
  const hookCounts=[['Registered actions',ints.actionsRegistered?.length],['Registered filters',ints.filtersRegistered?.length],['Actions fired',ints.actionsFired?.length],['Filters applied',ints.filtersApplied?.length]];
  const dataCounts=[['Options',ints.options?.length],['Site options',ints.siteOptions?.length],['Transients',ints.transients?.length],['Site transients',ints.siteTransients?.length],['Cache groups',ints.cacheGroups?.length],['Meta/custom-field keys',ints.customFieldKeys?.length||ints.metaKeys?.length]];
  const panes=[
    ['wp-summary','Summary',`<div class="subgrid"><div><h4>Project identity</h4><dl class="kv"><dt>Name</dt><dd>${esc(identity.name||'—')}</dd><dt>Version</dt><dd>${esc(identity.version||'—')}</dd><dt>Text domain</dt><dd>${esc(identity.textDomain||'—')}</dd><dt>Requires WordPress</dt><dd>${esc(identity.requiresWordPress||'—')}</dd><dt>Requires PHP</dt><dd>${esc(identity.requiresPhp||'—')}</dd><dt>Primary file</dt><dd><code>${esc(wp.pluginFile||'—')}</code></dd></dl></div><div><h4>Compatibility indicators</h4><dl class="kv">${Object.entries(wp.indicators||{}).filter(([k])=>!['wpml'].includes(k)).map(([k,v])=>`<dt>${esc(k)}</dt><dd>${yesNo(v)}</dd>`).join('')}</dl></div></div>`],
    ['wp-hooks','Hooks',`${table(hookCounts.map(([name,count])=>({name,count:count||0})),[['Type',x=>esc(x.name)],['Unique entries',x=>n(x.count)]])}<div class="subgrid"><div><h4>Actions registered</h4>${tags(ints.actionsRegistered)}</div><div><h4>Filters registered</h4>${tags(ints.filtersRegistered)}</div><div><h4>Actions exposed</h4>${tags(ints.actionsFired)}</div><div><h4>Filters exposed</h4>${tags(ints.filtersApplied)}</div></div>`],
    ['wp-fields','Custom Fields',cf?`<div class="cards compact">${[['Keys',cf.summary?.keys],['Files',cf.summary?.files],['ACF files',cf.summary?.acfFiles],['Registered meta',cf.summary?.registeredMeta],['REST exposed',cf.summary?.restExposed],['Repeater files',cfi?.summary?.repeaterFiles]].map(([l,v])=>`<div class="card"><b>${n(v)}</b><span>${l}</span></div>`).join('')}</div><h4>Field inventory</h4>${table((cfi?.fields||[]).slice(0,1500),[['Field/meta key',x=>`<code>${esc(x.key)}</code>`],['Files',x=>n(x.files?.length)],['Registered',x=>n(x.registeredIn?.length)],['REST',x=>n(x.restFiles?.length)],['ACF-related',x=>yesNo(x.acf)],['Locations',x=>x.files?.length?`<details><summary>${n(x.files.length)} file(s)</summary>${tags(x.files)}</details>`:'—']])}<h4>Usage by file</h4>${table(cf.files?.slice(0,1000),[['File',x=>`<code>${esc(x.path)}</code>`],['Reads',x=>n(x.reads)],['Writes',x=>n(x.writes)],['Registered',x=>n(x.registered)],['REST',x=>n(x.showInRest)],['ACF calls',x=>n(x.acfCalls)],['Repeater',x=>n(x.acfRepeater)]])}`:'<span class="muted">No custom-field model generated.</span>'],
    ['wp-api','REST & AJAX',`<div class="subgrid"><div><h4>REST routes</h4>${tags(ints.restRoutes)}</div><div><h4>AJAX actions</h4>${tags(ints.ajaxActions)}</div><div><h4>Unauthenticated AJAX</h4>${tags(ints.ajaxNoPrivActions)}</div><div><h4>WP-CLI commands</h4>${tags(ints.wpCliCommands)}</div></div>${table(byFile.flatMap(f=>(f.restRouteDetails||[]).map(r=>({...r,file:f.path}))).slice(0,1000),[['Route',x=>`<code>${esc(x.route)}</code>`],['Permission',x=>yesNo(x.permissionCallback)],['Public',x=>yesNo(x.permissionPublic)],['Args schema',x=>yesNo(x.hasArgs)],['Validation',x=>yesNo(x.hasValidateCallback||x.hasSanitizeCallback)],['File',x=>`<code>${esc(x.file)}:${n(x.line)}</code>`]])}`],
    ['wp-data','Data, Cache & Cookies',`${table(dataCounts.map(([name,count])=>({name,count:count||0})),[['Type',x=>esc(x.name)],['Unique entries',x=>n(x.count)]])}<div class="subgrid"><div><h4>Options</h4>${tags(ints.options)}</div><div><h4>Transients</h4>${tags(ints.transients)}</div><div><h4>Cache groups</h4>${tags(ints.cacheGroups)}</div><div><h4>Meta keys</h4>${tags(ints.metaKeys)}</div></div><h4>Cookies</h4>${tags(ints.cookies)}${table(byFile.filter(f=>f.cookies&&((f.cookies.rawCookieReads||0)||(f.cookies.setcookie||[]).length||f.cookies.wpSetAuthCookie||f.cookies.wpClearAuthCookie)).slice(0,1000),[['File',x=>`<code>${esc(x.path)}</code>`],['Read names',x=>esc((x.cookies?.reads||[]).join(', ')||'—')],['Set names',x=>esc((x.cookies?.setcookie||[]).join(', ')||'—')],['$_COOKIE uses',x=>n(x.cookies?.rawCookieReads)],['WP auth cookie API',x=>n((x.cookies?.wpSetAuthCookie||0)+(x.cookies?.wpClearAuthCookie||0))]])}`],
    ['wp-background','Background',`<div class="subgrid"><div><h4>WP-Cron hooks</h4>${tags(ints.cronHooks)}</div><div><h4>Action Scheduler hooks</h4>${tags(ints.actionSchedulerHooks)}</div></div>${table(byFile.filter(f=>Object.values(f.cron||{}).some(Boolean)||Object.values(f.actionScheduler||{}).some(Boolean)).slice(0,1000),[['File',x=>`<code>${esc(x.path)}</code>`],['Cron schedule',x=>n(x.cron?.schedule)],['Cron cleanup',x=>n((x.cron?.clearScheduled||0)+(x.cron?.unschedule||0))],['AS recurring',x=>n(x.actionScheduler?.scheduleRecurring)],['AS cleanup',x=>n(x.actionScheduler?.unschedule)]])}`],
    ['wp-builders','Builders & Blocks',`<div class="subgrid"><div><h4>Builders</h4>${tags(ints.builders)}</div><div><h4>Blocks</h4>${tags(ints.blocks)}</div><div><h4>Post types</h4>${tags(ints.postTypes)}</div><div><h4>Taxonomies</h4>${tags(ints.taxonomies)}</div></div><h4>Block metadata</h4>${table((ints.blockMetadata||[]).slice(0,500),[['Block',x=>`<code>${esc(x.name||'unresolved')}</code>`],['Title',x=>esc(x.title||'—')],['API version',x=>esc(x.apiVersion||'—')],['block.json',x=>`<code>${esc(x.path)}</code>`]])}<h4>Registration calls</h4>${table(byFile.filter(f=>f.blockRegistrationCalls).slice(0,500),[['File',x=>`<code>${esc(x.path)}</code>`],['register_block_type calls',x=>n(x.blockRegistrationCalls)]])}`],
    ['wp-multilingual','Multilingual & i18n',`<div class="subgrid"><div><h4>Text domains</h4>${tags(ints.textDomains)}</div><div><h4>Text-domain review</h4><dl class="kv"><dt>Calls missing a statically detectable domain</dt><dd>${n(ints.missingTextDomains?.length)}</dd><dt>Dynamic domain expressions</dt><dd>${n(ints.dynamicTextDomains?.length)}</dd></dl></div></div><h4>Multilingual API usage by file</h4>${table(byFile.filter(f=>Object.values(f.multilingual||{}).some(Boolean)).slice(0,500),[['File',x=>`<code>${esc(x.path)}</code>`],['Object-ID API',x=>n(x.multilingual?.wpmlObjectId)],['Element-type API',x=>n(x.multilingual?.wpmlElementType)],['Prefixed extension hooks',x=>n(x.multilingual?.polyglotHooks)],['Direct language globals',x=>n(x.multilingual?.languageGlobals)]])}${ints.missingTextDomains?.length?`<h4>Missing-domain calls</h4>${table(ints.missingTextDomains.slice(0,500),[['Function',x=>`<code>${esc(x.function)}</code>`],['File',x=>`<code>${esc(x.file)}:${n(x.line)}</code>`]])}`:''}${ints.dynamicTextDomains?.length?`<h4>Dynamic domains</h4>${table(ints.dynamicTextDomains.slice(0,500),[['Function',x=>`<code>${esc(x.function)}</code>`],['Expression',x=>`<code>${esc(x.expression)}</code>`],['File',x=>`<code>${esc(x.file)}:${n(x.line)}</code>`]])}`:''}`]
  ];
  return `<div class="panel"><h3>WordPress analysis</h3><p class="section-lead muted">Detected as <strong>${esc(wp.type)}</strong>. Use the sub-tabs to inspect integration surfaces without a long report.</p><div class="subtabs" role="tablist">${panes.map(([id,label],i)=>`<button type="button" class="subtab ${i===0?'active':''}" data-subtab="${id}">${esc(label)}</button>`).join('')}</div>${panes.map(([id,,html],i)=>`<div class="subtab-pane" data-subpane="${id}" ${i?'hidden':''}>${html}</div>`).join('')}</div>`;
}

function nodePanel(node) {
  if (!node) return '';
  const p = node.package || {};
  return `<div class="panel"><h3>Node.js analysis</h3>
    <div class="subgrid"><div><h4>Package</h4><dl class="kv">
      <dt>Name</dt><dd>${esc(p.name || '—')}</dd><dt>Version</dt><dd>${esc(p.version || '—')}</dd><dt>Module type</dt><dd>${esc(p.type || '—')}</dd>
      <dt>Main</dt><dd><code>${esc(p.main || '—')}</code></dd><dt>Package manager</dt><dd>${esc(p.packageManager || '—')}</dd>
      <dt>Lockfile</dt><dd>${yesNo(node.indicators?.hasLockfile)}</dd><dt>TypeScript</dt><dd>${yesNo(node.indicators?.typescript)}</dd><dt>Test files</dt><dd>${n(node.indicators?.tests)}</dd>
    </dl></div><div><h4>Frameworks & tooling</h4>${tags(node.frameworks)}</div></div>
    <h4>Package scripts</h4>${table(Object.entries(node.scripts || {}).map(([name,command]) => ({name,command})), [['Script', x => `<code>${esc(x.name)}</code>`], ['Command', x => `<code>${esc(x.command)}</code>`]])}
    <div class="subgrid"><div><h4>External imports</h4>${tags(node.externalImports)}</div><div><h4>Environment variables</h4>${tags(node.environmentVariables)}</div></div>
    <h4>Detected routes</h4>${table(node.routes?.slice(0,500), [['Method', x => esc(x.method)], ['Route', x => `<code>${esc(x.route)}</code>`], ['File', x => `<code>${esc(x.file)}</code>`]])}</div>`;
}


function deepPanel(deep) {
  if (!deep) return '';
  const summary=deep.summary||{}, superglobals=Object.entries(deep.php?.superglobals||{}).map(([name,value])=>({name,...value})), risks=deep.riskSignals||[];
  const panes=[
    ['deep-summary','Summary',`<div class="cards compact">${[['Classes',summary.classes],['Interfaces',summary.interfaces],['Traits',summary.traits],['Enums',summary.enums],['Functions/methods',summary.functions],['Review signals',risks.length]].map(([label,value])=>`<div class="card"><b>${n(value)}</b><span>${label}</span></div>`).join('')}</div>`],
    ['deep-input','Superglobals',`${table(superglobals,[['Superglobal',x=>`<code>${esc(x.name)}</code>`],['Occurrences',x=>n(x.occurrences)],['Reads',x=>n(x.reads)],['Writes',x=>n(x.writes)],['Files',x=>n(x.files?.length)]])}${table(superglobals.flatMap(x=>(x.files||[]).map(f=>({superglobal:x.name,...f}))).slice(0,1500),[['Superglobal',x=>`<code>${esc(x.superglobal)}</code>`],['File',x=>`<code>${esc(x.path)}</code>`],['Occurrences',x=>n(x.occurrences)],['Lines',x=>esc((x.lines||[]).slice(0,40).join(', '))]])}`],
    ['deep-risks','Review Signals',`<p class="muted section-lead">Review hints, not vulnerability findings.</p>${table(risks.slice(0,1000),[['Rule',x=>`<code>${esc(x.rule)}</code>`],['File',x=>`<code>${esc(x.file)}</code>`],['Finding',x=>esc(x.message)]])}`],
    ['deep-php','PHP Structure',`${table((deep.php?.files||[]).slice(0,1500),[['File',x=>`<code>${esc(x.path)}</code>`],['Namespace',x=>`<code>${esc(x.namespace||'—')}</code>`],['Declarations',x=>esc((x.declarations||[]).map(d=>`${d.kind} ${d.name}${d.extends?` extends ${d.extends}`:''}`).join(', ')||'—')],['Functions/methods',x=>n(x.functions?.length)],['Direct SQL',x=>n(x.db?.directSql)]])}`],
    ['deep-js','JS / TS Structure',`${table((deep.javascript?.files||[]).slice(0,1500),[['File',x=>`<code>${esc(x.path)}</code>`],['Classes',x=>esc((x.classes||[]).map(c=>c.name).join(', ')||'—')],['Functions',x=>esc((x.functions||[]).map(f=>f.name).slice(0,30).join(', ')||'—')],['Imports',x=>n(x.imports?.length)],['Exports',x=>n(x.exports?.length)]])}`]
  ];
  return `<div class="panel"><h3>Structural & input analysis</h3><div class="subtabs" role="tablist">${panes.map(([id,label],i)=>`<button type="button" class="subtab ${i===0?'active':''}" data-subtab="${id}">${esc(label)}</button>`).join('')}</div>${panes.map(([id,,html],i)=>`<div class="subtab-pane" data-subpane="${id}" ${i?'hidden':''}>${html}</div>`).join('')}</div>`;
}


function developerGuidePanel(documentation) {
  if (!documentation) return '<div class="panel"><span class="muted">No guide data available.</span></div>';
  const g=documentation.developerGuide||{}, api=g.publicApi||{}, php=api.php||{}, js=api.javascript||{}, wp=api.wordpress, cf=g.customFields;
  const panes=[
    ['dev-summary','Summary',`<div class="cards compact">${[['PHP declarations',php.declarations?.length],['Public PHP functions/methods',php.functions?.length],['PHP constants',php.constants?.length],['JS/TS exports',js.exports?.length],['Exposed WP hooks',(wp?.actionsExposed?.length||0)+(wp?.filtersExposed?.length||0)],['REST routes',wp?.restRoutes?.length]].map(([l,v])=>`<div class="card"><b>${n(v)}</b><span>${l}</span></div>`).join('')}</div><div class="subgrid"><div><h4>Project</h4><dl class="kv"><dt>Name</dt><dd>${esc(g.project?.name||'—')}</dd><dt>Version</dt><dd>${esc(g.project?.version||'—')}</dd><dt>Platforms</dt><dd>${esc((g.project?.platforms||[]).join(', ')||'—')}</dd></dl></div><div><h4>Structure</h4><dl class="kv">${Object.entries(g.architecture?.structure||{}).map(([k,v])=>`<dt>${esc(k)}</dt><dd>${n(v)}</dd>`).join('')}</dl></div></div>`],
    ['dev-php','PHP API',`${table((php.declarations||[]).slice(0,1500),[['Kind',x=>esc(x.kind)],['Name',x=>`<code>${esc(x.namespace?`${x.namespace}\\${x.name}`:x.name)}</code>`],['Extends',x=>`<code>${esc(x.extends||'—')}</code>`],['File',x=>`<code>${esc(x.file)}:${n(x.line)}</code>`]])}<h4>Public/default functions and methods</h4>${table((php.functions||[]).slice(0,2000),[['Name',x=>`<code>${esc(x.name)}</code>`],['Parameters',x=>`<code>${esc(x.parameters||'')}</code>`],['Return',x=>`<code>${esc(x.returnType||'—')}</code>`],['File',x=>`<code>${esc(x.file)}:${n(x.line)}</code>`]])}`],
    ['dev-js','JS / TS API',`${table((js.exports||[]).slice(0,1500),[['Export',x=>`<code>${esc(x.name)}</code>`],['File',x=>`<code>${esc(x.file)}</code>`]])}`],
    ['dev-wp','WordPress API',wp?`<div class="subgrid"><div><h5>Actions exposed</h5>${tags(wp.actionsExposed)}</div><div><h5>Filters exposed</h5>${tags(wp.filtersExposed)}</div><div><h5>REST routes</h5>${tags(wp.restRoutes)}</div><div><h5>WP-CLI commands</h5>${tags(wp.wpCliCommands)}</div><div><h5>Blocks</h5>${tags(wp.blocks)}</div><div><h5>Shortcodes</h5>${tags(wp.shortcodes)}</div></div>`:'<span class="muted">No WordPress API model.</span>'],
    ['dev-fields','Custom Fields',cf?`<div class="cards compact">${[['Keys',cf.summary?.keys],['Files',cf.summary?.files],['ACF files',cf.summary?.acfFiles],['Registered meta',cf.summary?.registeredMeta]].map(([l,v])=>`<div class="card"><b>${n(v)}</b><span>${l}</span></div>`).join('')}</div><h4>Keys</h4>${tags(cf.keys)}${table(cf.files?.slice(0,1000),[['File',x=>`<code>${esc(x.path)}</code>`],['Reads',x=>n(x.reads)],['Writes',x=>n(x.writes)],['Registered',x=>n(x.registered)],['ACF',x=>n(x.acfCalls)],['Repeater',x=>n(x.acfRepeater)]])}`:'<span class="muted">No custom-field model.</span>'],
    ['dev-data','Database & Input',`<h4>Database usage</h4>${table((g.database?.files||[]).slice(0,1000),[['File',x=>`<code>${esc(x.path)}</code>`],['$wpdb methods',x=>esc((x.wpdbMethods||[]).join(', ')||'—')],['Direct SQL',x=>n(x.directSql)],['Tables',x=>esc((x.tables||[]).join(', ')||'—')]])}<h4>Request / global state</h4>${table(Object.entries(g.requestData||{}).map(([name,v])=>({name,...v})),[['Superglobal',x=>`<code>${esc(x.name)}</code>`],['Occurrences',x=>n(x.occurrences)],['Reads',x=>n(x.reads)],['Writes',x=>n(x.writes)],['Files',x=>n(x.files?.length)]])}`]
  ];
  return `<div class="panel"><h3>Developer Guide</h3><p class="section-lead muted">The same deterministic model is used by the exported guide.</p><div class="subtabs" role="tablist">${panes.map(([id,label],i)=>`<button type="button" class="subtab ${i===0?'active':''}" data-subtab="${id}">${esc(label)}</button>`).join('')}</div>${panes.map(([id,,html],i)=>`<div class="subtab-pane" data-subpane="${id}" ${i?'hidden':''}>${html}</div>`).join('')}</div>`;
}


function architecturePanel(r) {
  const a=r.insights?.architecture||{}, d=r.insights?.dataModel||{}, deep=r.deep||{};
  const superglobals=Object.entries(deep.php?.superglobals||{}).map(([name,value])=>({name,...value}));
  const panes=[
    ['arch-modules','Modules',`<div class="cards compact">${[['Modules',a.modules?.length],['Namespaces',a.namespaces?.length],['Dependency edges',a.dependencyEdges?.length],['Declarations',a.declarations?.length]].map(([l,v])=>`<div class="card"><b>${n(v)}</b><span>${l}</span></div>`).join('')}</div>${table((a.modules||[]).slice(0,500),[['Module',x=>`<code>${esc(x.name)}</code>`],['Files',x=>n(x.files)],['PHP',x=>n(x.php)],['JS/TS',x=>n(x.jsTs)],['Classes',x=>n(x.classes)],['Functions',x=>n(x.functions)],['Size',x=>bytes(x.bytes)]])}`],
    ['arch-types','Classes & namespaces',`${table((a.namespaces||[]).slice(0,500),[['Namespace',x=>`<code>${esc(x.name)}</code>`],['Files',x=>n(x.files)]])}<h4>Declarations</h4>${table((a.declarations||[]).slice(0,2000),[['Kind',x=>esc(x.kind)],['Name',x=>`<code>${esc(x.namespace?`${x.namespace}\\${x.name}`:x.name)}</code>`],['Extends',x=>`<code>${esc(x.extends||'—')}</code>`],['Implements',x=>esc((x.implements||[]).join(', ')||'—')],['File',x=>`<code>${esc(x.file)}</code>`]])}`],
    ['arch-deps','Dependencies / coupling',`<h4>Most referenced targets</h4>${table((a.mostReferenced||[]).slice(0,100),[['Target',x=>`<code>${esc(x.name)}</code>`],['References',x=>n(x.references)]])}<h4>Dependency edges</h4>${table((a.dependencyEdges||[]).slice(0,2000),[['From',x=>`<code>${esc(x.from)}</code>`],['Relationship',x=>esc(x.kind)],['To',x=>`<code>${esc(x.to)}</code>`]])}`],
    ['arch-hotspots','Structural hotspots',`${table((a.largeClasses||[]).slice(0,100),[['Class',x=>`<code>${esc(x.name)}</code>`],['File',x=>`<code>${esc(x.file)}</code>`],['Methods/functions in file',x=>n(x.methods)],['Branch signals',x=>n(x.branches)]])}`],
    ['arch-data','Data model',`<h4>Custom tables</h4>${table((d.customTables||[]).slice(0,500),[['File',x=>`<code>${esc(x.path)}</code>`],['CREATE TABLE',x=>n(x.createTable)],['dbDelta',x=>n(x.dbDelta)],['Detected table names',x=>esc((x.tables||[]).join(', ')||'—')]])}<p class="muted">Custom-field details have one canonical home under WordPress → Custom Fields.</p>`],
    ['arch-input','Global/request state',`${table(superglobals,[['Superglobal',x=>`<code>${esc(x.name)}</code>`],['Occurrences',x=>n(x.occurrences)],['Reads',x=>n(x.reads)],['Writes',x=>n(x.writes)],['Files',x=>n(x.files?.length)]])}`]
  ];
  return `<div class="panel"><h3>Architecture & data model</h3><p class="section-lead muted">Canonical structural inventory: modules, declarations, coupling, custom tables, and global/request state.</p><div class="subtabs" role="tablist">${panes.map(([id,label],i)=>`<button type="button" class="subtab ${i===0?'active':''}" data-subtab="${id}">${esc(label)}</button>`).join('')}</div>${panes.map(([id,,html],i)=>`<div class="subtab-pane" data-subpane="${id}" ${i?'hidden':''}>${html}</div>`).join('')}</div>`;
}

function testsDocsPanel(r){
  const t=r.insights?.tests||{}, d=r.insights?.documentationHealth||{};
  const panes=[
    ['td-tests','Tests & tooling',`<div class="cards compact">${[['Test files',t.summary?.testFiles],['Production source files',t.summary?.productionSourceFiles],['Detected tools',t.tools?.length],['Test/source ratio',t.summary?.ratio?`${(t.summary.ratio*100).toFixed(1)}%`:'0%']].map(([l,v])=>`<div class="card"><b>${typeof v==='number'?n(v):esc(v)}</b><span>${l}</span></div>`).join('')}</div><h4>Tools</h4>${tags(t.tools)}<h4>Test/quality scripts</h4>${tags(t.scripts)}<h4>Detected test files</h4>${tags((t.files||[]).slice(0,500))}`],
    ['td-docs','Documentation health',`<div class="subgrid"><div><h4>Repository documentation</h4><dl class="kv"><dt>README</dt><dd>${yesNo(d.hasReadme)}</dd><dt>CHANGELOG</dt><dd>${yesNo(d.hasChangelog)}</dd><dt>AGENTS.md</dt><dd>${yesNo(d.hasAgents)}</dd><dt>ROADMAP.md</dt><dd>${yesNo(d.hasRoadmap)}</dd><dt>CONTRIBUTING</dt><dd>${yesNo(d.hasContributing)}</dd><dt>docs/</dt><dd>${yesNo(d.docsDirectory)}</dd><dt>Public API surface proxy</dt><dd>${n(d.publicApiSurface)}</dd></dl></div><div><h4>Detected documentation files</h4>${tags((d.files||[]).slice(0,500))}</div></div><h4>Notes</h4><ul>${(d.notes||[]).map(x=>`<li>${esc(x)}</li>`).join('')}</ul>`]
  ];
  return `<div class="panel"><h3>Tests & documentation health</h3><div class="subtabs" role="tablist">${panes.map(([id,label],i)=>`<button type="button" class="subtab ${i===0?'active':''}" data-subtab="${id}">${esc(label)}</button>`).join('')}</div>${panes.map(([id,,html],i)=>`<div class="subtab-pane" data-subpane="${id}" ${i?'hidden':''}>${html}</div>`).join('')}</div>`;
}

function compatibilityPanel(documentation) {
  const compat=documentation?.compatibility||{}; const wp=compat.wordpress, node=compat.node;
  const all=[...(wp?.findings||[]),...(node?.findings||[])].filter(f=>!(['WPML','Polyglot profile'].includes(f.category)&&['detected','info','positive'].includes(f.status)));
  if(!all.length)return '<div class="panel"><h3>Compatibility Guide</h3><span class="muted">No compatibility findings generated.</span></div>';
  const groups={}; for(const f of all)(groups[f.area]||=[]).push(f);
  const areas=Object.keys(groups);
  const areaTabs=areas.map((area,i)=>`<button type="button" class="subtab ${i===0?'active':''}" data-subtab="compat-${i}">${esc(area)} <span class="badge">${groups[area].length}</span></button>`).join('');
  const panes=areas.map((area,i)=>`<div class="subtab-pane" data-subpane="compat-${i}" ${i?'hidden':''}><h4>${esc(area)}</h4>${table(groups[area],[
    ['Status',x=>`<span class="finding-${esc(x.status)}">${esc(x.status)}</span>`],['Rule',x=>`<code>${esc(x.rule)}</code>`],['Finding',x=>esc(x.message)],['Evidence',x=>x.evidence?.length?`<details><summary>${n(x.evidence.length)} item(s)</summary>${tags(x.evidence.slice(0,100))}</details>`:'<span class="muted">—</span>']
  ])}</div>`).join('');
  return `<div class="panel"><h3>Compatibility Guide</h3><p class="section-lead muted">Rule catalog ${esc(wp?.catalogVersion||'—')}. Deterministic review indicators, not certification.</p>
    <div class="cards compact">${[['Findings',all.length],['Review items',all.filter(x=>x.status==='review').length],['Positive indicators',all.filter(x=>x.status==='positive').length],['Categories',areas.length]].map(([l,v])=>`<div class="card"><b>${n(v)}</b><span>${l}</span></div>`).join('')}</div>
    <div class="subtabs" role="tablist">${areaTabs}</div>${panes}
  </div>`;
}
function qualityPanel(documentation){
  const q=documentation?.quality;if(!q)return '<div class="panel"><span class="muted">No quality model generated.</span></div>';
  const render=(rows,type)=>table(rows?.slice(0,1000),[['Severity',x=>`<span class="quality-${esc(x.severity)}">${esc(x.severity)}</span>`],['Rule',x=>`<code>${esc(x.rule)}</code>`],['Finding',x=>esc(x.message)],['Evidence',x=>x.evidence?.length?`<details><summary>${n(x.evidence.length)} item(s)</summary>${tags(x.evidence)}</details>`:'—']]);
  return `<div class="panel"><h3>Security & Performance</h3><div class="cards compact"><div class="card"><b>${n(q.summary?.securityReview)}</b><span>Security review items</span></div><div class="card"><b>${n(q.summary?.performanceReview)}</b><span>Performance review items</span></div></div><div class="subtabs" role="tablist"><button class="subtab active" data-subtab="quality-security">Security</button><button class="subtab" data-subtab="quality-performance">Performance</button></div><div class="subtab-pane" data-subpane="quality-security">${render(q.security,'security')}</div><div class="subtab-pane" data-subpane="quality-performance" hidden>${render(q.performance,'performance')}</div></div>`;
}
function recommendationsPanel(documentation){
  const r=documentation?.recommendations;if(!r)return '<div class="panel"><span class="muted">No recommendations generated.</span></div>';
  const rows=r.items||[];
  return `<div class="panel"><h3>Recommendations</h3><p class="section-lead muted">Deterministic suggestions. Confirm evidence before applying changes.</p><div class="cards compact">${[['High priority',rows.filter(x=>x.priority==='high').length],['Medium',rows.filter(x=>x.priority==='medium').length],['Normal',rows.filter(x=>x.priority==='normal').length],['Total',rows.length]].map(([l,v])=>`<div class="card"><b>${n(v)}</b><span>${l}</span></div>`).join('')}</div><div class="subtabs" role="tablist"><button class="subtab active" data-subtab="rec-items">Actions</button><button class="subtab" data-subtab="rec-prompt">AI Agent Prompt</button><button class="subtab" data-subtab="rec-docs">Documentation policy</button></div><div class="subtab-pane" data-subpane="rec-items">${table(rows.slice(0,500),[['Priority',x=>`<span class="priority-${esc(x.priority)}">${esc(x.priority)}</span>`],['Rule',x=>`<code>${esc(x.rule)}</code>`],['Recommendation',x=>esc(x.rationale)],['Actions',x=>`<ul>${(x.suggestedActions||[]).map(a=>`<li>${esc(a)}</li>`).join('')}</ul>`],['Evidence',x=>x.evidence?.length?`<details><summary>${n(x.evidence.length)} item(s)</summary>${tags(x.evidence)}</details>`:'—']])}</div><div class="subtab-pane" data-subpane="rec-prompt" hidden><div class="prompt-toolbar"><button type="button" class="copy-agent-prompt">Copy prompt</button></div><pre class="prompt-box">${esc(r.prompt||'')}</pre></div><div class="subtab-pane" data-subpane="rec-docs" hidden><h4>Recommended repository documentation</h4>${tags(r.documentationPolicy?.preferred)}<ul>${(r.documentationPolicy?.rules||[]).map(x=>`<li>${esc(x)}</li>`).join('')}</ul></div></div>`;
}

function report(r, title = 'Analysis') {
  const langs=Object.entries(r.languages).sort((a,b)=>b[1].lines-a[1].lines).map(([name,value])=>({name,...value}));
  const types=Object.entries(r.fileTypes).sort((a,b)=>b[1]-a[1]).map(([ext,count])=>({ext,count}));
  const overview=`${cards(r)}<p class="report-note">The file count is calculated from extracted ZIP contents. The ZIP itself is not counted.</p>
    <div class="panel"><h3>Detected platforms</h3>${tags(r.platforms?.detected)}</div>
    <div class="panel"><h3>Languages</h3>${table(langs,[['Language',x=>esc(x.name)],['Files',x=>n(x.files)],['Lines',x=>n(x.lines)],['Code',x=>n(x.code)],['Comments',x=>n(x.comment)],['Bytes',x=>bytes(x.bytes)]])}</div>
    <div class="panel"><h3>File types</h3>${table(types.slice(0,100),[['Extension',x=>`<code>${esc(x.ext)}</code>`],['Files',x=>n(x.count)]])}</div>
    <div class="panel"><h3>Largest files</h3>${table(r.largestFiles,[['Path',x=>`<code>${esc(x.path)}</code>`],['Size',x=>bytes(x.size)]])}</div>`;
  const deps=`<div class="panel"><h3>Third-party dependencies</h3>${table(r.dependencies,[['Ecosystem',x=>esc(x.ecosystem)],['Package',x=>`<code>${esc(x.name)}</code>`],['Version',x=>`<code>${esc(x.version)}</code>`],['Kind',x=>esc(x.kind)]])}</div>
    <div class="panel"><h3>OOP symbols (heuristic)</h3><p class="muted section-lead">Legacy regex inventory retained for cross-checking; Structural tab contains the deeper parser-lite inventory.</p>${table(r.oop.symbols.slice(0,500),[['File',x=>`<code>${esc(x.path)}</code>`],['Language',x=>esc(x.language)],['Classes',x=>esc(x.classes.join(', ')||'—')],['Methods',x=>esc(x.methods.slice(0,30).join(', ')||'—')]])}</div>`;
  const panes=[['overview','Overview',overview]];
  if(r.platforms?.wordpress)panes.push(['wordpress','WordPress',wordpressPanel(r.platforms.wordpress,r.documentation,r.insights)]);
  if(r.platforms?.node)panes.push(['node','Node.js',nodePanel(r.platforms.node)]);
  panes.push(['architecture','Architecture',architecturePanel(r)],['quality','Security & Performance',qualityPanel(r.documentation)],['compatibility','Compatibility',compatibilityPanel(r.documentation)],['recommendations','Recommendations',recommendationsPanel(r.documentation)],['tests-docs','Tests & Docs',testsDocsPanel(r)],['dependencies','Dependencies',deps]);
  return `<h2>${title}</h2><div class="result-tabs" role="tablist">${panes.map(([id,label],i)=>`<button type="button" class="result-tab ${i===0?'active':''}" data-result-tab="${id}">${esc(label)}</button>`).join('')}</div>
    ${panes.map(([id,,html],i)=>`<section class="result-pane" data-result-pane="${id}" ${i?'hidden':''}>${html}</section>`).join('')}`;
}

function activateResultTabs() {
  for(const button of results.querySelectorAll('.result-tab')) button.addEventListener('click',()=>{
    const id=button.dataset.resultTab;
    results.querySelectorAll('.result-tab').forEach(b=>b.classList.toggle('active',b===button));
    results.querySelectorAll('.result-pane').forEach(p=>p.hidden=p.dataset.resultPane!==id);
  });
  for(const copy of results.querySelectorAll('.copy-agent-prompt')) copy.addEventListener('click',async()=>{try{await navigator.clipboard.writeText(exportState?.payload?.documentation?.recommendations?.prompt||'');copy.textContent='Copied';setTimeout(()=>copy.textContent='Copy prompt',1200);}catch{}});
  for(const button of results.querySelectorAll('.subtab')) button.addEventListener('click',()=>{
    const root=button.closest('.panel'); const id=button.dataset.subtab;
    root.querySelectorAll('.subtab').forEach(b=>b.classList.toggle('active',b===button));
    root.querySelectorAll('.subtab-pane').forEach(p=>p.hidden=p.dataset.subpane!==id);
  });
}
function isZip(file) { return file && file.name.toLowerCase().endsWith('.zip'); }
function showSelection(id,file) {
  const selection=$(`#${id}Selection`);
  if(!file){ selection.hidden=true; selection.innerHTML=''; return; }
  selection.hidden=false;
  selection.innerHTML=`<span class="selected-label">Selected archive</span><strong>${esc(file.name)}</strong><span>${bytes(file.size)} ZIP upload</span>`;
}
function setSelectedFile(id,file,{autoRun=true}={}) {
  if(!isZip(file)){ status.textContent='Only ZIP archives are supported.'; return; }
  selectedFiles[id]=file; showSelection(id,file); exportState=null; exportBar.hidden=true;
  $('#analyzeBtn').disabled=!selectedFiles.single; $('#compareBtn').disabled=!(selectedFiles.before&&selectedFiles.after);
  if(!autoRun)return;
  if(id==='single') analyzeSelected();
  if((id==='before'||id==='after')&&selectedFiles.before&&selectedFiles.after) compareSelected();
  else if(id==='before'||id==='after') status.textContent=`${file.name} ready. Add the other ZIP to start comparison.`;
}
function wireDropZone(dropId,inputId) {
  const drop=$(`#${dropId}`), input=$(`#${inputId}`);
  input.addEventListener('change',()=>{const file=input.files?.[0];if(file)setSelectedFile(inputId,file);});
  drop.addEventListener('click',(e)=>{if(!e.target.closest('.upload-btn'))input.click();});
  drop.addEventListener('keydown',(e)=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();input.click();}});
  for(const name of ['dragenter','dragover']) drop.addEventListener(name,(e)=>{e.preventDefault();e.stopPropagation();drop.classList.add('drag-over');});
  for(const name of ['dragleave','drop']) drop.addEventListener(name,(e)=>{e.preventDefault();e.stopPropagation();drop.classList.remove('drag-over');});
  drop.addEventListener('drop',(e)=>{const file=e.dataTransfer?.files?.[0];if(file)setSelectedFile(inputId,file);});
}
for(const button of document.querySelectorAll('.upload-btn')) button.addEventListener('click',(e)=>{e.stopPropagation();$(`#${button.dataset.target}`).click();});
wireDropZone('singleDrop','single'); wireDropZone('beforeDrop','before'); wireDropZone('afterDrop','after');

function setExportState(mode,payload,names) { exportState={mode,payload,names}; exportBar.hidden=false; const single=mode==='analysis'; $('#exportDeveloperGuide').hidden=!single; $('#exportCompatibilityGuide').hidden=!single; $('#exportRecommendations').hidden=!single; $('#exportAgentPrompt').hidden=!single; }

async function analyzeSelected() {
  if(!backendReady){status.textContent=`Backend ${APP_VERSION} is not ready. Restart this release.`;return;}
  const file=selectedFiles.single; if(!file){status.textContent='Choose or drop a ZIP first.';return;}
  const fd=new FormData(); fd.append('archive',file); status.textContent=''; results.innerHTML=''; exportBar.hidden=true; $('#analyzeBtn').disabled=true;
  startRunStatus(`Analyzing ${file.name}`,estimateRange(file.size),['Uploading archive','Extracting ZIP','Inventorying files','Analyzing PHP/JS structure','WordPress / Node checks','Security & performance rules','Building report']);
  try { const response=await fetch('/api/analyze',{method:'POST',body:fd}); const data=await response.json(); if(!response.ok||data.error)throw Object.assign(new Error(data.error||'Analysis failed.'),{run:data.run});
    results.innerHTML=report(data); activateResultTabs(); setExportState('analysis',data,[file.name]); status.textContent=`Analysis complete: ${n(data.totals.files)} files found inside ${file.name}.`;
    finishRunStatus({ok:true,title:'Analysis complete',run:data.run,details:[`${n(data.totals.files)} files analyzed`,`${n(data.totals.lines)} source lines counted`,`${data.run?.warnings?.length||0} warnings`]});
  } catch(error){status.textContent=error.message;finishRunStatus({ok:false,title:'Analysis failed',run:error.run,details:[error.message]});} finally{$('#analyzeBtn').disabled=!selectedFiles.single;}
}

async function compareSelected() {
  if(!backendReady){status.textContent=`Backend ${APP_VERSION} is not ready. Restart this release.`;return;}
  const before=selectedFiles.before, after=selectedFiles.after; if(!before||!after){status.textContent='Choose both ZIP archives.';return;}
  const type=comparisonType(); const fd=new FormData();fd.append('before',before);fd.append('after',after);fd.append('comparisonType',type);status.textContent='';results.innerHTML='';exportBar.hidden=true;$('#compareBtn').disabled=true;
  startRunStatus(type==='codebases'?`Comparing ${before.name} with ${after.name}`:`Comparing versions ${before.name} → ${after.name}`,estimateRange(before.size+after.size,1.7),['Uploading archives','Extracting first ZIP','Analyzing first codebase','Extracting second ZIP','Analyzing second codebase',type==='codebases'?'Calculating overlap':'Calculating file changes and diffs','Building comparison report']);
  try { const response=await fetch('/api/compare',{method:'POST',body:fd}); const data=await response.json(); if(!response.ok||data.error)throw Object.assign(new Error(data.error||'Comparison failed.'),{run:data.run}); const c=data.comparison;
    if(c.kind==='codebases'){
      results.innerHTML=`<h2>Codebase comparison</h2><p class="report-note">This comparison treats the archives as independent projects. Shared paths indicate structural overlap; files are not described as added/removed versions.</p><div class="comparison-source"><span>Codebase A: <strong>${n(data.before.totals.files)} files</strong></span><span>Codebase B: <strong>${n(data.after.totals.files)} files</strong></span></div>
      <div class="cards">${[['Shared paths',c.summary.commonPaths,'good'],['Identical shared files',c.summary.identicalCommonFiles,'good'],['Only in A',c.summary.leftOnly,''],['Only in B',c.summary.rightOnly,''],['Path overlap',`${c.summary.pathOverlapPercent}%`,'warn'],['Dependency overlap',`${c.summary.dependencyOverlapPercent}%`,'warn']].map(([l,v,k])=>`<div class="card"><b class="${k}">${typeof v==='number'?n(v):esc(v)}</b><span>${l}</span></div>`).join('')}</div>
      <div class="panel"><h3>Platforms</h3><div class="subgrid"><div><h4>Codebase A</h4>${tags(c.platforms.left)}</div><div><h4>Codebase B</h4>${tags(c.platforms.right)}</div><div><h4>Shared</h4>${tags(c.platforms.shared)}</div></div></div>
      <div class="panel"><h3>Languages side by side</h3>${table(c.languages,[['Language',x=>esc(x.name)],['A files',x=>n(x.left?.files)],['A lines',x=>n(x.left?.lines)],['B files',x=>n(x.right?.files)],['B lines',x=>n(x.right?.lines)]])}</div>
      <div class="panel"><h3>Size & structure difference (B − A)</h3>${table(Object.entries({...c.delta,...Object.fromEntries(Object.entries(c.structuralDelta||{}).map(([k,v])=>[`structure.${k}`,v]))}).map(([key,value])=>({key,value})),[['Metric',x=>esc(x.key)],['Difference',x=>`${x.value>=0?'+':''}${n(x.value)}`]])}</div>
      <div class="panel"><h3>Dependency comparison</h3>${table([...c.dependencies.added.map(x=>({type:'Only in B',name:x.name,version:x.version})),...c.dependencies.removed.map(x=>({type:'Only in A',name:x.name,version:x.version})),...c.dependencies.changed.map(x=>({type:'Different version',name:x.name,version:`${x.from} → ${x.to}`}))],[['Relationship',x=>esc(x.type)],['Package',x=>`<code>${esc(x.name)}</code>`],['Version',x=>`<code>${esc(x.version)}</code>`]])}</div>
      <div class="panel"><h3>Path overlap</h3><div class="subgrid"><div><h4>Only in A</h4>${tags(c.leftOnly.slice(0,500))}</div><div><h4>Only in B</h4>${tags(c.rightOnly.slice(0,500))}</div><div><h4>Shared paths</h4>${tags(c.commonPaths.slice(0,500))}</div></div></div>`;
    } else {
      results.innerHTML=`<h2>Version comparison</h2><div class="comparison-source"><span>Earlier: <strong>${n(data.before.totals.files)} files</strong></span><span>Newer: <strong>${n(data.after.totals.files)} files</strong></span></div>
      <div class="cards">${[['Added',c.summary.added,'good'],['Removed',c.summary.removed,'bad'],['Modified',c.summary.modified,'warn'],['Unchanged',c.summary.unchanged,'']].map(([l,v,k])=>`<div class="card"><b class="${k}">${n(v)}</b><span>${l}</span></div>`).join('')}</div>
      <div class="panel"><h3>Metric delta (new − old)</h3>${table(Object.entries(c.delta).map(([key,value])=>({key,value})),[['Metric',x=>esc(x.key)],['Delta',x=>`${x.value>=0?'+':''}${n(x.value)}`]])}</div>
      <div class="panel"><h3>Detected platforms</h3><div class="subgrid"><div><h4>Earlier</h4>${tags(data.before.platforms?.detected)}</div><div><h4>Newer</h4>${tags(data.after.platforms?.detected)}</div></div></div>
      <div class="panel"><h3>Structural delta</h3>${table(Object.entries(c.structuralDelta || {}).map(([key,value])=>({key,value})),[['Metric',x=>esc(x.key)],['Delta',x=>`${x.value>=0?'+':''}${n(x.value)}`]])}<h4>Superglobal usage delta</h4>${table(Object.entries(c.superglobalDelta || {}).map(([key,value])=>({key,value})),[['Superglobal',x=>`<code>${esc(x.key)}</code>`],['Occurrence delta',x=>`${x.value>=0?'+':''}${n(x.value)}`]])}</div>
      <div class="panel"><h3>Changed files</h3>${table([...c.added.map(path=>({type:'Added',path})),...c.removed.map(path=>({type:'Removed',path})),...c.modified.map(path=>({type:'Modified',path}))].slice(0,2000),[['Change',x=>esc(x.type)],['Path',x=>`<code>${esc(x.path)}</code>`]])}</div>
      <div class="panel"><h3>Dependency changes</h3>${table([...c.dependencies.added.map(x=>({type:'Added',name:x.name,version:x.version})),...c.dependencies.removed.map(x=>({type:'Removed',name:x.name,version:x.version})),...c.dependencies.changed.map(x=>({type:'Changed',name:x.name,version:`${x.from} → ${x.to}`}))],[['Change',x=>esc(x.type)],['Package',x=>`<code>${esc(x.name)}</code>`],['Version',x=>`<code>${esc(x.version)}</code>`]])}</div>
      <div class="panel"><h3>Inline diffs</h3>${c.diffs.slice(0,100).map(d=>`<details><summary><code>${esc(d.path)}</code>${d.omitted?' — diff omitted':` — +${d.added} / -${d.removed}`}</summary>${d.omitted?`<p class="muted">${esc(d.reason)}</p>`:(d.hunks||[]).map(h=>`<div class="diff-row ${h.type==='add'?'diff-add':'diff-rem'}">${h.type==='add'?'+':'-'} ${esc(h.text)}</div>`).join('')}</details>`).join('')}</div>`;
    }
    setExportState('comparison',data,[before.name,after.name]); status.textContent=c.kind==='codebases'?`Codebase comparison complete.`:`Version comparison complete.`;
    finishRunStatus({ok:true,title:c.kind==='codebases'?'Codebase comparison complete':'Version comparison complete',run:data.run,details:[`${n(data.before.totals.files)} files in A`,`${n(data.after.totals.files)} files in B`,`${data.run?.warnings?.length||0} warnings`]});
  } catch(error){status.textContent=error.message;finishRunStatus({ok:false,title:'Comparison failed',run:error.run,details:[error.message]});} finally{$('#compareBtn').disabled=!(selectedFiles.before&&selectedFiles.after);}
}

function safeBase(name){return String(name||'codebase').replace(/\.zip$/i,'').replace(/[^a-z0-9._-]+/gi,'-').replace(/^-+|-+$/g,'')||'codebase';}
function download(name,content,type){const blob=new Blob([content],{type});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);}
function exportEnvelope(){ if(!exportState)return null; return {exportFormat:'codebase-inspector-report',exportVersion:'1',mode:exportState.mode,sources:exportState.names,report:exportState.payload}; }
function markdownReport(){
  const state=exportState;if(!state)return '';
  if(state.mode==='comparison'){
    const {before,after,comparison:c}=state.payload;
    if(c.kind==='codebases') return `# Codebase comparison

- Codebase A: ${state.names[0]} (${before.totals.files} files, ${before.totals.lines} lines)
- Codebase B: ${state.names[1]} (${after.totals.files} files, ${after.totals.lines} lines)
- Shared paths: ${c.summary.commonPaths}
- Identical shared files: ${c.summary.identicalCommonFiles}
- Only in A: ${c.summary.leftOnly}
- Only in B: ${c.summary.rightOnly}
- Path overlap: ${c.summary.pathOverlapPercent}%
- Dependency overlap: ${c.summary.dependencyOverlapPercent}%

## Metric difference (B - A)
${Object.entries(c.delta).map(([k,v])=>`- ${k}: ${v>=0?'+':''}${v}`).join('\n')}
`;
    return `# Version comparison

- Earlier: ${state.names[0]} (${before.totals.files} files, ${before.totals.lines} lines)
- Newer: ${state.names[1]} (${after.totals.files} files, ${after.totals.lines} lines)
- Added: ${c.summary.added}
- Removed: ${c.summary.removed}
- Modified: ${c.summary.modified}
- Unchanged: ${c.summary.unchanged}

## Metric delta
${Object.entries(c.delta).map(([k,v])=>`- ${k}: ${v>=0?'+':''}${v}`).join('\n')}
`;
  }
  const r=state.payload, wp=r.platforms?.wordpress, node=r.platforms?.node;
  return `# Codebase analysis: ${state.names[0]}\n\n## Summary\n- Files: ${r.totals.files}\n- Folders: ${r.totals.folders}\n- Bytes: ${r.totals.bytes}\n- Lines: ${r.totals.lines}\n- Code lines: ${r.totals.codeLines}\n- Classes: ${r.oop.classes}\n- Methods: ${r.oop.methods}\n- Dependencies: ${r.dependencies.length}\n- Platforms: ${r.platforms?.detected?.join(', ')||'None detected'}\n\n## Languages\n${Object.entries(r.languages).map(([k,v])=>`- ${k}: ${v.files} files, ${v.lines} lines`).join('\n')}\n\n${wp?`## WordPress\n- Type: ${wp.type}\n- Name: ${wp.plugin?.name||wp.theme?.name||'Unknown'}\n- Actions registered: ${wp.integrations.actionsRegistered.length}\n- Filters registered: ${wp.integrations.filtersRegistered.length}\n- REST routes: ${wp.integrations.restRoutes.length}\n- Post types: ${wp.integrations.postTypes.length}\n- Taxonomies: ${wp.integrations.taxonomies.length}\n- Shortcodes: ${wp.integrations.shortcodes.length}\n- Blocks: ${wp.integrations.blocks.length}\n\n`:''}${node?`## Node.js\n- Package: ${node.package.name||'Unknown'}\n- Version: ${node.package.version||'—'}\n- Frameworks/tooling: ${node.frameworks.join(', ')||'None detected'}\n- Scripts: ${Object.keys(node.scripts).length}\n- External imports: ${node.externalImports.length}\n- Environment variables: ${node.environmentVariables.length}\n- Routes: ${node.routes.length}\n\n`:''}## Dependencies\n${r.dependencies.map(x=>`- ${x.ecosystem}: ${x.name} ${x.version} (${x.kind})`).join('\n')||'None'}\n`;
}

function mdList(items, formatter = (x) => String(x)) { return items?.length ? items.map((x) => `- ${formatter(x)}`).join('\n') : '- None detected'; }
function developerGuideMarkdown(report) {
  if (report.documentation?.guides?.developerMarkdown) return report.documentation.guides.developerMarkdown;
  const g=report.documentation?.developerGuide;if(!g)return '# Developer Guide\n\nNo guide data available.';
  const p=g.project||{}, a=g.architecture||{}, api=g.publicApi||{}, wp=g.wordpress, node=g.node;
  const php=api.php||{}, js=api.javascript||{}, wpa=api.wordpress;
  const parts=[];
  parts.push(`# ${p.name || report.rootName} Developer Guide`);
  parts.push('> Generated by Codebase Inspector using deterministic static analysis. Review dynamic/runtime behavior manually.');
  parts.push(`## Project overview\n- Version: ${p.version || 'Unknown'}\n- Platforms: ${(p.platforms || []).join(', ') || 'None detected'}\n- Files: ${a.totals?.files || 0}\n- Folders: ${a.totals?.folders || 0}\n- Lines: ${a.totals?.lines || 0}\n- Code lines: ${a.totals?.codeLines || 0}\n- Classes: ${a.structure?.classes || 0}\n- Interfaces: ${a.structure?.interfaces || 0}\n- Traits: ${a.structure?.traits || 0}\n- Enums: ${a.structure?.enums || 0}\n- Functions/methods: ${a.structure?.functions || 0}`);
  parts.push(`## Languages\n${mdList(Object.entries(a.languages || {}), ([name,v]) => `${name}: ${v.files} files, ${v.lines} lines`)}`);
  parts.push(`## Dependencies\n${mdList(g.dependencies || [], x => `${x.ecosystem}: ${x.name} ${x.version} (${x.kind})`)}`);
  parts.push(`## Public PHP API\n### Declarations\n${mdList(php.declarations || [], x => `${x.kind} ${x.namespace ? x.namespace+'\\' : ''}${x.name} — ${x.file}:${x.line}`)}\n\n### Public/default functions and methods\n${mdList(php.functions || [], x => `${x.name}(${x.parameters || ''})${x.returnType ? ': '+x.returnType : ''} — ${x.file}:${x.line}`)}`);
  parts.push(`## JavaScript / TypeScript exports\n${mdList(js.exports || [], x => `${x.name} — ${x.file}`)}`);
  if(wpa) parts.push(`## WordPress extension API\n### Actions exposed\n${mdList(wpa.actionsExposed)}\n\n### Filters exposed\n${mdList(wpa.filtersExposed)}\n\n### REST routes\n${mdList(wpa.restRoutes)}\n\n### WP-CLI commands\n${mdList(wpa.wpCliCommands)}\n\n### Shortcodes\n${mdList(wpa.shortcodes)}\n\n### Blocks\n${mdList(wpa.blocks)}`);
  if(wp) parts.push(`## WordPress integration inventory\n- Type: ${wp.metadata?.type || 'Unknown'}\n- Actions registered: ${wp.integrations?.actionsRegistered?.length || 0}\n- Filters registered: ${wp.integrations?.filtersRegistered?.length || 0}\n- REST routes: ${wp.integrations?.restRoutes?.length || 0}\n- Post types: ${wp.integrations?.postTypes?.length || 0}\n- Taxonomies: ${wp.integrations?.taxonomies?.length || 0}\n- AJAX actions: ${wp.integrations?.ajaxActions?.length || 0}\n- Options: ${wp.integrations?.options?.length || 0}\n- Meta keys: ${wp.integrations?.metaKeys?.length || 0}`);
  if(node) parts.push(`## Node.js application\n- Package: ${node.package?.name || 'Unknown'}\n- Version: ${node.package?.version || 'Unknown'}\n- Frameworks/tooling: ${(node.frameworks || []).join(', ') || 'None detected'}\n- Scripts: ${Object.keys(node.scripts || {}).length}\n- External imports: ${(node.externalImports || []).length}\n- Environment variables: ${(node.environmentVariables || []).length}\n- Routes: ${(node.routes || []).length}\n\n### Scripts\n${mdList(Object.entries(node.scripts || {}), ([name,cmd]) => `${name}: ${cmd}`)}\n\n### Environment variable names\n${mdList(node.environmentVariables || [])}`);
  parts.push(`## Database usage\n${mdList(g.database?.files || [], x => `${x.path}: methods ${(x.wpdbMethods || []).join(', ') || 'none'}, direct SQL indicators ${x.directSql || 0}`)}`);
  parts.push(`## Request / global state\n${mdList(Object.entries(g.requestData || {}), ([name,v]) => `${name}: ${v.occurrences} occurrence(s) across ${v.files?.length || 0} file(s)`)}`);
  parts.push(`## Analysis limitations\n${mdList(g.limitations || [])}`);
  return parts.join('\n\n')+'\n';
}
function compatibilityGuideMarkdown(report) {
  if (report.documentation?.guides?.compatibilityMarkdown) return report.documentation.guides.compatibilityMarkdown;
  const d=report.documentation?.compatibility || {}; const sets=[['WordPress',d.wordpress],['Node.js',d.node]].filter(([,v])=>v);
  if(!sets.length)return '# Compatibility Guide\n\nNo WordPress or Node.js compatibility model was generated.';
  const parts=['# Compatibility Guide','> Deterministic review indicators only. This is not a compatibility certification or security audit.'];
  for(const [name,set] of sets){
    parts.push(`## ${name}\n- Findings: ${set.summary?.findings || 0}\n- Review items: ${set.summary?.reviewItems || 0}`);
    for(const f of set.findings || []) parts.push(`### ${f.rule} — ${f.area} [${f.status}]\n${f.message}${f.evidence?.length ? `\n\nEvidence:\n${mdList(f.evidence)}` : ''}`);
  }
  return parts.join('\n\n')+'\n';
}

function csvReport(){
  const q=v=>`"${String(v??'').replace(/"/g,'""')}"`;
  if(exportState.mode==='comparison'){
    const c=exportState.payload.comparison; if(c.kind==='codebases'){const rows=[['relationship','path'],...(c.leftOnly||[]).map(p=>['only_in_A',p]),...(c.rightOnly||[]).map(p=>['only_in_B',p]),...(c.commonPaths||[]).map(p=>['shared_path',p])];return rows.map(r=>r.map(q).join(',')).join('\n');} const rows=[['change','path'],...c.added.map(p=>['added',p]),...c.removed.map(p=>['removed',p]),...c.modified.map(p=>['modified',p]),...c.unchanged.map(p=>['unchanged',p])]; return rows.map(r=>r.map(q).join(',')).join('\n');
  }
  const rows=[['path','size_bytes','extension','binary','lines','code_lines','comment_lines','blank_lines'],...exportState.payload.files.map(f=>[f.path,f.size,f.ext,f.binary,f.lines?.lines??'',f.lines?.code??'',f.lines?.comment??'',f.lines?.blank??''])];return rows.map(r=>r.map(q).join(',')).join('\n');
}
$('#exportJson').onclick=()=>{const e=exportEnvelope();if(!e)return;download(`${safeBase(exportState.names.join('-vs-'))}-report.json`,JSON.stringify(e,null,2),'application/json');};
$('#exportMarkdown').onclick=()=>{if(!exportState)return;download(`${safeBase(exportState.names.join('-vs-'))}-report.md`,markdownReport(),'text/markdown');};
$('#exportCsv').onclick=()=>{if(!exportState)return;download(`${safeBase(exportState.names.join('-vs-'))}-${exportState.mode==='comparison'?'changes':'files'}.csv`,csvReport(),'text/csv');};


$('#exportDeveloperGuide').onclick=()=>{if(!exportState||exportState.mode!=='analysis')return;download(`${safeBase(exportState.names[0])}-developer-guide.md`,developerGuideMarkdown(exportState.payload),'text/markdown');};
$('#exportCompatibilityGuide').onclick=()=>{if(!exportState||exportState.mode!=='analysis')return;download(`${safeBase(exportState.names[0])}-compatibility-guide.md`,compatibilityGuideMarkdown(exportState.payload),'text/markdown');};
$('#exportRecommendations').onclick=()=>{if(!exportState||exportState.mode!=='analysis')return;download(`${safeBase(exportState.names[0])}-recommendations.md`,exportState.payload.documentation?.guides?.recommendationsMarkdown||'# Recommendations\n','text/markdown');};
$('#exportAgentPrompt').onclick=()=>{if(!exportState||exportState.mode!=='analysis')return;download(`${safeBase(exportState.names[0])}-agent-prompt.txt`,exportState.payload.documentation?.recommendations?.prompt||'','text/plain');};

$('#analyzeBtn').onclick=analyzeSelected; $('#compareBtn').onclick=compareSelected;
function escapeHtml(value){return String(value).replace(/[&<>"']/g,(char)=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[char]));}
