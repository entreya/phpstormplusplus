import * as vscode from 'vscode';

const EXTENSION_ID = 'phpstormplusplus.phpstormplusplus';
const REPO_URL = 'https://github.com/entreya/phpstormplusplus';

interface CenterItem extends vscode.QuickPickItem {
  action: () => void | Promise<void>;
}

function separator(label: string): vscode.QuickPickItem {
  return { label, kind: vscode.QuickPickItemKind.Separator };
}

async function setTheme(name: string): Promise<void> {
  await vscode.workspace.getConfiguration().update('workbench.colorTheme', name, vscode.ConfigurationTarget.Global);
}

function buildItems(): (CenterItem | vscode.QuickPickItem)[] {
  const run =
    (command: string, ...args: unknown[]): (() => Promise<void>) =>
    async () => {
      await vscode.commands.executeCommand(command, ...args);
    };

  return [
    separator('Navigate & Search'),
    { label: '$(search) Search Everywhere', description: 'Cmd+; / Ctrl+;', action: run('phpstormpp.searchEverywhere') },
    { label: '$(new-file) New PHP Class...', action: run('phpstormpp.newPhpClass') },
    { label: '$(refresh) Rebuild PHP Index', action: run('phpstormpp.reindex') },

    separator('Refactor & Generate'),
    { label: '$(sparkle) Generate...', description: 'Constructor, Getters/Setters, PHPDoc', action: run('phpstormpp.generate') },
    { label: '$(edit) Generate PHPDoc', action: run('phpstormpp.generatePhpDoc') },
    { label: '$(symbol-variable) Extract Variable', action: run('phpstormpp.extractVariable') },
    { label: '$(symbol-method) Extract Method', action: run('phpstormpp.extractMethod') },
    { label: '$(list-tree) Optimize Imports', action: run('phpstormpp.optimizeImports') },

    separator('Database'),
    { label: '$(database) Add Database Connection...', action: run('phpstormpp.database.addConnection') },
    { label: '$(terminal) New Query Console', action: run('phpstormpp.database.newQuery') },
    { label: '$(terminal) Open Terminal', description: 'Also available as a button on the PHPStorm++ panel', action: run('phpstormpp.openTerminal') },

    separator('Yii2'),
    { label: '$(arrow-right) Go to Controller', action: run('phpstormpp.yii2.goToController') },
    { label: '$(arrow-left) Go to View', action: run('phpstormpp.yii2.goToView') },

    separator('Appearance'),
    { label: '$(color-mode) Use Dark Theme', description: 'PHPStorm++ Dark (Darcula-inspired)', action: () => setTheme('PHPStorm++ Dark (Darcula-inspired)') },
    { label: '$(color-mode) Use Light Theme', description: 'PHPStorm++ Light', action: () => setTheme('PHPStorm++ Light') },

    separator('Settings'),
    { label: '$(settings-gear) Open PHPStorm++ Settings', action: run('workbench.action.openSettings', `@ext:${EXTENSION_ID}`) },
    { label: '$(keyboard) Open PHPStorm++ Keyboard Shortcuts', action: run('workbench.action.openGlobalKeybindings', `@ext:${EXTENSION_ID}`) },

    separator('Updates & Help'),
    { label: '$(cloud-download) Check for Updates', action: run('phpstormpp.checkForUpdates') },
    {
      label: '$(github) View on GitHub',
      action: async () => {
        await vscode.env.openExternal(vscode.Uri.parse(REPO_URL));
      }
    }
  ];
}

export function registerCommandCenter(): vscode.Disposable[] {
  const openCommand = vscode.commands.registerCommand('phpstormpp.openCommandCenter', async () => {
    const picked = await vscode.window.showQuickPick(buildItems() as CenterItem[], {
      title: 'PHPStorm++ Command Center',
      placeHolder: 'Every PHPStorm++ command and setting in one place — start typing to filter...',
      matchOnDescription: true
    });
    await picked?.action();
  });

  const statusBarItem = vscode.window.createStatusBarItem('phpstormpp.commandCenter', vscode.StatusBarAlignment.Left, 100);
  statusBarItem.text = '$(gear) PHPStorm++';
  statusBarItem.tooltip = 'Open the PHPStorm++ Command Center';
  statusBarItem.command = 'phpstormpp.openCommandCenter';
  statusBarItem.show();

  return [openCommand, statusBarItem];
}
