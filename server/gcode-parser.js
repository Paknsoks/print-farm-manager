const fs = require('fs');

// Read the last ~50KB of a gcode file and extract slicer metadata from comments.
// Only scans comment lines (starting with ';'), matches specific patterns, and
// exits early once all target fields are found.

const TAIL_BYTES = 50 * 1024; // 50KB — sufficient for all common slicer metadata blocks

const PATTERNS = [
  { key: 'filament_used_g',   regex: /filament used \[g\]\s*=\s*([\d.]+)/i },
  { key: 'estimated_time_s',  regex: /estimated (?:printing )?time[:\s]*[=]?\s*(.+)/i },
  { key: 'layer_height',      regex: /layer_height\s*=\s*([\d.]+)/i },
  { key: 'filament_type',     regex: /filament_type\s*=\s*(\w+)/i },
  { key: 'nozzle_temp',       regex: /(?:nozzle_temperature|temperature)\s*=\s*([\d.]+)/i },
  { key: 'bed_temp',          regex: /bed_temperature\s*=\s*([\d.]+)/i },
];

const ALL_KEYS = PATTERNS.map(p => p.key);

/**
 * Parse a human-readable time string like "2h 30m 15s" or "1h 5m" into seconds.
 */
function parseTimeString(str) {
  let total = 0;
  const h = str.match(/(\d+)\s*h/i);
  const m = str.match(/(\d+)\s*m/i);
  const s = str.match(/(\d+)\s*s/i);
  if (h) total += parseInt(h[1], 10) * 3600;
  if (m) total += parseInt(m[1], 10) * 60;
  if (s) total += parseInt(s[1], 10);
  return total > 0 ? total : null;
}

/**
 * Parse a gcode file and extract slicer metadata from comment lines.
 * @param {string} filePath - Absolute path to the gcode file
 * @returns {{ filament_used_g: number|null, estimated_time_s: number|null,
 *             layer_height: number|null, filament_type: string,
 *             nozzle_temp: number|null, bed_temp: number|null }}
 */
function parseGcodeFile(filePath) {
  const result = {
    filament_used_g: null,
    estimated_time_s: null,
    layer_height: null,
    filament_type: '',
    nozzle_temp: null,
    bed_temp: null,
  };

  const found = new Set();
  let fd;
  try {
    fd = fs.openSync(filePath, 'r');
    const stats = fs.fstatSync(fd);
    const start = Math.max(0, stats.size - TAIL_BYTES);
    const buf = Buffer.alloc(stats.size - start);
    fs.readSync(fd, buf, 0, buf.length, start);
    const tail = buf.toString('utf-8');
    const lines = tail.split('\n');

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith(';')) continue; // skip non-comment lines

      for (const { key, regex } of PATTERNS) {
        if (found.has(key)) continue;
        const match = trimmed.match(regex);
        if (!match) continue;

        switch (key) {
          case 'filament_used_g':
            result.filament_used_g = parseFloat(match[1]);
            break;
          case 'estimated_time_s':
            result.estimated_time_s = parseTimeString(match[1]);
            break;
          case 'layer_height':
            result.layer_height = parseFloat(match[1]);
            break;
          case 'filament_type':
            result.filament_type = match[1];
            break;
          case 'nozzle_temp':
            result.nozzle_temp = parseFloat(match[1]);
            break;
          case 'bed_temp':
            result.bed_temp = parseFloat(match[1]);
            break;
        }
        found.add(key);
      }

      if (found.size === ALL_KEYS.length) break; // early exit — all fields found
    }
  } catch (err) {
    // File read error — return empty result
    console.error(`[gcode-parser] Error reading ${filePath}:`, err.message);
  } finally {
    if (fd !== undefined) {
      try { fs.closeSync(fd); } catch (_) { /* ignore */ }
    }
  }

  return result;
}

module.exports = { parseGcodeFile };