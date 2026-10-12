import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Editor } from '@tiptap/core';
import { CellSelection, selectedRect, isInTable } from '@tiptap/pm/tables';
import { closeHistory } from '@tiptap/pm/history';
import { type Node as PMNode } from '@tiptap/pm/model';
import { type SelectionBookmark } from '@tiptap/pm/state';
import { registerAuxiliaryFlush } from '../lib/workspace';
import { CSV_EDIT_EVENT, CSV_MAX_BYTES, csvRows, writeCsv, csvTableHTML, type CsvEditRequest } from '../lib/csv-tools';
import { api } from '../api';
import { t } from '../i18n';
import { useStore } from '../store';
import { useDialogVisibility } from '../lib/dialog-visibility';
import { attachmentURL } from '../extensions/attachment';
import './CsvTools.css';
type Snapshot = {
    noteId: string | null;
    doc: PMNode;
    bookmark: SelectionBookmark;
    request: CsvEditRequest;
};
type Change = {
    beforeDirty: boolean;
    row: number;
    col: number;
    before: string;
    after: string;
    length: number;
};
export function CsvTools({ editor }: {
    editor: Editor;
}) {
    const store = useStore(), dialog = useRef<HTMLDialogElement>(null), snapshot = useRef<Snapshot | null>(null), abort = useRef<AbortController | null>(null);
    const [mode, setMode] = useState<'paste' | 'file' | null>(null), [text, setText] = useState(''), [rows, setRows] = useState<string[][]>([]), [name, setName] = useState('table.csv'), [raw, setRaw] = useState(''), [page, setPage] = useState(0), [columnPage, setColumnPage] = useState(0), [undo, setUndo] = useState<Change[]>([]), [redo, setRedo] = useState<Change[]>([]), [dirty, setDirty] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState(''), [status, setStatus] = useState('');
    const current = useRef({ dirty, busy, mode });
    current.current = { dirty, busy, mode };
    useDialogVisibility(dialog, !!mode);
    const capture = (request: CsvEditRequest = {}) => { snapshot.current = { noteId: store.readDraft()?.id ?? null, doc: editor.state.doc, bookmark: editor.state.selection.getBookmark(), request }; };
    const valid = () => !!snapshot.current && !editor.isDestroyed && editor.isEditable && (store.readDraft()?.id ?? null) === snapshot.current.noteId && editor.state.doc.eq(snapshot.current.doc);
    const fail = (e: unknown) => setError(e instanceof Error ? e.message : String(e));
    useEffect(() => {
        const receive = async (event: Event) => {
            if (current.current.mode || editor.isDestroyed || !editor.isEditable)
                return;
            const request = (event as CustomEvent<CsvEditRequest>).detail;
            capture(request);
            setMode('file');
            setBusy(true);
            setError('');
            setRows([]);
            setUndo([]);
            setRedo([]);
            setDirty(false);
            setPage(0);
            setColumnPage(0);
            const controller = new AbortController();
            abort.current = controller;
            try {
                let file = request.file;
                if (!file) {
                    if (!request.url || !attachmentURL.test(request.url))
                        throw new Error(t('CSV 첨부 주소가 올바르지 않습니다.'));
                    const response = await fetch(request.url, { signal: controller.signal, redirect: 'error' });
                    if (!response.ok || Number(response.headers.get('content-length')) > CSV_MAX_BYTES)
                        throw new Error(t('CSV 파일을 읽지 못했습니다.'));
                    const reader = response.body?.getReader();
                    if (!reader)
                        throw new Error(t('CSV 파일을 읽지 못했습니다.'));
                    const chunks: Uint8Array[] = [];
                    let size = 0;
                    try {
                        for (;;) {
                            const { done, value } = await reader.read();
                            if (done)
                                break;
                            size += value.byteLength;
                            if (size > CSV_MAX_BYTES)
                                throw new Error('CSV exceeds 8 MiB');
                            chunks.push(value);
                        }
                    }
                    finally {
                        await reader.cancel();
                    }
                    file = new File(chunks as BlobPart[], request.name || 'table.csv', { type: 'text/csv' });
                }
                if (file.size > CSV_MAX_BYTES)
                    throw new Error('CSV exceeds 8 MiB');
                const source = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(await file.arrayBuffer());
                if (controller.signal.aborted)
                    return;
                setRows(csvRows(source));
                setRaw(source);
                setName(file.name || 'table.csv');
            }
            catch (e) {
                if (!controller.signal.aborted)
                    fail(e);
            }
            finally {
                if (!controller.signal.aborted)
                    setBusy(false);
            }
        };
        editor.view.dom.addEventListener(CSV_EDIT_EVENT, receive);
        return () => { editor.view.dom.removeEventListener(CSV_EDIT_EVENT, receive); abort.current?.abort(); };
    }, [editor]);
    useEffect(() => registerAuxiliaryFlush(async () => { if (current.current.dirty || current.current.busy)
        throw new Error(t('CSV 편집을 저장하거나 닫은 뒤 다시 시도해 주세요.')); }), []);
    useEffect(() => { const guard = (e: BeforeUnloadEvent) => { if (current.current.dirty) {
        e.preventDefault();
        e.returnValue = '';
    } }; window.addEventListener('beforeunload', guard); return () => window.removeEventListener('beforeunload', guard); }, []);
    const close = async () => { if (dirty && !await store.confirm({ title: t('변경 버리기'), message: t('저장하지 않은 CSV 변경을 버립니다.'), confirmLabel: t('닫기') }))
        return; abort.current?.abort(); setBusy(false); setMode(null); setDirty(false); };
    const select = (kind: 'row' | 'column' | 'table') => { try {
        const r = selectedRect(editor.state);
        let a = r.map.positionAt(kind === 'column' || kind === 'table' ? 0 : r.top, kind === 'row' || kind === 'table' ? 0 : r.left, r.table), b = r.map.positionAt(kind === 'row' ? r.bottom - 1 : r.map.height - 1, kind === 'column' ? r.right - 1 : r.map.width - 1, r.table);
        editor.view.dispatch(editor.state.tr.setSelection(new CellSelection(editor.state.doc.resolve(r.tableStart + a), editor.state.doc.resolve(r.tableStart + b))));
        editor.view.focus();
    }
    catch (e) {
        fail(e);
    } };
    const copy = async () => { try {
        const r = selectedRect(editor.state), result: string[][] = [], seen = new Set<number>();
        for (let row = r.top; row < r.bottom; row++) {
            const values: string[] = [];
            for (let col = r.left; col < r.right; col++) {
                const pos = r.map.map[row * r.map.width + col];
                values.push(seen.has(pos) ? '' : r.table.nodeAt(pos)?.textBetween(0, r.table.nodeAt(pos)!.content.size, '\n', '\n') ?? '');
                seen.add(pos);
            }
            result.push(values);
        }
        await navigator.clipboard.writeText(writeCsv(result));
        setStatus(t('선택 셀을 CSV로 복사했습니다.'));
        setError('');
    }
    catch (e) {
        fail(e);
    } };
    const paste = () => { try {
        if (!valid())
            throw new Error(t('문서가 변경되었습니다. 다시 열어 주세요.'));
        const data = csvRows(text), width = data.reduce((n, row) => Math.max(n, row.length), 0);
        const bookmark = snapshot.current!.bookmark.resolve(editor.state.doc);
        editor.view.dispatch(editor.state.tr.setSelection(bookmark));
        const r = selectedRect(editor.state);
        if (Math.max(r.map.height, r.top + data.length) > 500 || Math.max(r.map.width, r.left + width) > 30)
            throw new Error(t('큰 CSV는 CSV 파일 편집으로 열어 주세요. 표 붙여넣기는 500행·30열까지 지원합니다.'));
        editor.view.dispatch(closeHistory(editor.state.tr));
        editor.view.focus();
        if (!editor.view.pasteHTML(csvTableHTML(data)))
            throw new Error(t('CSV를 붙여넣지 못했습니다.'));
        editor.view.dispatch(closeHistory(editor.state.tr));
        setMode(null);
        setDirty(false);
    }
    catch (e) {
        fail(e);
    } };
    const cell = (row: number, col: number, value: string) => { const before = rows[row][col] ?? ''; if (value === before)
        return; const change = { beforeDirty: dirty, row, col, before, after: value, length: rows[row].length }; setRows(old => old.map((r, i) => i === row ? Array.from({ length: Math.max(r.length, col + 1) }, (_, c) => c === col ? value : r[c] ?? '') : r)); setUndo(old => [...old.slice(-99), change]); setRedo([]); setDirty(true); };
    const history = (back: boolean) => { const list = back ? undo : redo; if (!list.length)
        return; const change = list.at(-1)!; setPage(Math.floor(change.row / 50)); setColumnPage(Math.floor(change.col / 20)); setRows(old => old.map((r, i) => i === change.row ? Array.from({ length: back ? change.length : Math.max(change.length, change.col + 1) }, (_, c) => c === change.col ? (back ? change.before : change.after) : r[c] ?? '') : r)); if (back) {
        setUndo(list.slice(0, -1));
        setRedo(old => [...old, change]);
    }
    else {
        setRedo(list.slice(0, -1));
        setUndo(old => [...old, change]);
    } setDirty(back ? change.beforeDirty : true); };
    // Dialog-local Undo/Redo for paged CSV cells: Mod+Z, Mod+Shift+Z, and Ctrl+Y. IME composition and the page-number inputs keep native behavior.
    const historyKey = (e: React.KeyboardEvent<HTMLDialogElement>) => {
        if (mode !== 'file' || e.altKey || e.nativeEvent.isComposing || e.keyCode === 229 || !(e.ctrlKey || e.metaKey) || (e.target instanceof HTMLInputElement))
            return;
        const key = e.key.toLowerCase(), z = key === 'z' || (key.length !== 1 || !/[a-z]/.test(key)) && e.code === 'KeyZ', y = !e.shiftKey && e.ctrlKey && !e.metaKey && (key === 'y' || (key.length !== 1 || !/[a-z]/.test(key)) && e.code === 'KeyY');
        if (!z && !y)
            return;
        e.preventDefault();
        e.stopPropagation();
        if (!busy)
            history(z && !e.shiftKey);
    };
    const source = () => dirty ? (raw.startsWith('\ufeff') ? '\ufeff' : '') + writeCsv(rows, raw.includes('\r\n') ? '\r\n' : '\n') + (/(?:\r\n|\r|\n)$/.test(raw) ? (raw.includes('\r\n') ? '\r\n' : '\n') : '') : raw;
    const download = () => { const url = URL.createObjectURL(new Blob([source()], { type: 'text/csv;charset=utf-8' })), a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); };
    const save = async () => { if (!valid()) {
        setError(t('문서가 변경되었습니다. 다시 열어 주세요.'));
        return;
    } setBusy(true); setError(''); const controller = new AbortController(); abort.current = controller; try {
        const content = source();
        if (new Blob([content]).size > CSV_MAX_BYTES)
            throw new Error('CSV exceeds 8 MiB');
        const asset = await api.uploadAttachment(new File([content], name, { type: 'text/csv' }), controller.signal);
        if (!valid() || controller.signal.aborted)
            throw new Error(t('문서가 변경되었습니다. 다시 열어 주세요.'));
        const snap = snapshot.current!, attrs = { url: '/api/attachments/' + asset.id, name: asset.name, size: asset.size, mediaType: asset.media_type };
        let tr = closeHistory(editor.state.tr);
        if (snap.request.pos !== undefined) {
            const node = tr.doc.nodeAt(snap.request.pos);
            if (node?.type.name !== 'attachment' || node.attrs.url !== snap.request.url)
                throw new Error(t('문서가 변경되었습니다. 다시 열어 주세요.'));
            tr.setNodeMarkup(snap.request.pos, undefined, { ...node.attrs, ...attrs });
        }
        else {
            tr.setSelection(snap.bookmark.resolve(tr.doc));
            tr.replaceSelectionWith(editor.schema.nodes.attachment?editor.schema.nodes.attachment.create(attrs):editor.schema.text(asset.name,[editor.schema.marks.link.create({href:attrs.url})]),false);
        }
        editor.view.dispatch(tr);
        editor.view.dispatch(closeHistory(editor.state.tr));
        setDirty(false);
        setMode(null);
        editor.view.focus();
    }
    catch (e) {
        fail(e);
    }
    finally {
        setBusy(false);
    } };
    const openFile=()=>{const input=document.createElement('input');input.type='file';input.accept='.csv,text/csv';input.onchange=()=>{const file=input.files?.[0];if(file&&!editor.isDestroyed)editor.view.dom.dispatchEvent(new CustomEvent(CSV_EDIT_EVENT,{detail:{file}}));};input.click();};
    const selectedURL=String(editor.getAttributes('link').href??'');
    const openSelected=()=>{editor.chain().extendMarkRange('link').run();const label=editor.state.doc.textBetween(editor.state.selection.from,editor.state.selection.to)||'table.csv';editor.view.dom.dispatchEvent(new CustomEvent(CSV_EDIT_EVENT,{detail:{url:selectedURL,name:label}}));};
    const width = rows.reduce((n, row) => Math.max(n, row.length), 0), rowStart = page * 50, colStart = columnPage * 20;
    return <><div className="csv-file-tools"><button type="button" disabled={!editor.isEditable} onMouseDown={e=>e.preventDefault()} onClick={openFile}>{t('CSV 파일 열기')}</button>{attachmentURL.test(selectedURL)&&<button type="button" disabled={!editor.isEditable} onMouseDown={e=>e.preventDefault()} onClick={openSelected}>{t('선택한 CSV 첨부 편집')}</button>}</div>{isInTable(editor.state) && <div className="table-tools csv-tools" role="toolbar" aria-label={t('표 선택과 CSV')}><button onMouseDown={e => e.preventDefault()} onClick={() => select('row')}>{t('행 선택')}</button><button onMouseDown={e => e.preventDefault()} onClick={() => select('column')}>{t('열 선택')}</button><button onMouseDown={e => e.preventDefault()} onClick={() => select('table')}>{t('표 전체 선택')}</button><button onMouseDown={e => e.preventDefault()} onClick={() => void copy()}>{t('선택 셀 CSV 복사')}</button><button disabled={!editor.isEditable} onMouseDown={e => e.preventDefault()} onClick={() => { capture(); setText(''); setError(''); setMode('paste'); }}>{t('CSV 붙여넣기')}</button></div>}{!mode && error && <p role="alert">{error}</p>}{!mode && status && <p role="status">{status}</p>}{createPortal(<dialog ref={dialog} className="csv-dialog" onKeyDown={historyKey} aria-label={mode === 'file' ? t('CSV 파일 편집') : t('CSV 붙여넣기')} onCancel={e => { e.preventDefault(); void close(); }}><header><strong>{mode === 'file' ? t('CSV 파일 편집') : t('CSV 붙여넣기')}</strong><button onClick={() => void close()}>{t('닫기')}</button></header>{error && <p role="alert">{error}</p>}{busy && <p role="status">{t('불러오는 중…')}</p>}{mode === 'paste' ? <><textarea aria-label={t('CSV 내용')} value={text} onChange={e => setText(e.target.value)}/><button onClick={paste}>{t('선택 위치에 붙여넣기')}</button></> : !!rows.length && <><p>{name} · {rows.length} × {width}</p><p>{t('한 번에 50행·20열을 표시합니다. 전체 데이터는 CSV 첨부로 저장하며 원본 첨부는 유지됩니다.')}</p><div className="csv-actions"><button disabled={busy || !undo.length} onClick={() => history(true)}>{t('실행 취소')}</button><button disabled={busy || !redo.length} onClick={() => history(false)}>{t('다시 실행')}</button><button disabled={busy} onClick={download}>{t('전체 CSV 다운로드')}</button><button disabled={busy || !editor.isEditable} onClick={() => void save()}>{t('CSV 첨부로 저장')}</button><label>{t('CSV 행 페이지')}<input type="number" min={1} max={Math.ceil(rows.length / 50)} value={page + 1} onChange={e => setPage(Math.max(0, Math.min(Math.ceil(rows.length / 50) - 1, (Number(e.target.value) || 1) - 1)))}/></label><label>{t('CSV 열 페이지')}<input type="number" min={1} max={Math.ceil(width / 20)} value={columnPage + 1} onChange={e => setColumnPage(Math.max(0, Math.min(Math.ceil(width / 20) - 1, (Number(e.target.value) || 1) - 1)))}/></label></div><div className="csv-grid"><table><thead><tr><th>#</th>{Array.from({ length: Math.min(20, width - colStart) }, (_, c) => <th key={c}>{colStart + c + 1}</th>)}</tr></thead><tbody>{rows.slice(rowStart, rowStart + 50).map((row, i) => <tr key={rowStart + i}><th>{rowStart + i + 1}</th>{Array.from({ length: Math.min(20, width - colStart) }, (_, c) => <td key={c}><textarea disabled={busy} aria-label={t('CSV {row}행 {column}열', { row: rowStart + i + 1, column: colStart + c + 1 })} value={row[colStart + c] ?? ''} onChange={e => cell(rowStart + i, colStart + c, e.target.value)}/></td>)}</tr>)}</tbody></table></div></>}</dialog>, document.body)}</>;
}
