#!/usr/bin/env node

/**
 * Slicer post-processing script for Print Farm Manager.
 *
 * Add to your slicer's post-processing scripts field:
 *   Windows:  "C:\path\to\slicer-upload.bat"
 *   macOS:    node "/home/user/slicer-upload.js"
 *
 * Flags:
 *   --server <url>    API base URL (default: http://localhost:3000, or PRINT_FARM_URL env var)
 *   --open-browser    Launch the default browser to the Inbox page after upload
 *   --verbose, -v     Print detailed diagnostic output to stderr
 *   --log             Same as --verbose (.bat wrapper redirects stderr to a log file)
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
let showHelp = false;
let verbose = false;

for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (arg === '--help' || arg === '-h') {
    showHelp = true;
  } else if (arg === '--verbose' || arg === '-v' || arg === '--log') {
    verbose = true;
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

USAGE
  node slicer-upload.js [flags] <file-path>

  The slicer passes the file path automatically. Add to your
  slicer's post-processing scripts field:
    Windows:  "C:\\path\\to\\slicer-upload.bat"
    macOS:    node slicer-upload.js

FLAGS
  --server <url>      Server base URL (default: http://localhost:3000)
  --open-browser      Open the Inbox page in your default browser after upload
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

if (!filePath) {
  log('No file path — exiting');
  console.error('Usage: node slicer-upload.js [flags] <file-path>');
  process.exit(1);
}

filePath = path.resolve(filePath);
log(`Resolved: ${filePath}`);

if (!fs.existsSync(filePath)) {
  log(`File not found — exiting`);
  console.error(`File not found: ${filePath}`);
  process.exit(1);
}

const fileName = path.basename(filePath);
const ext = path.extname(fileName).toLowerCase();
log(`Received: ${fileName}  (ext: ${ext})`);

// --- Determine the real file to upload ---
// Slicers may pass a .pp metadata file. Read it to find the actual export path.
let uploadPath = filePath;

if (ext === '.pp') {
  log(`.pp metadata file — reading for export path...`);
  try {
    const ppContents = fs.readFileSync(filePath, 'utf8');
    log(`.pp file size: ${ppContents.length} bytes`);
    log(`.pp file content (first 4KB):\n${ppContents.slice(0, 4096)}`);

    // Try to find the real gcode path in the .pp metadata
    // Common patterns: file_path=..., output_path=..., gcode_file=..., etc.
    // Also try: any line that references a .gcode/.bgcode/.3mf file
    const exportMatch = ppContents.match(
      /(?:file_path|output_path|gcode_file|export_path|gcode_path|output_file|export_file|original_path|source_path|final_path)\s*[=:]\s*(.+?\.(?:gcode|bgcode|3mf))/gi
    );
    if (exportMatch) {
      log(`Found export path references in .pp: ${JSON.stringify(exportMatch)}`);
      for (const m of exportMatch) {
        const p = m.replace(/^.*?[=:]\s*/i, '').trim();
        if (fs.existsSync(p)) {
          uploadPath = path.resolve(p);
          log(`Resolved export file: ${uploadPath}`);
          break;
        }
      }
    }

    // Also look for any absolute path containing .gcode/.bgcode/.3mf
    if (uploadPath === filePath) {
      const anyPath = ppContents.match(/[A-Za-z]:\\(?:[^\\\r\n]+\\)*[^\s\r\n]+\.(?:gcode|bgcode|3mf)/g);
      if (anyPath) {
        log(`Found absolute gcode paths in .pp: ${JSON.stringify(anyPath)}`);
        for (const p of anyPath) {
          if (fs.existsSync(p)) {
            uploadPath = path.resolve(p);
            log(`Resolved export file (absolute): ${uploadPath}`);
            break;
          }
        }
      }
    }

    // Fallback: derive temp gcode from .pp path
    if (uploadPath === filePath) {
      const derived = filePath.replace(/\.pp$/i, '');
      if (fs.existsSync(derived)) {
        uploadPath = derived;
        log(`Falling back to temp gcode: ${uploadPath}`);
      } else {
        log(`No usable file found — skipping`);
        process.exit(0);
      }
    }
  } catch (err) {
    log(`Error reading .pp file: ${err.message}`);
    process.exit(1);
  }
}

// Validate final file
const uploadExt = path.extname(uploadPath).toLowerCase();
if (uploadExt !== '.gcode' && uploadExt !== '.bgcode' && uploadExt !== '.3mf') {
  log(`Unsupported extension "${uploadExt}" — skipping`);
  process.exit(0);
}

const uploadFileName = path.basename(uploadPath);
const fileSize = fs.statSync(uploadPath).size;
log(`Upload:  ${uploadFileName}  (${fileSize} bytes)`);

// --- Upload ---
const apiUrl = serverUrl.replace(/\/+$/, '') + '/api/inbox';

async function doUpload() {
  try {
    const fileBuffer = fs.readFileSync(uploadPath);
    const blob = new Blob([fileBuffer]);
    const formData = new FormData();
    formData.append('file', blob, uploadFileName);

    log(`POST ${apiUrl}  (${fileBuffer.length} bytes as "${uploadFileName}")`);
    console.log(`Uploading "${uploadFileName}" ...`);

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
      const inboxUrl = serverUrl.replace(/\/+$/, '') + '/inbox';
      log(`Opening browser: ${inboxUrl}`);
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