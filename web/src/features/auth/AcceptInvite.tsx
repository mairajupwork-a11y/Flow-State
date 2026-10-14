import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { keys, useSession } from '../../lib/queries';
import { Icon } from '../../components/Icon';
import { PageLoader } from '../../components/ui';
import type { Session } from '../../lib/types';
import { Brand } from './Welcome';

interface InvitePreview { workspaceName: string; workspaceSlug: string; inviter: string; email: string; role: string; members: number }

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
            <Link className="btn btn-primary btn-block" to="/">Go to Flowstate</Link>
          </>
        ) : (
          <>
            <div className="invite-ws"><span className="ws-avatar lg">{invite.data.workspaceName[0]?.toUpperCase()}</span></div>
            <h1>Join {invite.data.workspaceName}</h1>
            <p className="page-subtitle"><b>{invite.data.inviter}</b> invited you to collaborate as a <b>{invite.data.role}</b>. {invite.data.members} {invite.data.members === 1 ? 'person is' : 'people are'} already here.</p>
            {error && <div className="form-error" role="alert">{error}</div>}
            {session.data?.user ? (
              <button className="btn btn-primary btn-block btn-xl" onClick={accept} disabled={busy}>{busy ? 'Joining…' : `Join as ${session.data.user.name}`} <Icon name="right" size={16} /></button>
            ) : (
              <div className="stack-8">
                <Link className="btn btn-primary btn-block btn-xl" to={`/signup?next=${encodeURIComponent(next)}${invite.data.email ? `&email=${encodeURIComponent(invite.data.email)}` : ''}`}>Create a free account to join</Link>
                <Link className="btn btn-light btn-block" to={`/login?next=${encodeURIComponent(next)}`}>I already have an account</Link>
              </div>
            )}
            <p className="auth-legal">Flowstate is free for unlimited users — joining costs nothing.</p>
          </>
        )}
      </div>
    </div>
  );
}
