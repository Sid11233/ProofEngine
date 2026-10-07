// The app's icon set: 16 px by default, one stroke weight (1.75 on a 24 px grid, rounded caps and joins), one family.
// Do not mix in icons from a library. Add new ones here.

const PATHS = {
  home: "M3 11l9-8 9 8M5 10v10h5v-6h4v6h5V10",
  mail: "M4 6h16v12H4zM4 7l8 6 8-6",
  file: "M7 3h8l4 4v14H7zM15 3v4h4M10 12h6M10 16h6",
  share: "M6 12a2 2 0 100-.01M18 6a2 2 0 100-.01M18 18a2 2 0 100-.01M8 11l8-4M8 13l8 4",
  compass: "M12 21a9 9 0 100-18 9 9 0 000 18zM15.5 8.5l-2 5-5 2 2-5z",
  grid: "M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z",
  chat: "M4 5h16v11H9l-5 4z",
  users: "M9 11a3 3 0 100-6 3 3 0 000 6zM3 20c0-3.3 2.7-6 6-6s6 2.7 6 6M16 11a3 3 0 100-6M18 14c2 .5 3 2.5 3 6",
  card: "M3 6h18v12H3zM3 10h18M7 15h4",
  gear: "M12 15a3 3 0 100-6 3 3 0 000 6zM19 12l2-1-2-4-2 1-2-1V5h-4v2l-2 1-2-1-2 4 2 1v2l-2 1 2 4 2-1 2 1v2h4v-2l2-1 2 1 2-4-2-1z",
  bell: "M12 3a6 6 0 00-6 6v4l-2 3h16l-2-3V9a6 6 0 00-6-6zM10 19a2 2 0 004 0",
  shield: "M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z",
  chevronRight: "M9 6l6 6-6 6",
  chevronDown: "M6 9l6 6 6-6",
  chevronLeft: "M15 6l-6 6 6 6",
  plus: "M12 5v14M5 12h14",
  check: "M5 12l5 5L20 7",
  x: "M6 6l12 12M18 6L6 18",
  more: "M5 12h.01M12 12h.01M19 12h.01",
  sidebar: "M4 5h16v14H4zM9 5v14",
  external: "M14 4h6v6M20 4l-9 9M18 13v6H5V6h6",
  download: "M12 4v11M7 11l5 5 5-5M5 20h14",
  lock: "M6 11h12v9H6zM8 11V8a4 4 0 018 0v3",
  logout: "M10 4H5v16h5M15 8l4 4-4 4M19 12H9",
  user: "M12 12a4 4 0 100-8 4 4 0 000 8zM4 21c0-4 3.6-7 8-7s8 3 8 7",
  play: "M8 5l11 7-11 7z",
  search: "M11 18a7 7 0 100-14 7 7 0 000 14zM20 20l-4-4",
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 16, className = "" }: { name: IconName; size?: number; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" className={`shrink-0 ${className}`.trim()}>
      <path d={PATHS[name]} />
    </svg>
  );
}
