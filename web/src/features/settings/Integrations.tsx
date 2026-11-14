import { useState, type FormEvent, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Icon } from '../../components/Icon';
import { Empty, Modal, PageHeader, PageLoader } from '../../components/ui';
import { api } from '../../lib/api';
import { useWs } from '../../lib/workspace';
import { askConfirm, copyText, toast, toastError } from '../../lib/store';
import { timeAgo } from '../../lib/format';

type Kind = 'github' | 'gitlab' | 'slack' | 'teams' | 'discord' | 'googlechat';
interface Integration {
  id: number; kind: Kind; name: string; createdAt: string; lastEventAt: string | null; lastStatus: string;
  settings: { doneOnMerge?: boolean; progressOnPr?: boolean; events?: string[]; projectIds?: number[] };
  hookUrl?: string; secret?: string; url?: string;
}

export const TOOL: Record<Kind, { name: string; blurb: string; color: string; glyph: string; group: 'code' | 'chat' }> = {
  github: { name: 'GitHub', blurb: 'Link branches, commits and pull requests. Cards move when PRs open and merge.', color: '#1f2328', glyph: 'GH', group: 'code' },
  gitlab: { name: 'GitLab', blurb: 'Link branches, commits and merge requests. Cards move when MRs open and merge.', color: '#e24329', glyph: 'GL', group: 'code' },
  slack: { name: 'Slack', blurb: 'Post new work, finished work and comments to a channel.', color: '#4a154b', glyph: '#', group: 'chat' },
  teams: { name: 'Microsoft Teams', blurb: 'Keep a Teams channel up to date as work moves.', color: '#5059c9', glyph: 'T', group: 'chat' },
  discord: { name: 'Discord', blurb: 'Updates for teams that hang out on Discord.', color: '#5865f2', glyph: 'D', group: 'chat' },
  googlechat: { name: 'Google Chat', blurb: 'Updates in a Google Chat space.', color: '#00ac47', glyph: 'G', group: 'chat' },
};
const EVENTS: [string, string][] = [['created', 'New work items'], ['done', 'Finished work'], ['assigned', 'Assignments'], ['comment', 'Comments']];
const CHAT_STEPS: Record<string, ReactNode[]> = {
  slack: ['In Slack, open the channel → its name → Integrations → Add an App → “Incoming WebHooks” (or create a Slack app with Incoming Webhooks).', 'Choose the channel and copy the Webhook URL (https://hooks.slack.com/services/…).', 'Paste it below.'],
  teams: ['In Teams, open the channel → ••• → Workflows → “Post to a channel when a webhook request is received” (or Connectors → Incoming Webhook).', 'Name it “WorkMars”, finish, and copy the URL it gives you.', 'Paste it below.'],
  discord: ['In Discord, open Server Settings → Integrations → Webhooks → New Webhook.', 'Pick the channel and press “Copy Webhook URL”.', 'Paste it below.'],
  googlechat: ['In Google Chat, open the space → its name → Apps & integrations → Add webhooks.', 'Name it “WorkMars” and copy the URL.', 'Paste it below.'],
};

export const ToolLogo = ({ kind, size = 40 }: { kind: Kind; size?: number }) => (
  <span className={`tool-logo tool-${kind}`} style={{ width: size, height: size, background: TOOL[kind].color, fontSize: size * 0.38 }} aria-hidden="true">{TOOL[kind].glyph}</span>
);

function Copy({ label, value, secret = false }: { label: string; value: string; secret?: boolean }) {
  const [show, setShow] = useState(!secret);
  return (
    <div className="copy-field">
      <span>{label}</span>
      <div><code>{show ? value : '•'.repeat(24)}</code>
        {secret && <button className="icon-btn tiny" onClick={() => setShow(!show)} aria-label={show ? 'Hide' : 'Show'}><Icon name="eye" size={14} /></button>}
        <button className="btn btn-soft btn-sm" onClick={() => copyText(value, `${label} copied.`)}><Icon name="copy" size={13} /> Copy</button></div>
    </div>
  );
}

function DevSetup({ it }: { it: Integration }) {
  const gh = it.kind === 'github';
  const local = /^(localhost|127\.|0\.0\.0\.0|\[::1\])/.test(location.hostname);
  return (
    <div className="setup-steps">
      {local && <div className="form-note"><Icon name="lightbulb" size={15} /> {TOOL[it.kind].name} can’t reach a WorkMars running only on your computer. Use your public address (after you deploy), or a tunnel such as ngrok or Cloudflare Tunnel while testing.</div>}
      <ol>
        <li>In {TOOL[it.kind].name}, open your repository → <b>Settings</b> → <b>Webhooks</b> → <b>{gh ? 'Add webhook' : 'Add new webhook'}</b>.</li>
        <li><Copy label={gh ? 'Payload URL' : 'URL'} value={it.hookUrl ?? ''} /></li>
        {gh && <li>Content type: <b>application/json</b></li>}
        <li><Copy label={gh ? 'Secret' : 'Secret token'} value={it.secret ?? ''} secret /></li>
        <li>{gh ? <>Events: choose <b>Let me select individual events</b> → tick <b>Pushes</b> and <b>Pull requests</b>.</> : <>Trigger: tick <b>Push events</b> and <b>Merge request events</b>.</>}</li>
        <li>Save. Then put a work item key such as <b>WEB-101</b> in a branch name, commit message or {gh ? 'pull request' : 'merge request'} title — it links itself.</li>
      </ol>
    </div>
  );
}

