import { describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { __test__ } from '../process';

describe('parseBpmCandidate', () => {
  it('parses numeric and bpm-text values', () => {
    expect(__test__.parseBpmCandidate(126)).toBe(126);
    expect(__test__.parseBpmCandidate('126')).toBe(126);
    expect(__test__.parseBpmCandidate('126 bpm')).toBe(126);
    expect(__test__.parseBpmCandidate('tempo: 92bpm, deep house')).toBe(92);
  });

  it('returns null for unsupported values', () => {
    expect(__test__.parseBpmCandidate('')).toBeNull();
    expect(__test__.parseBpmCandidate('no tempo provided')).toBeNull();
    expect(__test__.parseBpmCandidate(undefined)).toBeNull();
  });
});

describe('extractMusicalKeyFromText', () => {
  it('extracts and normalizes key from ascii and unicode forms', () => {
    expect(__test__.extractMusicalKeyFromText('tech house, D minor, 126bpm')).toBe('D Minor');
    expect(__test__.extractMusicalKeyFromText('E♭ major, jazz pop')).toBe('Eb Major');
    expect(__test__.extractMusicalKeyFromText('f♯ minor melodic')).toBe('F# Minor');
  });

  it('returns null when no key is present', () => {
    expect(__test__.extractMusicalKeyFromText('ambient textures only')).toBeNull();
  });
});

describe('extractMusicalKeyFromRawMetadata', () => {
  it('prefers explicit key fields from raw metadata', () => {
    expect(
      __test__.extractMusicalKeyFromRawMetadata({
        metadata: { musical_key: 'F# minor' },
      } as Record<string, unknown>),
    ).toBe('F# Minor');

    expect(
      __test__.extractMusicalKeyFromRawMetadata({
        key: 'E♭ major',
      } as Record<string, unknown>),
    ).toBe('Eb Major');
  });

  it('returns null when no explicit key field exists', () => {
    expect(
      __test__.extractMusicalKeyFromRawMetadata({
        metadata: { tags: 'tech house, 126bpm, d minor' },
      } as Record<string, unknown>),
    ).toBeNull();
  });
});

describe('open key helpers', () => {
  it('maps tonal keys to Open Key notation', () => {
    expect(__test__.toOpenKey('D Minor')).toBe('12m');
    expect(__test__.toOpenKey('F# Minor')).toBe('4m');
    expect(__test__.toOpenKey('Eb Major')).toBe('10d');
  });

  it('maps open keys to dj mix groups', () => {
    expect(__test__.keyMixGroupFromOpenKey('12m')).toBe('12m,1m,12d,1d');
    expect(__test__.keyMixGroupFromOpenKey('6d')).toBe('6m,7m,6d,7d');
    expect(__test__.keyMixGroupFromOpenKey('11m')).toBe('10m,11m,10d,11d');
  });

  it('maps Open Key values back to tonal keys', () => {
    expect(__test__.openKeyToMusicalKey('4m')).toBe('F# Minor');
    expect(__test__.openKeyToMusicalKey('10d')).toBe('Eb Major');
    expect(__test__.openKeyToMusicalKey('bad')).toBeNull();
  });
});

describe('readId3TempoAndKey', () => {
  function synchsafe(size: number): Buffer {
    return Buffer.from([
      (size >> 21) & 0x7f,
      (size >> 14) & 0x7f,
      (size >> 7) & 0x7f,
      size & 0x7f,
    ]);
  }

  function makeTextFrame(id: string, value: string): Buffer {
    const text = Buffer.from(value, 'utf8');
    const body = Buffer.concat([Buffer.from([0x03]), text]); // UTF-8
    const header = Buffer.alloc(10);
    header.write(id, 0, 4, 'ascii');
    header.writeUInt32BE(body.length, 4);
    return Buffer.concat([header, body]);
  }

  it('reads TBPM and TKEY from an ID3v2.3 file', async () => {
    const tbpm = makeTextFrame('TBPM', '128');
    const tkey = makeTextFrame('TKEY', '4m');
    const body = Buffer.concat([tbpm, tkey]);
    const header = Buffer.alloc(10);
    header.write('ID3', 0, 3, 'ascii');
    header[3] = 3; // v2.3
    header[4] = 0;
    header[5] = 0;
    synchsafe(body.length).copy(header, 6);
    const bytes = Buffer.concat([header, body, Buffer.from([0xff, 0xfb, 0x90, 0x64])]);

    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'id3-read-test-'));
    const file = path.join(tmp, 'sample.mp3');
    await fs.writeFile(file, bytes);

    const parsed = await __test__.readId3TempoAndKey(file);
    expect(parsed.bpm).toBe(128);
    expect(parsed.musicalKey).toBe('F# Minor');
  });
});

