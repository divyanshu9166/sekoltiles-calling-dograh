"use client";

import { useState, useEffect } from "react";
import { cn } from "@/lib/utils";
import type { Message, MessageReaction } from "@/types";
import {
  Clock,
  Check,
  CheckCheck,
  XCircle,
  FileText,
  MapPin,
  LayoutTemplate,
  ImageOff,
  Download,
  ExternalLink,
  X,
} from "lucide-react";
import { format, isValid } from "date-fns";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { MessageReactions } from "./message-reactions";
import { ReplyQuote } from "./reply-quote";

interface MessageBubbleProps {
  message: Message;
  reply?: { authorLabel: string; preview: string } | null;
  reactions?: MessageReaction[];
  currentUserId?: string;
  onToggleReaction?: (emoji: string) => void;
}

function StatusIcon({ status }: { status: Message["status"] }) {
  switch (status) {
    case "sending":
      return <Clock className="h-3 w-3 text-muted" />;
    case "sent":
      return <Check className="h-3 w-3 text-muted" />;
    case "delivered":
      return <CheckCheck className="h-3 w-3 text-muted" />;
    case "read":
      return <CheckCheck className="h-3 w-3 text-blue-400" />;
    case "failed":
      return <XCircle className="h-3 w-3 text-red-400" />;
    default:
      return null;
  }
}

function MediaUnavailable({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 rounded-lg bg-surface-light px-3 py-2 text-xs text-foreground">
      <ImageOff className="h-4 w-4 shrink-0 text-muted" />
      <span>{label} unavailable</span>
    </div>
  );
}

function MediaImage({ url, alt }: { url: string; alt: string }) {
  const [src, setSrc] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);
  const [viewerOpen, setViewerOpen] = useState(false);
  const [mimeType, setMimeType] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    let blobUrl: string | null = null;
    const load = async () => {
      setLoading(true);
      setError(false);
      setSrc(null);
      setMimeType(null);
      try {
        let nextSrc = url;
        if (url.startsWith('/api/whatsapp/media/')) {
          const res = await fetch(url, { signal: controller.signal });
          if (!res.ok) throw new Error('Failed to load media');
          const blob = await res.blob();
          if (controller.signal.aborted) return;
          setMimeType(blob.type || null);
          blobUrl = URL.createObjectURL(blob);
          nextSrc = blobUrl;
        }
        if (!controller.signal.aborted) setSrc(nextSrc);
      } catch {
        if (!controller.signal.aborted) setError(true);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    };
    void load();
    return () => {
      controller.abort();
      if (blobUrl) URL.revokeObjectURL(blobUrl);
    };
  }, [url]);

  if (error) {
    return (
      <div className="flex h-40 w-60 items-center justify-center rounded-lg bg-surface-light">
        <ImageOff className="h-8 w-8 text-muted" />
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex h-40 w-60 items-center justify-center rounded-lg bg-surface-light">
        <div className="h-5 w-5 animate-spin rounded-full border-2 border-accent border-t-transparent" />
      </div>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setViewerOpen(true)}
        className="block cursor-zoom-in rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        aria-label="Open image"
        title="Click to view full size"
      >
        <img
          src={src ?? ""}
          alt={alt}
          className="max-h-64 max-w-60 rounded-lg object-cover"
          onError={() => setError(true)}
        />
      </button>
      {src && (
        <ImageViewer
          open={viewerOpen}
          onOpenChange={setViewerOpen}
          src={src}
          alt={alt}
          mimeType={mimeType}
        />
      )}
    </>
  );
}

const IMAGE_EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};

// Full-screen view of a chat image, with download and open-in-new-tab.
function ImageViewer({
  open,
  onOpenChange,
  src,
  alt,
  mimeType,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  src: string;
  alt: string;
  mimeType: string | null;
}) {
  const extension = (mimeType && IMAGE_EXTENSIONS[mimeType]) || "jpg";
  const toolbarButton =
    "inline-flex h-9 items-center gap-1.5 rounded-lg bg-white/10 px-3 text-sm font-medium text-white transition-colors hover:bg-white/20";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="flex max-h-[95dvh] w-auto max-w-[95vw] flex-col gap-3 bg-black/90 p-3 ring-0 sm:max-w-[95vw]"
      >
        <DialogTitle className="sr-only">{alt}</DialogTitle>
        <div className="flex items-center justify-end gap-2">
          <a href={src} download={`whatsapp-image.${extension}`} className={toolbarButton}>
            <Download className="h-4 w-4" />
            Download
          </a>
          <a href={src} target="_blank" rel="noopener noreferrer" className={toolbarButton}>
            <ExternalLink className="h-4 w-4" />
            <span className="hidden sm:inline">Open in new tab</span>
          </a>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className={toolbarButton}
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <img
          src={src}
          alt={alt}
          className="mx-auto max-h-[calc(95dvh-5rem)] max-w-full rounded-lg object-contain"
        />
      </DialogContent>
    </Dialog>
  );
}

