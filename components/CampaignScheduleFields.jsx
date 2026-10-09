'use client';

export const DEFAULT_CAMPAIGN_SCHEDULE = {
  callingStartTime: '10:00', callingEndTime: '17:00', autoResumeDaily: false,
};

export default function CampaignScheduleFields({ value, onChange }) {
  const enabled = value.callingStartTime != null;
  return (
    <fieldset className="rounded-xl border border-border p-4 space-y-3">
      <legend className="px-1 text-sm font-medium text-foreground">Calling hours · India time (IST)</legend>
      <label className="flex items-center gap-2 text-sm text-foreground">
        <input type="checkbox" checked={enabled} onChange={(event) => onChange(event.target.checked
          ? { ...DEFAULT_CAMPAIGN_SCHEDULE }
          : { callingStartTime: null, callingEndTime: null, autoResumeDaily: false })} />
        Limit calls to selected hours
      </label>
      {enabled && <>
        <div className="grid grid-cols-2 gap-3">
          {[['callingStartTime', 'Start time'], ['callingEndTime', 'End time']].map(([field, label]) => (
            <label key={field} className="block text-sm text-foreground">
              <span className="block mb-1">{label}</span>
              <input type="time" step="60" required value={value[field] || ''}
                onChange={(event) => onChange({ [field]: event.target.value })}
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-foreground" />
            </label>
          ))}
        </div>
        <label className="flex items-center gap-2 text-sm text-foreground">
          <input type="checkbox" checked={Boolean(value.autoResumeDaily)}
            onChange={(event) => onChange({ autoResumeDaily: event.target.checked })} />
          Automatically resume pending calls next day
        </label>
        <p className="text-xs text-muted">{value.autoResumeDaily
          ? 'Pending calls resume daily at the selected start time, until completed or manually paused.'
          : 'After the end time, pending calls stay paused until you click Resume.'}
          {' '}An ongoing call always finishes normally. No new calls start at or after the end time.
        </p>
      </>}
      {!enabled && <p className="text-xs text-muted">No daily time restriction. Existing call-gap settings still apply.</p>}
    </fieldset>
  );
}
