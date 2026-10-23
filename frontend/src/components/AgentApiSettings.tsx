import {useEffect, useState} from 'react';
import {useStore} from '../store';
import {t} from '../i18n';

type Scope = {notebooks: string[]; tags: string[]};
type Token = {id: string; name: string; created_at: number; scope: Scope};
type Status = {enabled: boolean; url: string; error: string; tokens: Token[]};

async function agentApi(body?: object): Promise<{data: unknown; status?: Status}> {
  const r = await fetch('/api/agent', body ? {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body)} : undefined);
  const v = await r.json();
  if (!r.ok || !v.ok) throw new Error(v.error || t('요청에 실패했습니다'));
  return v;
}

/** 설정 › 외부 AI 연결: 읽기 전용 Agent API를 켜고 에이전트별 토큰을 만들고 회수한다 (docs/agent-api.md). */
export function AgentApiSettings() {
  const {notebooks, tags} = useStore();
  const [status, setStatus] = useState<Status | null>(null), [error, setError] = useState('');
  const [name, setName] = useState(''), [limited, setLimited] = useState(false), [scope, setScope] = useState<Scope>({notebooks: [], tags: []});
  const [secret, setSecret] = useState(''), [copied, setCopied] = useState(false), [busy, setBusy] = useState(false);
  useEffect(() => { agentApi().then(v => setStatus(v.data as Status)).catch(e => setError(String(e.message || e))); }, []);
  const run = async (body: object) => {
    setBusy(true); setError('');
    try {
      const v = await agentApi(body);
      if (v.status) setStatus(v.status);
      return v.data;
    }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); return null; }
    finally { setBusy(false); }
  };
  const toggle = (key: keyof Scope, value: string) => setScope(s => ({...s, [key]: s[key].includes(value) ? s[key].filter(x => x !== value) : [...s[key], value]}));
  const create = async () => {
    const data = await run({action: 'create', name, scope: limited ? scope : {notebooks: [], tags: []}}) as {token: string} | null;
    if (data) { setSecret(data.token); setCopied(false); setName(''); setScope({notebooks: [], tags: []}); setLimited(false); }
  };
  const describe = (s: Scope) => !s.notebooks.length && !s.tags.length ? t('모든 노트') : t('폴더 {n}개 · 태그 {m}개', {n: s.notebooks.length, m: s.tags.length});
  if (!status) return <section className="agent-api-settings">{error && <p role="alert">{error}</p>}</section>;
  return (
    <section className="agent-api-settings">
      <div className="settings-card">
        <div className="settings-card__text">
          <strong>{t('외부 AI 연결 (Agent API)')}</strong>
          <p>{t('Claude, Codex 같은 외부 AI 도구가 이 컴퓨터에서 노트를 읽을 수 있게 합니다. 읽기만 가능하며 잠긴 노트·지운 노트·보관함의 노트는 보이지 않습니다.')}</p>
        </div>
        <label><input type="checkbox" className="toggle" checked={status.enabled} disabled={busy} onChange={e => void run({action: e.target.checked ? 'enable' : 'disable'})}/>{t('Agent API 켜기')}</label>
        {status.url && <p>{t('주소')}: <code>{status.url}</code></p>}
        {status.error && <p role="alert">{status.error}</p>}
      </div>
      <div className="settings-card">
        <div className="settings-card__text">
          <strong>{t('새 토큰')}</strong>
          <p>{t('에이전트마다 토큰을 따로 만들면 하나만 회수할 수 있습니다.')}</p>
        </div>
        <label>{t('토큰 이름')}<input value={name} maxLength={80} onChange={e => setName(e.target.value)} placeholder={t('예: Claude Desktop')}/></label>
        <fieldset className="plain-fieldset" aria-label={t('읽을 수 있는 노트')}>
          <label><input type="radio" name="agent-scope" checked={!limited} onChange={() => setLimited(false)}/>{t('모든 노트')}</label>
          <label><input type="radio" name="agent-scope" checked={limited} onChange={() => setLimited(true)}/>{t('고른 폴더와 태그만')}</label>
          {limited && <>
            {notebooks.map(nb => <label key={nb.id}><input type="checkbox" checked={scope.notebooks.includes(nb.id)} onChange={() => toggle('notebooks', nb.id)}/>{nb.name}</label>)}
            {tags.map(tag => <label key={tag.name}><input type="checkbox" checked={scope.tags.includes(tag.name)} onChange={() => toggle('tags', tag.name)}/>#{tag.name}</label>)}
          </>}
        </fieldset>
        <button className="btn" disabled={busy || !name.trim() || (limited && !scope.notebooks.length && !scope.tags.length)} onClick={() => void create()}>{t('토큰 만들기')}</button>
        {secret && <div className="agent-api-secret">
          <p><output>{t('이 토큰은 지금 한 번만 보여 줍니다. 복사해 에이전트 설정에 넣어 주세요.')}</output></p>
          <input readOnly value={secret} aria-label={t('새 토큰')} onFocus={e => e.target.select()}/>
          <button className="btn" onClick={() => void navigator.clipboard.writeText(secret).then(() => setCopied(true), () => setError(t('복사하지 못했습니다')))}>{copied ? t('복사됨') : t('복사')}</button>
        </div>}
      </div>
      <div className="settings-card">
        <div className="settings-card__text"><strong>{t('발급한 토큰')}</strong></div>
        {status.tokens.length === 0 ? <p>{t('아직 만든 토큰이 없습니다.')}</p> : <ul className="agent-api-tokens">
          {status.tokens.map(tk => <li key={tk.id}>
            <span><strong>{tk.name}</strong> <small>{new Date(tk.created_at).toLocaleDateString()} · {describe(tk.scope)}</small></span>
            <button className="btn" disabled={busy} onClick={() => void run({action: 'revoke', id: tk.id})} aria-label={t('{name} 토큰 회수', {name: tk.name})}>{t('회수')}</button>
          </li>)}
        </ul>}
        {error && <p role="alert">{error}</p>}
      </div>
    </section>
  );
}
