"use client";

import { useState, useRef, useCallback, useEffect, KeyboardEvent, ClipboardEvent } from "react";
import { Send, LayoutTemplate, Paperclip, X, FileText, Film, Music } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  checkOutboundMedia,
  formatFileSize,
  MEDIA_ACCEPT,
  MEDIA_CAPTION_LIMIT,
} from "@/lib/whatsapp/outbound-media";
import { ReplyQuote } from "./reply-quote";

interface ReplyDraft {
  id: string;
  authorLabel: string;
  preview: string;
}

interface MessageComposerProps {
  conversationId: string;
  sessionExpired: boolean;
  loading?: boolean;
  onSend: (text: string, replyToId?: string) => Promise<boolean>;
  onSendMedia: (file: File, caption: string, replyToId?: string) => Promise<boolean>;
  onOpenTemplates: () => void;
  replyTo?: ReplyDraft | null;
  onClearReply?: () => void;
}

export function MessageComposer({
  conversationId,
  sessionExpired,
  loading = false,
  onSend,
  onSendMedia,
  onOpenTemplates,
  replyTo,
  onClearReply,
}: MessageComposerProps) {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [attachment, setAttachment] = useState<File | null>(null);
  const [attachmentPreview, setAttachmentPreview] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const sendInFlight = useRef(false);
  const lastTypingAt = useRef(0);
  // Classified by extension like the send API; browsers often leave file.type blank.
  const attachmentCheck = attachment ? checkOutboundMedia(attachment) : null;
  const attachmentKind = attachmentCheck?.ok ? attachmentCheck.kind : null;
  const isAudio = attachmentKind === "audio";

  // A new chat starts without a typing indicator shown.
  useEffect(() => {
    lastTypingAt.current = 0;
  }, [conversationId]);

  // WhatsApp shows "typing…" for up to 25 s, so refresh it every 20 s while
  // the agent keeps typing. Best effort: failures are ignored.
  const signalTyping = useCallback(() => {
    if (sessionExpired || Date.now() - lastTypingAt.current < 20_000) return;
    lastTypingAt.current = Date.now();
    fetch(`/api/whatsapp/conversations/${conversationId}/typing`, { method: "POST" }).catch(() => {});
  }, [conversationId, sessionExpired]);

  // Thumbnail for an attached photo; revoked when it changes or unmounts.
  useEffect(() => {
    if (!attachment || !attachment.type.startsWith("image/")) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setAttachmentPreview(null);
      return;
    }
    const url = URL.createObjectURL(attachment);
    setAttachmentPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [attachment]);

  const attachFile = useCallback((file: File) => {
    const check = checkOutboundMedia(file);
    if (!check.ok) {
      toast.error(check.error);
      return;
    }
    setAttachment(file);
    textareaRef.current?.focus();
  }, []);

  const clearAttachment = useCallback(() => {
    setAttachment(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, []);

  const adjustHeight = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    // Max 4 lines (~96px)
    el.style.height = `${Math.min(el.scrollHeight, 96)}px`;
  }, []);

  const handleSend = useCallback(async () => {
    const trimmed = text.trim();
    if ((!trimmed && !attachment) || sendInFlight.current || sessionExpired || loading) return;
    if (attachment && trimmed.length > MEDIA_CAPTION_LIMIT) {
      toast.error(`Caption can be at most ${MEDIA_CAPTION_LIMIT} characters`);
      return;
    }
    if (isAudio && trimmed) {
      toast.error("WhatsApp sends audio without a caption. Remove the text or send it separately.");
      return;
    }

    sendInFlight.current = true;
    setSending(true);
    try {
      const accepted = attachment
        ? await onSendMedia(attachment, trimmed, replyTo?.id)
        : await onSend(trimmed, replyTo?.id);
      if (!accepted) return;
      setText("");
      clearAttachment();
      lastTypingAt.current = 0;
      if (textareaRef.current) {
        textareaRef.current.style.height = "auto";
      }
    } finally {
      sendInFlight.current = false;
      setSending(false);
    }
  }, [text, attachment, isAudio, sessionExpired, loading, onSend, onSendMedia, replyTo?.id, clearAttachment]);

  // Pasting a screenshot or copied photo attaches it.
  const handlePaste = useCallback(
    (e: ClipboardEvent<HTMLTextAreaElement>) => {
      const file = Array.from(e.clipboardData.files)[0];
      if (!file) return;
      e.preventDefault();
      attachFile(file);
    },
    [attachFile]
  );

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend]
  );

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      setText(e.target.value);
      adjustHeight();
      if (e.target.value.trim()) signalTyping();
    },
    [adjustHeight, signalTyping]
  );

  return (
    <div className="ui-inbox-composer shrink-0 border-t border-border bg-surface p-3">
      {replyTo && (
        <div className="mb-2">
          <ReplyQuote
            authorLabel={replyTo.authorLabel}
            preview={replyTo.preview}
            onDismiss={onClearReply}
          />
        </div>
      )}

      {sessionExpired && !loading && (
        <div className="ui-actions mb-2 flex items-center justify-between rounded-lg bg-amber-500/10 px-3 py-2">
          <p className="text-xs text-amber-400">
            24-hour session expired. Use a template to re-engage.
          </p>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs text-amber-400 hover:text-amber-300"
            onClick={onOpenTemplates}
          >
            <LayoutTemplate className="mr-1 h-3 w-3" />
            Templates
          </Button>
        </div>
      )}

      {attachment && (
        <div className="mb-2 flex items-center gap-3 rounded-xl border border-border bg-surface-light p-2">
          {attachmentPreview ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={attachmentPreview}
              alt="Attached photo"
              className="h-14 w-14 shrink-0 rounded-lg object-cover"
            />
          ) : (
            <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-lg bg-surface">
              {attachmentKind === "video" ? (
                <Film className="h-6 w-6 text-muted" />
              ) : isAudio ? (
                <Music className="h-6 w-6 text-muted" />
              ) : (
                <FileText className="h-6 w-6 text-muted" />
              )}
            </span>
          )}
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-foreground">{attachment.name}</p>
            <p className="text-xs text-muted">
              {formatFileSize(attachment.size)} ·{" "}
              {isAudio ? "Audio is sent without a caption" : "Add a caption below (optional)"}
            </p>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 w-8 shrink-0 p-0 text-muted hover:text-foreground"
            onClick={clearAttachment}
            disabled={sending}
            aria-label="Remove attachment"
            title="Remove attachment"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      )}

      <div className="ui-message-input-row flex items-end gap-2">
        <Button
          variant="ghost"
          size="sm"
          className="h-9 w-9 shrink-0 p-0 text-muted hover:text-foreground"
          onClick={onOpenTemplates}
          title="Send template"
          aria-label="Send template"
        >
          <LayoutTemplate className="h-4 w-4" />
        </Button>

        <Button
          variant="ghost"
          size="sm"
          className="h-9 w-9 shrink-0 p-0 text-muted hover:text-foreground"
          onClick={() => fileInputRef.current?.click()}
          disabled={sessionExpired || sending || loading}
          title="Attach photo, video, audio or document"
          aria-label="Attach photo or document"
        >
          <Paperclip className="h-4 w-4" />
        </Button>
        <input
          ref={fileInputRef}
          type="file"
          accept={MEDIA_ACCEPT}
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) attachFile(file);
            e.target.value = "";
          }}
        />

        <textarea
          ref={textareaRef}
          value={text}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          placeholder={
            loading ? 'Loading messages…' : sessionExpired
              ? "Session expired - use a template"
              : isAudio
                ? "Audio is sent without a caption"
                : attachment
                  ? "Add a caption…"
                  : "Type a message…"
          }
          disabled={sessionExpired || sending || loading}
          aria-label="Message text"
          dir="auto"
          rows={1}
          className={cn(
            "flex-1 resize-none rounded-xl border border-border bg-surface-light px-3 py-2 sm:px-4 sm:py-2.5 text-sm text-foreground placeholder-muted outline-none transition-colors focus:border-accent",
            sessionExpired && "cursor-not-allowed opacity-50"
          )}
        />

        <Button
          size="sm"
          className="wa-send-button h-9 w-9 shrink-0 bg-accent p-0 hover:bg-accent disabled:opacity-40"
          disabled={(!text.trim() && !attachment) || sessionExpired || sending || loading}
          onClick={handleSend}
          aria-label="Send message"
        >
          <Send className="h-4 w-4" />
        </Button>
      </div>

      {/* Hint sits outside the flex row so its height doesn't push
          `items-end` buttons below the textarea. Indented to line up
          under the textarea left edge (w-9 button + gap-2 = 44px). */}
      <p className="mt-1 pl-11 text-[10px] text-muted">
        Enter to send · Shift+Enter for a new line · 📎 photos 5 MB, video/audio 16 MB, documents 25 MB
      </p>
    </div>
  );
}