function MessageContent({ message }: { message: Message }) {
  switch (message.content_type) {
    case "text":
      return (
        <p className="whitespace-pre-wrap break-words text-sm">
          {message.content_text}
        </p>
      );

    case "image":
      return (
        <div>
          {message.media_url ? (
            <MediaImage url={message.media_url} alt="Shared image" />
          ) : (
            <MediaUnavailable label="Image" />
          )}
          {message.content_text && (
            <p className="mt-1 whitespace-pre-wrap break-words text-sm">
              {message.content_text}
            </p>
          )}
        </div>
      );

    case "video":
      return (
        <div>
          {message.media_url ? (
            <video
              src={message.media_url}
              controls
              className="max-h-64 max-w-60 rounded-lg"
            />
          ) : (
            <MediaUnavailable label="Video" />
          )}
          {message.content_text && (
            <p className="mt-1 whitespace-pre-wrap break-words text-sm">
              {message.content_text}
            </p>
          )}
        </div>
      );

    case "audio":
      return (
        <div>
          {message.media_url ? (
            <audio src={message.media_url} controls className="max-w-60" />
          ) : (
            <MediaUnavailable label="Audio" />
          )}
        </div>
      );

    case "document":
      if (!message.media_url) {
        return <MediaUnavailable label={message.content_text || "Document"} />;
      }
      return (
        <a
          href={message.media_url}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-2 rounded-lg bg-surface-light px-3 py-2 text-sm hover:bg-surface-light"
        >
          <FileText className="h-5 w-5 shrink-0 text-muted" />
          <span className="truncate">
            {message.content_text || "Document"}
          </span>
        </a>
      );

    case "template":
      return (
        <div>
          <span className="wa-template-label mb-1 inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium">
            <LayoutTemplate className="h-3 w-3" />
            Template
          </span>
          {message.media_url && (
            <div className="mt-1">
              <MediaImage url={message.media_url} alt="Template header" />
            </div>
          )}
          {message.content_text && (
            <p className="mt-1 whitespace-pre-wrap break-words text-sm">
              {message.content_text}
            </p>
          )}
        </div>
      );

    case "location": {
      // Inbound locations are stored as "name - address - lat,long".
      const coords = message.content_text?.match(/(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)\s*$/);
      const label = (
        <>
          <MapPin className="h-4 w-4 shrink-0 text-muted" />
          <span>{message.content_text || "Location shared"}</span>
        </>
      );
      return coords ? (
        <a
          href={`https://www.google.com/maps?q=${coords[1]},${coords[2]}`}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-2 text-sm underline-offset-2 hover:underline"
        >
          {label}
        </a>
      ) : (
        <div className="flex items-center gap-2 text-sm">{label}</div>
      );
    }

    default:
      return (
        <p className="whitespace-pre-wrap break-words text-sm">
          {message.content_text || "[Unsupported message type]"}
        </p>
      );
  }
}

export function MessageBubble({
  message,
  reply,
  reactions,
  currentUserId,
  onToggleReaction,
}: MessageBubbleProps) {
  const isAgent = message.sender_type === "agent" || message.sender_type === "bot";
  const date = new Date(message.created_at);
  const time = isValid(date) ? format(date, "HH:mm") : "";

  return (
    <div
      className={cn(
        "wa-message flex min-w-0 flex-col",
        isAgent ? "items-end" : "items-start"
      )}
    >
      <div
        className={cn(
          "wa-message-bubble relative min-w-0 rounded-2xl px-3.5 py-2.5",
          isAgent
            ? "wa-message-out rounded-br-md"
            : "wa-message-in rounded-bl-md"
        )}
      >
        {reply && (
          <ReplyQuote authorLabel={reply.authorLabel} preview={reply.preview} />
        )}
        <MessageContent message={message} />
        <div
          className={cn(
            "wa-message-meta mt-1 flex items-center gap-1",
            isAgent ? "justify-end" : "justify-start"
          )}
        >
          <span className="text-[11px]">{time}</span>
          {isAgent && <StatusIcon status={message.status} />}
          {isAgent && message.status === 'failed' && <span className="text-[11px]">Not sent</span>}
        </div>
      </div>
      {isAgent && message.status === 'failed' && message.error_message && (
        <p role="alert" className="mt-1 max-w-[18rem] text-right text-[11px] text-red-400">
          {message.error_message}
        </p>
      )}
      {reactions && reactions.length > 0 && onToggleReaction && (
        <MessageReactions
          reactions={reactions}
          currentUserId={currentUserId}
          onToggle={onToggleReaction}
        />
      )}
    </div>
  );
}
