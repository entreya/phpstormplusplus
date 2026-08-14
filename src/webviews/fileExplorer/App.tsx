import React, { useEffect, useRef, useState } from 'react';
import { onExtensionMessage, postToExtension } from './vscodeApi';
import type { FileEntry, SearchFileResult } from './protocol';
import type { TreeNodeData } from './FileTree';
import FileTree from './FileTree';
import SearchResults from './SearchResults';
import ContextMenu, { ContextMenuItem } from './ContextMenu';
import PromptModal from './PromptModal';
import { SearchIcon, CloseIcon, RefreshIcon } from './icons';

function toNode(entry: FileEntry): TreeNodeData {
  return { path: entry.path, name: entry.name, isDirectory: entry.isDirectory };
}

function withChildren(nodes: TreeNodeData[], path: string, children: TreeNodeData[]): TreeNodeData[] {
  return nodes.map((node) => {
    if (node.path === path) return { ...node, children };
    if (node.children) return { ...node, children: withChildren(node.children, path, children) };
    return node;
  });
}

type PromptState =
  | { kind: 'newFile' | 'newFolder'; dirPath: string }
  | { kind: 'rename'; path: string; currentName: string }
  | { kind: 'delete'; path: string; name: string };

interface MenuState {
  x: number;
  y: number;
  node: TreeNodeData;
}

const DEBOUNCE_MS = 250;

