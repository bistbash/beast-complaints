import BrandMark from './BrandMark.tsx';

interface LoadingScreenProps {
  message?: string;
}

export default function LoadingScreen({ message = 'טוען…' }: LoadingScreenProps) {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-6 p-8">
      <BrandMark size={64} />
      <div className="flex items-center gap-1 text-xl">
        <span className="dot-wave">•</span>
        <span className="dot-wave" style={{ animationDelay: '0.15s' }}>•</span>
        <span className="dot-wave" style={{ animationDelay: '0.3s' }}>•</span>
      </div>
      <p className="muted text-sm">{message}</p>
    </div>
  );
}
