import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import yauzl from 'yauzl';
import { limits } from './config.js';

export function extractZip(zipPath, dest){
  return new Promise((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true }, (err, zip) => {
      if (err) return reject(err);
      let files = 0, bytes = 0;
      const fail = e => { try { zip.close(); } catch {} reject(e); };
      zip.readEntry();
      zip.on('entry', entry => {
        const raw = entry.fileName.replace(/\\/g, '/');
        if (raw.includes('\0') || raw.startsWith('/') || raw.split('/').includes('..')) return fail(new Error(`Unsafe ZIP entry: ${raw}`));
        if (/\/$/.test(raw)) { fsp.mkdir(path.join(dest, raw), { recursive:true }).then(()=>zip.readEntry(), fail); return; }
        if (++files > limits.maxFiles) return fail(new Error('ZIP contains too many files'));
        bytes += entry.uncompressedSize;
        if (bytes > limits.maxExtractedBytes) return fail(new Error('ZIP expands beyond allowed size'));
        if (entry.uncompressedSize > limits.maxSingleFileBytes * 8) return fail(new Error(`Oversized archive entry: ${raw}`));
        const out = path.resolve(dest, raw);
        if (!out.startsWith(path.resolve(dest) + path.sep)) return fail(new Error('ZIP path traversal blocked'));
        fsp.mkdir(path.dirname(out), { recursive:true }).then(() => {
          zip.openReadStream(entry, (e, rs) => {
            if (e) return fail(e);
            const ws = fs.createWriteStream(out, { flags:'wx' });
            rs.on('error', fail); ws.on('error', fail);
            ws.on('finish', () => zip.readEntry());
            rs.pipe(ws);
          });
        }, fail);
      });
      zip.on('end', () => resolve({ files, bytes }));
      zip.on('error', reject);
    });
  });
}
