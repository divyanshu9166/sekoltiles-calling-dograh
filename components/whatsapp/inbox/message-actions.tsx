"use client";

import { useState, type ReactNode } from "react";
import { CornerUpLeft, Copy, SmilePlus, Ellipsis } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import type { Message } from "@/types";

const QUICK_EMOJIS = ["👍", "❤️", "😂", "😮", "😢", "🙏"];

interface MessageActionsProps {
  message: Message;
  onReply: () => void;
  onReact: (emoji: string) => void;
  children: ReactNode;
}

export function MessageActions({
  message,
  onReply,
  onReact,
  children,
}: MessageActionsProps) {
  const [touchOpen, setTouchOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);

  const isAgent =
    message.sender_type === "agent" || message.sender_type === "bot";

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    setTouchOpen(true);
  };

  const handleCopy = async () => {
    const text = message.content_text ?? "";
    if (!text) {
      toast.error("Nothing to copy");
      return;
    }

    try {
      await navigator.clipboard.writeText(text);
      toast.success("Copied");
    } catch {
      toast.error("Copy failed");
    }
    setTouchOpen(false);
  };

  const handlePickEmoji = (emoji: string) => {
    onReact(emoji);
    setPickerOpen(false);
    setTouchOpen(false);
  };

  const handleReply = () => {
    onReply();
    setTouchOpen(false);
  };

  return (
    <div
      className={cn("flex w-full", isAgent ? "justify-end" : "justify-start")}
      onContextMenu={handleContextMenu}
      onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setTouchOpen(false); }}
    >
      <div className="wa-message-wrap group/actions relative min-w-0 max-w-[88%] sm:max-w-[80%] xl:max-w-[72%]">
        {children}
        <button type="button" aria-label="Message actions" aria-expanded={touchOpen || pickerOpen} onClick={() => setTouchOpen(value => !value)} className={cn('absolute top-1 flex h-9 w-9 items-center justify-center rounded-full text-muted hover:bg-surface-light md:hidden', isAgent ? '-left-9' : '-right-9')}><Ellipsis className="h-4 w-4" /></button>
        <div
          data-touch-open={touchOpen || pickerOpen ? "true" : undefined}
          className={cn(
            "absolute -top-3 z-10 flex items-center gap-0.5 rounded-full border border-border bg-surface px-1 shadow-md backdrop-blur-sm transition-opacity",
            "pointer-events-none opacity-0 group-hover/actions:pointer-events-auto group-hover/actions:opacity-100 group-focus-within/actions:pointer-events-auto group-focus-within/actions:opacity-100",
            "data-[touch-open=true]:pointer-events-auto data-[touch-open=true]:opacity-100",
            isAgent ? "right-3" : "left-3",
          )}
        >
          <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
            <PopoverTrigger
              disabled={message.id.startsWith('temp-') || message.status === 'failed'}
              className="ui-icon-button flex h-9 w-9 md:h-6 md:w-6 items-center justify-center rounded-full text-foreground hover:bg-surface-light hover:text-foreground"
              aria-label="React"
            >
              <SmilePlus className="h-3.5 w-3.5" />
            </PopoverTrigger>
            <PopoverContent
              className="wa-inbox-menu flex w-auto flex-row gap-1 p-1.5"
              sideOffset={6}
            >
              {QUICK_EMOJIS.map((emoji) => (
                <button
                  key={emoji}
                  type="button"
                  onClick={() => handlePickEmoji(emoji)}
                  className="ui-icon-button flex h-10 w-10 items-center justify-center rounded-full text-lg leading-none transition-transform hover:scale-125 hover:bg-surface-light"
                  aria-label={`React with ${emoji}`}
                >
                  {emoji}
                </button>
              ))}
            </PopoverContent>
          </Popover>
          <button
            type="button"
            onClick={handleReply}
            disabled={message.id.startsWith('temp-') || message.status === 'failed'}
            className="ui-icon-button flex h-9 w-9 md:h-6 md:w-6 items-center justify-center rounded-full text-foreground hover:bg-surface-light hover:text-foreground disabled:opacity-40"
            aria-label="Reply"
          >
            <CornerUpLeft className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={handleCopy}
            className="ui-icon-button flex h-9 w-9 md:h-6 md:w-6 items-center justify-center rounded-full text-foreground hover:bg-surface-light hover:text-foreground"
            aria-label="Copy"
          >
            <Copy className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}
