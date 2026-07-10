const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const router = express.Router();

const { parseFilename, extractMaterialGramsFromFilename } = require('../utils/filename-parser');

const GCODE_DIR = path.join(__dirname, '..', 'gcode');

const storage = multer.diskStorage({
  destination: GCODE_DIR,
  filename: (_req, file, cb) => cb(null, Date.now() + '_' + file.originalname),
});
const upload = multer({ storage });

function runUpload(req, res) {
  return new Promise((resolve, reject) => {
    upload.single('file')(req, res, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

module.exports = (db) => {
  // GET /api/inbox — list all unassigned files with parsed metadata hints
  router.get('/', (_req, res) => {
    const rows = db.prepare('SELECT * FROM inbox ORDER BY uploaded_at DESC').all();
    res.json(rows.map(r => ({
      ...r,
      parsed: {
        ...(parseFilename(r.original_filename) || { parse_failed: true }),
        material_grams: extractMaterialGramsFromFilename(r.original_filename),
      },
    })));
  });

  // POST /api/inbox — upload a file to the inbox
  router.post('/', async (req, res) => {
    try {
      await runUpload(req, res);
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }

    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    // Validate file extension
    const ext = path.extname(req.file.originalname).toLowerCase();
    if (ext !== '.gcode' && ext !== '.bgcode' && ext !== '.3mf') {
      fs.unlinkSync(req.file.path);
      return res.status(400).json({ error: 'Only .gcode, .bgcode, and .3mf files are accepted' });
    }

    try {
      const result = db.prepare(
        'INSERT INTO inbox (original_filename, stored_file_path, uploaded_at) VALUES (?, ?, ?)'
      ).run(req.file.originalname, req.file.filename, Date.now());

      res.status(201).json(db.prepare('SELECT * FROM inbox WHERE id = ?').get(result.lastInsertRowid));
    } catch (err) {
      // DB insert failed — clean up the file we already wrote to disk
      fs.unlinkSync(req.file.path);
      return res.status(500).json({ error: 'Failed to save file record' });
    }
  });

  // DELETE /api/inbox/:id — remove an inbox entry and its file from disk
  router.delete('/:id', (req, res) => {
    const row = db.prepare('SELECT * FROM inbox WHERE id = ?').get(req.params.id);
    if (!row) return res.status(404).json({ error: 'Inbox entry not found' });

    // If the file still exists on disk, delete it
    const fullPath = path.join(GCODE_DIR, row.stored_file_path);
    if (fs.existsSync(fullPath)) {
      fs.unlinkSync(fullPath);
    }

    db.prepare('DELETE FROM inbox WHERE id = ?').run(req.params.id);
    res.json({ success: true });
  });

  // POST /api/inbox/:id/assign — assign an inbox file to a project as a part + gcode
  router.post('/:id/assign', (req, res) => {
    const inboxRow = db.prepare('SELECT * FROM inbox WHERE id = ?').get(req.params.id);
    if (!inboxRow) return res.status(404).json({ error: 'Inbox entry not found' });

    // Verify the file still exists on disk
    const storedPath = path.join(GCODE_DIR, inboxRow.stored_file_path);
    if (!fs.existsSync(storedPath)) {
      return res.status(500).json({
        error: 'Stored file is missing from disk. The inbox entry may be stale — delete it and re-upload.',
      });
    }

    const { mode } = req.body;

    if (mode === 'new') {
      return _assignAsNewPart(req, res, db, inboxRow, storedPath);
    } else if (mode === 'replace') {
      return _assignAsReplacement(req, res, db, inboxRow, storedPath);
    } else {
      return res.status(400).json({ error: 'mode must be "new" or "replace"' });
    }
  });

  return router;
};

// --- Mode: new part ---

function _assignAsNewPart(req, res, db, inboxRow, storedPath) {
  const {
    project_id, part_name, target_qty,
    printer_model, parts_per_plate, est_print_secs,
    material_grams, ams_slot, allowed_groups,
    required_material, required_color,
  } = req.body;

  // Validate required fields
  if (!project_id || !part_name || !target_qty) {
    return res.status(400).json({ error: 'project_id, part_name, and target_qty are required' });
  }

  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(project_id);
  if (!project) {
    return res.status(400).json({ error: 'Project not found' });
  }

  const parsedTargetQty = parseInt(target_qty, 10);
  if (isNaN(parsedTargetQty) || parsedTargetQty < 1) {
    return res.status(400).json({ error: 'target_qty must be a positive integer' });
  }

  // If gcode fields are provided, validate printer_model
  if (printer_model) {
    if (!db.prepare('SELECT 1 FROM printer_models WHERE model_id = ?').get(printer_model)) {
      return res.status(400).json({ error: `Unknown model "${printer_model}". Add it in Settings → Printer Models first.` });
    }
    if (!parts_per_plate) {
      return res.status(400).json({ error: 'parts_per_plate is required when providing gcode fields' });
    }
  }

  const now = Date.now();

  // Use a transaction so partial failure doesn't leave orphaned rows
  const txn = db.transaction(() => {
    // 1. Create the part
    const partResult = db.prepare(`
      INSERT INTO parts (project_id, name, target_qty, status, created_at, updated_at)
      VALUES (?, ?, ?, 'open', ?, ?)
    `).run(project_id, part_name, parsedTargetQty, now, now);
    const partId = partResult.lastInsertRowid;

    // 2. Assign sort_order at end
    const maxSort = db.prepare(
      'SELECT COALESCE(MAX(sort_order), -1) AS m FROM parts WHERE project_id = ?'
    ).get(project_id).m;
    db.prepare('UPDATE parts SET sort_order = ? WHERE id = ?').run(maxSort + 1, partId);

    // 3. If gcode fields provided, create a gcode record (file ownership transfers from inbox to gcode)
    if (printer_model && parts_per_plate) {
      const parsedPartsPerPlate = parseInt(parts_per_plate, 10);
      const parsedEstPrintSecs = est_print_secs ? parseInt(est_print_secs, 10) : null;
      const parsedMaterialGrams = material_grams ? parseFloat(material_grams) : null;
      const parsedAmsSlot = ams_slot !== undefined && ams_slot !== '' ? parseInt(ams_slot, 10) : null;
      const parsedAllowedGroups = allowed_groups && allowed_groups !== '' ? allowed_groups : null;
      const parsedRequiredMaterial = required_material && required_material !== '' ? required_material.trim() : null;
      const parsedRequiredColor = required_color && required_color !== '' ? required_color.trim() : null;

      db.prepare(`
        INSERT INTO gcodes (part_id, printer_model, filename, filepath, parts_per_plate,
          est_print_secs, material_grams, ams_slot, allowed_groups, required_material, required_color, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        partId, printer_model, inboxRow.original_filename, inboxRow.stored_file_path,
        parsedPartsPerPlate, parsedEstPrintSecs, parsedMaterialGrams, parsedAmsSlot,
        parsedAllowedGroups, parsedRequiredMaterial, parsedRequiredColor, now
      );
    }

    // 4. Delete the inbox row (file is now owned by gcodes table, or orphaned if no gcode was created)
    db.prepare('DELETE FROM inbox WHERE id = ?').run(inboxRow.id);
  });

  try {
    txn();
  } catch (err) {
    return res.status(500).json({ error: 'Failed to assign inbox item: ' + err.message });
  }

  res.json({ success: true });
}

// --- Mode: replace existing part's gcode ---

function _assignAsReplacement(req, res, db, inboxRow, storedPath) {
  const { part_id, printer_model, parts_per_plate, est_print_secs,
          material_grams, ams_slot, allowed_groups,
          required_material, required_color } = req.body;

  if (!part_id || !printer_model || !parts_per_plate) {
    return res.status(400).json({ error: 'part_id, printer_model, and parts_per_plate are required' });
  }

  const part = db.prepare('SELECT * FROM parts WHERE id = ?').get(part_id);
  if (!part) return res.status(400).json({ error: 'Part not found' });

  // Verify the project isn't archived
  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(part.project_id);
  if (project && project.status === 'archived') {
    return res.status(400).json({ error: 'Cannot assign to a part in an archived project' });
  }

  if (!db.prepare('SELECT 1 FROM printer_models WHERE model_id = ?').get(printer_model)) {
    return res.status(400).json({ error: `Unknown model "${printer_model}". Add it in Settings → Printer Models first.` });
  }

  const now = Date.now();
  const parsedPartsPerPlate = parseInt(parts_per_plate, 10);
  const parsedEstPrintSecs = est_print_secs ? parseInt(est_print_secs, 10) : null;
  const parsedMaterialGrams = material_grams ? parseFloat(material_grams) : null;
  const parsedAmsSlot = ams_slot !== undefined && ams_slot !== '' ? parseInt(ams_slot, 10) : null;
  const parsedAllowedGroups = allowed_groups && allowed_groups !== '' ? allowed_groups : null;
  const parsedRequiredMaterial = required_material && required_material !== '' ? required_material.trim() : null;
  const parsedRequiredColor = required_color && required_color !== '' ? required_color.trim() : null;

  const txn = db.transaction(() => {
    // Find existing gcode for (part_id, printer_model)
    const existing = db.prepare(
      'SELECT * FROM gcodes WHERE part_id = ? AND printer_model = ?'
    ).get(part_id, printer_model);

    if (existing) {
      // Check for active jobs using this gcode
      const activeJob = db.prepare(
        "SELECT id FROM jobs WHERE gcode_id = ? AND status IN ('queued', 'uploading', 'printing') LIMIT 1"
      ).get(existing.id);
      if (activeJob) {
        throw new Error('Cannot replace — the existing gcode has an active job in progress. Wait for it to finish first.');
      }

      // Detach historical jobs
      db.prepare('UPDATE jobs SET gcode_id = NULL WHERE gcode_id = ?').run(existing.id);

      // Delete old gcode file from disk
      const oldPath = path.join(GCODE_DIR, existing.filepath);
      if (fs.existsSync(oldPath)) {
        fs.unlinkSync(oldPath);
      }

      // Delete old gcode row
      db.prepare('DELETE FROM gcodes WHERE id = ?').run(existing.id);
    }

    // Insert new gcode record (file ownership transfers from inbox)
    db.prepare(`
      INSERT INTO gcodes (part_id, printer_model, filename, filepath, parts_per_plate,
        est_print_secs, material_grams, ams_slot, allowed_groups, required_material, required_color, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      part_id, printer_model, inboxRow.original_filename, inboxRow.stored_file_path,
      parsedPartsPerPlate, parsedEstPrintSecs, parsedMaterialGrams, parsedAmsSlot,
      parsedAllowedGroups, parsedRequiredMaterial, parsedRequiredColor, now
    );

    // Delete the inbox row
    db.prepare('DELETE FROM inbox WHERE id = ?').run(inboxRow.id);
  });

  try {
    txn();
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  res.json({ success: true });
}