import * as vscode from 'vscode';
import * as https from 'node:https';
import * as fsSync from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const REPO = 'entreya/phpstormplusplus';
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
const LAST_CHECK_KEY = 'phpstormpp.lastUpdateCheck';
const DISMISSED_VERSION_KEY = 'phpstormpp.dismissedUpdateVersion';

interface ReleaseInfo {
  version: string;
  htmlUrl: string;
  vsixUrl?: string;
  vsixName?: string;
}

/** Plain X.Y.Z numeric comparison — this project doesn't use pre-release/build
 * suffixes, so a semver library would be overkill. Returns >0 if `a` is newer. */
function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

function getJson(url: string): Promise<any> {
  return new Promise((resolve, reject) => {
    https
      .get(url, { headers: { 'User-Agent': 'phpstormplusplus-update-checker' } }, (res) => {
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          getJson(res.headers.location).then(resolve, reject);
          return;
        }
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(e);
          }
        });
      })
      .on('error', reject);
  });
}

function downloadFile(url: string, destPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    https
      .get(url, { headers: { 'User-Agent': 'phpstormplusplus-update-checker' } }, (res) => {
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          downloadFile(res.headers.location, destPath).then(resolve, reject);
          return;
        }
        const file = fsSync.createWriteStream(destPath);
        res.pipe(file);
        file.on('finish', () => file.close(() => resolve()));
        file.on('error', reject);
      })
      .on('error', reject);
  });
}

async function fetchLatestRelease(): Promise<ReleaseInfo | undefined> {
  try {
    const json = await getJson(`https://api.github.com/repos/${REPO}/releases/latest`);
    const asset = (json.assets ?? []).find((a: any) => typeof a.name === 'string' && a.name.endsWith('.vsix'));
    const version = String(json.tag_name ?? '').replace(/^v/, '');
    if (!version) return undefined;
    return { version, htmlUrl: json.html_url, vsixUrl: asset?.browser_download_url, vsixName: asset?.name };
  } catch {
    return undefined;
  }
}

async function downloadAndInstall(release: ReleaseInfo): Promise<void> {
  if (!release.vsixUrl || !release.vsixName) return;
  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: `PHPStorm++: downloading ${release.vsixName}` },
    async () => {
      const dest = path.join(os.tmpdir(), release.vsixName!);
      await downloadFile(release.vsixUrl!, dest);
      await vscode.commands.executeCommand('workbench.extensions.installExtension', vscode.Uri.file(dest));
    }
  );
  const choice = await vscode.window.showInformationMessage(
    `PHPStorm++: v${release.version} installed. Reload the window to activate it.`,
    'Reload Window'
  );
  if (choice === 'Reload Window') {
    await vscode.commands.executeCommand('workbench.action.reloadWindow');
  }
}

/**
 * Checks GitHub Releases for a newer version than what's running. We publish
 * via GitHub Releases rather than the Marketplace, so there's no built-in
 * auto-update — this is the replacement. Background checks are throttled to
 * once/day and won't re-prompt for a version the user already dismissed;
 * `manual` (from the command palette) always checks and always reports back,
 * even "you're up to date".
 */
export async function checkForUpdates(context: vscode.ExtensionContext, currentVersion: string, manual: boolean): Promise<void> {
  if (!manual) {
    const lastCheck = context.globalState.get<number>(LAST_CHECK_KEY, 0);
    if (Date.now() - lastCheck < CHECK_INTERVAL_MS) return;
  }
  await context.globalState.update(LAST_CHECK_KEY, Date.now());

  const release = await fetchLatestRelease();
  if (!release) {
    if (manual) vscode.window.showWarningMessage('PHPStorm++: could not check for updates (no network, or no releases published yet).');
    return;
  }

  if (compareVersions(release.version, currentVersion) <= 0) {
    if (manual) vscode.window.showInformationMessage(`PHPStorm++: you're up to date (v${currentVersion}).`);
    return;
  }

  if (!manual && context.globalState.get<string>(DISMISSED_VERSION_KEY) === release.version) return;

  const actions = release.vsixUrl ? ['Download && Install', 'View Release', 'Not Now'] : ['View Release', 'Not Now'];
  const choice = await vscode.window.showInformationMessage(
    `PHPStorm++ v${release.version} is available (you have v${currentVersion}).`,
    ...actions
  );

  if (choice === 'View Release') {
    void vscode.env.openExternal(vscode.Uri.parse(release.htmlUrl));
  } else if (choice === 'Download && Install') {
    await downloadAndInstall(release);
  } else {
    await context.globalState.update(DISMISSED_VERSION_KEY, release.version);
  }
}
