import { forwardRef, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Button from '../ui/Button.tsx';
import EmailPreviewFrame, { type PreviewDevice } from './EmailPreviewFrame.tsx';
import VariablePalette from './VariablePalette.tsx';
import type { EmailSettings, TemplateKind } from '../../hooks/useEmailSettings.ts';
import type { Notify } from '../../hooks/useToast.ts';

interface Props {
  settings: EmailSettings;
  notify: Notify;
}

type Source = { type: 'published' } | { type: 'draft'; id: string };
type View = 'preview' | 'edit';

const KIND_LABEL: Record<TemplateKind, string> = {
  justified: 'פנייה מוצדקת',
  unjustified: 'פנייה לא מוצדקת',
};

function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return debounced;
}

export default function LetterStudio({ settings, notify }: Props) {
  const { templates, drafts, assetVariables } = settings;

  const [kind, setKind] = useState<TemplateKind>('justified');
  const [source, setSource] = useState<Source>({ type: 'published' });
  const [view, setView] = useState<View>('preview');
  const [fullscreen, setFullscreen] = useState(false);
  const [subject, setSubject] = useState('');
  const [html, setHtml] = useState('');
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<{ subject: string; html: string } | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [device, setDevice] = useState<PreviewDevice>('desktop');
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [nameTarget, setNameTarget] = useState<string | 'new' | null>(null);
  const [nameValue, setNameValue] = useState('');

  const subjectRef = useRef<HTMLInputElement>(null);
  const htmlRef = useRef<HTMLTextAreaElement>(null);
  const activeRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);
  const paletteWrapRef = useRef<HTMLDivElement>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const previewSeq = useRef(0);

  const draftsForKind = useMemo(() => drafts.filter((d) => d.kind === kind), [drafts, kind]);
  const activeDraft = useMemo(
    () => (source.type === 'draft' ? drafts.find((d) => d.id === source.id) ?? null : null),
    [source, drafts],
  );

  const base = useMemo(() => {
    if (source.type === 'draft' && activeDraft) {
      return {
        subjectTemplate: activeDraft.subjectTemplate,
        htmlTemplate: activeDraft.htmlTemplate,
        isCustom: true,
      };
    }
    const t = templates?.[kind];
    return t
      ? { subjectTemplate: t.subjectTemplate, htmlTemplate: t.htmlTemplate, isCustom: t.isCustom }
      : null;
  }, [source.type, activeDraft, templates, kind]);

  useEffect(() => {
    if (source.type === 'draft' && !activeDraft) setSource({ type: 'published' });
  }, [source, activeDraft]);

  useEffect(() => {
    if (base) {
      setSubject(base.subjectTemplate);
      setHtml(base.htmlTemplate);
      setPreview(null);
    }
  }, [base]);

  const dirty = useMemo(
    () => !!base && (subject !== base.subjectTemplate || html !== base.htmlTemplate),
    [base, subject, html],
  );

  const debouncedSubject = useDebounced(subject, 450);
  const debouncedHtml = useDebounced(html, 450);

  const runPreview = useCallback(
    async (subj: string, body: string, k: TemplateKind) => {
      if (!subj.trim() || !body.trim()) {
        setPreview(null);
        return;
      }
      const seq = ++previewSeq.current;
      setPreviewLoading(true);
      const res = await settings.previewTemplate(k, subj, body);
      if (seq !== previewSeq.current) return;
      if (res.ok && res.data) setPreview(res.data);
      setPreviewLoading(false);
    },
    [settings],
  );

  useEffect(() => {
    void runPreview(debouncedSubject, debouncedHtml, kind);
  }, [debouncedSubject, debouncedHtml, kind, runPreview]);

  // Lock body scroll while fullscreen.
  useEffect(() => {
    if (!fullscreen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [fullscreen]);

  // Palette popover: close on outside click / Escape.
  useEffect(() => {
    if (!paletteOpen) return;
    const onDown = (e: MouseEvent) => {
      if (!paletteWrapRef.current?.contains(e.target as Node)) setPaletteOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setPaletteOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [paletteOpen]);

  useEffect(() => {
    if (nameTarget) nameInputRef.current?.focus();
  }, [nameTarget]);

  const insert = useCallback((text: string) => {
    const el = activeRef.current ?? htmlRef.current;
    if (!el) return;
    const isSubject = el === subjectRef.current;
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? start;
    const next = el.value.slice(0, start) + text + el.value.slice(end);
    if (isSubject) setSubject(next);
    else setHtml(next);
    requestAnimationFrame(() => {
      el.focus();
      const pos = start + text.length;
      el.setSelectionRange(pos, pos);
    });
  }, []);

  const confirmLeave = () => !dirty || confirm('יש שינויים לא שמורים. להמשיך בלי לשמור?');

  const selectSource = (next: Source) => {
    if (
      (next.type === 'published' && source.type === 'published') ||
      (next.type === 'draft' && source.type === 'draft' && next.id === source.id)
    ) {
      return;
    }
    if (!confirmLeave()) return;
    setSource(next);
  };

  const switchKind = (k: TemplateKind) => {
    if (k === kind) return;
    if (!confirmLeave()) return;
    setKind(k);
    setSource({ type: 'published' });
  };

  const save = useCallback(async () => {
    if (!dirty || busy) return;
    setBusy(true);
    const res =
      source.type === 'draft'
        ? await settings.updateDraft(source.id, { subjectTemplate: subject, htmlTemplate: html })
        : await settings.saveTemplate(kind, subject, html);
    setBusy(false);
    if (res.ok) {
      notify('ok', source.type === 'draft' ? 'הטיוטה נשמרה' : 'התבנית הפעילה נשמרה');
    } else {
      notify('err', res.error || 'שמירה נכשלה');
    }
  }, [dirty, busy, source, settings, subject, html, kind, notify]);

  const reset = useCallback(async () => {
    if (!confirm('לאפס את התבנית הפעילה לברירת המחדל? השינויים יימחקו.')) return;
    setBusy(true);
    const res = await settings.resetTemplate(kind);
    setBusy(false);
    notify(res.ok ? 'ok' : 'err', res.ok ? 'אופס לברירת מחדל' : res.error || 'איפוס נכשל');
  }, [settings, kind, notify]);

  const publishDraft = useCallback(async () => {
    if (!confirm(`לפרסם את הנוסח כתבנית הפעילה? מכתבי הסגירה (${KIND_LABEL[kind]}) יישלחו לפיו.`))
      return;
    setBusy(true);
    const res = await settings.saveTemplate(kind, subject, html);
    setBusy(false);
    if (res.ok) {
      notify('ok', 'הנוסח פורסם כתבנית הפעילה');
      setSource({ type: 'published' });
    } else {
      notify('err', res.error || 'הפרסום נכשל');
    }
  }, [settings, kind, subject, html, notify]);

  const deleteActiveDraft = useCallback(async () => {
    if (source.type !== 'draft') return;
    if (!confirm('למחוק את הטיוטה?')) return;
    setBusy(true);
    const res = await settings.deleteDraft(source.id);
    setBusy(false);
    if (res.ok) {
      notify('ok', 'הטיוטה נמחקה');
      setSource({ type: 'published' });
    } else {
      notify('err', res.error || 'מחיקה נכשלה');
    }
  }, [source, settings, notify]);

  const startCreate = () => {
    setNameTarget('new');
    setNameValue(`נוסח ${draftsForKind.length + 1}`);
  };
  const startRename = () => {
    if (!activeDraft) return;
    setNameTarget(activeDraft.id);
    setNameValue(activeDraft.name);
  };
  const cancelName = () => {
    setNameTarget(null);
    setNameValue('');
  };
  const commitName = async () => {
    const name = nameValue.trim();
    if (!name) return;
    setBusy(true);
    if (nameTarget === 'new') {
      const res = await settings.createDraft({
        kind,
        name,
        subjectTemplate: subject,
        htmlTemplate: html,
      });
      setBusy(false);
      if (res.ok && res.data) {
        notify('ok', 'הנוסח נשמר כטיוטה');
        setSource({ type: 'draft', id: res.data.id });
      } else {
        notify('err', res.error || 'שמירת הטיוטה נכשלה');
      }
    } else if (nameTarget) {
      const res = await settings.updateDraft(nameTarget, { name });
      setBusy(false);
      notify(res.ok ? 'ok' : 'err', res.ok ? 'השם עודכן' : res.error || 'העדכון נכשל');
    }
    cancelName();
  };

  // Keyboard: Ctrl/Cmd+S save · Esc exits fullscreen.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        void save();
      } else if (e.key === 'Escape' && fullscreen && !paletteOpen && !nameTarget) {
        setFullscreen(false);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [save, fullscreen, paletteOpen, nameTarget]);

  if (!base) {
    return (
      <div className="surface-card flex min-h-[460px] items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-indigo-500 border-t-transparent" />
      </div>
    );
  }

  const isDraft = source.type === 'draft';
  const publishedCustom = templates?.[kind]?.isCustom;

  const content = (
    <div className={`studio-shell ${fullscreen ? 'is-fullscreen' : ''}`}>
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3 border-b border-subtle px-4 py-3 md:px-5">
        <div className="seg">
          {(['justified', 'unjustified'] as const).map((k) => (
            <button key={k} type="button" className="seg-btn" data-active={kind === k} onClick={() => switchKind(k)}>
              {KIND_LABEL[k]}
            </button>
          ))}
        </div>

        <div className="seg view-seg">
          <button type="button" className="seg-btn" data-active={view === 'preview'} onClick={() => setView('preview')}>
            תצוגה
          </button>
          <button type="button" className="seg-btn" data-active={view === 'edit'} onClick={() => setView('edit')}>
            עריכה
          </button>
        </div>

        <div className="ms-auto flex flex-wrap items-center gap-2">
          <span className="hidden items-center gap-1.5 text-xs text-neutral-500 lg:flex">
            <span className={`h-1.5 w-1.5 rounded-full ${dirty ? 'bg-amber-500' : 'bg-emerald-500'}`} />
            {dirty ? 'לא נשמר' : isDraft ? 'טיוטה' : publishedCustom ? 'מותאם' : 'ברירת מחדל'}
          </span>

          {isDraft ? (
            <>
              <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={startRename}>
                שם
              </Button>
              <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => void deleteActiveDraft()}>
                מחק
              </Button>
              <Button type="button" variant="accent" size="sm" disabled={busy} onClick={() => void publishDraft()}>
                פרסם
              </Button>
            </>
          ) : (
            publishedCustom && (
              <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => void reset()}>
                איפוס
              </Button>
            )
          )}

          <Button type="button" size="sm" disabled={busy || !dirty} loading={busy} onClick={() => void save()}>
            שמירה
          </Button>

          <button
            type="button"
            className="grid h-8 w-8 place-items-center rounded-lg border border-subtle text-neutral-500 transition hover:bg-surface-elevated"
            onClick={() => setFullscreen((v) => !v)}
            title={fullscreen ? 'יציאה ממסך מלא (Esc)' : 'מסך מלא'}
            aria-label="מסך מלא"
          >
            {fullscreen ? (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
                <path d="M9 9H5m4 0V5m0 4L4 4m11 5h4m-4 0V5m0 4l5-5M9 15H5m4 0v4m0-4l-5 5m11-5h4m-4 0v4m0-4l5 5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
              </svg>
            ) : (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
                <path d="M4 9V5a1 1 0 011-1h4M20 9V5a1 1 0 00-1-1h-4M4 15v4a1 1 0 001 1h4m11-5v4a1 1 0 01-1 1h-4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
              </svg>
            )}
          </button>
        </div>
      </div>

      {/* Drafts bar */}
      <div className="draft-bar">
        <button type="button" className="draft-chip" data-active={!isDraft} onClick={() => selectSource({ type: 'published' })}>
          <span className="draft-chip-dot bg-emerald-500" />
          תבנית פעילה
        </button>

        {draftsForKind.map((d) =>
          nameTarget === d.id ? (
            <NameInput key={d.id} ref={nameInputRef} value={nameValue} onChange={setNameValue} onCommit={() => void commitName()} onCancel={cancelName} busy={busy} />
          ) : (
            <button
              key={d.id}
              type="button"
              className="draft-chip"
              data-active={isDraft && source.id === d.id}
              onClick={() => selectSource({ type: 'draft', id: d.id })}
              title={`עודכן ${new Date(d.updatedAt).toLocaleDateString('he-IL')}`}
            >
              <span className="draft-chip-dot bg-indigo-400" />
              {d.name}
            </button>
          ),
        )}

        {nameTarget === 'new' ? (
          <NameInput ref={nameInputRef} value={nameValue} onChange={setNameValue} onCommit={() => void commitName()} onCancel={cancelName} busy={busy} />
        ) : (
          <button type="button" className="draft-chip draft-chip-add" onClick={startCreate}>
            + שמירה כטיוטה
          </button>
        )}
      </div>

      {/* Stage */}
      <div className="studio-stage">
        {view === 'preview' ? (
          <div className="preview-stage">
            <EmailPreviewFrame
              subject={preview?.subject ?? ''}
              html={preview?.html ?? ''}
              loading={previewLoading}
              empty={!preview && !previewLoading}
              device={device}
              onDeviceChange={setDevice}
            />
          </div>
        ) : (
          <div className="code-stage">
            <label className="block border-b border-subtle px-4 py-2.5 md:px-5">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-neutral-400">נושא</span>
              <input
                ref={subjectRef}
                type="text"
                className="input mt-1 border-0 bg-transparent px-0 !text-base font-medium shadow-none focus:ring-0"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                onFocus={() => (activeRef.current = subjectRef.current)}
                dir="rtl"
                placeholder="סגירת פנייה: {{subject}}"
              />
            </label>

            <div ref={paletteWrapRef} className="relative flex items-center justify-between border-b border-subtle bg-neutral-900 px-3 py-1.5 dark:bg-neutral-950 md:px-5">
              <span className="font-mono text-[11px] text-neutral-400">HTML</span>
              <button
                type="button"
                className="flex items-center gap-1.5 rounded-md bg-white/10 px-2.5 py-1 text-xs font-medium text-white transition hover:bg-white/20"
                onClick={() => setPaletteOpen((v) => !v)}
              >
                <span className="font-mono text-[11px]">{'{{ }}'}</span>
                הוסף שדה
              </button>
              {paletteOpen && (
                <div className="palette-pop end-3 top-[calc(100%+6px)] md:end-5">
                  <VariablePalette onInsert={insert} assetVariables={assetVariables} autoFocus />
                </div>
              )}
            </div>

            <textarea
              ref={htmlRef}
              className="code-editor textarea min-h-0 flex-1 resize-none rounded-none border-0 p-4 font-mono text-[13.5px] leading-relaxed md:p-6"
              dir="ltr"
              value={html}
              onChange={(e) => setHtml(e.target.value)}
              onFocus={() => (activeRef.current = htmlRef.current)}
              spellCheck={false}
              placeholder="<html>…</html>"
            />
          </div>
        )}
      </div>
    </div>
  );

  return fullscreen ? createPortal(content, document.body) : content;
}

/* Inline rename / create input rendered inside the drafts bar. */
const NameInput = forwardRef<
  HTMLInputElement,
  {
    value: string;
    onChange: (v: string) => void;
    onCommit: () => void;
    onCancel: () => void;
    busy: boolean;
  }
>(function NameInput({ value, onChange, onCommit, onCancel, busy }, ref) {
  return (
    <span className="draft-chip draft-chip-input">
      <input
        ref={ref}
        type="text"
        className="w-28 bg-transparent text-sm outline-none"
        value={value}
        disabled={busy}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') onCommit();
          if (e.key === 'Escape') onCancel();
        }}
        placeholder="שם הנוסח"
      />
      <button type="button" className="text-emerald-600 hover:text-emerald-500" onClick={onCommit} aria-label="שמור">
        ✓
      </button>
      <button type="button" className="text-neutral-400 hover:text-neutral-600" onClick={onCancel} aria-label="ביטול">
        ✕
      </button>
    </span>
  );
});
