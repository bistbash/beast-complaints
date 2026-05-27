import { Link } from 'react-router-dom';
import Button from '../ui/Button.tsx';

interface ErrorShellProps {
  title: string;
  description?: string;
  actionLabel?: string;
  actionTo?: string;
  onAction?: () => void;
}

export default function ErrorShell({ title, description, actionLabel, actionTo, onAction }: ErrorShellProps) {
  return (
    <div className="flex min-h-[60vh] items-center justify-center p-6">
      <div className="card max-w-md text-center">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-rose-100 text-rose-600 dark:bg-rose-950/40 dark:text-rose-300">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"
              stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
        <h2 className="text-lg font-semibold">{title}</h2>
        {description && <p className="muted mt-2 text-sm leading-relaxed">{description}</p>}
        {(actionLabel && (actionTo || onAction)) && (
          <div className="mt-5 flex justify-center">
            {actionTo ? (
              <Link to={actionTo}>
                <Button variant="primary">{actionLabel}</Button>
              </Link>
            ) : (
              <Button variant="primary" onClick={onAction}>
                {actionLabel}
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
