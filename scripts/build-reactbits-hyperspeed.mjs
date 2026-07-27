import { build } from 'esbuild';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const generatedRoot = path.join(projectRoot, '.reactbits', 'Hyperspeed');
const publicRoot = path.join(projectRoot, 'public');

// Official ReactBits JS + CSS implementation used by the linked component page.
const sourceBase = 'https://raw.githubusercontent.com/DavidHDev/react-bits/main/src/content/Backgrounds/Hyperspeed';
const sourceFiles = ['Hyperspeed.jsx', 'Hyperspeed.css', 'HyperSpeedPresets.js'];

async function downloadOfficialSource(fileName) {
    const response = await fetch(`${sourceBase}/${fileName}`, {
        headers: { 'user-agent': 'OrexisAI ReactBits build' }
    });

    if (!response.ok) {
        throw new Error(`Unable to download official ReactBits ${fileName}: HTTP ${response.status}`);
    }

    const source = await response.text();
    if (source.length < 50) {
        throw new Error(`Official ReactBits ${fileName} response was unexpectedly empty.`);
    }
    return source;
}

async function main() {
    await rm(generatedRoot, { recursive: true, force: true });
    await mkdir(generatedRoot, { recursive: true });
    await mkdir(publicRoot, { recursive: true });

    const downloaded = await Promise.all(
        sourceFiles.map(async fileName => [fileName, await downloadOfficialSource(fileName)])
    );

    for (const [fileName, source] of downloaded) {
        await writeFile(path.join(generatedRoot, fileName), source, 'utf8');
    }

    const entryFile = path.join(generatedRoot, 'outcomeai-entry.jsx');
    await writeFile(
        entryFile,
        `import React from 'react';\n` +
            `import { createRoot } from 'react-dom/client';\n` +
            `import Hyperspeed from './Hyperspeed.jsx';\n` +
            `import { hyperspeedPresets } from './HyperSpeedPresets.js';\n\n` +
            `const mount = document.getElementById('outcomeHyperspeed');\n` +
            `if (mount && mount.dataset.reactBitsMounted !== 'true') {\n` +
            `  mount.dataset.reactBitsMounted = 'true';\n` +
            `  createRoot(mount).render(\n` +
            `    React.createElement(Hyperspeed, { effectOptions: hyperspeedPresets.three })\n` +
            `  );\n` +
            `}\n`,
        'utf8'
    );

    await build({
        entryPoints: [entryFile],
        outfile: path.join(publicRoot, 'hyperspeed.js'),
        bundle: true,
        format: 'iife',
        platform: 'browser',
        target: ['es2020'],
        jsx: 'automatic',
        minify: true,
        sourcemap: false,
        legalComments: 'eof',
        logLevel: 'info'
    });

    console.log('Built the official ReactBits Hyperspeed component with preset three.');
}

main().catch(error => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
});
