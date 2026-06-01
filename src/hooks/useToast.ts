import { useCallback, useEffect, useRef, useState } from 'react';

export interface ToastState {
  id: number;
  tone: 'ok' | 'err';
  text: string;
}

export type Notify = (tone: 'ok' | 'err', text: string) => void;

/** Single floating toast with auto-dismiss. */
export function useToast(timeoutMs = 3800) {
  const [toast, setToast] = useState<ToastState | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clear = () => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  };

  const dismiss = useCallback(() => {
    clear();
    setToast(null);
  }, []);

  const notify = useCallback<Notify>(
    (tone, text) => {
      if (!text) return;
      clear();
      setToast({ id: Date.now(), tone, text });
      timer.current = setTimeout(() => setToast(null), timeoutMs);
    },
    [timeoutMs],
  );

  useEffect(() => clear, []);

  return { toast, notify, dismiss };
}
