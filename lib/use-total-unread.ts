"use client";

import { useState, useEffect, useCallback } from "react";
import { useRealtime } from "@/hooks/use-realtime";

/**
 * Count of conversations with at least one unread inbound message for
 * the current user. Used by the sidebar to surface a badge on the
 * Inbox nav entry when the user is elsewhere in the app.
 */
export function useTotalUnread() {
  const [totalUnread, setTotalUnread] = useState(0);

  const fetchUnreadCount = useCallback(async () => {
    try {
      const res = await fetch("/api/whatsapp/conversations/unread");
      if (res.ok) {
        const { unreadCount } = await res.json();
        setTotalUnread(unreadCount);
      }
    } catch (error) {
      console.error("Failed to fetch unread count:", error);
    }
  }, []);

  useEffect(() => {
    fetchUnreadCount();
  }, [fetchUnreadCount]);

  // Hook into the custom WebSocket architecture
  useRealtime({
    channelName: "unread-badge",
    onConversationEvent: (event) => {
      // Whenever a conversation is updated (e.g. unread count changes), refetch the total
      if (event.eventType === "UPDATE") {
        fetchUnreadCount();
      }
    },
    enabled: true,
  });

  return totalUnread;
}
