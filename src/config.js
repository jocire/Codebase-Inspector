export const limits = {
  maxUploadBytes: 150 * 1024 * 1024,
  maxExtractedBytes: 750 * 1024 * 1024,
  maxFiles: 30000,
  maxSingleFileBytes: 8 * 1024 * 1024,
  maxDiffFileBytes: 1024 * 1024,
  maxDiffFiles: 500
};

export const ignoredDirs = new Set([
  '.git', '.svn', '.hg', 'node_modules', 'vendor', 'dist', 'build', '.next', '.cache', 'coverage'
]);

export const binaryExtensions = new Set([
  '.png','.jpg','.jpeg','.gif','.webp','.ico','.pdf','.zip','.gz','.tar','.7z','.rar',
  '.mp3','.wav','.ogg','.mp4','.mov','.avi','.woff','.woff2','.ttf','.eot','.exe','.dll','.so','.dylib'
]);
