function uniq(values) { return [...new Set(values.filter(Boolean))].sort(); }
function count(obj, key) { return obj?.[key]?.length || 0; }

function phpPublicApi(report) {
  const files = report.deep?.php?.files || [];
  const declarations = [];
  const functions = [];
  const constants = [];
  for (const file of files) {
    for (const d of file.declarations || []) declarations.push({ ...d, file: file.path, namespace: file.namespace });
    for (const fn of file.functions || []) {
      const visibility = fn.modifiers?.find((m) => ['public', 'protected', 'private'].includes(m)) || 'public/default';
      if (visibility === 'private' || visibility === 'protected') continue;
      functions.push({ ...fn, file: file.path, namespace: file.namespace, visibility });
    }
    for (const c of file.constants || []) constants.push({ ...c, file: file.path, namespace: file.namespace });
  }
  return { declarations, functions, constants };
}

function jsPublicApi(report) {
  const files = report.deep?.javascript?.files || [];
  const exports = [];
  const classes = [];
  for (const file of files) {
    for (const name of file.exports || []) exports.push({ name, file: file.path });
    for (const cls of file.classes || []) {
      if ((file.exports || []).includes(cls.name)) classes.push({ ...cls, file: file.path });
    }
  }
  return { exports, exportedClasses: classes };
}

function wordpressApi(report) {
  const wp = report.platforms?.wordpress;
  if (!wp) return null;
  const i = wp.integrations || {};
  return {
    actionsRegistered: i.actionsRegistered || [],
    filtersRegistered: i.filtersRegistered || [],
    actionsExposed: i.actionsFired || [],
    filtersExposed: i.filtersApplied || [],
    restRoutes: i.restRoutes || [],
    shortcodes: i.shortcodes || [],
    blocks: i.blocks || [],
    wpCliCommands: i.wpCliCommands || [],
    postTypes: i.postTypes || [],
    taxonomies: i.taxonomies || [],
    ajaxActions: i.ajaxActions || [],
  };
}

