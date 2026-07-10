# Slicer Integration — Inbox Workflow

The Post-Processing Script (`scripts/slicer-upload.js`) lets your slicer automatically send each exported G-code file to Print Farm Manager's Inbox, where it can be reviewed and assigned to a project.

## Setup

### 1. Prerequisites

- Print Farm Manager server must be running (`npm start` or Docker)
- Node.js installed on the slicing workstation (the script runs with `node`)

### 2. Add the Script to Your Slicer

> **Important:** The slicer's post-processing field expects a path to an executable file — it does not run commands through a shell. On Windows, use the `.bat` wrapper or the full path to `node.exe`. On macOS/Linux, the `node` prefix works directly since those slicers invoke a shell.

#### Windows (OrcaSlicer / PrusaSlicer / Bambu Studio)

**Method A: .bat wrapper (recommended)**

A `slicer-upload.bat` is included next to the script. It calls `node` using `%~dp0` so it works regardless of where Node is installed. Add this to the post-processing field:

```
"C:\path\to\print-farm-manager\scripts\slicer-upload.bat"
```

To also open the browser to the Inbox after each slice:
```
"C:\path\to\print-farm-manager\scripts\slicer-upload.bat" --open-browser
```

**Method B: Full path to node.exe**

Find your Node path first — open Command Prompt and run:
```
where node
```

You'll get something like `C:\Program Files\nodejs\node.exe`. Then add:
```
"C:\Program Files\nodejs\node.exe" "C:\path\to\print-farm-manager\scripts\slicer-upload.js"
```

#### macOS / Linux

These slicers invoke a shell, so the `node` prefix works:

```
node "/home/user/print-farm-manager/scripts/slicer-upload.js"
```

**Do not add the file path yourself** — the slicer automatically appends the exported file path as the last argument when it runs the command.

---

### 3. Remote Slicing Workstation (slicer on a different PC than the server)

If Print Farm Manager runs on a dedicated machine (e.g. `192.168.1.50`) and you slice from your desktop, configure the server URL once:

#### Method A: Environment variable (set once, works forever — recommended)

**Windows:**
```
setx PRINT_FARM_URL "http://192.168.1.50:3000"
```

**macOS/Linux** (add to `~/.zshrc` or `~/.bashrc`):
```
export PRINT_FARM_URL="http://192.168.1.50:3000"
```

Then your slicer field stays simple — no need to mention the IP. Restart the slicer after setting the env var for the first time.

#### Method B: Per-slicer flag

Put the server URL directly in the post-processing command. On Windows with the `.bat` wrapper:
```
"C:\path\to\slicer-upload.bat" --server http://192.168.1.50:3000
```

On macOS/Linux:
```
node slicer-upload.js --server http://192.168.1.50:3000
```

#### Verification

After slicing, you should see:
```
Uploading "4x Widget v2_0.4n_0.20mm_PLA_MK4S_5h11m.bgcode" to http://192.168.1.50:3000/api/inbox …
Uploaded successfully — inbox ID 3
```

If you get `Cannot reach Print Farm Manager — is the server running?`, the script will tell you how to set the server URL right in the error message.

### 4. Verify (localhost setup)

After slicing, look for the output in the slicer's console/log:

```
Uploading "4x Widget v2_0.4n_0.20mm_PLA_MK4S_5h11m.bgcode" to http://localhost:3000/api/inbox …
Uploaded successfully — inbox ID 3
```

Then open Print Farm Manager → **Inbox** — the file should appear with parsed hints (model, parts-per-plate, print time, etc.).

---

## Workflow

1. **Slice** in your slicer → script uploads to Inbox
2. Open Print Farm Manager → **Inbox** tab
3. Click **Assign to Project** on a file
4. Choose **New Part** or **Replace Existing Part**
5. Fill out the part details (name, target quantity, printer model)
6. The file is moved from the Inbox to the project as a part + G-code record
7. The scheduler picks it up and dispatches to available printers

You can also **Delete** files from the Inbox that were uploaded by mistake — the file is removed from disk.

---

## Filename Convention

The script parses filenames using the same parser as the G-code upload form. For the best experience, slice with filenames that follow the Bambu/Orca convention:

```
{parts_per_plate}x {part_name}_{nozzle}_{layer_height}_{material}_{printer_model}_{time}.{ext}
```

Example:
```
4x Widget v2_0.4n_0.20mm_PLA_MK4S_5h11m.bgcode
```

When the parser recognizes this pattern, the Inbox shows **Hints** chips (parts/plate, model, time, material) and the Assign form is pre-filled.

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| "Cannot reach Print Farm Manager" | Server not running, wrong port, or firewall blocking. Verify `http://localhost:3000/api/health` responds. |
| "Unsupported file type" | Only `.gcode`, `.bgcode`, and `.3mf` files are accepted. |
| No output in slicer console | The script writes to stderr/stdout. Some slicers suppress post-processing output — check the OS task manager for a `node` process during slicing. |
| Upload succeeds but file doesn't appear in Inbox | Refresh the Inbox page. If still missing, the upload may have been rejected at the API level — check the server console for errors. |
| Inbox shows "—" for hints | The filename doesn't match the convention. This is cosmetic — the file still uploads and can be assigned manually. |