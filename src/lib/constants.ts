export const PLAYLIST_GROUP_ORDER = [
  'Collection',
  'DJ Sets',
  'Genre',
  'BPM',
  'Energy',
  'Key',
  'Mood',
  'Theme',
  'Property',
  'Other',
];

export type SortKey =
  | 'position'
  | 'player'
  | 'title'
  | 'length'
  | 'bpm'
  | 'key'
  | 'tags'
  | 'created'
  | 'published'
  | 'plays';

export type SortDir = 'asc' | 'desc';
