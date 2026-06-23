'use client';

import { useEffect, useState, useMemo, useCallback } from 'react';

type FieldConfigRow = {
  id: string;                           // DB uuid
  config_id: string;
  sf_object: 'Lead' | 'Opportunity';
  field_name: string;
  value_type: string;
  batch_id: string;
  instruction: string;
  write_mode: string;
  options: string[] | null;
  validation: {
    maxLength?: number;
    min?: number;
    max?: number;
    dateFormat?: string;
  } | null;
  is_active: boolean;
};

type BatchConfigItem = {
  batchId: string;
  label: string;
};

const VALUE_TYPES = ['picklist', 'multipicklist', 'text', 'textarea', 'number', 'currency', 'date', 'datetime', 'boolean'] as const;
const WRITE_MODES = ['overwrite', 'fill_blank', 'append'] as const;

const CONFIG_ID_RE = /^[a-z][a-z0-9_]*$/;
const FIELD_NAME_RE = /__c$/;

export default function FieldConfigBrowser() {
  const [fields, setFields] = useState<FieldConfigRow[]>([]);
  const [batches, setBatches] = useState<BatchConfigItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [filterBatch, setFilterBatch] = useState<string>('all');
  const [showInactive, setShowInactive] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    setLoadError(null);
    fetch('/api/data-entry/fields')
      .then(async (r) => {
        if (!r.ok) {
          const body = await r.json().catch(() => ({}));
          throw new Error(body.error ?? `Failed to load fields (${r.status})`);
        }
        return r.json();
      })
      .then((data) => {
        setFields(data.fields ?? []);
        setBatches(data.batches ?? []);
      })
      .catch((e) => setLoadError(e instanceof Error ? e.message : 'Failed to load fields'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return fields.filter((f) => {
      if (!showInactive && !f.is_active) return false;
      if (filterBatch !== 'all' && f.batch_id !== filterBatch) return false;
      if (q && !f.field_name.toLowerCase().includes(q) && !f.instruction.toLowerCase().includes(q) && !f.sf_object.toLowerCase().includes(q)) {
        return false;
      }
      return true;
    });
  }, [fields, search, filterBatch, showInactive]);

  const grouped = useMemo(() => {
    const groups = new Map<string, FieldConfigRow[]>();
    for (const f of filtered) {
      if (!groups.has(f.batch_id)) groups.set(f.batch_id, []);
      groups.get(f.batch_id)!.push(f);
    }
    return groups;
  }, [filtered]);

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="h-8 w-48 animate-pulse rounded bg-muted" />
        <div className="h-10 w-full animate-pulse rounded-lg bg-muted" />
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="h-32 animate-pulse rounded-xl border bg-card" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Field Configuration</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {fields.filter((f) => f.is_active).length} active · {fields.filter((f) => !f.is_active).length} inactive · {batches.length} batches
          </p>
        </div>
        <button
          onClick={() => setShowAddForm(true)}
          type="button"
          className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 transition focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-200"
        >
          + Add Field
        </button>
      </div>

      {loadError && (
        <div className="rounded-xl border border-destructive/40 bg-destructive/5 p-4">
          <p className="text-sm font-medium text-destructive">Couldn&apos;t load field configuration</p>
          <p className="mt-1 text-xs text-muted-foreground break-words">{loadError}</p>
          <button
            onClick={load}
            type="button"
            className="mt-3 rounded-lg border px-3 py-1.5 text-sm font-medium hover:bg-accent transition focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-200"
          >
            Retry
          </button>
        </div>
      )}

      {actionError && (
        <p className="text-sm text-destructive">{actionError}</p>
      )}

      {/* ── Filters ───────────────────────────────────── */}
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex-1 min-w-[200px]">
          <label className="block text-xs text-muted-foreground mb-1">Search</label>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Field name or instruction..."
            aria-label="Search fields"
            className="w-full rounded-lg border bg-background px-3 py-2 text-sm transition focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-200"
          />
        </div>
        <div>
          <label className="block text-xs text-muted-foreground mb-1">Batch</label>
          <select
            value={filterBatch}
            onChange={(e) => setFilterBatch(e.target.value)}
            className="rounded-lg border bg-background px-3 py-2 text-sm transition focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-200"
          >
            <option value="all">All batches</option>
            {batches.map((b) => (
              <option key={b.batchId} value={b.batchId}>{b.label}</option>
            ))}
          </select>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={showInactive}
            onChange={(e) => setShowInactive(e.target.checked)}
            className="h-4 w-4 rounded accent-emerald-600"
          />
          Show inactive
        </label>
        <p className="text-xs text-muted-foreground self-end">{filtered.length} shown</p>
      </div>

      {/* ── Add form ──────────────────────────────────── */}
      {showAddForm && (
        <FieldForm
          batches={batches}
          onCancel={() => setShowAddForm(false)}
          onSaved={() => {
            setShowAddForm(false);
            load();
          }}
        />
      )}

      {/* ── Grouped field list ────────────────────────── */}
      {[...grouped.entries()].map(([batchId, batchFields]) => {
        const batchConfig = batches.find((b) => b.batchId === batchId);
        return (
          <details key={batchId} open className="rounded-xl border">
            <summary className="cursor-pointer px-4 py-3 font-medium hover:bg-accent/50 transition">
              {batchConfig?.label ?? batchId}
              <span className="ml-2 text-sm text-muted-foreground">({batchFields.length})</span>
            </summary>
            <div className="border-t">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs text-muted-foreground">
                    <th className="px-4 py-2">Field</th>
                    <th className="px-4 py-2">Object</th>
                    <th className="px-4 py-2">Type</th>
                    <th className="px-4 py-2">Write</th>
                    <th className="px-4 py-2">Instruction</th>
                    <th className="px-4 py-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {batchFields.map((field) => (
                    editingId === field.id ? (
                      <tr key={field.id}>
                        <td colSpan={6} className="p-4 bg-accent/20 border-b">
                          <FieldForm
                            existing={field}
                            batches={batches}
                            onCancel={() => setEditingId(null)}
                            onSaved={() => {
                              setEditingId(null);
                              load();
                            }}
                          />
                        </td>
                      </tr>
                    ) : (
                      <FieldRow
                        key={field.id}
                        field={field}
                        onEdit={() => setEditingId(field.id)}
                        onDelete={async () => {
                          if (!confirm(`Deactivate ${field.field_name}? It won't be deleted, just skipped at run time.`)) return;
                          setActionError(null);
                          try {
                            const res = await fetch(`/api/data-entry/fields/${field.id}`, { method: 'DELETE' });
                            if (!res.ok) {
                              const body = await res.json().catch(() => ({}));
                              throw new Error(body.error ?? `Disable failed (${res.status})`);
                            }
                            load();
                          } catch (e) {
                            setActionError(e instanceof Error ? e.message : 'Disable failed');
                          }
                        }}
                        onReactivate={async () => {
                          if (!confirm(`Reactivate ${field.field_name}? It will be extracted again on the next run.`)) return;
                          setActionError(null);
                          try {
                            const res = await fetch(`/api/data-entry/fields/${field.id}`, {
                              method: 'PUT',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({ isActive: true }),
                            });
                            if (!res.ok) {
                              const body = await res.json().catch(() => ({}));
                              throw new Error(body.error ?? `Reactivate failed (${res.status})`);
                            }
                            load();
                          } catch (e) {
                            setActionError(e instanceof Error ? e.message : 'Reactivate failed');
                          }
                        }}
                      />
                    )
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        );
      })}

      {!loadError && grouped.size === 0 && (
        <p className="py-8 text-center text-sm text-muted-foreground">No fields match the current filters.</p>
      )}
    </div>
  );
}