function wordpressCompatibility(report) {
  const wp = report.platforms?.wordpress;
  if (!wp) return null;
  const findings = [];
  const indicators = wp.indicators || {};
  const phpFiles = report.deep?.php?.files || [];
  const integrations = wp.integrations || {};
  const byFile = wp.integrationsByFile || [];
  const deepByPath = new Map(phpFiles.map((f) => [f.path, f]));
  const categories = [
    'Runtime & WordPress Core','WooCommerce & HPOS','Multisite','REST API','AJAX','Cron & background work','Database & custom tables',
    'Filesystem','Caching & transients','Options & autoload','Internationalization','Deprecated APIs','Custom Fields','Site Editor & blocks','Action Scheduler','Hooks & lifecycle','WPML','ACF','Builders & blocks','Security/input handling','Polyglot profile'
  ];
  const add = (status, area, rule, message, evidence = [], details = null) => findings.push({ status, area, rule, message, evidence: evidence.filter(Boolean).slice(0, 100), details });
  const filesWith = (pred) => byFile.filter(pred).map((f) => f.path);
  const sum = (key, subkey) => byFile.reduce((n,f)=>n+(Number(f?.[key]?.[subkey])||0),0);
  const headers = wp.plugin || wp.theme || {};

  if (headers.requiresPhp) add('positive','Runtime & WordPress Core','WP-RUNTIME-PHP','A minimum PHP version is declared.',[`Requires PHP: ${headers.requiresPhp}`]);
  else add('review','Runtime & WordPress Core','WP-RUNTIME-PHP-MISSING','No "Requires PHP" header was detected. Declare the minimum supported PHP version.');
  if (headers.requiresWordPress) add('positive','Runtime & WordPress Core','WP-RUNTIME-CORE','A minimum WordPress version is declared.',[`Requires at least: ${headers.requiresWordPress}`]);
  else add('review','Runtime & WordPress Core','WP-RUNTIME-CORE-MISSING','No "Requires at least" WordPress header was detected.');

  if (indicators.woocommerce) {
    const wooCrud = sum('woo','crud') + sum('woo','orderClasses');
    const hpos = sum('woo','hposUtil');
    const legacy = sum('woo','legacyOrderPostType');
    add('detected','WooCommerce & HPOS','WC-DETECTED','WooCommerce integration indicators are present.');
    if (wooCrud) add('positive','WooCommerce & HPOS','WC-CRUD','WooCommerce CRUD/order APIs were detected.', filesWith(f => (f.woo?.crud||0)+(f.woo?.orderClasses||0)));
    else add('review','WooCommerce & HPOS','WC-CRUD-REVIEW','WooCommerce integration is present, but recognizable CRUD/order API usage was not detected. Review order persistence paths.');
    if (hpos) add('positive','WooCommerce & HPOS','WC-HPOS-AWARE','Explicit HPOS-related utility/API indicators were detected.', filesWith(f => f.woo?.hposUtil));
    else add('review','WooCommerce & HPOS','WC-HPOS-AWARENESS','No explicit HPOS utility indicator was detected. This is not automatically a problem, but order-related integrations should be reviewed for HPOS-safe APIs.');
    if (legacy) add('review','WooCommerce & HPOS','WC-LEGACY-ORDER-POSTS',`Legacy shop_order/post-oriented references were detected (${legacy}). Review whether they assume orders are wp_posts records.`,filesWith(f=>f.woo?.legacyOrderPostType));
    const directDb = phpFiles.filter(f => (f.db?.directSql||0) && /order|shop_order|postmeta|posts/i.test(JSON.stringify(f.db||{}))).map(f=>f.path);
    if (directDb.length) add('review','WooCommerce & HPOS','WC-DIRECT-ORDER-DB','Direct SQL in order/post-oriented code may bypass WooCommerce data stores and HPOS.',directDb);
  }

  if (indicators.multisite) {
    add('detected','Multisite','WP-MS-DETECTED','WordPress multisite APIs were detected.');
    const switched=filesWith(f=>f.multisite?.switchToBlog); const restored=filesWith(f=>f.multisite?.restoreCurrentBlog);
    if (switched.length && !restored.length) add('review','Multisite','WP-MS-RESTORE','switch_to_blog() is used but restore_current_blog() was not detected. Review blog-context restoration.',switched);
    else if (switched.length) add('positive','Multisite','WP-MS-RESTORE','Blog switching and restoration APIs were both detected.',uniq([...switched,...restored]));
    if (integrations.siteOptions?.length) add('positive','Multisite','WP-MS-SITE-OPTIONS','Network/site option APIs are used.',integrations.siteOptions);
    const dbFiles=phpFiles.filter(f=>f.db?.directSql).map(f=>f.path);
    if (dbFiles.length) add('review','Multisite','WP-MS-DB-PREFIX','Direct SQL is present. Verify every custom query/table uses the correct site or network table prefix.',dbFiles);
  }

  const restFiles = byFile.filter(f=>f.restRouteDetails?.length);
  if (restFiles.length) {
    add('detected','REST API','WP-REST-DETECTED',`${integrations.restRoutes?.length||0} statically detectable REST route(s) found.`,integrations.restRoutes||[]);
    const missing=[]; const publicRoutes=[];
    for (const f of restFiles) for (const r of f.restRouteDetails||[]) {
      if (!r.permissionCallback) missing.push(`${r.route} — ${f.path}:${r.line}`);
      else if (r.permissionPublic) publicRoutes.push(`${r.route} — ${f.path}:${r.line}`);
    }
    if (missing.length) add('review','REST API','WP-REST-PERMISSION-MISSING','REST routes without a statically detectable permission_callback were found.',missing);
    else add('positive','REST API','WP-REST-PERMISSION','All statically parsed REST routes include a permission_callback.');
    if (publicRoutes.length) add('review','REST API','WP-REST-PUBLIC','REST routes explicitly using __return_true as permission_callback are public; verify this is intentional.',publicRoutes);
  }

  if (integrations.ajaxActions?.length) {
    add('detected','AJAX','WP-AJAX-DETECTED',`${integrations.ajaxActions.length} AJAX action(s) detected.`,integrations.ajaxActions);
    const ajaxFiles=byFile.filter(f=>f.ajaxActions?.length);
    const noNonce=ajaxFiles.filter(f=>!(deepByPath.get(f.path)?.inputFunctions?.nonceChecks||[]).length).map(f=>f.path);
    const noCap=ajaxFiles.filter(f=>f.ajaxPrivActions?.length && !(deepByPath.get(f.path)?.inputFunctions?.capabilityChecks||[]).length).map(f=>f.path);
    if (noNonce.length) add('review','AJAX','WP-AJAX-NONCE','AJAX handlers were detected in files without a common WordPress nonce verification call. Verify authorization at the handler level.',noNonce);
    else add('positive','AJAX','WP-AJAX-NONCE','Common nonce verification calls were detected in AJAX handler files.');
    if (noCap.length) add('review','AJAX','WP-AJAX-CAPABILITY','Authenticated AJAX actions occur in files without a recognizable capability check. Confirm authentication alone is sufficient.',noCap);
    if (integrations.ajaxNoPrivActions?.length) add('review','AJAX','WP-AJAX-NOPRIV','Unauthenticated wp_ajax_nopriv actions are exposed. Review nonce/rate-limit/data-disclosure behavior.',integrations.ajaxNoPrivActions);
  }

  if (indicators.cron) {
    const schedules=sum('cron','schedule'), next=sum('cron','nextScheduled'), clear=sum('cron','clearScheduled')+sum('cron','unschedule');
    add('detected','Cron & background work','WP-CRON-DETECTED',`Cron scheduling/lifecycle calls detected (schedule ${schedules}, next check ${next}, cleanup ${clear}).`,filesWith(f=>Object.values(f.cron||{}).some(Boolean)));
    if (schedules && !next) add('review','Cron & background work','WP-CRON-DUPLICATE','Scheduled events are created but wp_next_scheduled() was not detected. Review duplicate scheduling safeguards.');
    if (schedules && !clear) add('review','Cron & background work','WP-CRON-CLEANUP','Scheduled events are created but no unschedule/clear call was detected. Review deactivation/uninstall cleanup.');
    if (schedules && next && clear) add('positive','Cron & background work','WP-CRON-LIFECYCLE','Scheduling, duplicate-check, and cleanup indicators are all present.');
  }

  const customFiles=filesWith(f=>f.customTables?.dbDelta||f.customTables?.createTable);
  const dbFiles=phpFiles.filter(f=>f.db?.directSql || (f.db?.wpdbMethods||[]).length).map(f=>f.path);
  if (customFiles.length) {
    add('detected','Database & custom tables','WP-DB-CUSTOM-TABLE','Custom table/schema creation indicators were detected.',customFiles);
    if (sum('customTables','dbDelta')) add('positive','Database & custom tables','WP-DB-DBDELTA','dbDelta() usage was detected for schema management.',filesWith(f=>f.customTables?.dbDelta));
    else add('review','Database & custom tables','WP-DB-SCHEMA-MIGRATION','CREATE TABLE was detected without dbDelta() in the same static inventory. Review schema migration/idempotency strategy.',customFiles);
    if (!sum('customTables','wpdbPrefix')) add('review','Database & custom tables','WP-DB-PREFIX','Custom tables were detected without a recognizable $wpdb->prefix/base_prefix reference. Verify prefix handling, especially on multisite.',customFiles);
  }
  if (dbFiles.length) add('review','Database & custom tables','WP-DB-DIRECT',`Direct $wpdb/SQL activity was detected in ${dbFiles.length} file(s). Review prepared statements, table assumptions, and API bypasses.`,dbFiles);

  if (indicators.filesystemApi || indicators.directFilesystem) {
    if (indicators.filesystemApi) add('positive','Filesystem','WP-FS-API','WordPress Filesystem API usage was detected.',filesWith(f=>f.filesystem?.wpFilesystem||f.filesystem?.wpFilesystemClasses));
    const direct=filesWith(f=>f.filesystem?.directWrites);
    if (direct.length) add('review','Filesystem','WP-FS-DIRECT','Direct filesystem mutation functions were detected. For admin/plugin-managed writes, review whether WP_Filesystem should be used.',direct);
  }

  if (indicators.objectCache) add('positive','Caching & transients','WP-CACHE-OBJECT','WordPress object-cache APIs were detected.',integrations.cacheGroups||[]);
  if (indicators.transients) add('detected','Caching & transients','WP-CACHE-TRANSIENT','Transient APIs were detected.',uniq([...(integrations.transients||[]),...(integrations.siteTransients||[])]));
  if ((integrations.transients||[]).length && indicators.multisite && !(integrations.siteTransients||[]).length) add('review','Caching & transients','WP-CACHE-MULTISITE','Regular transients are used in a multisite-aware codebase. Verify whether values are site-local or network-wide by design.');

  if (indicators.i18n) {
    add('detected','Internationalization','WP-I18N-DETECTED','WordPress internationalization functions were detected.',integrations.textDomains||[]);
    const declared=headers.textDomain;
    const domains=integrations.textDomains||[];
    if (declared && domains.length) {
      const mismatched=domains.filter(d=>d!==declared);
      if (mismatched.length) add('review','Internationalization','WP-I18N-DOMAIN','Translation calls use text domains that differ from the declared project text domain.',mismatched);
      else add('positive','Internationalization','WP-I18N-DOMAIN','Detected literal translation calls use the declared text domain.');
    }
  }

  if (integrations.deprecatedApis?.length) add('review','Deprecated APIs','WP-DEPRECATED-API','Calls to APIs known to be deprecated in WordPress were detected. Review against the minimum supported core version.',integrations.deprecatedApis);

  if (indicators.wpml) {
    add('detected','WPML','WPML-DETECTED','WPML integration indicators are present.');
    const hookFiles=filesWith(f=>f.wpml?.hooks); if(hookFiles.length) add('positive','WPML','WPML-HOOKS','WPML public hook/filter integration was detected.',hookFiles);
    const iclFiles=filesWith(f=>f.wpml?.iclFunctions); if(iclFiles.length) add('review','WPML','WPML-ICL-FUNCTIONS','Legacy/internal-looking icl_* function usage was detected. Prefer documented WPML hooks/APIs where possible.',iclFiles);
    const tableFiles=filesWith(f=>f.wpml?.iclTables); if(tableFiles.length) add('review','WPML','WPML-DIRECT-TABLES','Direct references to WPML icl_* tables were detected. These create tighter coupling to WPML internals.',tableFiles);
    const sitepress=filesWith(f=>f.wpml?.sitepressGlobal); if(sitepress.length) add('review','WPML','WPML-SITEPRESS-GLOBAL','$sitepress global usage was detected. Review whether public hooks can replace direct object coupling.',sitepress);
  }

  if (indicators.acf) {
    add('detected','ACF','ACF-DETECTED','Advanced Custom Fields integration indicators are present.');
    if (sum('acf','fieldApi')) add('info','ACF','ACF-FIELD-API','ACF field APIs were detected.',filesWith(f=>f.acf?.fieldApi));
    if (sum('acf','hooks')) add('positive','ACF','ACF-HOOKS','ACF hook integration was detected.',filesWith(f=>f.acf?.hooks));
  }

  if (integrations.builders?.length) add('detected','Builders & blocks','WP-BUILDERS',`Builder integrations detected: ${integrations.builders.join(', ')}.`,integrations.builders);
  if (indicators.gutenbergBlocks) add('detected','Builders & blocks','WP-BLOCKS',`${integrations.blocks?.length||0} statically detectable block registration(s) found.`,integrations.blocks||[]);

  const requestFiles = phpFiles.filter((f) => Object.keys(f.superglobals || {}).some((k) => ['$_GET','$_POST','$_REQUEST','$_COOKIE','$_FILES'].includes(k))).map(f=>f.path);
  if (requestFiles.length) add('review','Security/input handling','WP-REQUEST-DATA',`Request superglobals are accessed in ${requestFiles.length} file(s). Review sanitization, authorization, nonces, and output escaping.`,requestFiles);
  const globalsFiles=phpFiles.filter(f=>Object.keys(f.superglobals||{}).includes('$GLOBALS')).map(f=>f.path);
  if (globalsFiles.length) add('info','Security/input handling','PHP-GLOBALS',`$GLOBALS usage was detected in ${globalsFiles.length} file(s).`,globalsFiles);
  for (const r of report.deep?.riskSignals || []) add('review','Security/input handling',r.rule,r.message,[r.file]);



  // v0.6 deeper compatibility catalog.
  const lifecycleFiles = filesWith(f=>Object.values(f.hooksLifecycle||{}).some(Boolean));
  if (lifecycleFiles.length) {
    const act=sum('hooksLifecycle','activation'), deact=sum('hooksLifecycle','deactivation'), uninstall=sum('hooksLifecycle','uninstall');
    add('detected','Hooks & lifecycle','WP-HOOK-LIFECYCLE',`Lifecycle hooks detected (activation ${act}, deactivation ${deact}, uninstall ${uninstall}).`,lifecycleFiles);
    if (act && !deact) add('review','Hooks & lifecycle','WP-HOOK-DEACTIVATION','Activation hooks are registered but no deactivation hook was detected. Review cleanup of cron, caches, temporary state, and runtime registrations.',lifecycleFiles);
    if (sum('hooksLifecycle','lateInit')) add('info','Hooks & lifecycle','WP-HOOK-LATE-INIT','High-priority init hooks were detected. Verify ordering dependencies are intentional.',filesWith(f=>f.hooksLifecycle?.lateInit));
  }

  if (restFiles.length) {
    const noArgs=[], weakArgs=[];
    for (const f of restFiles) for (const r of f.restRouteDetails||[]) {
      if (!r.hasArgs && (r.methods||[]).some(m=>!/GET|READABLE/i.test(m))) noArgs.push(`${r.route} — ${f.path}:${r.line}`);
      if (r.hasArgs && !r.hasSanitizeCallback && !r.hasValidateCallback && !r.hasArgType) weakArgs.push(`${r.route} — ${f.path}:${r.line}`);
    }
    if (noArgs.length) add('review','REST API','WP-REST-ARGS-MISSING','Write-capable REST routes were detected without a statically detectable args schema. Define argument types, required fields, validation and sanitization where appropriate.',noArgs);
    if (weakArgs.length) add('review','REST API','WP-REST-ARGS-WEAK','REST route args were detected without recognizable type, validation, or sanitization callbacks. Review the route schema.',weakArgs);
    if (!noArgs.length && !weakArgs.length) add('positive','REST API','WP-REST-ARGS','No obvious REST argument-schema gaps were detected in statically parsed routes.');
  }

  const nonceCreated=uniq(byFile.flatMap(f=>f.nonce?.created||[]));
  const nonceChecked=uniq(byFile.flatMap(f=>[...(f.nonce?.checked||[]),...(f.nonce?.verified||[])]));
  if (nonceCreated.length || nonceChecked.length) {
    const createdOnly=nonceCreated.filter(x=>!nonceChecked.includes(x));
    const checkedOnly=nonceChecked.filter(x=>!nonceCreated.includes(x));
    if (createdOnly.length) add('review','AJAX','WP-NONCE-CORRELATION-CREATED','Nonce action strings are created but no matching static verification action was detected. Verify the action names correlate at runtime.',createdOnly);
    if (checkedOnly.length) add('info','AJAX','WP-NONCE-CORRELATION-CHECKED','Nonce action strings are checked without a matching static creation call in this codebase; they may be created elsewhere.',checkedOnly);
    if (!createdOnly.length && nonceCreated.length) add('positive','AJAX','WP-NONCE-CORRELATION','Statically detected nonce creation action strings have matching verification action strings.',nonceCreated);
  }

  if (indicators.actionScheduler) {
    const scheduled=sum('actionScheduler','enqueueAsync')+sum('actionScheduler','scheduleSingle')+sum('actionScheduler','scheduleRecurring');
    const cleanup=sum('actionScheduler','unschedule'); const next=sum('actionScheduler','nextScheduled');
    add('detected','Action Scheduler','WC-AS-DETECTED',`Action Scheduler usage detected (${scheduled} scheduling call(s)).`,filesWith(f=>Object.values(f.actionScheduler||{}).some(Boolean)));
    if (sum('actionScheduler','scheduleRecurring') && !next) add('review','Action Scheduler','WC-AS-DUPLICATE','Recurring Action Scheduler jobs are created but as_next_scheduled_action() was not detected. Review duplicate scheduling prevention.');
    if (sum('actionScheduler','scheduleRecurring') && !cleanup) add('review','Action Scheduler','WC-AS-CLEANUP','Recurring Action Scheduler jobs are created but no unscheduling call was detected. Review deactivation/uninstall cleanup.');
  }

  const optFiles=filesWith(f=>Object.values(f.optionsBehavior||{}).some(Boolean));
  if (optFiles.length) {
    const autoloadYes=sum('optionsBehavior','addAutoloadYes'), autoloadNo=sum('optionsBehavior','addAutoloadNo');
    if (autoloadYes) add('review','Options & autoload','WP-OPTION-AUTOLOAD','Options explicitly configured for autoload were detected. Verify payload size and request frequency, especially for arrays/caches.',filesWith(f=>f.optionsBehavior?.addAutoloadYes));
    if (autoloadNo) add('positive','Options & autoload','WP-OPTION-NONAUTOLOAD','Explicit non-autoload option creation was detected.',filesWith(f=>f.optionsBehavior?.addAutoloadNo));
    if (sum('optionsBehavior','allOptions')) add('review','Options & autoload','WP-OPTION-ALLOPTIONS','wp_load_alloptions() is called directly. Review whether loading the full autoload set is necessary.',filesWith(f=>f.optionsBehavior?.allOptions));
  }

  const cacheFiles=filesWith(f=>Object.values(f.cacheBehavior||{}).some(Boolean));
  if (cacheFiles.length) {
    const writes=sum('cacheBehavior','set'), invalidation=sum('cacheBehavior','delete')+sum('cacheBehavior','flush')+sum('cacheBehavior','cleanPost');
    add('detected','Caching & transients','WP-CACHE-BEHAVIOR','Object-cache read/write behavior was detected.',cacheFiles);
    if (writes && !invalidation) add('review','Caching & transients','WP-CACHE-INVALIDATION','Cache writes were detected but no recognizable invalidation call was found. Verify stale-cache handling when source data changes.',cacheFiles);
  }

  if (indicators.customFields) {
    const cfFiles=filesWith(f=>Object.values(f.customFields||{}).some(v=>typeof v==='number'&&v>0) || Object.values(f.acf||{}).some(v=>typeof v==='number'&&v>0));
    add('detected','Custom Fields','WP-CUSTOM-FIELDS',`Custom-field/meta APIs were detected in ${cfFiles.length} file(s).`,cfFiles);
    if (sum('customFields','registerPostMeta')+sum('customFields','registerMeta')) {
      if (sum('customFields','showInRest')) add('positive','Custom Fields','WP-META-REST-SCHEMA','Registered metadata with show_in_rest indicators was detected.',filesWith(f=>f.customFields?.showInRest));
      else add('review','Custom Fields','WP-META-REST-SCHEMA','Registered metadata was detected without a recognizable show_in_rest declaration. Review REST/block-editor exposure requirements.',filesWith(f=>f.customFields?.registerPostMeta||f.customFields?.registerMeta));
      if (!sum('customFields','authCallback')) add('review','Custom Fields','WP-META-AUTH','Registered metadata was detected without a recognizable auth_callback. Review write authorization for custom fields exposed through APIs.',filesWith(f=>f.customFields?.registerPostMeta||f.customFields?.registerMeta));
    }
    if (sum('acf','localGroups')) add('info','Custom Fields','ACF-LOCAL-GROUPS','Programmatically registered ACF field groups were detected.',filesWith(f=>f.acf?.localGroups));
    if (sum('acf','repeater')) add('info','Custom Fields','ACF-REPEATER','ACF repeater/sub-field APIs were detected. Multilingual copy/sync semantics should be tested at row and sub-field level.',filesWith(f=>f.acf?.repeater));
  }

  if (indicators.siteEditor) {
    const blockMeta = byFile.filter(f=>f.buildersDetail?.blockMetadata).map(f=>f.path);
    add('detected','Site Editor & blocks','WP-SITE-EDITOR','Block/Site Editor metadata or registration indicators were detected.',uniq([...blockMeta,...(integrations.blocks||[])]));
    if ((integrations.blocks||[]).length && !blockMeta.length) add('info','Site Editor & blocks','WP-BLOCK-METADATA','Blocks are registered, but register_block_type_from_metadata() was not detected. Review block.json metadata adoption for modern block registration.');
  }

  const builderFiles=byFile.filter(f=>Object.values(f.buildersDetail||{}).some(Boolean));
  if (builderFiles.some(f=>f.buildersDetail?.elementorHooks||f.buildersDetail?.elementorWidgets)) add('info','Builders & blocks','ELEMENTOR-SURFACE','Elementor-specific hooks/widgets were detected. Validate document/template translation, dynamic tags, widget settings, and frontend CSS regeneration.',builderFiles.filter(f=>f.buildersDetail?.elementorHooks||f.buildersDetail?.elementorWidgets).map(f=>f.path));
  if (builderFiles.some(f=>f.buildersDetail?.diviModules)) add('info','Builders & blocks','DIVI-SURFACE','Divi builder/module integration was detected. Validate Theme Builder templates, global presets, serialized module data, and builder cache regeneration.',builderFiles.filter(f=>f.buildersDetail?.diviModules).map(f=>f.path));

  if (indicators.wpml) {
    if (sum('multilingual','wpmlObjectId')) add('positive','WPML','WPML-OBJECT-ID','wpml_object_id integration was detected.',filesWith(f=>f.multilingual?.wpmlObjectId));
    if (sum('multilingual','wpmlElementType')) add('info','WPML','WPML-ELEMENT-TYPE','wpml_element_type usage was detected. Confirm element-type normalization matches documented WPML contracts.',filesWith(f=>f.multilingual?.wpmlElementType));
    if (sum('multilingual','languageGlobals')) add('review','WPML','WPML-LANGUAGE-GLOBAL','Language globals/direct SitePress state were detected. Prefer public language hooks/APIs where feasible.',filesWith(f=>f.multilingual?.languageGlobals));
  }

  if (wp.compatibilityProfile === 'polyglot') {
    add('detected','Polyglot profile','POLYGLOT-PROFILE','Polyglot-specific compatibility profile enabled.');
    if ((integrations.actionsFired?.length||0)+(integrations.filtersApplied?.length||0)) add('positive','Polyglot profile','POLYGLOT-EXTENSION-API','Polyglot exposes WordPress actions/filters that can serve as extension points.',uniq([...(integrations.actionsFired||[]),...(integrations.filtersApplied||[])]) );
    const compatFiles=byFile.filter(f=>/compatibility/i.test(f.path)).map(f=>f.path); if(compatFiles.length) add('positive','Polyglot profile','POLYGLOT-COMPAT-LAYER','Dedicated compatibility-layer files were detected.',compatFiles);
    if (indicators.woocommerce) add('info','Polyglot profile','POLYGLOT-WC','WooCommerce integration is part of this Polyglot codebase; HPOS and CRUD findings above should be treated as release gates for commerce work.');
    if (indicators.wpml) add('review','Polyglot profile','POLYGLOT-WPML-COEXISTENCE','WPML indicators are present in Polyglot. Verify these are deliberate compatibility/migration paths and do not create runtime hard dependencies.');
    if (indicators.multisite) add('info','Polyglot profile','POLYGLOT-MULTISITE','Multisite-aware behavior is present; language state, options, caches, and table access should be validated per-site and network-wide.');
    if (sum('multilingual','polyglotHooks')) add('positive','Polyglot profile','POLYGLOT-CONTRACT-HOOKS','Polyglot-prefixed multilingual extension hooks were detected. Treat documented hooks as compatibility contracts and version them deliberately.',filesWith(f=>f.multilingual?.polyglotHooks));
    if (indicators.customFields) add('info','Polyglot profile','POLYGLOT-CUSTOM-FIELDS','Custom-field integration is present. Verify field translation policy, copy/copy-once behavior, repeater row semantics, and REST/block-editor exposure.');
    if (indicators.siteEditor) add('info','Polyglot profile','POLYGLOT-SITE-EDITOR','Site Editor/block integration is present. Validate template/template-part language mapping, block metadata, navigation, and frontend rendering per language.');
  }

  const byArea = {};
  for (const f of findings) (byArea[f.area] ||= []).push(f);
  return {
    catalogVersion:'0.7.0', categories,
    summary:{findings:findings.length,reviewItems:findings.filter(f=>f.status==='review').length,positiveItems:findings.filter(f=>f.status==='positive').length,detectedIntegrations:uniq(Object.entries(indicators).filter(([,v])=>v).map(([k])=>k))},
    findings, byArea,
    notes:['Compatibility findings are deterministic review indicators, not certification.','Dynamic hooks, runtime-generated routes, aliases, callbacks, and indirect API calls may not be detected.','Absence of a positive indicator does not prove incompatibility.'],
  };
}

