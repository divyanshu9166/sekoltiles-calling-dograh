'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { MessageCircle, PhoneCall } from 'lucide-react';
import ThemeToggle from '@/components/ThemeToggle';

// One switcher for both halves of the app. Kept at exactly 56px (64px on
// desktop): the WhatsApp inbox sizes itself as 100dvh minus this bar.
const SECTIONS = [
  { href: '/calls', label: 'Call Center', short: 'Calls', icon: PhoneCall, paths: ['/calls'] },
  {
    href: '/whatsapp-marketing',
    label: 'WhatsApp Marketing',
    short: 'WhatsApp',
    icon: MessageCircle,
    paths: ['/whatsapp-marketing', '/broadcasts', '/automations'],
  },
];

export default function AppTopBar() {
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-40 h-14 border-b border-border bg-surface/95 backdrop-blur md:h-16">
      <div className="flex h-full items-center justify-between gap-3 px-3.5 md:px-6">
        <div className="flex min-w-0 items-center gap-3">
          <span className="hidden items-center gap-2 lg:flex">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent/15 text-sm font-bold text-accent">S</span>
            <span className="text-sm font-semibold text-foreground">Sekol Tiles</span>
          </span>
          <nav aria-label="Switch section" className="flex items-center gap-1 rounded-xl border border-border bg-background p-1">
            {SECTIONS.map(({ href, label, short, icon: Icon, paths }) => {
              const active = paths.some((p) => pathname === p || pathname.startsWith(`${p}/`));
              return (
                <Link
                  key={href}
                  href={href}
                  aria-current={active ? 'page' : undefined}
                  className={`flex shrink-0 items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors md:px-4 md:py-2 ${active
                    ? 'bg-accent/15 text-accent ring-1 ring-accent/30'
                    : 'text-muted hover:bg-surface-hover hover:text-foreground'
                    }`}
                >
                  <Icon className="h-4 w-4" />
                  <span className="sm:hidden">{short}</span>
                  <span className="hidden sm:inline">{label}</span>
                </Link>
              );
            })}
          </nav>
        </div>
        <ThemeToggle />
      </div>
    </header>
  );
}
