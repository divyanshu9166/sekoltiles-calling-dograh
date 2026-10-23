"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useAuth } from "@/hooks/use-auth";
import { cn } from "@/lib/utils";
import type {
  Conversation,
  Message,
  MessageReaction,
  Contact,
  ConversationStatus,
  MessageTemplate,
  Profile,
} from "@/types";
import {
  MessageSquare,
  ChevronDown,
  UserPlus,
  Check,
  Clock,
  ArrowLeft,
  Bot,
  User,
  Info, RefreshCw,
} from "lucide-react";
import { format, isToday, isYesterday, isValid } from "date-fns";
import { customerSession, mergeInboxMessages, templatePickerProblem } from "@/lib/whatsapp/inbox-state";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { MessageBubble } from "./message-bubble";
import { MessageActions } from "./message-actions";
import { MessageComposer } from "./message-composer";
import { TemplatePicker } from "./template-picker";
import { buildReplyPreview } from "./reply-quote";
import { toast } from "sonner";

interface ReplyDraft {
  id: string;
  authorLabel: string;
  preview: string;
}

async function fetchJson<T>(input: RequestInfo, init?: RequestInit): Promise<T> {
  const res = await fetch(input, init);
  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    const reason = (data as { error?: string })?.error ?? `HTTP ${res.status}`;
    throw new Error(reason);
  }

  return data as T;
}

function renderTemplateBody(body: string, params: string[]): string {
  return body.replace(/\{\{\s*(\d+)\s*\}\}/g, (_, raw) => {
    const idx = Number(raw) - 1;
    return params[idx] ?? `{{${raw}}}`;
  });
}

interface MessageThreadProps {
  conversation: Conversation | null;
  contact: Contact | null;
  messages: Message[];
  onMessagesLoaded: (messages: Message[], conversationId: string) => void;
  onNewMessage: (message: Message) => void;
  onUpdateMessage: (id: string, updates: Partial<Message>) => void;
  onStatusChange: (conversationId: string, status: ConversationStatus) => void;
  onNeedsHumanChange?: (conversationId: string, needsHuman: boolean) => void;
  onAssignChange: (
    conversationId: string,
    assignedAgentId: string | null,
  ) => void;
  /**
   * On mobile, the thread is shown full-screen with the conversation list
   * hidden. This callback lets the page deselect the active conversation
   * and reveal the list again. Rendered as a back-arrow in the header on
   * mobile only.
   */
  onBack?: () => void;
  onShowContact?: () => void;
}

function formatDateSeparator(dateStr: string): string {
  const date = new Date(dateStr);
  if (!isValid(date)) return 'Date unavailable';
  if (isToday(date)) return "Today";
  if (isYesterday(date)) return "Yesterday";
  return format(date, "MMMM d, yyyy");
}

function groupMessagesByDate(messages: Message[]) {
  const groups: { date: string; messages: Message[] }[] = [];
  let currentDate = "";

  for (const msg of messages) {
    const date = new Date(msg.created_at);
    const day = isValid(date) ? format(date, "yyyy-MM-dd") : 'unknown';
    if (day !== currentDate) {
      currentDate = day;
      groups.push({ date: msg.created_at, messages: [msg] });
    } else {
      groups[groups.length - 1].messages.push(msg);
    }
  }

  return groups;
}

const STATUS_OPTIONS: { label: string; value: ConversationStatus; color: string }[] = [
  { label: "Open", value: "open", color: "text-accent" },
  { label: "Pending", value: "pending", color: "text-amber-400" },
  { label: "Closed", value: "closed", color: "text-muted" },
];

