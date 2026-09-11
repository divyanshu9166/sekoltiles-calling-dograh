'use client';
import { useEffect } from 'react';
import { X } from 'lucide-react';

export default function Modal({ isOpen, onClose, title, children, size = 'md', fullScreenMobile = false, footer = null }) {
  // Lock body scroll when open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => { document.body.style.overflow = ''; };
  }, [isOpen]);

  if (!isOpen) return null;

  const sizeClasses = {
    sm: 'md:max-w-md',
    md: 'md:max-w-lg',
    lg: 'md:max-w-2xl',
    xl: 'md:max-w-4xl',
  };

  return (
    <div className={`fixed inset-0 z-[100] flex justify-center ${fullScreenMobile ? 'items-stretch md:items-center' : 'items-end md:items-center'}`} role="dialog" aria-modal="true">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm animate-[fade-in_0.2s_ease]"
        onClick={onClose}
      />

      {/* Sheet on mobile, centered modal on desktop */}
      <div className={`
        relative w-full ${sizeClasses[size]}
        bg-surface border border-border shadow-2xl
        flex flex-col
        ${fullScreenMobile
          ? 'h-[100dvh] max-h-[100dvh] md:h-auto md:max-h-[85vh] rounded-none md:rounded-2xl'
          : 'max-h-[90vh] md:max-h-[85vh] rounded-t-3xl md:rounded-2xl'}
        mx-0 md:mx-4 mb-0 md:mb-0
        animate-[slide-up_0.3s_cubic-bezier(0.32,0.72,0,1)]
      `}>
        {/* Handle — mobile only (hidden when full-screen) */}
        {!fullScreenMobile && (
          <div className="flex justify-center pt-3 pb-1 md:hidden flex-shrink-0">
            <div className="w-10 h-1 rounded-full bg-border" />
          </div>
        )}

        {/* Header */}
        <div className="flex items-center justify-between px-5 md:px-6 py-3 md:py-4 border-b border-border flex-shrink-0">
          <h2 className="text-base md:text-lg font-semibold text-foreground">{title}</h2>
          <button
            onClick={onClose}
            className="p-2 rounded-xl hover:bg-surface-hover text-muted hover:text-foreground transition-colors touch-target flex items-center justify-center"
            aria-label="Close dialog"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="px-5 md:px-6 py-4 md:py-5 overflow-y-auto flex-1">
          {children}
        </div>

        {/* Sticky footer — clears the mobile bottom nav via safe-area inset */}
        {footer && (
          <div
            className="flex-shrink-0 border-t border-border bg-surface px-5 md:px-6 py-3 md:py-4"
            style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 0.75rem)' }}
          >
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
