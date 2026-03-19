# Library Playback Queue Design

## Summary

Add queue-based continuous playback to generated `library.html` while preserving the existing per-row play buttons. Clicking a track should snapshot the currently visible playable rows into a queue, start playback on the selected track, and expose the active playback state through a persistent bottom player overlay with a queue popover.

## Goals

- Keep row-level play buttons as the primary entry point.
- Support continuous playback through a stored queue rather than recomputing from the UI on every track end.
- Make playback state persistent and visible while browsing the report.
- Allow the user to inspect and jump within the current queue from a popover.

## Non-goals

- No server-side playback state or persistence across page reloads.
- No DOM-visual regression testing beyond generated HTML wiring assertions.
- No album art extraction or waveform rendering.

## Playback Model

- The report continues to use one browser `Audio` instance.
- Clicking a play button builds a queue from the rows currently visible in the table.
- The queue contains only tracks with playable MP3 sources, in the same order they are rendered.
- Playback starts at the clicked track within that queue.
- If continuous playback is enabled, `audio.ended` advances to the next queue entry.
- If the user clicks a different row later, the queue is rebuilt from the then-current visible rows and playback restarts from that selected track.
- Changing playlist, sort, or visibility filters while playback is active does not mutate the active queue.

## UI

- Add a fixed bottom player overlay that remains visible while the user scrolls the report.
- Overlay sections:
  - Current track summary and queue position.
  - Transport controls: previous, play/pause, next.
  - Progress bar with elapsed and remaining time.
  - Continuous playback toggle.
  - Queue button that opens a popover panel.
- Add a queue popover inspired by music apps such as Spotify and SoundCloud:
  - Shows current item and upcoming items.
  - Highlights the active queue entry.
  - Allows clicking a queue row to jump to that item without rebuilding the queue.

## Edge Cases

- Tracks without MP3s are excluded from the queue.
- If the queue ends, playback stops and the overlay remains on the last track.
- If continuous playback is disabled, the queue still exists but `ended` does not auto-advance.
- If playback fails to start, current playing state should clear without corrupting the queue.

## Testing

- Extend integration coverage to assert the generated HTML includes:
  - Player overlay and queue popover markup.
  - Queue state variables and queue-building helpers.
  - Queue advancement behavior on `ended`.
  - Continuous playback toggle wiring.
