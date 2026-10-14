import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './Icon';
import { dismissToast, useToasts } from '../lib/store';
import { PRIORITY_LABEL, TYPE_ICON, TYPE_LABEL } from '../lib/format';
import type { IssueType, Priority, StatusCategory, User } from '../lib/types';

export function Avatar({ user, size = '', title }: { user?: Pick<User, 'name' | 'initials' | 'color'> | null; size?: '' | 'lg' | 'card-avatar' | 'sm'; title?: string }) {
  if (!user) {
    return <span className={`avatar avatar-empty ${size}`} title={title ?? 'Unassigned'} aria-label="Unassigned"><Icon name="people" size={13} /></span>;
  }
  return <span className={`avatar ${size}`} style={{ background: user.color }} title={title ?? user.name}>{user.initials}</span>;
}

export function AvatarGroup({ users, max = 4 }: { users: Pick<User, 'id' | 'name' | 'initials' | 'color'>[]; max?: number }) {
  const extra = users.length - max;
  return (
    <div className="avatar-group">
      {users.slice(0, max).map((u) => <Avatar key={u.id} user={u} />)}
      {extra > 0 && <span className="avatar avatar-more" title={`${extra} more`}>+{extra}</span>}
    </div>
  );
}

export function PriorityPill({ priority, suffix = '' }: { priority: Priority; suffix?: string }) {
  return <span className={`priority ${priority}`}><Icon name="flag" size={11} /> {PRIORITY_LABEL[priority]}{suffix}</span>;
}

export function StatusPill({ name, category }: { name: string; category: StatusCategory }) {
  const cls = category === 'done' ? 'done' : category === 'progress' ? (/review|approv/i.test(name) ? 'review' : 'progress') : '';
  return <span className={`status-pill ${cls}`}>{name}</span>;
}

export function TypeIcon({ type, size = 14 }: { type: IssueType; size?: number }) {
  return <span className={`issue-type ${type}`} title={TYPE_LABEL[type]} aria-label={TYPE_LABEL[type]}><Icon name={TYPE_ICON[type]} size={size} /></span>;
}

export function Empty({ icon = 'checkcircle', title, children, action }: { icon?: string; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      <Icon name={icon} size={36} />
      <h3>{title}</h3>
      {children && <p>{children}</p>}
      {action}
    </div>
  );
}

export function Toggle({ on, onChange, label, disabled }: { on: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return <button type="button" className={`toggle ${on ? 'on' : ''}`} role="switch" aria-checked={on} aria-label={label} disabled={disabled} onClick={() => onChange(!on)} />;
}

export function Spinner({ label = 'Loading' }: { label?: string }) {
  return <div className="spinner-wrap" role="status" aria-live="polite"><span className="spinner" /><span className="sr-only">{label}</span></div>;
}

export function PageLoader() {
  return (
    <div className="page-loader" aria-busy="true">
      <div className="skeleton sk-title" />
      <div className="skeleton sk-sub" />
      <div className="sk-grid">{Array.from({ length: 4 }, (_, i) => <div key={i} className="skeleton sk-card" />)}</div>
      <div className="skeleton sk-block" />
    </div>
  );
}

export function ErrorState({ error, retry }: { error: unknown; retry?: () => void }) {
  return (
    <div className="content-card">
      <Empty icon="flag" title="We couldn’t load this" action={retry && <button className="btn btn-soft" onClick={retry}><Icon name="refresh" size={15} /> Try again</button>}>
        {error instanceof Error ? error.message : 'Please refresh the page.'}
      </Empty>
    </div>
  );
}

/** Accessible dialog: focus trap, Esc to close, restores focus, click-outside to dismiss. */
export function Modal({ title, subtitle, onClose, children, wide = false, footer, labelId = 'modal-label' }: {
  title: ReactNode; subtitle?: ReactNode; onClose: () => void; children: ReactNode; wide?: boolean; footer?: ReactNode; labelId?: string;
}) {
  const ref = useRef<HTMLElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const node = ref.current;
    const first = node?.querySelector<HTMLElement>('[data-autofocus], input:not([type=hidden]):not([type=checkbox]), textarea, select');
    (first ?? node)?.focus();
    const onKey = (e: KeyboardEvent) => {
      const all = document.querySelectorAll('.modal');
      if (all[all.length - 1] !== node) return; // only the top-most dialog reacts
      if (e.key === 'Escape') {
        e.stopPropagation();
        closeRef.current();
      } else if (e.key === 'Tab' && node) {
        const items = [...node.querySelectorAll<HTMLElement>('button:not([disabled]), [href], input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])')];
        if (!items.length) return;
        const [a, z] = [items[0], items[items.length - 1]];
        if (e.shiftKey && document.activeElement === a) { e.preventDefault(); z.focus(); }
        else if (!e.shiftKey && document.activeElement === z) { e.preventDefault(); a.focus(); }
      }
    };
    document.addEventListener('keydown', onKey, true);
    document.body.classList.add('modal-open');
    return () => {
      document.removeEventListener('keydown', onKey, true);
      if (!document.querySelector('.modal')) document.body.classList.remove('modal-open');
      previous?.focus?.();
    };
  }, []);
  return createPortal(
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <section ref={ref} className={`modal ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-labelledby={labelId} tabIndex={-1}>
        <div className="modal-header">
          <div style={{ minWidth: 0 }}>
            <h2 id={labelId}>{title}</h2>
            {subtitle && <p>{subtitle}</p>}
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Close dialog"><Icon name="close" /></button>
        </div>
        {children}
        {footer && <div className="modal-footer">{footer}</div>}
      </section>
    </div>,
    document.body,
  );
}

export function Toasts() {
  const list = useToasts();
  return createPortal(
    <div className="toast-stack" aria-live="polite">
      {list.map((t) => (
        <div key={t.id} className={`toast ${t.tone === 'error' ? 'toast-error' : ''}`} role={t.tone === 'error' ? 'alert' : 'status'}>
          <span>{t.message}</span>
          {t.action && <button className="toast-action" onClick={() => { t.action!.run(); dismissToast(t.id); }}>{t.action.label}</button>}
        </div>
      ))}
    </div>,
    document.body,
  );
}

/** Eyebrow + title + subtitle header, matching the prototype's page heading. */
export function PageHeader({ eyebrow, title, subtitle, actions }: { eyebrow: string; title: ReactNode; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="title-section">
      <div>
        <div className="eyebrow"><span className="line" />{eyebrow}</div>
        <h1 className="page-title">{title}</h1>
        {subtitle && <p className="page-subtitle">{subtitle}</p>}
      </div>
      {actions && <div className="title-actions">{actions}</div>}
    </div>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <span className="kbd">{children}</span>;
}

/** Lightweight bullet/bold renderer for guide and description text. Escapes by construction. */
export function RichText({ text }: { text: string }) {
  const lines = text.split('\n');
  return (
    <>
      {lines.map((line, i) => (
        <span key={i}>
          {line.split(/(\*\*[^*]+\*\*)/g).map((part, j) => (part.startsWith('**') && part.endsWith('**') ? <b key={j}>{part.slice(2, -2)}</b> : part))}
          {i < lines.length - 1 && <br />}
        </span>
      ))}
    </>
  );
}
