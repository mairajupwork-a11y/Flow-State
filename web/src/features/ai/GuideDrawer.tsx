import { Mark } from '../../components/Logo';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Icon } from '../../components/Icon';
import { RichText } from '../../components/ui';
import { api } from '../../lib/api';
import { invalidateWork } from '../../lib/queries';
import { useWs, useCurrentProject } from '../../lib/workspace';
import { copyText, toast, toastError, ui, useUi } from '../../lib/store';
import { todayISO } from '../../lib/format';
import type { GuideAction, GuideAnswer, Issue } from '../../lib/types';

interface Message { id: number; role: 'user' | 'guide'; text: string; answer?: GuideAnswer; done?: Set<number> }

// Conversation survives closing and reopening the drawer, per person and workspace,
// so a different user signing in on the same tab never sees it.
const histories = new Map<string, Message[]>();
let nextId = 1;

const STARTERS: [string, string][] = [['Prioritise my day', 'sun'], ['What needs attention?', 'flag'], ['Plan the next sprint', 'calendar'], ['How do I use this?', 'lightbulb']];

export function GuideDrawer({ routeKey, onClose }: { routeKey?: string; onClose: () => void }) {
  const { workspace, base, me } = useWs();
  const project = useCurrentProject(routeKey);
  const prompt = useUi((s) => s.guidePrompt);
  const historyKey = `${me.id}:${workspace.slug}`;
  const [messages, setMessages] = useState<Message[]>(() => histories.get(historyKey) ?? []);
  const [input, setInput] = useState('');
  const [thinking, setThinking] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();
  const [, setParams] = useSearchParams();
  const qc = useQueryClient();

  useEffect(() => { histories.set(historyKey, messages); }, [historyKey, messages]);
  useEffect(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' }); }, [messages, thinking]);
  useEffect(() => {
    inputRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !document.querySelector('.modal') && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
  useEffect(() => {
    if (prompt) {
      ask(prompt);
      ui.set({ guidePrompt: null });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prompt]);

  async function ask(question: string) {
    const q = question.trim();
    if (!q || thinking) return;
    setMessages((m) => [...m, { id: nextId++, role: 'user', text: q }]);
    setInput('');
    setThinking(true);
    try {
      localStorage.setItem('fs_asked_guide', '1');
    } catch {
      /* storage blocked */
    }
    try {
      const answer = await api.post<GuideAnswer>(`/ai/${workspace.slug}/ask`, { question: q, projectId: project?.id ?? null });
      setMessages((m) => [...m, { id: nextId++, role: 'guide', text: answer.text, answer, done: new Set() }]);
    } catch (err) {
      setMessages((m) => [...m, { id: nextId++, role: 'guide', text: err instanceof Error ? err.message : 'Sorry — something went wrong. Please try again.' }]);
    } finally {
      setThinking(false);
    }
  }

  async function run(msg: Message, action: GuideAction, index: number) {
    const markDone = () => setMessages((m) => m.map((x) => (x.id === msg.id ? { ...x, done: new Set([...(x.done ?? []), index]) } : x)));
    try {
      switch (action.type) {
        case 'create_issue': {
          const { projectId, ...body } = action.payload;
          const created = await api.post<Issue>(`/projects/${projectId}/issues`, body);
          invalidateWork(qc);
          markDone();
          toast(`${created.key} created.`, { action: { label: 'Open', run: () => setParams({ issue: created.key }) } });
          break;
        }
        case 'add_todo':
          await api.post('/todos', { text: action.payload.text, day: todayISO() });
          qc.invalidateQueries({ queryKey: ['todos'] });
          markDone();
          toast('Added to My day.', { action: { label: 'View', run: () => navigate(`${base}/my-day`) } });
          break;
        case 'plan_day':
          for (const item of action.payload.items) await api.post('/todos', { ...item, day: todayISO(), timeBlock: 'morning' });
          qc.invalidateQueries({ queryKey: ['todos'] });
          markDone();
          toast(`${action.payload.items.length} items pinned to My day.`, { action: { label: 'View', run: () => navigate(`${base}/my-day`) } });
          break;
        case 'open_issue':
          setParams({ issue: action.payload.key });
          break;
        case 'navigate':
          navigate(`${base}/${action.payload.to}`);
          if (matchMedia('(max-width: 760px)').matches) onClose();
          break;
      }
    } catch (err) {
      toastError(err);
    }
  }

  return createPortal(
    <>
      <div className="drawer-shade" onClick={onClose} />
      <aside className="ai-drawer" role="dialog" aria-modal="true" aria-label="Mars guide">
        <header className="ai-header">
          <div className="ai-bot"><Mark size={26} /></div>
          <div className="ai-head-label"><strong>Mars guide</strong><small>Free AI guide · knows your workspace{project ? ` · ${project.key}` : ''}</small></div>
          {messages.length > 0 && <button className="icon-btn" onClick={() => setMessages([])} title="Start a new conversation" aria-label="New conversation"><Icon name="refresh" size={17} /></button>}
          <button className="icon-btn" onClick={onClose} aria-label="Close the Mars guide"><Icon name="close" /></button>
        </header>
        <div className="ai-content" ref={scrollRef} aria-live="polite">
          {!messages.length && (
            <>
              <div className="ai-welcome">
                <span className="ai-mini">YOUR WORK COMPANION</span>
                <h3>Hi {me.name.split(' ')[0]}, a little clarity goes a long way.</h3>
                <p>I can plan your day, spot blockers, size a sprint, write your stand-up, create work from a sentence, or show you around WorkMars. Free, with no limits.</p>
              </div>
              <div className="ai-chips">
                {STARTERS.map(([q, icon]) => <button key={q} className="ai-prompt" onClick={() => ask(q)}><Icon name={icon} size={16} /><span>{q}</span></button>)}
              </div>
              <div className="tip-box"><Icon name="lightbulb" size={17} /><span>Try: <b>“create a bug: export fails on Safari, urgent, assign to me, due Friday”</b> or <b>“remind me to call the supplier”</b>.</span></div>
            </>
          )}
          {messages.map((m) => m.role === 'user' ? (
            <div key={m.id} className="chat-user"><span>{m.text}</span></div>
          ) : (
            <div key={m.id} className="chat-guide">
              <div className="ai-answer"><RichText text={m.text} /></div>
              {!!m.answer?.actions.length && (
                <div className="chat-actions">
                  {m.answer.actions.map((a, i) => (
                    <button key={i} className={`btn btn-sm ${i === 0 ? 'btn-primary' : 'btn-light'}`} disabled={m.done?.has(i)} onClick={() => run(m, a, i)}>
                      {m.done?.has(i) ? <><Icon name="check" size={13} /> Done</> : a.label}
                    </button>
                  ))}
                  {m.answer.copyable && <button className="btn btn-sm btn-light" onClick={() => copyText(m.text.replace(/\*\*/g, ''), 'Copied to clipboard.')}><Icon name="copy" size={13} /> Copy</button>}
                </div>
              )}
              {!!m.answer?.suggestions.length && m.id === messages.at(-1)?.id && (
                <div className="chat-suggest">{m.answer.suggestions.map((s) => <button key={s} onClick={() => ask(s)}>{s}</button>)}</div>
              )}
            </div>
          ))}
          {thinking && <div className="chat-guide"><div className="ai-answer typing" aria-label="Mars guide is thinking"><i /><i /><i /></div></div>}
        </div>
        <div className="ai-bottom">
          <form className="ai-chat-input" onSubmit={(e: FormEvent) => { e.preventDefault(); ask(input); }}>
            <input ref={inputRef} className="text-input" value={input} onChange={(e) => setInput(e.target.value)} maxLength={600} placeholder="Ask about your work…" aria-label="Ask the Mars guide" />
            <button className="btn btn-primary" type="submit" aria-label="Send" disabled={!input.trim() || thinking}><Icon name="send" size={16} /></button>
          </form>
          <div className="ai-disclaimer">Free forever. Answers come from your workspace data — nothing is sent to third-party AI services. Check important details.</div>
        </div>
      </aside>
    </>,
    document.body,
  );
}
