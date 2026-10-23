"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import type { Pipeline, PipelineStage, Deal } from "@/types";
import { PipelineBoard } from "@/components/whatsapp/pipelines/pipeline-board";
import { PipelineSettings } from "@/components/whatsapp/pipelines/pipeline-settings";
import { DealForm } from "@/components/whatsapp/pipelines/deal-form";
import { PipelineAnalytics } from "@/components/whatsapp/pipelines/pipeline-analytics";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { GitBranch, Plus, ChevronDown, Settings, UserPlus, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useRealtime } from "@/hooks/use-realtime";
import { statusForStageMove } from "@/lib/whatsapp/pipeline-rules";

// Fallback refresh for when the realtime socket isn't connected.
const POLL_MS = 30_000;

export function PipelinesTab() {
  const [pipelines, setPipelines] = useState<Pipeline[]>([]);
  const [selectedPipelineId, setSelectedPipelineId] = useState<string>("");
  const [stages, setStages] = useState<PipelineStage[]>([]);
  const [deals, setDeals] = useState<Deal[]>([]);
  const [loading, setLoading] = useState(true);

  // Dialog / sheet state
  const [newPipelineOpen, setNewPipelineOpen] = useState(false);
  const [newPipelineName, setNewPipelineName] = useState("");
  const [creating, setCreating] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  // Deal form state is lifted here so both the top-bar "Add Deal" and
  // the per-column "+" trigger the same Sheet.
  const [dealFormOpen, setDealFormOpen] = useState(false);
  const [editingDeal, setEditingDeal] = useState<Deal | null>(null);
  const [defaultStageId, setDefaultStageId] = useState<string>("");
  const [importing, setImporting] = useState(false);

  // Background refreshes skip while a drag is still saving, so a stale
  // response can't snap a moved card back to its old column.
  const pendingMoves = useRef(0);
  const selectedPipelineRef = useRef(selectedPipelineId);
  useEffect(() => {
    selectedPipelineRef.current = selectedPipelineId;
  }, [selectedPipelineId]);

  async function fetchJson<T>(input: RequestInfo | URL, init?: RequestInit): Promise<T> {
    const res = await fetch(input, init);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data?.error || "Request failed");
    }
    return data as T;
  }

  const loadPipelines = useCallback(async () => {
    try {
      const data = await fetchJson<{ data: Pipeline[] }>("/api/whatsapp/pipelines");
      return data.data ?? [];
    } catch (error) {
      console.error("Failed to load pipelines:", error);
      toast.error("Failed to load pipelines");
      return [];
    }
  }, []);

  const loadStages = useCallback(
    async (pipelineId: string) => {
      try {
        const data = await fetchJson<{ data: PipelineStage[] }>(
          `/api/whatsapp/pipelines/${pipelineId}/stages`,
        );
        return data.data ?? [];
      } catch (error) {
        console.error("Failed to load stages:", error);
        toast.error("Failed to load stages");
        return [];
      }
    },
    [],
  );

  const loadDeals = useCallback(
    async (pipelineId: string) => {
      try {
        const data = await fetchJson<{ data: Deal[] }>(
          `/api/whatsapp/pipelines/${pipelineId}/deals`,
        );
        return (data.data ?? []) as Deal[];
      } catch (error) {
        console.error("Failed to load deals:", error);
        toast.error("Failed to load deals");
        return [];
      }
    },
    [],
  );

  // Initial load. The server creates the default "Sales Pipeline" on the
  // first request, so the list is only empty if the user deleted them all.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const list = await loadPipelines();
      if (cancelled) return;
      setPipelines(list);
      if (list.length > 0) {
        setSelectedPipelineId((prev) =>
          prev && list.some((p) => p.id === prev) ? prev : list[0].id,
        );
      } else {
        setSelectedPipelineId("");
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [loadPipelines]);

  // Load stages + deals whenever selected pipeline changes.
  // Clearing on no-selection is a legitimate sync with URL/prop
  // state; the load completion uses async setters inside promise
  // callbacks (not synchronous in the effect body).
  useEffect(() => {
    if (!selectedPipelineId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setStages([]);
      setDeals([]);
      return;
    }
    let cancelled = false;
    (async () => {
      const [s, d] = await Promise.all([
        loadStages(selectedPipelineId),
        loadDeals(selectedPipelineId),
      ]);
      if (cancelled) return;
      setStages(s);
      setDeals(d);
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedPipelineId, loadStages, loadDeals]);

  const refreshPipelines = useCallback(async () => {
    const list = await loadPipelines();
    setPipelines(list);
    if (list.length === 0) setSelectedPipelineId("");
    else if (!list.some((p) => p.id === selectedPipelineId))
      setSelectedPipelineId(list[0].id);
  }, [loadPipelines, selectedPipelineId]);

  const refreshStages = useCallback(async () => {
    if (!selectedPipelineId) return;
    setStages(await loadStages(selectedPipelineId));
  }, [loadStages, selectedPipelineId]);

  const refreshDeals = useCallback(async () => {
    if (!selectedPipelineId) return;
    setDeals(await loadDeals(selectedPipelineId));
  }, [loadDeals, selectedPipelineId]);

  // Quiet refresh for new leads arriving from WhatsApp: no error toasts,
  // and the result is dropped if the user switched pipelines meanwhile.
  const backgroundRefresh = useCallback(async () => {
    const pipelineId = selectedPipelineId;
    if (!pipelineId || pendingMoves.current > 0) return;
    try {
      const data = await fetchJson<{ data: Deal[] }>(
        `/api/whatsapp/pipelines/${pipelineId}/deals`,
        { cache: "no-store" },
      );
      if (pendingMoves.current > 0 || selectedPipelineRef.current !== pipelineId) return;
      setDeals(data.data ?? []);
    } catch {
      // The next poll or event retries.
    }
  }, [selectedPipelineId]);

  // A new WhatsApp inquiry gets its deal before the webhook publishes the
  // message, so refreshing on customer messages shows new leads live.
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scheduleRefresh = useCallback(() => {
    if (refreshTimer.current) clearTimeout(refreshTimer.current);
    refreshTimer.current = setTimeout(() => void backgroundRefresh(), 600);
  }, [backgroundRefresh]);
  useEffect(
    () => () => {
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
    },
    [],
  );

  useRealtime({
    channelName: "pipelines",
    enabled: !!selectedPipelineId,
    onMessageEvent: (event) => {
      if (event.eventType === "INSERT" && event.new.sender_type === "customer") scheduleRefresh();
    },
    onConversationEvent: (event) => {
      if (event.eventType === "INSERT") scheduleRefresh();
    },
  });

  useEffect(() => {
    if (!selectedPipelineId) return;
    const tick = () => {
      if (document.visibilityState === "visible") void backgroundRefresh();
    };
    const timer = setInterval(tick, POLL_MS);
    document.addEventListener("visibilitychange", tick);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [selectedPipelineId, backgroundRefresh]);

  const handleDealMoved = useCallback(
    async (dealId: string, newStageId: string) => {
      // Optimistic update — board already animated; just persist. Moving
      // into "Won" marks the deal won (and out of it reopens), as the
      // server does.
      const stage = stages.find((s) => s.id === newStageId);
      setDeals((prev) =>
        prev.map((d) => {
          if (d.id !== dealId) return d;
          const status = stage ? statusForStageMove(d.status, stage) : null;
          return status
            ? { ...d, stage_id: newStageId, status: status as Deal["status"], updated_at: new Date().toISOString() }
            : { ...d, stage_id: newStageId };
        }),
      );
      pendingMoves.current += 1;
      try {
        await fetchJson(`/api/whatsapp/deals/${dealId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ stage_id: newStageId }),
        });
        pendingMoves.current -= 1;
      } catch {
        pendingMoves.current -= 1;
        toast.error("Failed to move deal");
        refreshDeals();
      }
    },
    [refreshDeals, stages],
  );

  async function handleImportLeads() {
    if (!selectedPipelineId) return;
    setImporting(true);
    try {
      const data = await fetchJson<{ data: { created: number } }>(
        `/api/whatsapp/pipelines/${selectedPipelineId}/import-leads`,
        { method: "POST" },
      );
      const created = data.data?.created ?? 0;
      if (created > 0) {
        const stageName = [...stages].sort((a, b) => a.position - b.position)[0]?.name ?? "the first stage";
        toast.success(`Added ${created} WhatsApp lead${created === 1 ? "" : "s"} to ${stageName}`);
        await refreshDeals();
      } else {
        toast.info("Every WhatsApp contact who has messaged already has a deal");
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to import leads");
    } finally {
      setImporting(false);
    }
  }

  const handleAddDeal = useCallback(
    (stageId?: string) => {
      setEditingDeal(null);
      setDefaultStageId(stageId ?? stages[0]?.id ?? "");
      setDealFormOpen(true);
    },
    [stages],
  );

  const handleEditDeal = useCallback((deal: Deal) => {
    setEditingDeal(deal);
    setDefaultStageId(deal.stage_id);
    setDealFormOpen(true);
  }, []);

  async function handleCreatePipeline() {
    const name = newPipelineName.trim();
    if (!name) return;
    setCreating(true);
    try {
      const data = await fetchJson<{ data: Pipeline }>("/api/whatsapp/pipelines", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          seed_default_stages: true,
        }),
      });

      setNewPipelineName("");
      setNewPipelineOpen(false);
      setSelectedPipelineId(data.data?.id ?? "");
      await refreshPipelines();
      toast.success("Pipeline created");
    } catch (error) {
      console.error("Failed to create pipeline:", error);
      toast.error("Failed to create pipeline");
    } finally {
      setCreating(false);
    }
  }

  const selectedPipeline = pipelines.find((p) => p.id === selectedPipelineId);

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div className="h-8 w-48 animate-pulse rounded bg-surface-light" />
          <div className="h-9 w-28 animate-pulse rounded-lg bg-surface-light" />
        </div>
        <div className="flex gap-3">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="h-96 w-72 animate-pulse rounded-xl bg-surface-light" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          {/* Pipeline selector dropdown */}
          <DropdownMenu>
            <DropdownMenuTrigger
              className="inline-flex items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground hover:bg-surface-light transition-colors data-[popup-open]:bg-surface-light"
            >
              <GitBranch className="h-4 w-4 text-accent" />
              <span className="font-semibold">
                {selectedPipeline?.name ?? "Select Pipeline"}
              </span>
              <ChevronDown className="h-4 w-4 text-muted" />
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="start"
              className="w-64 border-border bg-surface text-foreground"
            >
              {pipelines.length === 0 && (
                <DropdownMenuItem disabled className="text-muted">
                  No pipelines yet
                </DropdownMenuItem>
              )}
              {pipelines.map((p) => (
                <DropdownMenuItem
                  key={p.id}
                  onClick={() => setSelectedPipelineId(p.id)}
                  className={
                    p.id === selectedPipelineId
                      ? "text-accent"
                      : "text-foreground"
                  }
                >
                  <GitBranch className="mr-2 h-3.5 w-3.5" />
                  {p.name}
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator className="bg-surface-light" />
              {selectedPipeline && (
                <DropdownMenuItem
                  onClick={() => setSettingsOpen(true)}
                  className="text-foreground"
                >
                  <Settings className="mr-2 h-3.5 w-3.5" />
                  Manage Pipelines
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <div className="ui-actions flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            onClick={handleImportLeads}
            disabled={!selectedPipelineId || stages.length === 0 || importing}
            title="Add every WhatsApp contact who has messaged but has no deal yet"
            className="border-border bg-surface text-foreground hover:bg-surface-light"
          >
            {importing ? (
              <Loader2 className="mr-1 h-4 w-4 animate-spin" />
            ) : (
              <UserPlus className="mr-1 h-4 w-4" />
            )}
            Import WhatsApp Leads
          </Button>
          <Button
            variant="outline"
            onClick={() => setNewPipelineOpen(true)}
            className="border-border bg-surface text-foreground hover:bg-surface-light"
          >
            <Plus className="mr-1 h-4 w-4" />
            Add Pipeline
          </Button>
          <Button
            onClick={() => handleAddDeal()}
            disabled={!selectedPipelineId || stages.length === 0}
            className="bg-accent text-foreground hover:bg-accent"
          >
            <Plus className="mr-1 h-4 w-4" />
            Add Deal
          </Button>
        </div>
      </div>

      {/* Board */}
      {pipelines.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border py-20">
          <GitBranch className="h-12 w-12 text-muted" />
          <h3 className="mt-4 text-lg font-medium text-foreground">
            No pipelines yet
          </h3>
          <p className="mt-2 text-sm text-muted">
            Create a pipeline to start tracking deals
          </p>
          <Button
            onClick={() => setNewPipelineOpen(true)}
            className="mt-4 bg-accent text-foreground hover:bg-accent"
          >
            <Plus className="mr-1 h-4 w-4" />
            Create Pipeline
          </Button>
        </div>
      ) : (
        <>
          <PipelineAnalytics stages={stages} deals={deals} />
          <PipelineBoard
            stages={stages}
            deals={deals}
            onDealMoved={handleDealMoved}
            onAddDeal={handleAddDeal}
            onEditDeal={handleEditDeal}
          />
        </>
      )}

      {/* New Pipeline Dialog */}
      <Dialog open={newPipelineOpen} onOpenChange={setNewPipelineOpen}>
        <DialogContent className="sm:max-w-sm bg-surface border-border">
          <DialogHeader>
            <DialogTitle className="text-foreground">New Pipeline</DialogTitle>
          </DialogHeader>
          <div className="py-2">
            <Label className="text-foreground">Pipeline Name</Label>
            <Input
              value={newPipelineName}
              onChange={(e) => setNewPipelineName(e.target.value)}
              placeholder="e.g., Enterprise Sales"
              className="mt-2 bg-surface-light border-border text-foreground"
              onKeyDown={(e) => {
                if (e.key === "Enter") handleCreatePipeline();
              }}
            />
            <p className="mt-2 text-xs text-muted">
              Default stages (New Lead → Won) will be created automatically.
            </p>
          </div>
          <DialogFooter className="bg-surface border-border">
            <Button
              variant="outline"
              onClick={() => setNewPipelineOpen(false)}
              className="border-border text-foreground hover:bg-surface-light"
            >
              Cancel
            </Button>
            <Button
              onClick={handleCreatePipeline}
              disabled={creating || !newPipelineName.trim()}
              className="bg-accent text-foreground hover:bg-accent"
            >
              {creating ? "Creating..." : "Create Pipeline"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Pipeline Settings */}
      {selectedPipeline && (
        <PipelineSettings
          open={settingsOpen}
          onOpenChange={setSettingsOpen}
          pipeline={selectedPipeline}
          stages={stages}
          onPipelinesChanged={refreshPipelines}
          onStagesChanged={refreshStages}
          onCreateNewPipeline={() => {
            setSettingsOpen(false);
            setNewPipelineOpen(true);
          }}
        />
      )}

      {/* Deal Form (Sheet) */}
      <DealForm
        open={dealFormOpen}
        onOpenChange={setDealFormOpen}
        deal={editingDeal}
        pipelineId={selectedPipelineId}
        stages={stages}
        defaultStageId={defaultStageId}
        onSaved={refreshDeals}
      />
    </div>
  );
}
