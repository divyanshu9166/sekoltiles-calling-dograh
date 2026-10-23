"use client";

/**
 * hooks/use-realtime.ts
 *
 * Real-time hook — WebSocket edition.
 *
 * Replaces the legacy Supabase Realtime (postgres_changes) implementation
 * with a socket.io client that connects to the ws-server gateway.
 *
 * Flow:
 *   1. On mount, fetch a short-lived JWT from /api/auth/ws-token.
 *   2. Open a socket.io connection to NEXT_PUBLIC_WS_URL, passing the JWT
 *      in the `auth` handshake so the server can verify identity before
 *      accepting the connection.
 *   3. Listen for `new_message`, `conversation_update`, and
 *      `message_status` events and forward them to the parent via the
 *      existing callback props — zero changes needed in InboxTab or
 *      MessageThread.
 *   4. On unmount (or when `enabled` flips false) disconnect cleanly.
 *
 * Fallback behaviour:
 *   If NEXT_PUBLIC_WS_URL is not configured (e.g. local dev without
 *   docker), the hook silently skips the connection and returns
 *   isConnected=false. MessageThread's polling interval already handles
 *   this case gracefully.
 */

import { useEffect, useRef, useCallback, useState } from "react";
import { io, type Socket } from "socket.io-client";
import type { Message, Conversation } from "@/types";

// ── Event shapes ────────────────────────────────────────────────────────────

interface RealtimeEvent<T> {
  eventType: "INSERT" | "UPDATE" | "DELETE";
  new: T;
  old: Partial<T>;
}

// ── Hook options (unchanged from the Supabase edition) ─────────────────────

interface UseRealtimeOptions {
  channelName: string;
  onMessageEvent?: (event: RealtimeEvent<Message>) => void;
  onConversationEvent?: (event: RealtimeEvent<Conversation>) => void;
  enabled?: boolean;
}

// ── WS URL ─────────────────────────────────────────────────────────────────

const WS_URL = process.env.NEXT_PUBLIC_WS_URL ?? "";

// ── Hook ───────────────────────────────────────────────────────────────────

export function useRealtime({
  onMessageEvent,
  onConversationEvent,
  enabled = true,
}: UseRealtimeOptions) {
  const socketRef = useRef<Socket | null>(null);
  const [isConnected, setIsConnected] = useState(false);

  // Keep latest callbacks in refs so the socket listener closure doesn't
  // go stale when parent re-renders change the callback references.
  const onMessageRef = useRef(onMessageEvent);
  const onConversationRef = useRef(onConversationEvent);
  useEffect(() => {
    onMessageRef.current = onMessageEvent;
    onConversationRef.current = onConversationEvent;
  });

  useEffect(() => {
    if (!enabled || !WS_URL) {
      if (!WS_URL) {
        console.info(
          "[use-realtime] NEXT_PUBLIC_WS_URL not set — real-time disabled"
        );
      }
      return;
    }

    let cancelled = false;

    async function connect() {
      // 1. Obtain a short-lived JWT from our own backend.
      let token: string;
      try {
        const res = await fetch("/api/auth/ws-token", { cache: "no-store" });
        if (!res.ok) {
          console.warn("[use-realtime] could not obtain ws-token:", res.status);
          return;
        }
        const body = await res.json();
        token = body.token as string;
      } catch (err) {
        console.warn("[use-realtime] ws-token fetch failed:", err);
        return;
      }

      if (cancelled) return;

      // 2. Open socket with the JWT in the handshake.
      // `auth` is a callback (not a static object) so socket.io re-calls it
      // on every reconnect attempt — this means a fresh token is fetched
      // automatically, preventing auth failures when the 1h JWT expires.
      const socket = io(WS_URL, {
        auth: async (cb: (data: Record<string, unknown>) => void) => {
          let freshToken = token; // use the already-fetched token on first connect
          try {
            const res = await fetch("/api/auth/ws-token", { cache: "no-store" });
            if (res.ok) {
              const body = await res.json();
              freshToken = body.token as string;
            }
          } catch {
            // keep using the current token if refresh fails
          }
          cb({ token: freshToken });
        },
        transports: ["websocket", "polling"],
        reconnection: true,
        reconnectionDelay: 1_000,
        reconnectionDelayMax: 30_000,
        reconnectionAttempts: Infinity,
      });

      socketRef.current = socket;

      socket.on("connect", () => {
        setIsConnected(true);
        console.log("[use-realtime] connected, socket:", socket.id);
      });

      socket.on("disconnect", (reason) => {
        setIsConnected(false);
        console.log("[use-realtime] disconnected:", reason);
      });

      socket.on("connect_error", (err) => {
        console.warn("[use-realtime] connection error:", err.message);
      });

      // ── new_message ─────────────────────────────────────────────────────
      // Fired by the ws-server when the webhook saves a new inbound message.
      // We map it to the existing INSERT RealtimeEvent shape so InboxTab
      // doesn't need to change.
      socket.on("new_message", (data: { message: Message } & Record<string, unknown>) => {
        const msg = data.message;
        if (!msg) return;

        onMessageRef.current?.({
          eventType: "INSERT",
          new: msg,
          old: {},
        });
      });

      // ── conversation_update ─────────────────────────────────────────────
      // Fired when last_message_text / unread_count change on the
      // conversation after an inbound message.
      socket.on(
        "conversation_update",
        (data: Partial<Conversation> & { conversationId?: string }) => {
          if (!data.conversationId) return;

          onConversationRef.current?.({
            eventType: "UPDATE",
            new: {
              id: data.conversationId,
              ...data,
            } as Conversation,
            old: {},
          });
        }
      );

      // ── message_status ──────────────────────────────────────────────────
      // Fired when Meta delivers a status update (sent → delivered → read).
      // Maps to an UPDATE on the message so the tick icons refresh.
      socket.on(
        "new_conversation",
        (data: { conversation?: Conversation } & Partial<Conversation>) => {
          const conversation = data.conversation ?? data;
          if (!conversation?.id) return;

          onConversationRef.current?.({
            eventType: "INSERT",
            new: conversation as Conversation,
            old: {},
          });
        }
      );

      socket.on(
        "message_status",
        (data: { messageId?: string; status?: string; conversationId?: string }) => {
          if (!data.messageId) return;

          onMessageRef.current?.({
            eventType: "UPDATE",
            new: {
              id: data.messageId,
              status: data.status,
            } as Message,
            old: {},
          });
        }
      );
    }

    connect();

    return () => {
      cancelled = true;
      if (socketRef.current) {
        socketRef.current.disconnect();
        socketRef.current = null;
        setIsConnected(false);
      }
    };
  }, [enabled]); // Only re-run when `enabled` changes

  const unsubscribe = useCallback(() => {
    if (socketRef.current) {
      socketRef.current.disconnect();
      socketRef.current = null;
      setIsConnected(false);
    }
  }, []);

  return { isConnected, unsubscribe };
}