// ─── Row ───────────────────────────────────────────────

function FieldRow({
  field,
  onEdit,
  onDelete,
  onReactivate,
}: {
  field: FieldConfigRow;
  onEdit: () => void;
  onDelete: () => void;
  onReactivate: () => void;
}) {
  const writeModeStyle =
    field.write_mode === 'overwrite'
      ? 'text-orange-700 bg-orange-50'
      : field.write_mode === 'fill_blank'
        ? 'text-blue-700 bg-blue-50'
        : 'text-purple-700 bg-purple-50';

  const rowClass = field.is_active
    ? 'border-b last:border-0 hover:bg-accent/50 transition'
    : 'border-b last:border-0 bg-gray-50 opacity-60 hover:bg-accent/50 transition';

  return (
    <tr className={rowClass}>
      <td className="px-4 py-2 font-mono text-xs">{field.field_name}</td>
      <td className="px-4 py-2">
        <span className={`inline-flex rounded px-1.5 py-0.5 text-xs ${field.sf_object === 'Lead' ? 'bg-indigo-50 text-indigo-700' : 'bg-emerald-50 text-emerald-700'}`}>
          {field.sf_object}
        </span>
      </td>
      <td className="px-4 py-2 text-xs text-muted-foreground">{field.value_type}</td>
      <td className="px-4 py-2">
        <span className={`inline-flex rounded px-1.5 py-0.5 text-xs ${writeModeStyle}`}>
          {field.write_mode}
        </span>
      </td>
      <td className="px-4 py-2 max-w-[400px] truncate text-xs text-muted-foreground" title={field.instruction}>
        {field.instruction}
      </td>
      <td className="px-4 py-2 text-right">
        <button
          onClick={onEdit}
          type="button"
          className="text-xs text-blue-600 hover:underline mr-3 rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-200"
        >
          Edit
        </button>
        {field.is_active ? (
          <button
            onClick={onDelete}
            type="button"
            className="text-xs text-destructive hover:underline rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-200"
          >
            Disable
          </button>
        ) : (
          <button
            onClick={onReactivate}
            type="button"
            className="text-xs text-emerald-700 hover:underline rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-200"
          >
            Enable
          </button>
        )}
      </td>
    </tr>
  );
}

