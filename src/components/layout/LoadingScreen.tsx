interface LoadingScreenProps {
  message?: string;
}

export default function LoadingScreen({ message = 'טוען…' }: LoadingScreenProps) {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-6 p-8">
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500 via-violet-500 to-fuchsia-500 text-2xl font-bold text-white shadow-elevated">
        פ
      </div>
      <div className="flex items-center gap-1 text-xl">
        <span className="dot-wave">•</span>
        <span className="dot-wave" style={{ animationDelay: '0.15s' }}>•</span>
        <span className="dot-wave" style={{ animationDelay: '0.3s' }}>•</span>
      </div>
      <p className="muted text-sm">{message}</p>
    </div>
  );
}
