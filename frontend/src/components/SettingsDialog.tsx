import {useDialogVisibility} from '../lib/dialog-visibility';
import { createPortal } from "react-dom";
import {AiSettings} from "./AiSettings";
import {VaultSettings} from "./VaultSettings";
import {CommandSettings} from "./CommandSettings";
import React, { useEffect, useRef, useState } from "react";
import { useStore } from "../store";
import { SyncSettings } from "./SyncSettings";
import { CustomTheme } from "./CustomTheme";
import { LockNowButton } from "./AppSecurity";
import { MarkdownImport } from "./MarkdownImport";
import { RecoveryImport } from "./RecoveryImport";
import { UnsplashKeySettings } from "./NotebookCover";
import { useAppUpdate, updateText, versionLabel } from "./AppUpdate";
import {
  Settings as SettingsIcon,
  RefreshCw,
  Download,
  Upload,
  Sun,
  Moon,
  Palette,
  LockKeyhole,
  X,
  Info,
  CloudCheck,
  Image as ImageIcon,
  Keyboard,
  SlidersHorizontal,
} from "../icons";
import { ShortcutsDialog, SHORTCUTS_EVENT } from "./ShortcutsDialog";
import { LANGS, lang, setLang, t, type Lang } from "../i18n";
import { usePref } from "../lib/pref";
import { EditorZoom } from "./EditorZoom";
import { EditorSettings } from "./EditorSettings";
import { PortableLibrarySettings } from "./PortableLibrarySettings";
import { PluginSettings } from "./PluginSettings";
import { parseWrap } from "./EditorPane";
import "./SettingsDialog.css";

