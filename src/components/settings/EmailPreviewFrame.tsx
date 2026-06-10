import { useEffect, useRef } from 'react';
import Button from '../ui/Button.tsx';

export type PreviewDevice = 'desktop' | 'mobile';

interface Props {
  subject: string;
  html: string;
  loading?: boolean;
  empty?: boolean;
  device: PreviewDevice;
  onDeviceChange: (d: PreviewDevice) => void;
  onDownloadPdf?: () => void;
  pdfLoading?: boolean;
  pdfDisabled?: boolean;
}

const DEVICES: { id: PreviewDevice; label: string }[] = [
  { id: 'desktop', label: 'מחשב' },
  { id: 'mobile', label: 'נייד' },
];

/** Resize iframe to full document height so long letters scroll in the preview pane. */
function useIframeAutoHeight(html: string) {
  const ref = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    const iframe = ref.current;
    if (!iframe) return;

    const resize = () => {
      const doc = iframe.contentDocument;
      if (!doc) return;
      const h = Math.max(
        doc.documentElement?.scrollHeight ?? 0,
        doc.body?.scrollHeight ?? 0,
      );
      if (h > 0) iframe.style.height = `${h}px`;
    };

    iframe.addEventListener('load', resize);
    resize();
    const t = window.setTimeout(resize, 120);

    return () => {
      iframe.removeEventListener('load', resize);
      window.clearTimeout(t);
    };
  }, [html]);

  return ref;
}

export default function EmailPreviewFrame({
  subject,
  html,
  loading,
  empty,
  device,
  onDeviceChange,
  onDownloadPdf,
  pdfLoading,
  pdfDisabled,
}: Props) {
  const iframeRef = useIframeAutoHeight(html);

  return (
    <div className="mail-window flex h-full min-h-0 flex-col">
      <div className="shrink-0 border-b border-subtle">
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-neutral-400">
            תצוגה מקדימה
          </span>
          <div className="flex flex-wrap items-center gap-2">
            {onDownloadPdf && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={pdfDisabled || pdfLoading || loading}
                loading={pdfLoading}
                onClick={onDownloadPdf}
              >
                הורדת PDF
              </Button>
            )}
            <div className="seg">
              {DEVICES.map((d) => (
                <button
                  key={d.id}
                  type="button"
                  className="seg-btn !py-1 !px-3 !text-xs"
                  data-active={device === d.id}
                  onClick={() => onDeviceChange(d.id)}
                >
                  {d.label}
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className="border-t border-subtle px-4 py-2.5">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-neutral-400">נושא</div>
          <div className="mt-0.5 truncate text-sm font-semibold text-neutral-900 dark:text-neutral-100">
            {loading ? '…' : subject || '—'}
          </div>
          {onDownloadPdf && !loading && !empty && (
            <p className="mt-1 text-[11px] text-neutral-500">
              לתצוגה מדויקת כמו בנשלח לפונה — הורידו PDF (כולל עמודים מרובים)
            </p>
          )}
        </div>
      </div>

      <div className="mail-canvas relative min-h-0 flex-1 overflow-auto p-4 md:p-7">
        {loading && (
          <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-indigo-500 border-t-transparent" />
          </div>
        )}

        {empty && !loading ? (
          <div className="flex h-full min-h-[260px] items-center justify-center text-center">
            <p className="max-w-[220px] text-sm text-neutral-500">
              התצוגה תתעדכן אוטומטית בזמן העריכה
            </p>
          </div>
        ) : (
          <div
            className="mx-auto transition-[max-width] duration-300"
            style={{
              maxWidth: device === 'mobile' ? 390 : '210mm',
              width: '100%',
            }}
          >
            <iframe
              ref={iframeRef}
              title="תצוגת מייל"
              className="mail-viewport block w-full"
              style={{ minHeight: device === 'mobile' ? 480 : '297mm', border: 0 }}
              sandbox=""
              srcDoc={html}
            />
          </div>
        )}
      </div>
    </div>
  );
}
