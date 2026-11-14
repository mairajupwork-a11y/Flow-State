import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { keys, useSession } from '../../lib/queries';
import { Icon } from '../../components/Icon';
import { PageLoader } from '../../components/ui';
import { WorkspaceAvatar } from '../../components/WorkspaceAvatar';
import type { Session } from '../../lib/types';
import { Brand } from './Welcome';

interface InvitePreview { workspaceName: string; workspaceLogo?: string; workspaceSlug: string; inviter: string; email: string; role: string; designation?: string; members: number }

export function AcceptInvite() {
  const { token = '' } = useParams();
  const session = useSession();
  const invite = useQuery({ queryKey: ['invite', token], queryFn: () => api.get<InvitePreview>(`/invites/${token}`), retry: false });
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  if (session.isLoading || invite.isLoading) return <div className="boot"><PageLoader /></div>;
  const next = `/invite/${token}`;

  // Signed in as someone else than the person this email invitation was sent to (e.g. two test accounts in one browser).
  const signedInEmail = session.data?.user?.email?.toLowerCase() ?? '';
  const wrongAccount = !!session.data?.user && !!invite.data?.email && invite.data.email.toLowerCase() !== signedInEmail;
  async function switchAccount() {
    setBusy(true);
    await api.post('/auth/logout', {}).catch(() => {});
    qc.setQueryData(keys.session, { user: null, workspaces: [] });
    qc.removeQueries({ predicate: (q) => q.queryKey[0] !== 'invite' });
    navigate(`/signup?next=${encodeURIComponent(next)}&email=${encodeURIComponent(invite.data!.email)}`, { replace: true });
  }

  async function accept() {
    setBusy(true);
    try {
      const res = await api.post<Session & { workspaceSlug: string }>(`/invites/${token}/accept`);
      qc.setQueryData(keys.session, { user: res.user, workspaces: res.workspaces });
      navigate(`/w/${res.workspaceSlug}`, { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not join.');
      setBusy(false);
    }
  }

  return (
    <div className="center-screen">
      <div className="auth-card invite-card">
        <Brand to="/welcome" />
        {invite.error || !invite.data ? (
          <>
            <h1>This invitation has expired</h1>
            <p className="page-subtitle">It may have been used already or withdrawn. Ask your teammate for a fresh link.</p>
            <Link className="btn btn-primary btn-block" to="/">Go to WorkMars</Link>
          </>
        ) : (
          <>
            <div className="invite-ws"><WorkspaceAvatar name={invite.data.workspaceName} logo={invite.data.workspaceLogo} size="lg" /></div>
            <h1>Join {invite.data.workspaceName}</h1>
            <p className="page-subtitle"><b>{invite.data.inviter}</b> invited you to collaborate as {invite.data.designation ? <b>{invite.data.designation}</b> : <>a <b>{invite.data.role}</b></>}. {invite.data.members} {invite.data.members === 1 ? 'person is' : 'people are'} already here.</p>
            {error && <div className="form-error" role="alert">{error}</div>}
            {wrongAccount ? (
              <div className="stack-8">
                <div className="form-note invite-mismatch" role="alert">
                  <Icon name="lock" size={15} />
                  <span>This invitation was sent to <b>{invite.data.email}</b>, but you’re signed in as <b>{session.data!.user!.name}</b> ({session.data!.user!.email}).</span>
                </div>
                <button className="btn btn-primary btn-block btn-xl" onClick={switchAccount} disabled={busy}>Sign out and continue as {invite.data.email} <Icon name="right" size={16} /></button>
                <Link className="btn btn-light btn-block" to="/">Stay signed in as {session.data!.user!.name.split(' ')[0]}</Link>
              </div>
            ) : session.data?.user ? (
              <button className="btn btn-primary btn-block btn-xl" onClick={accept} disabled={busy}>{busy ? 'Joining…' : `Join as ${session.data.user.name}`} <Icon name="right" size={16} /></button>
            ) : (
              <div className="stack-8">
                <Link className="btn btn-primary btn-block btn-xl" to={`/signup?next=${encodeURIComponent(next)}${invite.data.email ? `&email=${encodeURIComponent(invite.data.email)}` : ''}`}>Create a free account to join</Link>
                <Link className="btn btn-light btn-block" to={`/login?next=${encodeURIComponent(next)}${invite.data.email ? `&email=${encodeURIComponent(invite.data.email)}` : ''}`}>I already have an account</Link>
              </div>
            )}
            <p className="auth-legal">WorkMars is free for unlimited users — joining costs nothing.</p>
          </>
        )}
      </div>
    </div>
  );
}