type Section = "ai" | "general" | "editor" | "plugins" | "sync" | "backup" | "import" | "look" | "photo" | "lock" | "about";
const SECTIONS: { id: Section; label: string; icon: React.ReactNode }[] = [
  {id:"ai",label:t("AI 연결"),icon:<SlidersHorizontal size={16} aria-hidden/>},
  { id: "general", label: t("일반"), icon: <SlidersHorizontal size={16} aria-hidden /> },
  { id: "editor", label: t("편집기 설정"), icon: <Keyboard size={16} aria-hidden /> },
  { id: "plugins", label: t("플러그인"), icon: <SlidersHorizontal size={16} aria-hidden /> },
  { id: "sync", label: t("동기화"), icon: <RefreshCw size={16} aria-hidden /> },
  { id: "backup", label: t("백업과 복원"), icon: <Download size={16} aria-hidden /> },
  { id: "import", label: t("가져오기"), icon: <Upload size={16} aria-hidden /> },
  { id: "look", label: t("모양"), icon: <Palette size={16} aria-hidden /> },
  { id: "photo", label: t("사진 검색"), icon: <ImageIcon size={16} aria-hidden /> },
  { id: "lock", label: t("앱 잠금"), icon: <LockKeyhole size={16} aria-hidden /> },
  { id: "about", label: t("정보"), icon: <Info size={16} aria-hidden /> },
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
  return (
    <>
      <Card title={t("언어")} desc={t("화면에 쓰는 언어입니다. 바꾸면 화면을 다시 불러옵니다.")}>
        <select
          className="settings-select"
          aria-label={t("언어")}
          value={lang}
          onChange={(e) => setLang(e.target.value as Lang)}
        >
          {LANGS.map((l) => (
            <option key={l.id} value={l.id}>
              {l.label}
            </option>
          ))}
        </select>
      </Card>
      <Card title={t("본문 글자 크기")} desc={t("노트 본문의 배율입니다. 편집 화면 아래의 −/+ 와 같습니다.")}>
        <EditorZoom />
      </Card>
      <Card title={t("원문 자동 줄바꿈")} desc={t("HTML·Markdown 원문 편집에서 긴 줄을 창 너비에 맞춰 접습니다.")}>
        <input
          type="checkbox"
          className="settings-switch"
          aria-label={t("원문 자동 줄바꿈")}
          checked={wrap}
          onChange={(e) => setWrap(e.target.checked)}
        />
      </Card>
    </>
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
  useEffect(()=>{const openSettings=()=>setOpen(true);window.addEventListener("inkism-open-settings",openSettings);return()=>window.removeEventListener("inkism-open-settings",openSettings);},[]);
  const leave=async(next?:Section)=>{const checks:Promise<boolean>[]=[];window.dispatchEvent(new CustomEvent("inkism-settings-leave",{detail:checks}));if((await Promise.all(checks)).every(Boolean)){if(next)setSection(next);else setOpen(false);}};
  const current = SECTIONS.find((x) => x.id === section)!;
  const update = useAppUpdate();
  const updateLine = updateText(update);
  return (
    <>
      <button
        type="button"
        className="side-item"
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
                {x.icon}
                <span>{x.label}</span>
              </button>
            ))}
          </nav>
          <section className="settings-body" aria-label={current.label}>
            <header className="settings-body__head">
              <h3>{current.label}</h3>
              <button
                type="button"
                className="settings-close"
                aria-label={t("설정 닫기")}
                onClick={() => void leave()}
              >
                <X size={16} aria-hidden />
              </button>
            </header>
            {section === "ai" && <AiSettings />}
            {section === "general" && <><GeneralSettings /><CommandSettings /></>}
            {section === "editor" && <EditorSettings />}
            {section === "plugins" && <PluginSettings />}
            {section === "sync" && (
              <Card
                title={t("기기 동기화")}
                desc={t(
                  "내 서버로 노트와 첨부를 이 기기에서 암호화한 뒤 보냅니다. 연결·키·지금 동기화는 여기서 설정합니다.",
                )}
              >
                <SyncSettings />
              </Card>
            )}
            {section === "backup" && (
              <>
                <PortableLibrarySettings beforeAction={() => s.flushNow()} onApplied={async () => { s.refreshList(); await s.refreshMeta(); window.dispatchEvent(new Event("inkism-sync-check")); window.dispatchEvent(new Event("inkism-knowledge-changed")); }} />
                <Card title={t("백업 내려받기")} desc={t("모든 노트와 첨부파일을 한 파일로 내려받습니다.")}>
                  <button
                    type="button"
                    className="btn"
                    onClick={() => void s.exportBackup()}
                    aria-label={t("노트·첨부파일 백업 다운로드")}
                  >
                    <Download size={14} aria-hidden /> {t("내려받기")}
                  </button>
                </Card>
                <Card title={t("백업 복원")} desc={t("내려받은 백업 파일(.zip, .json)에서 노트를 되살립니다.")}>
                  <button
                    type="button"
                    className="btn"
                    disabled={s.importing}
                    aria-label={t("백업 파일에서 복원")}
                    onClick={() => backupInput.current?.click()}
                  >
                    <Upload size={14} aria-hidden /> {s.importing ? t("가져오는 중…") : t("복원")}
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
                <Card title={t("Markdown 가져오기")} desc={t("Markdown 파일을 노트로 가져옵니다.")}>
                  <MarkdownImport />
                </Card>
                <Card
                  title={t("편집 보관 파일 가져오기")}
                  desc={t("저장하지 못한 편집을 보관해 둔 파일에서 되살립니다.")}
                >
                  <RecoveryImport />
                </Card>
              </>
            )}
            {section === "look" && (
              <>
                <Card
                  title={t("화면 밝기")}
                  desc={s.theme === "dark" ? t("지금은 어두운 화면입니다.") : t("지금은 밝은 화면입니다.")}
                >
                  <button
                    type="button"
                    className="btn"
                    onClick={s.toggleTheme}
                    aria-label={s.theme === "dark" ? t("라이트 모드로 전환") : t("다크 모드로 전환")}
                  >
                    {s.theme === "dark" ? <Sun size={14} aria-hidden /> : <Moon size={14} aria-hidden />}{" "}
                    {s.theme === "dark" ? t("밝게") : t("어둡게")}
                  </button>
                </Card>
                <Card title={t("사용자 테마")} desc={t("배경·글자·강조 색을 직접 고릅니다.")}>
                  <CustomTheme />
                </Card>
              </>
            )}
            {section === "photo" && (
              <div className="settings-card unsplash-card">
                <div className="settings-card__text">
                  <strong>{t("Unsplash 키")}</strong>
                  <p>
                    {t(
                      "노트북 표지 사진을 Unsplash에서 찾을 때 씁니다. 키는 이 기기의 앱 안에만 보관하고 화면에는 다시 보여 주지 않습니다. unsplash.com/developers에서 앱을 만들고 Access Key를 넣어 주세요.",
                    )}
                  </p>
                </div>
                <UnsplashKeySettings />
              </div>
            )}
            {section === "lock" && (
              <><VaultSettings /><Card
                title={t("Google 로그인 잠금")}
                desc={t("Google 로그인으로 이 앱을 잠급니다. 잠금 서버가 설정된 기기에서만 쓸 수 있습니다.")}
              >
                <LockNowButton />
              </Card></>
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
                <Card
                  title={t("단축키")}
                  desc={t("이 앱에서 쓸 수 있는 키보드 단축키를 봅니다. 어디서나 Ctrl+/ 로도 엽니다.")}
                >
                  <button
                    type="button"
                    className="btn"
                    onClick={() => window.dispatchEvent(new Event(SHORTCUTS_EVENT))}
                    aria-label={t("단축키 안내 열기")}
                  >
                    <Keyboard size={14} aria-hidden /> {t("단축키 보기")}
                  </button>
                </Card>
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
          </section>
        </div>
      </dialog>, document.body)}
      <ShortcutsDialog />
    </>
  );
}
