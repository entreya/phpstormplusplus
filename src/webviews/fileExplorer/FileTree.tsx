import React from 'react';
import { ChevronIcon, FolderIcon } from './icons';
import { FileTypeIcon } from './fileIcons';

export interface TreeNodeData {
  path: string;
  name: string;
  isDirectory: boolean;
  /** undefined = not fetched yet (still to be lazy-loaded on first expand) */
  children?: TreeNodeData[];
}

interface RowProps {
  node: TreeNodeData;
  depth: number;
  expanded: Set<string>;
  onToggle: (path: string) => void;
  onOpenFile: (path: string) => void;
  onContextMenu: (e: React.MouseEvent, node: TreeNodeData) => void;
}

function Row({ node, depth, expanded, onToggle, onOpenFile, onContextMenu }: RowProps): React.ReactElement {
  const isOpen = expanded.has(node.path);
  return (
    <>
      <div
        className="pp-row"
        style={{ paddingLeft: depth * 16 + 4 }}
        onClick={() => (node.isDirectory ? onToggle(node.path) : onOpenFile(node.path))}
        onContextMenu={(e) => {
          e.preventDefault();
          onContextMenu(e, node);
        }}
      >
        <span className={`pp-chevron${node.isDirectory ? '' : ' empty'}`}>{node.isDirectory && <ChevronIcon expanded={isOpen} />}</span>
        <span className="pp-icon">{node.isDirectory ? <FolderIcon open={isOpen} /> : <FileTypeIcon filename={node.name} size={14} />}</span>
        <span className="pp-name" title={node.name}>
          {node.name}
        </span>
      </div>
      {node.isDirectory &&
        isOpen &&
        node.children?.map((child) => (
          <Row key={child.path} node={child} depth={depth + 1} expanded={expanded} onToggle={onToggle} onOpenFile={onOpenFile} onContextMenu={onContextMenu} />
        ))}
    </>
  );
}

interface Props {
  nodes: TreeNodeData[];
  expanded: Set<string>;
  onToggle: (path: string) => void;
  onOpenFile: (path: string) => void;
  onContextMenu: (e: React.MouseEvent, node: TreeNodeData) => void;
}

/** Plain recursive rendering, not a library tree component — after antd's
 * Tree silently broke this exact icon/label layout, this owns every pixel
 * with our own CSS (see fileExplorerViewProvider.ts's .pp-row rules) instead
 * of depending on a composed component's internal DOM/CSS staying correct. */
export default function FileTree({ nodes, expanded, onToggle, onOpenFile, onContextMenu }: Props): React.ReactElement {
  return (
    <div>
      {nodes.map((node) => (
        <Row key={node.path} node={node} depth={0} expanded={expanded} onToggle={onToggle} onOpenFile={onOpenFile} onContextMenu={onContextMenu} />
      ))}
    </div>
  );
}