describe('aubio key helpers', () => {
  it('parses midi notes from aubio notes output', () => {
    const stdout = `0.026667\t\n75.000000\t0.026667\t0.170667\t\n48.000000\t0.517333\t0.704000\t\n`;
    expect(__test__.parseAubioNotesOutput(stdout)).toEqual([75, 48]);
  });

  it('infers key from a simple D minor note set', () => {
    // D, F, A repeated across octaves
    const notes = [50, 53, 57, 62, 65, 69, 74, 77, 81, 86];
    expect(__test__.inferMusicalKeyFromMidiNotes(notes)).toBe('D Minor');
  });
});

describe('title normalization helpers', () => {
  it('normalizes and strips remix suffixes', () => {
    expect(__test__.normalizeTitle('Final_Boss (Ibiza Edit)!!')).toBe('final boss ibiza edit');
    expect(__test__.baseTitle('final boss ibiza remix')).toBe('final boss ibiza');
  });

  it('selects the modal value deterministically', () => {
    expect(__test__.modeNumber([126, 126, 128, 128, 128, 120])).toBe(128);
    expect(__test__.modeNumber([])).toBeNull();
  });
});

describe('createdAt sorting helpers', () => {
  it('sorts null/invalid dates to the end', () => {
    expect(__test__.createdAtSortValue(null)).toBe(Number.POSITIVE_INFINITY);
    expect(__test__.createdAtSortValue('not-a-date')).toBe(Number.POSITIVE_INFINITY);
  });

  it('sorts track ids by createdAt ascending and breaks ties by id', () => {
    const tracksById = new Map([
      ['b', { id: 'b', createdAt: '2026-01-02T00:00:00.000Z' }],
      ['a', { id: 'a', createdAt: '2026-01-02T00:00:00.000Z' }],
      ['c', { id: 'c', createdAt: '2026-01-01T00:00:00.000Z' }],
      ['d', { id: 'd', createdAt: null }],
    ] as const);

    const sorted = __test__.sortTrackIdsByCreatedAt(
      ['d', 'b', 'a', 'c'],
      tracksById as unknown as Map<string, any>,
    );
    expect(sorted).toEqual(['c', 'a', 'b', 'd']);
  });
});

describe('collectCategories', () => {
  it('assigns genre/theme/property/bpm/key/energy/mood categories from context', () => {
    const categories = __test__.collectCategories({
      row: {} as never,
      id: 'abc',
      sourceWavPath: 'in/example.wav',
      title: 'Festival Banger',
      normalizedText:
        'trap hip hop dark euphoric festival drop remix instrumental tech house d minor',
      rawTask: 'cover',
      isRemix: true,
      isPublic: true,
      isExplicit: true,
      modelVersion: 'v5',
      bpm: 140,
      musicalKey: 'D Minor',
    });

    expect(categories).toContain('Genre - Trap');
    expect(categories).toContain('Theme - Party-Club-Night');
    expect(categories).toContain('Property - Remix-Edit-Cover');
    expect(categories).toContain('Property - Model-v5');
    expect(categories).toContain('BPM - >135');
    expect(categories).toContain('Energy - High');
    expect(categories).toContain('Energy - Peak');
    expect(categories).toContain('Mood - Dark');
    expect(categories).toContain('Mood - Euphoric');
    expect(categories).toContain('Key - 12m,1m,12d,1d');
  });

  it('uses fallback category when nothing matches', () => {
    const categories = __test__.collectCategories({
      row: {} as never,
      id: 'def',
      sourceWavPath: 'in/example2.wav',
      title: 'Unknown',
      normalizedText: 'plain field recording no tags',
      rawTask: '',
      isRemix: false,
      isPublic: false,
      isExplicit: false,
      modelVersion: '',
      bpm: null,
      musicalKey: null,
    });

    expect(categories).toEqual(['Other - Uncategorized']);
  });
});