function securityPerformanceModel(report) {
  const php=report.deep?.php?.files||[]; const js=report.deep?.javascript?.files||[]; const wp=report.platforms?.wordpress;
  const security=[], performance=[];
  const addS=(severity,rule,message,evidence=[])=>security.push({severity,rule,message,evidence:uniq(evidence).slice(0,100)});
  const addP=(severity,rule,message,evidence=[])=>performance.push({severity,rule,message,evidence:uniq(evidence).slice(0,100)});
  const byFile=wp?.integrationsByFile||[];
  const req=php.filter(f=>Object.keys(f.superglobals||{}).some(k=>['$_GET','$_POST','$_REQUEST','$_COOKIE','$_FILES'].includes(k)));
  const unsanitized=req.filter(f=>!(f.inputFunctions?.sanitization||[]).length).map(f=>f.path);
  if(unsanitized.length)addS('review','SEC-INPUT-SANITIZE','Request input is used in files without a recognizable sanitization call. Trace each data flow; sanitization may occur elsewhere.',unsanitized);
  const execFiles=byFile.filter(f=>f.security?.dangerousExec).map(f=>f.path); if(execFiles.length)addS('high','SEC-PROCESS-EXEC','Process/shell execution functions were detected. Validate strict argument control and whether execution is necessary.',execFiles);
  const unserialize=byFile.filter(f=>f.security?.unserialize).map(f=>f.path); if(unserialize.length)addS('review','SEC-UNSERIALIZE','unserialize() was detected. Ensure data is trusted or migrate to safer formats/APIs.',unserialize);
  const ssl=byFile.filter(f=>f.security?.remoteSslDisabled).map(f=>f.path); if(ssl.length)addS('high','SEC-TLS-VERIFY','Remote HTTP requests with sslverify=false were detected.',ssl);
  const upload=byFile.filter(f=>f.security?.fileUploads).map(f=>f.path); if(upload.length)addS('review','SEC-UPLOAD','File-upload input is accessed. Review MIME/type validation, permissions, filename handling, and storage location.',upload);
  const publicRest=[]; for(const f of byFile)for(const r of f.restRouteDetails||[])if(r.permissionPublic)publicRest.push(`${r.route} — ${f.path}:${r.line}`); if(publicRest.length)addS('review','SEC-REST-PUBLIC','Explicitly public REST routes were detected. Confirm data exposure and rate/abuse characteristics are intentional.',publicRest);
  for(const r of report.deep?.riskSignals||[])addS('review',r.rule,r.message,[r.file]);

  const unbounded=byFile.filter(f=>f.performance?.unboundedPosts).map(f=>f.path); if(unbounded.length)addP('review','PERF-UNBOUNDED-QUERY','Unbounded WordPress content queries (-1/nopaging) were detected. Review memory/runtime impact on large sites.',unbounded);
  const heavy=php.filter(f=>(f.complexity?.branches||0)>120 || (f.functions||[]).length>60).map(f=>f.path); if(heavy.length)addP('review','PERF-COMPLEX-FILES','Very high branch/function density was detected. Consider profiling and decomposition of hot paths.',heavy);
  const directDb=php.filter(f=>(f.db?.directSql||0)>5).map(f=>f.path); if(directDb.length)addP('review','PERF-DATABASE-HOTSPOT','Files with many direct SQL indicators were detected. Review query count, indexes, caching, and whether queries occur inside loops.',directDb);
  const remote=byFile.filter(f=>(f.performance?.remoteCalls||0)>2).map(f=>f.path); if(remote.length)addP('review','PERF-REMOTE-CALLS','Multiple remote-request calls occur in individual files. Verify requests are not on latency-sensitive frontend paths and have timeouts/caching.',remote);
  const cacheWrites=byFile.filter(f=>f.cacheBehavior?.set && !(f.cacheBehavior?.delete||f.cacheBehavior?.flush||f.cacheBehavior?.cleanPost)).map(f=>f.path); if(cacheWrites.length)addP('review','PERF-CACHE-INVALIDATION','Cache writes without recognizable invalidation were detected.',cacheWrites);
  const large=(report.largestFiles||[]).filter(x=>/\.(php|js|ts|tsx|jsx)$/i.test(x.path)&&x.size>150000).map(x=>`${x.path} — ${x.size} bytes`); if(large.length)addP('info','PERF-LARGE-SOURCE','Large source files were detected; these are maintenance/profile targets, not automatically runtime problems.',large);
  return {security,performance,summary:{securityReview:security.filter(x=>['review','high'].includes(x.severity)).length,performanceReview:performance.filter(x=>x.severity==='review').length}};
}