// ─── Form (add + edit) ──────────────────────────────────

function FieldForm({
  existing,
  batches,
  onCancel,
  onSaved,
}: {
  existing?: FieldConfigRow;
  batches: BatchConfigItem[];
  onCancel: () => void;
  onSaved: () => void;
}) {
  const [configId, setConfigId] = useState(existing?.config_id ?? '');
  const [fieldName, setFieldName] = useState(existing?.field_name ?? '');
  const [sfObject, setSfObject] = useState<'Lead' | 'Opportunity'>(existing?.sf_object ?? 'Opportunity');
  const [valueType, setValueType] = useState<string>(existing?.value_type ?? 'text');
  const [batchId, setBatchId] = useState(existing?.batch_id ?? batches[0]?.batchId ?? 'firmographic');
  const [writeMode, setWriteMode] = useState<string>(existing?.write_mode ?? 'overwrite');
  const [instruction, setInstruction] = useState(existing?.instruction ?? '');
  const [optionsText, setOptionsText] = useState((existing?.options ?? []).join('\n'));
  const [maxLength, setMaxLength] = useState(existing?.validation?.maxLength?.toString() ?? '');
  const [minVal, setMinVal] = useState(existing?.validation?.min?.toString() ?? '');
  const [maxVal, setMaxVal] = useState(existing?.validation?.max?.toString() ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const needsOptions = valueType === 'picklist' || valueType === 'multipicklist';
  const isEdit = !!existing;

  // Client-side validation for NEW fields (config_id + SF field name format).
  const configIdError = !isEdit && configId.length > 0 && !CONFIG_ID_RE.test(configId)
    ? 'Must be lowercase_snake_case (start with a letter).'
    : null;
  const fieldNameError = !isEdit && fieldName.length > 0 && !FIELD_NAME_RE.test(fieldName)
    ? 'Custom field API name must end with __c.'
    : null;
  const newFieldValid = isEdit
    || (CONFIG_ID_RE.test(configId) && FIELD_NAME_RE.test(fieldName));

  async function handleSave() {
    if (!newFieldValid) {
      setError('Fix the highlighted fields before saving.');
      return;
    }
    setSaving(true);
    setError(null);

    const options = needsOptions
      ? optionsText.split('\n').map((s) => s.trim()).filter(Boolean)
      : undefined;

    const validation: Record<string, unknown> = {};
    if (maxLength) validation.maxLength = parseInt(maxLength, 10);
    if (minVal) validation.min = parseFloat(minVal);
    if (maxVal) validation.max = parseFloat(maxVal);
    if (valueType === 'date') validation.dateFormat = 'YYYY-MM-DD';
    if (valueType === 'datetime') validation.dateFormat = 'YYYY-MM-DDTHH:MM:SSZ';

    try {
      const body = {
        ...(isEdit ? {} : { configId, fieldName, sfObject }),
        valueType,
        batchId,
        writeMode,
        instruction,
        options,
        validation: Object.keys(validation).length > 0 ? validation : undefined,
      };

      const response = await fetch(
        isEdit ? `/api/data-entry/fields/${existing.id}` : '/api/data-entry/fields',
        {
          method: isEdit ? 'PUT' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        },
      );

      const data = await response.json();
      if (!response.ok) {
        setError(data.error ?? 'Save failed');
      } else {
        onSaved();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-3">
      <h3 className="font-medium text-sm">{isEdit ? `Edit ${existing.field_name}` : 'Add New Field'}</h3>

      {!isEdit && (
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="field-config-id" className="block text-xs text-muted-foreground mb-1">Config ID (lowercase_snake_case)</label>
            <input
              id="field-config-id"
              type="text"
              value={configId}
              onChange={(e) => setConfigId(e.target.value)}
              placeholder="custom_buyer_preference"
              aria-invalid={configIdError ? true : undefined}
              className={`w-full rounded-lg border bg-background px-3 py-2 text-sm transition focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-200 font-mono ${configIdError ? 'border-destructive' : ''}`}
            />
            {configIdError && <p className="mt-1 text-xs text-destructive">{configIdError}</p>}
          </div>
          <div>
            <label htmlFor="field-sf-name" className="block text-xs text-muted-foreground mb-1">SF Field Name (must end with __c)</label>
            <input
              id="field-sf-name"
              type="text"
              value={fieldName}
              onChange={(e) => setFieldName(e.target.value)}
              placeholder="AI_Custom_Field__c"
              aria-invalid={fieldNameError ? true : undefined}
              className={`w-full rounded-lg border bg-background px-3 py-2 text-sm transition focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-200 font-mono ${fieldNameError ? 'border-destructive' : ''}`}
            />
            {fieldNameError && <p className="mt-1 text-xs text-destructive">{fieldNameError}</p>}
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {!isEdit && (
          <div>
            <label className="block text-xs text-muted-foreground mb-1">Object</label>
            <select
              value={sfObject}
              onChange={(e) => setSfObject(e.target.value as 'Lead' | 'Opportunity')}
              className="w-full rounded-lg border bg-background px-3 py-2 text-sm transition focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-200"
            >
              <option value="Lead">Lead</option>
              <option value="Opportunity">Opportunity</option>
            </select>
          </div>
        )}
        <div>
          <label className="block text-xs text-muted-foreground mb-1">Value Type</label>
          <select
            value={valueType}
            onChange={(e) => setValueType(e.target.value)}
            className="w-full rounded-lg border bg-background px-3 py-2 text-sm transition focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-200"
          >
            {VALUE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs text-muted-foreground mb-1">Batch</label>
          <select
            value={batchId}
            onChange={(e) => setBatchId(e.target.value)}
            className="w-full rounded-lg border bg-background px-3 py-2 text-sm transition focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-200"
          >
            {batches.map((b) => <option key={b.batchId} value={b.batchId}>{b.batchId}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs text-muted-foreground mb-1">Write Mode</label>
          <select
            value={writeMode}
            onChange={(e) => setWriteMode(e.target.value)}
            className="w-full rounded-lg border bg-background px-3 py-2 text-sm transition focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-200"
          >
            {WRITE_MODES.map((w) => <option key={w} value={w}>{w}</option>)}
          </select>
        </div>
      </div>

      <div>
        <label className="block text-xs text-muted-foreground mb-1">
          Extraction Instruction (what the LLM should look for)
        </label>
        <textarea
          value={instruction}
          onChange={(e) => setInstruction(e.target.value)}
          rows={4}
          className="w-full rounded-lg border bg-background px-3 py-2 text-sm transition focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-200"
          placeholder="e.g. Determine the buyer persona. Is this person a Property Owner..."
        />
      </div>

      {needsOptions && (
        <div>
          <label className="block text-xs text-muted-foreground mb-1">
            Valid Options (one per line)
          </label>
          <textarea
            value={optionsText}
            onChange={(e) => setOptionsText(e.target.value)}
            rows={6}
            className="w-full rounded-lg border bg-background px-3 py-2 text-sm transition focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-200 font-mono"
            placeholder="Option 1&#10;Option 2&#10;Option 3"
          />
        </div>
      )}

      <div className="grid grid-cols-3 gap-3">
        {(valueType === 'text' || valueType === 'textarea') && (
          <div>
            <label className="block text-xs text-muted-foreground mb-1">Max Length</label>
            <input
              type="number"
              value={maxLength}
              onChange={(e) => setMaxLength(e.target.value)}
              className="w-full rounded-lg border bg-background px-3 py-2 text-sm transition focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-200"
            />
          </div>
        )}
        {valueType === 'number' && (
          <>
            <div>
              <label className="block text-xs text-muted-foreground mb-1">Min</label>
              <input type="number" value={minVal} onChange={(e) => setMinVal(e.target.value)}
                className="w-full rounded-lg border bg-background px-3 py-2 text-sm transition focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-200" />
            </div>
            <div>
              <label className="block text-xs text-muted-foreground mb-1">Max</label>
              <input type="number" value={maxVal} onChange={(e) => setMaxVal(e.target.value)}
                className="w-full rounded-lg border bg-background px-3 py-2 text-sm transition focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-200" />
            </div>
          </>
        )}
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="flex gap-2 justify-end pt-2">
        <button
          onClick={onCancel}
          type="button"
          disabled={saving}
          className="rounded-md border px-4 py-2 text-sm hover:bg-accent transition"
        >
          Cancel
        </button>
        <button
          onClick={handleSave}
          type="button"
          disabled={saving || !instruction.trim()}
          className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50 transition"
        >
          {saving ? 'Saving...' : (isEdit ? 'Save Changes' : 'Create Field')}
        </button>
      </div>
    </div>
  );
}
