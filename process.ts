import { promises as fs } from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { parse } from 'csv-parse/sync';
import chalk from 'chalk';
import cliProgress from 'cli-progress';
import traktor from 'node-traktor';

const execFileAsync = promisify(execFile);
const RAW_API_MARKER = '--- Raw API Response ---';

// Pipeline constants (no positional args)
const DATA_DIR = 'data';
const CSV_FILE = 'tracks-list.csv';
const LIBRARY_JSON = path.join(DATA_DIR, 'library.json');
const LIBRARY_ZIP = path.join(DATA_DIR, 'library.zip');
const DEFAULT_EXPORT_DIR = '/Users/anton/Music/Suno';
function getExportDir(): string { return process.env.EXPORT_DIR ?? DEFAULT_EXPORT_DIR; }
function getExportTracksDir(): string { return path.join(getExportDir(), 'Tracks'); }
function getExportPlaylistsDir(): string { return path.join(getExportDir(), 'Playlists'); }
const REPORT_HTML = path.join(DATA_DIR, 'library.html');

function logStep(message: string): void {
  console.log(chalk.bold.cyan(message));
}

function logInfo(message: string): void {
  console.log(chalk.gray(message));
}

function logOk(message: string): void {
  console.log(chalk.green(message));
}

type CsvRow = Record<string, string>;

type ParsedTxtMetadata = {
  metadataFor: string | null;
  generatedAt: string | null;
  trackInformation: {
    title: string | null;
    artist: string | null;
    year: number | null;
  };
  musicalInformation: string;
  creationDetails: {
    prompt: string | null;
    body: string;
  };
  lyrics: string;
  coverArtUrl: string | null;
  rawApiResponse: Record<string, unknown> | null;
};

type LibraryTrack = {
  id: string;
  title: string | null;
  workspace: string | null;
  workspaceId: string | null;
  status: string | null;
  createdAt: string | null;
  duration: number | null;
  type: string | null;
  isStem: boolean | null;
  paths: {
    wav: string | null;
    txt: string | null;
    mp3: string | null;
    traktor: string | null;
  };
  availability: {
    wav: boolean;
    txt: boolean;
    mp3: boolean;
    exported: boolean;
  };
  checkpoints: {
    importedAt: string;
    processedAt: string | null;
    analyzedAt: string | null;
    exportedAt: string | null;
  };
  parsed: {
    title: string | null;
    artist: string | null;
    year: number | null;
    prompt: string | null;
    lyrics: string | null;
    tags: string | null;
    displayTags: string | null;
    modelName: string | null;
    modelVersion: string | null;
    task: string | null;
    isRemix: boolean | null;
    isPublic: boolean | null;
    isExplicit: boolean | null;
    musicalKey: string | null;
    keySource: 'metadata' | 'related' | 'traktor' | 'aubio' | 'none' | null;
    bpm: number | null;
    bpmSource: 'metadata' | 'related' | 'traktor' | 'aubio' | 'none' | null;
  };
  categories: string[];
  metadata?: Record<string, unknown>;
  csvRaw: CsvRow;
  updatedAt: string;
};

type LibraryPlaylist = {
  id: string;
  name: string;
  groupKey: string;
  groupValue: string;
  trackIds: string[];
  trackCount: number;
  availableTrackCount: number;
  path: string | null;
  exportPath: string | null;
  updatedAt: string;
};

type LibraryState = {
  version: number;
  updatedAt: string;
  steps: {
    import: string;
    process: string;
    analyze: string;
    export: string;
    report: string;
  };
  tracks: LibraryTrack[];
  playlists: LibraryPlaylist[];
};

type TrackContext = {
  row: LibraryTrack;
  id: string;
  sourceWavPath: string;
  title: string;
  normalizedText: string;
  rawTask: string;
  isRemix: boolean;
  isPublic: boolean;
  isExplicit: boolean;
  modelVersion: string;
  bpm: number | null;
  musicalKey: string | null;
};

type CliOptions = {
  exportType: 'music' | 'traktor' | null;
};

function nowIso(): string {
  return new Date().toISOString();
}

function parseArgs(): CliOptions {
  const args = process.argv.slice(2);
  let exportType: 'music' | 'traktor' | null = null;

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--') continue;
    if (arg === '--export') {
      const value = args[i + 1];
      if (!value || value.startsWith('--')) {
        throw new Error('Missing value for --export. Supported: music, traktor');
      }
      if (value !== 'music' && value !== 'traktor') {
        throw new Error(`Unsupported export type: ${value}. Supported: music, traktor`);
      }
      exportType = value;
      i += 1;
      continue;
    }
    throw new Error(`Unsupported argument: ${arg}. Supported: --export music|traktor`);
  }

  return { exportType };
}

function normalizePathForMatch(p: string): string {
  return path.resolve(p).replace(/\\/g, '/').toLowerCase();
}

function traktorDirFromAbsDir(absDir: string): string {
  const normalized = absDir.replace(/\\/g, '/').replace(/\/+$/, '');
  const body = normalized.replace(/^\/+/, '').split('/').join('/:');
  return `/:${body}/:`;
}

function traktorPrimaryKeyFromAbsPath(absPath: string, volume: string): string {
  const normalized = absPath.replace(/\\/g, '/').replace(/^\/+/, '').split('/').join('/:');
  return `${volume}/:${normalized}`;
}