function ConnectModal({ kind, onClose }: { kind: Kind; onClose: () => void }) {
  const { workspace, projects } = useWs();
  const qc = useQueryClient();
  const dev = TOOL[kind].group === 'code';
  const [created, setCreated] = useState<Integration | null>(null);
  const [url, setUrl] = useState('');
  const [events, setEvents] = useState(['created', 'done', 'comment']);
  const [projectIds, setProjectIds] = useState<number[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function create(e?: FormEvent) {
    e?.preventDefault();
    setBusy(true); setError('');
    try {
      const it = await api.post<Integration>(`/workspaces/${workspace.slug}/integrations`, dev ? { kind, settings: { doneOnMerge: true, progressOnPr: true } } : { kind, url: url.trim(), settings: { events, projectIds } });
      qc.invalidateQueries({ queryKey: ['integrations'] });
      if (dev) setCreated(it);
      else {
        await api.post(`/integrations/${it.id}/test`, {}).then(() => toast(`Connected — check ${TOOL[kind].name} for a hello message.`)).catch((err) => toastError(err));
        onClose();
      }
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not connect.'); }
    setBusy(false);
  }
  return (
    <Modal title={`Connect ${TOOL[kind].name}`} subtitle={TOOL[kind].blurb} onClose={onClose}
      footer={dev ? (created ? <button className="btn btn-primary" onClick={onClose}>Done</button> : <button className="btn btn-primary" onClick={() => create()} disabled={busy}><Icon name="link" size={14} /> Create connection</button>)
        : <><button className="btn btn-light" onClick={onClose}>Cancel</button><button className="btn btn-primary" onClick={() => create()} disabled={busy || !url.trim() || !events.length}><Icon name="check" size={14} /> Connect and send a test</button></>}>
      <div className="modal-body stack-14">
        {error && <div className="form-error" role="alert">{error}</div>}
        {dev ? (created ? <DevSetup it={created} /> : (
          <div className="setup-intro">
            <ToolLogo kind={kind} size={52} />
            <ul className="setup-bullets">
              <li><Icon name="link" size={14} /> Branches, commits and {kind === 'github' ? 'pull' : 'merge'} requests show on the work item</li>
              <li><Icon name="bolt" size={14} /> Opening a {kind === 'github' ? 'PR' : 'MR'} moves the card to <b>In progress</b></li>
              <li><Icon name="check" size={14} /> Merging it moves the card to <b>Done</b></li>
              <li><Icon name="lock" size={14} /> Every delivery is checked with a secret only you and {TOOL[kind].name} know</li>
            </ul>
          </div>
        )) : (
          <form onSubmit={create} className="stack-14">
            <ol className="plain-steps">{CHAT_STEPS[kind].map((s, i) => <li key={i}>{s}</li>)}</ol>
            <label className="form-field"><span>Webhook URL</span><input className="text-input" autoFocus value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" /></label>
            <fieldset className="form-field plain"><legend>Post about</legend>
              <div className="check-list">{EVENTS.map(([id, label]) => <label key={id} className="check-row"><input type="checkbox" checked={events.includes(id)} onChange={(e) => setEvents((ev) => e.target.checked ? [...ev, id] : ev.filter((x) => x !== id))} /> {label}</label>)}</div>
            </fieldset>
            {projects.length > 1 && (
              <fieldset className="form-field plain"><legend>Projects <small className="muted-inline">(none ticked = all)</small></legend>
                <div className="check-list">{projects.map((p) => <label key={p.id} className="check-row"><input type="checkbox" checked={projectIds.includes(p.id)} onChange={(e) => setProjectIds((ids) => e.target.checked ? [...ids, p.id] : ids.filter((x) => x !== p.id))} /> {p.name}</label>)}</div>
              </fieldset>
            )}
          </form>
        )}
      </div>
    </Modal>
  );
}

function ConnectionRow({ it }: { it: Integration }) {
  const { locale } = useWs();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const refresh = () => qc.invalidateQueries({ queryKey: ['integrations'] });
  const save = useMutation({ mutationFn: (settings: Integration['settings']) => api.patch(`/integrations/${it.id}`, { settings }), onSuccess: refresh, onError: toastError });
  const remove = useMutation({ mutationFn: () => api.del(`/integrations/${it.id}`), onSuccess: () => { refresh(); toast(`${TOOL[it.kind].name} disconnected.`); } });
  const test = useMutation({ mutationFn: () => api.post(`/integrations/${it.id}/test`, {}), onSuccess: () => { refresh(); toast('Test message sent.'); }, onError: (e) => { refresh(); toastError(e); } });
  const ok = it.lastStatus.startsWith('ok');
  const dev = TOOL[it.kind].group === 'code';
  return (
    <div className="conn-row">
      <div className="conn-head">
        <ToolLogo kind={it.kind} size={36} />
        <div className="conn-copy">
          <b>{it.name}</b>
          <small>{it.lastEventAt ? <><span className={`conn-dot ${ok ? 'ok' : 'bad'}`} /> {it.lastStatus || 'ok'} · {timeAgo(it.lastEventAt, locale)}</> : <><span className="conn-dot wait" /> Waiting for the first {dev ? 'delivery' : 'message'}{it.url ? ` · ${it.url}` : ''}</>}</small>
        </div>
        <div className="row-8">
          {dev ? <button className="btn btn-light btn-sm" onClick={() => setOpen(!open)}>{open ? 'Hide setup' : 'Setup details'}</button>
            : <button className="btn btn-light btn-sm" onClick={() => test.mutate()} disabled={test.isPending}>Send test</button>}
          <button className="icon-btn" aria-label={`Disconnect ${it.name}`} onClick={async () => (await askConfirm({ title: `Disconnect ${it.name}?`, body: dev ? 'Deliveries will be refused. Links already on work items stay.' : 'No more messages will be posted.', confirmLabel: 'Disconnect', danger: true })) && remove.mutate()}><Icon name="trash" size={15} /></button>
        </div>
      </div>
      <div className="conn-opts">
        {dev ? (<>
          <label className="check-row"><input type="checkbox" checked={it.settings.progressOnPr !== false} onChange={(e) => save.mutate({ progressOnPr: e.target.checked })} /> Move to In progress when a {it.kind === 'github' ? 'PR' : 'MR'} opens</label>
          <label className="check-row"><input type="checkbox" checked={it.settings.doneOnMerge !== false} onChange={(e) => save.mutate({ doneOnMerge: e.target.checked })} /> Move to Done when it merges</label>
        </>) : EVENTS.map(([id, label]) => {
          const on = (it.settings.events ?? ['created', 'done', 'comment']).includes(id);
          return <label key={id} className="check-row"><input type="checkbox" checked={on} onChange={(e) => save.mutate({ events: e.target.checked ? [...(it.settings.events ?? ['created', 'done', 'comment']), id] : (it.settings.events ?? ['created', 'done', 'comment']).filter((x) => x !== id) })} /> {label}</label>;
        })}
      </div>
      {open && dev && <DevSetup it={it} />}
    </div>
  );
}

export default function Integrations() {
  const { workspace, canEdit } = useWs();
  const [connect, setConnect] = useState<Kind | null>(null);
  const { data, isLoading } = useQuery({ queryKey: ['integrations', workspace.slug], queryFn: () => api.get<Integration[]>(`/workspaces/${workspace.slug}/integrations`), enabled: canEdit });
  if (!canEdit) return <><PageHeader eyebrow="Workspace / Integrations" title="Connect your tools." /><div className="content-card"><Empty icon="lock" title="Managers set up connections">Ask a project manager, team lead or admin to connect GitHub, GitLab or your chat app.</Empty></div></>;
  const group = (g: 'code' | 'chat') => (Object.keys(TOOL) as Kind[]).filter((k) => TOOL[k].group === g);
  return (
    <>
      <PageHeader eyebrow="Workspace / Integrations" title="Connect your tools." subtitle="Link code to work items and keep your team chat in the loop. Free, like everything else." />
      {isLoading ? <PageLoader /> : (
        <>
          {!!data?.length && (
            <div className="content-card conn-list">
              <div className="dash-card-head"><h3><span className="dash-ico mint"><Icon name="check" size={15} /></span> Connected</h3><span className="muted">{data.length}</span></div>
              {data.map((it) => <ConnectionRow key={it.id} it={it} />)}
            </div>
          )}
          {(['code', 'chat'] as const).map((g) => (
            <section key={g} className="tool-section">
              <h3 className="tool-group">{g === 'code' ? 'Code' : 'Team chat'}</h3>
              <div className="tool-grid">
                {group(g).map((k) => {
                  const count = data?.filter((d) => d.kind === k).length ?? 0;
                  return (
                    <div key={k} className="content-card tool-card">
                      <ToolLogo kind={k} />
                      <div><b>{TOOL[k].name}</b><p className="muted">{TOOL[k].blurb}</p></div>
                      <button className={`btn ${count ? 'btn-light' : 'btn-primary'} btn-sm`} onClick={() => setConnect(k)}><Icon name="plus" size={13} /> {count ? 'Add another' : 'Connect'}</button>
                    </div>
                  );
                })}
              </div>
            </section>
          ))}
        </>
      )}
      {connect && <ConnectModal kind={connect} onClose={() => setConnect(null)} />}
    </>
  );
}
