import React from 'react';

/** Small hand-drawn SVG glyphs — deliberately not from a component library:
 * these are static shapes with no layout behavior of their own, so there's
 * nothing here that can silently break the way a composed library component
 * (Tree, Dropdown, ...) did. */

const base = { width: 14, height: 14, viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor', strokeWidth: 1.6 } as const;

export function ChevronIcon({ expanded }: { expanded: boolean }): React.ReactElement {
  return (
    <svg {...base} style={{ transform: expanded ? 'rotate(90deg)' : 'none', transition: 'transform 0.1s' }}>
      <path d="M6 3l5 5-5 5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function FolderIcon({ open }: { open?: boolean }): React.ReactElement {
  return open ? (
    <svg width={16} height={16} viewBox="0 0 16 16" fill="none">
      <path d="M1.5 4.5A1.5 1.5 0 0 1 3 3h3l1.5 1.5H13A1.5 1.5 0 0 1 14.5 6v.5H4L1.5 11V4.5z" fill="#dcb67a" />
      <path d="M1.7 11L3.4 6.7A1 1 0 0 1 4.3 6H14a1 1 0 0 1 .95 1.32l-1.5 4.5A1 1 0 0 1 12.5 12.5H2.6a1 1 0 0 1-.9-1.5z" fill="#e8c584" />
    </svg>
  ) : (
    <svg width={16} height={16} viewBox="0 0 16 16" fill="none">
      <path d="M1.5 4A1.5 1.5 0 0 1 3 2.5h3l1.5 1.5H13A1.5 1.5 0 0 1 14.5 5.5v7A1.5 1.5 0 0 1 13 14H3a1.5 1.5 0 0 1-1.5-1.5V4z" fill="#dcb67a" />
    </svg>
  );
}

export function SearchIcon(): React.ReactElement {
  return (
    <svg {...base} width={14} height={14}>
      <circle cx="6.5" cy="6.5" r="4" />
      <path d="M11 11l3 3" strokeLinecap="round" />
    </svg>
  );
}

export function CloseIcon(): React.ReactElement {
  return (
    <svg {...base} width={12} height={12}>
      <path d="M3 3l9 9M12 3l-9 9" strokeLinecap="round" />
    </svg>
  );
}

export function RefreshIcon(): React.ReactElement {
  return (
    <svg {...base} width={13} height={13}>
      <path
        d="M13 8A5 5 0 1 1 11.5 4.2M13 2v3.5h-3.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
