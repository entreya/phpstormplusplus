import React from 'react';

/** Used by SearchResults.tsx's file/line rows, which stayed plain markup
 * (not antd) since only the main file tree's antd Tree had a reported
 * layout issue — this one small glyph has no composed layout behavior of
 * its own to break. */
export function ChevronIcon({ expanded }: { expanded: boolean }): React.ReactElement {
  return (
    <svg width={14} height={14} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.6} style={{ transform: expanded ? 'rotate(90deg)' : 'none', transition: 'transform 0.1s' }}>
      <path d="M6 3l5 5-5 5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
