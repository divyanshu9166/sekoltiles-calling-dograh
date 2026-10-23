'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  MessageSquare, Radio, Bot, Settings,
  BarChart3, Wifi, WifiOff, Loader2, Megaphone,
  Users, Kanban, Terminal, BrainCircuit
} from 'lucide-react';
import { useTotalUnread } from '@/lib/use-total-unread';

import { OverviewTab } from '@/components/whatsapp/dashboard/overview-tab';
import { InboxTab } from '@/components/whatsapp/inbox/inbox-tab';
import { BroadcastsTab } from '@/components/whatsapp/broadcasts/broadcasts-tab';
import { AutomationsTab } from '@/components/whatsapp/automations/automations-tab';
import { ContactsTab } from '@/components/whatsapp/contacts/contacts-tab';
import { PipelinesTab } from '@/components/whatsapp/pipelines/pipelines-tab';
import { SettingsTab } from '@/components/whatsapp/settings/settings-tab';
import { ApiLogsTab } from '@/components/whatsapp/logs/api-logs-tab';
import { AgentTab } from '@/components/whatsapp/agent/agent-tab';

const TABS = [
  { id: 'overview', label: 'Overview', icon: BarChart3 },
  { id: 'inbox', label: 'Inbox', icon: MessageSquare },
  { id: 'broadcasts', label: 'Broadcasts', icon: Radio },
  { id: 'automations', label: 'Automations', icon: Bot },
  { id: 'contacts', label: 'Contacts', icon: Users },
  { id: 'pipelines', label: 'Pipelines', icon: Kanban },
  { id: 'agent', label: 'AI Agent', icon: BrainCircuit },
  { id: 'settings', label: 'Settings', icon: Settings },
  { id: 'logs', label: 'API Logs', icon: Terminal },
] as const;

type TabId = (typeof TABS)[number]['id'];

function isTabId(value: string | null): value is TabId {
  return !!value && TABS.some((tab) => tab.id === value);
}

export function WhatsAppMarketingClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [waConfig, setWaConfig] = useState<{ connected?: boolean } | null>(null);
  const [configLoading, setConfigLoading] = useState(true);
  const totalUnread = useTotalUnread();
  const queryTab = searchParams.get('tab');
  const activeTab: TabId = isTabId(queryTab) ? queryTab : 'overview';

  const setActiveTab = (tabId: TabId) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set('tab', tabId);

    if (tabId !== 'inbox') {
      params.delete('c');
    }

    if (tabId !== 'settings') {
      params.delete('settingsTab');
    }

    router.replace(`/whatsapp-marketing?${params.toString()}`, { scroll: false });
  };

  const refreshConfig = useCallback(() => {
    fetch('/api/whatsapp/config', { cache: 'no-store' })
      .then((r) => r.json())
      .then((data) => {
        setWaConfig(data);
        setConfigLoading(false);
      })
      .catch(() => { setWaConfig(null); setConfigLoading(false); });
  }, []);

  useEffect(() => {
    refreshConfig();
  }, [refreshConfig]);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const handler = () => { setConfigLoading(true); refreshConfig(); };
    window.addEventListener('wa-config-updated', handler);
    return () => window.removeEventListener('wa-config-updated', handler);
  }, [refreshConfig]);

  useEffect(() => {
    document.body.classList.add('wa-light-active');
    return () => {
      document.body.classList.remove('wa-light-active');
    };
  }, []);

  const isInbox = activeTab === 'inbox';

  return (
    // When inbox is active we switch to a full-height flex-column layout so
    // the thread + composer can fill the remaining viewport without overflow.
    <div className={isInbox
      ? 'wa-marketing ui-inbox-shell min-w-0 min-h-0 -m-3.5 md:-m-6 flex flex-col h-[calc(100dvh-56px)] md:h-[calc(100dvh-64px)]'
      : 'wa-marketing wa-light min-w-0 space-y-6'
    }>
      {/* ── Page header + tab bar ─────────────────────────────────────── */}
      <div className={isInbox
        ? 'shrink-0 border-b border-border bg-background px-3.5 md:px-6 pt-4 md:pt-5 pb-0'
        : ''
      }>
        <div className="ui-page-header flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-4">
          <div>
            <h1 className="text-xl font-bold text-foreground flex items-center gap-2">
              <Megaphone className="w-6 h-6 text-accent" />
              WhatsApp Marketing
            </h1>
            <p className="text-sm text-muted mt-1">
              Manage conversations, broadcasts, and automations
            </p>
          </div>
          <ConnectionBadge config={waConfig} loading={configLoading} />
        </div>

        <div className="ui-tabs flex gap-1 p-1 bg-surface rounded-xl border border-border overflow-x-auto hide-scrollbar mb-0">
          {TABS.map(tab => {
            const Icon = tab.icon;
            const active = activeTab === tab.id;
            const badge = tab.id === 'inbox' && totalUnread > 0 ? totalUnread : null;
            return (
              <button
                key={tab.id}
                aria-current={active ? 'page' : undefined}
                onClick={() => setActiveTab(tab.id)}
                className={`flex shrink-0 items-center gap-2 px-4 min-h-[42px] py-2.5 rounded-lg text-sm font-medium transition-all whitespace-nowrap tap-press-sm md:min-h-0 ${active
                  ? 'bg-surface text-accent shadow-sm border border-border/50'
                  : 'text-muted hover:text-foreground hover:bg-surface-hover'
                  }`}
              >
                <Icon className="w-4 h-4" />
                {tab.label}
                {badge && (
                  <span className="ml-1 px-1.5 py-0.5 rounded-full bg-success text-surface text-[10px] font-bold leading-none">
                    {badge > 99 ? '99+' : badge}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Tab content ──────────────────────────────────────────────── */}
      {/* Inbox gets a flex-1 min-h-0 wrapper so it fills remaining height */}
      {activeTab === 'inbox' && (
        <div className="flex-1 min-h-0 overflow-hidden">
          <InboxTab />
        </div>
      )}
      {activeTab === 'overview' && <OverviewTab />}
      {activeTab === 'broadcasts' && <BroadcastsTab />}
      {activeTab === 'automations' && <AutomationsTab />}
      {activeTab === 'contacts' && <ContactsTab />}
      {activeTab === 'pipelines' && <PipelinesTab />}
      {activeTab === 'agent' && <AgentTab />}
      {activeTab === 'settings' && <SettingsTab />}
      {activeTab === 'logs' && <ApiLogsTab />}
    </div>
  );
}

function ConnectionBadge({ config, loading }: { config: { connected?: boolean } | null, loading: boolean }) {
  if (loading) return <div className="px-3 py-1.5 rounded-full bg-surface border border-border text-xs text-muted flex items-center gap-2"><Loader2 className="w-3 h-3 animate-spin" />Checking...</div>;
  const connected = config?.connected;
  return (
    <div aria-label={connected ? 'WhatsApp Connected' : 'Not Connected'} title={connected ? 'WhatsApp Connected' : 'Not Connected'} className={`wa-connection-badge px-3 py-1.5 rounded-full text-xs font-medium flex items-center gap-2 ${connected ? 'bg-success-light text-success border border-success/20' : 'bg-warning-light text-warning border border-warning/20'}`}>
      {connected ? <Wifi className="w-3 h-3" /> : <WifiOff className="w-3 h-3" />}
      <span className="wa-connection-label">{connected ? 'WhatsApp Connected' : 'Not Connected'}</span>
    </div>
  );
}
