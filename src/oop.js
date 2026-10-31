const languageByExt = {
  '.php':'PHP','.js':'JavaScript','.mjs':'JavaScript','.cjs':'JavaScript','.ts':'TypeScript','.tsx':'TypeScript',
  '.java':'Java','.cs':'C#','.py':'Python','.rb':'Ruby','.cpp':'C++','.cc':'C++','.hpp':'C++','.h':'C/C++'
};

export function inspectOop(ext, text){
  const language = languageByExt[ext];
  if (!language) return { language:null, classes:[], methods:[] };
  const classes=[], methods=[];
  const classRegexes = [
    /\b(?:abstract\s+|final\s+)?class\s+([A-Za-z_$][\w$]*)/g,
    /\binterface\s+([A-Za-z_$][\w$]*)/g,
    /\btrait\s+([A-Za-z_$][\w$]*)/g,
    /^\s*class\s+([A-Za-z_]\w*)\s*[:(]/gm
  ];
  for(const re of classRegexes) for(const m of text.matchAll(re)) classes.push(m[1]);
  const methodRegexes = [
    /\b(?:public|protected|private|static|async|final|abstract|virtual|override|synchronized|native|\s)+\s*(?:function\s+)?([A-Za-z_$][\w$]*)\s*\([^;{}]*\)\s*(?:\{|=>)/g,
    /^\s*(?:async\s+)?def\s+([A-Za-z_]\w*)\s*\(/gm,
    /^\s*def\s+([A-Za-z_]\w*[!?=]?)\s*(?:\(|$)/gm
  ];
  for(const re of methodRegexes) for(const m of text.matchAll(re)) if(!['if','for','while','switch','catch','function'].includes(m[1])) methods.push(m[1]);
  return { language, classes:[...new Set(classes)], methods:[...new Set(methods)] };
}
