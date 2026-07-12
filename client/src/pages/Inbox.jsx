import { useState, useEffect } from 'react';
import { useToast } from '../useToast';
import { useConfirm } from '../useConfirm';

const STYLE = {
  card: {
    background: '#1e2433', border: '1px solid #334155', borderRadius: 10,
    padding: 20, marginBottom: 20,
  },
  title: { fontSize: 18, fontWeight: 700, color: '#e2e8f0', marginBottom: 4 },
  subtitle: { fontSize: 13, color: '#64748b', marginBottom: 16 },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: 13 },
  th: { textAlign: 'left', padding: '8px 10px', color: '#64748b', fontWeight: 600, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.5px', borderBottom: '1px solid #334155' },
  td: { padding: '8px 10px', borderBottom: '1px solid #1a1f2b', color: '#94a3b8', verticalAlign: 'middle' },
  btn: {
    display: 'inline-flex', alignItems: 'center', gap: 4,
    background: '#1e40af', color: '#fff',
    border: 'none', borderRadius: 6,
    padding: '5px 12px', fontSize: 12, fontWeight: 600,
    cursor: 'pointer',
  },
  btnDanger: {
    display: 'inline-flex', alignItems: 'center', gap: 4,
    background: 'transparent', color: '#f87171',
    border: '1px solid #7f1d1d', borderRadius: 6,
    padding: '5px 12px', fontSize: 12, fontWeight: 600,
    cursor: 'pointer',
  },
  empty: { textAlign: 'center', padding: '40px 0', color: '#475569', fontSize: 14 },
  modalOverlay: {
    position: 'fixed', inset: 0,
    background: 'rgba(0,0,0,0.65)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    zIndex: 1000, padding: 20,
    backdropFilter: 'blur(3px)',
  },
  modalCard: {
    background: '#1e2433', border: '1px solid #334155', borderRadius: 10,
    padding: '24px 28px', maxWidth: 560, width: '100%',
    maxHeight: '90vh', overflowY: 'auto',
    boxShadow: '0 20px 60px rgba(0,0,0,0.6)',
  },
  formGroup: { marginBottom: 12 },
  label: { display: 'block', fontSize: 12, color: '#64748b', fontWeight: 500, marginBottom: 4 },
  input: {
    width: '100%', background: '#131720', border: '1px solid #334155', borderRadius: 6,
    color: '#e2e8f0', fontSize: 13, padding: '7px 10px',
    outline: 'none', boxSizing: 'border-box', fontFamily: 'inherit',
  },
  select: {
    width: '100%', background: '#131720', border: '1px solid #334155', borderRadius: 6,
    color: '#e2e8f0', fontSize: 13, padding: '7px 10px',
    outline: 'none', boxSizing: 'border-box', fontFamily: 'inherit',
    cursor: 'pointer',
  },
  toggle: {
    background: '#131720', border: '1px solid #334155', borderRadius: 6,
    display: 'inline-flex', overflow: 'hidden',
  },
  toggleBtn: (active) => ({
    padding: '6px 16px', fontSize: 12, fontWeight: 600,
    border: 'none', cursor: 'pointer',
    background: active ? '#1e40af' : 'transparent',
    color: active ? '#fff' : '#64748b',
    fontFamily: 'inherit',
  }),
  hint: { fontSize: 11, color: '#475569', marginTop: 2 },
  summaryCard: {
    background: '#131720', border: '1px solid #334155', borderRadius: 8,
    padding: '12px 14px', marginBottom: 16, fontSize: 13, color: '#94a3b8', lineHeight: 1.6,
  },
};

