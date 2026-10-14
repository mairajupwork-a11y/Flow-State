import { useState } from 'react';
import { Modal } from './ui';
import { settleConfirm, useConfirm } from '../lib/store';

export function ConfirmHost() {
  const req = useConfirm();
  const [typed, setTyped] = useState('');
  if (!req) return null;
  const close = (ok: boolean) => { setTyped(''); settleConfirm(ok); };
  const blocked = !!req.typeToConfirm && typed.trim().toUpperCase() !== req.typeToConfirm.toUpperCase();
  return (
    <Modal title={req.title} onClose={() => close(false)} labelId="confirm-label"
      footer={<>
        <button className="btn btn-light" onClick={() => close(false)}>Cancel</button>
        <button className={`btn ${req.danger ? 'btn-danger-solid' : 'btn-primary'}`} data-autofocus={!req.typeToConfirm || undefined} disabled={blocked} onClick={() => close(true)}>{req.confirmLabel ?? 'Confirm'}</button>
      </>}>
      <div className="modal-body">
        {req.body && <p className="page-subtitle" style={{ marginTop: 0 }}>{req.body}</p>}
        {req.typeToConfirm && (
          <label className="form-field" style={{ marginTop: 12 }}>
            <span>Type <b>{req.typeToConfirm}</b> to confirm</span>
            <input className="text-input" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" />
          </label>
        )}
      </div>
    </Modal>
  );
}
