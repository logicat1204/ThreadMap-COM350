import { copyFile, cp, mkdir, readFile, writeFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const copy = async (source, target) => {
  await mkdir(new URL('.', new URL(target, root)), { recursive: true });
  await copyFile(new URL(source, root), new URL(target, root));
};
await copy('node_modules/katex/dist/katex.mjs', 'public/vendor/katex/katex.mjs');
await copy('node_modules/katex/dist/katex.min.css', 'public/vendor/katex/katex.min.css');
await copy('node_modules/katex/LICENSE', 'public/vendor/katex/LICENSE');
await cp(new URL('node_modules/katex/dist/fonts/', root), new URL('public/vendor/katex/fonts/', root), { recursive: true });
await copy('node_modules/@highlightjs/cdn-assets/es/highlight.min.js', 'public/vendor/highlight/highlight.js');
await copy('node_modules/@highlightjs/cdn-assets/LICENSE', 'public/vendor/highlight/LICENSE');
const version = async (name) => JSON.parse(await readFile(new URL(`node_modules/${name}/package.json`, root))).version;
await writeFile(new URL('public/vendor/README.md', root),
  `# Browser dependencies\n\nKaTeX ${await version('katex')} (MIT), highlight.js ${await version('@highlightjs/cdn-assets')} (BSD-3-Clause).\n\nServed locally. Licenses are included. To update: npm install, then npm run vendor; commit public/vendor together with the lockfile.\n`);
