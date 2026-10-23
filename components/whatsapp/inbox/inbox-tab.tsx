"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { Conversation, Message, Contact, ConversationStatus } from "@/types";
import { useRealtime } from "@/hooks/use-realtime";
import { ConversationList } from "@/components/whatsapp/inbox/conversation-list";
import { MessageThread } from "@/components/whatsapp/inbox/message-thread";
import { ContactSidebar } from "@/components/whatsapp/inbox/contact-sidebar";
import { WifiOff } from "lucide-react";
import { cn } from "@/lib/utils";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { mergeInboxMessages, mergeMessage } from "@/lib/whatsapp/inbox-state";

export function InboxTab() {
  const router = useRouter();
  const searchParams = useSearchParams();
  /**
   * `?c=<id>` deep-link support. Used when landing here from the
   * dashboard's recent-conversations list so the right thread opens
   * automatically instead of showing the empty center panel.
   */
  const deepLinkConvId = searchParams.get("c");

  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConversation, setActiveConversation] =
    useState<Conversation | null>(null);
  const [activeContact, setActiveContact] = useState<Contact | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [contactOpen, setContactOpen] = useState(false);
  const [whatsappConnected, setWhatsappConnected] = useState<boolean | null>(
    null
  );

  // Fire the deep-link auto-select exactly once per URL — subsequent
  // list refreshes (realtime, manual refetch) must not snap the user
  // back to the deep-linked conversation if they've already clicked
  // elsewhere.
  const autoSelectedForDeepLinkRef = useRef<string | null>(null);
  const activeConversationIdRef = useRef<string | null>(null);
  const seenInserts = useRef(new Set<string>());

  useEffect(() => {
    fetch('/api/whatsapp/config', { cache: 'no-store' })
      .then((r) => r.json())
      .then((data) => setWhatsappConnected(data?.connected === true))
      .catch(() => setWhatsappConnected(false));
  }, []);

  // ── Realtime event handlers ────────────────────────────────────────────

  const handleMessageEvent = useCallback(
    (event: { eventType: string; new: Message; old: Partial<Message> }) => {
      const newMsg = event.new;
      if (!newMsg) return;

      if (event.eventType === "INSERT") {
        if (seenInserts.current.has(newMsg.id)) return;
        seenInserts.current.add(newMsg.id);
        // Bound the replay cache for long-running sessions.
        if (seenInserts.current.size > 2000) seenInserts.current.delete(seenInserts.current.values().next().value!);
        // Add to messages if it belongs to the currently active conversation
        if (newMsg.conversation_id === activeConversationIdRef.current) {
          setMessages((prev) => {
            return newMsg.conversation_id === activeConversationIdRef.current ? mergeInboxMessages(prev, [newMsg], newMsg.conversation_id) : prev;
          });
        }

        // Always update the conversation list preview for any conversation
        setConversations((prev) =>
          prev.map((c) =>
            c.id === newMsg.conversation_id
              ? {
                  ...c,
                  last_message_text: Date.parse(newMsg.created_at) >= (Date.parse(c.last_message_at ?? '') || 0) ? newMsg.content_text ?? "" : c.last_message_text,
                  last_message_at: Date.parse(newMsg.created_at) >= (Date.parse(c.last_message_at ?? '') || 0) ? newMsg.created_at : c.last_message_at,
                  unread_count:
                    activeConversationIdRef.current === newMsg.conversation_id
                      ? 0
                      : newMsg.sender_type === 'customer' ? (c.unread_count ?? 0) + 1 : c.unread_count,
                }
              : c
          )
        );
      }

      if (event.eventType === "UPDATE") {
        setMessages((prev) =>
          prev.map((m) => (m.id === newMsg.id ? mergeMessage(m, newMsg) : m))
        );
      }
    },
    []
  );

  const handleConversationEvent = useCallback(
    (event: { eventType: string; new: Conversation; old: Partial<Conversation> }) => {
      const conv = event.new;
      if (!conv) return;

      if (event.eventType === "INSERT") {
        setConversations((prev) => {
          if (prev.some((c) => c.id === conv.id)) return prev;
          return [conv, ...prev];
        });
      }

      if (event.eventType === "UPDATE") {
        setConversations((prev) =>
          prev.map((c) => (c.id === conv.id ? { ...c, ...conv } : c))
        );
        if (conv.id === activeConversationIdRef.current) {
          setActiveConversation((prev) => (prev?.id === conv.id ? { ...prev, ...conv } : prev));
        }
      }
    },
    []
  );

  // Wire up the WebSocket gateway
  useRealtime({
    channelName: "inbox-realtime",
    onMessageEvent: handleMessageEvent,
    onConversationEvent: handleConversationEvent,
    enabled: true,
  });

  const handleConversationsLoaded = useCallback(
    (loaded: Conversation[]) => {
      setConversations(loaded);
      const active = loaded.find(c => c.id === activeConversationIdRef.current);
      if (active) { setActiveConversation(active); setActiveContact(active.contact ?? null); }
      if (
        deepLinkConvId &&
        autoSelectedForDeepLinkRef.current !== deepLinkConvId &&
        loaded.length > 0
      ) {
        if (activeConversation?.id === deepLinkConvId) return;
        const match = loaded.find((c) => c.id === deepLinkConvId);
        if (match) {
          autoSelectedForDeepLinkRef.current = deepLinkConvId;
          activeConversationIdRef.current = match.id;
          setActiveConversation(match);
          setActiveContact(match.contact ?? null);
          setMessages([]);
        }
      }
    },
    [deepLinkConvId, activeConversation?.id]
  );

  const handleSelectConversation = useCallback(
    (conv: Conversation) => {
      if (activeConversation?.id === conv.id) return;
      setActiveConversation(conv);
      setContactOpen(false);
      activeConversationIdRef.current = conv.id;
      setActiveContact(conv.contact ?? null);
      setMessages([]);
      autoSelectedForDeepLinkRef.current = conv.id;
      router.replace(`/whatsapp-marketing?tab=inbox&c=${conv.id}`, { scroll: false });
    },
    [activeConversation?.id, router]
  );

  const handleCloseConversation = useCallback(() => {
    setActiveConversation(null);
    setContactOpen(false);
    activeConversationIdRef.current = null;
    setActiveContact(null);
    setMessages([]);
    autoSelectedForDeepLinkRef.current = null;
    router.replace("/whatsapp-marketing?tab=inbox", { scroll: false });
  }, [router]);

  const handleMessagesLoaded = useCallback((loaded: Message[], conversationId: string) => {
    if (activeConversationIdRef.current !== conversationId) return;
    setMessages(prev => mergeInboxMessages(prev, loaded, conversationId));
  }, []);

  const handleNewMessage = useCallback((msg: Message) => {
    if (activeConversationIdRef.current !== msg.conversation_id) return;
    setMessages((prev) => {
      return mergeInboxMessages(prev, [msg], msg.conversation_id);
    });
  }, []);

  const handleUpdateMessage = useCallback(
    (id: string, updates: Partial<Message>) => {
      setMessages(prev => {
        const original = prev.find(m => m.id === id);
        if (!original || original.conversation_id !== activeConversationIdRef.current) return prev;
        return mergeInboxMessages(prev, [mergeMessage(original, updates)], original.conversation_id, id);
      });
    },
    []
  );

  const handleStatusChange = useCallback(
    (conversationId: string, status: ConversationStatus) => {
      setConversations((prev) =>
        prev.map((c) => (c.id === conversationId ? { ...c, status } : c))
      );
      if (activeConversationIdRef.current === conversationId) {
        setActiveConversation((prev) => (prev?.id === conversationId ? { ...prev, status } : prev));
      }
    },
    []
  );

  const handleAssignChange = useCallback(
    (conversationId: string, assignedAgentId: string | null) => {
      setConversations((prev) =>
        prev.map((c) =>
          c.id === conversationId
            ? { ...c, assigned_agent_id: assignedAgentId ?? undefined }
            : c
        )
      );
      if (activeConversationIdRef.current === conversationId) {
        setActiveConversation((prev) =>
          prev?.id === conversationId
            ? { ...prev, assigned_agent_id: assignedAgentId ?? undefined }
            : prev
        );
      }
    },
    []
  );

  const handleNeedsHumanChange = useCallback(
    (conversationId: string, needsHuman: boolean) => {
      setConversations((prev) =>
        prev.map((c) =>
          c.id === conversationId ? { ...c, needs_human: needsHuman } : c
        )
      );
      if (activeConversationIdRef.current === conversationId) {
        setActiveConversation((prev) =>
          prev?.id === conversationId ? { ...prev, needs_human: needsHuman } : prev
        );
      }
    },
    []
  );

  const hasActiveConv = !!activeConversation;

  return (
    <div className="wa-inbox relative flex h-full min-h-0 flex-col overflow-hidden">
      {/* WhatsApp connection banner */}
      {whatsappConnected === false && (
        <div className="flex shrink-0 items-center justify-center gap-2 border-b border-amber-500/20 bg-amber-500/10 px-4 py-2">
          <WifiOff className="h-4 w-4 text-amber-400" />
          <p className="text-xs text-amber-400">
            WhatsApp® is not connected. Go to Settings to connect your account.
          </p>
        </div>
      )}

      <div className="flex min-h-0 flex-1 overflow-hidden">
        {/* Left panel: Conversation list */}
        <div
          className={cn(
            "h-full min-h-0 min-w-0 flex-col",
            "w-full lg:w-[320px] lg:flex-none",
            hasActiveConv ? "hidden lg:flex" : "flex",
          )}
        >
          <ConversationList
            activeConversationId={activeConversation?.id ?? null}
            onSelect={handleSelectConversation}
            conversations={conversations}
            onConversationsLoaded={handleConversationsLoaded}
          />
        </div>

        {/* Center panel: Message thread */}
        <div
          className={cn(
            "h-full min-h-0 min-w-0 flex-1 flex-col",
            hasActiveConv ? "flex" : "hidden lg:flex",
          )}
        >
          <MessageThread
            conversation={activeConversation}
            contact={activeContact}
            messages={messages}
            onMessagesLoaded={handleMessagesLoaded}
            onNewMessage={handleNewMessage}
            onUpdateMessage={handleUpdateMessage}
            onStatusChange={handleStatusChange}
            onNeedsHumanChange={handleNeedsHumanChange}
            onAssignChange={handleAssignChange}
            onBack={handleCloseConversation}
            onShowContact={() => setContactOpen(true)}
          />
        </div>

        {/* Right panel: Contact sidebar — desktop only */}
        <div className="hidden h-full min-h-0 flex-col shrink-0 2xl:flex">
          <ContactSidebar contact={activeContact} />
        </div>
      </div>
      <Sheet open={contactOpen && !!activeContact} onOpenChange={setContactOpen}>
        <SheetContent side="right" className="wa-contact-drawer wa-inbox-menu min-h-0 gap-0 border-border bg-surface text-foreground data-[side=right]:w-full sm:max-w-80">
          <SheetHeader className="shrink-0 border-b border-border pr-14"><SheetTitle>Contact details</SheetTitle><SheetDescription className="sr-only">Contact information, tags, deals and notes for the selected conversation.</SheetDescription></SheetHeader>
          <div className="wa-contact-body flex min-h-0 flex-1">{activeContact && <ContactSidebar key={activeContact.id} contact={activeContact} />}</div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
