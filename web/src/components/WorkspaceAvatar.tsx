import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { keys } from '../lib/queries';
import { Icon } from './Icon';

/** A workspace's badge: its uploaded organisation logo, or the first letter of its name. */
export function WorkspaceAvatar({ name, logo, size }: { name: string; logo?: string; size?: 'sm' | 'lg' | 'xl' }) {
  const cls = `ws-avatar ${size ?? ''} ${logo ? 'has-logo' : ''}`.trim();
  if (logo) return <span className={cls}><img src={logo} alt="" /></span>;
  return <span className={cls} aria-hidden="true">{name.trim()[0]?.toUpperCase() ?? 'W'}</span>;
}

/**
 * Reads an image the person picked and shrinks it to fit `max` pixels on its longest side,
 * so even a large photo uploads as a small PNG/WebP data URL the server accepts.
 */
export async function shrinkImage(file: File, max = 256): Promise<string> {
  if (!/^image\/(png|jpeg|webp|gif|svg\+xml)$/.test(file.type)) throw new Error('Choose a PNG, JPG, WebP, GIF or SVG image.');
  if (file.size > 15 * 1024 * 1024) throw new Error('That image is over 15 MB — choose a smaller one.');
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((ok, fail) => {
      const i = new Image(); i.onload = () => ok(i); i.onerror = () => fail(new Error('That file couldn’t be read as an image.')); i.src = url;
    });
    const w0 = img.naturalWidth || max, h0 = img.naturalHeight || max;
    const k = Math.min(1, max / Math.max(w0, h0));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w0 * k)); c.height = Math.max(1, Math.round(h0 * k));
    c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
    const webp = c.toDataURL('image/webp', 0.9);
    return webp.startsWith('data:image/webp') ? webp : c.toDataURL('image/png');
  } finally { URL.revokeObjectURL(url); }
}

/**
 * Upload, replace or remove an organisation's logo. Saves straight away, so it works the same
 * in onboarding and in Settings; `onChange` hears the new value once the server has it.
 */
export function LogoUploader({ slug, name, logo, onChange }: { slug: string; name: string; logo?: string; onChange?: (logo: string) => void }) {
  const qc = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const save = async (next: string) => {
    setBusy(true); setError('');
    try {
      await api.patch(`/workspaces/${slug}`, { logo: next });
      onChange?.(next);
      qc.invalidateQueries({ queryKey: keys.session }); qc.invalidateQueries({ queryKey: ['ws'] });
    } catch (e) { setError(e instanceof Error ? e.message : 'That didn’t save — try again.'); }
    finally { setBusy(false); }
  };
  const pick = async (file?: File) => {
    if (!file) return;
    try { await save(await shrinkImage(file)); } catch (e) { setError(e instanceof Error ? e.message : 'That image couldn’t be used.'); }
    if (input.current) input.current.value = '';
  };
  return (
    <div className="logo-uploader">
      <WorkspaceAvatar name={name} logo={logo} size="xl" />
      <div className="logo-uploader-copy">
        <b>Organisation logo</b>
        <span>Shown in the sidebar, on invitations and on shared project pages. PNG, JPG or WebP; square works best.</span>
        <div className="logo-uploader-actions">
          <button type="button" className="btn btn-light btn-sm" disabled={busy} onClick={() => input.current?.click()}>
            <Icon name="upload" size={14} /> {busy ? 'Saving…' : logo ? 'Change logo' : 'Upload logo'}
          </button>
          {logo && <button type="button" className="btn btn-danger btn-sm" disabled={busy} onClick={() => save('')}>Remove</button>}
        </div>
        {error && <div className="form-error" role="alert">{error}</div>}
      </div>
      <input ref={input} type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml" hidden onChange={(e) => pick(e.target.files?.[0])} />
    </div>
  );
}
