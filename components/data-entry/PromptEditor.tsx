'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { apiFetch } from '@/lib/api/client';

type PromptRow = {
  id: string;
  version: number;
  name: string | null;
  notes: string | null;
  system_prompt: string;
  user_prompt_preamble: string;
  is_active: boolean;
  created_at: string;
};

export default function PromptEditor() {
  const [active, setActive] = useState<PromptRow | null>(null);
  const [history, setHistory] = useState<PromptRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  // Draft state
  const [systemPrompt, setSystemPrompt] = useState('');
  const [userPromptPreamble, setUserPromptPreamble] = useState('');
  const [name, setName] = useState('');
  const [notes, setNotes] = useState('');

  const hasChanges =
    (active && (systemPrompt !== active.system_prompt || userPromptPreamble !== (active.user_prompt_preamble ?? '')))
    || (!active && systemPrompt.length > 0);

  // Keep the latest dirty state in a ref so load() can dirty-guard without
  // being re-created on every keystroke.
  const hasChangesRef = useRef(hasChanges);
  hasChangesRef.current = hasChanges;

  const load = useCallback(() => {
    setLoading(true);
    setLoadError(null);
    apiFetch('/prompts')
      .then(async (r) => {
        const data = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(data?.error ?? `Failed to load prompts (${r.status})`);
        return data;
      })
      .then((data) => {
        setActive(data.active ?? null);
        setHistory(data.history ?? []);
        // Don't clobber an unsaved draft — only hydrate the editor when clean.
        if (data.active && !hasChangesRef.current) {
          setSystemPrompt(data.active.system_prompt);
          setUserPromptPreamble(data.active.user_prompt_preamble ?? '');
        }
      })
      .catch((e) => setLoadError(e instanceof Error ? e.message : 'Failed to load prompts'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  async function handleSave() {
    setSaving(true);
    setError(null);
    setFlash(null);

    try {
      const response = await apiFetch('/prompts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          systemPrompt,
          userPromptPreamble,
          name: name || undefined,
          notes: notes || undefined,
          activate: true,
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        setError(data.error ?? 'Save failed');
      } else {
        setName('');
        setNotes('');
        setFlash(`Saved version ${data.prompt.version}, now active`);
        load();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  async function handleActivate(promptId: string, version: number) {
    if (!confirm(`Activate version ${version}? The currently active version will be deactivated (but preserved in history).`)) return;

    try {
      const response = await apiFetch(`/prompts/${promptId}`, {
        method: 'POST',
      });
      const data = await response.json();
      if (!response.ok) {
        setError(data.error ?? 'Activation failed');
      } else {
        setFlash(`Version ${version} is now active`);
        load();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Activation failed');
    }
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="h-8 w-40 animate-pulse rounded bg-muted" />
        <div className="h-96 animate-pulse rounded-xl border bg-card" />
        <div className="h-48 animate-pulse rounded-xl border bg-card" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Prompt Editor</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Edit the system prompt used for every extraction batch. Saving creates a new version and flips it to active.
          Previous versions are preserved — you can roll back from the history panel below.
        </p>
      </div>

      {loadError && (
        <div className="rounded-xl border border-destructive/40 bg-destructive/5 p-4">
          <p className="text-sm font-medium text-destructive">Couldn&apos;t load prompts</p>
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

      {active && (
        <div className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">Currently active:</span>
          <span className="inline-flex rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800">
            v{active.version}
          </span>
          {active.name && <span className="text-muted-foreground">· {active.name}</span>}
          <span className="ml-auto text-xs text-muted-foreground">
            Saved {new Date(active.created_at).toLocaleString()}
          </span>
        </div>
      )}

      {/* ── System prompt editor ──────────────────────── */}
      <section className="rounded-xl border bg-card p-5">
        <label className="block text-sm font-medium mb-2">
          System Prompt
          <span className="ml-2 text-xs text-muted-foreground">
            ({systemPrompt.length.toLocaleString()} chars, ~{Math.ceil(systemPrompt.length / 4).toLocaleString()} tokens)
          </span>
        </label>
        <textarea
          value={systemPrompt}
          onChange={(e) => setSystemPrompt(e.target.value)}
          rows={20}
          className="w-full rounded-lg border bg-background px-3 py-2 text-sm font-mono leading-relaxed transition focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-200"
          placeholder="You are a data extraction assistant..."
        />

        <label className="mt-5 block text-sm font-medium mb-2">
          User Prompt Preamble
          <span className="ml-2 text-xs text-muted-foreground">
            (optional — prepended to the user message before the context block)
          </span>
        </label>
        <textarea
          value={userPromptPreamble}
          onChange={(e) => setUserPromptPreamble(e.target.value)}
          rows={4}
          className="w-full rounded-lg border bg-background px-3 py-2 text-sm font-mono leading-relaxed transition focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-200"
          placeholder="(leave empty unless you want extra instructions before the context)"
        />

        {/* Save section */}
        <div className="mt-5 border-t pt-4 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-muted-foreground mb-1">Version name (optional)</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Tighter grounding on transcripts"
                className="w-full rounded-lg border bg-background px-3 py-2 text-sm transition focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-200"
              />
            </div>
            <div>
              <label className="block text-xs text-muted-foreground mb-1">Notes (optional)</label>
              <input
                type="text"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Why this change?"
                className="w-full rounded-lg border bg-background px-3 py-2 text-sm transition focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-200"
              />
            </div>
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}
          {flash && <p className="text-sm text-emerald-700">{flash}</p>}

          <div className="flex items-center justify-between">
            <p className="text-xs text-muted-foreground">
              {hasChanges ? 'You have unsaved changes' : 'No changes'}
            </p>
            <button
              onClick={handleSave}
              type="button"
              disabled={saving || !hasChanges || systemPrompt.trim().length < 50}
              className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50 transition focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-200"
            >
              {saving ? 'Saving...' : 'Save as New Version'}
            </button>
          </div>
        </div>
      </section>

      {/* ── Version history ───────────────────────────── */}
      <section className="rounded-xl border bg-card p-5">
        <h2 className="text-sm font-semibold mb-3">Version History ({history.length})</h2>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-xs text-muted-foreground">
              <th className="py-2 pr-3 font-normal">Version</th>
              <th className="py-2 pr-3 font-normal">Name</th>
              <th className="py-2 pr-3 font-normal">Status</th>
              <th className="py-2 pr-3 font-normal">Created</th>
              <th className="py-2 font-normal"></th>
            </tr>
          </thead>
          <tbody>
            {history.map((row) => (
              <tr key={row.id} className="border-b last:border-0">
                <td className="py-2 pr-3 font-mono">v{row.version}</td>
                <td className="py-2 pr-3 text-muted-foreground">{row.name ?? '—'}</td>
                <td className="py-2 pr-3">
                  {row.is_active ? (
                    <span className="inline-flex rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800">active</span>
                  ) : (
                    <span className="inline-flex rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-700">inactive</span>
                  )}
                </td>
                <td className="py-2 pr-3 text-xs text-muted-foreground">
                  {new Date(row.created_at).toLocaleString()}
                </td>
                <td className="py-2 text-right">
                  {!row.is_active && (
                    <button
                      onClick={() => handleActivate(row.id, row.version)}
                      type="button"
                      className="text-xs text-blue-600 hover:underline rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-200"
                    >
                      Activate
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {history.length === 0 && !active && (
          <p className="py-4 text-center text-sm text-muted-foreground">No versions yet.</p>
        )}
      </section>
    </div>
  );
}
