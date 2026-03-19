# Library Playback Queue Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add queue-based continuous playback plus a persistent bottom player overlay and queue popover to generated `library.html`.

**Architecture:** Keep a single browser `Audio` instance in the generated report and introduce queue state in the embedded script. Build the queue from the current visible playable rows when a track is clicked, render playback controls in a fixed overlay, and advance through the stored queue on `ended` when continuous playback is enabled.

**Tech Stack:** TypeScript, Vitest, generated standalone HTML/CSS/JS in `process.ts`

---

### Task 1: Add failing generated-HTML coverage

**Files:**
- Modify: `tests/integration.pipeline.test.ts`
- Test: `tests/integration.pipeline.test.ts`

**Step 1: Write the failing test**

Add assertions for the expected generated HTML:

```ts
expect(reportContent).toContain('id="playerOverlay"');
expect(reportContent).toContain('id="queuePopover"');
expect(reportContent).toContain('let playbackQueue = []');
expect(reportContent).toContain('function buildQueueFromVisibleTracks()');
expect(reportContent).toContain('function playQueueIndex(index)');
```

**Step 2: Run test to verify it fails**

Run: `pnpm test tests/integration.pipeline.test.ts`
Expected: FAIL because the current generated HTML does not include the queue/player overlay logic.

**Step 3: Write minimal implementation**

No production change in this task.

**Step 4: Run test to verify it passes**

Deferred until implementation is added.

### Task 2: Implement queue state and playback helpers

**Files:**
- Modify: `process.ts`
- Test: `tests/integration.pipeline.test.ts`

**Step 1: Write the failing test**

Use Task 1 assertions as the red phase for the new playback model.

**Step 2: Run test to verify it fails**

Run: `pnpm test tests/integration.pipeline.test.ts`
Expected: FAIL with missing generated markup/logic strings.

**Step 3: Write minimal implementation**

In `process.ts`, update generated `library.html` to:

```ts
let playbackQueue = [];
let queueIndex = -1;

function buildQueueFromVisibleTracks() {
  return getVisibleTracks().filter((t) => getAudioSrc(t));
}

function playQueueIndex(index) {
  const track = playbackQueue[index];
  if (!track) return;
  queueIndex = index;
  playTrack(track);
}
```

Expand this into full queue, transport, progress, and overlay rendering.

**Step 4: Run test to verify it passes**

Run: `pnpm test tests/integration.pipeline.test.ts`
Expected: PASS

### Task 3: Add player overlay and queue popover UI

**Files:**
- Modify: `process.ts`
- Test: `tests/integration.pipeline.test.ts`

**Step 1: Write the failing test**

Extend the integration assertion set if needed for overlay ids and controls.

**Step 2: Run test to verify it fails**

Run: `pnpm test tests/integration.pipeline.test.ts`
Expected: FAIL until the generated HTML includes overlay controls and popover markup.

**Step 3: Write minimal implementation**

In the generated HTML, add:

```html
<div id="playerOverlay">...</div>
<div id="queuePopover" hidden>...</div>
```

and wire them to queue and playback state.

**Step 4: Run test to verify it passes**

Run: `pnpm test tests/integration.pipeline.test.ts`
Expected: PASS

### Task 4: Full verification and regeneration

**Files:**
- Modify: `process.ts`
- Modify: `tests/integration.pipeline.test.ts`

**Step 1: Run the focused tests**

Run: `pnpm test tests/integration.pipeline.test.ts`
Expected: PASS

**Step 2: Run the full suite**

Run: `pnpm test`
Expected: PASS

**Step 3: Regenerate outputs**

Run: `pnpm tsx process.ts --export music`
Expected: `data/library.html` regenerated with the new player overlay and queue behavior.

**Step 4: Review changed files**

Run: `git status --short`
Expected: only intended source, test, and generated output changes.
