import { describe, expect, it } from 'vitest';
import { getInitialDjModeActive } from '../src/hooks/use-dj-mode';

describe('DJ mode defaults', () => {
  it('starts single deck even on desktop-sized screens', () => {
    expect(getInitialDjModeActive()).toBe(false);
  });
});
