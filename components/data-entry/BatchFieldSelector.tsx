'use client';

import { useEffect, useMemo, useState } from 'react';

type FieldRow = {
  field_name: string;
  sf_object: 'Lead' | 'Opportunity';
  batch_id: string;
  instruction: string;
  is_active: boolean;
};

type Props = {
  objectType: 'Lead' | 'Opportunity';
  disabled?: boolean;
  scopeAll: boolean;
  selectedFields: string[];
  onScopeAllChange: (all: boolean) => void;
  onSelectedFieldsChange: (fields: string[]) => void;
};

/**
 * Field scope picker for a batch run: "All fields" or a specific subset.
 * Scoping to a few fields means the agent only extracts/writes those, which
 * cuts cost (fewer LLM chunks → the large context isn't re-sent as often).
 */
export function BatchFieldSelector({
  objectType,
  disabled,
  scopeAll,
  selectedFields,
  onScopeAllChange,
  onSelectedFieldsChange,
}: Props) {
  const [allFields, setAllFields] = useState<FieldRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch('/api/data-entry/fields')
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        if (data.error) setError(data.error);
        else setAllFields((data.fields ?? []) as FieldRow[]);
      })
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : 'Failed to load fields'))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, []);

  // Active fields for the selected object, grouped by batch.
  const groups = useMemo(() => {
    const q = search.trim().toLowerCase();
    const rows = allFields
      .filter((f) => f.sf_object === objectType && f.is_active)
      .filter((f) => !q || f.field_name.toLowerCase().includes(q) || f.instruction.toLowerCase().includes(q));
    const byBatch = new Map<string, FieldRow[]>();
    for (const f of rows) {
      if (!byBatch.has(f.batch_id)) byBatch.set(f.batch_id, []);
      byBatch.get(f.batch_id)!.push(f);
    }
    return Array.from(byBatch.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [allFields, objectType, search]);

  const selected = useMemo(() => new Set(selectedFields), [selectedFields]);
  const totalForObject = useMemo(
    () => allFields.filter((f) => f.sf_object === objectType && f.is_active).length,
    [allFields, objectType],
  );

  function toggleField(name: string) {
    const next = new Set(selected);
    if (next.has(name)) next.delete(name);
    else next.add(name);
    onSelectedFieldsChange([...next]);
  }

  function toggleGroup(fields: FieldRow[]) {
    const names = fields.map((f) => f.field_name);
    const allOn = names.every((n) => selected.has(n));
    const next = new Set(selected);
    if (allOn) names.forEach((n) => next.delete(n));
    else names.forEach((n) => next.add(n));
    onSelectedFieldsChange([...next]);
  }

  return (
    <div>
      <label className="block text-xs font-medium text-muted-foreground mb-1">Fields</label>
      <div className="flex gap-1">
        {[
          { key: true, label: 'All fields' },
          { key: false, label: 'Specific fields' },
        ].map((opt) => (
          <button
            key={String(opt.key)}
            type="button"
            disabled={disabled}
            onClick={() => onScopeAllChange(opt.key)}
            className={`rounded-full px-3 py-1 text-xs font-medium transition disabled:opacity-50 ${
              scopeAll === opt.key
                ? 'bg-foreground text-background'
                : 'bg-muted text-muted-foreground hover:text-foreground'
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {!scopeAll && (
        <div className="mt-2 rounded-lg border bg-background">
          <div className="flex items-center gap-2 border-b px-3 py-2">
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={`Search ${totalForObject} ${objectType} fields…`}
              disabled={disabled}
              className="w-full bg-transparent text-sm outline-none"
            />
            <span className="shrink-0 text-xs text-muted-foreground">{selected.size} selected</span>
            {selected.size > 0 && (
              <button
                type="button"
                onClick={() => onSelectedFieldsChange([])}
                disabled={disabled}
                className="shrink-0 text-xs text-blue-600 hover:underline disabled:opacity-50"
              >
                Clear
              </button>
            )}
          </div>

          <div className="max-h-64 overflow-y-auto p-2">
            {loading ? (
              <p className="px-2 py-3 text-sm text-muted-foreground">Loading fields…</p>
            ) : error ? (
              <p className="px-2 py-3 text-sm text-destructive">{error}</p>
            ) : groups.length === 0 ? (
              <p className="px-2 py-3 text-sm text-muted-foreground">No matching fields.</p>
            ) : (
              groups.map(([batchId, fields]) => {
                const allOn = fields.every((f) => selected.has(f.field_name));
                return (
                  <div key={batchId} className="mb-2">
                    <button
                      type="button"
                      onClick={() => toggleGroup(fields)}
                      disabled={disabled}
                      className="mb-1 flex w-full items-center gap-2 rounded px-2 py-1 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground hover:bg-accent disabled:opacity-50"
                    >
                      <span className={`inline-block h-3 w-3 rounded-sm border ${allOn ? 'bg-emerald-600 border-emerald-600' : 'border-muted-foreground'}`} />
                      {batchId} ({fields.length})
                    </button>
                    {fields.map((f) => (
                      <label
                        key={f.field_name}
                        className="flex cursor-pointer items-start gap-2 rounded px-2 py-1 hover:bg-accent"
                        title={f.instruction}
                      >
                        <input
                          type="checkbox"
                          checked={selected.has(f.field_name)}
                          onChange={() => toggleField(f.field_name)}
                          disabled={disabled}
                          className="mt-0.5"
                        />
                        <span className="font-mono text-xs">{f.field_name}</span>
                      </label>
                    ))}
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
