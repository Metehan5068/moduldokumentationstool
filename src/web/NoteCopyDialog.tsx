import { useLayoutEffect, useRef, useState } from 'react';

export function NoteCopyDialog({ id, pageCount, replacing, disabled, onCancel, onCopy }: {
  id: string; pageCount: number; replacing: boolean; disabled: boolean;
  onCancel: () => void; onCopy: (sourcePage: number) => string | undefined;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [source, setSource] = useState('');
  const [error, setError] = useState<string>();
  useLayoutEffect(() => {
    const node = dialog.current!;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
    node.showModal();
    return () => { node.close(); if (opener?.isConnected) opener.focus({ preventScroll: true }); };
  }, []);
  return <dialog className="relevance-dialog" ref={dialog} aria-labelledby={`${id}-copy-title`}
    onCancel={(event) => { event.preventDefault(); onCancel(); }}
    onKeyDown={(event) => {
      if (event.ctrlKey && event.key.toLowerCase() === 's') return;
      event.stopPropagation();
      if (event.altKey || (event.ctrlKey && event.key.toLowerCase() === 'g')) event.preventDefault();
    }}>
    <h2 id={`${id}-copy-title`}>Notiz aus anderer Folie kopieren</h2>
    <p>Die aktuelle Notiz der gewählten Folie wird als unabhängige Kopie übernommen. Die Quelle bleibt unverändert.</p>
    {replacing && <p className="copy-warning">Die vorhandene Zielnotiz wird dabei ersetzt.</p>}
    <form noValidate onSubmit={(event) => {
      event.preventDefault();
      if (disabled) return;
      const number = Number(source);
      if (!Number.isInteger(number) || number < 1 || number > pageCount) { setError(`Bitte eine Foliennummer von 1 bis ${pageCount} eingeben.`); return; }
      setError(onCopy(number));
    }}>
      <label htmlFor={`${id}-copy-source`}>Von Folie (1–{pageCount})</label>
      <input id={`${id}-copy-source`} autoFocus type="number" min="1" max={pageCount} step="1" value={source} onChange={(event) => { setSource(event.target.value); setError(undefined); }} />
      {disabled && <p role="alert">Die Notizen sind schreibgeschützt. Es wird nichts übernommen.</p>}
      {error && <p role="alert">{error}</p>}
      <div className="relevance-dialog-actions">
        <button type="button" onClick={onCancel}>Abbrechen</button>
        <button type="submit" disabled={disabled}>{replacing ? 'Text ersetzen und übernehmen' : 'Notiz übernehmen'}</button>
      </div>
    </form>
  </dialog>;
}