function customFieldsModel(report){
  const wp=report.platforms?.wordpress;if(!wp)return null; const files=wp.integrationsByFile||[];
  const rows=[];
  for(const f of files){
    const active=(f.customFields?.registerPostMeta||0)+(f.customFields?.registerMeta||0)+(f.customFields?.postMetaReads||0)+(f.customFields?.postMetaWrites||0)+(f.acf?.fieldApi||0);
    if(!active)continue;
    rows.push({path:f.path,metaKeys:f.customFieldKeys||[],registered:(f.customFields?.registerPostMeta||0)+(f.customFields?.registerMeta||0),reads:f.customFields?.postMetaReads||0,writes:f.customFields?.postMetaWrites||0,showInRest:f.customFields?.showInRest||0,authCallbacks:f.customFields?.authCallback||0,acfCalls:f.acf?.fieldApi||0,acfHooks:f.acf?.hooks||0,acfGroups:f.acf?.localGroups||0,acfRepeater:f.acf?.repeater||0,acfFieldKeys:f.acf?.fieldKeys||[]});
  }
  return {keys:wp.integrations.customFieldKeys||wp.integrations.metaKeys||[],files:rows,summary:{keys:(wp.integrations.customFieldKeys||[]).length,files:rows.length,acfFiles:rows.filter(x=>x.acfCalls||x.acfHooks).length,registeredMeta:rows.reduce((n,x)=>n+x.registered,0),restExposed:rows.reduce((n,x)=>n+x.showInRest,0)}};
}

