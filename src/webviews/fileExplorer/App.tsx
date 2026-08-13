import React, { useEffect, useRef, useState } from 'react';
import { ConfigProvider, theme as antdTheme, Tree, Dropdown, Modal, Input, Button, Space, Typography, message } from 'antd';
import { FolderOutlined, FolderOpenOutlined, PlusSquareOutlined, MinusSquareOutlined, LoadingOutlined } from '@ant-design/icons';
import type { DataNode } from 'antd/es/tree';
import type { MenuProps } from 'antd';
import { onExtensionMessage, postToExtension } from './vscodeApi';
import type { FileEntry } from './protocol';
import { FileTypeIcon } from './fileIcons';

const { DirectoryTree } = Tree;

function isDarkTheme(): boolean {
  return document.body.classList.contains('vscode-dark') || document.body.classList.contains('vscode-high-contrast');
}

function toNode(entry: FileEntry): DataNode {
  return { key: entry.path, title: entry.name, isLeaf: !entry.isDirectory };
}

/** Replaces the children of the node with the given key, anywhere in the tree. */
function withChildren(nodes: DataNode[], key: string, children: DataNode[]): DataNode[] {
  return nodes.map((node) => {
    if (node.key === key) return { ...node, children };
    if (node.children) return { ...node, children: withChildren(node.children, key, children) };
    return node;
  });
}

interface PromptState {
  title: string;
  initialValue: string;
  resolve: (value: string | undefined) => void;
}

