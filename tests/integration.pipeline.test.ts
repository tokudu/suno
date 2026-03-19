import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { parse } from 'csv-parse/sync';
import { runPipeline } from '../scripts/process';


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
    const curatedEntries = presentRows.slice(0, 2).map((row) => ({
      id: (row.ID || '').toLowerCase(),
      name: row.Title || '',
    }));

    await fs.writeFile(path.join(fixtureDir, 'tracks-list.csv'), toCsv(subset, headers), 'utf8');
    await fs.writeFile(path.join(fixtureDir, 'da-final-drop.json'), `${JSON.stringify(curatedEntries, null, 2)}\n`, 'utf8');

    previousCwd = process.cwd();
    process.chdir(testsRoot);
    process.env.EXPORT_DIR = path.join(testsRoot, 'data', 'traktor');
    await fs.rm(path.join(testsRoot, 'data', 'library.json'), { force: true });
    await fs.rm(path.join(testsRoot, 'data', 'missing-tracks.txt'), { force: true });
    await runPipeline({ exportType: 'music' });

    const libRaw = await fs.readFile(path.join(testsRoot, 'data', 'library.json'), 'utf8');
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

  it('creates traktor export folders, copied tracks, and playlists', async () => {
    const traktorTracks = path.join(testsRoot, 'data', 'traktor', 'Tracks');
    const traktorPlaylists = path.join(testsRoot, 'data', 'traktor', 'Playlists');

    const trackFiles = await fs.readdir(traktorTracks);
    const playlistFiles = await fs.readdir(traktorPlaylists);

    expect(trackFiles.length).toBeGreaterThan(0);
    expect(playlistFiles.some((f) => f.endsWith('.m3u8'))).toBe(true);

    const firstTrack = path.join(traktorTracks, trackFiles[0]);
    const stat = await fs.lstat(firstTrack);
    expect(stat.isSymbolicLink()).toBe(false);
  });

  it('does not overwrite existing exported mp3 files on subsequent exports', async () => {
    const traktorTracks = path.join(testsRoot, 'data', 'traktor', 'Tracks');
    const trackFiles = (await fs.readdir(traktorTracks)).filter((f) => f.endsWith('.mp3'));
    expect(trackFiles.length).toBeGreaterThan(0);

    const firstTrack = path.join(traktorTracks, trackFiles[0]);
    const originalBytes = await fs.readFile(firstTrack);
    await fs.writeFile(firstTrack, Buffer.from('LOCKED_EXPORT_TEST_CONTENT'));
    const lockedStat = await fs.stat(firstTrack);

    await runPipeline({ exportType: 'music' });

    const afterBytes = await fs.readFile(firstTrack);
    const afterStat = await fs.stat(firstTrack);
    expect(afterBytes.toString('utf8')).toBe('LOCKED_EXPORT_TEST_CONTENT');
    expect(afterStat.mtimeMs).toBe(lockedStat.mtimeMs);

    await fs.writeFile(firstTrack, originalBytes);
  }, 15 * 60 * 1000);

  it('writes missing-tracks.txt with expected header', async () => {
    const missing = path.join(testsRoot, 'data', 'missing-tracks.txt');
    const content = await fs.readFile(missing, 'utf8');
    expect(content.startsWith('trackId,mp3Found,wavFound,txtFound')).toBe(true);
  });

  it('includes curated playlist loaded from data/da-final-drop.json', () => {
    const curated = library.playlists.find((p) => p.name === 'DJ Sets - Da Final Drop');
    expect(curated).toBeTruthy();
    expect(Array.isArray(curated?.trackIds)).toBe(true);
    expect((curated?.trackIds || []).length).toBeGreaterThan(0);
  });

  it('prefers Traktor tags over existing bpm/key values and rewrites library.json on rerun', async () => {
    const traktorTracks = path.join(testsRoot, 'data', 'traktor', 'Tracks');
    const trackFiles = (await fs.readdir(traktorTracks)).filter((f) => f.endsWith('.mp3'));
    expect(trackFiles.length).toBeGreaterThan(0);

    const firstTrack = trackFiles[0];
    const firstTrackAbs = path.join(traktorTracks, firstTrack);

    const synchsafe = (size: number): Buffer => Buffer.from([
      (size >> 21) & 0x7f,
      (size >> 14) & 0x7f,
      (size >> 7) & 0x7f,
      size & 0x7f,
    ]);
    const textFrame = (id: string, value: string): Buffer => {
      const text = Buffer.from(value, 'utf8');
      const body = Buffer.concat([Buffer.from([0x03]), text]);
      const frameHeader = Buffer.alloc(10);
      frameHeader.write(id, 0, 4, 'ascii');
      frameHeader.writeUInt32BE(body.length, 4);
      return Buffer.concat([frameHeader, body]);
    };

    const body = Buffer.concat([textFrame('TBPM', '133'), textFrame('TKEY', '4m')]);
    const id3Header = Buffer.alloc(10);
    id3Header.write('ID3', 0, 3, 'ascii');
    id3Header[3] = 3;
    id3Header[4] = 0;
    id3Header[5] = 0;
    synchsafe(body.length).copy(id3Header, 6);
    await fs.writeFile(firstTrackAbs, Buffer.concat([id3Header, body, Buffer.from([0xff, 0xfb, 0x90, 0x64])]));

    const libPath = path.join(testsRoot, 'data', 'library.json');
    const beforeRaw = await fs.readFile(libPath, 'utf8');
    const beforeLib = JSON.parse(beforeRaw) as { tracks: Array<Record<string, unknown>> };
    beforeLib.tracks = beforeLib.tracks.map((t) => ({ ...t, traktorPath: null }));
    await fs.writeFile(libPath, `${JSON.stringify(beforeLib, null, 2)}\n`, 'utf8');

    const beforeStat = await fs.stat(libPath);
    await new Promise((resolve) => setTimeout(resolve, 20));

    await runPipeline({ exportType: 'music' });

    const afterStat = await fs.stat(libPath);
    expect(afterStat.mtimeMs).toBeGreaterThan(beforeStat.mtimeMs);

    const libRaw = await fs.readFile(libPath, 'utf8');
    const updated = JSON.parse(libRaw) as { tracks: Array<Record<string, unknown>> };
    const rel = path.relative(testsRoot, firstTrackAbs);
    const taggedTrack = updated.tracks.find((t) => t.traktorPath === rel);
    expect(taggedTrack).toBeTruthy();
    expect(taggedTrack?.bpm).toBe(133);
    expect(taggedTrack?.bpmSource).toBe('traktor');
    expect(taggedTrack?.musicalKey).toBe('F# Minor');
    expect(taggedTrack?.keySource).toBe('traktor');
  }, 15 * 60 * 1000);
});
