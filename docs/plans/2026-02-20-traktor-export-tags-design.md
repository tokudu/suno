# Design: Export Skip + Traktor Tag Read

Date: 2026-02-20

## Goal
Avoid overwriting already-exported MP3s in `~/Music/Suno/Tracks`, and enrich analysis by reading BPM/Key from those exported files before using aubio.

## Context
- Export currently writes MP3s to `~/Music/Suno/Tracks` and playlists to `~/Music/Suno/Playlists` when `--export` is used.
- Traktor writes ID3 tags into exported MP3s, including `TBPM` and `TKEY` (Open Key).
- Analyze currently backfills BPM/Key from metadata/related/aubio only.

## Proposed Behavior
### Export
- If target MP3 already exists in `~/Music/Suno/Tracks`, do **not** overwrite it.
- Still mark the track as exported and set `paths.traktor` to the existing file.
- Exported playlists behavior unchanged.

### Analyze
- If export folder exists, attempt to read `TBPM`/`TKEY` from the exported MP3 for each track.
- If tags are present, populate `track.parsed.bpm` and `track.parsed.musicalKey` and set sources accordingly.
- Only fall back to aubio when the exported tags are missing/unreadable and no other source has filled the field.

## Data Flow
1. Export computes target file path.
2. If file exists: skip writing; set exported fields.
3. Analyze reads ID3 tags from export path when available.
4. If BPM/Key still missing, run aubio as today.

## Error Handling
- If ID3 read fails or file is missing, log a concise warning and continue.
- Do not fail the pipeline for tag read errors.

## Testing
Add/adjust tests to cover:
- Export does not overwrite existing MP3s.
- Analyze reads `TBPM`/`TKEY` from exported MP3s.
- Aubio fallback when tags missing.

## Non-Goals
- Changing Traktor export format.
- Writing tags into MP3s in the export step.
