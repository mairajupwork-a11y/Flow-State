import { useSearchParams } from 'react-router-dom';
import { fmtClock, useElapsed, useRunningTimer, useTimeActions } from '../lib/time';

/** The running timer, always visible in the top bar: tap it to open the work item, ■ to stop. */
export function TimerPill() {
  const { data: run } = useRunningTimer();
  const elapsed = useElapsed(run?.startedAt);
  const { stop } = useTimeActions();
  const [, setParams] = useSearchParams();
  if (!run) return null;
  return (
    <div className="timer-pill" role="status" aria-label={`Timer running on ${run.issueKey}`}>
      <span className="timer-dot" aria-hidden="true" />
      <button className="timer-open" onClick={() => setParams((p) => { const n = new URLSearchParams(p); n.set('issue', run.issueKey); return n; })} title={run.issueTitle}>
        <b>{fmtClock(elapsed)}</b><span>{run.issueKey}</span>
      </button>
      <button className="timer-stop" onClick={() => stop.mutate()} aria-label="Stop the timer" title="Stop timer"><span /></button>
    </div>
  );
}