function recommendationsModel(report, compatibility, quality){
  const findings=[...(compatibility?.wordpress?.findings||[]),...(compatibility?.node?.findings||[])];
  const extra=[...(quality?.security||[]).map(x=>({status:x.severity==='high'?'review':'review',area:'Security',rule:x.rule,message:x.message,evidence:x.evidence})),...(quality?.performance||[]).map(x=>({status:x.severity==='review'?'review':'info',area:'Performance',rule:x.rule,message:x.message,evidence:x.evidence}))];
  const candidates=[...findings.filter(x=>x.status==='review'),...extra.filter(x=>x.status==='review')];
  const tests=report.insights?.tests, docs=report.insights?.documentationHealth;
  if(tests && tests.summary?.productionSourceFiles>20 && tests.summary?.testFiles===0) candidates.push({status:'review',area:'Tests',rule:'TEST-COVERAGE-NONE',message:'No test files were detected for a non-trivial source codebase. Add focused automated coverage for critical behavior before large refactors.',evidence:[]});
  if(docs && docs.publicApiSurface>20 && !docs.docsDirectory && !docs.hasReadme) candidates.push({status:'review',area:'Documentation',rule:'DOC-PUBLIC-API',message:'A substantial public API surface was detected without a README or docs/ documentation surface.',evidence:[]});
  if(docs && !docs.hasAgents) candidates.push({status:'review',area:'Documentation',rule:'DOC-AGENT-GUIDANCE',message:'No AGENTS.md was detected. For repositories frequently modified by coding agents, consider durable repository-specific agent guidance.',evidence:[]});
  const rank=(x)=>/SEC-|PERMISSION|NONCE|AUTH|TLS|EXEC/.test(x.rule)?'high':/HPOS|DB-|CACHE|CRON|ACTION|REST|CUSTOM|MULTISITE/.test(x.rule)?'medium':'normal';
  const seen=new Set(); const items=[];
  for(const f of candidates){if(seen.has(f.rule))continue;seen.add(f.rule);const priority=rank(f); const actions=[`Inspect the concrete evidence for ${f.rule} before changing behavior.`,`Add or update automated tests that reproduce the affected compatibility/security/performance contract.`,`Implement the smallest backward-compatible correction and rerun the relevant test suite.`];
    items.push({priority,rule:f.rule,area:f.area,title:f.message.split('.')[0],rationale:f.message,evidence:f.evidence||[],suggestedActions:actions});
  }
  items.sort((a,b)=>({high:0,medium:1,normal:2}[a.priority]-{high:0,medium:1,normal:2}[b.priority]));
  if(items.length>200)items.length=200;
  const project=report.platforms?.wordpress?.plugin?.name||report.platforms?.node?.package?.name||report.rootName;
  const prompt=[`You are working on ${project}. Use the Codebase Inspector recommendations below as review inputs, not unquestioned facts.`, '', 'Workflow requirements:', '- Inspect the referenced files and confirm each issue before editing code.', '- Read existing repository guidance first, especially AGENTS.md, README files, CONTRIBUTING.md, docs/, architecture documents, and existing roadmaps.', '- If AGENTS.md exists, follow it. Update it only when durable repository-wide agent instructions genuinely need to change.', '- Use the existing roadmap/planning document when present. If there is no suitable plan and the work spans multiple concerns, create or update ROADMAP.md with scoped tasks, acceptance criteria, risks, and validation steps.', '- Do not create duplicate markdown governance files when an adequate canonical file already exists.', '- Document compatibility contracts and public API changes in the repository documentation closest to the code.', '- Add or update tests before considering a recommendation complete.', '- Preserve backward compatibility unless the roadmap explicitly authorizes a breaking change.', '', 'Recommendations:', ...items.slice(0,40).flatMap((x,i)=>[`${i+1}. [${x.priority.toUpperCase()}] ${x.rule} — ${x.rationale}`,...(x.evidence||[]).slice(0,5).map(e=>`   Evidence: ${e}`)]), '', 'At the end, summarize changed files, tests run, unresolved risks, and documentation/roadmap updates.'].join('\n');
  return {items,prompt,documentationPolicy:{preferred:['AGENTS.md','ROADMAP.md','README.md','docs/'],rules:['Reuse existing canonical documentation before creating a new file.','AGENTS.md is for durable agent/repository instructions, not a transient task checklist.','ROADMAP.md is appropriate for multi-step planned work with acceptance criteria and sequencing.']}};
}

