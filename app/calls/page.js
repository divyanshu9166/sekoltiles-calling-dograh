'use client';

import { useState, useEffect, useMemo, useRef } from 'react';
import {
  Phone,
  PhoneIncoming,
  PhoneOutgoing,
  PhoneMissed,
  PhoneOff,
  Clock,
  Search,
  Filter,
  Calendar,
  User,
  MessageSquare,
  Play,
  ChevronDown,
  ChevronRight,
  BookOpen,
  Plus,
  ArrowUpRight,
  ArrowDownLeft,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Tag,
  Mail,
  FileText,
  BarChart3,
  TrendingUp,
  Users,
  CalendarPlus,
  X,
  Bot,
  PhoneCall,
  PhoneForwarded,
  Mic,
  MicOff,
  Wifi,
  WifiOff,
  Settings,
  LogOut,
  Loader2,
  Volume2,
  Megaphone,
  Upload,
  PauseCircle,
  RefreshCw,
  Sheet,
} from 'lucide-react';
import StatCard from '@/components/StatCard';
import Modal from '@/components/Modal';
import ThemeToggle from '@/components/ThemeToggle';
import { getCallLogs, initiateAICall, getAIAgentStatus } from '@/app/actions/calls';
import { createAppointment, getAppointments, updateAppointmentStatus } from '@/app/actions/appointments';

const TABS = [
  { id: 'ai-caller', label: 'AI Caller', icon: Bot },
  { id: 'campaigns', label: 'Bulk Campaigns', icon: Megaphone },
  { id: 'logs', label: 'Call Logs', icon: Phone },
  { id: 'phonebook', label: 'Phone Book', icon: BookOpen },
  { id: 'transcripts', label: 'Transcripts', icon: MessageSquare },
  { id: 'appointments', label: 'Appointments', icon: CalendarPlus },
  { id: 'analytics', label: 'Analytics', icon: BarChart3 },
  { id: 'settings', label: 'Settings', icon: Settings },
];

const directionFilters = ['All', 'Inbound', 'Outbound'];
const statusFilters = ['All', 'Completed', 'Missed', 'No Answer', 'Busy'];
const tagFilters = ['All', 'Hot Lead', 'Warm Lead', 'Cold Lead', 'Customer', 'Unknown'];
const EMPTY_APPOINTMENT = { customer: '', phone: '', date: '', time: '', purpose: '', region: '', notes: '' };
const DEFAULT_CAMPAIGN_INSTRUCTIONS = 'Introduce the 12x18 and 12x24 tile range. Ask which size the customer requires, whether they want the catalog, and whether they want a showroom visit. If they want to visit, offer to book an appointment.';

