import { useEffect, useRef, useState } from 'react';
import { Bot, Check, ClipboardCopy, FileJson, FileText, Plug, ChevronDown } from 'lucide-react';
import { api } from '../api';
import type { QueryState } from '../lib/query-state';

/**
 * Everything in this project for the selected period, in a form an AI can use:
 * copy a readable report to paste into any chat, download it, download the full
 * data as JSON, or jump to the live connector setup.
 */
export function AiExportMenu({ projectId, state, onConnect }: { projectId: string; state: QueryState; onConnect: () => void }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  // Only the period applies: the export is the whole project, not the filtered view.
  const { preset, from, to } = state.query as Record<string, string | undefined>;
  const period = Object.fromEntries(Object.entries({ preset, from, to }).filter(([, v]) => v)) as Record<string, string>;

  async function run(id: string, action: () => Promise<void>) {
    setBusy(id);
    setError(null);
    try {
      await action();
      setDone(id);
      setTimeout(() => setDone(null), 2000);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Export failed');
    } finally {
      setBusy(null);
    }
  }

  const items = [
    {
      id: 'copy',
      icon: ClipboardCopy,
      title: 'Copy report for AI',
      hint: 'Paste into ChatGPT, Claude or Gemini and ask anything',
      action: () => run('copy', async () => navigator.clipboard.writeText(await api.aiExportText(projectId, period))),
    },
    {
      id: 'md',
      icon: FileText,
      title: 'Download report (.md)',
      hint: 'Readable report: numbers, findings, leads, pages, sources',
      action: () => run('md', () => api.downloadAiExport(projectId, 'md', period)),
    },
    {
      id: 'json',
      icon: FileJson,
      title: 'Download full data (.json)',
      hint: 'Every report as structured data, for tools and scripts',
      action: () => run('json', () => api.downloadAiExport(projectId, 'json', period)),
    },
  ];

  return (
    <div className="relative" ref={box}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-1.5 px-3 py-2 rounded-full border border-meadow-200 bg-white text-sm font-medium text-forest hover:border-meadow-400"
        aria-expanded={open}
      >
        <Bot className="w-3.5 h-3.5" /> Export for AI <ChevronDown className="w-3 h-3 text-forest-muted" />
      </button>
      {open && (
        <div className="absolute right-0 mt-2 w-80 rounded-2xl border border-meadow-200 bg-white shadow-lg p-2 z-40">
          <p className="px-3 pt-2 pb-1 text-xs text-forest-muted">
            The whole project for the selected period, including leads.
          </p>
          {items.map((it) => (
            <button
              key={it.id}
              onClick={it.action}
              disabled={busy !== null}
              className="w-full flex items-start gap-3 px-3 py-2.5 rounded-xl text-left hover:bg-meadow-50 disabled:opacity-60"
            >
              {done === it.id ? <Check className="w-4 h-4 mt-0.5 text-meadow-600" /> : <it.icon className="w-4 h-4 mt-0.5 text-forest-muted" />}
              <span>
                <span className="block text-sm font-medium text-forest">
                  {busy === it.id ? 'Preparing…' : done === it.id ? (it.id === 'copy' ? 'Copied' : 'Downloaded') : it.title}
                </span>
                <span className="block text-xs text-forest-muted">{it.hint}</span>
              </span>
            </button>
          ))}
          <div className="my-1 border-t border-meadow-100" />
          <button
            onClick={() => { setOpen(false); onConnect(); }}
            className="w-full flex items-start gap-3 px-3 py-2.5 rounded-xl text-left hover:bg-meadow-50"
          >
            <Plug className="w-4 h-4 mt-0.5 text-forest-muted" />
            <span>
              <span className="block text-sm font-medium text-forest">Connect an AI assistant</span>
              <span className="block text-xs text-forest-muted">Live, read-only access for Claude, ChatGPT or Cursor</span>
            </span>
          </button>
          {error && <p className="px-3 pb-2 text-xs text-red-600">{error}</p>}
        </div>
      )}
    </div>
  );
}
