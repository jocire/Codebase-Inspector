import fs from 'node:fs/promises';
import path from 'node:path';
import { exists } from './utils.js';

async function readText(file) { try { return await fs.readFile(file, 'utf8'); } catch { return ''; } }
async function readJson(file) { try { return JSON.parse(await fs.readFile(file, 'utf8')); } catch { return null; } }
function unique(values) { return [...new Set(values.filter(Boolean))].sort(); }
function matches(text, regex, pick = 1) { const out = []; for (const m of text.matchAll(regex)) out.push(m[pick]); return unique(out); }
function countMatches(text, regex) { return [...text.matchAll(regex)].length; }
function headerValue(text, name) { const m = text.match(new RegExp(`^[\\s/*#@]*${name}\\s*:\\s*(.+?)\\s*$`, 'mi')); return m?.[1]?.replace(/\*\/$/, '').trim() || null; }
function lineOf(text, index) { return text.slice(0, index).split('\n').length; }
function evidenceFor(text, regex, formatter = (m) => m[0]) {
  const out = [];
  for (const m of text.matchAll(regex)) out.push({ line: lineOf(text, m.index), value: formatter(m) });
  return out.slice(0, 200);
}

function extractBalancedCall(text, start) {
  const open=text.indexOf('(',start); if(open<0)return '';
  let depth=0, quote=null, esc=false;
  for(let i=open;i<text.length;i++){
    const ch=text[i];
    if(quote){ if(esc){esc=false;continue;} if(ch==='\\'){esc=true;continue;} if(ch===quote)quote=null; continue; }
    if(ch==='"'||ch==="'"){quote=ch;continue;}
    if(ch==='(')depth++; else if(ch===')'){depth--; if(depth===0)return text.slice(start,i+1);}
  }
  return text.slice(start,Math.min(text.length,start+5000));
}

