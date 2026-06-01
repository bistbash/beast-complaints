export type PreviewDevice = 'desktop' | 'mobile';

interface Props {
  subject: string;
  html: string;
  loading?: boolean;
  empty?: boolean;
  device: PreviewDevice;
  onDeviceChange: (d: PreviewDevice) => void;
}

const DEVICES: { id: PreviewDevice; label: string }[] = [
  { id: 'desktop', label: 'מחשב' },
  { id: 'mobile', label: 'נייד' },
];

export default function EmailPreviewFrame({
  subject,
  html,
  loading,
  empty,
  device,
  onDeviceChange,
}: Props) {
  return (
    <div className="mail-window flex h-full min-h-0 flex-col">
      <div className="shrink-0 border-b border-subtle">
        <div className="flex items-center justify-between gap-3 px-4 py-2.5">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-neutral-400">
            תצוגה מקדימה
          </span>
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
        <div className="border-t border-subtle px-4 py-2.5">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-neutral-400">נושא</div>
          <div className="mt-0.5 truncate text-sm font-semibold text-neutral-900 dark:text-neutral-100">
            {loading ? '…' : subject || '—'}
          </div>
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
            className="mx-auto h-full overflow-hidden rounded-xl bg-white shadow-lg ring-1 ring-black/5 transition-[max-width] duration-300"
            style={{ maxWidth: device === 'mobile' ? 390 : '100%' }}
          >
            <iframe
              title="תצוגת מייל"
              className="mail-viewport min-h-[320px]"
              sandbox=""
              srcDoc={html}
            />
          </div>
        )}
      </div>
    </div>
  );
}
