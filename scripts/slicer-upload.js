#!/usr/bin/env node

/**
 * Slicer post-processing script for Print Farm Manager.
 *
 * Add to your slicer's post-processing scripts field:
 *   Windows:  "C:\path\to\slicer-upload.bat"
 *   macOS:    node "/home/user/slicer-upload.js"
 *
 * The script auto-detects the real export file using a priority chain:
 *   1. --name flag (explicit override)
 *   2. SLIC3R_PP_OUTPUT_NAME env var (OrcaSlicer 2.x / Creality Print — has correct filename)
 *   3. CLI argument (PrusaSlicer / Cura pass the real .gcode path directly)
 *   4. .pp metadata derivation (Bambu Studio / older OrcaSlicer — strips .pp to find temp gcode)
 *
 * Flags:
 *   --server <url>    API base URL (default: http://localhost:3000, or PRINT_FARM_URL env var)
 *   --name <name>     Display name override (e.g. "Widget v2.gcode")
 *   --open-browser    Launch the default browser to the Inbox page after upload
 *   --verbose, -v     Print detailed diagnostic output to stderr
 *   --log             Same as --verbose (.bat wrapper redirects stderr to file)
 *   --help, -h        Show this message
 */

const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

// --- Parse CLI arguments ---
const args = process.argv.slice(2);

let openBrowser = false;
let serverUrl = process.env.PRINT_FARM_URL || 'http://localhost:3000';
let filePath = null;
let customName = null;
let showHelp = false;
let verbose = false;

for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (arg === '--help' || arg === '-h') {
    showHelp = true;
  } else if (arg === '--verbose' || arg === '-v' || arg === '--log') {
    verbose = true;
  } else if (arg === '--name' && args[i + 1]) {
    customName = args[i + 1];
    i++;
  } else if (arg === '--open-browser') {
    openBrowser = true;
  } else if (arg === '--server' && args[i + 1]) {
    serverUrl = args[i + 1];
    i++;
  } else if (!arg.startsWith('--')) {
    filePath = arg;
  }
}

if (showHelp) {
  console.log(`
Print Farm Manager — Slicer Upload Script
=========================================

Uploads a sliced file to the Print Farm Manager Inbox.

Automatically detects the real export file from:
  • SLIC3R_PP_OUTPUT_NAME env var (OrcaSlicer / Creality Print)
  • CLI argument (PrusaSlicer / Cura pass the actual file)
  • .pp metadata derivation (Bambu Studio / older OrcaSlicer)

Add to your slicer's post-processing scripts field:
  Windows:  "C:\\path\\to\\slicer-upload.bat"
  macOS:    node slicer-upload.js

FLAGS
  --server <url>      Server base URL (default: http://localhost:3000)
  --name <filename>   Display name override
  --open-browser      Open the Inbox page after upload
  --verbose, -v       Print detailed diagnostic output to stderr
  --log               Same as --verbose
  --help, -h          Show this message
`);
  process.exit(0);
}

function log(msg) {
  if (verbose) console.error(`[slicer-upload] ${msg}`);
}

log(`Args:    ${JSON.stringify(process.argv.slice(2))}`);
log(`Server:  ${serverUrl}`);

// --- Determine the real file to upload ---
let uploadPath = null;
let displayName = null;

// Strategy 1: --name flag (explicit override of display name)
if (customName) {
  log(`--name override: "${customName}"`);
  displayName = customName;
}

// Strategy 2: SLIC3R_PP_OUTPUT_NAME env var (OrcaSlicer 2.x, Creality Print)
// These slicers set this to the real export path with the correct filename.
// Bambu Studio also sets it, but points to a temp hash file — we skip those.
const outputEnv = process.env.SLIC3R_PP_OUTPUT_NAME;
if (outputEnv) {
  const resolved = path.resolve(outputEnv);
  log(`SLIC3R_PP_OUTPUT_NAME: ${resolved}`);
  if (fs.existsSync(resolved)) {
    const envName = path.basename(resolved);
    // Skip temp hash files from Bambu Studio (e.g. ".33556.0.gcode")
    if (!envName.match(/^\.?\d+\.\d+\./)) {
      uploadPath = resolved;
      if (!displayName) displayName = envName;
      log(`Using SLIC3R_PP_OUTPUT_NAME file: ${uploadPath}`);
    } else {
      log(`SLIC3R_PP_OUTPUT_NAME is a temp file — ignoring`);
    }
  } else {
    log(`SLIC3R_PP_OUTPUT_NAME file not found: ${resolved}`);
  }
}