function nodeCompatibility(report) {
  const node = report.platforms?.node;
  if (!node) return null;
  const findings = [];
  const add = (status, area, rule, message, evidence = []) => findings.push({ status, area, rule, message, evidence: evidence.slice(0, 50) });
  const p = node.package || {};
  if (p.engines?.node) add('info', 'Runtime', 'NODE-ENGINE', `Declared Node.js engine requirement: ${p.engines.node}.`);
  else add('review', 'Runtime', 'NODE-ENGINE-MISSING', 'No Node.js engine requirement was declared in package.json.');
  if (p.packageManager) add('info', 'Package manager', 'NODE-PACKAGE-MANAGER', `Declared package manager: ${p.packageManager}.`);
  else add('review', 'Package manager', 'NODE-PACKAGE-MANAGER-MISSING', 'No packageManager field was declared in package.json.');
  if (node.indicators?.hasLockfile) add('positive', 'Dependencies', 'NODE-LOCKFILE', 'A dependency lockfile was detected.');
  else add('review', 'Dependencies', 'NODE-LOCKFILE-MISSING', 'No supported dependency lockfile was detected.');
  if (node.environmentVariables?.length) add('info', 'Configuration', 'NODE-ENV', `${node.environmentVariables.length} environment variable name(s) were detected.`, node.environmentVariables);
  if (node.routes?.length) add('info', 'HTTP API', 'NODE-ROUTES', `${node.routes.length} Express-style route declaration(s) were detected.`, node.routes.map((r) => `${r.method} ${r.route} (${r.file})`));
  const dynamic = report.deep?.riskSignals?.filter((r) => r.rule === 'JS-DYNAMIC-001') || [];
  if (dynamic.length) add('review', 'Dynamic execution', 'NODE-DYNAMIC', 'Dynamic JavaScript execution patterns were detected.', dynamic.map((r) => r.file));
  return { summary: { findings: findings.length, reviewItems: findings.filter((f) => f.status === 'review').length }, findings };
}

