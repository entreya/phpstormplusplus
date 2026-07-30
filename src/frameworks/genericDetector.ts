import * as vscode from 'vscode';

export interface DetectedFramework {
  id: string;
  name: string;
  /** what tipped it off, for diagnostics/troubleshooting */
  reason: string;
}

/** composer.json require/require-dev package name (substring) -> framework display name. */
const COMPOSER_SIGNATURES: Array<{ match: string; id: string; name: string }> = [
  { match: 'yiisoft/yii2', id: 'yii2', name: 'Yii2' },
  { match: 'laravel/framework', id: 'laravel', name: 'Laravel' },
  { match: 'symfony/framework-bundle', id: 'symfony', name: 'Symfony' },
  { match: 'symfony/symfony', id: 'symfony', name: 'Symfony' },
  { match: 'cakephp/cakephp', id: 'cakephp', name: 'CakePHP' },
  { match: 'codeigniter4/framework', id: 'codeigniter', name: 'CodeIgniter' },
  { match: 'slim/slim', id: 'slim', name: 'Slim' },
  { match: 'drupal/core', id: 'drupal', name: 'Drupal' },
  { match: 'magento/framework', id: 'magento', name: 'Magento' },
  { match: 'laminas/laminas-mvc', id: 'laminas', name: 'Laminas' },
  { match: 'phalcon/', id: 'phalcon', name: 'Phalcon' },
  { match: 'typo3/cms-core', id: 'typo3', name: 'TYPO3' },
  { match: 'roots/wordpress', id: 'wordpress', name: 'WordPress' },
  { match: 'johnpbloch/wordpress', id: 'wordpress', name: 'WordPress' }
];

/** Root-level files that give away a framework even without (or in addition to) composer.json. */
const FILE_SIGNATURES: Array<{ glob: string; id: string; name: string }> = [
  { glob: 'artisan', id: 'laravel', name: 'Laravel' },
  { glob: 'bin/console', id: 'symfony', name: 'Symfony' },
  { glob: 'wp-config.php', id: 'wordpress', name: 'WordPress' },
  { glob: 'wp-load.php', id: 'wordpress', name: 'WordPress' },
  { glob: 'craft', id: 'craftcms', name: 'Craft CMS' },
  { glob: 'spark', id: 'codeigniter', name: 'CodeIgniter' }
];

/**
 * Detects which known PHP framework(s) a workspace uses. Unlike the per-framework
 * FrameworkModule.detect() (which only exists for frameworks we've built deep
 * support for), this runs for *any* recognized framework so the user gets visible
 * confirmation of what was found, even before a dedicated module exists for it.
 */
export async function detectFrameworks(workspaceRoot: vscode.Uri): Promise<DetectedFramework[]> {
  const found = new Map<string, DetectedFramework>();

  try {
    const composerUri = vscode.Uri.joinPath(workspaceRoot, 'composer.json');
    const bytes = await vscode.workspace.fs.readFile(composerUri);
    const json = JSON.parse(Buffer.from(bytes).toString('utf8'));
    const deps = Object.keys({ ...json.require, ...json['require-dev'] });
    for (const sig of COMPOSER_SIGNATURES) {
      const dep = deps.find((d) => d.includes(sig.match));
      if (dep && !found.has(sig.id)) {
        found.set(sig.id, { id: sig.id, name: sig.name, reason: `composer.json requires ${dep}` });
      }
    }
  } catch {
    // no composer.json, or unreadable — fall through to file-based signatures
  }

  for (const sig of FILE_SIGNATURES) {
    if (found.has(sig.id)) continue;
    try {
      await vscode.workspace.fs.stat(vscode.Uri.joinPath(workspaceRoot, sig.glob));
      found.set(sig.id, { id: sig.id, name: sig.name, reason: `found ${sig.glob}` });
    } catch {
      // not present
    }
  }

  return [...found.values()];
}
