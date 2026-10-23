'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { MessageSquare, Settings, Tag } from 'lucide-react';
import { WhatsAppConfig } from '@/components/whatsapp/settings/whatsapp-config';
import { TemplateManager } from '@/components/whatsapp/settings/template-manager';
import { TagManager } from '@/components/whatsapp/settings/tag-manager';

const TAB_VALUES = ['whatsapp', 'templates', 'tags'] as const;
type TabValue = (typeof TAB_VALUES)[number];

function isTabValue(v: string | null): v is TabValue {
  return !!v && (TAB_VALUES as readonly string[]).includes(v);
}

const TABS: { id: TabValue; label: string; shortLabel: string; icon: typeof Settings }[] = [
  { id: 'whatsapp', label: 'WhatsApp Config', shortLabel: 'Config', icon: Settings },
  { id: 'templates', label: 'Templates', shortLabel: 'Templates', icon: MessageSquare },
  { id: 'tags', label: 'Tags', shortLabel: 'Tags', icon: Tag },
];

export function SettingsTab() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryTab = searchParams.get('settingsTab');
  const tab: TabValue = isTabValue(queryTab) ? queryTab : 'whatsapp';

  const onChange = (next: TabValue) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set('tab', 'settings');
    params.set('settingsTab', next);
    router.replace(`/whatsapp-marketing?${params.toString()}`, { scroll: false });
  };

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl sm:text-2xl font-bold text-foreground">Settings</h1>
        <p className="text-sm text-muted mt-1">
          Manage the WhatsApp integration, message templates, and tags.
        </p>
      </div>

      {/* Tab bar – horizontally scrollable on mobile, no clipping */}
      <div className="flex gap-1 p-1 rounded-xl border border-border bg-surface overflow-x-auto no-scrollbar">
        {TABS.map((t) => {
          const Icon = t.icon;
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              onClick={() => onChange(t.id)}
              className={`flex items-center gap-1.5 sm:gap-2 px-3 sm:px-4 py-2 rounded-lg text-xs sm:text-sm font-medium transition-all whitespace-nowrap ${
                active
                  ? 'bg-surface-light text-accent shadow-sm border border-border/50'
                  : 'text-muted hover:text-foreground hover:bg-surface-hover'
              }`}
            >
              <Icon className="size-3.5 sm:size-4 shrink-0" />
              <span className="sm:hidden">{t.shortLabel}</span>
              <span className="hidden sm:inline">{t.label}</span>
            </button>
          );
        })}
      </div>

      {/* Tab content */}
      {tab === 'whatsapp' && <WhatsAppConfig />}
      {tab === 'templates' && <TemplateManager />}
      {tab === 'tags' && <TagManager />}
    </div>
  );
}
