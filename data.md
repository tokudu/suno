# Tracks Dataset Notes

This document captures the structure and conventions of the `Tracks/` source material.

## Scope and Inventory

- Directory contains `1206` files total.
- Audio files: `603` `.wav` files.
- Metadata files: `603` `.wav.txt` files.
- Pairing rule: every audio file has a same-path metadata sidecar with `.txt` appended to the WAV filename.
  - Example: `foo-<uuid>.wav` pairs with `foo-<uuid>.wav.txt`.
- Pair completeness was verified both directions:
  - missing `.wav -> .wav.txt`: `0`
  - missing `.wav.txt -> .wav`: `0`

## WAV Source Material Format

All WAV files share the same container/encoding signature:

- `RIFF (little-endian) data, WAVE audio, Microsoft PCM, 16 bit, stereo 48000 Hz`

Observed with `file` across all `603` WAVs.

Spot checks with `afinfo` confirm linear PCM @ `1536000` bps.

## Filename Conventions

### Canonical shape

- Every WAV filename ends with a UUIDv4-like identifier.
- Pattern:
  - `<prefix-and-title>-<uuid>.wav`
  - where `<uuid>` matches `[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}`
- All `603/603` WAVs match this ending pattern.

### Prefix patterns

The leading segment before first `-` is usually a workspace/source label, not artist.

Top observed prefixes:

- `My_Workspace`: `522`
- `Untitled`: `27`
- `Talent_Show_Anthem`: `7`
- `np`: `7`
- `Guchi_Cowbell`: `5`
- `dis_xmas`: `5`

Other prefixes appear as one-offs or small groups.

## Metadata File Format (`*.wav.txt`)

Each metadata file is plain text with human-readable sections followed by embedded JSON.

### High-level layout

All files include these section markers exactly once:

- `Metadata for:`
- `Generated:`
- `--- Track Information ---`
- `--- Musical Information ---`
- `--- Creation Details ---`
- `--- Lyrics ---`
- `--- Raw API Response ---`

`--- Musical Information ---` is currently present but empty in sampled files.

### Human-readable fields

Common fields near top:

- `Title:` (missing in `56` files)
- `Artist:` (present in `603/603`)
- `Year:` (present in `603/603`)
- `Prompt:` (present in `601/603`)
- `Cover Art URL:` (present in `603/603`)

Known intentional omissions:

- `Title:` may be omitted when API title is empty (`"title": ""`).
- `Prompt:` may be omitted or blank when API prompt is empty.

### Embedded JSON block

Everything after `--- Raw API Response ---` is valid JSON in all `603` files (`603/603` parse successfully).

#### Top-level JSON keys

Always present (`603/603`):

- `status`, `title`, `id`, `entity_type`
- `audio_url`, `video_url`, `image_url`, `image_large_url`
- `model_name`, `major_model_version`
- `metadata` (nested object)
- engagement/account flags and counts such as `play_count`, `upvote_count`, `explicit`, `is_public`, `is_liked`, `is_hidden`, etc.

Often present but not universal:

- `reaction`: `595`
- `ownership`: `576`
- `display_tags`: `529`
- `project`: `81`
- `video_cover_url`: `71`

Rare optional keys include `caption`, `preview_url`, `persona`, `hook_preview_thumbnail_url`.

#### `metadata` object keys

Always present (`603/603`) unless noted:

- `type`, `tags`, `prompt`, `is_remix`, `can_remix`, `has_stem`, `uses_latest_model`
- `duration` present in `602/603`

Frequent optional keys:

- `model_badges` (`595`)
- `stream` (`589`)
- `priority` (`589`)
- `refund_credits` (`588`)
- `make_instrumental` (`584`)
- `video_is_stale` (`224`)
- `task` (`180`)
- `edited_clip_id` (`179`)
- `has_vocal` (`168`)
- `cover_clip_id` (`135`)
- `control_sliders` (`149`)

Long-tail keys exist for infill/extend/upsample/speed/persona workflows.

## Content and Provenance Observations

### Artist/account identity

- `Artist:` is always `T O K U D U`.
- JSON `display_name` is also always `T O K U D U`.
- JSON `handle` is consistently `tokudu`.

### Model/version distribution

`major_model_version` counts:

- `v5`: `316`
- `v4.5`: `169`
- `v4.5+`: `93`
- `v4`: `12`
- empty: `8`
- `v3.5`: `3`
- `v4.5-all`: `2`

`model_name` counts:

- `chirp-crow`: `293`
- `chirp-auk`: `171`
- `chirp-bluejay`: `93`
- `chirp-carp`: `23`
- `chirp-v4`: `12`
- `chirp-chirp`: `8`
- `chirp-v3`: `3`

`metadata.type` counts:

- `gen`: `584`
- `upsample`: `5`
- `edit_v3_export`: `5`
- `studio_export`: `3`
- `concat`: `3`
- `edit_speed`: `2`
- `rendered-project`: `1`

### Remix/visibility/explicitness

- `metadata.is_remix`: `true=121`, `false=482`
- `is_public`: `true=210`, `false=393`
- `explicit`: `true=14`, `false=589`

### Temporal ranges

- Metadata generation timestamp (`Generated`) range:
  - earliest: `2026-02-19T00:17:34.554Z`
  - latest: `2026-02-19T02:00:46.159Z`
- API `created_at` range:
  - earliest: `2025-03-17T02:11:07.616Z`
  - latest: `2026-02-17T06:23:35.402Z`

### Durations

From `metadata.duration` where present (`602` files):

- min: `18.28s`
- max: `479.96s`
- average: `176.78s`

One metadata record is missing `metadata.duration`.

## Parsing Guidance

### Reliable joining

- Join audio and metadata by exact path relationship:
  - metadata path = `wav_path + ".txt"`
- Do not join by stripping only `.txt` from arbitrary `.txt` names; these are sidecars of `.wav` filenames.

### Prefer JSON as source of truth

Use the embedded JSON block for analytics/automation because:

- it is structurally parseable (`603/603` valid)
- human-readable fields can be omitted (`Title`, `Prompt`)
- optional keys vary by model/workflow (`cover`, `extend`, `upsample`, `studio_export`)

### Robust parser behavior

- Treat many fields as optional.
- Allow empty strings for titles/prompts/tags/version.
- Preserve Unicode in text (e.g., accented characters and symbols in names/lyrics).
- Keep full multiline prompt/lyrics content as-is; line breaks and bracketed structure are meaningful.
