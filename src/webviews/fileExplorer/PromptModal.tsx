import React, { useEffect, useRef, useState } from 'react';

interface Props {
  title: string;
  initialValue?: string;
  danger?: boolean;
  okLabel?: string;
  confirmOnly?: boolean;
  message?: string;
  onSubmit: (value: string) => void;
  onCancel: () => void;
}

/** A plain overlay + input, not a library modal — VS Code webviews block the
 * native window.prompt()/confirm(), so this is the whole replacement for
 * both "ask for a name" and "confirm this destructive action" dialogs. */
export default function PromptModal({ title, initialValue = '', danger, okLabel, confirmOnly, message, onSubmit, onCancel }: Props): React.ReactElement {
  const [value, setValue] = useState(initialValue);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') onCancel();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onCancel]);

  function submit(): void {
    onSubmit(confirmOnly ? initialValue : value.trim());
  }

  return (
    <div className="pp-modal-overlay" onMouseDown={(e) => e.target === e.currentTarget && onCancel()}>
      <div className="pp-modal">
        <div className="pp-modal-title">{title}</div>
        {message && <div style={{ fontSize: 12, opacity: 0.85, marginBottom: 10 }}>{message}</div>}
        {!confirmOnly && (
          <input
            ref={inputRef}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && submit()}
          />
        )}
        <div className="pp-modal-actions">
          <button className="pp-btn" onClick={onCancel}>
            Cancel
          </button>
          <button
            className={`pp-btn ${danger ? 'danger' : 'primary'}`}
            disabled={!confirmOnly && !value.trim()}
            onClick={submit}
            ref={confirmOnly ? (el) => el?.focus() : undefined}
          >
            {okLabel ?? 'OK'}
          </button>
        </div>
      </div>
    </div>
  );
}
