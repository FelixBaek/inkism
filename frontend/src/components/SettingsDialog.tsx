import {useDialogVisibility} from '../lib/dialog-visibility';
import { createPortal } from "react-dom";
import {AiSettings} from "./AiSettings";
import {AgentApiSettings} from "./AgentApiSettings";
import {VaultSettings} from "./VaultSettings";
import {CommandSettings} from "./CommandSettings";
import React, { useEffect, useRef, useState } from "react";
import { useStore } from "../store";
import { SyncSettings } from "./SyncSettings";
import { CustomTheme, CustomThemeApplier } from "./CustomTheme";
import { LockSettings } from "./AppSecurity";
import { MarkdownImport } from "./MarkdownImport";
import { RecoveryImport } from "./RecoveryImport";
import { PhotoSettings } from "./PhotoSettings";
import { useAppUpdate, updateText, versionLabel } from "./AppUpdate";
import {
  Settings as SettingsIcon,
  RefreshCw,
  Download,
  Upload,
  X,
  CloudCheck,
  Keyboard,
  FileText,
  Palette,
  Image,
  LockKeyhole,
  Info,
  Sparkle,
  type LucideIcon,
} from "../icons";
import { ShortcutsDialog, SHORTCUTS_EVENT, SHORTCUT_GROUPS } from "./ShortcutsDialog";
import { LANGS, lang, setLang, t, type Lang } from "../i18n";
import { usePref } from "../lib/pref";
import { EditorZoom } from "./EditorZoom";
import { EditorSettings } from "./EditorSettings";
import { PortableLibrarySettings } from "./PortableLibrarySettings";
import { PluginSettings } from "./PluginSettings";
import { parseWrap } from "./EditorPane";
import "./SettingsDialog.css";

type Section = "ai" | "agent" | "general" | "editor" | "plugins" | "sync" | "backup" | "import" | "look" | "photo" | "lock" | "about";
const SECTIONS: { id: Section; label: string; icon: LucideIcon }[] = [
  { id: "ai", label: t("AI 연결"), icon: Sparkle },
  { id: "general", label: t("일반"), icon: SettingsIcon },
  { id: "editor", label: t("편집기"), icon: FileText },
  { id: "plugins", label: t("플러그인"), icon: SettingsIcon },
  { id: "sync", label: t("동기화"), icon: RefreshCw },
  { id: "backup", label: t("백업과 복원"), icon: Download },
  { id: "import", label: t("가져오기"), icon: Upload },
  { id: "look", label: t("모양"), icon: Palette },
  { id: "photo", label: t("사진 검색"), icon: Image },
  { id: "agent", label: t("외부 AI 연결"), icon: Sparkle },
  { id: "lock", label: t("앱 잠금"), icon: LockKeyhole },
  { id: "about", label: t("정보"), icon: Info },
];

/** 한 줄 설정 카드: 왼쪽 제목·설명, 오른쪽 동작(기존 도구의 버튼을 그대로 둔다). */
function Card({
  title,
  desc,
  children,
}: Readonly<{ title: string; desc?: React.ReactNode; children: React.ReactNode }>) {
  return (
    <div className="settings-card">
      <div className="settings-card__text">
        <strong>{title}</strong>
        {desc && <p>{desc}</p>}
      </div>
      <div className="settings-card__action">{children}</div>
    </div>
  );
}

