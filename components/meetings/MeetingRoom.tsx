'use client';

import { useState, useTransition } from 'react';

import type { Meeting } from '@/lib/domain';
import { formatRelative } from '@/lib/format';
import {
  approveMeetingPlan,
  closeMeeting,
  draftMeetingPlan,
  openMeeting,
  speakInMeeting,
} from '@/lib/actions/meetings';
import { Badge, Empty } from '@/components/ui/primitives';

/**
 * The room.
 *
 * One conversation surface with the founder inside it: address the whole room
 * or one participant, watch the discussion, then push it to a plan the founder
 * approves before anything becomes real. Server state is the only state — every
 * action round-trips, so the transcript can never disagree with the record.
 */
export function MeetingRoom({
  scopeKey,
  meetings,
  specialistNames,
}: {
  scopeKey: string;
  meetings: readonly Meeting[];
  specialistNames: Readonly<Record<string, string>>;
}) {
  const active = meetings.find((meeting) => meeting.stage !== 'closed');
  const [topic, setTopic] = useState('');
  const [draft, setDraft] = useState('');
  const [addressee, setAddressee] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const nameOf = (id: string) => (id === 'founder' ? 'You' : (specialistNames[id] ?? id));

  if (!active) {
    return (
      <div className="stack" style={{ gap: 'var(--s-4)' }}>
        <Empty title="No meeting in session">
          Name the topic and the right specialists are invited automatically — you can see who came
          and why before anyone speaks.
        </Empty>
        <form
          className="row"
          style={{ gap: 'var(--s-2)' }}
          onSubmit={(event) => {
            event.preventDefault();
            startTransition(async () => {
              const result = await openMeeting(scopeKey, topic);
              setError(result.ok ? null : (result.error ?? 'Could not open the meeting.'));
              if (result.ok) setTopic('');
            });
          }}
        >
          <input
            className="input grow"
            placeholder="Why are we behind on delivery, and how do we ship twice as fast?"
            value={topic}
            onChange={(event) => setTopic(event.target.value)}
            disabled={pending}
          />
          <button className="btn btn--primary" type="submit" disabled={pending || topic.trim().length < 3}>
            {pending ? 'Convening…' : 'Open the room'}
          </button>
        </form>
        {error ? <p className="note note--warn">{error}</p> : null}
      </div>
    );
  }

  return (
    <div className="stack" style={{ gap: 'var(--s-4)' }}>
      <div className="spread">
        <div className="row wrap" style={{ gap: 'var(--s-2)' }}>
          <strong>{active.topic}</strong>
          <Badge tone={active.stage === 'executing' ? 'accent' : 'outline'}>{active.stage}</Badge>
        </div>
        <button
          className="btn btn--ghost btn--sm"
          type="button"
          disabled={pending}
          onClick={() => startTransition(() => closeMeeting(scopeKey, active.id))}
        >
          End meeting
        </button>
      </div>

      <div className="row wrap" style={{ gap: 'var(--s-2)' }}>
        <span className="hint">In the room:</span>
        {active.participantIds.map((id) => (
          <Badge key={id} tone="outline">{nameOf(id)}</Badge>
        ))}
      </div>

      <div className="stack" style={{ gap: 'var(--s-3)', maxHeight: '26rem', overflowY: 'auto' }}>
        {active.turns.length === 0 ? (
          <p className="prose">
            The room is listening. Ask everyone, or address one participant from the selector below.
          </p>
        ) : (
          active.turns.map((turn, index) => (
            <div key={`${turn.at}:${index}`} className={`msg msg--${turn.speakerId === 'founder' ? 'founder' : 'assistant'}`}>
              <div className="msg-meta">
                {nameOf(turn.speakerId)}
                {turn.addresseeId ? ` → ${nameOf(turn.addresseeId)}` : ''} · {formatRelative(turn.at)}
                {turn.simulated ? ' · composed locally' : ''}
              </div>
              <div className="msg-body">{turn.text}</div>
            </div>
          ))
        )}
      </div>

      {active.stage === 'plan-ready' && active.plan ? (
        <div className="panel">
          <div className="panel-body stack" style={{ gap: 'var(--s-3)' }}>
            <strong>Plan ready — your decision</strong>
            <p className="prose">{active.plan.summary}</p>
            {active.plan.decisions.length > 0 ? (
              <div className="stack" style={{ gap: 'var(--s-1)' }}>
                <span className="eyebrow">Decisions</span>
                {active.plan.decisions.map((decision) => (
                  <span key={decision} className="hint">• {decision}</span>
                ))}
              </div>
            ) : null}
            {active.plan.tasks.length > 0 ? (
              <div className="stack" style={{ gap: 'var(--s-1)' }}>
                <span className="eyebrow">Tasks on approval</span>
                {active.plan.tasks.map((task) => (
                  <span key={task.title} className="hint">
                    • {task.title} — {nameOf(task.ownerSpecialistId)} · {task.capabilityId}
                  </span>
                ))}
              </div>
            ) : (
              <span className="hint">The plan contains no tasks — approve records the decisions only.</span>
            )}
            <div className="row" style={{ gap: 'var(--s-2)' }}>
              <button
                className="btn btn--primary"
                type="button"
                disabled={pending}
                onClick={() =>
                  startTransition(async () => {
                    const result = await approveMeetingPlan(scopeKey, active.id);
                    setError(result.ok ? null : (result.error ?? 'Approval failed.'));
                  })
                }
              >
                Approve & execute
              </button>
              <button
                className="btn btn--ghost"
                type="button"
                disabled={pending}
                onClick={() => setDraft('The plan needs changes: ')}
              >
                Ask the team to revise
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <form
        className="stack"
        style={{ gap: 'var(--s-2)' }}
        onSubmit={(event) => {
          event.preventDefault();
          const text = draft.trim();
          if (!text) return;
          setDraft('');
          startTransition(async () => {
            const result = await speakInMeeting(scopeKey, active.id, text, addressee || undefined);
            setError(result.ok ? null : (result.error ?? 'That did not reach the room.'));
          });
        }}
      >
        <div className="row" style={{ gap: 'var(--s-2)' }}>
          <select
            className="select"
            value={addressee}
            onChange={(event) => setAddressee(event.target.value)}
            aria-label="Address"
            style={{ maxWidth: '14rem' }}
          >
            <option value="">Ask everyone</option>
            {active.participantIds.map((id) => (
              <option key={id} value={id}>{nameOf(id)}</option>
            ))}
          </select>
          <input
            className="input grow"
            placeholder={addressee ? `Ask ${nameOf(addressee)}…` : 'Ask the room…'}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            disabled={pending}
          />
          <button className="btn btn--primary" type="submit" disabled={pending || !draft.trim()}>
            {pending ? 'The room is thinking…' : 'Say it'}
          </button>
        </div>
        <div className="spread">
          <span className="hint" role="status">
            {error ?? 'Specialists answer from this space’s real records. Nothing executes without your approval.'}
          </span>
          <button
            className="btn btn--secondary btn--sm"
            type="button"
            disabled={pending || active.turns.length === 0}
            onClick={() =>
              startTransition(async () => {
                const result = await draftMeetingPlan(scopeKey, active.id);
                setError(result.ok ? null : (result.error ?? 'Could not draft the plan.'));
              })
            }
          >
            Draft the plan
          </button>
        </div>
      </form>
    </div>
  );
}
