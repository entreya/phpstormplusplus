const esbuild = require('esbuild');

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

async function build(entry, outfile) {
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

Promise.all([
  build('src/extension.ts', 'dist/extension.js'),
  build('src/debug/debugAdapterMain.ts', 'dist/debugAdapter.js')
]).catch((e) => {
  console.error(e);
  process.exit(1);
});
