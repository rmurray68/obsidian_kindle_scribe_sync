#!/usr/bin/env node
/**
 * GUI Deployer for Kindle Scribe Notes Sync
 *
 * - Builds the plugin (npm run build)
 * - Opens a native macOS folder picker to select the Obsidian vault root
 * - Creates .obsidian/plugins/rm-kindle-scribe-notes-sync/ if needed
 * - Copies main.js, manifest.json, styles.css
 *
 * Usage:  node scripts/deploy-gui.mjs
 *    or:  npm run deploy
 */

import { execSync, spawnSync } from 'child_process';
import { readFileSync, copyFileSync, mkdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..');
const PLUGIN_ID = 'rm-kindle-scribe-notes-sync';
const ASSETS = ['main.js', 'manifest.json', 'styles.css'];

const manifest = JSON.parse(readFileSync(join(REPO_ROOT, 'manifest.json'), 'utf8'));
const PLUGIN_NAME = manifest.name;
const VERSION = manifest.version;

// ── 1. Build ────────────────────────────────────────────────────────────────
console.log(`\n${PLUGIN_NAME} v${VERSION} — Deployer\n`);
console.log('Building...');
const build = spawnSync('npm', ['run', 'build'], {
    cwd: REPO_ROOT,
    stdio: 'inherit',
});
if (build.status !== 0) {
    console.error('Build failed — aborting deploy.');
    process.exit(1);
}
console.log('Build complete.\n');

// ── 2. Folder picker via AppleScript ────────────────────────────────────────
console.log('Opening vault folder picker...');
let vaultRoot;
try {
    const script = `
        tell application "System Events"
            activate
        end tell
        set chosen to POSIX path of (choose folder with prompt "Select your Obsidian vault root folder:")
        return chosen
    `;
    // Run osascript; trim trailing newline/slash
    vaultRoot = execSync(`osascript -e '${script.replace(/'/g, "'\\''")}'`, { encoding: 'utf8' }).trim();
    // Remove trailing slash if present
    vaultRoot = vaultRoot.replace(/\/$/, '');
} catch {
    console.error('Folder selection cancelled or failed — aborting.');
    process.exit(0);
}

if (!vaultRoot) {
    console.error('No folder selected — aborting.');
    process.exit(0);
}

console.log(`Vault: ${vaultRoot}`);

// ── 3. Create plugin folder ──────────────────────────────────────────────────
const pluginDest = join(vaultRoot, '.obsidian', 'plugins', PLUGIN_ID);
if (!existsSync(pluginDest)) {
    mkdirSync(pluginDest, { recursive: true });
    console.log(`Created: ${pluginDest}`);
}

// ── 4. Copy assets ───────────────────────────────────────────────────────────
for (const file of ASSETS) {
    const src = join(REPO_ROOT, file);
    const dest = join(pluginDest, file);
    if (!existsSync(src)) {
        console.warn(`Warning: ${file} not found — skipping.`);
        continue;
    }
    copyFileSync(src, dest);
    console.log(`Copied: ${file}`);
}

// ── 5. Done — show confirmation dialog ──────────────────────────────────────
const successMsg = `${PLUGIN_NAME} v${VERSION} deployed to:\\n${pluginDest}`;
execSync(`osascript -e 'display dialog "${successMsg}" buttons {"OK"} default button "OK" with title "Deploy Complete"'`);

console.log(`\nDeployed to: ${pluginDest}\n`);
