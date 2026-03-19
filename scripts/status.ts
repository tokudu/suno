import { promises as fs } from 'node:fs';
import path from 'node:path';
import { S3Client, ListObjectsV2Command } from '@aws-sdk/client-s3';
import chalk from 'chalk';

const BUCKET = 'suno-audio';
const DATA_DIR = 'data';
const ALLOWED_EXTENSIONS = new Set(['.mp3', '.txt', '.jpeg', '.webp', '.json', '.csv']);

function isAllowedFile(file: string): boolean {
  return ALLOWED_EXTENSIONS.has(path.extname(file).toLowerCase());
}

function getS3Client(): S3Client {
  const endpoint = process.env.R2_BASE_URL;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  if (!endpoint || !accessKeyId || !secretAccessKey) {
    throw new Error(
      'Missing R2 credentials. Set R2_BASE_URL, R2_ACCESS_KEY_ID, and R2_SECRET_ACCESS_KEY in .env.encrypted',
    );
  }
  return new S3Client({
    region: 'auto',
    endpoint,
    credentials: { accessKeyId, secretAccessKey },
  });
}

async function listRemoteKeys(s3: S3Client): Promise<Map<string, number>> {
  const keys = new Map<string, number>();
  let continuationToken: string | undefined;
  do {
    const res = await s3.send(
      new ListObjectsV2Command({
        Bucket: BUCKET,
        ContinuationToken: continuationToken,
        MaxKeys: 100,
      }),
    );
    for (const obj of res.Contents ?? []) {
      if (obj.Key && obj.Size != null && isAllowedFile(obj.Key)) {
        keys.set(obj.Key, obj.Size);
      }
    }
    continuationToken = res.IsTruncated ? res.NextContinuationToken : undefined;
  } while (continuationToken);
  return keys;
}

async function listLocalFiles(): Promise<Map<string, number>> {
  const files = new Map<string, number>();
  const entries = await fs.readdir(DATA_DIR);
  for (const entry of entries) {
    if (!isAllowedFile(entry)) continue;
    const filePath = path.join(DATA_DIR, entry);
    const stat = await fs.stat(filePath);
    if (stat.isFile()) {
      files.set(entry, stat.size);
    }
  }
  return files;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

async function main() {
  const s3 = getS3Client();
  await fs.mkdir(DATA_DIR, { recursive: true });

  console.log(chalk.bold.cyan('\n=== Sync Status ==='));
  const [localFiles, remoteKeys] = await Promise.all([listLocalFiles(), listRemoteKeys(s3)]);
  console.log(chalk.cyan(`  Local: ${localFiles.size} files, Remote: ${remoteKeys.size} files\n`));

  // Files that need uploading (local only or size mismatch)
  const toUpload = [...localFiles.entries()].filter(([key, size]) => {
    const remoteSize = remoteKeys.get(key);
    return remoteSize === undefined || remoteSize !== size;
  });

  // Files that need downloading (remote only or size mismatch)
  const toDownload = [...remoteKeys.entries()].filter(([key, size]) => {
    const localSize = localFiles.get(key);
    return localSize === undefined || localSize !== size;
  });

  const inSync = [...localFiles.keys()].filter((key) => remoteKeys.get(key) === localFiles.get(key));

  // Upload summary
  if (toUpload.length === 0) {
    console.log(chalk.green('  Upload:   nothing to upload'));
  } else {
    const totalSize = toUpload.reduce((sum, [, size]) => sum + size, 0);
    console.log(chalk.yellow(`  Upload:   ${toUpload.length} files (${formatSize(totalSize)})`));
    for (const [key, size] of toUpload) {
      const reason = remoteKeys.has(key) ? 'size mismatch' : 'missing remote';
      console.log(chalk.dim(`            ${key} (${formatSize(size)}) — ${reason}`));
    }
  }

  // Download summary
  if (toDownload.length === 0) {
    console.log(chalk.green('  Download: nothing to download'));
  } else {
    const totalSize = toDownload.reduce((sum, [, size]) => sum + size, 0);
    console.log(chalk.yellow(`  Download: ${toDownload.length} files (${formatSize(totalSize)})`));
    for (const [key, size] of toDownload) {
      const reason = localFiles.has(key) ? 'size mismatch' : 'missing local';
      console.log(chalk.dim(`            ${key} (${formatSize(size)}) — ${reason}`));
    }
  }

  console.log(chalk.green(`\n  In sync:  ${inSync.length} files`));
  console.log();
}

main().catch((err) => {
  console.error(chalk.red(`Status check failed: ${err instanceof Error ? err.message : String(err)}`));
  process.exit(1);
});