function formatDate(ts) {
  if (!ts) return '—';
  const d = new Date(ts);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
    + ' ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

function formatTime(secs) {
  if (!secs) return null;
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

export function UnassignedFiles({ onAssigned }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showToast, toastEl] = useToast();
  const [confirm, confirmModal] = useConfirm();

  // Assign modal state
  const [assigning, setAssigning] = useState(null); // inbox item being assigned, or null
  const [mode, setMode] = useState('new'); // 'new' or 'replace'
  const [projects, setProjects] = useState([]);
  const [projectParts, setProjectParts] = useState([]); // parts for selected project (replace mode)

  // Form fields
  const [projectId, setProjectId] = useState('');
  const [partName, setPartName] = useState('');
  const [targetQty, setTargetQty] = useState('1');
  const [selectedPartId, setSelectedPartId] = useState(''); // replace mode
  const [printerModel, setPrinterModel] = useState('');
  const [partsPerPlate, setPartsPerPlate] = useState('');
  const [estPrintSecs, setEstPrintSecs] = useState('');
  const [materialGrams, setMaterialGrams] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [printerModels, setPrinterModels] = useState([]);

  useEffect(() => { loadItems(); }, []);

  function loadItems() {
    setLoading(true);
    fetch('/api/inbox')
      .then(r => r.json())
      .then(data => { setItems(data); setLoading(false); })
      .catch(() => { setLoading(false); });
  }

  async function openAssignModal(item) {
    setAssigning(item);
    setMode('new');
    setSubmitting(false);

    // Pre-fill from parsed filename hints
    const p = item.parsed || {};
    setPartName(p.part_name_hint || '');
    setPrinterModel(p.printer_model || '');
    setPartsPerPlate(p.parts_per_plate ? String(p.parts_per_plate) : '');
    setEstPrintSecs(p.est_print_secs ? String(p.est_print_secs) : '');
    setMaterialGrams(p.material_grams ? String(p.material_grams) : '');
    setTargetQty('1');
    setSelectedPartId('');
    setProjectParts([]);
    setProjectId('');

    // Fetch projects and models for the form
    try {
      const [prjRes, modelsRes] = await Promise.all([
        fetch('/api/projects'),
        fetch('/api/models'),
      ]);
      const prjs = await prjRes.json();
      const models = await modelsRes.json();
      setProjects(prjs.filter(p => p.status !== 'archived'));
      setPrinterModels(models || []);
    } catch (e) {
      showToast('Failed to load projects or models', 'error');
    }
  }

  function closeAssignModal() {
    setAssigning(null);
    setProjectParts([]);
  }

  // When replace mode + project is selected, fetch that project's parts
  function onProjectChange(id) {
    setProjectId(id);
    setSelectedPartId('');
    setProjectParts([]);

    if (mode === 'replace' && id) {
      fetch(`/api/parts?project_id=${encodeURIComponent(id)}`)
        .then(r => r.json())
        .then(data => setProjectParts(data || []))
        .catch(() => showToast('Failed to load parts', 'error'));
    }
  }

  function onModeToggle(newMode) {
    setMode(newMode);
    setSelectedPartId('');
    setProjectParts([]);
    if (newMode === 'new') {
      // In new mode, we create a part — project selection is still needed
      setProjectId(projectId); // keep project selection
    }
  }

  async function handleDelete(item) {
    const ok = await confirm({
      title: 'Delete from Inbox?',
      message: `Remove "${item.original_filename}"?\n\nThe uploaded file will be deleted from disk.`,
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!ok) return;

    try {
      const res = await fetch(`/api/inbox/${item.id}`, { method: 'DELETE' });
      if (!res.ok) {
        const err = await res.json();
        showToast(err.error || 'Delete failed', 'error');
        return;
      }
      showToast('Deleted');
      loadItems();
    } catch (e) {
      showToast('Delete failed', 'error');
    }
  }

  async function handleAssign(e) {
    e.preventDefault();
    setSubmitting(true);

    const body = { mode };

    if (mode === 'new') {
      if (!projectId || !partName || !targetQty) {
        showToast('Project, part name, and target quantity are required', 'warning');
        setSubmitting(false);
        return;
      }
      body.project_id = parseInt(projectId, 10);
      body.part_name = partName.trim();
      body.target_qty = parseInt(targetQty, 10);
    } else {
      if (!selectedPartId || !printerModel || !partsPerPlate) {
        showToast('Part, printer model, and parts per plate are required', 'warning');
        setSubmitting(false);
        return;
      }
      body.part_id = parseInt(selectedPartId, 10);
    }

    // Optional gcode fields
    if (printerModel) {
      body.printer_model = printerModel;
      body.parts_per_plate = partsPerPlate ? parseInt(partsPerPlate, 10) : undefined;
      if (estPrintSecs) body.est_print_secs = parseInt(estPrintSecs, 10);
      if (materialGrams) body.material_grams = parseFloat(materialGrams);
    }

    try {
      const res = await fetch(`/api/inbox/${assigning.id}/assign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.json();
        showToast(err.error || 'Assignment failed', 'error');
        setSubmitting(false);
        return;
      }
      showToast(mode === 'new' ? 'Part created!' : 'G-code replaced!');
      closeAssignModal();
      loadItems();
    } catch (e) {
      showToast('Assignment failed', 'error');
      setSubmitting(false);
    }
  }

  if (loading) {
    return <div style={{ color: '#64748b', padding: 20, fontSize: 14 }}>Loading…</div>;
  }

  return (
    <div>
      {/* Toast & Confirm portals */}
      {toastEl}
      {confirmModal}

      <div style={STYLE.card}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
          <div>
            <h3 style={{ fontSize: 14, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 1, margin: 0 }}>
              Unassigned Files
            </h3>
          </div>
          <button style={STYLE.btn} onClick={loadItems}>
            <span aria-hidden="true">↻</span> Refresh
          </button>
        </div>

        {items.length === 0 ? (
          <div style={{ padding: '8px 0', color: '#475569', fontSize: 13 }}>
            No unassigned files. Files from the slicer post-processing script will appear here.
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={STYLE.table}>
              <thead>
                <tr>
                  <th style={STYLE.th}>File</th>
                  <th style={STYLE.th}>Uploaded</th>
                  <th style={STYLE.th}>Hints</th>
                  <th style={{ ...STYLE.th, width: 1 }}></th>
                </tr>
              </thead>
              <tbody>
                {items.map(item => {
                  const p = item.parsed || {};
                  return (
                    <tr key={item.id}>
                      <td style={{ ...STYLE.td, color: '#e2e8f0', fontWeight: 500, wordBreak: 'break-word' }}>
                        {item.original_filename}
                      </td>
                      <td style={{ ...STYLE.td, whiteSpace: 'nowrap' }}>
                        {formatDate(item.uploaded_at)}
                      </td>
                      <td style={STYLE.td}>
                        {p.parse_failed === false ? (
                          <span style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                            {p.parts_per_plate && <Chip>{p.parts_per_plate}/plate</Chip>}
                            {p.printer_model && <Chip>{p.printer_model}</Chip>}
                            {p.est_print_secs && <Chip>{formatTime(p.est_print_secs)}</Chip>}
                            {p.material_grams && <Chip>{p.material_grams}g</Chip>}
                          </span>
                        ) : (
                          <span style={{ color: '#475569', fontSize: 11 }}>—</span>
                        )}
                      </td>
                      <td style={{ ...STYLE.td, textAlign: 'right', whiteSpace: 'nowrap' }}>
                        <button
                          style={{ ...STYLE.btn, marginRight: 6 }}
                          onClick={() => openAssignModal(item)}
                        >
                          Assign to Project
                        </button>
                        <button
                          style={STYLE.btnDanger}
                          onClick={() => handleDelete(item)}
                          aria-label="Delete"
                        >
                          ×
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Assign Modal */}
      {assigning && (
        <div style={STYLE.modalOverlay} onClick={closeAssignModal}>
          <div style={STYLE.modalCard} onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Assign to Project">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <h2 style={{ fontSize: 16, fontWeight: 700, color: '#e2e8f0', margin: 0 }}>Assign to Project</h2>
              <button
                onClick={closeAssignModal}
                aria-label="Close"
                style={{ background: 'transparent', border: 'none', color: '#64748b', fontSize: 20, cursor: 'pointer', lineHeight: 1 }}
              >×</button>
            </div>

            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 12, color: '#64748b', marginBottom: 6 }}>File</div>
              <div style={{ fontSize: 13, color: '#e2e8f0', wordBreak: 'break-word', background: '#131720', padding: '8px 10px', borderRadius: 6, border: '1px solid #334155' }}>
                {assigning.original_filename}
              </div>
            </div>

            {/* Mode toggle */}
            <div style={{ marginBottom: 16 }}>
              <div style={STYLE.toggle}>
                <button style={STYLE.toggleBtn(mode === 'new')} onClick={() => onModeToggle('new')} type="button">
                  New Part
                </button>
                <button style={STYLE.toggleBtn(mode === 'replace')} onClick={() => onModeToggle('replace')} type="button">
                  Replace Existing
                </button>
              </div>
            </div>

            <form onSubmit={handleAssign}>
              {/* Project selection (both modes) */}
              <div style={STYLE.formGroup}>
                <label style={STYLE.label}>Project</label>
                <select
                  style={STYLE.select}
                  value={projectId}
                  onChange={e => onProjectChange(e.target.value)}
                  required
                >
                  <option value="">Select project…</option>
                  {projects.map(prj => (
                    <option key={prj.id} value={prj.id}>{prj.name}</option>
                  ))}
                </select>
              </div>

              {/* Mode-specific fields */}
              {mode === 'new' ? (
                <>
                  <div style={STYLE.formGroup}>
                    <label style={STYLE.label}>Part Name</label>
                    <input
                      style={STYLE.input}
                      type="text"
                      value={partName}
                      onChange={e => setPartName(e.target.value)}
                      required
                      placeholder="e.g. Widget v3"
                    />
                  </div>
                  <div style={STYLE.formGroup}>
                    <label style={STYLE.label}>Target Quantity</label>
                    <input
                      style={STYLE.input}
                      type="number"
                      min="1"
                      value={targetQty}
                      onChange={e => setTargetQty(e.target.value)}
                      required
                    />
                  </div>
                </>
              ) : (
                <div style={STYLE.formGroup}>
                  <label style={STYLE.label}>Replace Part</label>
                  <select
                    style={STYLE.select}
                    value={selectedPartId}
                    onChange={e => setSelectedPartId(e.target.value)}
                    required
                    disabled={!projectId}
                  >
                    <option value="">{projectId ? 'Select part…' : 'Select a project first'}</option>
                    {projectParts.map(part => (
                      <option key={part.id} value={part.id}>
                        {part.name} (Target: {part.target_qty}, Done: {part.completed_qty})
                      </option>
                    ))}
                  </select>
                  {projectId && projectParts.length === 0 && (
                    <div style={STYLE.hint}>No parts in this project yet.</div>
                  )}
                </div>
              )}

              {/* G-code fields (optional for new, required for replace) */}
              <fieldset style={{ border: '1px solid #334155', borderRadius: 8, padding: '12px 14px', marginTop: 8, marginBottom: 16 }}>
                <legend style={{ fontSize: 12, color: '#64748b', fontWeight: 600, padding: '0 6px' }}>G-code Details {mode === 'new' ? '(optional)' : '(required)'}</legend>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 12px' }}>
                  <div style={STYLE.formGroup}>
                    <label style={STYLE.label}>Printer Model</label>
                    <select
                      style={STYLE.select}
                      value={printerModel}
                      onChange={e => setPrinterModel(e.target.value)}
                      required={mode === 'replace'}
                    >
                      <option value="">Auto / unspecified</option>
                      {printerModels.map(m => (
                        <option key={m.model_id} value={m.model_id}>{m.label} ({m.model_id})</option>
                      ))}
                    </select>
                  </div>
                  <div style={STYLE.formGroup}>
                    <label style={STYLE.label}>Parts Per Plate</label>
                    <input
                      style={STYLE.input}
                      type="number"
                      min="1"
                      value={partsPerPlate}
                      onChange={e => setPartsPerPlate(e.target.value)}
                      required={mode === 'replace'}
                      placeholder="e.g. 4"
                    />
                  </div>
                  <div style={STYLE.formGroup}>
                    <label style={STYLE.label}>Est. Print Time (seconds)</label>
                    <input
                      style={STYLE.input}
                      type="number"
                      value={estPrintSecs}
                      onChange={e => setEstPrintSecs(e.target.value)}
                      placeholder="e.g. 18660"
                    />
                  </div>
                  <div style={STYLE.formGroup}>
                    <label style={STYLE.label}>Material (grams)</label>
                    <input
                      style={STYLE.input}
                      type="number"
                      step="0.1"
                      value={materialGrams}
                      onChange={e => setMaterialGrams(e.target.value)}
                      placeholder="e.g. 45"
                    />
                  </div>
                </div>
              </fieldset>

              {/* Summary for replace mode */}
              {mode === 'replace' && selectedPartId && printerModel && (() => {
                const part = projectParts.find(p => String(p.id) === String(selectedPartId));
                if (!part) return null;
                return (
                  <div style={STYLE.summaryCard}>
                    <div style={{ fontWeight: 600, color: '#e2e8f0', marginBottom: 4 }}>
                      {part.name}
                    </div>
                    <div>
                      This will {printerModel ? `set the ${printerModel.toUpperCase()} gcode` : 'add a gcode'} for this part.
                      {printerModel ? ' If a gcode already exists for this model, it will be replaced.' : ''}
                    </div>
                    <div style={{ marginTop: 4, fontSize: 11, color: '#475569' }}>
                      Old gcode file will be deleted. Historical jobs are preserved.
                    </div>
                  </div>
                );
              })()}

              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
                <button
                  type="button"
                  onClick={closeAssignModal}
                  style={{
                    background: '#1f2937', color: '#9ca3af',
                    border: '1px solid #374151', borderRadius: 6,
                    padding: '8px 18px', fontSize: 13, cursor: 'pointer', fontWeight: 500,
                  }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  style={{
                    background: submitting ? '#374151' : '#1e40af',
                    color: submitting ? '#6b7280' : '#fff',
                    border: 'none', borderRadius: 6,
                    padding: '8px 18px', fontSize: 13, fontWeight: 600,
                    cursor: submitting ? 'not-allowed' : 'pointer',
                    fontFamily: 'inherit',
                  }}
                >
                  {submitting ? 'Assigning…' : mode === 'new' ? 'Create Part' : 'Replace G-code'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

function Chip({ children }) {
  return (
    <span style={{
      background: '#131720', color: '#94a3b8', fontSize: 11,
      padding: '1px 7px', borderRadius: 4, border: '1px solid #334155',
      whiteSpace: 'nowrap',
    }}>
      {children}
    </span>
  );
}