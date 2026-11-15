import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { api, apiResponse, ApiError } from './api';

type Proof = { id: string; filename: string; size: number; uploaded_at: string };
const MAX_BYTES = 10 * 1024 * 1024;

export function ProofDocuments({ tripId, csrf, onExpired, onCountChanged }: {
  tripId: string; csrf: string; onExpired: () => void; onCountChanged: (count: number) => void;
}) {
  const [proofs, setProofs] = useState<Proof[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [feedback, setFeedback] = useState('');
  const [revision, setRevision] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const path = `/trips/${tripId}/proofs`;

  function failed(error: unknown) {
    if (error instanceof ApiError && error.status === 401) onExpired();
    setError(error instanceof Error ? error.message : 'Unable to access travel proofs. Please retry.');
  }

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError(''); setProofs([]);
    api<Proof[]>(path, { signal: controller.signal }).then(items => {
      if (!controller.signal.aborted) { setProofs(items); onCountChanged(items.length); }
    }).catch(error => { if (!controller.signal.aborted) failed(error); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [tripId, revision]);

  async function upload(event: FormEvent) {
    event.preventDefault();
    if (!file || busy) return;
    setError(''); setFeedback('');
    if (!file.size || file.size > MAX_BYTES) {
      setError('Choose a non-empty PDF, JPEG or PNG no larger than 10 MB.'); return;
    }
    setBusy(true);
    try {
      const saved = await api<Proof>(`${path}?filename=${encodeURIComponent(file.name)}`, {
        method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: file,
      }, csrf);
      setProofs(items => [...items, saved]); setFile(null);
      onCountChanged(proofs.length + 1);
      if (input.current) input.current.value = '';
      setFeedback('Proof uploaded.');
    } catch (error) { failed(error); }
    finally { setBusy(false); }
  }

  async function download(proof: Proof) {
    setBusy(true); setError(''); setFeedback('');
    try {
      const response = await apiResponse(`${path}/${proof.id}`);
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement('a');
      link.href = url; link.download = proof.filename;
      document.body.appendChild(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) { failed(error); }
    finally { setBusy(false); }
  }

  async function remove(proof: Proof) {
    if (!window.confirm(`Remove proof “${proof.filename}”? This permanently deletes the document.`)) return;
    setBusy(true); setError(''); setFeedback('');
    try {
      await api(`${path}/${proof.id}`, { method: 'DELETE' }, csrf);
      setProofs(items => items.filter(item => item.id !== proof.id)); setFeedback('Proof removed.');
      onCountChanged(proofs.length - 1);
    } catch (error) { failed(error); }
    finally { setBusy(false); }
  }

  return <section className="proof-documents" aria-label="Proof of travel" aria-busy={busy}>
    <h4>Proof of travel</h4>
    <p className="field-note">Attach tickets, boarding passes or other travel evidence. PDF, JPEG or PNG, up to 10 MB each; at most 20 documents. Downloads require household sign-in.</p>
    {loading ? <p role="status">Loading travel proofs…</p> : <>
      {!proofs.length && !error && <p>No proof documents attached.</p>}
      <ul className="proof-list">{proofs.map(proof => <li key={proof.id}>
        <span><strong>{proof.filename}</strong><small>{Math.max(1, Math.ceil(proof.size / 1024))} KB · {new Date(proof.uploaded_at).toLocaleDateString()}</small></span>
        <div className="actions"><button type="button" className="secondary" disabled={busy} onClick={() => void download(proof)} aria-label={`Download ${proof.filename}`}>Download</button>
          <button type="button" className="text-button danger" disabled={busy} onClick={() => void remove(proof)} aria-label={`Remove ${proof.filename}`}>Remove</button></div>
      </li>)}</ul>
      <form onSubmit={upload}>
        <label>Travel proof document<input ref={input} type="file" accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png" disabled={busy || proofs.length >= 20} onChange={event => { setFile(event.target.files?.[0] || null); setError(''); setFeedback(''); }} /></label>
        <button disabled={busy || !file || proofs.length >= 20}>{busy ? 'Working…' : 'Upload proof'}</button>
      </form>
    </>}
    {error && <div role="alert"><p className="error">{error}</p><button type="button" className="secondary" disabled={busy || loading} onClick={() => setRevision(value => value + 1)}>Reload proofs</button></div>}
    {feedback && <p role="status" className="success-message">{feedback}</p>}
  </section>;
}
