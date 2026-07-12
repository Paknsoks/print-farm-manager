# Slicer Integration — Inbox Workflow

The Post-Processing Script (`scripts/slicer-upload.js`) lets your slicer automatically send each exported G-code file to Print Farm Manager's Inbox.

## Per-Slicer Quick Reference

| Slicer | Post-processing field | Filename correct? |
|---|---|---|
| **OrcaSlicer 2.x** | `"C:\path\to\slicer-upload.bat"` | ✅ Yes (auto-detected) |
| **Creality Print** | `"C:\path\to\slicer-upload.bat"` | ✅ Yes (auto-detected) |
| **PrusaSlicer** | `"C:\path\to\slicer-upload.bat"` | ✅ Yes (auto-detected) |
| **Bambu Studio** | `"C:\path\to\slicer-upload.bat" --name "Model Name.gcode"` | ⚠️ Needs `--name` flag |
| **Cura** | Not supported | — |

---

## Setup

### 1. Prerequisites

- Print Farm Manager server must be running (`npm start` or Docker)
- Node.js installed on the slicing workstation

### 2. Add to Your Slicer

> **Important:** On Windows, use the `.bat` wrapper path directly — these slicers expect an executable file, not a shell command.

#### OrcaSlicer / Creality Print

Both set the `SLIC3R_PP_OUTPUT_NAME` environment variable to the real export path, so the correct filename is automatic.

Post-processing field (Print Settings → Output):
```
"C:\Users\aleksanderp\Documents\GitHub\print-farm-manager\scripts\slicer-upload.bat"
```

To also open the browser to the Inbox after each slice:
```
"C:\Users\aleksanderp\Documents\GitHub\print-farm-manager\scripts\slicer-upload.bat" --open-browser
```

#### PrusaSlicer

PrusaSlicer passes the actual `.gcode` file path as a command line argument, so the filename is automatic.

Post-processing field (Print Settings → Output options):
```
"C:\Users\aleksanderp\Documents\GitHub\print-farm-manager\scripts\slicer-upload.bat"
```

#### Bambu Studio

Bambu Studio only provides temp hash filenames (e.g. `.33556.0.gcode`). You must add the `--name` flag with the desired display name:

```
"C:\Users\aleksanderp\Documents\GitHub\print-farm-manager\scripts\slicer-upload.bat" --name "Widget v2.gcode"
```

Change the name when you switch projects. The actual gcode content uploads correctly regardless — only the display name in the Inbox needs this flag.

#### Cura

Cura's post-processing system uses Python-based plugins and does not support external shell scripts. Cura is not supported for automatic inbox uploads. Export the gcode manually and use a separate upload method, or switch to OrcaSlicer/PrusaSlicer for full integration.

---

## Remote Slicing Workstation

If Print Farm Manager runs on a different machine (e.g. `192.168.1.50`), set the server URL:

**Method A: Environment variable (set once, works forever — recommended)**

Windows:
```
setx PRINT_FARM_URL "http://192.168.1.50:3000"
```

macOS/Linux (add to `~/.zshrc` or `~/.bashrc`):
```
export PRINT_FARM_URL="http://192.168.1.50:3000"
```

Then your slicer field stays simple. Restart the slicer after setting the env var for the first time.

**Method B: Per-slicer flag**
```
"C:\path\to\slicer-upload.bat" --server http://192.168.1.50:3000
```

---

## Filename Convention

When the filename follows the Bambu/Orca convention, the Inbox shows parsed hints (model, parts per plate, print time, material):

```
4x Widget v2_0.4n_0.20mm_PLA_MK4S_5h11m.bgcode
```

The parser is read from the uploaded filename — so it works when the filename is auto-detected (OrcaSlicer, Creality Print, PrusaSlicer) and when you use `--name` (Bambu Studio).

---

## Diagnostic Logging

If something goes wrong, add `--log` to capture detailed output:

```
"C:\path\to\slicer-upload.bat" --log
```

This writes `scripts\slicer-upload.log` with every decision the script makes. Check this file for errors.

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| `Cannot reach Print Farm Manager` | Server not running. Verify `http://localhost:3000/api/health` responds. |
| 404 Not Found | Server was started before the Inbox feature was added. Restart the server (`Ctrl+C` then `npm run dev` or `npm start`). |
| `Unsupported file type` | Only `.gcode`, `.bgcode`, and `.3mf` files are accepted. |
| Wrong filename in Inbox (Bambu Studio) | Add `--name "Model Name.gcode"` to your post-processing field. |
| Inbox shows `—` for hints | The filename doesn't match the convention. Cosmetic — the file still uploads. |
| Cura not working | Cura does not support external post-processing scripts. Export manually. |