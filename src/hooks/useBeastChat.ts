import { useCallback, useEffect, useRef, useState } from 'react';
import { beastApi } from '../utils/beastApi.ts';

export interface ChatConversation {
  username: string;
  displayName: string;
  email?: string | null;
  lastMessage: string;
  lastMessageAt: string | null;
  unreadCount: number;
  isOnline: boolean;
  lastSeen: string | null;
  isFromMe?: boolean;
}

export interface ChatMessage {
  id: number;
  from_username: string;
  to_username: string | null;
  message: string | null;
  file_url?: string | null;
  file_name?: string | null;
  file_type?: string | null;
  created_at: string;
  read?: boolean;
}

interface BeastConversationsResponse {
  conversations?: Array<{
    username: string;
    displayName?: string;
    display_name?: string;
    email?: string | null;
    lastMessage?: string;
    last_message?: string;
    lastMessageAt?: string | null;
    last_message_at?: string | null;
    unreadCount?: number;
    unread_count?: number;
    isOnline?: boolean;
    is_online?: boolean;
    lastSeen?: string | null;
    last_seen?: string | null;
    isFromMe?: boolean;
    is_from_me?: boolean;
  }>;
}

function normalizeConversation(c: NonNullable<BeastConversationsResponse['conversations']>[number]): ChatConversation {
  return {
    username: c.username,
    displayName: c.displayName || c.display_name || c.username,
    email: c.email ?? null,
    lastMessage: c.lastMessage || c.last_message || '',
    lastMessageAt: c.lastMessageAt || c.last_message_at || null,
    unreadCount: c.unreadCount ?? c.unread_count ?? 0,
    isOnline: c.isOnline ?? c.is_online ?? false,
    lastSeen: c.lastSeen || c.last_seen || null,
    isFromMe: c.isFromMe ?? c.is_from_me ?? false,
  };
}

export interface DirectoryUser {
  username: string;
  displayName: string;
  email?: string | null;
  isOnline: boolean;
  lastSeen: string | null;
}

interface BeastUsersResponse {
  users?: Array<{
    username: string;
    displayName?: string;
    display_name?: string;
    email?: string | null;
    is_online?: boolean;
    last_seen?: string | null;
  }>;
}

export interface UseBeastChat {
  conversations: ChatConversation[];
  unreadTotal: number;
  loadingConversations: boolean;
  refresh: () => Promise<void>;
  /** Get messages with a specific user (1-on-1). */
  getMessages: (partner: string) => Promise<ChatMessage[]>;
  /** Send a 1-on-1 message and return the created row. */
  sendMessage: (partner: string, text: string) => Promise<ChatMessage | null>;
  /** Lazily-loaded AD directory (loaded on first call, then cached). */
  loadDirectory: () => Promise<DirectoryUser[]>;
  directory: DirectoryUser[];
  loadingDirectory: boolean;
}

/**
 * Lightweight Beast chat hook — polls conversations every 8s while enabled.
 * `enabled` should be `false` until the user opens the widget; this avoids
 * a constant cross-origin poll for users who never use chat.
 */
export default function useBeastChat(enabled: boolean): UseBeastChat {
  const [conversations, setConversations] = useState<ChatConversation[]>([]);
  const [loadingConversations, setLoadingConversations] = useState(false);
  const [directory, setDirectory] = useState<DirectoryUser[]>([]);
  const [loadingDirectory, setLoadingDirectory] = useState(false);
  const directoryLoadedRef = useRef(false);
  const directoryPromiseRef = useRef<Promise<DirectoryUser[]> | null>(null);
  const lastFetchRef = useRef<number>(0);

  const refresh = useCallback(async () => {
    setLoadingConversations(true);
    try {
      const res = await beastApi().get<BeastConversationsResponse>('/api/chat/conversations');
      const raw = res.data?.conversations || [];
      setConversations(raw.map(normalizeConversation));
      lastFetchRef.current = Date.now();
    } catch (err) {
      // Silently degrade — widget will show an error state.
      console.warn('[chat] conversations fetch failed:', err);
    } finally {
      setLoadingConversations(false);
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    void refresh();
    const interval = setInterval(() => {
      void refresh();
    }, 8000);
    return () => clearInterval(interval);
  }, [enabled, refresh]);

  const getMessages = useCallback(async (partner: string): Promise<ChatMessage[]> => {
    try {
      const res = await beastApi().get<{ messages?: ChatMessage[] }>(
        `/api/chat/messages/${encodeURIComponent(partner)}`,
      );
      return res.data?.messages || [];
    } catch (err) {
      console.warn('[chat] messages fetch failed:', err);
      return [];
    }
  }, []);

  const sendMessage = useCallback(async (partner: string, text: string): Promise<ChatMessage | null> => {
    try {
      const res = await beastApi().post<{ message?: ChatMessage }>('/api/chat/messages', {
        to_username: partner,
        message: text,
      });
      return res.data?.message || null;
    } catch (err) {
      console.warn('[chat] send failed:', err);
      return null;
    }
  }, []);

  const loadDirectory = useCallback(async (): Promise<DirectoryUser[]> => {
    if (directoryLoadedRef.current) return directory;
    if (directoryPromiseRef.current) return directoryPromiseRef.current;
    setLoadingDirectory(true);
    const promise = (async () => {
      try {
        const res = await beastApi().get<BeastUsersResponse>('/api/chat/users');
        const list: DirectoryUser[] = (res.data?.users || []).map((u) => ({
          username: u.username,
          displayName: u.displayName || u.display_name || u.username,
          email: u.email ?? null,
          isOnline: u.is_online ?? false,
          lastSeen: u.last_seen ?? null,
        }));
        setDirectory(list);
        directoryLoadedRef.current = true;
        return list;
      } catch (err) {
        console.warn('[chat] directory fetch failed:', err);
        return [];
      } finally {
        setLoadingDirectory(false);
        directoryPromiseRef.current = null;
      }
    })();
    directoryPromiseRef.current = promise;
    return promise;
  }, [directory]);

  const unreadTotal = conversations.reduce((sum, c) => sum + (c.unreadCount || 0), 0);

  return {
    conversations,
    unreadTotal,
    loadingConversations,
    refresh,
    getMessages,
    sendMessage,
    loadDirectory,
    directory,
    loadingDirectory,
  };
}
