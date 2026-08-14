import React, { useState } from 'react';
import { ChevronIcon } from './icons';
import { FileTypeIcon } from './fileIcons';
import type { SearchFileResult } from './protocol';

interface Props {
  results: SearchFileResult[];
  onOpenFile: (path: string, line?: number) => void;
}

export default function SearchResults({ results, onOpenFile }: Props): React.ReactElement {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  function toggle(path: string): void {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }

  if (results.length === 0) {
    return <div className="pp-empty">No results.</div>;
  }

  return (
    <div>
      {results.map((r) => {
        const hasMatches = r.matches.length > 0;
        const isOpen = hasMatches && !collapsed.has(r.path);
        return (
          <div key={r.path}>
            <div className="pp-row" onClick={() => (hasMatches ? toggle(r.path) : onOpenFile(r.path))}>
              <span className={`pp-chevron${hasMatches ? '' : ' empty'}`}>{hasMatches && <ChevronIcon expanded={isOpen} />}</span>
              <span className="pp-icon">
                <FileTypeIcon filename={r.name} size={14} />
              </span>
              <span className="pp-name" title={r.name}>
                {r.name}
              </span>
              {hasMatches && <span className="pp-match-count">{r.matches.length}</span>}
            </div>
            {isOpen &&
              r.matches.map((m, i) => (
                <div key={i} className="pp-line-match" onClick={() => onOpenFile(r.path, m.line)}>
                  <span className="pp-line-no">{m.line + 1}</span>
                  <span className="pp-line-text">{m.text}</span>
                </div>
              ))}
          </div>
        );
      })}
    </div>
  );
}
