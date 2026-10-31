import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

export const posix = p => p.split(path.sep).join('/');
export const sha256 = data => crypto.createHash('sha256').update(data).digest('hex');
export async function exists(p){ try { await fs.access(p); return true; } catch { return false; } }
export function safeRelative(root, target){
  const rel = path.relative(root, target);
  if (!rel || rel === '.') return '';
  if (rel.startsWith('..') || path.isAbsolute(rel)) throw new Error('Unsafe path');
  return posix(rel);
}
export function pct(part, total){ return total ? Math.round((part/total)*1000)/10 : 0; }
