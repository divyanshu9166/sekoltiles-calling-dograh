"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { toast } from 'sonner';
import type { Contact, Deal, ContactNote, Tag } from "@/types";
import {
  Phone,
  Mail,
  Copy,
  Check,
  Tag as TagIcon,
  DollarSign,
  StickyNote,
  Plus,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { format } from "date-fns";

interface ContactSidebarProps {
  contact: Contact | null;
}

export function ContactSidebar({ contact }: ContactSidebarProps) {
  const [copied, setCopied] = useState(false);
  const [deals, setDeals] = useState<Deal[]>([]);
  const [notes, setNotes] = useState<ContactNote[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [newNote, setNewNote] = useState("");
  const [addingNote, setAddingNote] = useState(false);
  const activeContactId = useRef<string | null>(null);
  const [loadError, setLoadError] = useState('');

  useEffect(() => {
    activeContactId.current = contact?.id ?? null;
    // Clear old contact data immediately; late requests must never cross chats.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDeals([]); setNotes([]); setTags([]); setNewNote(''); setAddingNote(false); setCopied(false); setLoadError('');
    return () => { activeContactId.current = null; };
  }, [contact?.id]);

  const fetchContactData = useCallback(async () => {
    if (!contact) return;
    const targetId = contact.id;
    try {

    // Fetch deals, notes, and contact details (with tags) in parallel
    const [dealsRes, notesRes, contactRes] = await Promise.all([
      fetch(`/api/whatsapp/contacts/${contact.id}/deals`, { cache: 'no-store' }),
      fetch(`/api/whatsapp/contacts/${contact.id}/notes`, { cache: 'no-store' }),
      fetch(`/api/whatsapp/contacts/${contact.id}`, { cache: 'no-store' }),
    ]);
    if (activeContactId.current !== targetId) return;
    if (!dealsRes.ok || !notesRes.ok || !contactRes.ok) throw new Error('Unable to load contact details');

    if (dealsRes.ok) {
      const body = await dealsRes.json();
      if (activeContactId.current !== targetId) return;
      setDeals(body.data ?? []);
    }
    if (notesRes.ok) {
      const body = await notesRes.json();
      if (activeContactId.current !== targetId) return;
      setNotes(body.data ?? []);
    }
    if (contactRes.ok) {
      const body = await contactRes.json();
      if (activeContactId.current !== targetId) return;
      const rawTags = body.data?.tags ?? [];
      setTags(rawTags);
    }
    setLoadError('');
    } catch { if (activeContactId.current === targetId) setLoadError('Unable to refresh contact details.'); }
  }, [contact]);

  // Load on contact change.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchContactData();
  }, [fetchContactData]);

  const handleCopyPhone = useCallback(async () => {
    if (!contact?.phone) return;
    try {
      await navigator.clipboard.writeText(contact.phone);
      if (activeContactId.current === contact.id) {
        setCopied(true);
        setTimeout(() => { if (activeContactId.current === contact.id) setCopied(false); }, 2000);
      }
    } catch { toast.error('Unable to copy phone number'); }
    // Dep is the whole `contact` object (not `contact?.phone`) so the
    // React Compiler's inference agrees with the manual dep list —
    // fixes the `preserve-manual-memoization` lint error.
  }, [contact]);

  const handleAddNote = useCallback(async () => {
    if (!contact || !newNote.trim()) return;
    setAddingNote(true);
    const targetId = contact.id;
    try {
    const res = await fetch(`/api/whatsapp/contacts/${contact.id}/notes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ note_text: newNote.trim() }),
    });

    if (!res.ok) throw new Error('Unable to save note');
    if (res.ok) {
      const body = await res.json();
      if (activeContactId.current !== targetId) return;
      if (body.data) {
        setNotes((prev) => [body.data, ...prev]);
        setNewNote('');
      }
    }
    } catch { toast.error('Unable to save note. Please retry.'); }
    finally { if (activeContactId.current === targetId) setAddingNote(false); }
  }, [contact, newNote]);

  if (!contact) {
    return (
      <div className="flex h-full w-[20rem] items-center justify-center border-l border-border bg-surface">
        <p className="text-sm text-muted">Select a conversation</p>
      </div>
    );
  }

  const displayName = contact.name || contact.phone;
  const initials = displayName.charAt(0).toUpperCase();

  return (
    <div className="flex h-full min-h-0 w-[20rem] flex-col border-l border-border bg-surface">
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        {loadError && <div role="alert" className="bg-warning-light p-3 text-xs text-warning">{loadError} <button type="button" onClick={fetchContactData} className="rounded-lg border border-border px-2 py-2">Retry</button></div>}
        <div className="p-4">
          {/* Contact Info */}
          <div className="flex flex-col items-center text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-surface-light text-lg font-semibold text-foreground">
              {contact.avatar_url ? (
                <img
                  src={contact.avatar_url}
                  alt={displayName}
                  className="h-16 w-16 rounded-full object-cover"
                />
              ) : (
                initials
              )}
            </div>
            <h3 className="mt-3 text-sm font-semibold text-foreground">
              {displayName}
            </h3>
            {contact.company && (
              <p className="text-xs text-muted">{contact.company}</p>
            )}
          </div>

          {/* Phone */}
          <div className="mt-4 space-y-2">
            <button
              onClick={handleCopyPhone}
              className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-foreground transition-colors hover:bg-surface-light"
            >
              <Phone className="h-4 w-4 text-muted" />
              <span className="flex-1 text-left">{contact.phone}</span>
              {copied ? (
                <Check className="h-3 w-3 text-accent" />
              ) : (
                <Copy className="h-3 w-3 text-muted" />
              )}
            </button>

            {contact.email && (
              <div className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-foreground">
                <Mail className="h-4 w-4 text-muted" />
                <span className="truncate">{contact.email}</span>
              </div>
            )}
          </div>

          {/* Divider */}
          <div className="my-4 border-t border-border" />

          {/* Tags */}
          <div>
            <div className="flex items-center gap-2 px-1 text-xs font-medium uppercase tracking-wider text-muted">
              <TagIcon className="h-3 w-3" />
              Tags
            </div>
            <div className="mt-2 flex flex-wrap gap-1">
              {tags.length === 0 ? (
                <p className="px-1 text-xs text-muted">No tags</p>
              ) : (
                tags.map((tag) => (
                  <span
                    key={tag.id}
                    className="rounded-full px-2 py-0.5 text-[10px] font-medium"
                    style={{
                      backgroundColor: `${tag.color}20`,
                      color: tag.color,
                    }}
                  >
                    {tag.name}
                  </span>
                ))
              )}
            </div>
          </div>

          {/* Divider */}
          <div className="my-4 border-t border-border" />

          {/* Active Deals */}
          <div>
            <div className="flex items-center gap-2 px-1 text-xs font-medium uppercase tracking-wider text-muted">
              <DollarSign className="h-3 w-3" />
              Active Deals
            </div>
            <div className="mt-2 space-y-2">
              {deals.length === 0 ? (
                <p className="px-1 text-xs text-muted">No deals</p>
              ) : (
                deals.map((deal) => (
                  <div
                    key={deal.id}
                    className="rounded-lg bg-surface-light px-3 py-2"
                  >
                    <p className="text-sm font-medium text-foreground">
                      {deal.title}
                    </p>
                    <div className="mt-1 flex items-center justify-between text-xs text-muted">
                      <span>
                        {deal.currency ?? "$"}
                        {deal.value.toLocaleString()}
                      </span>
                      {deal.stage && (
                        <span
                          className="rounded-full px-1.5 py-0.5 text-[10px]"
                          style={{
                            backgroundColor: `${deal.stage.color}20`,
                            color: deal.stage.color,
                          }}
                        >
                          {deal.stage.name}
                        </span>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Divider */}
          <div className="my-4 border-t border-border" />

          {/* Notes */}
          <div>
            <div className="flex items-center gap-2 px-1 text-xs font-medium uppercase tracking-wider text-muted">
              <StickyNote className="h-3 w-3" />
              Notes
            </div>
            <div className="mt-2">
              <div className="flex gap-2">
                <textarea
                  value={newNote}
                  onChange={(e) => setNewNote(e.target.value)}
                  placeholder="Add a note..."
                  rows={2}
                  className="flex-1 resize-none rounded-lg border border-border bg-surface-light px-3 py-2 text-xs text-foreground placeholder-muted outline-none focus:border-accent"
                />
                <Button
                  size="sm"
                  className="h-auto bg-accent px-2 hover:bg-accent"
                  onClick={handleAddNote}
                  disabled={!newNote.trim() || addingNote}
                >
                  <Plus className="h-3 w-3" />
                </Button>
              </div>

              <div className="mt-2 space-y-2">
                {notes.map((note) => (
                  <div
                    key={note.id}
                    className="rounded-lg bg-surface-light px-3 py-2"
                  >
                    <p className="whitespace-pre-wrap text-xs text-foreground">
                      {note.note_text}
                    </p>
                    <p className="mt-1 text-[10px] text-muted">
                      {format(new Date(note.created_at), "MMM d, yyyy HH:mm")}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