function splitTopLevelArgs(callText) {
  const open=callText.indexOf('('); const close=callText.lastIndexOf(')'); if(open<0||close<open)return [];
  const body=callText.slice(open+1,close); const out=[]; let start=0,depth=0,quote=null,esc=false;
  for(let i=0;i<body.length;i++){
    const ch=body[i];
    if(quote){ if(esc){esc=false;continue;} if(ch==='\\'){esc=true;continue;} if(ch===quote)quote=null; continue; }
    if(ch==='"'||ch==="'"){quote=ch;continue;}
    if('([{'.includes(ch))depth++; else if(')]}'.includes(ch))depth=Math.max(0,depth-1); else if(ch===','&&depth===0){out.push(body.slice(start,i).trim());start=i+1;}
  }
  out.push(body.slice(start).trim()); return out;
}
function literalString(expr){ const m=String(expr||'').trim().match(/^['"]([^'"]*)['"]$/s); return m?m[1]:null; }
function translationDomainDetails(text){
  const funcs={__ :1,_e:1,esc_html__:1,esc_html_e:1,esc_attr__:1,esc_attr_e:1,_x:2,_ex:2,_n:3,_nx:4};
  const domains=[], missing=[], dynamic=[]; const re=/\b(__|_e|_x|_ex|_n|_nx|esc_html__|esc_html_e|esc_attr__|esc_attr_e)\s*\(/g;
  for(const m of text.matchAll(re)){
    const call=extractBalancedCall(text,m.index); const args=splitTopLevelArgs(call); const idx=funcs[m[1]];
    if(args.length<=idx){missing.push({function:m[1],line:lineOf(text,m.index)});continue;}
    const value=literalString(args[idx]); if(value!==null)domains.push(value); else dynamic.push({function:m[1],expression:args[idx].slice(0,160),line:lineOf(text,m.index)});
  }
  return {domains:unique(domains),missing:missing.slice(0,200),dynamic:dynamic.slice(0,200)};
}
function staticStringMap(text){
  const map=new Map();
  for(const m of text.matchAll(/\bdefine\s*\(\s*['"]([A-Z0-9_]+)['"]\s*,\s*['"]([^'"]+)['"]\s*\)/g))map.set(m[1],m[2]);
  for(const m of text.matchAll(/\bconst\s+([A-Z0-9_]+)\s*=\s*['"]([^'"]+)['"]/g))map.set(m[1],m[2]);
  for(const m of text.matchAll(/(\$[A-Za-z_][A-Za-z0-9_]*)\s*=\s*['"]([^'"]+)['"]\s*;/g))map.set(m[1],m[2]);
  return map;
}
function resolveSimpleString(expr,map){
  expr=String(expr||'').trim(); const lit=literalString(expr); if(lit!==null)return lit;
  if(map.has(expr))return map.get(expr);
  const scoped=expr.match(/^(?:self|static|[A-Za-z_\\][A-Za-z0-9_\\]*)::([A-Z0-9_]+)$/); if(scoped&&map.has(scoped[1]))return map.get(scoped[1]);
  const parts=expr.split(/\s*\.\s*/); if(parts.length>1){let out='';for(const part of parts){const v=literalString(part)??map.get(part);if(v==null)return null;out+=v;}return out;}
  return null;
}
function blockMetadataDetails(textFiles){
  const out=[];
  for(const f of textFiles.filter(x=>/(^|\/)block\.json$/i.test(x.path))){
    try{const j=JSON.parse(f.text);out.push({name:j.name||null,path:f.path,title:j.title||null,apiVersion:j.apiVersion||null});}catch{out.push({name:null,path:f.path,title:null,apiVersion:null});}
  }
  return out;
}

function restRouteDetails(text){
  const out=[]; const re=/\bregister_rest_route\s*\(/g; const map=staticStringMap(text);
  for(const m of text.matchAll(re)){
    const call=extractBalancedCall(text,m.index); const args=splitTopLevelArgs(call); if(args.length<2)continue;
    const ns=resolveSimpleString(args[0],map), route=resolveSimpleString(args[1],map);
    const display=ns!==null&&route!==null?`${ns}${route}`:`[dynamic route @ line ${lineOf(text,m.index)}]`;
    out.push({route:display,namespace:ns,routePath:route,resolved:ns!==null&&route!==null,permissionCallback:/['"]permission_callback['"]\s*=>/.test(call),permissionPublic:/['"]permission_callback['"]\s*=>\s*['"]__return_true['"]/.test(call),hasArgs:/['"]args['"]\s*=>/.test(call),hasArgType:/['"]type['"]\s*=>/.test(call),hasValidateCallback:/['"]validate_callback['"]\s*=>/.test(call),hasSanitizeCallback:/['"]sanitize_callback['"]\s*=>/.test(call),methods:[...call.matchAll(/['"]methods['"]\s*=>\s*(?:WP_REST_Server::([A-Z_]+)|['"]([^'"]+)['"])/g)].map(x=>x[1]||x[2]),line:lineOf(text,m.index)});
  }
  return out;
}

async function inspectWordPress(root, textFiles) {
  const phpFiles = textFiles.filter((f) => f.ext === '.php');
  const combined = phpFiles.map((f) => f.text).join('\n');
  const rootPhp = phpFiles.filter((f) => !f.path.includes('/'));
  let pluginHeader = null;
  let pluginFile = null;
  for (const f of rootPhp) {
    const name = headerValue(f.text.slice(0, 12000), 'Plugin Name');
    if (name) {
      pluginFile = f.path;
      pluginHeader = {
        name,
        version: headerValue(f.text, 'Version'),
        requiresWordPress: headerValue(f.text, 'Requires at least'),
        requiresPhp: headerValue(f.text, 'Requires PHP'),
        textDomain: headerValue(f.text, 'Text Domain'),
        domainPath: headerValue(f.text, 'Domain Path'),
        network: headerValue(f.text, 'Network'),
        author: headerValue(f.text, 'Author'),
      };
      break;
    }
  }
  const styleCss = await readText(path.join(root, 'style.css'));
  const themeName = headerValue(styleCss.slice(0, 12000), 'Theme Name');
  const themeHeader = themeName ? {
    name: themeName,
    version: headerValue(styleCss, 'Version'),
    template: headerValue(styleCss, 'Template'),
    textDomain: headerValue(styleCss, 'Text Domain'),
    requiresWordPress: headerValue(styleCss, 'Requires at least'),
    requiresPhp: headerValue(styleCss, 'Requires PHP'),
  } : null;

  const callsByFile = [];
  const aggregate = {
    actionsRegistered: [], filtersRegistered: [], actionsFired: [], filtersApplied: [], postTypes: [], taxonomies: [],
    restRoutes: [], shortcodes: [], blocks: [], cronHooks: [], ajaxActions: [], ajaxPrivActions: [], ajaxNoPrivActions: [],
    options: [], siteOptions: [], transients: [], siteTransients: [], cacheGroups: [], metaKeys: [], customFieldKeys: [], scripts: [], styles: [],
    wpCliCommands: [], capabilities: [], textDomains: [], missingTextDomains: [], dynamicTextDomains: [], deprecatedApis: [], builders: [], actionSchedulerHooks: [], cookies: [], blockMetadata: [],
  };

  const deprecatedApiNames = [
    'get_currentuserinfo','wp_get_sites','get_blog_list','get_userdatabylogin','get_user_by_email','wp_get_http','screen_icon',
    'wp_specialchars','attribute_escape','clean_url','get_the_author_email','get_the_author_login','get_the_author_firstname',
    'get_the_author_lastname','get_the_author_description','get_the_author_icq','get_the_author_aim','get_the_author_yim','get_the_author_msn',
    'the_author_email','the_author_login','the_author_firstname','the_author_lastname','the_author_description','the_author_icq','the_author_aim',
    'the_author_yim','the_author_msn','links_popup_script','get_links_withrating','get_linksbyname_withrating','get_autotoggle','get_linksbyname',
    'get_links','wp_setcookie','wp_clearcookie','wp_login','wp_get_cookie_login','wp_loginout','wp_register','get_postdata'
  ];
  const depRe = new RegExp(`\\b(${deprecatedApiNames.join('|')})\\s*\\(`, 'g');

  for (const file of phpFiles) {
    const text = file.text;
    const restDetails = restRouteDetails(text);
    const domainDetails = translationDomainDetails(text);
    const item = {
      path: file.path,
      actionsRegistered: matches(text, /\badd_action\s*\(\s*['"]([^'"]+)['"]/g),
      filtersRegistered: matches(text, /\badd_filter\s*\(\s*['"]([^'"]+)['"]/g),
      actionsFired: matches(text, /\bdo_action(?:_ref_array)?\s*\(\s*['"]([^'"]+)['"]/g),
      filtersApplied: matches(text, /\bapply_filters(?:_ref_array)?\s*\(\s*['"]([^'"]+)['"]/g),
      postTypes: matches(text, /\bregister_post_type\s*\(\s*['"]([^'"]+)['"]/g),
      taxonomies: matches(text, /\bregister_taxonomy\s*\(\s*['"]([^'"]+)['"]/g),
      restRoutes: unique(restDetails.map((x) => x.route)),
      restRouteDetails: restDetails,
      shortcodes: matches(text, /\badd_shortcode\s*\(\s*['"]([^'"]+)['"]/g),
      blocks: unique([
        ...matches(text, /\bregister_block_type\s*\(\s*['"]([^'"]+)['"]/g),
        ...matches(text, /\bregister_block_type_from_metadata\s*\(\s*['"]([^'"]+)['"]/g),
      ]),
      blockRegistrationCalls: countMatches(text, /\bregister_block_type(?:_from_metadata)?\s*\(/g),
      cronHooks: unique([
        ...matches(text, /\bwp_schedule_(?:single_)?event\s*\([^;]*?['"]([^'"]+)['"]\s*\)/g),
        ...matches(text, /\bwp_schedule_event\s*\([^;]*?,\s*['"][^'"]+['"]\s*,\s*['"]([^'"]+)['"]/g),
      ]),
      ajaxActions: matches(text, /\badd_action\s*\(\s*['"]wp_ajax(?:_nopriv)?_([^'"]+)['"]/g),
      ajaxPrivActions: matches(text, /\badd_action\s*\(\s*['"]wp_ajax_([^'"]+)['"]/g),
      ajaxNoPrivActions: matches(text, /\badd_action\s*\(\s*['"]wp_ajax_nopriv_([^'"]+)['"]/g),
      actionSchedulerHooks: matches(text, /\bas_(?:enqueue_async_action|schedule_single_action|schedule_recurring_action)\s*\([^;]*?['"]([^'"]+)['"]/g),
      options: matches(text, /\b(?:get|add|update|delete)_option\s*\(\s*['"]([^'"]+)['"]/g),
      siteOptions: matches(text, /\b(?:get|add|update|delete)_site_option\s*\(\s*['"]([^'"]+)['"]/g),
      transients: matches(text, /\b(?:get|set|delete)_transient\s*\(\s*['"]([^'"]+)['"]/g),
      siteTransients: matches(text, /\b(?:get|set|delete)_site_transient\s*\(\s*['"]([^'"]+)['"]/g),
      cacheGroups: matches(text, /\bwp_cache_(?:get|set|add|replace|delete|incr|decr)\s*\([^,]+,\s*['"]([^'"]+)['"]/g),
      metaKeys: matches(text, /\b(?:get|add|update|delete)_(?:post|user|term|comment)_meta\s*\([^,]+,\s*['"]([^'"]+)['"]/g),
      customFieldKeys: unique([
        ...matches(text, /\b(?:get|add|update|delete)_post_meta\s*\([^,]+,\s*['"]([^'"]+)['"]/g),
        ...matches(text, /\bregister_post_meta\s*\([^,]+,\s*['"]([^'"]+)['"]/g),
        ...matches(text, /\bregister_meta\s*\(\s*['"]post['"]\s*,\s*['"]([^'"]+)['"]/g),
      ]),
      scripts: matches(text, /\bwp_(?:register|enqueue)_script\s*\(\s*['"]([^'"]+)['"]/g),
      styles: matches(text, /\bwp_(?:register|enqueue)_style\s*\(\s*['"]([^'"]+)['"]/g),
      wpCliCommands: matches(text, /\bWP_CLI::add_command\s*\(\s*['"]([^'"]+)['"]/g),
      capabilities: matches(text, /\b(?:current_user_can|user_can)\s*\([^,]*?['"]([^'"]+)['"]/g),
      textDomains: domainDetails.domains,
      missingTextDomains: domainDetails.missing,
      dynamicTextDomains: domainDetails.dynamic,
      deprecatedApis: matches(text, depRe),
      builders: unique([
        /\belementor\//i.test(text) || /\bElementor\\/i.test(text) ? 'Elementor' : null,
        /\bet_builder_|\bET_Builder|\bDivi/i.test(text) ? 'Divi' : null,
        /\bFLBuilder|fl_builder_/i.test(text) ? 'Beaver Builder' : null,
        /\bbricks\//i.test(text) || /\bBricks\\/i.test(text) ? 'Bricks' : null,
        /\boxygen|ct_builder/i.test(text) ? 'Oxygen' : null,
        /\bvc_map\s*\(|\bWPBakery/i.test(text) ? 'WPBakery' : null,
        /\bkadence/i.test(text) ? 'Kadence' : null,
      ]),
      multisite: {
        isMultisite: countMatches(text, /\bis_multisite\s*\(/g),
        switchToBlog: countMatches(text, /\bswitch_to_blog\s*\(/g),
        restoreCurrentBlog: countMatches(text, /\brestore_current_blog\s*\(/g),
        getSites: countMatches(text, /\bget_sites\s*\(/g),
        networkAdmin: countMatches(text, /\bis_network_admin\s*\(/g),
      },
      cron: {
        schedule: countMatches(text, /\bwp_schedule_(?:single_)?event\s*\(/g),
        nextScheduled: countMatches(text, /\bwp_next_scheduled\s*\(/g),
        clearScheduled: countMatches(text, /\bwp_clear_scheduled_hook\s*\(/g),
        unschedule: countMatches(text, /\bwp_unschedule_(?:event|hook)\s*\(/g),
      },
      filesystem: {
        wpFilesystem: countMatches(text, /\bWP_Filesystem\s*\(/g),
        wpFilesystemClasses: countMatches(text, /\bWP_Filesystem_[A-Za-z_]+/g),
        directWrites: countMatches(text, /\b(file_put_contents|fopen|fwrite|unlink|rename|copy|mkdir|rmdir)\s*\(/g),
      },
      i18n: {
        translationCalls: countMatches(text, /\b(?:__|_e|_x|_ex|_n|_nx|esc_html__|esc_html_e|esc_attr__|esc_attr_e)\s*\(/g),
        loadTextdomain: countMatches(text, /\b(?:load_plugin_textdomain|load_theme_textdomain|load_textdomain)\s*\(/g),
      },
      customTables: {
        dbDelta: countMatches(text, /\bdbDelta\s*\(/g),
        createTable: countMatches(text, /\bCREATE\s+TABLE\b/gi),
        wpdbPrefix: countMatches(text, /\$wpdb->(?:prefix|base_prefix)\b/g),
        hardcodedWpPrefix: countMatches(text, /\bwp_[a-z0-9_]+\b/gi),
      },
      wpml: {
        hooks: countMatches(text, /['"]wpml_[^'"]+['"]/g),
        iclFunctions: countMatches(text, /\bicl_[a-z0-9_]+\s*\(/gi),
        iclTables: countMatches(text, /\bicl_(?:translations|strings|string_translations|locale_map|languages)\b/gi),
        sitepressGlobal: countMatches(text, /\$sitepress\b/g),
      },
      acf: {
        fieldApi: countMatches(text, /\b(?:get_field|the_field|update_field|delete_field|have_rows|get_sub_field|update_sub_field|acf_add_local_field_group|acf_add_local_field|get_field_object|get_field_objects)\s*\(/g),
        hooks: countMatches(text, /['"]acf\/(?:load|prepare|update|validate|format|save_post|init)[^'"]*['"]/g),
        localGroups: countMatches(text, /\bacf_add_local_field_group\s*\(/g),
        localFields: countMatches(text, /\bacf_add_local_field\s*\(/g),
        repeater: countMatches(text, /\b(?:have_rows|get_sub_field|update_sub_field)\s*\(/g),
        fieldKeys: unique([...text.matchAll(/['"](field_[A-Za-z0-9_-]+)['"]/g)].map(m=>m[1])).slice(0,200),
      },
      customFields: {
        registerPostMeta: countMatches(text, /\bregister_post_meta\s*\(/g),
        registerMeta: countMatches(text, /\bregister_meta\s*\(/g),
        postMetaReads: countMatches(text, /\bget_post_meta\s*\(/g),
        postMetaWrites: countMatches(text, /\b(?:add|update|delete)_post_meta\s*\(/g),
        showInRest: countMatches(text, /['"]show_in_rest['"]\s*=>\s*(?:true|\[)/g),
        authCallback: countMatches(text, /['"]auth_callback['"]\s*=>/g),
      },
      hooksLifecycle: {
        activation: countMatches(text, /\bregister_activation_hook\s*\(/g),
        deactivation: countMatches(text, /\bregister_deactivation_hook\s*\(/g),
        uninstall: countMatches(text, /\bregister_uninstall_hook\s*\(|WP_UNINSTALL_PLUGIN/g),
        initHooks: countMatches(text, /\badd_(?:action|filter)\s*\(\s*['"](?:plugins_loaded|after_setup_theme|init|wp_loaded|admin_init|rest_api_init)['"]/g),
        lateInit: countMatches(text, /\badd_action\s*\(\s*['"]init['"][^;]*,\s*(?:[2-9]\d|1\d{2,})\s*\)/g),
      },
      nonce: {
        created: unique([...text.matchAll(/\bwp_create_nonce\s*\(\s*['"]([^'"]+)['"]/g)].map(m=>m[1])),
        checked: unique([...text.matchAll(/\b(?:check_ajax_referer|check_admin_referer)\s*\(\s*['"]([^'"]+)['"]/g)].map(m=>m[1])),
        verified: unique([...text.matchAll(/\bwp_verify_nonce\s*\([^,]+,\s*['"]([^'"]+)['"]/g)].map(m=>m[1])),
      },
      actionScheduler: {
        enqueueAsync: countMatches(text, /\bas_enqueue_async_action\s*\(/g),
        scheduleSingle: countMatches(text, /\bas_schedule_single_action\s*\(/g),
        scheduleRecurring: countMatches(text, /\bas_schedule_recurring_action\s*\(/g),
        unschedule: countMatches(text, /\bas_unschedule_(?:action|all_actions)\s*\(/g),
        nextScheduled: countMatches(text, /\bas_next_scheduled_action\s*\(/g),
      },
      optionsBehavior: {
        addAutoloadYes: countMatches(text, /\badd_option\s*\([^;]{0,500}?,\s*['"](?:yes|on|auto-on|auto)['"]\s*\)/gi),
        addAutoloadNo: countMatches(text, /\badd_option\s*\([^;]{0,500}?,\s*['"](?:no|off|auto-off)['"]\s*\)/gi),
        updateOption: countMatches(text, /\bupdate_option\s*\(/g),
        allOptions: countMatches(text, /\bwp_load_alloptions\s*\(/g),
      },
      cacheBehavior: {
        get: countMatches(text, /\bwp_cache_get\s*\(/g), set: countMatches(text, /\bwp_cache_(?:set|add|replace)\s*\(/g),
        delete: countMatches(text, /\bwp_cache_delete\s*\(/g), flush: countMatches(text, /\bwp_cache_flush(?:_group)?\s*\(/g),
        cleanPost: countMatches(text, /\bclean_post_cache\s*\(/g),
      },
      buildersDetail: {
        elementorHooks: countMatches(text, /['"]elementor\/[^'"]+['"]/g),
        elementorWidgets: countMatches(text, /\bWidget_Base\b|register_widget\s*\(/g),
        diviModules: countMatches(text, /\bET_Builder_Module\b|et_builder_ready|et_pb_/g),
        blockMetadata: countMatches(text, /\bregister_block_type_from_metadata\s*\(/g),
      },
      multilingual: {
        wpmlObjectId: countMatches(text, /['"]wpml_object_id['"]|\bwpml_object_id\b/g),
        wpmlElementType: countMatches(text, /['"]wpml_element_type['"]/g),
        wpmlLanguages: countMatches(text, /['"]wpml_(?:active_languages|current_language|default_language|language_is_active)['"]/g),
        polyglotHooks: countMatches(text, /['"]polyglot_[^'"]+['"]/g),
        languageGlobals: countMatches(text, /\bICL_LANGUAGE_CODE\b|\$sitepress\b/g),
      },
      cookies: {
        reads: unique([...text.matchAll(/\$_COOKIE\s*\[\s*['"]([^'"]+)['"]\s*\]/g)].map(m=>m[1])),
        writes: unique([...text.matchAll(/\$_COOKIE\s*\[\s*['"]([^'"]+)['"]\s*\]\s*=/g)].map(m=>m[1])),
        setcookie: unique([...text.matchAll(/\bsetcookie\s*\(\s*['"]([^'"]+)['"]/g)].map(m=>m[1])),
        wpSetAuthCookie: countMatches(text, /\bwp_set_auth_cookie\s*\(/g),
        wpClearAuthCookie: countMatches(text, /\bwp_clear_auth_cookie\s*\(/g),
        rawCookieReads: countMatches(text, /\$_COOKIE\b/g),
      },
      security: {
        dangerousExec: countMatches(text, /\b(?:exec|shell_exec|system|passthru|proc_open|popen)\s*\(/g),
        unserialize: countMatches(text, /\bunserialize\s*\(/g),
        remoteSslDisabled: countMatches(text, /['"]sslverify['"]\s*=>\s*false/g),
        fileUploads: countMatches(text, /\$_FILES\b/g),
      },
      performance: {
        unboundedPosts: countMatches(text, /['"](?:posts_per_page|numberposts)['"]\s*=>\s*-1|['"]nopaging['"]\s*=>\s*true/g),
        queries: countMatches(text, /\bnew\s+WP_Query\s*\(|\bget_posts\s*\(|\bget_terms\s*\(|\bget_users\s*\(/g),
        remoteCalls: countMatches(text, /\bwp_remote_(?:get|post|request)\s*\(/g),
        optionReads: countMatches(text, /\bget_option\s*\(/g),
        metaReads: countMatches(text, /\bget_(?:post|user|term|comment)_meta\s*\(/g),
      },
      woo: {
        crud: countMatches(text, /\b(?:wc_get_order|wc_get_orders|wc_get_product|wc_get_products|wc_create_order|wc_get_customer_order_count)\s*\(/g),
        orderClasses: countMatches(text, /\bWC_Order(?:_Query)?\b|Automattic\\WooCommerce\\Internal\\DataStores\\Orders/g),
        hposUtil: countMatches(text, /\bOrderUtil\b|custom_orders_table_usage_is_enabled|woocommerce_custom_orders_table_enabled/g),
        legacyOrderPostType: countMatches(text, /['"]shop_order['"]|\bshop_order\b/g),
      },
      evidence: {
        directFilesystem: evidenceFor(text, /\b(file_put_contents|fopen|fwrite|unlink|rename|copy|mkdir|rmdir)\s*\(/g, (m) => m[1]),
        deprecatedApis: evidenceFor(text, depRe, (m) => m[1]),
      },
    };
    const count = Object.entries(item).filter(([k,v]) => k !== 'path' && Array.isArray(v)).reduce((sum, [, v]) => sum + v.length, 0);
    const objectActivity = ['multisite','cron','filesystem','i18n','customTables','wpml','acf','customFields','hooksLifecycle','actionScheduler','optionsBehavior','cacheBehavior','buildersDetail','multilingual','cookies','security','performance','woo'].some((k) => Object.values(item[k] || {}).some((v) => typeof v === 'number' && v > 0));
    if (count || restDetails.length || objectActivity) callsByFile.push(item);
    for (const key of Object.keys(aggregate)) if (Array.isArray(item[key])) aggregate[key].push(...item[key]);
  }
  for (const key of Object.keys(aggregate)) aggregate[key] = unique(aggregate[key]);

  const composer = await readJson(path.join(root, 'composer.json'));
  const isWordPress = Boolean(pluginHeader || themeHeader || /\b(add_action|add_filter|register_post_type|wp_enqueue_script)\s*\(/.test(combined));
  if (!isWordPress) return null;
  const metadataBlocks=blockMetadataDetails(textFiles);
  aggregate.blockMetadata=metadataBlocks;
  aggregate.blocks=unique([...aggregate.blocks,...metadataBlocks.map(x=>x.name)]);
  aggregate.cookies=unique(callsByFile.flatMap(f=>[...(f.cookies?.reads||[]),...(f.cookies?.writes||[]),...(f.cookies?.setcookie||[])]));
  aggregate.missingTextDomains=callsByFile.flatMap(f=>(f.missingTextDomains||[]).map(x=>({...x,file:f.path}))).slice(0,1000);
  aggregate.dynamicTextDomains=callsByFile.flatMap(f=>(f.dynamicTextDomains||[]).map(x=>({...x,file:f.path}))).slice(0,1000);
  const profileName = (pluginHeader?.name || themeHeader?.name || '').toLowerCase();
  return {
    type: pluginHeader ? 'plugin' : themeHeader ? 'theme' : 'wordpress-codebase',
    pluginFile,
    plugin: pluginHeader,
    theme: themeHeader,
    composer: composer ? { name: composer.name || null, type: composer.type || null, autoload: composer.autoload || null, autoloadDev: composer['autoload-dev'] || null } : null,
    integrations: aggregate,
    integrationsByFile: callsByFile.slice(0, 5000),
    indicators: {
      woocommerce: /\b(WooCommerce|WC_|woocommerce_)/i.test(combined),
      wpml: /\b(wpml_|icl_|SitePress|WPML)/.test(combined),
      acf: /\b(acf_|get_field\s*\(|the_field\s*\()/i.test(combined),
      multisite: /\b(is_multisite|get_sites|switch_to_blog|restore_current_blog|is_network_admin)\s*\(/.test(combined),
      filesystemApi: /\bWP_Filesystem\s*\(/.test(combined),
      directFilesystem: /\b(file_put_contents|fopen|fwrite|unlink|rename|copy|mkdir|rmdir)\s*\(/.test(combined),
      objectCache: /\bwp_cache_(?:get|set|add|replace|delete|incr|decr)\s*\(/.test(combined),
      transients: /\b(?:get|set|delete)_(?:site_)?transient\s*\(/.test(combined),
      cron: /\bwp_(?:schedule|next_scheduled|clear_scheduled|unschedule)/.test(combined),
      i18n: /\b(?:__|_e|_x|_n|load_plugin_textdomain|load_theme_textdomain)\s*\(/.test(combined),
      customTables: /\bdbDelta\s*\(|\bCREATE\s+TABLE\b/i.test(combined),
      gutenbergBlocks: aggregate.blocks.length > 0 || textFiles.some((f) => f.path.endsWith('block.json')),
      restApi: aggregate.restRoutes.length > 0,
      wpCli: aggregate.wpCliCommands.length > 0,
      builders: aggregate.builders.length > 0,
      actionScheduler: /\bas_(?:enqueue_async_action|schedule_single_action|schedule_recurring_action)\s*\(/.test(combined),
      customFields: /\b(?:register_post_meta|get_post_meta|update_post_meta|acf_add_local_field_group|get_field)\s*\(/.test(combined),
      siteEditor: textFiles.some((f)=>/theme\.json$|block\.json$/i.test(f.path)) || /\bregister_block_type(?:_from_metadata)?\s*\(/.test(combined),
    },
    compatibilityProfile: profileName.includes('polyglot') ? 'polyglot' : null,
  };
}

async function inspectNode(root, textFiles) {
  const pkgPath = path.join(root, 'package.json');
  if (!(await exists(pkgPath))) return null;
  const pkg = await readJson(pkgPath); if (!pkg) return null;
  const jsFiles = textFiles.filter((f) => ['.js','.jsx','.mjs','.cjs','.ts','.tsx'].includes(f.ext));
  const imports = new Set(), envVars = new Set(), routes = [];
  for (const file of jsFiles) {
    for (const m of file.text.matchAll(/\b(?:from\s+|require\s*\(\s*|import\s*\(\s*)['"]([^'"./][^'"]*)['"]/g)) imports.add(m[1].startsWith('@') ? m[1].split('/').slice(0,2).join('/') : m[1].split('/')[0]);
    for (const m of file.text.matchAll(/\bprocess\.env\.([A-Z0-9_]+)/g)) envVars.add(m[1]);
    for (const m of file.text.matchAll(/\b(?:app|router)\.(get|post|put|patch|delete|use)\s*\(\s*['"]([^'"]+)['"]/gi)) routes.push({file:file.path,method:m[1].toUpperCase(),route:m[2]});
  }
  const allDeps = {...(pkg.dependencies || {}), ...(pkg.devDependencies || {}), ...(pkg.peerDependencies || {})};
  const frameworks = [];
  for (const [dep, label] of Object.entries({express:'Express',fastify:'Fastify','@nestjs/core':'NestJS',next:'Next.js',react:'React',vue:'Vue',svelte:'Svelte',vite:'Vite',webpack:'Webpack',typescript:'TypeScript',jest:'Jest',vitest:'Vitest',mocha:'Mocha',playwright:'Playwright','@playwright/test':'Playwright',electron:'Electron'})) if (allDeps[dep]) frameworks.push(label);
  return {
    package: { name:pkg.name||null, version:pkg.version||null, description:pkg.description||null, private:Boolean(pkg.private), type:pkg.type||'commonjs/default', main:pkg.main||null, module:pkg.module||null, bin:pkg.bin||null, engines:pkg.engines||null, packageManager:pkg.packageManager||null, workspaces:pkg.workspaces||null },
    scripts: pkg.scripts || {}, frameworks: unique(frameworks), externalImports: unique([...imports]), environmentVariables: unique([...envVars]), routes: routes.slice(0,3000),
    indicators: { hasLockfile:['package-lock.json','npm-shrinkwrap.json','yarn.lock','pnpm-lock.yaml'].some((name)=>textFiles.some((f)=>f.path===name)), typescript:Boolean(allDeps.typescript || textFiles.some((f)=>['.ts','.tsx'].includes(f.ext))), tests:textFiles.filter((f)=>/(^|\/)(test|tests|__tests__)\/|\.(test|spec)\.[^.]+$/i.test(f.path)).length },
  };
}

export async function inspectPlatforms(root, textFiles) {
  const [wordpress, node] = await Promise.all([inspectWordPress(root,textFiles), inspectNode(root,textFiles)]);
  const detected=[]; if(wordpress)detected.push(`WordPress ${wordpress.type}`); if(node)detected.push('Node.js');
  return { detected, wordpress, node };
}