// Strategy 3: CLI argument (PrusaSlicer, Cura — pass the real file directly)
if (!uploadPath && filePath) {
  filePath = path.resolve(filePath);
  log(`CLI arg:  ${filePath}`);
  if (fs.existsSync(filePath)) {
    const ext = path.extname(filePath).toLowerCase();
    if (ext === '.gcode' || ext === '.bgcode' || ext === '.3mf') {
      uploadPath = filePath;
      if (!displayName) displayName = path.basename(filePath);
      log(`Using CLI arg file: ${uploadPath}`);
    }
  } else {
    log(`CLI arg file not found: ${filePath}`);
  }
}

// Strategy 4: .pp metadata derivation (Bambu Studio, older OrcaSlicer)
// Strips .pp from the CLI arg to find the temp gcode next to it.
if (!uploadPath && filePath && path.extname(filePath).toLowerCase() === '.pp') {
  filePath = path.resolve(filePath);
  const derived = filePath.replace(/\.pp$/i, '');
  log(`.pp derivation: ${derived}`);
  if (fs.existsSync(derived)) {
    uploadPath = derived;
    if (!displayName) displayName = path.basename(derived);
    log(`Using derived temp gcode: ${uploadPath}`);
  } else {
    log(`Derived file not found — scanning directory...`);
    const dir = path.dirname(filePath);
    try {
      for (const f of fs.readdirSync(dir)) {
        const e = path.extname(f).toLowerCase();
        if (e === '.gcode' || e === '.bgcode' || e === '.3mf') {
          uploadPath = path.join(dir, f);
          if (!displayName) displayName = f;
          log(`Found sibling: ${uploadPath}`);
          break;
        }
      }
    } catch (_) {}
  }
}

// --- Validate ---
if (!uploadPath) {
  log('No usable file found — exiting');
  if (outputEnv || filePath) {
    log('Dumping slicer env vars for debugging:');
    for (const [k, v] of Object.entries(process.env)) {
      const ku = k.toUpperCase();
      if (ku.includes('SLIC3R') || ku.includes('CURA') || ku.includes('BAMBU') || ku.includes('CREALITY') || ku.includes('PP_')) {
        log(`  ${k}=${v}`);
      }
    }
  }
  process.exit(1);
}

const fileSize = fs.statSync(uploadPath).size;
log(`Upload:  ${displayName}  (${fileSize} bytes)`);

// --- Upload ---
const apiUrl = serverUrl.replace(/\/+$/, '') + '/api/inbox';

async function doUpload() {
  try {
    const fileBuffer = fs.readFileSync(uploadPath);
    const formData = new FormData();
    formData.append('file', new Blob([fileBuffer]), displayName);

    log(`POST ${apiUrl}`);
    console.log(`Uploading "${displayName}" ...`);

    const response = await fetch(apiUrl, { method: 'POST', body: formData });

    log(`Response: ${response.status} ${response.statusText}`);

    if (!response.ok) {
      let errorMsg;
      try { const err = await response.json(); errorMsg = err.error || response.statusText; }
      catch { errorMsg = response.statusText; }
      log(`FAILED: ${errorMsg}`);
      console.error(`Upload failed (${response.status}): ${errorMsg}`);
      process.exit(1);
    }

    const result = await response.json();
    console.log(`Uploaded — inbox ID ${result.id}`);
    log(`SUCCESS — inbox ID ${result.id}`);

    if (openBrowser) {
      const inboxUrl = serverUrl.replace(/\/+$/, '') + '/projects';
      const platform = process.platform;
      const cmd = platform === 'win32'
        ? `start "" "${inboxUrl}"`
        : platform === 'darwin'
          ? `open "${inboxUrl}"`
          : `xdg-open "${inboxUrl}"`;
      exec(cmd, (err) => { if (err) log(`Browser error: ${err.message}`); });
    }
  } catch (err) {
    log(`Error: ${err.code || err.message}`);
    if (err.code === 'ECONNREFUSED' || err.cause?.code === 'ECONNREFUSED') {
      console.error(
        `\nCannot reach Print Farm Manager at ${serverUrl} — is the server running?\n\n` +
        'If the server is on a different machine:\n' +
        '  • Set PRINT_FARM_URL environment variable, or\n' +
        '  • Pass --server <url>\n'
      );
    } else {
      console.error(`Upload error: ${err.message}`);
    }
    process.exit(1);
  }
}

doUpload();