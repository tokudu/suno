import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createReadStream } from 'node:fs';
import {
  S3Client,
  ListObjectsV2Command,
  PutObjectCommand,
} from '@aws-sdk/client-s3';
import cliProgress from 'cli-progress';
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

function contentType(file: string): string {
  const ext = path.extname(file).toLowerCase();
  const types: Record<string, string> = {
    '.mp3': 'audio/mpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.json': 'application/json',
    '.txt': 'text/plain',
    '.csv': 'text/csv',
  };
  return types[ext] ?? 'application/octet-stream';
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

async function upload(s3: S3Client, localFiles: Map<string, number>, remoteKeys: Map<string, number>, force: boolean) {
  const toUpload = [...localFiles.entries()].filter(([key, size]) => {
    if (force) return true;
    const remoteSize = remoteKeys.get(key);
    return remoteSize === undefined || remoteSize !== size;
  });

  if (toUpload.length === 0) {
    console.log(chalk.green('  Nothing to upload — remote is up to date.'));
    return;
  }

  console.log(chalk.cyan(`  ${toUpload.length} files to upload (${localFiles.size - toUpload.length} already in sync)`));
  const bar = new cliProgress.SingleBar({
    format: `${chalk.yellow('Upload'.padEnd(11))} [{bar}] {percentage}% | {value}/{total} | {file}`,
    hideCursor: true,
  }, cliProgress.Presets.shades_classic);
  bar.start(toUpload.length, 0, { file: '' });

  let uploaded = 0;
  let failed = 0;

  for (const [key] of toUpload) {
    bar.update({ file: key });
    try {
      const localPath = path.join(DATA_DIR, key);
      await s3.send(
        new PutObjectCommand({
          Bucket: BUCKET,
          Key: key,
          Body: createReadStream(localPath),
          ContentType: contentType(key),
        }),
      );
      uploaded++;
    } catch {
      failed++;
    }
    bar.increment();
  }
  bar.stop();
  console.log(chalk.green(`  Uploaded: ${uploaded}`));
  if (failed > 0) console.log(chalk.red(`  Failed:   ${failed}`));
}

async function main() {
  const args = process.argv.slice(2);
  const force = args.includes('--force');

  const s3 = getS3Client();
  await fs.mkdir(DATA_DIR, { recursive: true });

  console.log(chalk.bold.cyan('\n=== Upload ==='));
  const [localFiles, remoteKeys] = await Promise.all([listLocalFiles(), listRemoteKeys(s3)]);
  console.log(chalk.cyan(`  Local: ${localFiles.size} files, Remote: ${remoteKeys.size} files`));
  await upload(s3, localFiles, remoteKeys, force);
}

main().catch((err) => {
  console.error(chalk.red(`Upload failed: ${err instanceof Error ? err.message : String(err)}`));
  process.exit(1);
});