/** 일반: 언어와 편집 기본값. 편집 화면의 같은 도구와 값을 함께 쓴다. */
function GeneralSettings() {
  const [wrap, setWrap] = usePref("inkism.source.wrap", parseWrap);
  return <>
    <Card title={t("언어")} desc={t("화면에 쓰는 언어입니다. 바꾸면 화면을 다시 불러옵니다.")}>
      <select className="settings-select" aria-label={t("언어")} value={lang} onChange={(e) => setLang(e.target.value as Lang)}>
        {LANGS.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
      </select>
    </Card>
    <Card title={t("본문 글자 크기")} desc={t("노트 본문의 배율입니다. 편집 화면 아래의 −/+ 와 같습니다.")}>
      <EditorZoom />
    </Card>
    <Card title={t("원문 자동 줄바꿈")} desc={t("HTML·Markdown 원문 편집에서 긴 줄을 창 너비에 맞춰 접습니다.")}>
      <input type="checkbox" role="switch" className="toggle" aria-label={t("원문 자동 줄바꿈")} checked={wrap} onChange={(e) => setWrap(e.target.checked)} />
    </Card>
  </>;
}

function ThemeSettings() {
  const s = useStore();
  return <Card title={t("화면 밝기")}>
    <fieldset className="settings-segmented semantic-group" aria-label={t("화면 밝기")}>
      <button type="button" aria-pressed={s.theme === "dark"} aria-label={t("다크 모드로 전환")} onClick={() => s.theme !== "dark" && s.toggleTheme()}>{t("다크 모드")}</button>
      <button type="button" aria-pressed={s.theme !== "dark"} aria-label={t("라이트 모드로 전환")} onClick={() => s.theme === "dark" && s.toggleTheme()}>{t("라이트 모드")}</button>
    </fieldset>
  </Card>;
}

/** 일반 › 기본값: 엔진에 저장된 새 노트 기본 폴더·태그(사이드바 "기본으로 설정"과 같은 값). */
function DefaultSettings() {
  const s = useStore();
  const notebook = s.notebooks.find((nb) => nb.id === s.defaults.notebook_id);
  return (
    <div className="settings-card">
      <div className="settings-card__text">
        <strong>{t("기본값")}</strong>
        <label className="settings-field">
          {t("기본 폴더")}
          <select
            className="settings-select"
            aria-label={t("기본 폴더")}
            value={notebook?.id ?? ""}
            onChange={(e) => {
              const next = s.notebooks.find((nb) => nb.id === e.target.value);
              if (next) s.toggleDefaultNotebook(next);
              else if (notebook) s.toggleDefaultNotebook(notebook);
            }}
          >
            <option value="">{t("없음")}</option>
            {s.notebooks.map((nb) => (
              <option key={nb.id} value={nb.id}>
                {nb.name}
              </option>
            ))}
          </select>
        </label>
        <label className="settings-field">
          {t("기본 태그")}
          <select
            className="settings-select"
            aria-label={t("기본 태그")}
            value={s.defaults.tag ?? ""}
            onChange={(e) => s.toggleDefaultTag(e.target.value || (s.defaults.tag ?? ""))}
          >
            <option value="">{t("없음")}</option>
            {s.defaults.tag && !s.tags.some((x) => x.name === s.defaults.tag) && (
              <option value={s.defaults.tag}>{s.defaults.tag}</option>
            )}
            {s.tags.map((x) => (
              <option key={x.name} value={x.name}>
                {x.name}
              </option>
            ))}
          </select>
        </label>
        <p>{t("새 노트를 만들 때 선택한 기본값을 사용합니다.")}</p>
      </div>
      <div className="settings-card__action">
        <button
          type="button"
          className="btn"
          onClick={() => window.dispatchEvent(new Event(SHORTCUTS_EVENT))}
          aria-label={t("단축키 안내 열기")}
        >
          {t("단축키 보기")}
        </button>
      </div>
    </div>
  );
}

/**
 * 설정 창 (Figma Settings 12:764). 예전 사이드바 아래 도구(동기화·테마·백업·가져오기·잠금)를 한곳에 모은다.
 * 각 도구는 기존 컴포넌트를 그대로 써서 자기 대화상자를 연다(동작·접근 이름 유지).
 */
export function SettingsDialog() {
  const s = useStore();
  const dialog = useRef<HTMLDialogElement>(null);
  const backupInput = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [section, setSection] = useState<Section>("general");
  useDialogVisibility(dialog,open);
  const openRef=useRef(open);openRef.current=open;
  useEffect(()=>{const openSettings=(e:Event)=>{const next=(e as CustomEvent<Section|undefined>).detail;if(next&&SECTIONS.some(x=>x.id===next)){if(openRef.current)void leaveRef.current(next);else setSection(next);}setOpen(true);};window.addEventListener("inkism-open-settings",openSettings);return()=>window.removeEventListener("inkism-open-settings",openSettings);},[]);
  const leave=async(next?:Section)=>{const checks:Promise<boolean>[]=[];window.dispatchEvent(new CustomEvent("inkism-settings-leave",{detail:checks}));if((await Promise.all(checks)).every(Boolean)){if(next)setSection(next);else setOpen(false);}};
  const leaveRef=useRef(leave);leaveRef.current=leave;
  useEffect(()=>{const close=()=>void leaveRef.current();window.addEventListener("inkism-close-settings",close);return()=>window.removeEventListener("inkism-close-settings",close);},[]);
  const current = SECTIONS.find((x) => x.id === section)!;
  const update = useAppUpdate();
  const updateLine = updateText(update);
  return (
    <>
      <button
        type="button"
        className={"side-item" + (open ? " is-active" : "")}
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-label={update.available ? t("설정 열기 (새 버전 있음)") : t("설정 열기")}
      >
        <span className="side-icon" aria-hidden>
          <SettingsIcon size={15} />
        </span>
        <span className="side-label">{t("설정")}</span>
        {update.available && <span className="update-dot" aria-hidden />}
      </button>
      {createPortal(<dialog
        ref={dialog}
        className="settings-dialog"
        aria-labelledby="settings-title"
        onCancel={(e) => {
          // 안쪽 도구 창의 Esc는 그 창만 닫는다
          if (e.target !== dialog.current) return;
          e.preventDefault();
          void leave();
        }}
        onClick={(e) => {
          if (e.target === dialog.current) void leave();
        }}
      >
        <div className="settings-shell">
          <nav className="settings-nav" aria-label={t("설정 항목")}>
            <h2 id="settings-title">{t("설정")}</h2>
            {SECTIONS.map((x) => (
              <button
                key={x.id}
                type="button"
                className={"settings-nav__item" + (x.id === section ? " is-active" : "")}
                aria-current={x.id === section ? "page" : undefined}
                onClick={() => {if(x.id!==section)void leave(x.id);}}
              >
                <x.icon size={15} aria-hidden />
                {x.label}
              </button>
            ))}
          </nav>
          <section className="settings-body" aria-label={current.label}>
            <header className="settings-top">
              <h3>{current.label}</h3>
              <button type="button" className="settings-close" aria-label={t("설정 닫기")} onClick={() => void leave()}><X size={16} aria-hidden /></button>
            </header>
            {/* 닫으면 내용을 내린다: 동기화 상태 확인 같은 주기 작업이 화면 밖에서 돌지 않게 */}
            {open && <div className="settings-content">
            {section === "ai" && <AiSettings />}
            {section === "agent" && <AgentApiSettings />}
            {section === "general" && <><GeneralSettings /><CommandSettings /><DefaultSettings /></>}
            {section === "editor" && <EditorSettings />}
            {section === "plugins" && <PluginSettings />}
            {section === "sync" && <><SyncSettings /><SyncSettings part="storage" /></>}
            {section === "backup" && (
              <>
                <PortableLibrarySettings beforeAction={() => s.flushNow()} onApplied={async () => { s.refreshList(); await s.refreshMeta(); window.dispatchEvent(new Event("inkism-sync-check")); window.dispatchEvent(new Event("inkism-knowledge-changed")); }} />
                <Card title={t("백업 파일")} desc={t("모든 노트와 첨부파일을 한 파일로 내려받고, 내려받은 백업 파일(.zip, .json)에서 노트를 되살립니다.")}>
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => void s.exportBackup()}
                    aria-label={t("노트·첨부파일 백업 다운로드")}
                  >
                    <Download size={14} aria-hidden /> {t("노트·첨부파일 백업 다운로드")}
                  </button>
                  <button
                    type="button"
                    className="btn"
                    disabled={s.importing}
                    aria-label={t("백업 파일에서 복원")}
                    onClick={() => backupInput.current?.click()}
                  >
                    <Upload size={14} aria-hidden /> {s.importing ? t("가져오는 중…") : t("백업 파일에서 복원")}
                  </button>
                  <input
                    ref={backupInput}
                    type="file"
                    accept=".json,.zip,application/json,application/zip"
                    hidden
                    aria-hidden="true"
                    tabIndex={-1}
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) void s.importBackup(f);
                      e.target.value = "";
                    }}
                  />
                </Card>
              </>
            )}
            {section === "import" && (
              <>
                <Card title={t("기록 가져오기")} desc={t("Markdown 파일이나 저장하지 못한 편집을 보관해 둔 파일에서 노트를 가져옵니다.")}>
                  <MarkdownImport />
                  <RecoveryImport />
                </Card>

              </>
            )}
            {section === "look" && <><ThemeSettings /><CustomTheme /></>}
            {section === "photo" && <PhotoSettings />}
            {section === "lock" && (
              <><LockSettings /><VaultSettings /></>
            )}
            {section === "about" && (
              <>
                <Card
                  title="inkism"
                  desc={versionLabel(
                    update.status,
                    s.info ? `${s.info.name} ${s.info.version}` : t("엔진에 연결하는 중…"),
                  )}
                >
                  {s.connError ? (
                    <button type="button" className="btn" onClick={s.retryConnection}>
                      <RefreshCw size={14} aria-hidden /> {t("다시 연결")}
                    </button>
                  ) : (
                    <span className="settings-ok">
                      <CloudCheck size={14} aria-hidden /> {t("연결됨")}
                    </span>
                  )}
                </Card>
                <div className="settings-card">
                  <div className="settings-card__text">
                    <strong>{t("단축키")}</strong>
                    <dl className="settings-kv">
                      {SHORTCUT_GROUPS[0].rows.map(([keys, label]) => (
                        <React.Fragment key={keys}>
                          <dt>{label}</dt>
                          <dd>{keys}</dd>
                        </React.Fragment>
                      ))}
                    </dl>
                    <p>{t("이 앱에서 쓸 수 있는 키보드 단축키를 봅니다. 어디서나 Ctrl+/ 로도 엽니다.")}</p>
                  </div>
                  <div className="settings-card__action">
                  <button
                    type="button"
                    className="btn"
                    onClick={() => window.dispatchEvent(new Event(SHORTCUTS_EVENT))}
                    aria-label={t("단축키 안내 열기")}
                  >
                    <Keyboard size={14} aria-hidden /> {t("단축키 보기")}
                  </button>
                  </div>
                </div>
                <Card
                  title={t("업데이트")}
                  desc={
                    <output className={updateLine.tone ? `update-text--${updateLine.tone}` : undefined}>
                      {updateLine.text}
                    </output>
                  }
                >
                  {update.available && update.busy !== "check" ? (
                    <button
                      type="button"
                      className="btn btn-primary"
                      disabled={!!update.busy}
                      onClick={() => void update.apply()}
                      aria-label={t("새 버전 {version}으로 업데이트", {
                        version: update.status?.latest?.version ?? "",
                      })}
                    >
                      <Download size={14} aria-hidden /> {t("업데이트")}
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="btn"
                      disabled={!!update.busy}
                      onClick={() => void update.check()}
                      aria-label={t("업데이트 확인")}
                    >
                      <RefreshCw size={14} aria-hidden /> {t("업데이트 확인")}
                    </button>
                  )}
                </Card>
              </>
            )}
            </div>}
          </section>
        </div>
      </dialog>, document.body)}
      <ShortcutsDialog />
      <CustomThemeApplier />
    </>
  );
}