function developerGuideModel(report) {
  const wp = report.platforms?.wordpress;
  const node = report.platforms?.node;
  return {
    project: {
      name: wp?.plugin?.name || wp?.theme?.name || node?.package?.name || report.rootName,
      version: wp?.plugin?.version || wp?.theme?.version || node?.package?.version || null,
      platforms: report.platforms?.detected || [],
    },
    architecture: {
      totals: report.totals,
      languages: report.languages,
      structure: report.deep?.summary || {},
      largestFiles: report.largestFiles || [],
    },
    publicApi: {
      php: phpPublicApi(report),
      javascript: jsPublicApi(report),
      wordpress: wordpressApi(report),
    },
    dependencies: report.dependencies || [],
    wordpress: wp ? {
      metadata: { type: wp.type, plugin: wp.plugin, theme: wp.theme, composer: wp.composer },
      integrations: wp.integrations,
      indicators: wp.indicators,
    } : null,
    node: node ? {
      package: node.package,
      scripts: node.scripts,
      frameworks: node.frameworks,
      externalImports: node.externalImports,
      environmentVariables: node.environmentVariables,
      routes: node.routes,
    } : null,
    database: {
      files: (report.deep?.php?.files || []).filter((f) => f.db?.directSql || (f.db?.wpdbMethods || []).length).map((f) => ({ path: f.path, ...f.db })),
    },
    requestData: report.deep?.php?.superglobals || {},
    customFields: customFieldsModel(report),
    limitations: [
      'Generated entirely from static deterministic analysis; no AI interpretation is used.',
      'Parser-lite extraction can miss dynamic/runtime-generated behavior and unusual syntax.',
    ],
  };
}


function mdList(items, formatter = (x) => String(x)) {
  return items?.length ? items.map((x) => `- ${formatter(x)}`).join('\n') : '- None detected';
}