export default function App(): React.ReactElement {
  const [rootPath, setRootPath] = useState<string>();
  const [treeData, setTreeData] = useState<TreeNodeData[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string>();
  const [menu, setMenu] = useState<MenuState>();
  const [prompt, setPrompt] = useState<PromptState>();

  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [useRegex, setUseRegex] = useState(false);
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [results, setResults] = useState<SearchFileResult[]>();
  const [invalidRegex, setInvalidRegex] = useState(false);
  const searchToken = useRef(0);
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    const unsubscribe = onExtensionMessage((msg) => {
      switch (msg.type) {
        case 'root':
          setRootPath(msg.path);
          setTreeData([{ path: msg.path, name: msg.name, isDirectory: true }]);
          setExpanded(new Set([msg.path]));
          postToExtension({ type: 'listDir', path: msg.path });
          break;
        case 'dirListing':
          setTreeData((prev) => withChildren(prev, msg.path, msg.entries.map(toNode)));
          break;
        case 'refresh':
          postToExtension({ type: 'listDir', path: msg.path });
          break;
        case 'searchResults':
          setResults(msg.results);
          setInvalidRegex(!!msg.invalidRegex);
          break;
        case 'error':
          setError(msg.message);
          break;
      }
    });
    postToExtension({ type: 'ready' });
    return unsubscribe;
  }, []);

  function toggle(path: string): void {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
        postToExtension({ type: 'listDir', path });
      }
      return next;
    });
  }

  function openFile(path: string, line?: number): void {
    postToExtension({ type: 'openFile', path, line });
  }

  function runSearch(q: string, regex: boolean, cs: boolean): void {
    const token = ++searchToken.current;
    if (!q.trim()) {
      setResults(undefined);
      setInvalidRegex(false);
      return;
    }
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(() => {
      if (token !== searchToken.current) return;
      postToExtension({ type: 'search', query: q, useRegex: regex, caseSensitive: cs });
    }, DEBOUNCE_MS);
  }

  function onQueryChange(q: string): void {
    setQuery(q);
    runSearch(q, useRegex, caseSensitive);
  }

  function toggleRegex(): void {
    const next = !useRegex;
    setUseRegex(next);
    runSearch(query, next, caseSensitive);
  }

  function toggleCase(): void {
    const next = !caseSensitive;
    setCaseSensitive(next);
    runSearch(query, useRegex, next);
  }

  function closeSearch(): void {
    setSearchOpen(false);
    setQuery('');
    setResults(undefined);
    setInvalidRegex(false);
    postToExtension({ type: 'clearSearch' });
  }

  function contextMenuItems(node: TreeNodeData): ContextMenuItem[] {
    const items: ContextMenuItem[] = [];
    if (node.isDirectory) {
      items.push(
        { key: 'newFile', label: 'New File', onClick: () => setPrompt({ kind: 'newFile', dirPath: node.path }) },
        { key: 'newFolder', label: 'New Folder', onClick: () => setPrompt({ kind: 'newFolder', dirPath: node.path }) }
      );
    }
    if (node.path !== rootPath) {
      items.push(
        { key: 'rename', label: 'Rename', separatorBefore: node.isDirectory, onClick: () => setPrompt({ kind: 'rename', path: node.path, currentName: node.name }) },
        { key: 'delete', label: 'Delete', danger: true, onClick: () => setPrompt({ kind: 'delete', path: node.path, name: node.name }) }
      );
    }
    return items;
  }

  function submitPrompt(value: string): void {
    if (!prompt) return;
    if (prompt.kind === 'newFile' && value) postToExtension({ type: 'createFile', dirPath: prompt.dirPath, name: value });
    else if (prompt.kind === 'newFolder' && value) postToExtension({ type: 'createFolder', dirPath: prompt.dirPath, name: value });
    else if (prompt.kind === 'rename' && value && value !== prompt.currentName) postToExtension({ type: 'rename', path: prompt.path, newName: value });
    else if (prompt.kind === 'delete') postToExtension({ type: 'delete', path: prompt.path });
    setPrompt(undefined);
  }

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div className="pp-toolbar">
        <span className="pp-toolbar-title">Explorer</span>
        <span>
          <button className={`pp-icon-button${searchOpen ? ' active' : ''}`} title="Find in Files" onClick={() => setSearchOpen((v) => !v)}>
            <SearchIcon />
          </button>
          <button className="pp-icon-button" title="Refresh" onClick={() => rootPath && postToExtension({ type: 'listDir', path: rootPath })}>
            <RefreshIcon />
          </button>
        </span>
      </div>

      {searchOpen && (
        <div>
          <div className={`pp-search-box${invalidRegex ? ' invalid' : ''}`}>
            <input
              autoFocus
              placeholder="Find in files (name or content)..."
              value={query}
              onChange={(e) => onQueryChange(e.target.value)}
              onKeyDown={(e) => e.key === 'Escape' && closeSearch()}
            />
            <button className={`pp-icon-button${caseSensitive ? ' active' : ''}`} title="Match Case" onClick={toggleCase}>
              Aa
            </button>
            <button className={`pp-icon-button${useRegex ? ' active' : ''}`} title="Use Regular Expression" onClick={toggleRegex}>
              .*
            </button>
            <button className="pp-icon-button" title="Close" onClick={closeSearch}>
              <CloseIcon />
            </button>
          </div>
          {invalidRegex && <div className="pp-error">Invalid regular expression.</div>}
        </div>
      )}

      {error && <div className="pp-error">{error}</div>}
      {!rootPath && !error && <div className="pp-empty">Loading…</div>}

      <div style={{ flex: 1, overflow: 'auto' }}>
        {searchOpen && results !== undefined ? (
          <SearchResults results={results} onOpenFile={openFile} />
        ) : (
          rootPath && <FileTree nodes={treeData} expanded={expanded} onToggle={toggle} onOpenFile={openFile} onContextMenu={(e, node) => setMenu({ x: e.clientX, y: e.clientY, node })} />
        )}
      </div>

      {menu && <ContextMenu x={menu.x} y={menu.y} items={contextMenuItems(menu.node)} onClose={() => setMenu(undefined)} />}

      {prompt && prompt.kind === 'newFile' && <PromptModal title="New File" onSubmit={submitPrompt} onCancel={() => setPrompt(undefined)} />}
      {prompt && prompt.kind === 'newFolder' && <PromptModal title="New Folder" onSubmit={submitPrompt} onCancel={() => setPrompt(undefined)} />}
      {prompt && prompt.kind === 'rename' && (
        <PromptModal title="Rename" initialValue={prompt.currentName} okLabel="Rename" onSubmit={submitPrompt} onCancel={() => setPrompt(undefined)} />
      )}
      {prompt && prompt.kind === 'delete' && (
        <PromptModal
          title={`Delete ${prompt.name}?`}
          message="Moved to the OS trash — this can be undone from there."
          danger
          confirmOnly
          okLabel="Delete"
          initialValue=""
          onSubmit={submitPrompt}
          onCancel={() => setPrompt(undefined)}
        />
      )}
    </div>
  );
}
