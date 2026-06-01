import { useEffect, useState } from 'react';
import api from '../utils/api.ts';

export interface Capabilities {
  isAdmin: boolean;
  isNavigator: boolean;
  isManager: boolean;
  isKeva: boolean;
  groups: string[];
  manageableGroups: string[];
  email: string;
  displayName: string;
  username: string;
  canRoute: boolean;
  canViewAll: boolean;
  canWriteTeamResponse: boolean;
  canWriteManagerResponse: boolean;
  canManageEmail: boolean;
}

let cache: { value: Capabilities | null; promise: Promise<Capabilities | null> | null } = {
  value: null,
  promise: null,
};

function fetchOnce(): Promise<Capabilities | null> {
  if (cache.value) return Promise.resolve(cache.value);
  if (cache.promise) return cache.promise;
  cache.promise = api
    .get('/api/inquiries/capabilities')
    .then((res) => {
      cache.value = res.data?.capabilities ?? null;
      return cache.value;
    })
    .catch(() => null)
    .finally(() => {
      cache.promise = null;
    });
  return cache.promise;
}

export function invalidateCapabilities(): void {
  cache = { value: null, promise: null };
}

export default function useCapabilities() {
  const [capabilities, setCapabilities] = useState<Capabilities | null>(cache.value);
  const [loading, setLoading] = useState(!cache.value);

  useEffect(() => {
    let cancelled = false;
    setLoading(!cache.value);
    fetchOnce().then((c) => {
      if (!cancelled) {
        setCapabilities(c);
        setLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return { capabilities, loading };
}
