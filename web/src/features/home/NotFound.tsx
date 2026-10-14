import { Link } from 'react-router-dom';
import { Empty } from '../../components/ui';

export function NotFound({ standalone = false }: { standalone?: boolean }) {
  const body = (
    <div className="content-card" style={{ maxWidth: 520, margin: '40px auto' }}>
      <Empty icon="search" title="We couldn’t find that page" action={<Link className="btn btn-primary" to="/">Back to Flowstate</Link>}>
        It may have moved, or the link might be mistyped.
      </Empty>
    </div>
  );
  return standalone ? <div className="center-screen">{body}</div> : body;
}
