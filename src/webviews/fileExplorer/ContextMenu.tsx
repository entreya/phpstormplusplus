import React, { useEffect, useRef } from 'react';

export interface ContextMenuItem {
  key: string;
  label: string;
  danger?: boolean;
  separatorBefore?: boolean;
  onClick: () => void;
}

interface Props {
  x: number;
  y: number;
  items: ContextMenuItem[];
  onClose: () => void;
}

/** A plain positioned div, not a library dropdown — closes on outside click or Escape. */
export default function ContextMenu({ x, y, items, onClose }: Props): React.ReactElement {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onDocClick(e: MouseEvent): void {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  // Keep the menu on-screen if it was opened near the right/bottom edge.
  const style: React.CSSProperties = { left: x, top: y };

  return (
    <div className="pp-context-menu" style={style} ref={ref}>
      {items.map((item) => (
        <React.Fragment key={item.key}>
          {item.separatorBefore && <div className="pp-context-menu-sep" />}
          <div
            className={`pp-context-menu-item${item.danger ? ' danger' : ''}`}
            onClick={() => {
              item.onClick();
              onClose();
            }}
          >
            {item.label}
          </div>
        </React.Fragment>
      ))}
    </div>
  );
}
