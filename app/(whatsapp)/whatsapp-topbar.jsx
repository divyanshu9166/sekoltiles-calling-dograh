'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { MessageCircle, PhoneCall } from 'lucide-react';
import ThemeToggle from '@/components/ThemeToggle';

const LINKS = [
  { href: '/calls', label: 'Call Center', icon: PhoneCall, sections: ['/calls'] },
  {
    href: '/whatsapp-marketing',
    label: 'WhatsApp Marketing',
    icon: MessageCircle,
    sections: ['/whatsapp-marketing', '/broadcasts', '/automations'],
  },
];

export default function WhatsAppTopBar() {
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-40 flex h-14 md:h-16 items-center justify-between gap-3 border-b border-border bg-surface px-3.5 md:px-6">
      <nav aria-label="Sections" className="flex min-w-0 items-center gap-1 overflow-x-auto">
        {LINKS.map(({ href, label, icon: Icon, sections }) => {
          const active = sections.some((section) => pathname === section || pathname.startsWith(`${section}/`));
          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? 'page' : undefined}
              className={`flex shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${active
                ? 'bg-accent/15 text-accent'
                : 'text-muted hover:bg-surface-hover hover:text-foreground'
                }`}
            >
              <Icon className="h-4 w-4" />
              {label}
            </Link>
          );
        })}
      </nav>
      <ThemeToggle />
    </header>
  );
}
