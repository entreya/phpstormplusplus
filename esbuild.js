const esbuild = require('esbuild');

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

async function buildNode(entry, outfile) {
  const ctx = await esbuild.context({
    entryPoints: [entry],
    bundle: true,
    outfile,
    external: ['vscode'],
    format: 'cjs',
    platform: 'node',
    target: 'node18',
    sourcemap: !production,
    minify: production,
    logLevel: 'info'
  });
  if (watch) {
    await ctx.watch();
  } else {
    await ctx.rebuild();
    await ctx.dispose();
  }
}

/** Webview content runs inside the webview's own browser context, not the
 * extension host — separate bundle, browser target, no `vscode` external. */
async function buildWebview(entry, outfile) {
  const ctx = await esbuild.context({
    entryPoints: [entry],
    bundle: true,
    outfile,
    format: 'iife',
    platform: 'browser',
    target: 'es2020',
    jsx: 'automatic',
    sourcemap: !production,
    minify: production,
    logLevel: 'info'
  });
  if (watch) {
    await ctx.watch();
  } else {
    await ctx.rebuild();
    await ctx.dispose();
  }
}

Promise.all([
  buildNode('src/extension.ts', 'dist/extension.js'),
  buildNode('src/debug/debugAdapterMain.ts', 'dist/debugAdapter.js'),
  buildWebview('src/webviews/fileExplorer/main.tsx', 'dist/webview-fileExplorer.js')
]).catch((e) => {
  console.error(e);
  process.exit(1);
});