export function MessageThread({
  conversation,
  contact,
  messages,
  onMessagesLoaded,
  onNewMessage,
  onUpdateMessage,
  onStatusChange,
  onNeedsHumanChange,
  onAssignChange,
  onBack,
  onShowContact,
}: MessageThreadProps) {
  const { user } = useAuth();
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [reloadToken, setReloadToken] = useState(0);
  const [now, setNow] = useState(Date.now);
  const [atBottom, setAtBottom] = useState(true);
  const followBottomRef = useRef(true);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [templateModalOpen, setTemplateModalOpen] = useState(false);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [reactions, setReactions] = useState<MessageReaction[]>([]);
  const [replyTo, setReplyTo] = useState<ReplyDraft | null>(null);
  const messagesRef = useRef<Message[]>(messages);
  const reactionsRef = useRef<MessageReaction[]>(reactions);
  const activeIdRef = useRef(conversation?.id);
  const pendingReactions = useRef(new Set<string>());
  const refreshReactionsRef = useRef<(() => Promise<void>) | null>(null);
  const headerInFlight = useRef(false);
  const [headerBusy, setHeaderBusy] = useState(false);
  useEffect(() => {
    activeIdRef.current = conversation?.id;
    return () => { activeIdRef.current = undefined; };
  }, [conversation?.id]);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    reactionsRef.current = reactions;
  }, [reactions]);

  // Profiles are bounded by RLS to rows the current user is allowed to
  // see — today that's just the current user, but the dropdown keeps the
  // shape ready for shared-team workspaces without a refactor.
  useEffect(() => {
    let cancelled = false;

    fetchJson<{ data: Profile[] }>("/api/whatsapp/profiles", {
      cache: "no-store",
    })
      .then((body) => {
        if (cancelled) return;
        setProfiles(body.data ?? []);
      })
      .catch((error) => {
        if (cancelled) return;
        console.error("Failed to fetch profiles:", error);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);
  const sessionInfo = useMemo(() => customerSession(messages, now), [messages, now]);

  // Store latest callback in a ref so fetchMessages doesn't need to
  // depend on `onMessagesLoaded` — otherwise parent re-renders cause
  // fetchMessages to change → useEffect re-fires → refetch → realtime
  // UPDATE on conversations.unread_count → parent re-renders → LOOP.
  // The ref is written inside an effect so the mutation doesn't happen
  // during render (React 19 refs rule); consumers only read `.current`
  // inside the async fetch completion, which runs after the render.
  const onMessagesLoadedRef = useRef(onMessagesLoaded);
  useEffect(() => {
    onMessagesLoadedRef.current = onMessagesLoaded;
  });

  const conversationId = conversation?.id;
  const hasUnread = (conversation?.unread_count ?? 0) > 0;

  // Fetch messages whenever the selected conversation changes. Kept
  // separate from the unread-reset effect so that incoming messages
  // arriving while the thread is open don't trigger a full refetch —
  // they only flip hasUnread, which only the reset effect listens to.
  useEffect(() => {
    if (!conversationId) return;
    let cancelled = false;
    let initial = true;
    let inFlight = false;
    followBottomRef.current = true;

    const finishInitial = () => {
      if (!initial) return;
      setLoading(false);
      initial = false;
    };

    const mergeMessages = (serverMessages: Message[]) => {
      return mergeInboxMessages(messagesRef.current, serverMessages, conversationId);
    };

    const fetchMessages = async () => {
      if (inFlight || cancelled) return;
      inFlight = true;
      if (initial) setLoading(true);

      try {
        const body = await fetchJson<{ data: Message[] }>(
          `/api/whatsapp/messages?conversation_id=${conversationId}`,
          { cache: "no-store" }
        );
        if (cancelled) return;
        setLoadError('');
        onMessagesLoadedRef.current(mergeMessages(body.data ?? []), conversationId);
      } catch (error) {
        if (cancelled) return;
        console.error("Failed to fetch messages:", error);
        setLoadError('Unable to refresh this chat. Your messages are preserved.');
      } finally {
        inFlight = false;
        if (cancelled) return;
        finishInitial();
      }
    };

    fetchMessages();
    // Keep the active thread current even when the socket is unavailable.
    const timer = window.setInterval(fetchMessages, 15_000);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [conversationId, reloadToken]);

  useEffect(() => {
    if (!conversationId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setReactions([]);
      return;
    }
    let cancelled = false;
    let inFlight = false;

    const mergeReactions = (serverReactions: MessageReaction[]) => {
      const pending = pendingReactions.current;
      const localReactions = reactionsRef.current.filter((reaction) =>
        reaction.conversation_id === conversationId && pending.has(reaction.message_id)
      );
      return [
        ...serverReactions.filter(reaction => reaction.conversation_id === conversationId && !pending.has(reaction.message_id)),
        ...localReactions,
      ];
    };

    const fetchReactions = async () => {
      if (cancelled || inFlight) return;
      inFlight = true;
      try {
        const body = await fetchJson<{ data: MessageReaction[] }>(
          `/api/whatsapp/reactions?conversation_id=${conversationId}`,
          { cache: "no-store" }
        );

        if (cancelled) return;
        setReactions(mergeReactions(body.data ?? []));
      } catch (error) {
        if (cancelled) return;
        console.error("Failed to fetch reactions:", error);
      } finally { inFlight = false; }
    };

    refreshReactionsRef.current = fetchReactions;
    fetchReactions();
    const timer = window.setInterval(fetchReactions, 15_000);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
      refreshReactionsRef.current = null;
    };
  }, [conversationId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setReplyTo(null);
    setTemplateModalOpen(false);
    setReactions([]);
  }, [conversationId]);

  // Reset the server-side unread_count to 0 whenever an unread count
  // surfaces on the active conversation — covers both (a) opening a
  // conversation that had unread messages and (b) new messages arriving
  // while the user is already viewing the thread (webhook server-bumps
  // unread_count to N+1; the realtime UPDATE propagates it into the
  // client, which re-runs this effect and flips it back to 0).
  //
  // Guarding on hasUnread prevents the eq-update loop: once unread_count
  // is 0 the condition is false, so no further UPDATE is issued.
  useEffect(() => {
    if (!conversationId || !hasUnread) return;
    fetchJson(`/api/whatsapp/conversations/${conversationId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ unread_count: 0 }),
    }).catch((error) => {
      console.error("Failed to reset unread_count:", error);
    });
  }, [conversationId, hasUnread]);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    if (scrollRef.current && followBottomRef.current) {
      const el = scrollRef.current;
      el.scrollTop = el.scrollHeight;
    }
  }, [messages, loading]);

  const handleSend = useCallback(
    async (text: string, replyToId?: string) => {
      if (!conversation || customerSession(messagesRef.current).expired) return false;

      const tempId = `temp-${crypto.randomUUID()}`;

      // Optimistic update — shows the message immediately with "sending" status
      const optimisticMsg: Message = {
        id: tempId,
        conversation_id: conversation.id,
        sender_type: "agent",
        content_type: "text",
        content_text: text,
        status: "sending",
        created_at: new Date().toISOString(),
        reply_to_message_id: replyToId,
      };
      onNewMessage(optimisticMsg);

      try {
        const res = await fetch("/api/whatsapp/send", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            conversation_id: conversation.id,
            message_type: "text",
            content_text: text,
            reply_to_message_id: replyToId,
          }),
        });

        const payload = await res.json().catch(() => ({}));

        if (!res.ok) {
          const reason = payload?.error || `HTTP ${res.status}`;
          console.error("Failed to send message:", reason);
          toast.error(`Failed to send: ${reason}`);
          // Mark the optimistic bubble as failed so the user sees what happened
          onUpdateMessage(tempId, { status: "failed" });
          return false;
        }

        const nextId = payload?.message_id as string | undefined;
        const metaId = payload?.whatsapp_message_id as string | undefined;

        if (nextId) {
          onUpdateMessage(tempId, {
            id: nextId,
            message_id: metaId,
            status: "sent",
          });
        } else {
          // Flip status so the UI stops showing "sending".
          onUpdateMessage(tempId, { status: "sent" });
        }
        if (activeIdRef.current === conversation.id) setReplyTo(null);
        return true;
      } catch (err) {
        console.error("Failed to send message:", err);
        const reason = err instanceof Error ? err.message : "network error";
        toast.error(`Failed to send: ${reason}`);
        onUpdateMessage(tempId, { status: "failed" });
        return false;
      }
    },
    [conversation, onNewMessage, onUpdateMessage]
  );

  const handleStatusChange = useCallback(
    async (status: ConversationStatus) => {
      if (!conversation || headerInFlight.current) return;
      headerInFlight.current = true;
      setHeaderBusy(true);

      try {
        await fetchJson(`/api/whatsapp/conversations/${conversation.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status }),
        });

        onStatusChange(conversation.id, status);
      } catch (error) {
        console.error("Failed to update status:", error);
        toast.error("Failed to update status");
      } finally { headerInFlight.current = false; setHeaderBusy(false); }
    },
    [conversation, onStatusChange]
  );

  const handleNeedsHumanToggle = useCallback(
    async () => {
      if (!conversation || headerInFlight.current) return;
      headerInFlight.current = true;
      setHeaderBusy(true);
      const newNeedsHuman = !conversation.needs_human;

      try {
        await fetchJson(`/api/whatsapp/conversations/${conversation.id}/human-takeover`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ needs_human: newNeedsHuman }),
        });

        onNeedsHumanChange?.(conversation.id, newNeedsHuman);
        
        toast.success(newNeedsHuman ? "AI paused — Human Takeover" : "AI Auto-reply resumed");
      } catch (error) {
        console.error("Failed to toggle human takeover:", error);
        toast.error("Failed to toggle AI mode");
      } finally { headerInFlight.current = false; setHeaderBusy(false); }
    },
    [conversation, onNeedsHumanChange]
  );

  const handleOpenTemplates = useCallback(() => {
    setTemplateModalOpen(true);
  }, []);

  const handleSendTemplate = useCallback(
    async (template: MessageTemplate, params: string[]) => {
      if (!conversation) return false;
      const problem = templatePickerProblem(template);
      if (problem) { toast.error(problem); return false; }

      const renderedBody = renderTemplateBody(template.body_text, params);
      const tempId = `temp-${crypto.randomUUID()}`;

      const optimisticMsg: Message = {
        id: tempId,
        conversation_id: conversation.id,
        sender_type: "agent",
        content_type: "template",
        content_text: renderedBody,
        template_name: template.name,
        status: "sending",
        created_at: new Date().toISOString(),
      };
      onNewMessage(optimisticMsg);

      try {
        const res = await fetch("/api/whatsapp/send", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            conversation_id: conversation.id,
            message_type: "template",
            template_name: template.name,
            template_params: params,
            content_text: renderedBody,
          }),
        });

        const payload = await res.json().catch(() => ({}));

        if (!res.ok) {
          const reason = payload?.error || `HTTP ${res.status}`;
          console.error("Failed to send template:", reason);
          toast.error(`Failed to send template: ${reason}`);
          onUpdateMessage(tempId, { status: "failed" });
          return false;
        }

        const nextId = payload?.message_id as string | undefined;
        const metaId = payload?.whatsapp_message_id as string | undefined;

        if (nextId) {
          onUpdateMessage(tempId, {
            id: nextId,
            message_id: metaId,
            status: "sent",
          });
        } else {
          onUpdateMessage(tempId, { status: "sent" });
        }
        return true;
      } catch (err) {
        console.error("Failed to send template:", err);
        const reason = err instanceof Error ? err.message : "network error";
        toast.error(`Failed to send template: ${reason}`);
        onUpdateMessage(tempId, { status: "failed" });
        return false;
      }
    },
    [conversation, onNewMessage, onUpdateMessage],
  );

  const messagesById = useMemo(() => {
    const map = new Map<string, Message>();
    for (const message of messages) map.set(message.id, message);
    return map;
  }, [messages]);

  const reactionsByMessageId = useMemo(() => {
    const map = new Map<string, MessageReaction[]>();
    for (const reaction of reactions) {
      const bucket = map.get(reaction.message_id);
      if (bucket) bucket.push(reaction);
      else map.set(reaction.message_id, [reaction]);
    }
    return map;
  }, [reactions]);

  const contactDisplayName = contact?.name || contact?.phone || "Customer";
  const currentUserId = user?.id;

  const authorLabelFor = useCallback(
    (message: Message): string => {
      const isAgent =
        message.sender_type === "agent" || message.sender_type === "bot";
      return isAgent ? "You" : contactDisplayName;
    },
    [contactDisplayName],
  );

  const handleStartReply = useCallback(
    (message: Message) => {
      if (message.id.startsWith('temp-') || message.status === 'failed') { toast.error('Wait for a sent message before replying'); return; }
      setReplyTo({
        id: message.id,
        authorLabel: authorLabelFor(message),
        preview: buildReplyPreview(message),
      });
    },
    [authorLabelFor],
  );

  const postReaction = useCallback(
    async (messageId: string, emoji: string) => {
      if (!currentUserId || !conversation) return;

      if (messageId.startsWith("temp-")) {
        toast.error("Wait for the message to finish sending");
        return;
      }

      const conversationId = conversation.id;
      const userId = currentUserId;
      if (pendingReactions.current.has(messageId)) return;
      pendingReactions.current.add(messageId);
      const snapshot = reactionsRef.current.filter(reaction => reaction.message_id === messageId && reaction.actor_type === 'agent' && reaction.actor_id === userId);

      setReactions((prev) => {
        const own = prev.find(
          (reaction) =>
            reaction.message_id === messageId &&
            reaction.actor_type === "agent" &&
            reaction.actor_id === userId,
        );

        if (emoji === "") {
          return own ? prev.filter((reaction) => reaction !== own) : prev;
        }

        if (own) {
          return prev.map((reaction) =>
            reaction === own ? { ...own, emoji } : reaction,
          );
        }

        return [
          ...prev,
          {
            id: `temp-${crypto.randomUUID()}`,
            message_id: messageId,
            conversation_id: conversationId,
            actor_type: "agent",
            actor_id: userId,
            emoji,
            created_at: new Date().toISOString(),
          },
        ];
      });

      try {
        const res = await fetch("/api/whatsapp/react", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message_id: messageId, emoji }),
        });

        if (!res.ok) {
          const payload = await res.json().catch(() => ({}));
          throw new Error(payload?.error || `HTTP ${res.status}`);
        }
      } catch (err) {
        const reason = err instanceof Error ? err.message : "network error";
        toast.error(`Reaction failed: ${reason}`);
        if (activeIdRef.current === conversationId) setReactions(prev => [...prev.filter(reaction => !(reaction.message_id === messageId && reaction.actor_type === 'agent' && reaction.actor_id === userId)), ...snapshot]);
      } finally {
        pendingReactions.current.delete(messageId);
        if (activeIdRef.current === conversationId) void refreshReactionsRef.current?.();
      }
    },
    [conversation, currentUserId],
  );

  const handleAssignChange = useCallback(
    async (agentId: string | null) => {
      if (!conversation || headerInFlight.current) return;
      headerInFlight.current = true;
      setHeaderBusy(true);

      try {
        await fetchJson(`/api/whatsapp/conversations/${conversation.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ assigned_agent_id: agentId }),
        });

        onAssignChange(conversation.id, agentId);
      } catch (error) {
        console.error("Failed to update assignment:", error);
        toast.error("Failed to update assignment");
      } finally { headerInFlight.current = false; setHeaderBusy(false); }
    },
    [conversation, onAssignChange],
  );

  // Empty state
  if (!conversation || !contact) {
    return (
      <div className="flex min-h-0 min-w-0 flex-1 flex-col items-center justify-center bg-surface">
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-surface-light">
          <MessageSquare className="h-8 w-8 text-muted" />
        </div>
        <h3 className="mt-4 text-sm font-medium text-muted">
          Select a conversation
        </h3>
        <p className="mt-1 text-xs text-muted">
          Choose a conversation from the left to start messaging
        </p>
      </div>
    );
  }

  const displayName = contact.name || contact.phone;
  const messageGroups = groupMessagesByDate(messages);
  const currentStatus = STATUS_OPTIONS.find(
    (s) => s.value === conversation.status
  );
  const assignedAgentId = conversation.assigned_agent_id ?? null;
  const currentAssignee = profiles.find((p) => p.user_id === assignedAgentId);
  const assignLabel = assignedAgentId
    ? (currentAssignee?.full_name ?? "Assigned")
    : "Assign";

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-surface">
      {/* Header */}
      <div className="ui-inbox-header wa-thread-header flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-border bg-surface px-3 py-3 sm:px-4">
        <div className="flex min-w-0 items-center gap-2 sm:gap-3">
          {/* Back-to-list button — mobile only. Hidden on lg+ where the
              conversation list is always visible next to the thread. */}
          {onBack && (
            <button
              type="button"
              onClick={onBack}
              aria-label="Back to conversations"
              className="ui-icon-button flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-md text-foreground hover:bg-surface-light hover:text-foreground lg:hidden"
            >
              <ArrowLeft className="h-5 w-5" />
            </button>
          )}
          <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-surface-light text-sm font-medium text-foreground">
            {displayName.charAt(0).toUpperCase()}
          </div>
          <div className="min-w-0">
            <h2 className="truncate text-sm font-semibold text-foreground">{displayName}</h2>
            <p className="truncate text-xs text-muted">{contact.phone}</p>
          </div>
          {/* Session timer badge — hidden on the narrowest phones so
              the name + back arrow keep their room. */}
          <Badge
            variant="outline"
            className={cn(
              "ml-1 hidden shrink-0 whitespace-nowrap gap-1 border-border text-[10px] xl:inline-flex xl:ml-2",
              sessionInfo.expired ? "text-red-400" : "text-accent"
            )}
          >
            <Clock className="h-3 w-3" />
            {sessionInfo.remaining}
          </Badge>
        </div>

        <div className="flex min-w-0 flex-wrap items-center gap-1 sm:gap-2">
          {onShowContact && <button type="button" onClick={onShowContact} aria-label="Contact details" className="ui-icon-button flex h-9 w-9 items-center justify-center rounded-lg text-muted hover:bg-surface-light 2xl:hidden"><Info className="h-4 w-4" /></button>}
          {/* AI Auto-Reply Toggle */}
          <button
            onClick={handleNeedsHumanToggle}
            disabled={headerBusy}
            className={cn(
              "inline-flex items-center justify-center h-7 px-2 text-xs rounded-md transition-colors border",
              !conversation.needs_human 
                ? "bg-accent/10 text-accent border-accent/20 hover:bg-accent/20" 
                : "bg-surface-light text-muted border-border hover:bg-surface-light/80"
            )}
            title={!conversation.needs_human ? "AI is auto-replying. Click to pause." : "AI is paused. Click to resume."}
          >
            {!conversation.needs_human ? (
              <>
                <Bot className="h-3 w-3 sm:mr-1" />
                <span className="inline">AI Active</span>
              </>
            ) : (
              <>
                <User className="h-3 w-3 sm:mr-1" />
                <span className="inline">Human Mode</span>
              </>
            )}
          </button>

          {/* Status dropdown */}
          <DropdownMenu>
            <DropdownMenuTrigger disabled={headerBusy} className={cn(
              "inline-flex items-center justify-center h-7 gap-1 px-2 text-xs rounded-md hover:bg-surface-light",
              currentStatus?.color ?? "text-muted"
            )}>
              {currentStatus?.label ?? "Status"}
              <ChevronDown className="h-3 w-3" />
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              className="wa-inbox-menu border-border bg-surface-light"
            >
              {STATUS_OPTIONS.map((opt) => (
                <DropdownMenuItem
                  key={opt.value}
                  onClick={() => handleStatusChange(opt.value)}
                  className={cn("text-sm", opt.color)}
                >
                  {opt.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Assign dropdown */}
          <DropdownMenu>
            <DropdownMenuTrigger
              disabled={headerBusy}
              className={cn(
                "inline-flex items-center justify-center h-7 gap-1 px-2 text-xs rounded-md hover:bg-surface-light",
                assignedAgentId ? "text-accent" : "text-muted"
              )}
            >
              <UserPlus className="h-3 w-3" />
              <span title={assignLabel} className="inline-block max-w-24 truncate">{assignLabel}</span>
              <ChevronDown className="h-3 w-3" />
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              className="wa-inbox-menu border-border bg-surface-light"
            >
              {profiles.length === 0 ? (
                <DropdownMenuItem disabled className="text-sm text-muted">
                  No teammates available
                </DropdownMenuItem>
              ) : (
                profiles.map((p) => {
                  const isSelected = p.user_id === assignedAgentId;
                  return (
                    <DropdownMenuItem
                      key={p.id}
                      onClick={() => handleAssignChange(p.user_id)}
                      className={cn(
                        "text-sm",
                        isSelected ? "text-accent" : "text-foreground"
                      )}
                    >
                      <span className="flex-1">
                        {p.full_name}
                        {p.user_id === user?.id ? " (me)" : ""}
                      </span>
                      {isSelected && <Check className="ml-2 h-3 w-3" />}
                    </DropdownMenuItem>
                  );
                })
              )}
              {assignedAgentId && (
                <>
                  <DropdownMenuSeparator className="bg-surface-light" />
                  <DropdownMenuItem
                    onClick={() => handleAssignChange(null)}
                    className="text-sm text-muted"
                  >
                    Unassign
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {loadError && <div role="alert" className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-border bg-warning-light p-3 text-xs text-warning"><span>{loadError}</span><button type="button" onClick={() => setReloadToken(value => value + 1)} className="flex items-center gap-1 rounded-lg border border-border px-3 py-2"><RefreshCw className="h-3 w-3" /> Retry</button></div>}

      {/* Messages Area */}
      <div className="relative min-h-0 flex-1">
      <div ref={scrollRef} tabIndex={0} aria-label="Conversation messages" onScroll={event => { const el = event.currentTarget; const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 64; followBottomRef.current = nearBottom; setAtBottom(nearBottom); }} className="wa-message-scroll h-full min-h-0 overflow-y-auto overscroll-contain bg-background px-3 py-3 sm:px-5 sm:py-4">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-accent border-t-transparent" />
          </div>
        ) : messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12">
            <p className="text-sm text-muted">No messages yet</p>
            <p className="text-xs text-muted">
              Send a template to start the conversation
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {messageGroups.map((group) => (
              <div key={group.date}>
                {/* Date separator */}
                <div className="mb-4 flex items-center justify-center">
                  <span className="rounded-full bg-surface-light px-3 py-1 text-[10px] font-medium text-muted">
                    {formatDateSeparator(group.date)}
                  </span>
                </div>
                {/* Messages */}
                <div className="space-y-2">
                  {group.messages.map((msg) => {
                    const parent = msg.reply_to_message_id
                      ? messagesById.get(msg.reply_to_message_id)
                      : null;
                    const reply = parent
                      ? {
                        authorLabel: authorLabelFor(parent),
                        preview: buildReplyPreview(parent),
                      }
                      : null;
                    const msgReactions = reactionsByMessageId.get(msg.id);
                    const handlePillToggle = (emoji: string) => {
                      const own = msgReactions?.find(
                        (reaction) =>
                          reaction.actor_type === "agent" &&
                          reaction.actor_id === user?.id,
                      );
                      const next = own?.emoji === emoji ? "" : emoji;
                      void postReaction(msg.id, next);
                    };

                    return (
                      <MessageActions
                        key={msg.id}
                        message={msg}
                        onReply={() => handleStartReply(msg)}
                        onReact={(emoji) => {
                          if (emoji) void postReaction(msg.id, emoji);
                        }}
                      >
                        <MessageBubble
                          message={msg}
                          reply={reply}
                          reactions={msgReactions}
                          currentUserId={user?.id}
                          onToggleReaction={handlePillToggle}
                        />
                      </MessageActions>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      {!atBottom && <button type="button" onClick={() => { const el = scrollRef.current; if (el) el.scrollTop = el.scrollHeight; followBottomRef.current = true; setAtBottom(true); }} className="absolute bottom-3 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full border border-border bg-surface px-3 py-2 text-xs text-accent shadow-md">Latest messages ↓</button>}
      </div>

      {/* Composer */}
      <MessageComposer
        key={conversation.id}
        conversationId={conversation.id}
        sessionExpired={sessionInfo.expired}
        loading={loading}
        onSend={handleSend}
        onOpenTemplates={handleOpenTemplates}
        replyTo={replyTo}
        onClearReply={() => setReplyTo(null)}
      />

      <TemplatePicker
        open={templateModalOpen}
        onOpenChange={setTemplateModalOpen}
        onSelect={handleSendTemplate}
      />
    </div>
  );
}