export default function CallsPage() {
  const [callLogs, setCallLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('ai-caller');
  const [searchQuery, setSearchQuery] = useState('');
  const [directionFilter, setDirectionFilter] = useState('All');
  const [statusFilter, setStatusFilter] = useState('All');
  const [tagFilter, setTagFilter] = useState('All');
  const [selectedCall, setSelectedCall] = useState(null);
  const [selectedTranscript, setSelectedTranscript] = useState(null);
  const [selectedContact, setSelectedContact] = useState(null);
  const [showAddContactModal, setShowAddContactModal] = useState(false);
  const [expandedTranscript, setExpandedTranscript] = useState(null);
  const [appointments, setAppointments] = useState([]);
  const [appointmentForm, setAppointmentForm] = useState(EMPTY_APPOINTMENT);
  const [appointmentLoading, setAppointmentLoading] = useState(false);
  const [appointmentMessage, setAppointmentMessage] = useState('');
  const [settingsForm, setSettingsForm] = useState({ username: '', currentPassword: '', newPassword: '', confirmPassword: '' });
  const [settingsLoading, setSettingsLoading] = useState(false);
  const [settingsMessage, setSettingsMessage] = useState('');
  const [settingsError, setSettingsError] = useState('');
  const [callHandlingForm, setCallHandlingForm] = useState({ transferPhone: '' });
  const [callHandlingLoading, setCallHandlingLoading] = useState(false);
  const [callHandlingMessage, setCallHandlingMessage] = useState('');
  const [callHandlingError, setCallHandlingError] = useState('');

  // AI Caller state
  const [agentStatus, setAgentStatus] = useState(null);
  const [outboundPhone, setOutboundPhone] = useState('');
  const [outboundName, setOutboundName] = useState('');
  const [outboundReason, setOutboundReason] = useState('');
  const [outboundRegion, setOutboundRegion] = useState('');
  const [customReason, setCustomReason] = useState('');
  const [callingState, setCallingState] = useState('idle'); // idle | calling | connected | ended
  const [activeCallLogId, setActiveCallLogId] = useState(null);
  const [browserCallState, setBrowserCallState] = useState('idle'); // idle | connecting | connected
  const [callMessage, setCallMessage] = useState('');
  const dograhWidgetReadyRef = useRef(false);
  const campaignFileInputRef = useRef(null);
  const campaignEditDirtyRef = useRef(false);
  const [campaigns, setCampaigns] = useState([]);
  const [selectedCampaignId, setSelectedCampaignId] = useState(null);
  const [campaignDetail, setCampaignDetail] = useState(null);
  const [campaignForm, setCampaignForm] = useState({
    name: '',
    instructions: DEFAULT_CAMPAIGN_INSTRUCTIONS,
    googleSheetUrl: '',
    interCallDelaySec: 15,
  });
  const [campaignFile, setCampaignFile] = useState(null);
  const [campaignLoading, setCampaignLoading] = useState(false);
  const [campaignMessage, setCampaignMessage] = useState('');
  const [campaignError, setCampaignError] = useState('');
  const [campaignEdit, setCampaignEdit] = useState({ name: '', instructions: '', interCallDelaySec: 15 });

  const refreshLogs = () => {
    getCallLogs().then(res => {
      if (res.success) setCallLogs(res.data);
    });
  };

  const refreshAppointments = () => {
    getAppointments().then(res => {
      if (res.success) setAppointments(res.data);
    });
  };

  const refreshCampaigns = async () => {
    const response = await fetch('/api/campaigns', { cache: 'no-store' });
    const result = await response.json();
    if (response.status === 401) {
      window.location.replace('/auth/login');
      return [];
    }
    if (!response.ok) throw new Error(result.error || 'Could not load campaigns.');
    setCampaigns(result.campaigns || []);
    return result.campaigns || [];
  };

  const loadCampaignDetail = async (id) => {
    if (!id) return;
    const response = await fetch(`/api/campaigns/${id}`, { cache: 'no-store' });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Could not load campaign details.');
    setCampaignDetail(result.campaign);
    if (!campaignEditDirtyRef.current) {
      setCampaignEdit({
        name: result.campaign.name,
        instructions: result.campaign.instructions,
        interCallDelaySec: result.campaign.interCallDelaySec,
      });
    }
  };

  useEffect(() => {
    getCallLogs().then(res => {
      if (res.success) setCallLogs(res.data);
      setLoading(false);
    });
    getAIAgentStatus().then(res => {
      if (res.success) setAgentStatus(res.data);
    });
    refreshAppointments();
  }, []);

  // Auto-refresh while either calling mode is active.
  useEffect(() => {
    if (callingState !== 'connected' && browserCallState !== 'connected') return;
    const interval = setInterval(refreshLogs, 15000);
    return () => clearInterval(interval);
  }, [callingState, browserCallState]);

  useEffect(() => {
    if (!activeCallLogId) return;
    const activeCall = callLogs.find((call) => call.id === activeCallLogId);
    if (!activeCall) return;
    if (['Completed', 'No answer', 'Busy', 'Failed', 'Missed'].includes(activeCall.status)) {
      setCallingState('ended');
      setCallMessage(`Call finished: ${activeCall.outcome || activeCall.status}.`);
    }
  }, [activeCallLogId, callLogs]);

  // A call may finish while another tab is open. Always load fresh database
  // state when the user opens logs or transcripts.
  useEffect(() => {
    if (activeTab !== 'logs' && activeTab !== 'transcripts') return;
    getCallLogs().then(res => {
      if (res.success) setCallLogs(res.data);
    });
  }, [activeTab]);

  useEffect(() => {
    if (activeTab === 'appointments') refreshAppointments();
  }, [activeTab]);

  useEffect(() => {
    if (activeTab !== 'campaigns') return;
    let cancelled = false;
    const refresh = async () => {
      try {
        const list = await refreshCampaigns();
        if (cancelled) return;
        const id = selectedCampaignId || list[0]?.id;
        if (id) {
          if (!selectedCampaignId) setSelectedCampaignId(id);
          await loadCampaignDetail(id);
        }
      } catch (error) {
        if (!cancelled) setCampaignError(error.message || 'Could not refresh campaigns.');
      }
    };
    refresh();
    const interval = setInterval(refresh, 5000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [activeTab, selectedCampaignId]);

  useEffect(() => {
    if (activeTab !== 'settings') return;
    setSettingsError('');
    setSettingsMessage('');
    fetch('/api/auth/settings', { cache: 'no-store' })
      .then(async (response) => {
        const result = await response.json();
        if (response.status === 401) {
          window.location.replace('/auth/login');
          return;
        }
        if (response.ok && result.user) {
          setSettingsForm((current) => ({ ...current, username: result.user.username }));
        }
      })
      .catch(() => setSettingsError('Could not load account settings.'));
    setCallHandlingError('');
    setCallHandlingMessage('');
    fetch('/api/settings/call-handling', { cache: 'no-store' })
      .then(async (response) => {
        const result = await response.json();
        if (response.status === 401) {
          window.location.replace('/auth/login');
          return;
        }
        if (response.ok && result.settings) {
          setCallHandlingForm({ transferPhone: result.settings.transferPhone || '' });
          return;
        }
        setCallHandlingError(result.error || 'Could not load call handling settings.');
      })
      .catch(() => setCallHandlingError('Could not load call handling settings.'));
  }, [activeTab]);

  useEffect(() => () => {
    window.DograhWidget?.end();
  }, []);

  async function handleSettingsSubmit(event) {
    event.preventDefault();
    setSettingsLoading(true);
    setSettingsError('');
    setSettingsMessage('');
    if (settingsForm.newPassword && settingsForm.newPassword.length < 8) {
      setSettingsError('New password must be at least 8 characters.');
      setSettingsLoading(false);
      return;
    }
    if (settingsForm.newPassword !== settingsForm.confirmPassword) {
      setSettingsError('New password and confirmation do not match.');
      setSettingsLoading(false);
      return;
    }
    try {
      const response = await fetch('/api/auth/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: settingsForm.username,
          currentPassword: settingsForm.currentPassword,
          newPassword: settingsForm.newPassword,
        }),
      });
      const result = await response.json();
      if (!response.ok) {
        setSettingsError(result.error || 'Could not update credentials.');
        return;
      }
      setSettingsForm((current) => ({ ...current, username: result.user.username, currentPassword: '', newPassword: '', confirmPassword: '' }));
      setSettingsMessage('Credentials updated. Your current browser session remains active.');
    } catch {
      setSettingsError('Unable to reach the server. Try again.');
    } finally {
      setSettingsLoading(false);
    }
  }

  async function handleCallHandlingSubmit(event) {
    event.preventDefault();
    setCallHandlingLoading(true);
    setCallHandlingError('');
    setCallHandlingMessage('');
    try {
      const response = await fetch('/api/settings/call-handling', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(callHandlingForm),
      });
      const result = await response.json();
      if (!response.ok) {
        setCallHandlingError(result.error || 'Could not update the transfer number.');
        return;
      }
      setCallHandlingForm({ transferPhone: result.settings.transferPhone });
      setCallHandlingMessage('Transfer number saved and published to the live AI agent.');
    } catch {
      setCallHandlingError('Unable to reach the server. Try again.');
    } finally {
      setCallHandlingLoading(false);
    }
  }

  async function handleLogout() {
    await fetch('/api/auth/logout', { method: 'POST' }).catch(() => {});
    window.location.replace('/auth/login');
  }

  async function handleCampaignCreate(event) {
    event.preventDefault();
    setCampaignLoading(true);
    setCampaignError('');
    setCampaignMessage('');
    try {
      const data = new FormData();
      data.set('name', campaignForm.name);
      data.set('instructions', campaignForm.instructions);
      data.set('googleSheetUrl', campaignForm.googleSheetUrl);
      data.set('interCallDelaySec', String(campaignForm.interCallDelaySec));
      if (campaignFile) data.set('file', campaignFile);
      const response = await fetch('/api/campaigns', { method: 'POST', body: data });
      const result = await response.json();
      if (!response.ok) {
        setCampaignError(result.error || 'Campaign could not be created.');
        return;
      }
      setCampaignForm({ name: '', instructions: DEFAULT_CAMPAIGN_INSTRUCTIONS, googleSheetUrl: '', interCallDelaySec: 15 });
      setCampaignFile(null);
      if (campaignFileInputRef.current) campaignFileInputRef.current.value = '';
      campaignEditDirtyRef.current = false;
      setSelectedCampaignId(result.campaign.id);
      await refreshCampaigns();
      await loadCampaignDetail(result.campaign.id);
      const imported = result.import;
      setCampaignMessage(`Campaign created with ${imported.acceptedRows} contacts. ${imported.rejectedRows} invalid and ${imported.duplicateRows} duplicate rows skipped.`);
    } catch (error) {
      setCampaignError(error.message || 'Campaign could not be created.');
    } finally {
      setCampaignLoading(false);
    }
  }

  async function handleCampaignControl(action) {
    if (!campaignDetail) return;
    setCampaignLoading(true);
    setCampaignError('');
    setCampaignMessage('');
    try {
      const response = await fetch(`/api/campaigns/${campaignDetail.id}/control`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Campaign action failed.');
      await refreshCampaigns();
      await loadCampaignDetail(campaignDetail.id);
      setCampaignMessage(action === 'pause' ? 'Campaign paused. The active call can finish; no new call will start.' : 'Campaign started. Contacts will be called one at a time.');
    } catch (error) {
      setCampaignError(error.message || 'Campaign action failed.');
    } finally {
      setCampaignLoading(false);
    }
  }

  async function handleCampaignUpdate(event) {
    event.preventDefault();
    if (!campaignDetail) return;
    setCampaignLoading(true);
    setCampaignError('');
    setCampaignMessage('');
    try {
      const response = await fetch(`/api/campaigns/${campaignDetail.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(campaignEdit),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Campaign instructions could not be saved.');
      campaignEditDirtyRef.current = false;
      await refreshCampaigns();
      await loadCampaignDetail(campaignDetail.id);
      setCampaignMessage('Campaign instructions saved. Future calls will use the updated script.');
    } catch (error) {
      setCampaignError(error.message || 'Campaign instructions could not be saved.');
    } finally {
      setCampaignLoading(false);
    }
  }

  // Derive phone book from call logs
  const phoneBook = useMemo(() => {
    const map = {};
    callLogs.forEach(c => {
      if (!map[c.phone]) {
        map[c.phone] = { name: c.customer, phone: c.phone, totalCalls: 0, lastCall: c.date, tag: 'Customer' };
      }
      map[c.phone].totalCalls++;
    });
    return Object.values(map);
  }, [callLogs]);

  // Derive transcripts from call logs with transcripts
  const callTranscripts = useMemo(() => {
    return callLogs.filter(c => c.transcript).map(c => ({
      id: c.id, customer: c.customer, phone: c.phone, date: c.date, time: c.time,
      direction: c.direction, duration: c.duration,
      summary: c.transcript.summary || 'AI-handled call', sentiment: c.transcript.sentiment || 'Neutral',
      messages: Array.isArray(c.transcript.messages) ? c.transcript.messages : [],
    }));
  }, [callLogs]);

  // Filtered call logs
  const filteredLogs = useMemo(() => {
    return callLogs.filter((call) => {
      const matchesSearch =
        call.customer.toLowerCase().includes(searchQuery.toLowerCase()) ||
        call.phone.includes(searchQuery);
      const matchesDirection = directionFilter === 'All' || call.direction === directionFilter;
      const matchesStatus = statusFilter === 'All' || call.status === statusFilter;
      return matchesSearch && matchesDirection && matchesStatus;
    });
  }, [searchQuery, directionFilter, statusFilter, callLogs]);

  // Filtered phone book
  const filteredPhoneBook = useMemo(() => {
    return phoneBook.filter((contact) => {
      const matchesSearch =
        contact.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        contact.phone.includes(searchQuery);
      const matchesTag = tagFilter === 'All' || contact.tag === tagFilter;
      return matchesSearch && matchesTag;
    });
  }, [searchQuery, tagFilter, phoneBook]);

  // Filtered transcripts
  const filteredTranscripts = useMemo(() => {
    return callTranscripts.filter((t) => {
      return (
        t.customer.toLowerCase().includes(searchQuery.toLowerCase()) ||
        t.phone.includes(searchQuery) ||
        (t.summary || '').toLowerCase().includes(searchQuery.toLowerCase())
      );
    });
  }, [searchQuery, callTranscripts]);

  // Compute detailed stats from callLogs
  const computedStats = useMemo(() => {
    const today = new Date();
    const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    const todayCalls = callLogs.filter(c => c.date === todayStr);
    const inbound = callLogs.filter(c => c.direction === 'Inbound').length;
    const outbound = callLogs.filter(c => c.direction === 'Outbound').length;
    const completed = callLogs.filter(c => c.status === 'Completed').length;
    const missed = callLogs.filter(c => c.status === 'Missed').length;
    const noAnswer = callLogs.filter(c => c.status === 'No answer' || c.status === 'No Answer').length;
    const busy = callLogs.filter(c => c.status === 'Busy').length;
    const totalSec = callLogs.reduce((s, c) => s + (c.durationSec || 0), 0);
    const avgSec = callLogs.length > 0 ? Math.round(totalSec / callLogs.length) : 0;
    const avgMin = Math.floor(avgSec / 60);
    const avgSecR = avgSec % 60;
    return {
      totalCalls: callLogs.length,
      todayCalls: todayCalls.length,
      todayInbound: todayCalls.filter(c => c.direction === 'Inbound').length,
      todayOutbound: todayCalls.filter(c => c.direction === 'Outbound').length,
      inbound, outbound, completed, missed, noAnswer, busy,
      avgDuration: `${avgMin}:${String(avgSecR).padStart(2, '0')}`,
      appointmentsBooked: appointments.length,
      quotationsSent: callLogs.filter(c => (c.outcome || '').toLowerCase().includes('quotation')).length,
    };
  }, [callLogs, appointments]);
  // Use computedStats as callStats
  const callStats = computedStats;

  if (loading) {
    return (
      <div className="space-y-6 animate-pulse">
        <div className="h-8 w-48 bg-surface rounded-lg" />
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">{[1, 2, 3, 4].map(i => <div key={i} className="h-24 bg-surface rounded-2xl" />)}</div>
        <div className="h-64 bg-surface rounded-2xl" />
      </div>
    );
  }

  const getDirectionIcon = (direction) => {
    if (direction === 'Inbound') return <ArrowDownLeft className="w-4 h-4 text-teal-700" />;
    return <ArrowUpRight className="w-4 h-4 text-amber-700" />;
  };

  const getStatusBadge = (status) => {
    if (status === 'Queued') return <span className="px-2 py-0.5 rounded-full text-xs border bg-blue-500/10 text-blue-700 border-blue-500/20">Queued</span>;
    if (status === 'In progress') return <span className="px-2 py-0.5 rounded-full text-xs border bg-amber-500/10 text-amber-700 border-amber-500/20">In progress</span>;
    if (status === 'Failed') return <span className="px-2 py-0.5 rounded-full text-xs border bg-red-500/10 text-red-700 border-red-500/20">Failed</span>;
    const styles = {
      Completed: 'bg-emerald-500/10 text-emerald-700 border-emerald-500/20',
      Missed: 'bg-red-500/10 text-red-700 border-red-500/20',
      'No Answer': 'bg-orange-500/10 text-orange-700 border-orange-500/20',
      Busy: 'bg-yellow-500/10 text-yellow-700 border-yellow-500/20',
    };
    return (
      <span className={`px-2 py-0.5 rounded-full text-xs border ${styles[status] || ''}`}>
        {status}
      </span>
    );
  };

  const getTagBadge = (tag) => {
    const styles = {
      'Hot Lead': 'bg-red-500/10 text-red-700 border-red-500/20',
      'Warm Lead': 'bg-orange-500/10 text-orange-700 border-orange-500/20',
      'Cold Lead': 'bg-blue-500/10 text-blue-700 border-blue-500/20',
      Customer: 'bg-emerald-500/10 text-emerald-700 border-emerald-500/20',
      Unknown: 'bg-zinc-500/10 text-stone-500 border-zinc-500/20',
    };
    return (
      <span className={`px-2 py-0.5 rounded-full text-xs border ${styles[tag] || ''}`}>
        {tag}
      </span>
    );
  };

  const getSentimentBadge = (sentiment) => {
    const styles = {
      Positive: 'bg-emerald-500/10 text-emerald-700 border-emerald-500/20',
      Neutral: 'bg-zinc-500/10 text-stone-500 border-zinc-500/20',
      Negative: 'bg-red-500/10 text-red-700 border-red-500/20',
    };
    return (
      <span className={`px-2 py-0.5 rounded-full text-xs border ${styles[sentiment] || ''}`}>
        {sentiment}
      </span>
    );
  };

  const getOutcomeBadge = (outcome) => {
    const positiveOutcomes = ['Appointment Booked', 'Quote Sent', 'Confirmed', 'Resolved', 'Review Collected', 'Informed', 'Interested'];
    const neutralOutcomes = ['Transferred to Human', 'Callback Scheduled', 'Voicemail Left'];
    const negativeOutcomes = ['Escalated', 'Retry Later'];

    let cls = 'bg-zinc-500/10 text-stone-500 border-zinc-500/20';
    if (positiveOutcomes.includes(outcome)) cls = 'bg-emerald-500/10 text-emerald-700 border-emerald-500/20';
    else if (neutralOutcomes.includes(outcome)) cls = 'bg-amber-500/10 text-amber-700 border-amber-500/20';
    else if (negativeOutcomes.includes(outcome)) cls = 'bg-red-500/10 text-red-700 border-red-500/20';

    return (
      <span className={`px-2 py-0.5 rounded-full text-xs border ${cls}`}>
        {outcome}
      </span>
    );
  };

  // ─── CALL LOGS TAB ───
  const renderCallLogs = () => (
    <div>
      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <StatCard icon={Phone} label="Total Calls Today" value={callStats.todayCalls} trend="+3 vs yesterday" positive />
        <StatCard icon={PhoneIncoming} label="Inbound" value={callStats.todayInbound} trend={`${callStats.inbound} total`} positive />
        <StatCard icon={PhoneOutgoing} label="Outbound" value={callStats.todayOutbound} trend={`${callStats.outbound} total`} positive />
        <StatCard icon={Clock} label="Avg Duration" value={callStats.avgDuration} trend="min:sec" />
      </div>

      {/* Filters — Desktop (md+) */}
      <div className="hidden md:flex flex-wrap items-center gap-3 mb-4">
        <div className="relative flex-1 min-w-[200px] max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted" />
          <input
            type="text"
            placeholder="Search by name or phone..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-2 bg-surface border border-border rounded-xl text-sm text-foreground placeholder:text-muted focus:outline-none focus:border-accent/50"
          />
        </div>
        <div className="flex gap-1">
          {directionFilters.map((f) => (
            <button
              key={f}
              onClick={() => setDirectionFilter(f)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${directionFilter === f
                ? 'bg-accent/20 text-accent border border-accent/30'
                : 'bg-surface border border-border text-muted hover:text-foreground'
                }`}
            >
              {f}
            </button>
          ))}
        </div>
        <div className="flex gap-1">
          {statusFilters.map((f) => (
            <button
              key={f}
              onClick={() => setStatusFilter(f)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${statusFilter === f
                ? 'bg-accent/20 text-accent border border-accent/30'
                : 'bg-surface border border-border text-muted hover:text-foreground'
                }`}
            >
              {f}
            </button>
          ))}
        </div>
      </div>

      {/* Filters — Mobile (full-width search + horizontally scrollable chips) */}
      <div className="md:hidden space-y-3 mb-4">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted" />
          <input
            type="text"
            placeholder="Search by name or phone..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-3 bg-surface border border-border rounded-xl text-sm text-foreground placeholder:text-muted focus:outline-none focus:border-accent/50"
          />
        </div>
        <div className="flex gap-2 overflow-x-auto no-scrollbar -mx-1 px-1 pb-0.5">
          {directionFilters.map((f) => (
            <button
              key={f}
              onClick={() => setDirectionFilter(f)}
              className={`flex-shrink-0 px-4 py-2 rounded-full text-sm font-medium whitespace-nowrap transition-all ${directionFilter === f
                ? 'bg-accent/20 text-accent border border-accent/30'
                : 'bg-surface border border-border text-muted'
                }`}
            >
              {f}
            </button>
          ))}
        </div>
        <div className="flex gap-2 overflow-x-auto no-scrollbar -mx-1 px-1 pb-0.5">
          {statusFilters.map((f) => (
            <button
              key={f}
              onClick={() => setStatusFilter(f)}
              className={`flex-shrink-0 px-4 py-2 rounded-full text-sm font-medium whitespace-nowrap transition-all ${statusFilter === f
                ? 'bg-accent/20 text-accent border border-accent/30'
                : 'bg-surface border border-border text-muted'
                }`}
            >
              {f}
            </button>
          ))}
        </div>
      </div>

      {/* Call Logs Table */}
      {/* Mobile-friendly card list (visible on small screens) */}
      <div className="space-y-3 md:hidden">
        {filteredLogs.map((call) => (
          <div key={call.id} className="glass-card p-4" onClick={() => setSelectedCall(call)}>
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  {getDirectionIcon(call.direction)}
                  <p className="text-sm font-semibold text-foreground truncate">{call.customer}</p>
                </div>
                <p className="text-xs text-muted truncate mt-0.5">{call.phone}</p>
              </div>
              {getStatusBadge(call.status)}
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted">
              <span>{call.date}</span>
              <span>•</span>
              <span>{call.time}</span>
              <span>•</span>
              <span>{call.duration}</span>
            </div>
            <p className="text-xs text-muted mt-2 line-clamp-2">{call.purpose}</p>
            <div className="mt-3 flex items-center justify-between">
              {getOutcomeBadge(call.outcome)}
              <div className="flex items-center gap-2">
                {call.recording && (
                  <button
                    className="touch-target flex items-center justify-center rounded-xl bg-surface-hover text-muted hover:text-accent transition-colors"
                    title="Play recording"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <Play className="w-4 h-4" />
                  </button>
                )}
                <button
                  className="touch-target flex items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-700 hover:bg-emerald-500/20 transition-colors"
                  title="Call back"
                  onClick={(e) => e.stopPropagation()}
                >
                  <Phone className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="hidden md:block glass-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="crm-table">
            <thead>
              <tr>
                <th>Direction</th>
                <th>Customer</th>
                <th>Phone</th>
                <th>Date & Time</th>
                <th>Duration</th>
                <th>Purpose</th>
                <th>Status</th>
                <th>Outcome</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredLogs.map((call) => (
                <tr key={call.id} className="cursor-pointer" onClick={() => setSelectedCall(call)}>
                  <td>
                    <div className="flex items-center gap-2">
                      {getDirectionIcon(call.direction)}
                      <span className="text-xs text-muted">{call.direction}</span>
                    </div>
                  </td>
                  <td className="font-medium text-foreground">{call.customer}</td>
                  <td className="text-muted">{call.phone}</td>
                  <td>
                    <div className="text-sm">{call.date}</div>
                    <div className="text-xs text-muted">{call.time}</div>
                  </td>
                  <td className={call.durationSec === 0 ? 'text-muted' : 'text-foreground'}>{call.duration}</td>
                  <td className="text-sm max-w-[200px] truncate">{call.purpose}</td>
                  <td>{getStatusBadge(call.status)}</td>
                  <td>{getOutcomeBadge(call.outcome)}</td>
                  <td>
                    <div className="flex items-center gap-1">
                      {call.recording && (
                        <button
                          className="p-1.5 rounded-lg bg-surface-hover text-muted hover:text-accent transition-colors"
                          title="Play recording"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <Play className="w-3.5 h-3.5" />
                        </button>
                      )}
                      <button
                        className="p-1.5 rounded-lg bg-surface-hover text-muted hover:text-emerald-700 transition-colors"
                        title="Call back"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <Phone className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );

  // ─── PHONE BOOK TAB ───
  const renderPhoneBook = () => (
    <div>
      {/* Filters — Desktop (md+) */}
      <div className="hidden md:flex flex-wrap items-center gap-3 mb-4">
        <div className="relative flex-1 min-w-[200px] max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted" />
          <input
            type="text"
            placeholder="Search contacts..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-2 bg-surface border border-border rounded-xl text-sm text-foreground placeholder:text-muted focus:outline-none focus:border-accent/50"
          />
        </div>
        <div className="flex flex-wrap gap-2">
          {tagFilters.map((f) => (
            <button
              key={f}
              onClick={() => setTagFilter(f)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${tagFilter === f
                ? 'bg-accent/20 text-accent border border-accent/30'
                : 'bg-surface border border-border text-muted hover:text-foreground'
                }`}
            >
              {f}
            </button>
          ))}
        </div>
        <button
          onClick={() => setShowAddContactModal(true)}
          className="ml-auto flex items-center gap-2 px-4 py-2 bg-accent text-white rounded-xl text-sm font-medium hover:bg-accent-hover transition-colors"
        >
          <Plus className="w-4 h-4" />
          Add Contact
        </button>
      </div>

      {/* Filters — Mobile (full-width search + scrollable chips + add button) */}
      <div className="md:hidden space-y-3 mb-4">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted" />
          <input
            type="text"
            placeholder="Search contacts..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-3 bg-surface border border-border rounded-xl text-sm text-foreground placeholder:text-muted focus:outline-none focus:border-accent/50"
          />
        </div>
        <div className="flex gap-2 overflow-x-auto no-scrollbar -mx-1 px-1 pb-0.5">
          {tagFilters.map((f) => (
            <button
              key={f}
              onClick={() => setTagFilter(f)}
              className={`flex-shrink-0 px-4 py-2 rounded-full text-sm font-medium whitespace-nowrap transition-all ${tagFilter === f
                ? 'bg-accent/20 text-accent border border-accent/30'
                : 'bg-surface border border-border text-muted'
                }`}
            >
              {f}
            </button>
          ))}
        </div>
        <button
          onClick={() => setShowAddContactModal(true)}
          className="touch-target w-full flex items-center justify-center gap-2 px-4 bg-accent text-white rounded-xl text-sm font-semibold hover:bg-accent-hover transition-colors"
        >
          <Plus className="w-4 h-4" />
          Add Contact
        </button>
      </div>

      {/* Phone Book Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {filteredPhoneBook.map((contact) => (
          <div
            key={contact.phone || contact.name}
            className="glass-card p-4 cursor-pointer hover:border-accent/30 transition-all"
            onClick={() => setSelectedContact(contact)}
          >
            <div className="flex items-start justify-between mb-3">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-accent/10 flex items-center justify-center">
                  <User className="w-5 h-5 text-accent" />
                </div>
                <div>
                  <h3 className="font-medium text-foreground">{contact.name}</h3>
                  <p className="text-xs text-muted">{contact.phone}</p>
                </div>
              </div>
              {getTagBadge(contact.tag)}
            </div>
            {contact.email && (
              <div className="flex items-center gap-2 text-xs text-muted mb-2">
                <Mail className="w-3.5 h-3.5" />
                {contact.email}
              </div>
            )}
            <div className="flex items-center justify-between text-xs text-muted pt-2 border-t border-border">
              <span>{contact.totalCalls} calls</span>
              <span>Last: {contact.lastCall}</span>
            </div>
            <p className="text-xs text-muted mt-2 truncate">{contact.notes}</p>
          </div>
        ))}
      </div>
    </div>
  );

  // ─── TRANSCRIPTS TAB ───
  const renderTranscripts = () => (
    <div>
      <div className="relative w-full md:max-w-md mb-4">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted" />
        <input
          type="text"
          placeholder="Search transcripts..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full pl-10 pr-4 py-3 md:py-2 bg-surface border border-border rounded-xl text-sm text-foreground placeholder:text-muted focus:outline-none focus:border-accent/50"
        />
      </div>

      <div className="space-y-3">
        {filteredTranscripts.length === 0 && (
          <div className="glass-card p-8 text-center">
            <MessageSquare className="mx-auto h-8 w-8 text-muted" />
            <p className="mt-3 font-medium text-foreground">No transcripts saved yet</p>
            <p className="mt-1 text-sm text-muted">Active AI calls appear here as the conversation progresses.</p>
          </div>
        )}
        {filteredTranscripts.map((transcript) => (
          <div key={transcript.id} className="glass-card overflow-hidden">
            {/* Header */}
            <div
              className="p-4 cursor-pointer hover:bg-surface-hover transition-colors"
              onClick={() =>
                setExpandedTranscript(expandedTranscript === transcript.id ? null : transcript.id)
              }
            >
              <div className="flex flex-wrap items-center justify-between gap-y-2">
                <div className="flex items-center gap-2 min-w-0">
                  {expandedTranscript === transcript.id ? (
                    <ChevronDown className="w-4 h-4 text-muted flex-shrink-0" />
                  ) : (
                    <ChevronRight className="w-4 h-4 text-muted flex-shrink-0" />
                  )}
                  <div className="flex items-center gap-2 min-w-0">
                    {getDirectionIcon(transcript.direction)}
                    <span className="font-medium text-foreground truncate">{transcript.customer}</span>
                  </div>
                  <span className="text-xs text-muted truncate">{transcript.phone}</span>
                </div>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pl-6 md:pl-0">
                  {getSentimentBadge(transcript.sentiment)}
                  <span className="text-xs text-muted">
                    {transcript.date} at {transcript.time}
                  </span>
                  <span className="text-xs text-muted flex items-center gap-1">
                    <Clock className="w-3 h-3" />
                    {transcript.duration}
                  </span>
                </div>
              </div>
              <p className="text-sm text-muted mt-2 ml-7">{transcript.summary}</p>
            </div>

            {/* Expanded Chat */}
            {expandedTranscript === transcript.id && (
              <div className="border-t border-border p-4 bg-surface-hover">
                <div className="space-y-3 max-h-[400px] overflow-y-auto pr-2">
                  {transcript.messages.map((msg, idx) => (
                    <div
                      key={idx}
                      className={`flex ${msg.from === 'agent' ? 'justify-start' : 'justify-end'}`}
                    >
                      <div
                        className={`max-w-[70%] rounded-2xl px-4 py-2.5 ${msg.from === 'agent'
                          ? 'bg-accent/10 border border-accent/20 text-foreground'
                          : 'bg-surface border border-border text-foreground'
                          }`}
                      >
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-[10px] font-semibold uppercase tracking-wider text-muted">
                            {msg.from === 'agent' ? 'AI Agent' : 'Customer'}
                          </span>
                          <span className="text-[10px] text-muted">{msg.time}</span>
                        </div>
                        <p className="text-sm leading-relaxed">{msg.text}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );

  const setAppointmentField = (field, value) => {
    setAppointmentForm((current) => ({ ...current, [field]: value }));
  };

  const handleAppointmentSubmit = async (event) => {
    event.preventDefault();
    if (appointmentLoading) return;
    setAppointmentLoading(true);
    setAppointmentMessage('');
    const result = await createAppointment(appointmentForm);
    if (result.success) {
      setAppointmentForm(EMPTY_APPOINTMENT);
      setAppointmentMessage('Appointment saved successfully.');
      refreshAppointments();
    } else {
      setAppointmentMessage(result.error || 'Appointment could not be saved.');
    }
    setAppointmentLoading(false);
  };

  const changeAppointmentStatus = async (id, status) => {
    const result = await updateAppointmentStatus(id, status);
    if (result.success) refreshAppointments();
    else setAppointmentMessage(result.error || 'Appointment status could not be updated.');
  };

  const prefillAppointmentFromCall = (call) => {
    setAppointmentForm((current) => ({
      ...current,
      customer: call.customer === 'Unknown Customer' ? '' : call.customer,
      phone: call.phone,
      purpose: call.purpose || '',
      region: call.region || '',
      notes: call.notes || `Follow-up from call on ${call.date}`,
    }));
    setAppointmentMessage('Call details added. Select the date and time to finish booking.');
  };

  // ─── APPOINTMENTS TAB ───
  const renderBookAppointment = () => {
    const recentCalls = callLogs.filter((c) => c.status === 'Completed').slice(0, 5);

    return (
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="glass-card p-6">
          <h3 className="text-lg font-semibold text-foreground mb-4 flex items-center gap-2">
            <CalendarPlus className="w-5 h-5 text-accent" />
            Book Appointment
          </h3>
          <form className="space-y-4" onSubmit={handleAppointmentSubmit}>
            <div>
              <label htmlFor="appointment-customer" className="text-sm text-muted mb-1 block">Customer Name</label>
              <input
                id="appointment-customer"
                name="customer"
                type="text"
                placeholder="Enter customer name"
                value={appointmentForm.customer}
                onChange={(event) => setAppointmentField('customer', event.target.value)}
                required
                className="w-full px-4 py-2.5 bg-surface border border-border rounded-xl text-sm text-foreground placeholder:text-muted focus:outline-none focus:border-accent/50"
              />
            </div>
            <div>
              <label htmlFor="appointment-phone" className="text-sm text-muted mb-1 block">Phone Number</label>
              <input
                id="appointment-phone"
                name="phone"
                type="tel"
                placeholder="+919876543210"
                value={appointmentForm.phone}
                onChange={(event) => setAppointmentField('phone', event.target.value)}
                required
                className="w-full px-4 py-2.5 bg-surface border border-border rounded-xl text-sm text-foreground placeholder:text-muted focus:outline-none focus:border-accent/50"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="appointment-date" className="text-sm text-muted mb-1 block">Date</label>
                <input
                  id="appointment-date"
                  name="date"
                  type="date"
                  value={appointmentForm.date}
                  min={new Date().toLocaleDateString('en-CA')}
                  onChange={(event) => setAppointmentField('date', event.target.value)}
                  required
                  className="w-full px-4 py-2.5 bg-surface border border-border rounded-xl text-sm text-foreground focus:outline-none focus:border-accent/50"
                />
              </div>
              <div>
                <label htmlFor="appointment-time" className="text-sm text-muted mb-1 block">Time</label>
                <select
                  id="appointment-time"
                  name="time"
                  value={appointmentForm.time}
                  onChange={(event) => setAppointmentField('time', event.target.value)}
                  required
                  className="w-full px-4 py-2.5 bg-surface border border-border rounded-xl text-sm text-foreground focus:outline-none focus:border-accent/50"
                >
                  <option value="">Select slot...</option>
                  {['10:00 AM', '11:00 AM', '12:00 PM', '2:00 PM', '3:00 PM', '4:00 PM', '5:00 PM'].map((slot) => (
                    <option key={slot} value={slot}>{slot}</option>
                  ))}
                </select>
              </div>
            </div>
            <div>
              <label htmlFor="appointment-purpose" className="text-sm text-muted mb-1 block">Purpose</label>
              <input
                id="appointment-purpose"
                name="purpose"
                type="text"
                placeholder="Showroom visit, product discussion..."
                value={appointmentForm.purpose}
                onChange={(event) => setAppointmentField('purpose', event.target.value)}
                required
                className="w-full px-4 py-2.5 bg-surface border border-border rounded-xl text-sm text-foreground placeholder:text-muted focus:outline-none focus:border-accent/50"
              />
            </div>
            <div>
              <label htmlFor="appointment-region" className="text-sm text-muted mb-1 block">Region / Zone</label>
              <input
                id="appointment-region"
                name="region"
                type="text"
                placeholder="e.g. Jaipur, West Zone"
                value={appointmentForm.region}
                maxLength={120}
                onChange={(event) => setAppointmentField('region', event.target.value)}
                className="w-full px-4 py-2.5 bg-surface border border-border rounded-xl text-sm text-foreground placeholder:text-muted focus:outline-none focus:border-accent/50"
              />
            </div>
            <div>
              <label htmlFor="appointment-notes" className="text-sm text-muted mb-1 block">Notes</label>
              <textarea
                id="appointment-notes"
                name="notes"
                rows={3}
                placeholder="Key points from the call..."
                value={appointmentForm.notes}
                onChange={(event) => setAppointmentField('notes', event.target.value)}
                className="w-full px-4 py-2.5 bg-surface border border-border rounded-xl text-sm text-foreground placeholder:text-muted focus:outline-none focus:border-accent/50 resize-none"
              />
            </div>
            {appointmentMessage && (
              <p className={`rounded-xl border p-3 text-sm ${appointmentMessage.includes('successfully') ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-700' : 'border-amber-500/20 bg-amber-500/10 text-amber-700'}`}>
                {appointmentMessage}
              </p>
            )}
            <button disabled={appointmentLoading} className="w-full py-2.5 bg-accent text-white rounded-xl text-sm font-semibold hover:bg-accent-hover transition-colors disabled:opacity-50">
              {appointmentLoading ? 'Saving...' : 'Book Appointment'}
            </button>
          </form>
        </div>

        <div className="space-y-6">
          <div>
            <div className="mb-4 flex items-center justify-between gap-3">
              <h3 className="text-lg font-semibold text-foreground flex items-center gap-2">
                <Calendar className="w-5 h-5 text-accent" />
                Saved Appointments
              </h3>
              <button type="button" onClick={refreshAppointments} className="rounded-lg border border-border bg-surface px-3 py-1.5 text-xs text-muted hover:text-foreground">Refresh</button>
            </div>
            <div className="space-y-3 max-h-[460px] overflow-y-auto pr-1">
              {appointments.length === 0 ? (
                <div className="glass-card p-8 text-center text-sm text-muted">No appointments saved yet. Agent bookings will appear here automatically.</div>
              ) : appointments.map((appointment) => (
                <div key={appointment.id} className="glass-card p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <h4 className="font-semibold text-foreground">{appointment.customer}</h4>
                        {appointment.notes?.toLowerCase().includes('ai agent') && (
                          <span className="rounded-full border border-accent/20 bg-accent/10 px-2 py-0.5 text-[10px] font-semibold text-accent">AI BOOKED</span>
                        )}
                      </div>
                      <p className="text-xs text-muted">{appointment.phone}</p>
                    </div>
                    <span className={`rounded-full border px-2 py-1 text-xs ${appointment.status === 'Completed' ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-700' : appointment.status === 'Cancelled' ? 'border-red-500/20 bg-red-500/10 text-red-700' : 'border-amber-500/20 bg-amber-500/10 text-amber-700'}`}>{appointment.status}</span>
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-2 rounded-xl bg-surface p-3 text-sm">
                    <span>{appointment.date}</span>
                    <span className="text-right">{appointment.time}</span>
                    <span className="col-span-2 text-muted">{appointment.purpose}</span>
                    {appointment.region && <span className="col-span-2 text-muted">Region: {appointment.region}</span>}
                  </div>
                  {appointment.status === 'Scheduled' && (
                    <div className="mt-3 flex gap-2">
                      <button type="button" onClick={() => changeAppointmentStatus(appointment.id, 'Completed')} className="flex-1 rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-3 py-2 text-xs font-medium text-emerald-700">Mark Completed</button>
                      <button type="button" onClick={() => changeAppointmentStatus(appointment.id, 'Cancelled')} className="flex-1 rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs font-medium text-red-700">Cancel</button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

          <div>
          <h3 className="text-lg font-semibold text-foreground mb-4 flex items-center gap-2">
            <Phone className="w-5 h-5 text-accent" />
            Recent Calls — Quick Book
          </h3>
          <div className="space-y-3">
            {recentCalls.map((call) => (
              <div key={call.id} className="glass-card p-4">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-3">
                    {getDirectionIcon(call.direction)}
                    <div>
                      <h4 className="font-medium text-foreground text-sm">{call.customer}</h4>
                      <p className="text-xs text-muted">{call.phone}</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-xs text-muted">{call.date}</p>
                    <p className="text-xs text-muted">{call.time}</p>
                  </div>
                </div>
                <p className="text-xs text-muted mb-3">{call.notes}</p>
                <div className="flex items-center justify-between">
                  {getOutcomeBadge(call.outcome)}
                  <button
                    onClick={() => prefillAppointmentFromCall(call)}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-accent/10 text-accent rounded-lg text-xs font-medium hover:bg-accent/20 transition-colors border border-accent/20"
                  >
                    <CalendarPlus className="w-3.5 h-3.5" />
                    Book
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
        </div>
      </div>
    );
  };

  const renderSettings = () => (
    <div className="max-w-2xl space-y-5">
      <div className="glass-card p-5 sm:p-6">
        <div className="flex items-start gap-3 mb-6">
          <div className="w-10 h-10 rounded-xl bg-accent/15 text-accent flex items-center justify-center flex-shrink-0">
            <PhoneForwarded className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-foreground">Human escalation settings</h2>
            <p className="text-sm text-muted mt-1">Choose the human-team number Anushka gives to callers who need immediate assistance.</p>
          </div>
        </div>
        <form onSubmit={handleCallHandlingSubmit} className="space-y-4">
          <label className="block">
            <span className="block text-sm font-medium text-foreground mb-1.5">Immediate human contact number</span>
            <input
              type="tel"
              value={callHandlingForm.transferPhone}
              onChange={(event) => setCallHandlingForm({ transferPhone: event.target.value })}
              autoComplete="tel"
              inputMode="tel"
              placeholder="+919726418181"
              required
              className="w-full rounded-xl border border-border bg-surface px-3 py-2.5 text-sm text-foreground outline-none focus:border-accent"
            />
            <span className="block text-xs text-muted mt-1.5">Use international E.164 format, including the country code.</span>
          </label>
          <div className="rounded-xl border border-amber-500/20 bg-amber-500/10 px-3 py-2.5 text-xs leading-5 text-amber-700 dark:text-amber-300">
            This Vobiz + Dograh streaming setup cannot perform a bridged live transfer. Anushka shares this number immediately, and records a callback only when the caller agrees. A true live transfer requires moving inbound telephony to a Dograh-supported transfer provider or an Asterisk ARI/SIP-trunk architecture.
          </div>
          {callHandlingError && <p role="alert" className="rounded-xl border border-red-500/20 bg-red-500/10 px-3 py-2 text-sm text-red-600">{callHandlingError}</p>}
          {callHandlingMessage && <p role="status" className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-700">{callHandlingMessage}</p>}
          <button type="submit" disabled={callHandlingLoading} className="rounded-xl bg-accent px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-accent/90 disabled:opacity-60 flex items-center gap-2">
            {callHandlingLoading && <Loader2 className="w-4 h-4 animate-spin" />}
            {callHandlingLoading ? 'Publishing…' : 'Save escalation number'}
          </button>
        </form>
      </div>
      <div className="glass-card p-5 sm:p-6">
        <div className="flex items-start gap-3 mb-6">
          <div className="w-10 h-10 rounded-xl bg-accent/15 text-accent flex items-center justify-center flex-shrink-0">
            <Settings className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-foreground">Account settings</h2>
            <p className="text-sm text-muted mt-1">Update the username or password used to access this call center.</p>
          </div>
        </div>
        <form onSubmit={handleSettingsSubmit} className="space-y-4">
          <label className="block">
            <span className="block text-sm font-medium text-foreground mb-1.5">Username</span>
            <input value={settingsForm.username} onChange={(event) => setSettingsForm((current) => ({ ...current, username: event.target.value }))} autoComplete="username" required className="w-full rounded-xl border border-border bg-surface px-3 py-2.5 text-sm text-foreground outline-none focus:border-accent" />
          </label>
          <label className="block">
            <span className="block text-sm font-medium text-foreground mb-1.5">Current password <span className="text-muted font-normal">(required to save)</span></span>
            <input type="password" value={settingsForm.currentPassword} onChange={(event) => setSettingsForm((current) => ({ ...current, currentPassword: event.target.value }))} autoComplete="current-password" required className="w-full rounded-xl border border-border bg-surface px-3 py-2.5 text-sm text-foreground outline-none focus:border-accent" />
          </label>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="block">
              <span className="block text-sm font-medium text-foreground mb-1.5">New password</span>
              <input type="password" value={settingsForm.newPassword} onChange={(event) => setSettingsForm((current) => ({ ...current, newPassword: event.target.value }))} autoComplete="new-password" placeholder="Leave blank to keep" className="w-full rounded-xl border border-border bg-surface px-3 py-2.5 text-sm text-foreground outline-none focus:border-accent" />
            </label>
            <label className="block">
              <span className="block text-sm font-medium text-foreground mb-1.5">Confirm new password</span>
              <input type="password" value={settingsForm.confirmPassword} onChange={(event) => setSettingsForm((current) => ({ ...current, confirmPassword: event.target.value }))} autoComplete="new-password" placeholder="Repeat new password" className="w-full rounded-xl border border-border bg-surface px-3 py-2.5 text-sm text-foreground outline-none focus:border-accent" />
            </label>
          </div>
          {settingsError && <p role="alert" className="rounded-xl border border-red-500/20 bg-red-500/10 px-3 py-2 text-sm text-red-600">{settingsError}</p>}
          {settingsMessage && <p role="status" className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-700">{settingsMessage}</p>}
          <button type="submit" disabled={settingsLoading} className="rounded-xl bg-accent px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-accent/90 disabled:opacity-60 flex items-center gap-2">
            {settingsLoading && <Loader2 className="w-4 h-4 animate-spin" />}
            {settingsLoading ? 'Saving…' : 'Save changes'}
          </button>
        </form>
      </div>
      <div className="glass-card p-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h3 className="font-semibold text-foreground">Sign out</h3>
          <p className="text-sm text-muted mt-1">Remove this browser's login cookie.</p>
        </div>
        <button type="button" onClick={handleLogout} className="inline-flex items-center justify-center gap-2 rounded-xl border border-red-500/25 bg-red-500/10 px-4 py-2.5 text-sm font-medium text-red-600 hover:bg-red-500/15 transition-colors">
          <LogOut className="w-4 h-4" />
          Sign out
        </button>
      </div>
      <p className="text-xs text-muted">Sessions last 30 days on this browser. For security, changing credentials invalidates other active sessions.</p>
    </div>
  );

  const renderCampaigns = () => {
    const leadCounts = campaignDetail?.counts || {};
    const totalLeads = Object.values(leadCounts).reduce((sum, value) => sum + value, 0);
    const finishedLeads = (leadCounts.COMPLETED || 0) + (leadCounts.FAILED || 0) + (leadCounts.SKIPPED || 0);
    const progress = totalLeads ? Math.round((finishedLeads / totalLeads) * 100) : 0;
    const statusClass = (status) => ({
      DRAFT: 'bg-zinc-500/10 text-muted border-zinc-500/20',
      RUNNING: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/20',
      PAUSED: 'bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/20',
      COMPLETED: 'bg-blue-500/10 text-blue-700 dark:text-blue-300 border-blue-500/20',
      PENDING: 'bg-zinc-500/10 text-muted border-zinc-500/20',
      CALLING: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/20',
      FAILED: 'bg-red-500/10 text-red-600 dark:text-red-300 border-red-500/20',
      SKIPPED: 'bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/20',
    }[status] || 'bg-zinc-500/10 text-muted border-zinc-500/20');

    return (
      <div className="space-y-6">
        <div className="glass-card p-5 sm:p-6">
          <div className="flex items-start gap-3 mb-6">
            <div className="w-10 h-10 rounded-xl bg-accent/15 text-accent flex items-center justify-center flex-shrink-0">
              <Megaphone className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-foreground">Create bulk marketing campaign</h2>
              <p className="text-sm text-muted mt-1">Import Name, Contact Number, and Region/Zone. Calls run sequentially, one customer at a time.</p>
            </div>
          </div>

          <form onSubmit={handleCampaignCreate} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-[1fr_150px] gap-3">
              <label className="block">
                <span className="block text-sm font-medium text-foreground mb-1.5">Campaign name</span>
                <input
                  value={campaignForm.name}
                  onChange={(event) => setCampaignForm((current) => ({ ...current, name: event.target.value }))}
                  placeholder="e.g. Rajasthan dealer outreach"
                  maxLength={120}
                  required
                  className="w-full rounded-xl border border-border bg-surface px-3 py-2.5 text-sm text-foreground outline-none focus:border-accent"
                />
              </label>
              <label className="block">
                <span className="block text-sm font-medium text-foreground mb-1.5">Gap between calls</span>
                <select
                  value={campaignForm.interCallDelaySec}
                  onChange={(event) => setCampaignForm((current) => ({ ...current, interCallDelaySec: Number(event.target.value) }))}
                  className="w-full rounded-xl border border-border bg-surface px-3 py-2.5 text-sm text-foreground outline-none focus:border-accent"
                >
                  <option value={10}>10 seconds</option>
                  <option value={15}>15 seconds</option>
                  <option value={30}>30 seconds</option>
                  <option value={60}>1 minute</option>
                </select>
              </label>
            </div>

            <label className="block">
              <span className="block text-sm font-medium text-foreground mb-1.5">Agent prompt / campaign instructions</span>
              <textarea
                value={campaignForm.instructions}
                onChange={(event) => setCampaignForm((current) => ({ ...current, instructions: event.target.value }))}
                rows={6}
                minLength={10}
                maxLength={6000}
                required
                placeholder="Tell Anushka what to say, which questions to ask, what confirmation to collect, and whether to offer an appointment."
                className="w-full rounded-xl border border-border bg-surface px-3 py-2.5 text-sm leading-6 text-foreground outline-none focus:border-accent resize-y"
              />
              <span className="block text-xs text-muted mt-1.5">These instructions apply only to this campaign. Company facts, verified pricing and appointment safety rules remain protected.</span>
            </label>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
              <label className="block rounded-xl border border-border bg-surface p-4">
                <span className="flex items-center gap-2 text-sm font-medium text-foreground mb-2"><Upload className="w-4 h-4 text-accent" />Excel or CSV</span>
                <input
                  ref={campaignFileInputRef}
                  type="file"
                  accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
                  onChange={(event) => setCampaignFile(event.target.files?.[0] || null)}
                  className="block w-full text-xs text-muted file:mr-3 file:rounded-lg file:border-0 file:bg-accent/15 file:px-3 file:py-2 file:text-xs file:font-medium file:text-accent"
                />
                <span className="block text-[11px] text-muted mt-2">Maximum 5 MB and 5,000 rows. First row must contain the three required headers.</span>
              </label>
              <label className="block rounded-xl border border-border bg-surface p-4">
                <span className="flex items-center gap-2 text-sm font-medium text-foreground mb-2"><Sheet className="w-4 h-4 text-accent" />Public Google Sheet</span>
                <input
                  type="url"
                  value={campaignForm.googleSheetUrl}
                  onChange={(event) => setCampaignForm((current) => ({ ...current, googleSheetUrl: event.target.value }))}
                  placeholder="https://docs.google.com/spreadsheets/d/..."
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-xs text-foreground outline-none focus:border-accent"
                />
                <span className="block text-[11px] text-muted mt-2">Set Google sharing to “Anyone with the link”. An uploaded file takes priority when both are supplied.</span>
              </label>
            </div>

            {campaignError && <p role="alert" className="rounded-xl border border-red-500/20 bg-red-500/10 px-3 py-2 text-sm text-red-600">{campaignError}</p>}
            {campaignMessage && <p role="status" className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-700">{campaignMessage}</p>}
            <button type="submit" disabled={campaignLoading || (!campaignFile && !campaignForm.googleSheetUrl.trim())} className="inline-flex items-center gap-2 rounded-xl bg-accent px-4 py-2.5 text-sm font-semibold text-white hover:bg-accent-hover disabled:opacity-50">
              {campaignLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
              {campaignLoading ? 'Importing…' : 'Import and create campaign'}
            </button>
          </form>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-5">
          <div className="glass-card p-3 h-fit">
            <div className="flex items-center justify-between px-2 py-2">
              <h3 className="font-semibold text-foreground">Campaigns</h3>
              <button type="button" onClick={() => refreshCampaigns().catch((error) => setCampaignError(error.message))} className="p-2 rounded-lg text-muted hover:text-foreground hover:bg-surface" title="Refresh campaigns">
                <RefreshCw className="w-4 h-4" />
              </button>
            </div>
            <div className="space-y-2 max-h-[540px] overflow-y-auto">
              {campaigns.length === 0 && <p className="px-2 py-6 text-sm text-muted text-center">No campaigns yet.</p>}
              {campaigns.map((campaign) => {
                const total = Object.values(campaign.counts || {}).reduce((sum, value) => sum + value, 0);
                const done = (campaign.counts?.COMPLETED || 0) + (campaign.counts?.FAILED || 0) + (campaign.counts?.SKIPPED || 0);
                return (
                  <button
                    key={campaign.id}
                    type="button"
                    onClick={() => {
                      campaignEditDirtyRef.current = false;
                      setSelectedCampaignId(campaign.id);
                    }}
                    className={`w-full rounded-xl border p-3 text-left transition-colors ${selectedCampaignId === campaign.id ? 'border-accent bg-accent/10' : 'border-border bg-surface hover:bg-surface-hover'}`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-sm font-semibold text-foreground line-clamp-2">{campaign.name}</p>
                      <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${statusClass(campaign.status)}`}>{campaign.status}</span>
                    </div>
                    <p className="mt-2 text-xs text-muted">{done} of {total} processed</p>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="glass-card p-5 sm:p-6 min-w-0">
            {!campaignDetail ? (
              <div className="py-14 text-center text-muted"><Megaphone className="w-8 h-8 mx-auto mb-3 opacity-50" /><p className="text-sm">Select or create a campaign.</p></div>
            ) : (
              <div className="space-y-5">
                <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-lg font-semibold text-foreground">{campaignDetail.name}</h3>
                      <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${statusClass(campaignDetail.status)}`}>{campaignDetail.status}</span>
                    </div>
                    <p className="text-xs text-muted mt-1">{campaignDetail.sourceType === 'google_sheet' ? 'Google Sheet' : campaignDetail.sourceName} · one call at a time</p>
                  </div>
                  <div className="flex items-center gap-2">
                    {campaignDetail.status === 'RUNNING' ? (
                      <button type="button" onClick={() => handleCampaignControl('pause')} disabled={campaignLoading} className="inline-flex items-center gap-2 rounded-xl border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-sm font-medium text-amber-700 dark:text-amber-300 disabled:opacity-50">
                        <PauseCircle className="w-4 h-4" />Pause
                      </button>
                    ) : campaignDetail.status !== 'COMPLETED' ? (
                      <button type="button" onClick={() => handleCampaignControl(campaignDetail.status === 'PAUSED' ? 'resume' : 'start')} disabled={campaignLoading} className="inline-flex items-center gap-2 rounded-xl bg-accent px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">
                        <Play className="w-4 h-4" />{campaignDetail.status === 'PAUSED' ? 'Resume' : 'Start campaign'}
                      </button>
                    ) : null}
                  </div>
                </div>

                <div>
                  <div className="flex justify-between text-xs text-muted mb-1.5"><span>{finishedLeads} of {totalLeads} processed</span><span>{progress}%</span></div>
                  <div className="h-2 rounded-full bg-surface overflow-hidden"><div className="h-full rounded-full bg-accent transition-all" style={{ width: `${progress}%` }} /></div>
                  <div className="mt-2 flex flex-wrap gap-3 text-xs text-muted">
                    <span>Pending: {leadCounts.PENDING || 0}</span><span>Calling: {leadCounts.CALLING || 0}</span><span>Completed: {leadCounts.COMPLETED || 0}</span><span>Failed: {leadCounts.FAILED || 0}</span>
                  </div>
                </div>

                <form onSubmit={handleCampaignUpdate} className="rounded-xl border border-border bg-surface p-4 space-y-3">
                  <div className="grid grid-cols-1 sm:grid-cols-[1fr_150px] gap-3">
                    <label className="block"><span className="block text-xs font-medium text-foreground mb-1">Campaign name</span><input value={campaignEdit.name} onChange={(event) => { campaignEditDirtyRef.current = true; setCampaignEdit((current) => ({ ...current, name: event.target.value })); }} maxLength={120} required className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-accent" /></label>
                    <label className="block"><span className="block text-xs font-medium text-foreground mb-1">Call gap</span><select value={campaignEdit.interCallDelaySec} onChange={(event) => { campaignEditDirtyRef.current = true; setCampaignEdit((current) => ({ ...current, interCallDelaySec: Number(event.target.value) })); }} className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-accent"><option value={10}>10 seconds</option><option value={15}>15 seconds</option><option value={30}>30 seconds</option><option value={60}>1 minute</option></select></label>
                  </div>
                  <label className="block"><span className="block text-xs font-medium text-foreground mb-1">Agent prompt / instructions</span><textarea value={campaignEdit.instructions} onChange={(event) => { campaignEditDirtyRef.current = true; setCampaignEdit((current) => ({ ...current, instructions: event.target.value })); }} rows={5} minLength={10} maxLength={6000} required className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm leading-6 text-foreground outline-none focus:border-accent resize-y" /></label>
                  <button type="submit" disabled={campaignLoading} className="inline-flex items-center gap-2 rounded-lg border border-accent/25 bg-accent/10 px-3 py-2 text-sm font-medium text-accent disabled:opacity-50">Save instructions</button>
                </form>

                <div className="overflow-x-auto rounded-xl border border-border">
                  <table className="w-full min-w-[650px] text-sm">
                    <thead className="bg-surface"><tr className="text-left text-xs text-muted"><th className="px-3 py-2.5 font-medium">Name</th><th className="px-3 py-2.5 font-medium">Contact number</th><th className="px-3 py-2.5 font-medium">Region / Zone</th><th className="px-3 py-2.5 font-medium">Status</th><th className="px-3 py-2.5 font-medium">Outcome</th></tr></thead>
                    <tbody className="divide-y divide-border">
                      {campaignDetail.leads.map((lead) => (
                        <tr key={lead.id} className="text-foreground">
                          <td className="px-3 py-2.5 font-medium">{lead.name}</td><td className="px-3 py-2.5 text-muted">{lead.phone}</td><td className="px-3 py-2.5 text-muted">{lead.region || 'Agent will ask'}</td><td className="px-3 py-2.5"><span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${statusClass(lead.status)}`}>{lead.status}</span></td><td className="px-3 py-2.5 text-xs text-muted max-w-[220px] truncate" title={lead.lastError || lead.outcome || ''}>{lead.outcome || lead.lastError || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {totalLeads > (campaignDetail.leads?.length || 0) && (
                  <p className="text-xs text-muted">Showing the first {campaignDetail.leads.length} contacts. Progress and calling include all {totalLeads} imported contacts.</p>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  };

  // ─── ANALYTICS TAB ───
  const renderAnalytics = () => {
    const outcomeCount = {};
    callLogs.forEach((c) => {
      outcomeCount[c.outcome] = (outcomeCount[c.outcome] || 0) + 1;
    });

    const purposeCount = {};
    callLogs.filter((c) => c.status === 'Completed').forEach((c) => {
      purposeCount[c.purpose] = (purposeCount[c.purpose] || 0) + 1;
    });

    const dailyCalls = {};
    callLogs.forEach((c) => {
      dailyCalls[c.date] = (dailyCalls[c.date] || 0) + 1;
    });

    return (
      <div>
        {/* Overview Stats */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          <StatCard icon={Phone} label="Total Calls" value={callStats.totalCalls} trend="Last 7 days" positive />
          <StatCard icon={CheckCircle2} label="Completed" value={callStats.completed} trend={`${Math.round((callStats.completed / callStats.totalCalls) * 100)}% success`} positive />
          <StatCard icon={CalendarPlus} label="Appointments Booked" value={callStats.appointmentsBooked} trend="From calls" positive />
          <StatCard icon={FileText} label="Quotations Sent" value={callStats.quotationsSent} trend="From calls" positive />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Call Outcomes */}
          <div className="glass-card p-6">
            <h3 className="text-base font-semibold text-foreground mb-4">Call Outcomes</h3>
            <div className="space-y-3">
              {Object.entries(outcomeCount)
                .sort((a, b) => b[1] - a[1])
                .map(([outcome, count]) => (
                  <div key={outcome} className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      {getOutcomeBadge(outcome)}
                    </div>
                    <div className="flex items-center gap-3 flex-1 ml-4">
                      <div className="flex-1 h-2 bg-surface rounded-full overflow-hidden">
                        <div
                          className="h-full bg-accent/40 rounded-full"
                          style={{ width: `${(count / callStats.totalCalls) * 100}%` }}
                        />
                      </div>
                      <span className="text-sm font-medium text-foreground w-6 text-right">
                        {count}
                      </span>
                    </div>
                  </div>
                ))}
            </div>
          </div>

          {/* Daily Call Volume */}
          <div className="glass-card p-6">
            <h3 className="text-base font-semibold text-foreground mb-4">Daily Call Volume</h3>
            <div className="space-y-3">
              {Object.entries(dailyCalls)
                .sort((a, b) => b[0].localeCompare(a[0]))
                .map(([date, count]) => (
                  <div key={date} className="flex items-center justify-between">
                    <span className="text-sm text-muted w-28">{date}</span>
                    <div className="flex items-center gap-3 flex-1 ml-4">
                      <div className="flex-1 h-2 bg-surface rounded-full overflow-hidden">
                        <div
                          className="h-full bg-teal-500/40 rounded-full"
                          style={{ width: `${(count / Math.max(...Object.values(dailyCalls))) * 100}%` }}
                        />
                      </div>
                      <span className="text-sm font-medium text-foreground w-6 text-right">
                        {count}
                      </span>
                    </div>
                  </div>
                ))}
            </div>
          </div>

          {/* Inbound vs Outbound */}
          <div className="glass-card p-6">
            <h3 className="text-base font-semibold text-foreground mb-4">Direction Split</h3>
            <div className="flex items-center gap-6">
              <div className="flex-1">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm text-muted flex items-center gap-2">
                    <ArrowDownLeft className="w-4 h-4 text-teal-700" /> Inbound
                  </span>
                  <span className="text-lg font-bold text-foreground">{callStats.inbound}</span>
                </div>
                <div className="h-3 bg-surface rounded-full overflow-hidden">
                  <div
                    className="h-full bg-teal-500/50 rounded-full"
                    style={{
                      width: `${(callStats.inbound / callStats.totalCalls) * 100}%`,
                    }}
                  />
                </div>
              </div>
              <div className="flex-1">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm text-muted flex items-center gap-2">
                    <ArrowUpRight className="w-4 h-4 text-amber-700" /> Outbound
                  </span>
                  <span className="text-lg font-bold text-foreground">{callStats.outbound}</span>
                </div>
                <div className="h-3 bg-surface rounded-full overflow-hidden">
                  <div
                    className="h-full bg-amber-500/50 rounded-full"
                    style={{
                      width: `${(callStats.outbound / callStats.totalCalls) * 100}%`,
                    }}
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Status Breakdown */}
          <div className="glass-card p-6">
            <h3 className="text-base font-semibold text-foreground mb-4">Call Status Breakdown</h3>
            <div className="grid grid-cols-2 gap-4">
              <div className="bg-surface rounded-xl p-4 text-center">
                <CheckCircle2 className="w-6 h-6 text-emerald-700 mx-auto mb-2" />
                <p className="text-2xl font-bold text-foreground">{callStats.completed}</p>
                <p className="text-xs text-muted">Completed</p>
              </div>
              <div className="bg-surface rounded-xl p-4 text-center">
                <PhoneMissed className="w-6 h-6 text-red-700 mx-auto mb-2" />
                <p className="text-2xl font-bold text-foreground">{callStats.missed}</p>
                <p className="text-xs text-muted">Missed</p>
              </div>
              <div className="bg-surface rounded-xl p-4 text-center">
                <PhoneOff className="w-6 h-6 text-orange-700 mx-auto mb-2" />
                <p className="text-2xl font-bold text-foreground">{callStats.noAnswer}</p>
                <p className="text-xs text-muted">No Answer</p>
              </div>
              <div className="bg-surface rounded-xl p-4 text-center">
                <AlertCircle className="w-6 h-6 text-yellow-700 mx-auto mb-2" />
                <p className="text-2xl font-bold text-foreground">{callStats.busy}</p>
                <p className="text-xs text-muted">Busy</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  };

  // ─── AI CALLER TAB ───
  const handleOutboundCall = async () => {
    if (!outboundPhone.trim() || callingState !== 'idle') return;
    if (!agentStatus?.workerOnline) {
      setCallMessage('AI worker is offline. Start the worker before placing an outbound call.');
      return;
    }
    const reason = outboundReason === 'Custom reason' ? customReason.trim() : outboundReason;
    if (outboundReason === 'Custom reason' && !reason) {
      setCallMessage('Please enter the custom call reason.');
      return;
    }
    setCallingState('calling');
    setCallMessage('');
    try {
      const res = await initiateAICall(outboundPhone, reason, outboundName, outboundRegion);
      if (res.success) {
        setCallingState('connected');
        setActiveCallLogId(res.data.callLogId);
        setCallMessage('Call queued. Waiting for the AI worker to dial the customer.');
      } else {
        setCallingState('idle');
        setCallMessage(res.error || 'Failed to initiate call');
      }
    } catch (err) {
      setCallingState('idle');
      setCallMessage(err.message || 'Failed to initiate call');
    }
  };

  const handleBrowserCall = async () => {
    if (browserCallState === 'connected' || browserCallState === 'connecting') {
      window.DograhWidget?.end();
      setBrowserCallState('idle');
      return;
    }

    setBrowserCallState('connecting');
    try {
      const resp = await fetch('/api/calls/browser-config');
      const data = await resp.json();
      if (!resp.ok || data.error) throw new Error(data.error || 'Dograh browser call is unavailable');

      if (!document.getElementById('dograh-widget')) {
        const script = document.createElement('script');
        script.id = 'dograh-widget';
        script.src = data.widgetUrl;
        script.async = true;
        script.dataset.dograhContext = JSON.stringify({ source: 'sekol-calling-crm' });
        document.head.appendChild(script);
        await new Promise((resolve, reject) => {
          script.onload = resolve;
          script.onerror = () => reject(new Error('Could not load the Dograh voice widget'));
        });
      }

      const widget = window.DograhWidget;
      if (!widget) throw new Error('Dograh voice widget did not initialize');

      if (!dograhWidgetReadyRef.current) {
        widget.onStatusChange((status) => setBrowserCallState(status));
        widget.onCallDisconnected(() => {
          setBrowserCallState('idle');
          getCallLogs().then(r => { if (r.success) setCallLogs(r.data); });
        });
        widget.onCallEnd(() => setBrowserCallState('idle'));
        widget.onError((error) => {
          setBrowserCallState('failed');
          setCallMessage(error?.message || 'Dograh browser call failed');
        });
        dograhWidgetReadyRef.current = true;
      }

      widget.setContext({ source: 'sekol-calling-crm' });
      widget.start();
    } catch (err) {
      window.DograhWidget?.end();
      setBrowserCallState('idle');
      setCallMessage('Failed to connect: ' + err.message);
    }
  };

  const renderAICaller = () => {
    const aiCalls = callLogs.filter(c => c.aiHandled);
    const recentAICalls = aiCalls.slice(0, 5);

    return (
      <div>
        {/* Agent Status & Stats */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          <StatCard
            icon={Bot}
            label="AI Agent"
            value={agentStatus?.workerOnline ? 'Online' : agentStatus?.configured ? 'Worker Offline' : 'Not Configured'}
            trend={agentStatus?.workerOnline ? 'Ready to accept calls' : agentStatus?.configured ? 'Start or restore the AI worker' : 'Setup required'}
            positive={agentStatus?.workerOnline}
          />
          <StatCard icon={PhoneOutgoing} label="AI Outbound" value={aiCalls.filter(c => c.direction === 'Outbound').length} trend="Total AI calls" positive />
          <StatCard icon={PhoneIncoming} label="AI Inbound" value={aiCalls.filter(c => c.direction === 'Inbound').length} trend="Total AI calls" positive />
          <StatCard icon={Clock} label="AI Calls Today" value={aiCalls.filter(c => {
            const today = new Date();
            const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
            return c.date === todayStr;
          }).length} trend="Today" positive />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Make Outbound Call */}
          <div className="glass-card p-6">
            <h3 className="text-lg font-semibold text-foreground mb-4 flex items-center gap-2">
              <PhoneOutgoing className="w-5 h-5 text-accent" />
              AI Outbound Call
            </h3>
            <p className="text-xs text-muted mb-4">
              Anushka (AI Agent) will call the customer and handle the conversation automatically.
            </p>
            <div className="space-y-3">
              <div>
                <label htmlFor="ai-outbound-phone" className="text-sm text-muted mb-1 block">Phone Number *</label>
                <input
                  id="ai-outbound-phone"
                  name="phoneNumber"
                  type="text"
                  placeholder="+91XXXXX XXXXX"
                  value={outboundPhone}
                  onChange={(e) => setOutboundPhone(e.target.value)}
                  className="w-full px-4 py-2.5 bg-surface border border-border rounded-xl text-sm text-foreground placeholder:text-muted focus:outline-none focus:border-accent/50"
                />
              </div>
              <div>
                <label htmlFor="ai-outbound-customer-name" className="text-sm text-muted mb-1 block">Customer Name</label>
                <input
                  id="ai-outbound-customer-name"
                  name="customerName"
                  type="text"
                  placeholder="Enter name (optional)"
                  value={outboundName}
                  onChange={(e) => setOutboundName(e.target.value)}
                  className="w-full px-4 py-2.5 bg-surface border border-border rounded-xl text-sm text-foreground placeholder:text-muted focus:outline-none focus:border-accent/50"
                />
              </div>
              <div>
                <label htmlFor="ai-outbound-reason" className="text-sm text-muted mb-1 block">Call Reason</label>
                <select
                  id="ai-outbound-reason"
                  name="callReason"
                  value={outboundReason}
                  onChange={(e) => setOutboundReason(e.target.value)}
                  className="w-full px-4 py-2.5 bg-surface border border-border rounded-xl text-sm text-foreground focus:outline-none focus:border-accent/50"
                >
                  <option value="">Select reason...</option>
                  <option value="Follow up on inquiry">Follow up on inquiry</option>
                  <option value="Appointment reminder">Appointment reminder</option>
                  <option value="Delivery update">Delivery update</option>
                  <option value="Quotation follow-up">Quotation follow-up</option>
                  <option value="Feedback collection">Feedback collection</option>
                  <option value="New collection announcement">New collection announcement</option>
                  <option value="12x18 / 12x24 sales campaign">12x18 / 12x24 sales campaign</option>
                  <option value="Payment reminder">Payment reminder</option>
                  <option value="Order status update">Order status update</option>
                  <option value="Custom reason">Custom reason</option>
                </select>
              </div>
              <div>
                <label htmlFor="ai-outbound-region" className="text-sm text-muted mb-1 block">Region / Zone</label>
                <input
                  id="ai-outbound-region"
                  name="region"
                  type="text"
                  placeholder="e.g. Rajasthan, Odisha, Delhi"
                  value={outboundRegion}
                  maxLength={120}
                  onChange={(e) => setOutboundRegion(e.target.value)}
                  list="supported-pricing-regions"
                  className="w-full px-4 py-2.5 bg-surface border border-border rounded-xl text-sm text-foreground placeholder:text-muted focus:outline-none focus:border-accent/50"
                />
                <datalist id="supported-pricing-regions">
                  <option value="Odisha" />
                  <option value="West Bengal" />
                  <option value="Rajasthan" />
                  <option value="Delhi" />
                  <option value="Punjab" />
                  <option value="Haryana" />
                </datalist>
                <p className="mt-1 text-[11px] text-muted">If supplied, Anushka trusts this region, does not ask again, and uses its verified zone price.</p>
              </div>
              {outboundReason === 'Custom reason' && (
                <div>
                  <label htmlFor="ai-outbound-custom-reason" className="text-sm text-muted mb-1 block">Custom Call Reason</label>
                  <textarea
                    id="ai-outbound-custom-reason"
                    name="customCallReason"
                    placeholder="Enter custom reason..."
                    value={customReason}
                    maxLength={2000}
                    onChange={(e) => setCustomReason(e.target.value)}
                    className="w-full px-4 py-2.5 bg-surface border border-border rounded-xl text-sm text-foreground placeholder:text-muted focus:outline-none focus:border-accent/50"
                  />
                </div>
              )}

              {callMessage && (
                <div className={`text-sm p-3 rounded-xl ${callingState === 'connected' ? 'bg-emerald-500/10 text-emerald-700 border border-emerald-500/20' : 'bg-red-500/10 text-red-700 border border-red-500/20'}`}>
                  {callMessage}
                </div>
              )}

              <button
                onClick={handleOutboundCall}
                disabled={!outboundPhone.trim() || callingState !== 'idle' || !agentStatus?.workerOnline}
                className="w-full flex items-center justify-center gap-2 min-h-[48px] py-2.5 bg-accent text-white rounded-xl text-sm font-semibold hover:bg-accent-hover transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {callingState === 'calling' ? (
                  <><Loader2 className="w-4 h-4 animate-spin" /> Initiating Call...</>
                ) : callingState === 'connected' ? (
                  <><PhoneCall className="w-4 h-4" /> Call Queued</>
                ) : callingState === 'ended' ? (
                  <><CheckCircle2 className="w-4 h-4" /> Call Finished</>
                ) : (
                  <><PhoneOutgoing className="w-4 h-4" /> Start AI Call</>
                )}
              </button>

              {(callingState === 'connected' || callingState === 'ended') && (
                <button
                  onClick={() => { setCallingState('idle'); setActiveCallLogId(null); setCallMessage(''); }}
                  className="w-full py-2 text-sm text-muted hover:text-foreground transition-colors"
                >
                  Reset
                </button>
              )}
            </div>
          </div>

          {/* Browser Voice Call */}
          <div className="glass-card p-6">
            <h3 className="text-lg font-semibold text-foreground mb-4 flex items-center gap-2">
              <Mic className="w-5 h-5 text-teal-600" />
              Browser Voice Call
            </h3>
            <p className="text-xs text-muted mb-4">
              Talk to the AI agent directly from your browser. Useful for testing or when you want to speak as a customer.
            </p>

            <div className="flex flex-col items-center py-6">
              {/* Call visualization */}
              <div className={`w-24 h-24 rounded-full flex items-center justify-center mb-4 transition-all ${browserCallState === 'connected'
                ? 'bg-emerald-500/20 border-2 border-emerald-500/40 animate-pulse'
                : browserCallState === 'connecting'
                  ? 'bg-amber-500/20 border-2 border-amber-500/40 animate-pulse'
                  : 'bg-surface border-2 border-border'
                }`}>
                {browserCallState === 'connected' ? (
                  <Volume2 className="w-10 h-10 text-emerald-600" />
                ) : browserCallState === 'connecting' ? (
                  <Loader2 className="w-10 h-10 text-amber-600 animate-spin" />
                ) : (
                  <Mic className="w-10 h-10 text-muted" />
                )}
              </div>

              <p className="text-sm font-medium text-foreground mb-1">
                {browserCallState === 'connected'
                  ? 'Connected — Speak now'
                  : browserCallState === 'connecting'
                    ? 'Connecting to AI Agent...'
                    : 'Ready to call'}
              </p>
              <p className="text-xs text-muted mb-6">
                {browserCallState === 'connected'
                  ? 'AI Agent Anushka is listening'
                  : 'Click below to start a voice conversation'}
              </p>

              <button
                onClick={handleBrowserCall}
                className={`flex items-center justify-center gap-2 w-full sm:w-auto min-h-[56px] px-8 py-3 rounded-2xl text-sm font-semibold transition-all ${browserCallState === 'connected'
                  ? 'bg-red-500 text-white hover:bg-red-600'
                  : browserCallState === 'connecting'
                    ? 'bg-amber-500/20 text-amber-700 cursor-wait'
                    : 'bg-teal-600 text-white hover:bg-teal-700'
                  }`}
                disabled={browserCallState === 'connecting'}
              >
                {browserCallState === 'connected' ? (
                  <><PhoneOff className="w-4 h-4" /> End Call</>
                ) : browserCallState === 'connecting' ? (
                  <><Loader2 className="w-4 h-4 animate-spin" /> Connecting...</>
                ) : (
                  <><Phone className="w-4 h-4" /> Start Browser Call</>
                )}
              </button>
            </div>

            {/* Agent configuration status */}
            {agentStatus && (
              <div className="border-t border-border pt-4 mt-2">
                <p className="text-xs text-muted mb-2 uppercase tracking-wider">Service Status</p>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { label: 'Dograh Online', ok: agentStatus.workerOnline },
                    { label: 'Dograh API', ok: agentStatus.hasDograh },
                    { label: 'API Key', ok: agentStatus.hasApiKey },
                    { label: 'Published Workflow', ok: agentStatus.hasWorkflow },
                    { label: 'Browser Widget', ok: agentStatus.hasWebWidget },
                    { label: 'Vobiz', ok: agentStatus.hasVobiz },
                  ].map(({ label, ok }) => (
                    <div key={label} className="flex items-center gap-2 text-xs">
                      <div className={`w-1.5 h-1.5 rounded-full ${ok ? 'bg-emerald-500' : 'bg-zinc-400'}`} />
                      <span className={ok ? 'text-foreground' : 'text-muted'}>{label}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Recent AI Calls */}
        {recentAICalls.length > 0 && (
          <div className="mt-6">
            <h3 className="text-base font-semibold text-foreground mb-3 flex items-center gap-2">
              <Bot className="w-4 h-4 text-accent" />
              Recent AI Calls
            </h3>
            <div className="glass-card overflow-hidden hidden md:block">
              <div className="overflow-x-auto">
                <table className="crm-table">
                  <thead>
                    <tr>
                      <th>Direction</th>
                      <th>Customer</th>
                      <th>Phone</th>
                      <th>Date & Time</th>
                      <th>Duration</th>
                      <th>Purpose</th>
                      <th>Outcome</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recentAICalls.map((call) => (
                      <tr key={call.id} className="cursor-pointer" onClick={() => setSelectedCall(call)}>
                        <td>
                          <div className="flex items-center gap-2">
                            {getDirectionIcon(call.direction)}
                            <span className="text-xs text-muted">{call.direction}</span>
                          </div>
                        </td>
                        <td className="font-medium text-foreground">
                          <div className="flex items-center gap-1.5">
                            <Bot className="w-3 h-3 text-accent" />
                            {call.customer}
                          </div>
                        </td>
                        <td className="text-muted">{call.phone}</td>
                        <td>
                          <div className="text-sm">{call.date}</div>
                          <div className="text-xs text-muted">{call.time}</div>
                        </td>
                        <td>{call.duration}</td>
                        <td className="text-sm max-w-[200px] truncate">{call.purpose}</td>
                        <td>{getOutcomeBadge(call.outcome)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Recent AI Calls — Mobile cards */}
            <div className="md:hidden space-y-3">
              {recentAICalls.map((call) => (
                <div key={call.id} className="glass-card p-4" onClick={() => setSelectedCall(call)}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        {getDirectionIcon(call.direction)}
                        <Bot className="w-3.5 h-3.5 text-accent flex-shrink-0" />
                        <p className="text-sm font-semibold text-foreground truncate">{call.customer}</p>
                      </div>
                      <p className="text-xs text-muted truncate mt-0.5">{call.phone}</p>
                    </div>
                    {getOutcomeBadge(call.outcome)}
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted">
                    <span>{call.date}</span>
                    <span>•</span>
                    <span>{call.time}</span>
                    <span>•</span>
                    <span>{call.duration}</span>
                  </div>
                  {call.purpose && (
                    <p className="text-xs text-muted mt-2 line-clamp-2">{call.purpose}</p>
                  )}
                </div>
              ))}
            </div>
          </div >
        )
        }

        {/* Quick Call from Phone Book */}
        {
          phoneBook.length > 0 && (
            <div className="mt-6">
              <h3 className="text-base font-semibold text-foreground mb-3 flex items-center gap-2">
                <PhoneCall className="w-4 h-4 text-accent" />
                Quick AI Call — Recent Contacts
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {phoneBook.slice(0, 6).map((contact) => (
                  <div key={contact.phone} className="glass-card p-3 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-accent/10 flex items-center justify-center">
                        <User className="w-4 h-4 text-accent" />
                      </div>
                      <div>
                        <p className="text-sm font-medium text-foreground">{contact.name}</p>
                        <p className="text-xs text-muted">{contact.phone}</p>
                      </div>
                    </div>
                    <button
                      onClick={() => {
                        setOutboundPhone(contact.phone);
                        setOutboundName(contact.name);
                      }}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-accent/10 text-accent rounded-lg text-xs font-medium hover:bg-accent/20 transition-colors border border-accent/20"
                    >
                      <Bot className="w-3 h-3" />
                      AI Call
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )
        }
      </div >
    );
  };

  return (
    <div className={`space-y-6 animate-[fade-in_0.3s_ease] ${(browserCallState !== 'idle' || callingState === 'calling' || callingState === 'connected') ? 'pb-28 md:pb-0' : ''}`}>
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Call Center</h1>
          <p className="text-sm text-muted mt-1">
            Manage inbound & outbound calls, transcripts, and appointments
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 sm:justify-end">
          <ThemeToggle />
          <button
            onClick={refreshLogs}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-surface border border-border rounded-xl text-xs text-muted hover:text-foreground transition-colors"
            title="Refresh call data"
          >
            <TrendingUp className="w-3.5 h-3.5" />
            Refresh
          </button>
          <div className={`flex items-center gap-2 px-3 py-1.5 rounded-xl ${agentStatus?.configured
            ? 'bg-emerald-500/10 border border-emerald-500/20'
            : 'bg-zinc-500/10 border border-zinc-500/20'
            }`}>
            <div className={`w-2 h-2 rounded-full ${agentStatus?.configured ? 'bg-emerald-500 animate-pulse' : 'bg-zinc-400'}`} />
            <span className={`text-xs font-medium ${agentStatus?.configured ? 'text-emerald-700' : 'text-muted'}`}>
              {agentStatus?.configured ? 'AI Agent Online' : 'AI Agent Offline'}
            </span>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="bg-surface rounded-xl border border-border p-1 w-full overflow-x-auto">
        <div className="flex items-center gap-1 min-w-max">
          {TABS.map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                onClick={() => {
                  setActiveTab(tab.id);
                  setSearchQuery('');
                }}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${activeTab === tab.id
                  ? 'bg-accent/20 text-accent shadow-sm'
                  : 'text-muted hover:text-foreground hover:bg-surface-hover'
                  }`}
              >
                <Icon className="w-4 h-4" />
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Tab Content */}
      {activeTab === 'ai-caller' && renderAICaller()}
      {activeTab === 'campaigns' && renderCampaigns()}
      {activeTab === 'logs' && renderCallLogs()}
      {activeTab === 'phonebook' && renderPhoneBook()}
      {activeTab === 'transcripts' && renderTranscripts()}
      {activeTab === 'appointments' && renderBookAppointment()}
      {activeTab === 'analytics' && renderAnalytics()}
      {activeTab === 'settings' && renderSettings()}

      {/* ─── MOBILE STICKY ACTIVE-CALL BAR (sits above the 60px bottom nav) ─── */}
      {(browserCallState !== 'idle' || callingState === 'calling' || callingState === 'connected') && (
        <div
          className="md:hidden fixed left-0 right-0 z-40 px-3"
          style={{ bottom: 'calc(60px + env(safe-area-inset-bottom) + 8px)' }}
        >
          <div className="flex items-center gap-3 rounded-2xl border border-border bg-surface p-3 shadow-xl">
            <div
              className={`w-11 h-11 rounded-full flex items-center justify-center flex-shrink-0 ${browserCallState === 'connected'
                ? 'bg-emerald-500/20 text-emerald-700 animate-pulse'
                : browserCallState === 'connecting' || callingState === 'calling'
                  ? 'bg-amber-500/20 text-amber-700 animate-pulse'
                  : 'bg-accent/15 text-accent'
                }`}
            >
              {browserCallState === 'connecting' || callingState === 'calling' ? (
                <Loader2 className="w-5 h-5 animate-spin" />
              ) : browserCallState === 'connected' ? (
                <Volume2 className="w-5 h-5" />
              ) : (
                <PhoneCall className="w-5 h-5" />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-foreground truncate">
                {browserCallState === 'connected'
                  ? 'Browser call connected'
                  : browserCallState === 'connecting'
                    ? 'Connecting browser call...'
                    : callingState === 'calling'
                      ? 'Initiating AI call...'
                      : 'AI call in progress'}
              </p>
              <p className="text-xs text-muted truncate">
                {browserCallState === 'connected'
                  ? 'AI Agent Anushka is listening'
                  : callingState === 'connected'
                    ? (outboundName || outboundPhone || 'Outbound call')
                    : 'Please wait'}
              </p>
            </div>
            {browserCallState === 'connected' ? (
              <button
                onClick={handleBrowserCall}
                className="touch-target flex items-center gap-1.5 px-4 rounded-xl bg-red-500 text-white text-sm font-semibold hover:bg-red-600 transition-colors flex-shrink-0"
              >
                <PhoneOff className="w-4 h-4" />
                End
              </button>
            ) : callingState === 'connected' ? (
              <button
                onClick={() => { setCallingState('idle'); setCallMessage(''); }}
                className="touch-target flex items-center justify-center px-4 rounded-xl bg-surface-hover text-muted text-sm font-medium flex-shrink-0"
              >
                Dismiss
              </button>
            ) : null}
          </div>
        </div>
      )}

      {/* ─── CALL DETAIL MODAL ─── */}
      <Modal isOpen={!!selectedCall} onClose={() => setSelectedCall(null)} title="Call Details" size="lg">
        {selectedCall && (
          <div className="space-y-4">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-full bg-accent/10 flex items-center justify-center">
                {selectedCall.direction === 'Inbound' ? (
                  <PhoneIncoming className="w-6 h-6 text-teal-700" />
                ) : (
                  <PhoneOutgoing className="w-6 h-6 text-amber-700" />
                )}
              </div>
              <div>
                <h3 className="text-lg font-semibold text-foreground">{selectedCall.customer}</h3>
                <p className="text-sm text-muted">{selectedCall.phone}</p>
              </div>
              <div className="ml-auto text-right">
                {getStatusBadge(selectedCall.status)}
                <p className="text-xs text-muted mt-1">{selectedCall.date} at {selectedCall.time}</p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="bg-surface rounded-xl p-3">
                <p className="text-xs text-muted mb-1">Direction</p>
                <div className="flex items-center gap-2">
                  {getDirectionIcon(selectedCall.direction)}
                  <span className="text-sm font-medium text-foreground">{selectedCall.direction}</span>
                </div>
              </div>
              <div className="bg-surface rounded-xl p-3">
                <p className="text-xs text-muted mb-1">Duration</p>
                <p className="text-sm font-medium text-foreground flex items-center gap-2">
                  <Clock className="w-4 h-4 text-muted" />
                  {selectedCall.duration}
                </p>
              </div>
              <div className="bg-surface rounded-xl p-3">
                <p className="text-xs text-muted mb-1">Agent</p>
                <p className="text-sm font-medium text-foreground">{selectedCall.agent}</p>
              </div>
              <div className="bg-surface rounded-xl p-3">
                <p className="text-xs text-muted mb-1">Outcome</p>
                {getOutcomeBadge(selectedCall.outcome)}
              </div>
            </div>

            <div className="bg-surface rounded-xl p-3">
              <p className="text-xs text-muted mb-1">Purpose</p>
              <p className="text-sm text-foreground">{selectedCall.purpose}</p>
            </div>

            {selectedCall.region && (
              <div className="bg-surface rounded-xl p-3">
                <p className="text-xs text-muted mb-1">Region / Zone</p>
                <p className="text-sm text-foreground">{selectedCall.region}</p>
              </div>
            )}

            <div className="bg-surface rounded-xl p-3">
              <p className="text-xs text-muted mb-1">Notes</p>
              <p className="text-sm text-foreground">{selectedCall.notes}</p>
            </div>

            {/* Transcript */}
            {selectedCall.transcript && (
              <div className="border border-border rounded-xl overflow-hidden">
                <div className="px-4 py-3 bg-surface flex items-center justify-between border-b border-border">
                  <div className="flex items-center gap-2">
                    <MessageSquare className="w-4 h-4 text-accent" />
                    <span className="text-sm font-semibold text-foreground">Call Transcript</span>
                  </div>
                  <div className="flex items-center gap-2">
                    {getSentimentBadge(selectedCall.transcript.sentiment)}
                  </div>
                </div>
                {selectedCall.transcript.summary && (
                  <div className="px-4 py-2 bg-accent/5 border-b border-border">
                    <p className="text-xs text-muted">Summary</p>
                    <p className="text-sm text-foreground mt-0.5">{selectedCall.transcript.summary}</p>
                  </div>
                )}
                <div className="p-4 space-y-3 max-h-[300px] overflow-y-auto">
                  {(selectedCall.transcript.messages || []).map((msg, idx) => (
                    <div key={idx} className={`flex ${msg.from === 'agent' ? 'justify-start' : 'justify-end'}`}>
                      <div className={`max-w-[75%] rounded-2xl px-3 py-2 ${msg.from === 'agent'
                        ? 'bg-accent/10 border border-accent/20'
                        : 'bg-surface border border-border'
                        }`}>
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-[10px] font-semibold uppercase tracking-wider text-muted">
                            {msg.from === 'agent' ? 'Anushka (AI)' : 'Customer'}
                          </span>
                          <span className="text-[10px] text-muted">{msg.time}</span>
                        </div>
                        <p className="text-sm leading-relaxed text-foreground">{msg.text}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="flex gap-2 pt-2">
              {selectedCall.recording && (
                <button
                  onClick={() => selectedCall.recordingUrl && window.open(selectedCall.recordingUrl, '_blank', 'noopener,noreferrer')}
                  className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-accent/10 text-accent border border-accent/20 rounded-xl text-sm font-medium hover:bg-accent/20 transition-colors"
                >
                  <Play className="w-4 h-4" />
                  Play Recording
                </button>
              )}
              <button className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-accent text-white rounded-xl text-sm font-medium hover:bg-accent-hover transition-colors">
                <Phone className="w-4 h-4" />
                Call Again
              </button>
              <button
                className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-teal-500/10 text-teal-700 border border-teal-500/20 rounded-xl text-sm font-medium hover:bg-teal-500/20 transition-colors"
                onClick={() => {
                  prefillAppointmentFromCall(selectedCall);
                  setSelectedCall(null);
                  setActiveTab('appointments');
                }}
              >
                <CalendarPlus className="w-4 h-4" />
                Book Appointment
              </button>
            </div>
          </div>
        )}
      </Modal>

      {/* ─── CONTACT DETAIL MODAL ─── */}
      <Modal isOpen={!!selectedContact} onClose={() => setSelectedContact(null)} title="Contact Details" size="md">
        {selectedContact && (
          <div className="space-y-4">
            <div className="flex items-center gap-4">
              <div className="w-14 h-14 rounded-full bg-accent/10 flex items-center justify-center">
                <User className="w-7 h-7 text-accent" />
              </div>
              <div>
                <h3 className="text-lg font-semibold text-foreground">{selectedContact.name}</h3>
                <p className="text-sm text-muted">{selectedContact.phone}</p>
                {selectedContact.email && (
                  <p className="text-xs text-muted">{selectedContact.email}</p>
                )}
              </div>
              <div className="ml-auto">{getTagBadge(selectedContact.tag)}</div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="bg-surface rounded-xl p-3">
                <p className="text-xs text-muted mb-1">Total Calls</p>
                <p className="text-lg font-bold text-foreground">{selectedContact.totalCalls}</p>
              </div>
              <div className="bg-surface rounded-xl p-3">
                <p className="text-xs text-muted mb-1">Last Call</p>
                <p className="text-sm font-medium text-foreground">{selectedContact.lastCall}</p>
              </div>
            </div>

            <div className="bg-surface rounded-xl p-3">
              <p className="text-xs text-muted mb-1">Notes</p>
              <p className="text-sm text-foreground">{selectedContact.notes}</p>
            </div>

            {/* Call history for this contact */}
            <div>
              <p className="text-xs text-muted mb-2 uppercase tracking-wider">Recent Call History</p>
              <div className="space-y-2">
                {callLogs
                  .filter((c) => c.phone === selectedContact.phone)
                  .slice(0, 5)
                  .map((call) => (
                    <div key={call.id} className="flex items-center justify-between bg-surface rounded-lg p-2.5">
                      <div className="flex items-center gap-2">
                        {getDirectionIcon(call.direction)}
                        <span className="text-xs text-foreground">{call.purpose}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        {getStatusBadge(call.status)}
                        <span className="text-xs text-muted">{call.date}</span>
                      </div>
                    </div>
                  ))}
              </div>
            </div>

            <div className="flex gap-2 pt-2">
              <button className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-emerald-500/10 text-emerald-700 border border-emerald-500/20 rounded-xl text-sm font-medium hover:bg-emerald-500/20 transition-colors">
                <Phone className="w-4 h-4" />
                Call Now
              </button>
              <button className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-accent/10 text-accent border border-accent/20 rounded-xl text-sm font-medium hover:bg-accent/20 transition-colors">
                <MessageSquare className="w-4 h-4" />
                Send Message
              </button>
            </div>
          </div>
        )}
      </Modal>

      {/* ─── ADD CONTACT MODAL ─── */}
      <Modal isOpen={showAddContactModal} onClose={() => setShowAddContactModal(false)} title="Add New Contact" size="md">
        <div className="space-y-4">
          <div>
            <label className="text-sm text-muted mb-1 block">Full Name</label>
            <input
              type="text"
              placeholder="Enter full name"
              className="w-full px-4 py-2.5 bg-surface border border-border rounded-xl text-sm text-foreground placeholder:text-muted focus:outline-none focus:border-accent/50"
            />
          </div>
          <div>
            <label className="text-sm text-muted mb-1 block">Phone Number</label>
            <input
              type="text"
              placeholder="+91 XXXXX XXXXX"
              className="w-full px-4 py-2.5 bg-surface border border-border rounded-xl text-sm text-foreground placeholder:text-muted focus:outline-none focus:border-accent/50"
            />
          </div>
          <div>
            <label className="text-sm text-muted mb-1 block">Email</label>
            <input
              type="email"
              placeholder="email@example.com"
              className="w-full px-4 py-2.5 bg-surface border border-border rounded-xl text-sm text-foreground placeholder:text-muted focus:outline-none focus:border-accent/50"
            />
          </div>
          <div>
            <label className="text-sm text-muted mb-1 block">Tag</label>
            <select className="w-full px-4 py-2.5 bg-surface border border-border rounded-xl text-sm text-foreground focus:outline-none focus:border-accent/50">
              <option>Hot Lead</option>
              <option>Warm Lead</option>
              <option>Cold Lead</option>
              <option>Customer</option>
            </select>
          </div>
          <div>
            <label className="text-sm text-muted mb-1 block">Notes</label>
            <textarea
              rows={2}
              placeholder="Add notes..."
              className="w-full px-4 py-2.5 bg-surface border border-border rounded-xl text-sm text-foreground placeholder:text-muted focus:outline-none focus:border-accent/50 resize-none"
            />
          </div>
          <button
            onClick={() => setShowAddContactModal(false)}
            className="w-full py-2.5 bg-accent text-white rounded-xl text-sm font-semibold hover:bg-accent-hover transition-colors"
          >
            Add Contact
          </button>
        </div>
      </Modal>

    </div>
  );
}
