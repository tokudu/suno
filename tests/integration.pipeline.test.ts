import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { parse } from 'csv-parse/sync';
import { runPipeline } from '../process';


function extractIdFromFileName(fileName: string): string | null {
  const m = fileName.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  return m ? m[0].toLowerCase() : null;
}

function toCsv(rows: Record<string, string>[], headers: string[]): string {
  const escape = (value: string): string => {
    if (/[",\n\r]/.test(value)) {
      return `"${value.replace(/"/g, '""')}"`;
    }
    return value;
  };

  const lines = [headers.join(',')];
  for (const row of rows) {
    lines.push(headers.map((h) => escape(row[h] ?? '')).join(','));
  }
  return `${lines.join('\n')}\n`;
}

describe.sequential('integration pipeline', () => {
  let testsRoot = '';
  let previousCwd = '';
  let library: { tracks: any[]; playlists: any[] };

  beforeAll(async () => {
    const repoRoot = path.resolve(__dirname, '..');
    testsRoot = path.join(repoRoot, 'tests');
    const fixtureDir = path.join(testsRoot, 'data');
    const docsDir = path.join(testsRoot, 'docs');

    await fs.mkdir(docsDir, { recursive: true });
    await fs.copyFile(path.join(repoRoot, 'docs', 'library.md'), path.join(docsDir, 'library.md'));

    const csvRaw = await fs.readFile(path.join(fixtureDir, 'tracks-list.csv'), 'utf8');
    const parsed = parse(csvRaw, { columns: true, skip_empty_lines: true }) as Record<string, string>[];
    const headers = ['ID', 'Title', 'Workspace', 'Workspace ID', 'Audio URL', 'Status', 'Created At', 'Duration', 'Type', 'Is Stem'];

    const fixtureFiles = await fs.readdir(fixtureDir);
    const copiedWavs = fixtureFiles.filter((f) => f.endsWith('.wav'));
    const copiedIds = new Set(copiedWavs.map((f) => extractIdFromFileName(f)).filter(Boolean) as string[]);

    const presentRows = parsed.filter((row) => copiedIds.has((row.ID || '').toLowerCase()));
    const missingRows = parsed.filter((row) => !copiedIds.has((row.ID || '').toLowerCase())).slice(0, 3);
    const subset = [...presentRows.slice(0, 10), ...missingRows];

    await fs.writeFile(path.join(fixtureDir, 'tracks-list.csv'), toCsv(subset, headers), 'utf8');

    previousCwd = process.cwd();
    process.chdir(testsRoot);
    await runPipeline({ clean: true });

    const libRaw = await fs.readFile(path.join(testsRoot, 'build', 'library.json'), 'utf8');
    library = JSON.parse(libRaw);
  }, 15 * 60 * 1000);

  afterAll(async () => {
    if (previousCwd) {
      process.chdir(previousCwd);
    }
  });

  it('writes library.json with expected top-level schema', () => {
    expect(Array.isArray(library.tracks)).toBe(true);
    expect(Array.isArray(library.playlists)).toBe(true);
    expect(library.tracks.length).toBeGreaterThan(0);
    expect(library.playlists.length).toBeGreaterThan(0);
    expect(library.tracks.every((t) => typeof t?.path === 'string' && t.path.length > 0)).toBe(true);
    expect(library.playlists.every((p) => typeof p?.path === 'string' && p.path.length > 0)).toBe(true);
    expect(library.tracks.every((t) => t?.hasWav === true && t?.hasTxt === true && t?.hasMp3 === true)).toBe(true);
  });

  it('ensures canonical mp3 naming for tracks with wav paths', () => {
    const wavTracks = library.tracks.filter((t) => typeof t?.wavPath === 'string');
    expect(wavTracks.length).toBeGreaterThan(0);

    for (const track of wavTracks) {
      const wav = track.wavPath as string;
      const mp3 = track.mp3Path as string | null;
      expect(mp3).toBe(wav.replace(/\.wav$/i, '.mp3'));
    }
  });

  it('persists process/analyze/export checkpoints and categories', () => {
    for (const track of library.tracks) {
      expect(typeof track?.processedAt).toBe('string');
      expect(typeof track?.analyzedAt).toBe('string');
      expect(Array.isArray(track?.categories)).toBe(true);
      expect(track?.isStem).not.toBe(true);
    }
  });

  it('includes optional metadata for at least one track and allows missing on others', () => {
    const withMetadata = library.tracks.filter((t) => t.metadata && typeof t.metadata === 'object');

    expect(withMetadata.length).toBeGreaterThan(0);
  });

  it('creates traktor export folders, copied tracks, playlists, html report, and zip bundle', async () => {
    const traktorTracks = path.join(testsRoot, 'build', 'traktor', 'Tracks');
    const traktorPlaylists = path.join(testsRoot, 'build', 'traktor', 'Playlists');
    const report = path.join(testsRoot, 'build', 'library.html');
    const zipBundle = path.join(testsRoot, 'build', 'library.zip');

    const trackFiles = await fs.readdir(traktorTracks);
    const playlistFiles = await fs.readdir(traktorPlaylists);

    expect(trackFiles.length).toBeGreaterThan(0);
    expect(playlistFiles.some((f) => f.endsWith('.m3u8'))).toBe(true);

    const reportContent = await fs.readFile(report, 'utf8');
    expect(reportContent).toContain('TOKUDU Library Report');
    expect(reportContent).toContain('Hide private tracks');
    expect(reportContent).not.toContain('Hide missing tracks');

    const firstTrack = path.join(traktorTracks, trackFiles[0]);
    const stat = await fs.lstat(firstTrack);
    expect(stat.isSymbolicLink()).toBe(false);

    const zipStat = await fs.stat(zipBundle);
    expect(zipStat.size).toBeGreaterThan(0);
  });

  it('writes missing-tracks.txt with expected header', async () => {
    const missing = path.join(testsRoot, 'build', 'missing-tracks.txt');
    const content = await fs.readFile(missing, 'utf8');
    expect(content.startsWith('trackId,mp3Found,wavFound,txtFound')).toBe(true);
  });
});