function renderDeveloperGuide(report, guide) {
  const g = guide || developerGuideModel(report);
  const p = g.project || {};
  const a = g.architecture || {};
  const api = g.publicApi || {};
  const php = api.php || {};
  const js = api.javascript || {};
  const wpa = api.wordpress;
  const wp = g.wordpress;
  const node = g.node;
  const parts = [];

  parts.push(`# ${p.name || report.rootName} Developer Guide`);
  parts.push('> Generated by Codebase Inspector using deterministic static analysis. Dynamic/runtime behavior still requires manual verification.');
  parts.push(`## Project overview\n- Version: ${p.version || 'Unknown'}\n- Platforms: ${(p.platforms || []).join(', ') || 'None detected'}\n- Files: ${a.totals?.files || 0}\n- Folders: ${a.totals?.folders || 0}\n- Lines: ${a.totals?.lines || 0}\n- Code lines: ${a.totals?.codeLines || 0}\n- Comment lines: ${a.totals?.commentLines || 0}\n- Blank lines: ${a.totals?.blankLines || 0}\n- Classes: ${a.structure?.classes || 0}\n- Interfaces: ${a.structure?.interfaces || 0}\n- Traits: ${a.structure?.traits || 0}\n- Enums: ${a.structure?.enums || 0}\n- Functions/methods: ${a.structure?.functions || 0}`);
  parts.push(`## Languages\n${mdList(Object.entries(a.languages || {}), ([name,v]) => `${name}: ${v.files} files, ${v.lines} lines, ${v.code} code lines`)}`);
  parts.push(`## Largest source files\n${mdList((a.largestFiles || []).filter(x => !/\.(svg|png|jpe?g|gif|webp|mo)$/i.test(x.path)).slice(0,20), x => `${x.path} — ${x.size} bytes`)}`);
  parts.push(`## Third-party dependencies\n${mdList(g.dependencies || [], x => `${x.ecosystem}: ${x.name} ${x.version || ''}${x.kind ? ` (${x.kind})` : ''}`)}`);
  parts.push(`## Public PHP API\n### Declarations\n${mdList(php.declarations || [], x => `${x.kind} ${x.namespace ? x.namespace+'\\' : ''}${x.name} — ${x.file}:${x.line}`)}\n\n### Public/default functions and methods\n${mdList(php.functions || [], x => `${x.name}(${x.parameters || ''})${x.returnType ? ': '+x.returnType : ''} — ${x.file}:${x.line}`)}\n\n### Constants\n${mdList(php.constants || [], x => `${x.name} — ${x.file}:${x.line}`)}`);
  parts.push(`## JavaScript / TypeScript exports\n${mdList(js.exports || [], x => `${x.name} — ${x.file}`)}`);

  if (wpa) {
    parts.push(`## WordPress extension API\n### Actions exposed\n${mdList(wpa.actionsExposed)}\n\n### Filters exposed\n${mdList(wpa.filtersExposed)}\n\n### Actions consumed\n${mdList(wpa.actionsRegistered)}\n\n### Filters consumed\n${mdList(wpa.filtersRegistered)}\n\n### REST routes\n${mdList(wpa.restRoutes)}\n\n### WP-CLI commands\n${mdList(wpa.wpCliCommands)}\n\n### Shortcodes\n${mdList(wpa.shortcodes)}\n\n### Blocks\n${mdList(wpa.blocks)}\n\n### Custom post types\n${mdList(wpa.postTypes)}\n\n### Taxonomies\n${mdList(wpa.taxonomies)}\n\n### AJAX actions\n${mdList(wpa.ajaxActions)}`);
  }

  if (wp) {
    const i = wp.integrations || {};
    parts.push(`## WordPress integration inventory\n- Type: ${wp.metadata?.type || 'Unknown'}\n- Plugin: ${wp.metadata?.plugin?.name || '—'}\n- Version: ${wp.metadata?.plugin?.version || wp.metadata?.theme?.version || '—'}\n- Requires WordPress: ${wp.metadata?.plugin?.requiresWordPress || wp.metadata?.theme?.requiresWordPress || 'Not declared'}\n- Requires PHP: ${wp.metadata?.plugin?.requiresPhp || wp.metadata?.theme?.requiresPhp || 'Not declared'}\n- Actions registered: ${i.actionsRegistered?.length || 0}\n- Filters registered: ${i.filtersRegistered?.length || 0}\n- Actions exposed: ${i.actionsFired?.length || 0}\n- Filters exposed: ${i.filtersApplied?.length || 0}\n- REST routes: ${i.restRoutes?.length || 0}\n- Post types: ${i.postTypes?.length || 0}\n- Taxonomies: ${i.taxonomies?.length || 0}\n- AJAX actions: ${i.ajaxActions?.length || 0}\n- Options: ${i.options?.length || 0}\n- Meta keys: ${i.metaKeys?.length || 0}\n- Scripts/styles: ${(i.scripts?.length || 0) + (i.styles?.length || 0)}`);
    parts.push(`### Options used\n${mdList(i.options || [])}`);
    parts.push(`### Meta keys used\n${mdList(i.metaKeys || [])}`);
  }

  if (node) {
    parts.push(`## Node.js application\n- Package: ${node.package?.name || 'Unknown'}\n- Version: ${node.package?.version || 'Unknown'}\n- Module type: ${node.package?.type || 'CommonJS/default'}\n- Node engine: ${node.package?.engines?.node || 'Not declared'}\n- Package manager: ${node.package?.packageManager || 'Not declared'}\n- Frameworks/tooling: ${(node.frameworks || []).join(', ') || 'None detected'}\n- Scripts: ${Object.keys(node.scripts || {}).length}\n- External imports: ${(node.externalImports || []).length}\n- Environment variables: ${(node.environmentVariables || []).length}\n- Routes: ${(node.routes || []).length}\n\n### npm scripts\n${mdList(Object.entries(node.scripts || {}), ([name,cmd]) => `${name}: ${cmd}`)}\n\n### External imports\n${mdList(node.externalImports || [])}\n\n### Environment variable names\n${mdList(node.environmentVariables || [])}\n\n### Routes\n${mdList(node.routes || [], x => `${x.method || ''} ${x.route || ''} — ${x.file || ''}`)}`);
  }

  if (g.customFields) parts.push(`## Custom fields
- Unique custom-field/meta keys: ${g.customFields.summary?.keys||0}
- Files using custom fields: ${g.customFields.summary?.files||0}
- Files using ACF: ${g.customFields.summary?.acfFiles||0}
- Registered metadata calls: ${g.customFields.summary?.registeredMeta||0}
- REST-exposed metadata indicators: ${g.customFields.summary?.restExposed||0}

### Keys
${mdList(g.customFields.keys||[])}`);
  parts.push(`## Database usage\n${mdList(g.database?.files || [], x => `${x.path}: methods ${(x.wpdbMethods || []).join(', ') || 'none'}, direct SQL indicators ${x.directSql || 0}${x.tables?.length ? `, tables ${x.tables.join(', ')}` : ''}`)}`);
  parts.push(`## Request / global state\n${mdList(Object.entries(g.requestData || {}), ([name,v]) => `${name}: ${v.occurrences} occurrence(s), ${v.reads || 0} read(s), ${v.writes || 0} write(s), across ${v.files?.length || 0} file(s)`)}`);
  parts.push(`## Analysis limitations\n${mdList(g.limitations || [])}`);
  return parts.join('\n\n') + '\n';
}

function renderCompatibilityGuide(report, compatibility) {
  const d = compatibility || { wordpress: wordpressCompatibility(report), node: nodeCompatibility(report) };
  const sets = [['WordPress', d.wordpress], ['Node.js', d.node]].filter(([,v]) => v);
  if (!sets.length) return '# Compatibility Guide\n\nNo WordPress or Node.js compatibility model was generated.\n';
  const parts = ['# Compatibility Guide', '> Deterministic review indicators only. This is not a compatibility certification or security audit.'];
  for (const [name,set] of sets) {
    parts.push(`## ${name}\n- Findings: ${set.summary?.findings || 0}\n- Review items: ${set.summary?.reviewItems || 0}${set.summary?.detectedIntegrations?.length ? `\n- Detected integrations: ${set.summary.detectedIntegrations.join(', ')}` : ''}`);
    for (const f of set.findings || []) {
      parts.push(`### ${f.rule} — ${f.area} [${f.status}]\n${f.message}${f.evidence?.length ? `\n\nEvidence:\n${mdList(f.evidence)}` : ''}`);
    }
    if (set.notes?.length) parts.push(`### Notes\n${mdList(set.notes)}`);
  }
  return parts.join('\n\n') + '\n';
}


function renderRecommendationsGuide(report, recommendations, quality) {
  const name=report.platforms?.wordpress?.plugin?.name||report.platforms?.node?.package?.name||report.rootName;
  const parts=[`# ${name} Recommendations`,`> Generated by deterministic static analysis. Confirm every recommendation against runtime behavior and repository conventions before changing code.`];
  parts.push(`## Summary\n- Recommendations: ${recommendations.items.length}\n- Security review items: ${quality.summary.securityReview}\n- Performance review items: ${quality.summary.performanceReview}`);
  for(const x of recommendations.items) parts.push(`## [${x.priority.toUpperCase()}] ${x.rule} — ${x.area}\n${x.rationale}\n\n### Suggested actions\n${mdList(x.suggestedActions)}${x.evidence?.length?`\n\n### Evidence\n${mdList(x.evidence)}`:''}`);
  parts.push(`## Suggested AI-agent prompt\n\n\`\`\`text\n${recommendations.prompt}\n\`\`\``);
  return parts.join('\n\n')+'\n';
}

export function buildDocumentation(report) {
  const developerGuide = developerGuideModel(report);
  const compatibility = { wordpress: wordpressCompatibility(report), node: nodeCompatibility(report) };
  const quality = securityPerformanceModel(report);
  const recommendations = recommendationsModel(report, compatibility, quality);
  return {
    schemaVersion: '1.4', developerGuide, compatibility, quality, recommendations,
    guides: {
      developerMarkdown: renderDeveloperGuide(report, developerGuide),
      compatibilityMarkdown: renderCompatibilityGuide(report, compatibility),
      recommendationsMarkdown: renderRecommendationsGuide(report, recommendations, quality),
      agentPrompt: recommendations.prompt,
    },
  };
}
