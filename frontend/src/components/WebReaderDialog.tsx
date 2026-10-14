import {useDialogVisibility} from '../lib/dialog-visibility';
import { createPortal } from "react-dom";
import {WebViewer} from './WebViewer';
import { useEffect, useRef, useState } from 'react';
import { GlobeSimple } from '../icons';
import { api } from '../api';
import { useStore } from '../store';
import { t } from '../i18n';
import './SharingDialogs.css';
import './WebReaderDialog.css';
type Page = { url: string; title: string; html: string; text: string };
const escape = (s: string) => s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
export function WebReaderDialog() {
  const store = useStore(), dialog = useRef<HTMLDialogElement>(null), request = useRef<AbortController | null>(null), version = useRef(0);
  const [open, setOpen] = useState(false), [url, setUrl] = useState(''), [page, setPage] = useState<Page | null>(null);
  const [busy, setBusy] = useState(false), [saving, setSaving] = useState(false), [error, setError] = useState(''), [plain, setPlain] = useState(false), [saved, setSaved] = useState(false);
  const noteId = useRef(''), saveLock = useRef(false);
  useDialogVisibility(dialog,open);
  useEffect(() => () => { version.current++; request.current?.abort(); }, []);
  const cancel = () => { version.current++; request.current?.abort(); request.current = null; setBusy(false); };
  const close = () => { if (saveLock.current) return; cancel(); setOpen(false); };
  const read = async () => {
    cancel(); const generation = version.current, controller = new AbortController(); request.current = controller;
    setBusy(true); setPage(null); setSaved(false); setError('');
    try {
      const target = new URL(url);
      if (!['http:', 'https:'].includes(target.protocol) || target.username || target.password) throw new Error(t('공개 웹페이지 주소를 입력해 주세요.'));
      const response = await fetch('/api/reader', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: target.href }), signal: controller.signal });
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error(result.error || t('페이지를 읽지 못했습니다.'));
      if (generation !== version.current) return;
      noteId.current = crypto.randomUUID(); setPage(result.data); setPlain(false);
    } catch (e) { if (generation === version.current && !controller.signal.aborted) setError(String(e)); }
    finally { if (generation === version.current) { setBusy(false); request.current = null; } }
  };
  const save = async () => {
    if (!page || saveLock.current || saved) return;
    saveLock.current = true; setSaving(true); setError('');
    try {
      if (!(await store.flushNow())) throw new Error(t('현재 노트를 저장한 뒤 다시 시도해 주세요.'));
      const content = page.html + `<p>${escape(t('출처'))}: ${escape(page.url)}</p>`;
      try { await api.save({ id: noteId.current, title: page.title, content, content_format: 'html', revision: 0, require_absent: true }); }
      catch (error) {
        // Retrying a lost response must not create duplicates or overwrite edits.
        const existing = await api.get(noteId.current).catch(() => null);
        if (existing?.content !== content || existing.title !== page.title) throw error;
      }
      setSaved(true); store.refreshList(); await store.refreshMeta(); await store.selectNote(noteId.current);
    } catch (e) { setError(String(e)); }
    finally { saveLock.current = false; setSaving(false); }
  };
  const originalUrl = (() => { try { const value = new URL(url); return ['http:', 'https:'].includes(value.protocol) && !value.username && !value.password ? value.href : ''; } catch { return ''; } })();
  const view = page ? (plain ? `<pre>${escape(page.text)}</pre>` : page.html) : '';
  return <><WebViewer/><button className="side-item" type="button" onClick={() => setOpen(true)}><span className="side-icon"><GlobeSimple size={15}/></span><span className="side-label">{t('웹 읽기')}</span></button>
    {createPortal(<dialog ref={dialog} className="sharing-dialog web-reader-dialog" aria-label={t('웹 읽기')} onCancel={event => { event.preventDefault(); close(); }}>
      <h2>{t('웹 읽기')}</h2><p>{t('주소를 입력하고 읽기를 누르면 로그인 없이 공개 본문을 가져옵니다.')}</p>
      <form onSubmit={event => { event.preventDefault(); void read(); }}><label>{t('웹페이지 주소')}<input type="url" required value={url} disabled={saving} onChange={event => setUrl(event.target.value)} placeholder="https://"/></label><button className="btn" type="submit" disabled={saving || busy}>{t('본문 읽기')}</button>{busy && <button className="btn" type="button" onClick={cancel}>{t('취소')}</button>}</form>
      {busy && <p><output>{t('불러오는 중…')}</output></p>}{error && <p role="alert">{error}</p>}
      {!page && originalUrl && <p><a href={originalUrl} target="_blank" rel="noopener noreferrer">{t('원문 페이지 열기')}</a></p>}
      {page && <section><h3>{page.title}</h3><p className="sharing-source">{page.url}</p><div className="dialog-actions"><button className="btn" onClick={() => setPlain(!plain)} aria-pressed={plain}>{t('텍스트로 보기')}</button><a href={page.url} target="_blank" rel="noopener noreferrer">{t('원문 페이지 열기')}</a></div>
        <iframe title={t('읽기 본문')} sandbox="" referrerPolicy="no-referrer" srcDoc={`<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; form-action 'none'; base-uri 'none'"><style>body{font:16px/1.7 system-ui,sans-serif;padding:16px;overflow-wrap:anywhere}pre{white-space:pre-wrap}table{max-width:100%}</style>${view}`}/>
        <button className="btn btn-primary" disabled={saving || saved} onClick={() => void save()}>{saved ? t('저장됨') : t('새 노트로 저장')}</button>
      </section>}
      <div className="dialog-actions"><button className="btn" disabled={saving} onClick={close}>{t('닫기')}</button></div>
    </dialog>, document.body)}</>;
}
