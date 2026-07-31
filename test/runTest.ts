import * as path from 'path';
import { runTests } from '@vscode/test-electron';

async function main() {
  // Compiled from test/tsconfig.json with rootDir ".." (so src/ can be
  // imported directly for unit testing), so this file lands two levels down
  // at out-test/test/runTest.js rather than out-test/runTest.js.
  const extensionDevelopmentPath = path.resolve(__dirname, '../..');
  const extensionTestsPath = path.resolve(__dirname, './suite/index');
  const fixturesPath = path.resolve(__dirname, '../../test-fixtures');

  await runTests({
    extensionDevelopmentPath,
    extensionTestsPath,
    launchArgs: [fixturesPath, '--disable-extensions']
  });
}

main().catch((err) => {
  console.error('Failed to run tests', err);
  process.exit(1);
});