function absPathFromTraktorLocation(dirAttr: string, fileAttr: string): string {
  const dir = dirAttr
    .replace(/^\/:/, '/')
    .replace(/:\//g, '/')
    .replace(/:$/, '');
  return path.resolve(path.join(dir, fileAttr));
}

async function findTraktorCollectionPath(): Promise<string | null> {
  const base = path.join(process.env.HOME ?? '', 'Documents', 'Native Instruments');
  if (!(await fileExists(base))) return null;
  const items = await fs.readdir(base, { withFileTypes: true });
  const candidates: Array<{ path: string; rank: number; mtime: number }> = [];

  for (const item of items) {
    if (!item.isDirectory()) continue;
    if (!/^Traktor\b/i.test(item.name)) continue;
    const collectionPath = path.join(base, item.name, 'collection.nml');
    if (!(await fileExists(collectionPath))) continue;

    const version = item.name.match(/Traktor\s+(\d+)(?:\.(\d+))?(?:\.(\d+))?/i);
    const v1 = Number(version?.[1] ?? 0);
    const v2 = Number(version?.[2] ?? 0);
    const v3 = Number(version?.[3] ?? 0);
    const rank = v1 * 1_000_000 + v2 * 1_000 + v3;
    const stat = await fs.stat(collectionPath);
    candidates.push({ path: collectionPath, rank, mtime: stat.mtimeMs });
  }

  if (candidates.length === 0) return null;
  candidates.sort((a, b) => b.rank - a.rank || b.mtime - a.mtime);
  return candidates[0].path;
}

async function stepTraktorUpsert(state: LibraryState): Promise<void> {
  logStep('Upserting Traktor collection...');

  const collectionPath = await findTraktorCollectionPath();
  if (!collectionPath) {
    logInfo('No Traktor collection.nml found under ~/Documents/Native Instruments. Skipping Traktor upsert.');
    return;
  }

  const CollectionCtor = (traktor as unknown as { Collection: new () => { load: (p: string) => Promise<unknown>; toXML: () => string; _tree?: unknown } }).Collection;
  const collection = new CollectionCtor();
  await collection.load(collectionPath);
  const tree = (collection as unknown as { _tree?: { findall: (p: string) => any[] } })._tree;
  if (!tree) throw new Error('Failed to load Traktor XML tree from collection');

  const collectionEl = tree.findall('COLLECTION')[0];
  if (!collectionEl) throw new Error('Invalid collection.nml: missing COLLECTION');

  const playlistsEl = tree.findall('PLAYLISTS')[0];
  if (!playlistsEl) throw new Error('Invalid collection.nml: missing PLAYLISTS');

  const rootNode = playlistsEl.findall('NODE').find((node: any) => node.get('TYPE') === 'FOLDER' && node.get('NAME') === '$ROOT') ?? playlistsEl.findall('NODE')[0];
  if (!rootNode) throw new Error('Invalid collection.nml: missing PLAYLISTS root NODE');

  const subnodes = rootNode.findall('SUBNODES')[0];
  if (!subnodes) throw new Error('Invalid collection.nml: missing SUBNODES');

  const existingEntries = collectionEl.findall('ENTRY');
  let volumeHint = 'Macintosh HD';
  for (const entry of existingEntries) {
    const loc = entry.findall('LOCATION')[0];
    const volume = loc?.get('VOLUME');
    if (volume) {
      volumeHint = String(volume);
      break;
    }
  }

  const entryByPath = new Map<string, any>();
  for (const entry of existingEntries) {
    const loc = entry.findall('LOCATION')[0];
    if (!loc) continue;
    const dirAttr = loc.get('DIR');
    const fileAttr = loc.get('FILE');
    if (!dirAttr || !fileAttr) continue;
    const abs = absPathFromTraktorLocation(String(dirAttr), String(fileAttr));
    entryByPath.set(normalizePathForMatch(abs), entry);
  }

  const exportedTracks = state.tracks
    .filter((t) => t.availability.exported && t.paths.traktor)
    .map((t) => ({
      track: t,
      exportAbsPath: path.resolve(String(t.paths.traktor)),
      title: toTitleCase(t.parsed.title ?? t.title ?? t.id),
      artist: (t.parsed.artist ?? 'TOKUDU').trim() || 'TOKUDU',
    }));

  let createdEntries = 0;
  let updatedEntries = 0;
  for (const item of exportedTracks) {
    const key = normalizePathForMatch(item.exportAbsPath);
    const existing = entryByPath.get(key);
    if (existing) {
      existing.set('TITLE', item.title);
      existing.set('ARTIST', item.artist);
      updatedEntries += 1;
      continue;
    }

    const entry = (collectionEl as any).makeelement('ENTRY', {
      MODIFIED_DATE: new Date().toISOString().slice(0, 10).replace(/-/g, '/'),
      MODIFIED_TIME: String(Math.floor(Date.now() / 1000) % 100000),
      TITLE: item.title,
      ARTIST: item.artist,
    });
    const location = (entry as any).makeelement('LOCATION', {
      DIR: traktorDirFromAbsDir(path.dirname(item.exportAbsPath)),
      FILE: path.basename(item.exportAbsPath),
      VOLUME: volumeHint,
      VOLUMEID: volumeHint,
    });
    entry.append(location);
    const infoAttrs: Record<string, string> = {
      IMPORT_DATE: new Date().toISOString().slice(0, 10).replace(/-/g, '/'),
    };
    if (typeof item.track.duration === 'number') {
      infoAttrs.PLAYTIME = String(Math.max(0, Math.round(item.track.duration)));
      infoAttrs.PLAYTIME_FLOAT = String(Math.max(0, item.track.duration));
    }
    entry.append((entry as any).makeelement('INFO', infoAttrs));
    collectionEl.append(entry);
    entryByPath.set(key, entry);
    createdEntries += 1;
  }
  collectionEl.set('ENTRIES', String(collectionEl.findall('ENTRY').length));

  const playlistNodes = subnodes.findall('NODE').filter((n: any) => n.get('TYPE') === 'PLAYLIST');
  const playlistByName = new Map<string, any>();
  for (const node of playlistNodes) {
    const name = String(node.get('NAME') ?? '');
    if (name) playlistByName.set(name, node);
  }

  let upsertedPlaylists = 0;
  for (const playlist of state.playlists) {
    const name = playlist.name;
    let node = playlistByName.get(name);
    if (!node) {
      node = (subnodes as any).makeelement('NODE', { TYPE: 'PLAYLIST', NAME: name });
      const playlistEl = (node as any).makeelement('PLAYLIST', {
        ENTRIES: '0',
        TYPE: 'LIST',
        UUID: randomUUID().replace(/-/g, ''),
      });
      node.append(playlistEl);
      subnodes.append(node);
      playlistByName.set(name, node);
    }

    const playlistEl = node.findall('PLAYLIST')[0];
    if (!playlistEl) continue;
    const existingKeys = new Set<string>();
    for (const e of playlistEl.findall('ENTRY')) {
      const pk = e.findall('PRIMARYKEY')[0];
      const key = pk?.get('KEY');
      if (key) existingKeys.add(String(key));
    }

    const desiredKeys: string[] = [];
    for (const trackId of playlist.trackIds) {
      const track = state.tracks.find((t) => t.id === trackId);
      if (!track?.paths.traktor) continue;
      const abs = path.resolve(track.paths.traktor);
      desiredKeys.push(traktorPrimaryKeyFromAbsPath(abs, volumeHint));
    }

    while (playlistEl.findall('ENTRY').length) {
      playlistEl.remove(playlistEl.findall('ENTRY')[0]);
    }
    for (const key of desiredKeys) {
      const entryEl = (playlistEl as any).makeelement('ENTRY', {});
      const pk = (entryEl as any).makeelement('PRIMARYKEY', { TYPE: 'TRACK', KEY: key });
      entryEl.append(pk);
      playlistEl.append(entryEl);
    }
    playlistEl.set('ENTRIES', String(desiredKeys.length));
    upsertedPlaylists += 1;
  }

  subnodes.set('COUNT', String(subnodes.findall('NODE').length));

  const backupPath = `${collectionPath}.bak`;
  if (!(await fileExists(backupPath))) {
    await fs.copyFile(collectionPath, backupPath);
  }
  await fs.writeFile(collectionPath, collection.toXML(), 'utf8');
  logOk(`Traktor collection upsert complete: entries+${createdEntries}, entries~${updatedEntries}, playlists=${upsertedPlaylists}`);
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function ensureDir(dirPath: string): Promise<void> {
  await fs.mkdir(dirPath, { recursive: true });
}

async function readLibraryStateIfExists(): Promise<LibraryState | null> {
  if (!(await fileExists(LIBRARY_JSON))) return null;
  try {
    const raw = await fs.readFile(LIBRARY_JSON, 'utf8');
    const parsed = JSON.parse(raw) as { tracks?: unknown[]; playlists?: LibraryPlaylist[]; [k: string]: unknown };
    if (!Array.isArray(parsed.tracks) || !Array.isArray(parsed.playlists)) return null;

    const tracks = parsed.tracks.map((t) => {
      const track = t as Record<string, unknown>;
      const isFlattened = 'wavPath' in track || 'hasWav' in track || 'importedAt' in track;
      if (!isFlattened) return t as LibraryTrack;

      const csvTitle = (track['csvTitle'] as string | null | undefined) ?? null;
      const resolvedTitle = (track['title'] as string | null | undefined) ?? null;

      return {
        id: String(track['id'] ?? ''),
        title: csvTitle ?? resolvedTitle,
        workspace: (track['workspace'] as string | null | undefined) ?? null,
        workspaceId: (track['workspaceId'] as string | null | undefined) ?? null,
        status: (track['status'] as string | null | undefined) ?? null,
        createdAt: (track['createdAt'] as string | null | undefined) ?? null,
        duration: (track['duration'] as number | null | undefined) ?? null,
        type: (track['type'] as string | null | undefined) ?? null,
        isStem: (track['isStem'] as boolean | null | undefined) ?? null,
        paths: {
          wav: (track['wavPath'] as string | null | undefined) ?? null,
          txt: (track['txtPath'] as string | null | undefined) ?? null,
          mp3: (track['mp3Path'] as string | null | undefined) ?? null,
          traktor: (track['traktorPath'] as string | null | undefined) ?? null,
        },
        availability: {
          wav: Boolean(track['hasWav']),
          txt: Boolean(track['hasTxt']),
          mp3: Boolean(track['hasMp3']),
          exported: Boolean(track['isExported']),
        },
        checkpoints: {
          importedAt: (track['importedAt'] as string | null | undefined) ?? nowIso(),
          processedAt: (track['processedAt'] as string | null | undefined) ?? null,
          analyzedAt: (track['analyzedAt'] as string | null | undefined) ?? null,
          exportedAt: (track['exportedAt'] as string | null | undefined) ?? null,
        },
        parsed: {
          title: (track['title'] as string | null | undefined) ?? null,
          artist: (track['artist'] as string | null | undefined) ?? null,
          year: (track['year'] as number | null | undefined) ?? null,
          prompt: (track['prompt'] as string | null | undefined) ?? null,
          lyrics: (track['lyrics'] as string | null | undefined) ?? null,
          tags: (track['tags'] as string | null | undefined) ?? null,
          displayTags: (track['displayTags'] as string | null | undefined) ?? null,
          modelName: (track['modelName'] as string | null | undefined) ?? null,
          modelVersion: (track['modelVersion'] as string | null | undefined) ?? null,
          task: (track['task'] as string | null | undefined) ?? null,
          isRemix: (track['isRemix'] as boolean | null | undefined) ?? null,
          isPublic: (track['isPublic'] as boolean | null | undefined) ?? null,
          isExplicit: (track['isExplicit'] as boolean | null | undefined) ?? null,
          musicalKey: (track['musicalKey'] as string | null | undefined) ?? null,
          keySource: (track['keySource'] as LibraryTrack['parsed']['keySource'] | null | undefined) ?? null,
          bpm: (track['bpm'] as number | null | undefined) ?? null,
          bpmSource: (track['bpmSource'] as LibraryTrack['parsed']['bpmSource'] | null | undefined) ?? null,
        },
        categories: Array.isArray(track['categories']) ? (track['categories'] as string[]) : [],
        metadata: (track['metadata'] as Record<string, unknown> | undefined) ?? undefined,
        csvRaw: (track['csvRaw'] as CsvRow | undefined) ?? {},
        updatedAt: (track['updatedAt'] as string | null | undefined) ?? nowIso(),
      } satisfies LibraryTrack;
    });

    return {
      ...parsed,
      tracks,
      playlists: parsed.playlists.map((p) => ({
        ...p,
        path: (p as LibraryPlaylist & { path?: string | null }).path ?? p.exportPath ?? null,
      })),
    } as LibraryState;
  } catch {
    return null;
  }
}

async function writeLibraryState(state: LibraryState): Promise<void> {
  state.updatedAt = nowIso();
  await ensureDir(DATA_DIR);
  const tracksById = new Map(state.tracks.map((track) => [track.id, track]));
  const sortedTracks = [...state.tracks].sort((a, b) => {
    const ta = createdAtSortValue(a.createdAt);
    const tb = createdAtSortValue(b.createdAt);
    if (ta !== tb) return tb - ta;
    return b.id.localeCompare(a.id);
  });

  const flattenedTracks = sortedTracks.map((track) => ({
    id: track.id,
    title: track.parsed.title ?? track.title,
    csvTitle: track.title,
    workspace: track.workspace,
    workspaceId: track.workspaceId,
    status: track.status,
    createdAt: track.createdAt,
    duration: track.duration,
    type: track.type,
    isStem: track.isStem,
    wavPath: track.paths.wav,
    txtPath: track.paths.txt,
    mp3Path: track.paths.mp3,
    path: track.paths.mp3,
    traktorPath: track.paths.traktor,
    hasWav: track.availability.wav,
    hasTxt: track.availability.txt,
    hasMp3: track.availability.mp3,
    isExported: track.availability.exported,
    importedAt: track.checkpoints.importedAt,
    processedAt: track.checkpoints.processedAt,
    analyzedAt: track.checkpoints.analyzedAt,
    exportedAt: track.checkpoints.exportedAt,
    artist: track.parsed.artist,
    year: track.parsed.year,
    prompt: track.parsed.prompt,
    lyrics: track.parsed.lyrics,
    tags: track.parsed.tags,
    displayTags: track.parsed.displayTags,
    modelName: track.parsed.modelName,
    modelVersion: track.parsed.modelVersion,
    task: track.parsed.task,
    isRemix: track.parsed.isRemix,
    isPublic: track.parsed.isPublic,
    isExplicit: track.parsed.isExplicit,
    musicalKey: track.parsed.musicalKey,
    keySource: track.parsed.keySource,
    bpm: track.parsed.bpm,
    bpmSource: track.parsed.bpmSource,
    categories: track.categories,
    metadata: track.metadata,
    updatedAt: track.updatedAt,
  }));
  const out = {
    ...state,
    tracks: flattenedTracks,
    playlists: state.playlists.map((playlist) => {
      const trackIds = playlist.groupKey === 'DJ Sets'
        ? playlist.trackIds
        : sortTrackIdsByCreatedAt(playlist.trackIds, tracksById);
      return {
        ...playlist,
        trackIds,
        path: playlist.path ?? playlist.exportPath ?? null,
      };
    }),
  };
  const tmp = `${LIBRARY_JSON}.tmp`;
  await fs.writeFile(tmp, `${JSON.stringify(out, null, 2)}\n`, 'utf8');
  await fs.rename(tmp, LIBRARY_JSON);
}

function makeProgressBar(prefix: string, total: number): cliProgress.SingleBar {
  const bar = new cliProgress.SingleBar(
    {
      format: `${chalk.yellow(prefix.padEnd(11))} [{bar}] {percentage}% | {value}/{total}`,
      hideCursor: true,
      clearOnComplete: true,
    },
    cliProgress.Presets.shades_classic,
  );
  bar.start(Math.max(total, 1), 0);
  return bar;
}

function getSection(content: string, sectionName: string): string {
  const marker = `--- ${sectionName} ---`;
  const start = content.indexOf(marker);
  if (start === -1) return '';
  const sectionStart = start + marker.length;
  const nextMarkerIndex = content.indexOf('\n--- ', sectionStart);
  const sectionEnd = nextMarkerIndex === -1 ? content.length : nextMarkerIndex;
  return content.slice(sectionStart, sectionEnd).trim();
}

function extractLineValue(section: string, key: string): string | null {
  const pattern = new RegExp(`^${key}:\\s*(.*)$`, 'm');
  const match = section.match(pattern);
  if (!match) return null;
  const value = match[1].trim();
  return value.length > 0 ? value : null;
}

function parseRawApiJson(content: string): Record<string, unknown> | null {
  const markerIndex = content.indexOf(RAW_API_MARKER);
  if (markerIndex === -1) return null;
  const rawJsonText = content.slice(markerIndex + RAW_API_MARKER.length).trim();
  if (!rawJsonText) return null;
  try {
    return JSON.parse(rawJsonText) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function parseTxtMetadata(content: string): ParsedTxtMetadata {
  const trackInfoSection = getSection(content, 'Track Information');
  const musicalInfoSection = getSection(content, 'Musical Information');
  const creationDetailsSection = getSection(content, 'Creation Details');
  const lyricsSection = getSection(content, 'Lyrics');

  const metadataForMatch = content.match(/^Metadata for:\s*(.+)$/m);
  const generatedMatch = content.match(/^Generated:\s*(.+)$/m);
  const coverArtMatch = content.match(/^Cover Art URL:\s*(.+)$/m);

  const title = extractLineValue(trackInfoSection, 'Title');
  const artist = extractLineValue(trackInfoSection, 'Artist');
  const yearRaw = extractLineValue(trackInfoSection, 'Year');
  const prompt = extractLineValue(creationDetailsSection, 'Prompt');

  const year = yearRaw && Number.isFinite(Number(yearRaw)) ? Number(yearRaw) : null;

  return {
    metadataFor: metadataForMatch?.[1]?.trim() ?? null,
    generatedAt: generatedMatch?.[1]?.trim() ?? null,
    trackInformation: { title, artist, year },
    musicalInformation: musicalInfoSection,
    creationDetails: { prompt, body: creationDetailsSection },
    lyrics: lyricsSection,
    coverArtUrl: coverArtMatch?.[1]?.trim() ?? null,
    rawApiResponse: parseRawApiJson(content),
  };
}

function parseBpmCandidate(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value;
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  const direct = Number(trimmed);
  if (Number.isFinite(direct) && direct > 0) return direct;

  const bpmMatch = trimmed.match(/(\d+(?:\.\d+)?)\s*bpm\b/i);
  if (!bpmMatch) return null;
  const parsed = Number(bpmMatch[1]);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function extractBpmFromRawMetadata(raw: Record<string, unknown> | null): number | null {
  if (!raw) return null;
  const metadata = (raw['metadata'] ?? null) as Record<string, unknown> | null;

  const directCandidates: unknown[] = [
    metadata?.['bpm'],
    metadata?.['tempo'],
    metadata?.['beats_per_minute'],
    raw['bpm'],
    raw['tempo'],
  ];

  for (const candidate of directCandidates) {
    const bpm = parseBpmCandidate(candidate);
    if (bpm !== null) return bpm;
  }

  return null;
}

function extractMusicalKeyFromRawMetadata(raw: Record<string, unknown> | null): string | null {
  if (!raw) return null;
  const metadata = (raw['metadata'] ?? null) as Record<string, unknown> | null;

  const directCandidates: unknown[] = [
    metadata?.['musical_key'],
    metadata?.['musicalKey'],
    metadata?.['key'],
    metadata?.['song_key'],
    raw['musical_key'],
    raw['musicalKey'],
    raw['key'],
    raw['song_key'],
  ];

  for (const candidate of directCandidates) {
    if (typeof candidate !== 'string') continue;
    const parsed = extractMusicalKeyFromText(candidate);
    if (parsed) return parsed;
  }

  return null;
}

function normalizeTitle(value: string | null | undefined): string {
  if (!value) return '';
  return value
    .toLowerCase()
    .replace(/[_]+/g, ' ')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function baseTitle(value: string): string {
  return value
    .replace(/\b(remix|re dub|redub|edit|extended|extend|cover|mix|version)\b/gi, ' ')
    .replace(/\(.*?\)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function modeNumber(values: number[]): number | null {
  if (values.length === 0) return null;
  const counts = new Map<number, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  const sorted = [...counts.entries()].sort((a, b) => (b[1] - a[1]) || (a[0] - b[0]));
  return sorted[0]?.[0] ?? null;
}

function synchsafeToInt(buf: Buffer): number {
  return (buf[0] << 21) | (buf[1] << 14) | (buf[2] << 7) | buf[3];
}

function decodeId3TextFrame(frameData: Buffer): string {
  if (frameData.length === 0) return '';
  const encoding = frameData[0];
  const body = frameData.slice(1);
  if (encoding === 0) return body.toString('latin1').replace(/\0+$/g, '');
  if (encoding === 3) return body.toString('utf8').replace(/\0+$/g, '');
  if (encoding === 1) {
    if (body.length < 2) return body.toString('utf16le').replace(/\0+$/g, '');
    const bom = body.slice(0, 2);
    const text = body.slice(2);
    if (bom[0] === 0xfe && bom[1] === 0xff) {
      const swapped = Buffer.alloc(text.length);
      for (let i = 0; i + 1 < text.length; i += 2) {
        swapped[i] = text[i + 1];
        swapped[i + 1] = text[i];
      }
      return swapped.toString('utf16le').replace(/\0+$/g, '');
    }
    return text.toString('utf16le').replace(/\0+$/g, '');
  }
  if (encoding === 2) {
    const swapped = Buffer.alloc(body.length);
    for (let i = 0; i + 1 < body.length; i += 2) {
      swapped[i] = body[i + 1];
      swapped[i + 1] = body[i];
    }
    return swapped.toString('utf16le').replace(/\0+$/g, '');
  }
  return body.toString('utf8').replace(/\0+$/g, '');
}

function openKeyToMusicalKey(openKey: string): string | null {
  const normalized = openKey.trim().toLowerCase();
  const map: Record<string, string> = {
    '1d': 'C Major',
    '2d': 'G Major',
    '3d': 'D Major',
    '4d': 'A Major',
    '5d': 'E Major',
    '6d': 'B Major',
    '7d': 'F# Major',
    '8d': 'C# Major',
    '9d': 'Ab Major',
    '10d': 'Eb Major',
    '11d': 'Bb Major',
    '12d': 'F Major',
    '1m': 'A Minor',
    '2m': 'E Minor',
    '3m': 'B Minor',
    '4m': 'F# Minor',
    '5m': 'C# Minor',
    '6m': 'G# Minor',
    '7m': 'Eb Minor',
    '8m': 'Bb Minor',
    '9m': 'F Minor',
    '10m': 'C Minor',
    '11m': 'G Minor',
    '12m': 'D Minor',
  };
  return map[normalized] ?? null;
}

async function readId3TempoAndKey(audioPath: string): Promise<{ bpm: number | null; musicalKey: string | null }> {
  try {
    const header = Buffer.alloc(10);
    const fh = await fs.open(audioPath, 'r');
    await fh.read(header, 0, 10, 0);
    if (header.slice(0, 3).toString('ascii') !== 'ID3') {
      await fh.close();
      return { bpm: null, musicalKey: null };
    }

    const version = header[3];
    const tagSize = synchsafeToInt(header.slice(6, 10));
    const tagBody = Buffer.alloc(tagSize);
    await fh.read(tagBody, 0, tagSize, 10);
    await fh.close();

    let offset = 0;
    let bpm: number | null = null;
    let musicalKey: string | null = null;

    while (offset + 10 <= tagBody.length) {
      const frameId = tagBody.slice(offset, offset + 4).toString('ascii');
      if (!frameId.trim()) break;
      const sizeBytes = tagBody.slice(offset + 4, offset + 8);
      const frameSize = version === 4 ? synchsafeToInt(sizeBytes) : sizeBytes.readUInt32BE(0);
      if (frameSize <= 0) break;
      const start = offset + 10;
      const end = start + frameSize;
      if (end > tagBody.length) break;
      const frameData = tagBody.slice(start, end);

      if (frameId === 'TBPM') {
        bpm = parseBpmCandidate(decodeId3TextFrame(frameData));
      } else if (frameId === 'TKEY') {
        const raw = decodeId3TextFrame(frameData).trim();
        musicalKey = openKeyToMusicalKey(raw) ?? extractMusicalKeyFromText(raw);
      }

      offset = end;
      if (bpm !== null && musicalKey !== null) break;
    }

    return { bpm, musicalKey };
  } catch {
    return { bpm: null, musicalKey: null };
  }
}

function collectReferencedIdsFromValue(value: unknown, out: Set<string>): void {
  if (typeof value === 'string') {
    const matches = value.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi);
    if (matches) for (const match of matches) out.add(match.toLowerCase());
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectReferencedIdsFromValue(item, out);
    return;
  }
  if (value && typeof value === 'object') {
    for (const nested of Object.values(value as Record<string, unknown>)) {
      collectReferencedIdsFromValue(nested, out);
    }
  }
}

function collectReferencedIds(rawApi: Record<string, unknown> | null): string[] {
  if (!rawApi) return [];
  const out = new Set<string>();
  const metadata = (rawApi['metadata'] ?? null) as Record<string, unknown> | null;
  if (metadata) collectReferencedIdsFromValue(metadata, out);
  out.delete(String(rawApi['id'] ?? '').toLowerCase());
  return [...out];
}

async function estimateBpmWithAubio(audioPath: string): Promise<number | null> {
  try {
    const { stdout } = await execFileAsync('aubio', ['tempo', '-i', audioPath], {
      timeout: 15000,
      maxBuffer: 1024 * 1024,
    });
    const match = stdout.trim().match(/(\d+(?:\.\d+)?)\s*bpm/i);
    if (!match) return null;
    const bpm = Number(match[1]);
    if (!Number.isFinite(bpm) || bpm < 40 || bpm > 240) return null;
    return Math.round(bpm * 100) / 100;
  } catch {
    return null;
  }
}

async function ensureMp3FromWav(wavAbsPath: string): Promise<{ mp3AbsPath: string | null; generated: boolean }> {
  const mp3AbsPath = wavAbsPath.replace(/\.wav$/i, '.mp3');
  if (mp3AbsPath === wavAbsPath) return { mp3AbsPath: null, generated: false };

  if (await fileExists(mp3AbsPath)) {
    return { mp3AbsPath, generated: false };
  }

  try {
    await execFileAsync('lame', ['--preset', 'cbr', '320', wavAbsPath, mp3AbsPath], {
      timeout: 5 * 60 * 1000,
      maxBuffer: 1024 * 1024,
    });
    return { mp3AbsPath, generated: true };
  } catch {
    return { mp3AbsPath: null, generated: false };
  }
}

function toTitleCase(value: string): string {
  const cleaned = value.replace(/[_]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!cleaned) return 'Untitled';
  return cleaned
    .toLowerCase()
    .split(' ')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function safeFileName(value: string): string {
  return value.replace(/[/:*?"<>|]/g, '-').replace(/\s+/g, ' ').trim();
}

function computeExpectedTraktorTrackPaths(tracks: LibraryTrack[]): Map<string, string> {
  const exportNameUsed = new Set<string>();
  const targets = new Map<string, string>();

  for (const track of tracks) {
    if (!track.paths.mp3) continue;
    const title = toTitleCase(track.parsed.title ?? track.title ?? track.id);
    let exportName = safeFileName(`TOKUDU - ${title}.mp3`);
    if (exportNameUsed.has(exportName)) {
      exportName = safeFileName(`TOKUDU - ${title} [${track.id.slice(0, 8)}].mp3`);
    }
    exportNameUsed.add(exportName);
    targets.set(track.id, path.join(getExportTracksDir(), exportName));
  }

  return targets;
}

function extractMusicalKeyFromText(value: string): string | null {
  if (!value) return null;
  const normalized = value.replace(/♯/g, '#').replace(/♭/g, 'b');
  const match = normalized.match(/\b([A-Ga-g])\s*(#|b)?\s*(major|minor)\b/i);
  if (!match) return null;
  const root = `${match[1].toUpperCase()}${match[2] ?? ''}`;
  const mode = match[3].toLowerCase() === 'major' ? 'Major' : 'Minor';
  return `${root} ${mode}`;
}

function toOpenKey(musicalKey: string | null): string | null {
  if (!musicalKey) return null;
  const match = musicalKey.trim().match(/^([A-G])([#b]?)[\s_-]+(Major|Minor)$/i);
  if (!match) return null;

  const base = match[1].toUpperCase();
  const accidental = match[2] ?? '';
  const mode = match[3].toLowerCase() === 'major' ? 'major' : 'minor';
  const note = `${base}${accidental}`;

  const majorMap: Record<string, string> = {
    C: '1d',
    G: '2d',
    D: '3d',
    A: '4d',
    E: '5d',
    B: '6d',
    'F#': '7d',
    Gb: '7d',
    'C#': '8d',
    Db: '8d',
    'G#': '9d',
    Ab: '9d',
    'D#': '10d',
    Eb: '10d',
    'A#': '11d',
    Bb: '11d',
    F: '12d',
  };

  const minorMap: Record<string, string> = {
    A: '1m',
    E: '2m',
    B: '3m',
    'F#': '4m',
    Gb: '4m',
    'C#': '5m',
    Db: '5m',
    'G#': '6m',
    Ab: '6m',
    'D#': '7m',
    Eb: '7m',
    'A#': '8m',
    Bb: '8m',
    F: '9m',
    C: '10m',
    G: '11m',
    D: '12m',
  };

  return mode === 'major' ? (majorMap[note] ?? null) : (minorMap[note] ?? null);
}

function keyMixGroupFromOpenKey(openKey: string | null): string | null {
  if (!openKey) return null;
  const groups: Array<{ name: string; keys: string[] }> = [
    { name: '12m,1m,12d,1d', keys: ['12m', '1m', '12d', '1d'] },
    { name: '2m,3m,2d,3d', keys: ['2m', '3m', '2d', '3d'] },
    { name: '4m,5m,4d,5d', keys: ['4m', '5m', '4d', '5d'] },
    { name: '6m,7m,6d,7d', keys: ['6m', '7m', '6d', '7d'] },
    { name: '8m,9m,8d,9d', keys: ['8m', '9m', '8d', '9d'] },
    { name: '10m,11m,10d,11d', keys: ['10m', '11m', '10d', '11d'] },
  ];
  const found = groups.find((group) => group.keys.includes(openKey));
  return found?.name ?? null;
}

function parseOpenKey(openKey: string | null): { n: number; mode: 'm' | 'd' } | null {
  if (!openKey) return null;
  const match = openKey.match(/^(\d{1,2})([md])$/i);
  if (!match) return null;
  const n = Number(match[1]);
  if (!Number.isFinite(n) || n < 1 || n > 12) return null;
  const mode = match[2].toLowerCase() === 'm' ? 'm' : 'd';
  return { n, mode };
}

function circularDistance12(a: number, b: number): number {
  const d = Math.abs(a - b);
  return Math.min(d, 12 - d);
}

function keyCompatibilityScore(a: string | null, b: string | null): number {
  const ka = parseOpenKey(a);
  const kb = parseOpenKey(b);
  if (!ka || !kb) return 0.35;
  if (ka.n === kb.n && ka.mode === kb.mode) return 1.0;
  if (ka.n === kb.n && ka.mode !== kb.mode) return 0.85;
  if (ka.mode === kb.mode && circularDistance12(ka.n, kb.n) === 1) return 0.8;
  if (ka.mode !== kb.mode && circularDistance12(ka.n, kb.n) === 1) return 0.55;
  return 0.15;
}

function estimateTrackBpm(track: LibraryTrack): number | null {
  if (typeof track.parsed.bpm === 'number') return track.parsed.bpm;
  if (track.categories.includes('BPM - <80')) return 70;
  if (track.categories.includes('BPM - 80-110')) return 95;
  if (track.categories.includes('BPM - 110-135')) return 122;
  if (track.categories.includes('BPM - >135')) return 145;
  return null;
}

function buildTrackSearchText(track: LibraryTrack): string {
  return [
    track.parsed.title ?? track.title ?? '',
    track.parsed.tags ?? '',
    track.parsed.displayTags ?? '',
    track.parsed.prompt ?? '',
    track.parsed.lyrics ?? '',
    ...track.categories,
  ]
    .join(' ')
    .toLowerCase();
}

function trackEnergyLevel(track: LibraryTrack): 'high' | 'mid' | 'low' | null {
  for (const cat of track.categories) {
    if (cat === 'Energy - High') return 'high';
    if (cat === 'Energy - Mid') return 'mid';
    if (cat === 'Energy - Low') return 'low';
  }
  return null;
}

type DjSetProfile = {
  name: string;
  keywords: string[];
  startBpm: number;
  endBpm: number;
  preferEnergy: ('mid' | 'high')[];
  targetMinutes: number;
};

function generateDjSetPlaylists(tracks: LibraryTrack[]): Array<{ name: string; trackIds: string[] }> {
  if (tracks.length === 0) return [];

  const profiles: DjSetProfile[] = [
    { name: 'Warmup Grooves', keywords: ['house', 'deep', 'dubby', 'groove', 'minimal', 'soul'], startBpm: 92, endBpm: 122, preferEnergy: ['mid'], targetMinutes: 90 },
    { name: 'Bass Pressure', keywords: ['trap', 'bass', '808', 'club', 'drop', 'festival'], startBpm: 90, endBpm: 145, preferEnergy: ['mid', 'high'], targetMinutes: 120 },
    { name: 'Dark Warehouse', keywords: ['dark', 'warehouse', 'tech', 'industrial', 'gritty', 'hypnotic'], startBpm: 105, endBpm: 132, preferEnergy: ['mid', 'high'], targetMinutes: 90 },
    { name: 'Global Bounce', keywords: ['latin', 'afro', 'reggaeton', 'dancehall', 'tribal', 'percussion'], startBpm: 95, endBpm: 126, preferEnergy: ['mid', 'high'], targetMinutes: 90 },
    { name: 'Euphoric Lift', keywords: ['euphoric', 'anthem', 'uplifting', 'festival', 'peak'], startBpm: 100, endBpm: 136, preferEnergy: ['high'], targetMinutes: 90 },
    { name: 'Late Night Dub', keywords: ['dub', 'reggae', 'lofi', 'smoky', 'spacey', 'half-time'], startBpm: 72, endBpm: 118, preferEnergy: ['mid'], targetMinutes: 90 },
    { name: 'Rap To Rave', keywords: ['hip hop', 'rap', 'spoken', 'electro', 'rave', 'party'], startBpm: 82, endBpm: 132, preferEnergy: ['mid', 'high'], targetMinutes: 120 },
    { name: 'Sunset To Peak', keywords: ['sunset', 'warm', 'melodic', 'club', 'peak', 'night'], startBpm: 98, endBpm: 134, preferEnergy: ['mid', 'high'], targetMinutes: 120 },
  ];

  const desiredSetCount =
    tracks.length >= 280 ? 10 :
    tracks.length >= 220 ? 9 :
    tracks.length >= 170 ? 8 :
    tracks.length >= 130 ? 7 :
    tracks.length >= 90 ? 6 :
    tracks.length >= 60 ? 5 :
    3;

  const setCount = Math.min(profiles.length, Math.max(1, desiredSetCount));

  // Rank profiles by how many library tracks match their keywords, pick the best N
  const profileScores = profiles.map((profile) => {
    let matchCount = 0;
    for (const track of tracks) {
      const text = buildTrackSearchText(track);
      const bpm = estimateTrackBpm(track);
      const bpmOk = typeof bpm === 'number' && bpm >= profile.startBpm - 10 && bpm <= profile.endBpm + 10;
      const keywordHits = profile.keywords.filter((k) => text.includes(k.toLowerCase())).length;
      if (keywordHits > 0 && bpmOk) matchCount += 1;
    }
    return { profile, matchCount };
  });
  profileScores.sort((a, b) => b.matchCount - a.matchCount);
  const selectedProfiles = profileScores.slice(0, setCount).map((ps) => ps.profile);

  const playCounts = tracks.map((t) => {
    const n = Number(t.metadata?.play_count);
    return Number.isFinite(n) ? n : 0;
  });
  const maxPlays = Math.max(1, ...playCounts);

  const usage = new Map<string, number>();

  const sets: Array<{ name: string; trackIds: string[] }> = [];
  for (const profile of selectedProfiles) {
    const scoredPool = tracks.map((track) => {
      const text = buildTrackSearchText(track);
      const keywordHits = profile.keywords.filter((k) => text.includes(k.toLowerCase())).length;
      const vibeScore = keywordHits / Math.max(1, profile.keywords.length);
      const bpm = estimateTrackBpm(track);
      const bpmInRange = typeof bpm === 'number' && bpm >= profile.startBpm - 10 && bpm <= profile.endBpm + 10 ? 1 : 0;
      const plays = Number(track.metadata?.play_count);
      const playScore = Number.isFinite(plays) ? Math.min(1, Math.log10(plays + 1) / Math.log10(maxPlays + 1)) : 0;
      const publishedScore = track.parsed.isPublic ? 1 : 0;
      const energy = trackEnergyLevel(track);
      const energyFit = energy && (profile.preferEnergy as string[]).includes(energy) ? 1 : 0;
      return { track, bpm, openKey: toOpenKey(track.parsed.musicalKey), vibeScore, bpmInRange, playScore, publishedScore, energyFit };
    });

    const pool = scoredPool
      .filter((row) => row.vibeScore > 0 || row.bpmInRange > 0)
      .sort((a, b) => (b.vibeScore + b.publishedScore + b.playScore + b.energyFit) - (a.vibeScore + a.publishedScore + a.playScore + a.energyFit));

    const fallbackPool = [...scoredPool].sort(
      (a, b) => (b.publishedScore + b.playScore) - (a.publishedScore + a.playScore),
    );
    const sourcePool = pool.length >= 20 ? pool : fallbackPool;

    // Target size based on set duration: ~3 min avg per track with mixing overlap
    const avgTrackMinutes = 3;
    const targetSize = sourcePool.length >= 20
      ? Math.min(Math.round(profile.targetMinutes / avgTrackMinutes), sourcePool.length)
      : Math.min(12, sourcePool.length);
    if (targetSize === 0) continue;

    const chosen: typeof sourcePool = [];
    const used = new Set<string>();

    const first = [...sourcePool]
      .sort((a, b) => {
        const aBpm = a.bpm ?? profile.startBpm;
        const bBpm = b.bpm ?? profile.startBpm;
        const aScore = a.vibeScore * 2 + a.publishedScore + a.playScore * 2 + a.energyFit - Math.abs(aBpm - profile.startBpm) / 60;
        const bScore = b.vibeScore * 2 + b.publishedScore + b.playScore * 2 + b.energyFit - Math.abs(bBpm - profile.startBpm) / 60;
        return bScore - aScore;
      })[0];

    if (first) {
      chosen.push(first);
      used.add(first.track.id);
      usage.set(first.track.id, (usage.get(first.track.id) ?? 0) + 1);
    }

    while (chosen.length < targetSize) {
      const prev = chosen[chosen.length - 1];
      const progress = chosen.length / Math.max(1, targetSize - 1);
      const targetBpm = profile.startBpm + (profile.endBpm - profile.startBpm) * progress;
      let best: (typeof sourcePool)[number] | null = null;
      let bestScore = -Infinity;

      for (const cand of sourcePool) {
        if (used.has(cand.track.id)) continue;
        const bpm = cand.bpm ?? targetBpm;
        const bpmFit = 1 - Math.min(1, Math.abs(bpm - targetBpm) / 35);

        // Enforce ascending BPM: hard penalty for drops, scaled by how far back it goes
        let monotonicPenalty = 0;
        if (prev && typeof prev.bpm === 'number') {
          const bpmDrop = prev.bpm - bpm;
          if (bpmDrop > 3) monotonicPenalty = 0.5 + Math.min(1.5, bpmDrop / 10);
        }

        const keyFit = prev ? keyCompatibilityScore(prev.openKey, cand.openKey) : 0.5;
        const reusePenalty = (usage.get(cand.track.id) ?? 0) * 0.5;

        // Energy progression: prefer mid early, high later
        let energyProgFit = 0;
        const energy = trackEnergyLevel(cand.track);
        if (energy === 'high' && progress > 0.4) energyProgFit = 0.4;
        else if (energy === 'mid' && progress <= 0.5) energyProgFit = 0.3;
        else if (energy === 'high' && progress <= 0.4) energyProgFit = -0.1;

        const score =
          cand.vibeScore * 2.1 +
          cand.publishedScore * 1.2 +
          cand.playScore * 1.8 +
          bpmFit * 2.5 +
          keyFit * 1.7 +
          cand.energyFit * 0.8 +
          energyProgFit -
          monotonicPenalty -
          reusePenalty;

        if (score > bestScore) {
          best = cand;
          bestScore = score;
        }
      }

      if (!best) break;
      chosen.push(best);
      used.add(best.track.id);
      usage.set(best.track.id, (usage.get(best.track.id) ?? 0) + 1);
    }

    const trackIds = chosen.map((row) => row.track.id);
    if (trackIds.length > 0) {
      sets.push({ name: profile.name, trackIds });
    }
  }

  return sets;
}

type StaticPlaylistEntry = { id: string; name: string };

async function loadStaticPlaylists(tracks: LibraryTrack[]): Promise<Array<{ name: string; trackIds: string[] }>> {
  const staticFiles: Array<{ file: string; name: string }> = [
    { file: path.join(DATA_DIR, 'da-final-drop.json'), name: 'Da Final Drop' },
    { file: path.join(DATA_DIR, 'da-final-drop-v1.json'), name: 'Da Final Drop The Slow Burn' },
    { file: path.join(DATA_DIR, 'da-final-drop-v2.json'), name: 'Da Final Drop The Genre Journey' },
    { file: path.join(DATA_DIR, 'da-final-drop-v3.json'), name: 'Da Final Drop Peak Hour Express' },
  ];

  const trackIdSet = new Set(tracks.map((t) => t.id));
  const results: Array<{ name: string; trackIds: string[] }> = [];

  for (const { file, name } of staticFiles) {
    try {
      const raw = await fs.readFile(file, 'utf-8');
      const entries: StaticPlaylistEntry[] = JSON.parse(raw);
      if (!Array.isArray(entries)) continue;
      const trackIds = entries
        .map((e) => e.id)
        .filter((id): id is string => typeof id === 'string' && trackIdSet.has(id));
      if (trackIds.length > 0) {
        results.push({ name, trackIds });
      }
    } catch {
      // Static playlist file missing or invalid — skip silently
    }
  }

  return results;
}

function createdAtSortValue(createdAt: string | null): number {
  if (!createdAt) return Number.POSITIVE_INFINITY;
  const ms = Date.parse(createdAt);
  return Number.isFinite(ms) ? ms : Number.POSITIVE_INFINITY;
}

function sortTrackIdsByCreatedAt(ids: string[], tracksById: Map<string, LibraryTrack>): string[] {
  return [...ids].sort((a, b) => {
    const ta = createdAtSortValue(tracksById.get(a)?.createdAt ?? null);
    const tb = createdAtSortValue(tracksById.get(b)?.createdAt ?? null);
    if (ta !== tb) return ta - tb;
    return a.localeCompare(b);
  });
}

function inferMusicalKeyFromMidiNotes(notes: number[]): string | null {
  if (notes.length < 8) return null;

  const histogram = Array.from({ length: 12 }, () => 0);
  for (const midi of notes) {
    if (!Number.isFinite(midi)) continue;
    const note = Math.round(midi);
    const pitchClass = ((note % 12) + 12) % 12;
    histogram[pitchClass] += 1;
  }

  const total = histogram.reduce((sum, n) => sum + n, 0);
  if (total < 8) return null;

  const majorProfile = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
  const minorProfile = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];
  const noteNames = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];

  let bestScore = -Infinity;
  let bestKey: string | null = null;

  const scoreProfile = (root: number, mode: 'Major' | 'Minor', profile: number[]): void => {
    let score = 0;
    for (let pc = 0; pc < 12; pc += 1) {
      score += histogram[pc] * profile[(pc - root + 12) % 12];
    }
    if (score > bestScore) {
      bestScore = score;
      bestKey = `${noteNames[root]} ${mode}`;
    }
  };

  for (let root = 0; root < 12; root += 1) {
    scoreProfile(root, 'Major', majorProfile);
    scoreProfile(root, 'Minor', minorProfile);
  }

  return bestKey;
}

function parseAubioNotesOutput(stdout: string): number[] {
  const notes: number[] = [];
  const lines = stdout.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const tokens = trimmed.split(/\s+/);
    if (tokens.length < 2) continue;
    const firstToken = tokens[0];
    const value = Number(firstToken);
    if (!Number.isFinite(value) || value <= 0) continue;
    notes.push(value);
  }
  return notes;
}

async function estimateMusicalKeyWithAubio(audioPath: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync('aubio', ['notes', '-i', audioPath], {
      timeout: 30000,
      maxBuffer: 1024 * 1024,
    });
    const notes = parseAubioNotesOutput(stdout);
    return inferMusicalKeyFromMidiNotes(notes);
  } catch {
    return null;
  }
}

function buildTrackContext(row: LibraryTrack): TrackContext | null {
  if (!row.id || !row.paths.wav) return null;
  const raw = row.metadata ?? null;

  const title = toTitleCase(row.parsed.title ?? row.title ?? row.id);
  const tagsText = `${row.parsed.tags ?? ''} ${row.parsed.displayTags ?? ''}`.trim();
  const promptText = `${row.parsed.prompt ?? ''}`.trim();
  const lyricsText = `${row.parsed.lyrics ?? ''}`.trim();
  const normalizedText = [title, tagsText, promptText, lyricsText].join(' ').toLowerCase();

  return {
    row,
    id: row.id.toLowerCase(),
    sourceWavPath: row.paths.wav,
    title,
    normalizedText,
    rawTask: row.parsed.task ?? '',
    isRemix: Boolean(row.parsed.isRemix),
    isPublic: Boolean(row.parsed.isPublic),
    isExplicit: Boolean(row.parsed.isExplicit),
    modelVersion: row.parsed.modelVersion ?? '',
    bpm: row.parsed.bpm,
    musicalKey: row.parsed.musicalKey,
  };
}

function collectCategories(ctx: TrackContext): string[] {
  const categories: string[] = [];
  const t = ctx.normalizedText;

  if (/\btrap|trapstep|drill|808s?\b/i.test(t)) categories.push('Genre - Trap');
  if (/\bhip\s*hop|rap|boom\s*bap|comedy\s*rap|spoken\s*word\b/i.test(t)) categories.push('Genre - Hip-Hop');
  if (/\bhouse|tech\s*house|deep\s*house|warehouse\b/i.test(t)) categories.push('Genre - House');
  if (/\bdub|reggae|dancehall|skank|riddim\b/i.test(t)) categories.push('Genre - Dub-Reggae');
  if (/\bjazz|soul|neo-?soul|funk|rhodes|swing|crooner\b/i.test(t)) categories.push('Genre - Jazz-Soul-Funk');
  if (/\brock|punk|metal|grunge|shred\b/i.test(t)) categories.push('Genre - Rock-Punk');
  if (/\belectronic|experimental|ambient|glitch|cinematic|left-?field|idm|lo-?fi\b/i.test(t)) categories.push('Genre - Electronic-Experimental');
  if (/\bpop|dance\s*pop|synth\s*pop|electro\s*pop\b/i.test(t)) categories.push('Genre - Pop');
  if (/\blatin|reggaeton|afro|afrobeats|bachata|cumbia|bossa|dem\s*bow\b/i.test(t)) categories.push('Genre - Latin-Afro-Global');

  if (/\bclub|dance|party|festival|night|ibiza|afterhours|rave|drop\b/i.test(t)) categories.push('Theme - Party-Club-Night');
  if (/\bai|code|coding|server|cloud|prompt|api|mobile|buffer|debug|compile\b/i.test(t)) categories.push('Theme - Tech-Internet-AI');
  if (/\bwork|money|tax|irs|office|enterprise|compliance|finance|build\b/i.test(t)) categories.push('Theme - Work-Money-Taxes');
  if (/\bcook|cooking|kitchen|chef|sandwich|baguette|egg|taco|flan|broccoli\b/i.test(t)) categories.push('Theme - Food-Cooking');
  if (/\bmountain|snow|beach|ocean|forest|tree|trip|sunset|island|road\b/i.test(t)) categories.push('Theme - Nature-Travel');
  if (/\blove|heart|baby|girl|boy|romance|kiss|relationship\b/i.test(t)) categories.push('Theme - Love-Relationships');
  if (/\bworld\s*ends|future|meaning|destiny|dream|utopia|life\s*force|soul\b/i.test(t)) categories.push('Theme - Existential-Reflective');
  if (/\bcomedy|absurd|joke|funny|weird|meme|chaos|mess\b/i.test(t)) categories.push('Theme - Humor-Absurdity');

  if (ctx.isRemix || /\bremix|re-dub|redub|edit|extended|extend|cover|infill\b/i.test(t) || /\bcover|extend|infill|fixed_infill|sample_condition|upsample\b/i.test(ctx.rawTask)) {
    categories.push('Property - Remix-Edit-Cover');
  }
  if (/\binstrumental\b/i.test(t)) categories.push('Property - Instrumental');
  if (ctx.isPublic) categories.push('Property - Public');
  if (ctx.isExplicit) categories.push('Property - Explicit');
  if (/^v5$/i.test(ctx.modelVersion)) categories.push('Property - Model-v5');
  if (/^v4/i.test(ctx.modelVersion)) categories.push('Property - Model-v4x');

  const hasDark = /\bdark|moody|ominous|brooding|gritty|haunting|shadow\b/i.test(t);
  const hasEuphoric = /\beuphoric|uplifting|anthemic|festival|ecstatic|triumph|glorious\b/i.test(t);
  const hasMelancholic = /\bmelancholic|sad|nostalgic|longing|heartbreak|lonely|tears\b/i.test(t);
  const hasPlayful = /\bplayful|quirky|funny|comedy|witty|goofy|absurd|meme\b/i.test(t);
  if (hasDark) categories.push('Mood - Dark');
  if (hasEuphoric) categories.push('Mood - Euphoric');
  if (hasMelancholic) categories.push('Mood - Melancholic');
  if (hasPlayful) categories.push('Mood - Playful');

  if (typeof ctx.bpm === 'number') {
    if (ctx.bpm < 80) {
      categories.push('BPM - <80');
      categories.push('Energy - Low');
    } else if (ctx.bpm <= 110) {
      categories.push('BPM - 80-110');
      categories.push('Energy - Mid');
    } else if (ctx.bpm <= 135) {
      categories.push('BPM - 110-135');
      if (/\bpeak|festival|anthem|banger|heavy\b/i.test(t)) categories.push('Energy - High');
      else categories.push('Energy - Mid');
    } else {
      categories.push('BPM - >135');
      categories.push('Energy - High');
    }
  }

  if (/\bpeak|festival|drop|rave|anthem\b/i.test(t) && typeof ctx.bpm === 'number' && ctx.bpm >= 120) {
    categories.push('Energy - Peak');
  }

  const openKey = toOpenKey(ctx.musicalKey);
  const mixGroup = keyMixGroupFromOpenKey(openKey);
  if (mixGroup) categories.push(`Key - ${mixGroup}`);
  if (categories.length === 0) categories.push('Other - Uncategorized');
  return [...new Set(categories)].sort((a, b) => a.localeCompare(b));
}

function normalizeCsvRow(row: CsvRow): {
  id: string;
  title: string | null;
  workspace: string | null;
  workspaceId: string | null;
  status: string | null;
  createdAt: string | null;
  duration: number | null;
  type: string | null;
  isStem: boolean | null;
  csvRaw: CsvRow;
} {
  const id = (row['ID'] ?? '').trim();
  const duration = row['Duration'] ? Number(row['Duration']) : null;
  const isStemRaw = row['Is Stem']?.toLowerCase();
  const isStem = isStemRaw === 'true' ? true : isStemRaw === 'false' ? false : null;

  return {
    id,
    title: row['Title'] ?? null,
    workspace: row['Workspace'] ?? null,
    workspaceId: row['Workspace ID'] ?? null,
    status: row['Status'] ?? null,
    createdAt: row['Created At'] ?? null,
    duration: Number.isFinite(duration) ? duration : null,
    type: row['Type'] || null,
    isStem,
    csvRaw: row,
  };
}

function isUploadTrackRow(row: { title: string | null }): boolean {
  const title = (row.title ?? '').trim();
  return /^uploaded file$/i.test(title);
}

function isStepTrackRow(row: { title: string | null }): boolean {
  const title = (row.title ?? '').trim();
  return /^(replace|step)\b/i.test(title);
}

function findTrackIdsInFilename(fileName: string): string[] {
  const matches = fileName.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi);
  return matches ? matches.map((m) => m.toLowerCase()) : [];
}

function formatExtInf(duration: number | null, title: string): string {
  const seconds = typeof duration === 'number' && Number.isFinite(duration) ? Math.max(0, Math.round(duration)) : -1;
  return `#EXTINF:${seconds},TOKUDU - ${title}`;
}

async function copyFileFresh(sourceAbsPath: string, targetAbsPath: string): Promise<void> {
  await ensureDir(path.dirname(targetAbsPath));
  try {
    await fs.rm(targetAbsPath, { force: true });
  } catch {
    // best effort
  }
  await fs.copyFile(sourceAbsPath, targetAbsPath);
}

function isTrackProcessComplete(track: LibraryTrack): boolean {
  const needsMp3 = track.availability.wav;
  const hasMp3IfNeeded = !needsMp3 || track.availability.mp3;
  const hasMetadataIfTxt = !track.availability.txt || Boolean(track.metadata);
  const bpmResolvedOrAttempted = track.parsed.bpmSource !== null;
  return Boolean(track.checkpoints.processedAt) && hasMp3IfNeeded && hasMetadataIfTxt && bpmResolvedOrAttempted;
}

async function stepImport(state: LibraryState, existing: LibraryState | null): Promise<void> {
  logStep('Importing tracks...');

  const dataFiles = await fs.readdir(DATA_DIR);
  const dataFilePathSet = new Set(dataFiles.map((file) => path.join(DATA_DIR, file)));
  const idToWav = new Map<string, string[]>();
  const idToTxt = new Map<string, string[]>();

  for (const file of dataFiles) {
    const lower = file.toLowerCase();
    const ids = findTrackIdsInFilename(file);
    if (ids.length === 0) continue;

    for (const id of ids) {
      if (lower.endsWith('.wav')) {
        if (!idToWav.has(id)) idToWav.set(id, []);
        idToWav.get(id)!.push(path.join(DATA_DIR, file));
      } else if (lower.endsWith('.wav.txt')) {
        if (!idToTxt.has(id)) idToTxt.set(id, []);
        idToTxt.get(id)!.push(path.join(DATA_DIR, file));
      }
    }
  }

  for (const map of [idToWav, idToTxt]) {
    for (const [key, arr] of map) {
      map.set(key, arr.sort((a, b) => a.localeCompare(b)));
    }
  }

  const csvText = await fs.readFile(path.join(DATA_DIR, CSV_FILE), 'utf8');
  const rows = parse(csvText, {
    columns: true,
    skip_empty_lines: true,
    relax_column_count: true,
  }) as CsvRow[];
  logInfo(`CSV rows: ${rows.length}`);

  const existingById = new Map<string, LibraryTrack>();
  for (const track of existing?.tracks ?? []) existingById.set(track.id.toLowerCase(), track);

  const bar = makeProgressBar('Import', rows.length);
  const imported: LibraryTrack[] = [];
  let stemSkipped = 0;
  let uploadSkipped = 0;
  let stepSkipped = 0;
  let missingWavOrTxt = 0;
  const missingRows: Array<{ id: string; wav: boolean; txt: boolean; mp3: boolean }> = [];

  for (const row of rows) {
    bar.increment();
    const normalized = normalizeCsvRow(row);
    if (!normalized.id) continue;
    if (normalized.isStem === true) {
      stemSkipped += 1;
      continue;
    }
    if (isUploadTrackRow(normalized)) {
      uploadSkipped += 1;
      continue;
    }
    if (isStepTrackRow(normalized)) {
      stepSkipped += 1;
      continue;
    }

    const id = normalized.id.toLowerCase();
    const prev = existingById.get(id);

    const wav = idToWav.get(id)?.[0] ?? null;
    const txt = idToTxt.get(id)?.[0] ?? null;
    const canonicalMp3 = wav ? wav.replace(/\.wav$/i, '.mp3') : null;
    const mp3 =
      canonicalMp3 && dataFilePathSet.has(canonicalMp3)
        ? canonicalMp3
        : (prev?.paths.mp3 === canonicalMp3 ? prev?.paths.mp3 : null);

    const hasWav = Boolean(wav);
    const hasTxt = Boolean(txt);
    const hasMp3 = Boolean(mp3);
    if (!hasWav || !hasTxt) {
      missingWavOrTxt += 1;
      missingRows.push({ id, wav: hasWav, txt: hasTxt, mp3: hasMp3 });
    }

    const track: LibraryTrack = {
      id,
      title: normalized.title,
      workspace: normalized.workspace,
      workspaceId: normalized.workspaceId,
      status: normalized.status,
      createdAt: normalized.createdAt,
      duration: normalized.duration,
      type: normalized.type,
      isStem: normalized.isStem,
      paths: {
        wav,
        txt,
        mp3,
        traktor: prev?.paths.traktor ?? null,
      },
      availability: {
        wav: Boolean(wav),
        txt: Boolean(txt),
        mp3: Boolean(mp3),
        exported: prev?.availability.exported ?? false,
      },
      checkpoints: {
        importedAt: prev?.checkpoints.importedAt ?? nowIso(),
        processedAt: prev?.checkpoints.processedAt ?? null,
        analyzedAt: prev?.checkpoints.analyzedAt ?? null,
        exportedAt: prev?.checkpoints.exportedAt ?? null,
      },
      parsed: {
        title: prev?.parsed?.title ?? null,
        artist: prev?.parsed?.artist ?? null,
        year: prev?.parsed?.year ?? null,
        prompt: prev?.parsed?.prompt ?? null,
        lyrics: prev?.parsed?.lyrics ?? null,
        tags: prev?.parsed?.tags ?? null,
        displayTags: prev?.parsed?.displayTags ?? null,
        modelName: prev?.parsed?.modelName ?? null,
        modelVersion: prev?.parsed?.modelVersion ?? null,
        task: prev?.parsed?.task ?? null,
        isRemix: prev?.parsed?.isRemix ?? null,
        isPublic: prev?.parsed?.isPublic ?? null,
        isExplicit: prev?.parsed?.isExplicit ?? null,
        musicalKey: prev?.parsed?.musicalKey ?? null,
        keySource: (prev?.parsed as { keySource?: LibraryTrack['parsed']['keySource'] } | undefined)?.keySource ?? null,
        bpm: prev?.parsed?.bpm ?? null,
        bpmSource: prev?.parsed?.bpmSource ?? null,
      },
      categories: prev?.categories ?? [],
      metadata: prev?.metadata,
      csvRaw: normalized.csvRaw,
      updatedAt: nowIso(),
    };

    imported.push(track);
  }
  bar.stop();

  state.tracks = imported;
  state.steps.import = nowIso();
  state.updatedAt = nowIso();

  const missingTxtLines = ['trackId,mp3Found,wavFound,txtFound'];
  for (const row of missingRows) {
    missingTxtLines.push(`${row.id},${row.mp3},${row.wav},${row.txt},`);
  }
  await fs.writeFile(path.join(DATA_DIR, 'missing-tracks.txt'), `${missingTxtLines.join('\n')}\n`, 'utf8');

  await writeLibraryState(state);
  logOk(
    `Import complete: ${state.tracks.length} tracks, wav=${state.tracks.filter((t) => t.availability.wav).length}, txt=${state.tracks.filter((t) => t.availability.txt).length}, mp3=${state.tracks.filter((t) => t.availability.mp3).length}`,
  );
  logInfo(`Skipped tracks: stems=${stemSkipped}, uploads=${uploadSkipped}, steps=${stepSkipped}`);
  logInfo(`Missing assets (non-step/non-upload): ${missingWavOrTxt}`);
}

async function stepProcess(state: LibraryState): Promise<void> {
  logStep('Processing tracks...');

  const bar = makeProgressBar('Process', state.tracks.length);
  let savedCount = 0;
  let mp3Generated = 0;

  for (const track of state.tracks) {
    bar.increment();

    // Legacy compatibility: previous versions could derive key from prompt/tags text.
    // If source is unknown, clear it so only metadata/related/audio analysis repopulates it.
    if (track.parsed.musicalKey !== null && track.parsed.keySource === null) {
      track.parsed.musicalKey = null;
    }

    const beforeHash = JSON.stringify({
      paths: track.paths,
      availability: track.availability,
      checkpoints: track.checkpoints,
      parsed: track.parsed,
      metadata: track.metadata,
      updatedAt: track.updatedAt,
    });

    if (track.availability.wav && track.paths.wav) {
      const expectedMp3Rel = track.paths.wav.replace(/\.wav$/i, '.mp3');
      track.paths.mp3 = expectedMp3Rel;
      track.availability.mp3 = await fileExists(expectedMp3Rel);

      const wavAbs = path.resolve(track.paths.wav);
      const res = await ensureMp3FromWav(wavAbs);
      if (res.generated) mp3Generated += 1;
      if (res.mp3AbsPath) {
        track.paths.mp3 = expectedMp3Rel;
        track.availability.mp3 = true;
      }
    }

    if (track.paths.txt && (await fileExists(track.paths.txt))) {
      const txtContent = await fs.readFile(track.paths.txt, 'utf8');
      const parsed = parseTxtMetadata(txtContent);
      const raw = parsed.rawApiResponse;

      if (raw) {
        track.metadata = raw;
      }

      track.parsed.title = parsed.trackInformation.title;
      track.parsed.artist = parsed.trackInformation.artist;
      track.parsed.year = parsed.trackInformation.year;
      track.parsed.prompt = parsed.creationDetails.prompt;
      track.parsed.lyrics = parsed.lyrics || null;

      const rawMeta = (raw?.['metadata'] ?? null) as Record<string, unknown> | null;
      track.parsed.tags = typeof rawMeta?.['tags'] === 'string' ? rawMeta['tags'] : null;
      track.parsed.displayTags = typeof raw?.['display_tags'] === 'string' ? (raw['display_tags'] as string) : null;
      track.parsed.modelName = typeof raw?.['model_name'] === 'string' ? (raw['model_name'] as string) : null;
      track.parsed.modelVersion = typeof raw?.['major_model_version'] === 'string' ? (raw['major_model_version'] as string) : null;
      track.parsed.task = typeof rawMeta?.['task'] === 'string' ? (rawMeta['task'] as string) : null;
      track.parsed.isRemix = typeof rawMeta?.['is_remix'] === 'boolean' ? (rawMeta['is_remix'] as boolean) : null;
      track.parsed.isPublic = typeof raw?.['is_public'] === 'boolean' ? (raw['is_public'] as boolean) : null;
      track.parsed.isExplicit = typeof raw?.['explicit'] === 'boolean' ? (raw['explicit'] as boolean) : null;

      if (!track.parsed.musicalKey) {
        track.parsed.musicalKey = extractMusicalKeyFromRawMetadata(raw);
        if (track.parsed.musicalKey) track.parsed.keySource = 'metadata';
      }

      if (track.parsed.bpm === null) {
        const bpm = extractBpmFromRawMetadata(raw);
        if (bpm !== null) {
          track.parsed.bpm = bpm;
          track.parsed.bpmSource = 'metadata';
        }
      }

      if (track.parsed.bpm === null && track.parsed.bpmSource === null) {
        track.parsed.bpmSource = 'none';
      }
    }

    if (!track.availability.txt && track.parsed.bpmSource === null) {
      track.parsed.bpmSource = 'none';
    }

    track.checkpoints.processedAt = nowIso();
    track.updatedAt = nowIso();

    const afterHash = JSON.stringify({
      paths: track.paths,
      availability: track.availability,
      checkpoints: track.checkpoints,
      parsed: track.parsed,
      metadata: track.metadata,
      updatedAt: track.updatedAt,
    });

    if (beforeHash !== afterHash) {
      await writeLibraryState(state);
      savedCount += 1;
    }
  }
  bar.stop();
  logOk(`Per-track processing complete: checkpoints saved=${savedCount}, mp3 generated=${mp3Generated}`);

  const expectedTraktorTargets = computeExpectedTraktorTrackPaths(state.tracks);
  for (const track of state.tracks) {
    const expectedAbs = expectedTraktorTargets.get(track.id);
    if (!expectedAbs) continue;
    track.paths.traktor = path.relative(process.cwd(), expectedAbs);
  }

  logStep('Backfilling BPM/Key from exported Traktor tags...');
  const exportDirExists = await fileExists(getExportTracksDir());
  let traktorChanged = 0;
  if (exportDirExists) {
    const traktorPending = state.tracks.filter((t) => t.paths.traktor !== null);
    const traktorBar = makeProgressBar('Traktor', traktorPending.length);

    for (const track of traktorPending) {
      traktorBar.increment();
      const traktorPath = track.paths.traktor ? path.resolve(track.paths.traktor) : null;
      if (!traktorPath || !(await fileExists(traktorPath))) continue;

      const tags = await readId3TempoAndKey(traktorPath);
      let changedTrack = false;

      if (tags.bpm !== null && track.parsed.bpm !== tags.bpm) {
        track.parsed.bpm = tags.bpm;
        track.parsed.bpmSource = 'traktor';
        changedTrack = true;
      }

      if (tags.musicalKey !== null && track.parsed.musicalKey !== tags.musicalKey) {
        track.parsed.musicalKey = tags.musicalKey;
        track.parsed.keySource = 'traktor';
        changedTrack = true;
      }

      if (changedTrack) {
        track.updatedAt = nowIso();
        traktorChanged += 1;
        await writeLibraryState(state);
      }
    }
    traktorBar.stop();
  }
  logOk(`Traktor tag backfill complete: ${traktorChanged}`);

  logStep('Backfilling BPM from related tracks...');
  const byId = new Map<string, LibraryTrack>();
  const byTitle = new Map<string, LibraryTrack[]>();
  const byBaseTitle = new Map<string, LibraryTrack[]>();
  for (const t of state.tracks) {
    byId.set(t.id, t);
    const titleNorm = normalizeTitle(t.title ?? t.parsed.title ?? '');
    if (titleNorm) {
      if (!byTitle.has(titleNorm)) byTitle.set(titleNorm, []);
      byTitle.get(titleNorm)!.push(t);
      const base = baseTitle(titleNorm);
      if (base) {
        if (!byBaseTitle.has(base)) byBaseTitle.set(base, []);
        byBaseTitle.get(base)!.push(t);
      }
    }
  }

  let relatedChanged = 0;
  let pass = 0;
  let changed = true;
  while (changed) {
    changed = false;
    pass += 1;
    const passBar = makeProgressBar(`Related p${pass}`, state.tracks.length);

    for (const track of state.tracks) {
      passBar.increment();
      if (track.parsed.bpm !== null) continue;

      const candidates: number[] = [];
      for (const refId of collectReferencedIds(track.metadata ?? null)) {
        const ref = byId.get(refId);
        if (ref && typeof ref.parsed.bpm === 'number' && ref.id !== track.id) {
          candidates.push(ref.parsed.bpm);
        }
      }

      if (candidates.length === 0) {
        const tNorm = normalizeTitle(track.title ?? track.parsed.title ?? '');
        if (tNorm) {
          for (const sibling of byTitle.get(tNorm) ?? []) {
            if (sibling.id !== track.id && sibling.parsed.bpm !== null) candidates.push(sibling.parsed.bpm);
          }
        }
      }

      if (candidates.length === 0) {
        const tNorm = normalizeTitle(track.title ?? track.parsed.title ?? '');
        const tBase = baseTitle(tNorm);
        if (tBase) {
          for (const sibling of byBaseTitle.get(tBase) ?? []) {
            if (sibling.id !== track.id && sibling.parsed.bpm !== null) candidates.push(sibling.parsed.bpm);
          }
        }
      }

      const inferred = modeNumber(candidates);
      if (inferred !== null) {
        track.parsed.bpm = inferred;
        track.parsed.bpmSource = 'related';
        track.updatedAt = nowIso();
        changed = true;
        relatedChanged += 1;
        await writeLibraryState(state);
      }
    }
    passBar.stop();
  }
  logOk(`Related-track BPM backfill complete: ${relatedChanged}`);

  logStep('Backfilling Musical Key from related tracks...');
  let keyRelatedChanged = 0;
  for (const track of state.tracks) {
    if (track.parsed.musicalKey) continue;

    const candidates: string[] = [];
    for (const refId of collectReferencedIds(track.metadata ?? null)) {
      const ref = byId.get(refId);
      if (ref && ref.parsed.musicalKey && ref.id !== track.id) {
        candidates.push(ref.parsed.musicalKey);
      }
    }

    if (candidates.length === 0) {
      const tNorm = normalizeTitle(track.title ?? track.parsed.title ?? '');
      if (tNorm) {
        for (const sibling of byTitle.get(tNorm) ?? []) {
          if (sibling.id !== track.id && sibling.parsed.musicalKey) candidates.push(sibling.parsed.musicalKey);
        }
      }
    }

    if (candidates.length === 0) {
      const tNorm = normalizeTitle(track.title ?? track.parsed.title ?? '');
      const tBase = baseTitle(tNorm);
      if (tBase) {
        for (const sibling of byBaseTitle.get(tBase) ?? []) {
          if (sibling.id !== track.id && sibling.parsed.musicalKey) candidates.push(sibling.parsed.musicalKey);
        }
      }
    }

    const keyCounts = new Map<string, number>();
    for (const value of candidates) keyCounts.set(value, (keyCounts.get(value) ?? 0) + 1);
    let bestKey: string | null = null;
    let bestCount = 0;
    for (const [value, count] of keyCounts.entries()) {
      if (count > bestCount || (count === bestCount && (bestKey === null || value < bestKey))) {
        bestKey = value;
        bestCount = count;
      }
    }

    if (bestKey) {
      track.parsed.musicalKey = bestKey;
      track.parsed.keySource = 'related';
      track.updatedAt = nowIso();
      keyRelatedChanged += 1;
      await writeLibraryState(state);
    }
  }
  logOk(`Related-track key backfill complete: ${keyRelatedChanged}`);

  logStep('Backfilling Musical Key from audio analysis...');
  const keyPending = state.tracks.filter((t) => t.parsed.musicalKey === null && t.paths.wav !== null);
  const keyBar = makeProgressBar('Key', keyPending.length);
  let keyAubioChanged = 0;

  for (const track of keyPending) {
    keyBar.increment();
    if (!track.paths.wav) continue;
    const detected = await estimateMusicalKeyWithAubio(path.resolve(track.paths.wav));
    if (detected !== null) {
      track.parsed.musicalKey = detected;
      track.parsed.keySource = 'aubio';
      track.updatedAt = nowIso();
      keyAubioChanged += 1;
      await writeLibraryState(state);
    } else if (track.parsed.keySource === null) {
      track.parsed.keySource = 'none';
      track.updatedAt = nowIso();
      await writeLibraryState(state);
    }
  }
  keyBar.stop();
  logOk(`Aubio key backfill complete: ${keyAubioChanged}`);

  logStep('Backfilling BPM from audio analysis...');
  const aubioPending = state.tracks.filter((t) => t.parsed.bpm === null && t.paths.wav !== null);
  const aubioBar = makeProgressBar('Aubio', aubioPending.length);
  let aubioChanged = 0;

  for (const track of aubioPending) {
    aubioBar.increment();
    if (!track.paths.wav) continue;
    const bpm = await estimateBpmWithAubio(path.resolve(track.paths.wav));
    if (bpm !== null) {
      track.parsed.bpm = bpm;
      track.parsed.bpmSource = 'aubio';
      track.updatedAt = nowIso();
      aubioChanged += 1;
      await writeLibraryState(state);
    } else if (track.parsed.bpmSource === null) {
      track.parsed.bpmSource = 'none';
      track.updatedAt = nowIso();
      await writeLibraryState(state);
    }
  }
  aubioBar.stop();

  const beforePrune = state.tracks.length;
  state.tracks = state.tracks.filter(
    (track) => track.availability.wav && track.availability.txt && track.availability.mp3 && Boolean(track.paths.mp3),
  );
  const pruned = beforePrune - state.tracks.length;
  if (pruned > 0) {
    logInfo(`Skipping ${pruned} tracks after processing (missing wav/txt/mp3)`);
  }

  state.steps.process = nowIso();
  await writeLibraryState(state);
  logOk(`Aubio BPM backfill complete: ${aubioChanged}`);
}

function splitGroup(name: string): { key: string; value: string } {
  const parts = name.split(' - ');
  if (parts.length >= 2) {
    return { key: parts[0], value: parts.slice(1).join(' - ') };
  }
  return { key: 'Other', value: name };
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

async function stepAnalyze(state: LibraryState): Promise<void> {
  logStep('Analyzing tracks...');
  const bar = makeProgressBar('Analyze', state.tracks.length);

  const categoryToIds = new Map<string, string[]>();
  let availableCount = 0;

  for (const track of state.tracks) {
    bar.increment();
    const ctx = buildTrackContext(track);
    const categories = ctx ? collectCategories(ctx) : ['Other - Uncategorized'];

    track.categories = categories;
    track.checkpoints.analyzedAt = nowIso();
    track.updatedAt = nowIso();

    if (track.availability.mp3) availableCount += 1;

    for (const category of categories) {
      if (!categoryToIds.has(category)) categoryToIds.set(category, []);
      categoryToIds.get(category)!.push(track.id);
    }
  }
  bar.stop();

  const tracksById = new Map(state.tracks.map((t) => [t.id, t]));
  const sortIdsByCreatedAsc = (ids: string[]): string[] =>
    sortTrackIdsByCreatedAt(ids, tracksById);

  const playlists: LibraryPlaylist[] = [];
  const allTrackIds = sortIdsByCreatedAsc(state.tracks.map((t) => t.id));
  playlists.push({
    id: 'collection-all-tracks',
    name: 'All Tracks',
    groupKey: 'Collection',
    groupValue: 'All Tracks',
    trackIds: allTrackIds,
    trackCount: allTrackIds.length,
    availableTrackCount: state.tracks.filter((t) => t.availability.mp3).length,
    path: null,
    exportPath: null,
    updatedAt: nowIso(),
  });

  for (const category of [...categoryToIds.keys()].sort((a, b) => a.localeCompare(b))) {
    const ids = sortIdsByCreatedAsc(categoryToIds.get(category) ?? []);
    const group = splitGroup(category);
    playlists.push({
      id: slugify(category),
      name: category,
      groupKey: group.key,
      groupValue: group.value,
      trackIds: ids,
      trackCount: ids.length,
      availableTrackCount: ids.filter((id) => state.tracks.find((t) => t.id === id)?.availability.mp3).length,
      path: null,
      exportPath: null,
      updatedAt: nowIso(),
    });
  }

  const djSets = generateDjSetPlaylists(state.tracks);
  for (const set of djSets) {
    playlists.push({
      id: slugify(`dj-sets-${set.name}`),
      name: `DJ Sets - ${set.name}`,
      groupKey: 'DJ Sets',
      groupValue: set.name,
      trackIds: set.trackIds,
      trackCount: set.trackIds.length,
      availableTrackCount: set.trackIds.filter((id) => state.tracks.find((t) => t.id === id)?.availability.mp3).length,
      path: null,
      exportPath: null,
      updatedAt: nowIso(),
    });
  }

  const staticSets = await loadStaticPlaylists(state.tracks);
  for (const set of staticSets) {
    playlists.push({
      id: slugify(`dj-sets-${set.name}`),
      name: `DJ Sets - ${set.name}`,
      groupKey: 'DJ Sets',
      groupValue: set.name,
      trackIds: set.trackIds,
      trackCount: set.trackIds.length,
      availableTrackCount: set.trackIds.filter((id) => state.tracks.find((t) => t.id === id)?.availability.mp3).length,
      path: null,
      exportPath: null,
      updatedAt: nowIso(),
    });
  }

  state.playlists = playlists;
  state.steps.analyze = nowIso();
  await writeLibraryState(state);
  logOk(`Analyze complete: playlists=${state.playlists.length}, tracks with mp3=${availableCount}`);
}

async function stepExport(state: LibraryState): Promise<void> {
  logStep('Exporting Traktor library...');

  // Keep existing exported tracks intact so Traktor-written tags remain in place.
  await fs.rm(getExportPlaylistsDir(), { recursive: true, force: true });
  await ensureDir(getExportTracksDir());
  await ensureDir(getExportPlaylistsDir());

  const expectedTraktorTargets = computeExpectedTraktorTrackPaths(state.tracks);
  const idToExportRel = new Map<string, string>();

  const trackBar = makeProgressBar('Export trk', state.tracks.length);
  let exportedTrackCount = 0;

  for (const track of state.tracks) {
    trackBar.increment();
    track.paths.traktor = null;
    track.availability.exported = false;
    track.checkpoints.exportedAt = null;

    if (!track.paths.mp3) continue;
    if (!(await fileExists(track.paths.mp3))) continue;

    const sourceMp3Abs = path.resolve(track.paths.mp3);
    const targetAbs = expectedTraktorTargets.get(track.id);
    if (!targetAbs) continue;
    if (!(await fileExists(targetAbs))) {
      await copyFileFresh(sourceMp3Abs, targetAbs);
    }

    const rel = path.relative(process.cwd(), targetAbs);
    track.paths.traktor = rel;
    track.availability.exported = true;
    track.checkpoints.exportedAt = nowIso();
    track.updatedAt = nowIso();
    idToExportRel.set(track.id, path.relative(getExportPlaylistsDir(), targetAbs));
    exportedTrackCount += 1;
  }
  trackBar.stop();

  const playlistBar = makeProgressBar('Export pls', state.playlists.length);
  for (const playlist of state.playlists) {
    playlistBar.increment();
    const lines: string[] = ['#EXTM3U'];

    for (const id of playlist.trackIds) {
      const track = state.tracks.find((t) => t.id === id);
      const rel = idToExportRel.get(id);
      if (!track || !rel) continue;
      lines.push(formatExtInf(track.duration, toTitleCase(track.parsed.title ?? track.title ?? track.id)));
      lines.push(rel);
    }

    const fileName = `${playlist.name}.m3u8`;
    const abs = path.join(getExportPlaylistsDir(), fileName);
    await fs.writeFile(abs, `${lines.join('\n')}\n`, 'utf8');
    playlist.exportPath = path.relative(process.cwd(), abs);
    playlist.path = playlist.exportPath;
    playlist.updatedAt = nowIso();
  }
  playlistBar.stop();

  await fs.rm(LIBRARY_ZIP, { force: true });
  try {
    const zipItems = ['library.json', 'library.html'];
    const traktorRelative = path.relative(DATA_DIR, getExportDir());
    // Include traktor dir in zip only if it's inside the build directory
    if (!traktorRelative.startsWith('..') && !path.isAbsolute(traktorRelative)) {
      zipItems.unshift(traktorRelative);
    }
    await execFileAsync('zip', ['-r', path.basename(LIBRARY_ZIP), ...zipItems], {
      cwd: DATA_DIR,
      timeout: 5 * 60 * 1000,
      maxBuffer: 10 * 1024 * 1024,
    });
  } catch (error) {
    throw new Error(`Failed to create ${LIBRARY_ZIP}: ${error instanceof Error ? error.message : String(error)}`);
  }

  state.steps.export = nowIso();
  await writeLibraryState(state);
  logOk(`Export complete: tracks=${exportedTrackCount}, playlists=${state.playlists.length}, zip=${path.resolve(LIBRARY_ZIP)}`);
}

async function stepReport(state: LibraryState): Promise<void> {
  logStep('Generating HTML report...');

  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>TOKUDU Library Report</title>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@shoelace-style/shoelace@2.20.1/cdn/themes/light.css" />
  <script type="module" src="https://cdn.jsdelivr.net/npm/@shoelace-style/shoelace@2.20.1/cdn/shoelace-autoloader.js"></script>
  <style>
    body { margin: 0; font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif; background:#f5f7fb; color:#111827; }
    .layout { display:grid; grid-template-columns: 320px 1fr; min-height:100vh; }
    aside { background:#111827; color:#f9fafb; padding:16px; overflow:auto; }
    main { padding:20px; overflow:auto; }
    table { width:100%; border-collapse: collapse; background:white; border:1px solid #e5e7eb; }
    th, td { padding:8px 10px; border-bottom:1px solid #e5e7eb; font-size:12px; text-align:left; white-space:nowrap; }
    .num-right { text-align:right; }
    th.sortable { cursor:pointer; user-select:none; }
    .sort-label { display:inline-flex; align-items:center; gap:6px; }
    .sort-chevron { font-size:13px; color:#9ca3af; line-height:1; }
    th.sort-active .sort-chevron { color:#2563eb; }
    tr:hover { background:#f9fafb; }
    pre { white-space: pre-wrap; background:#0f172a; color:#e2e8f0; padding:10px; border-radius:8px; font-size:11px; }
    .playlist-item { margin: 4px 0; padding: 6px 8px; border-radius: 8px; cursor: pointer; display:flex; align-items:center; justify-content:space-between; gap:8px; }
    .playlist-item:hover { background: #1f2937; }
    .playlist-item.active { background: #2563eb; color: white; }
    .playlist-group { margin-top: 18px; margin-bottom: 8px; font-size: 10px; font-weight: 400; letter-spacing: 0.08em; text-transform: uppercase; color: #9ca3af; }
    .playlist-name { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .playlist-count { min-width: 28px; text-align:center; font-size:11px; padding:1px 8px; border-radius:999px; background: rgba(255,255,255,0.16); color: #f9fafb; }
    .playlist-item.active .playlist-count { background: rgba(255,255,255,0.28); }
    .toolbar { display:flex; align-items:center; gap:12px; margin: 8px 0 16px; }
    .badge-wrap { display:flex; flex-wrap:wrap; gap:6px; }
    .badge { display:inline-block; padding:2px 8px; border-radius:999px; font-size:11px; border:1px solid rgba(0,0,0,0.08); }
    .play-btn {
      width: 28px;
      height: 28px;
      border: 1px solid #d1d5db;
      background: #fff;
      color: #111827;
      border-radius: 999px;
      padding: 0;
      font-size: 13px;
      line-height: 1;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
    }
    .play-btn:hover { background:#f3f4f6; }
    .play-btn:disabled { cursor:not-allowed; color:#9ca3af; background:#f9fafb; }
    .track-title { font-size:14px; font-weight:700; }
    .cell-wrap { white-space: normal; overflow-wrap: anywhere; }
    .mono { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace; font-variant-numeric: tabular-nums; }
    .key-badge { display:inline-block; padding:2px 8px; border-radius:999px; font-size:11px; border:1px solid rgba(0,0,0,0.12); font-weight:600; }
    tr.row-private { opacity: 0.9; }
    .pub-badge { display:inline-block; font-size:10px; font-weight:700; letter-spacing:0.04em; border-radius:999px; padding:2px 8px; border:1px solid transparent; }
    .pub-public { background:#dcfce7; color:#166534; border-color:#86efac; }
    .pub-private { background:#f3f4f6; color:#6b7280; border-color:#d1d5db; }
  </style>
</head>
<body>
  <div class="layout">
    <aside>
      <h2 style="margin-top:0">Playlists</h2>
      <div id="playlistList"></div>
    </aside>
    <main>
      <div class="toolbar" style="justify-content:space-between; margin-bottom:6px;">
        <h3 style="margin:0;">Tracks</h3>
        <div style="display:flex; align-items:center; gap:14px;">
          <label style="display:flex; align-items:center; gap:8px; font-size:13px; white-space:nowrap;">
            <input type="checkbox" id="hidePrivateToggle" />
            Hide private tracks
          </label>
        </div>
      </div>
      <div class="toolbar" style="margin-top:0;">
        <div id="activeFilter" style="font-size:13px; color:#6b7280;"></div>
      </div>
      <table>
        <thead>
          <tr>
            <th class="sortable num-right" data-sort="position"><span class="sort-label">Position <span class="sort-chevron"></span></span></th>
            <th class="sortable" data-sort="player"><span class="sort-label">Player <span class="sort-chevron"></span></span></th>
            <th class="sortable" data-sort="title"><span class="sort-label">Title <span class="sort-chevron"></span></span></th>
            <th class="sortable" data-sort="length"><span class="sort-label">Length <span class="sort-chevron"></span></span></th>
            <th class="sortable" data-sort="bpm"><span class="sort-label">BPM <span class="sort-chevron"></span></span></th>
            <th class="sortable" data-sort="key"><span class="sort-label">Key <span class="sort-chevron"></span></span></th>
            <th class="sortable" data-sort="tags"><span class="sort-label">Tags <span class="sort-chevron"></span></span></th>
            <th class="sortable" data-sort="created"><span class="sort-label">Created <span class="sort-chevron"></span></span></th>
            <th class="sortable" data-sort="published"><span class="sort-label">Published <span class="sort-chevron"></span></span></th>
            <th class="sortable" data-sort="plays"><span class="sort-label">Plays <span class="sort-chevron"></span></span></th>
          </tr>
        </thead>
        <tbody id="trackRows"></tbody>
      </table>
    </main>
  </div>
  <script>
    const data = ${JSON.stringify({ tracks: state.tracks, playlists: state.playlists })};

    const tracks = data.tracks || [];
    const playlists = data.playlists || [];

    const playlistList = document.getElementById('playlistList');
    const tbody = document.getElementById('trackRows');
    const hidePrivateToggle = document.getElementById('hidePrivateToggle');
    const activeFilter = document.getElementById('activeFilter');
    const sortHeaders = Array.from(document.querySelectorAll('th.sortable'));
    const player = new Audio();

    let selectedPlaylistId = 'collection-all-tracks';
    let currentTrackId = null;
    let sortKey = 'position';
    let sortDir = 'asc';
    let currentPositionMap = new Map();

    function getAudioSrc(t) {
      const mp3Path = t?.paths?.mp3;
      if (!mp3Path || !t?.availability?.mp3) return null;
      const clean = String(mp3Path).replace(/^\\.\\//, '');
      return '../' + clean;
    }

    function stopPlayback() {
      player.pause();
      player.currentTime = 0;
      currentTrackId = null;
      renderTracks();
    }

    function togglePlayback(t) {
      const src = getAudioSrc(t);
      if (!src) return;

      if (currentTrackId === t.id) {
        stopPlayback();
        return;
      }

      player.pause();
      player.currentTime = 0;
      player.src = src;
      currentTrackId = t.id;
      player.play().catch(() => {
        currentTrackId = null;
      }).finally(() => {
        renderTracks();
      });
      renderTracks();
    }

    player.addEventListener('ended', () => {
      currentTrackId = null;
      renderTracks();
    });

    function hashString(str) {
      let h = 0;
      for (let i = 0; i < str.length; i++) h = ((h << 5) - h) + str.charCodeAt(i);
      return Math.abs(h);
    }

    function badgeColor(label) {
      const hue = hashString(label) % 360;
      return { bg: 'hsl(' + hue + ' 85% 92%)', fg: 'hsl(' + hue + ' 50% 28%)' };
    }

    function toOpenKey(musicalKey) {
      if (!musicalKey) return null;
      const match = String(musicalKey).trim().match(/^([A-G])([#b]?)[\\s_-]+(Major|Minor)$/i);
      if (!match) return null;
      const base = match[1].toUpperCase();
      const accidental = match[2] || '';
      const mode = match[3].toLowerCase() === 'major' ? 'major' : 'minor';
      const note = base + accidental;
      const majorMap = { C:'1d', G:'2d', D:'3d', A:'4d', E:'5d', B:'6d', 'F#':'7d', Gb:'7d', 'C#':'8d', Db:'8d', 'G#':'9d', Ab:'9d', 'D#':'10d', Eb:'10d', 'A#':'11d', Bb:'11d', F:'12d' };
      const minorMap = { A:'1m', E:'2m', B:'3m', 'F#':'4m', Gb:'4m', 'C#':'5m', Db:'5m', 'G#':'6m', Ab:'6m', 'D#':'7m', Eb:'7m', 'A#':'8m', Bb:'8m', F:'9m', C:'10m', G:'11m', D:'12m' };
      return mode === 'major' ? (majorMap[note] || null) : (minorMap[note] || null);
    }

    function formatDuration(seconds) {
      if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds < 0) return '';
      const rounded = Math.round(seconds);
      const m = Math.floor(rounded / 60);
      const s = String(rounded % 60).padStart(2, '0');
      return m + ':' + s;
    }

    function formatCreatedDate(value) {
      if (!value) return '';
      const d = new Date(value);
      if (Number.isNaN(d.getTime())) return '';
      return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(d);
    }

    function normalizeSortText(value) {
      return String(value || '').toLowerCase();
    }

    function getSortValue(t, key) {
      switch (key) {
        case 'position': return currentPositionMap.get(t?.id) ?? Number.MAX_SAFE_INTEGER;
        case 'player': return t?.availability?.mp3 ? 1 : 0;
        case 'title': return normalizeSortText(t?.parsed?.title || t?.title || t?.id || '');
        case 'length': return Number.isFinite(t?.duration) ? Number(t.duration) : -1;
        case 'bpm': return typeof t?.parsed?.bpm === 'number' ? Math.round(t.parsed.bpm) : -1;
        case 'key': return normalizeSortText(toOpenKey(t?.parsed?.musicalKey || null) || '');
        case 'tags': {
          const rawTags = t?.metadata?.metadata?.tags || t?.metadata?.tags || t?.parsed?.tags || '';
          return normalizeSortText(rawTags);
        }
        case 'created': {
          const ms = Date.parse(t?.createdAt || '');
          return Number.isFinite(ms) ? ms : -1;
        }
        case 'published': return t?.parsed?.isPublic === true ? 1 : 0;
        case 'plays': {
          const n = Number(t?.metadata?.play_count);
          return Number.isFinite(n) ? n : -1;
        }
        default: return '';
      }
    }

    function compareValues(a, b) {
      if (typeof a === 'number' && typeof b === 'number') return a - b;
      return String(a).localeCompare(String(b));
    }

    function renderSortHeaders() {
      for (const th of sortHeaders) {
        const key = th.dataset.sort;
        const chev = th.querySelector('.sort-chevron');
        th.classList.remove('sort-active');
        if (chev) chev.textContent = '';
        if (key === sortKey) {
          th.classList.add('sort-active');
          if (chev) chev.textContent = sortDir === 'asc' ? '▴' : '▾';
        }
      }
    }

    function renderPlaylists() {
      playlistList.innerHTML = '';
      const groupOrder = ['Collection', 'DJ Sets', 'Genre', 'BPM', 'Energy', 'Key', 'Mood', 'Theme', 'Property', 'Other'];
      const groupRank = (groupKey) => {
        const idx = groupOrder.indexOf(groupKey);
        return idx >= 0 ? idx : 999;
      };

      const grouped = new Map();
      for (const p of playlists) {
        const key = String(p.groupKey || 'Other');
        if (!grouped.has(key)) grouped.set(key, []);
        grouped.get(key).push(p);
      }

      const renderItem = (p) => {
        const groupKey = String(p.groupKey || '');
        const rawName = String(p.name || '');
        const prefix = groupKey && groupKey !== 'Collection' ? (groupKey + ' - ') : '';
        const displayName = prefix && rawName.startsWith(prefix) ? rawName.slice(prefix.length) : rawName;
        const div = document.createElement('div');
        div.className = 'playlist-item' + (p.id === selectedPlaylistId ? ' active' : '');
        const name = document.createElement('span');
        name.className = 'playlist-name';
        name.textContent = displayName;
        const count = document.createElement('span');
        count.className = 'playlist-count';
        count.textContent = String(p.trackCount);
        div.appendChild(name);
        div.appendChild(count);
        div.onclick = () => {
          selectedPlaylistId = p.id;
          renderPlaylists();
          renderTracks();
        };
        playlistList.appendChild(div);
      };

      const allTracks = playlists.find((p) => p.id === 'collection-all-tracks') || null;
      if (allTracks) {
        renderItem(allTracks);
      }

      const groups = [...grouped.keys()]
        .filter((g) => g !== 'Collection')
        .sort((a, b) => {
          const ar = groupRank(a);
          const br = groupRank(b);
          if (ar !== br) return ar - br;
          return a.localeCompare(b);
        });

      for (const group of groups) {
        const header = document.createElement('div');
        header.className = 'playlist-group';
        header.textContent = String(group).toUpperCase();
        playlistList.appendChild(header);

        const items = grouped
          .get(group)
          .slice()
          .sort((a, b) => String(a.name).localeCompare(String(b.name)));
        for (const p of items) renderItem(p);
      }
    }

    function renderTracks() {
      const selected = playlists.find(p => p.id === selectedPlaylistId) || playlists[0];
      const idSet = new Set((selected?.trackIds || []));
      const hidePrivate = hidePrivateToggle.checked;
      currentPositionMap = new Map((selected?.trackIds || []).map((id, idx) => [id, idx + 1]));

      tbody.innerHTML = '';
      const visibleTracks = [];
      for (const t of tracks) {
        if (!idSet.has(t.id)) continue;
        const isPublished = t.parsed?.isPublic === true;
        if (hidePrivate && !isPublished) continue;
        visibleTracks.push(t);
      }

      visibleTracks.sort((a, b) => {
        const cmp = compareValues(getSortValue(a, sortKey), getSortValue(b, sortKey));
        if (cmp !== 0) return sortDir === 'asc' ? cmp : -cmp;
        return String(a.id || '').localeCompare(String(b.id || ''));
      });

      let shownCount = 0;
      for (const t of visibleTracks) {
        shownCount += 1;

        const tr = document.createElement('tr');
        const isPublished = t.parsed?.isPublic === true;
        if (!isPublished) tr.className = 'row-private';
        const positionTd = document.createElement('td');
        positionTd.className = 'num-right mono';
        positionTd.textContent = String(currentPositionMap.get(t.id) ?? '');
        const playerTd = document.createElement('td');
        const playButton = document.createElement('button');
        playButton.className = 'play-btn';
        playButton.type = 'button';
        playButton.disabled = !Boolean(t.availability?.mp3);
        const isCurrent = currentTrackId === t.id;
        playButton.textContent = isCurrent ? '⏸' : '▶';
        playButton.title = isCurrent ? 'Pause' : 'Play';
        playButton.setAttribute('aria-label', isCurrent ? 'Pause' : 'Play');
        playButton.onclick = () => togglePlayback(t);
        playerTd.appendChild(playButton);

        const rawTags = t?.metadata?.metadata?.tags || t?.metadata?.tags || t?.parsed?.tags || '';
        const parts = String(rawTags)
          .split(',')
          .map(s => s.trim())
          .filter(Boolean)
          .slice(0, 12);

        const promptCell = document.createElement('td');
        promptCell.className = 'cell-wrap';
        const wrap = document.createElement('div');
        wrap.className = 'badge-wrap';
        if (parts.length === 0) {
          wrap.textContent = '';
        } else {
          for (const part of parts) {
            const b = document.createElement('span');
            b.className = 'badge';
            const c = badgeColor(part);
            b.style.background = c.bg;
            b.style.color = c.fg;
            b.textContent = part;
            wrap.appendChild(b);
          }
        }
        promptCell.appendChild(wrap);

        const titleTd = document.createElement('td');
        titleTd.className = 'track-title cell-wrap';
        titleTd.textContent = String(t.parsed?.title || t.title || t.id || '');

        const lengthTd = document.createElement('td');
        lengthTd.className = 'mono';
        lengthTd.textContent = formatDuration(t.duration);

        const publishedTd = document.createElement('td');
        const pub = document.createElement('span');
        pub.className = 'pub-badge ' + (isPublished ? 'pub-public' : 'pub-private');
        pub.textContent = isPublished ? 'PUBLIC' : 'PRIVATE';
        publishedTd.appendChild(pub);

        const playCountTd = document.createElement('td');
        const rawPlayCount = Number(t?.metadata?.play_count);
        playCountTd.textContent = Number.isFinite(rawPlayCount) ? String(rawPlayCount) : '';

        const bpmTd = document.createElement('td');
        bpmTd.className = 'mono';
        bpmTd.textContent = typeof t.parsed?.bpm === 'number' ? String(Math.round(t.parsed.bpm)) : '';

        const keyTd = document.createElement('td');
        const openKey = toOpenKey(t.parsed?.musicalKey || null);
        if (openKey) {
          const k = document.createElement('span');
          k.className = 'key-badge mono';
          const c = badgeColor('openkey:' + openKey);
          k.style.background = c.bg;
          k.style.color = c.fg;
          k.textContent = openKey;
          keyTd.appendChild(k);
        } else {
          keyTd.textContent = '';
        }

        const createdTd = document.createElement('td');
        createdTd.textContent = formatCreatedDate(t.createdAt);

        tr.appendChild(positionTd);
        tr.appendChild(playerTd);
        tr.appendChild(titleTd);
        tr.appendChild(lengthTd);
        tr.appendChild(bpmTd);
        tr.appendChild(keyTd);
        tr.appendChild(promptCell);
        tr.appendChild(createdTd);
        tr.appendChild(publishedTd);
        tr.appendChild(playCountTd);
        tbody.appendChild(tr);
      }
      activeFilter.textContent = 'Showing: ' + (selected?.name || 'Unknown') + ' (' + shownCount + ')';
      renderSortHeaders();
    }

    for (const th of sortHeaders) {
      th.addEventListener('click', () => {
        const key = th.dataset.sort;
        if (!key) return;
        if (sortKey === key) {
          sortDir = sortDir === 'asc' ? 'desc' : 'asc';
        } else {
          sortKey = key;
          sortDir = key === 'created' ? 'desc' : 'asc';
        }
        renderTracks();
      });
    }

    hidePrivateToggle.addEventListener('change', renderTracks);
    renderPlaylists();
    renderTracks();
  </script>
</body>
</html>`;

  await fs.writeFile(REPORT_HTML, html, 'utf8');
  state.steps.report = nowIso();
  await writeLibraryState(state);
  logOk(`Report generated: ${REPORT_HTML}`);
}

export async function runPipeline(opts: CliOptions): Promise<void> {
  const start = Date.now();

  logStep('Starting pipeline...');
  logInfo(`Input: ${path.resolve(DATA_DIR)}`);
  logInfo(`Output: ${path.resolve(DATA_DIR)}`);
  logInfo(`Export mode: ${opts.exportType ?? 'off'}`);

  if (!(await fileExists(DATA_DIR))) {
    throw new Error(`Input directory not found: ${path.resolve(DATA_DIR)}`);
  }
  if (!(await fileExists(path.join(DATA_DIR, CSV_FILE)))) {
    throw new Error(`CSV not found: ${path.resolve(path.join(DATA_DIR, CSV_FILE))}`);
  }

  await ensureDir(DATA_DIR);

  const existing = await readLibraryStateIfExists();
  const state: LibraryState = existing ?? {
    version: 2,
    updatedAt: nowIso(),
    steps: { import: '', process: '', analyze: '', export: '', report: '' },
    tracks: [],
    playlists: [],
  };
  // Always refresh library.json as a pipeline checkpoint, even when it already exists.
  await writeLibraryState(state);

  await stepImport(state, existing);
  await stepProcess(state);
  await stepAnalyze(state);
  await stepReport(state);
  if (opts.exportType === 'music' || opts.exportType === 'traktor') {
    await stepExport(state);
    if (opts.exportType === 'traktor') {
      await stepTraktorUpsert(state);
    }
  } else {
    logInfo('Export skipped (pass --export music|traktor to enable)');
  }

  const elapsed = ((Date.now() - start) / 1000).toFixed(2);
  console.log(chalk.bold.green('\nPipeline Complete'));
  console.log(`${chalk.blue('Elapsed:')} ${elapsed}s`);
  console.log(`${chalk.blue('Library JSON:')} ${path.resolve(LIBRARY_JSON)}`);
  console.log(`${chalk.blue('HTML report:')} ${path.resolve(REPORT_HTML)}`);
  if (opts.exportType === 'music' || opts.exportType === 'traktor') {
    console.log(`${chalk.blue('Traktor export:')} ${path.resolve(getExportDir())}`);
    console.log(`${chalk.blue('Zip bundle:')} ${path.resolve(LIBRARY_ZIP)}`);
  }
}

export const __test__ = {
  parseBpmCandidate,
  extractMusicalKeyFromText,
  extractMusicalKeyFromRawMetadata,
  toOpenKey,
  keyMixGroupFromOpenKey,
  parseAubioNotesOutput,
  inferMusicalKeyFromMidiNotes,
  collectCategories,
  normalizeTitle,
  baseTitle,
  modeNumber,
  openKeyToMusicalKey,
  readId3TempoAndKey,
  createdAtSortValue,
  sortTrackIdsByCreatedAt,
};

const isMainModule =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMainModule) {
  runPipeline(parseArgs()).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`process.ts failed: ${message}`);
    process.exit(1);
  });
}