export default function App(): React.ReactElement {
  const [dark] = useState(isDarkTheme());
  const [rootPath, setRootPath] = useState<string>();
  const [treeData, setTreeData] = useState<DataNode[]>([]);
  const [error, setError] = useState<string>();
  const [prompt, setPrompt] = useState<PromptState>();
  const [promptValue, setPromptValue] = useState('');
  const pendingLoads = useRef(new Map<string, () => void>());

  useEffect(() => {
    const unsubscribe = onExtensionMessage((msg) => {
      switch (msg.type) {
        case 'root':
          setRootPath(msg.path);
          setTreeData([{ key: msg.path, title: msg.name }]);
          postToExtension({ type: 'listDir', path: msg.path });
          break;
        case 'dirListing': {
          const children = msg.entries.map(toNode);
          setTreeData((prev) => withChildren(prev, msg.path, children));
          pendingLoads.current.get(msg.path)?.();
          pendingLoads.current.delete(msg.path);
          break;
        }
        case 'refresh':
          postToExtension({ type: 'listDir', path: msg.path });
          break;
        case 'error':
          setError(msg.message);
          message.error(msg.message);
          break;
      }
    });
    postToExtension({ type: 'ready' });
    return unsubscribe;
  }, []);

  function askPrompt(title: string, initialValue = ''): Promise<string | undefined> {
    return new Promise((resolve) => {
      setPromptValue(initialValue);
      setPrompt({ title, initialValue, resolve });
    });
  }

  function loadData(node: DataNode): Promise<void> {
    return new Promise((resolve) => {
      if (node.children) {
        resolve();
        return;
      }
      pendingLoads.current.set(node.key as string, resolve);
      postToExtension({ type: 'listDir', path: node.key as string });
    });
  }

  function onSelect(_keys: React.Key[], info: { node: DataNode }): void {
    if (info.node.isLeaf) {
      postToExtension({ type: 'openFile', path: info.node.key as string });
    }
  }

  async function onNewFile(dirPath: string): Promise<void> {
    const name = await askPrompt('New File', '');
    if (name) postToExtension({ type: 'createFile', dirPath, name });
  }

  async function onNewFolder(dirPath: string): Promise<void> {
    const name = await askPrompt('New Folder', '');
    if (name) postToExtension({ type: 'createFolder', dirPath, name });
  }

  async function onRename(path: string, currentName: string): Promise<void> {
    const name = await askPrompt('Rename', currentName);
    if (name && name !== currentName) postToExtension({ type: 'rename', path, newName: name });
  }

  function onDelete(path: string, name: string): void {
    Modal.confirm({
      title: `Delete ${name}?`,
      content: 'Moved to the OS trash — this can be undone from there.',
      okText: 'Delete',
      okButtonProps: { danger: true },
      onOk: () => postToExtension({ type: 'delete', path })
    });
  }

  function contextMenuFor(node: DataNode): MenuProps['items'] {
    const isDir = !node.isLeaf;
    const items: MenuProps['items'] = [];
    if (isDir) {
      items.push(
        { key: 'newFile', label: 'New File', onClick: () => onNewFile(node.key as string) },
        { key: 'newFolder', label: 'New Folder', onClick: () => onNewFolder(node.key as string) },
        { type: 'divider' }
      );
    }
    if (node.key !== rootPath) {
      items.push(
        { key: 'rename', label: 'Rename', onClick: () => onRename(node.key as string, String(node.title)) },
        { key: 'delete', label: 'Delete', danger: true, onClick: () => onDelete(node.key as string, String(node.title)) }
      );
    }
    return items;
  }

  return (
    <ConfigProvider
      theme={{
        algorithm: dark ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm,
        token: {
          colorBgContainer: 'var(--vscode-sideBar-background)',
          colorText: 'var(--vscode-sideBar-foreground)',
          colorPrimary: 'var(--vscode-button-background)',
          borderRadius: 2
        }
      }}
    >
      <div style={{ padding: 8, height: '100%', boxSizing: 'border-box', display: 'flex', flexDirection: 'column' }}>
        <Space style={{ marginBottom: 8, justifyContent: 'space-between', width: '100%' }}>
          <Typography.Text strong style={{ fontSize: 12, textTransform: 'uppercase', opacity: 0.75 }}>
            Explorer
          </Typography.Text>
          <Button
            size="small"
            type="text"
            onClick={() => rootPath && postToExtension({ type: 'listDir', path: rootPath })}
          >
            Refresh
          </Button>
        </Space>

        {error && (
          <Typography.Text type="danger" style={{ fontSize: 12, marginBottom: 8 }}>
            {error}
          </Typography.Text>
        )}

        {!rootPath && !error && <Typography.Text type="secondary">Loading…</Typography.Text>}

        {rootPath && (
          <div style={{ flex: 1, overflow: 'auto' }}>
            {/* DirectoryTree + an explicit switcherIcon, rather than plain Tree relying
                on antd's default switcher glyph — the default depends on styling that
                doesn't reliably resolve inside a webview's restricted environment,
                which is what was causing the chevron/label to render disconnected. */}
            <DirectoryTree
              treeData={treeData}
              loadData={loadData}
              onSelect={onSelect}
              showIcon
              showLine={{ showLeafIcon: false }}
              defaultExpandedKeys={[rootPath]}
              switcherIcon={(props) => {
                if (props.loading) return <LoadingOutlined />;
                if (props.isLeaf) return null;
                return props.expanded ? <MinusSquareOutlined /> : <PlusSquareOutlined />;
              }}
              icon={(props) =>
                props.isLeaf ? (
                  <FileTypeIcon filename={String(props.title ?? '')} />
                ) : props.expanded ? (
                  <FolderOpenOutlined />
                ) : (
                  <FolderOutlined />
                )
              }
              titleRender={(node) => (
                <Dropdown menu={{ items: contextMenuFor(node) }} trigger={['contextMenu']}>
                  <span title={String(node.title)}>{node.title as React.ReactNode}</span>
                </Dropdown>
              )}
            />
          </div>
        )}

        <Modal
          title={prompt?.title}
          open={!!prompt}
          onCancel={() => {
            prompt?.resolve(undefined);
            setPrompt(undefined);
          }}
          onOk={() => {
            prompt?.resolve(promptValue.trim() || undefined);
            setPrompt(undefined);
          }}
        >
          <Input value={promptValue} onChange={(e) => setPromptValue(e.target.value)} autoFocus onPressEnter={() => {
            prompt?.resolve(promptValue.trim() || undefined);
            setPrompt(undefined);
          }} />
        </Modal>
      </div>
    </ConfigProvider>
  );
}
