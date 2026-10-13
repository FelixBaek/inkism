import {CsvTools} from "./CsvTools";
import React, { lazy, Suspense, useEffect, useLayoutEffect, useReducer, useRef, useState, type ReactNode } from "react";
import type { ChainedCommands, Editor } from "@tiptap/core";
import { closeHistory } from "@tiptap/pm/history";
import {
  AlignCenter,
  AlignJustify,
  AlignLeft,
  AlignRight,
  Bold,
  ChevronDown,
  ClearFormatting,
  DirectionLtr,
  DirectionRtl,
  Eye,
  Highlighter,
  Image as ImageIcon,
  InlineCode,
  Italic,
  Link2,
  List,
  ListOrdered,
  Minus,
  MoreVertical,
  NoteLink,
  Pin,
  Plus,
  Smile,
  SquareSigma,
  Strikethrough,
  SubscriptIcon,
  SuperscriptIcon,
  TaskList,
  TextColor,
  Underline as UnderlineIcon,
} from "../icons";
import { useStore } from "../store";
import { requestMath } from "../extensions/math";
import { registerAiNotice, requestAi, type AiAction, type AiResult } from "../lib/ai";
import { AttachmentButton } from "./AttachmentButton";
import { MathTools } from "./MathTools";
import { IconButton } from "./IconButton";
import { Popover } from "./toolbar/Popover";
import { BlockInsertPanel } from "./toolbar/BlockInsertPanel";
import { BLOCK_ITEMS } from "../extensions/block-items";
import { PREVIEW_EVENT } from "./PreviewExport";
import {
  AiMenu,
  AiResultView,
  BULLET_STYLES,
  ColorPalette,
  ListStyles,
  NotePicker,
  ORDERED_STYLES,
  toolbarStore,
  type ColorKind,
} from "./toolbar/Panels";
import "./toolbar/toolbar.css";
import { t } from "../i18n";
import { usePref } from "../lib/pref";
import { FONTS_KEY, parseEditorFonts } from "../lib/editor-settings";
import { activePluginFonts, subscribePlugins } from "../lib/plugins";

const EmojiPicker = lazy(() => import("./toolbar/EmojiPicker"));

export interface HistoryControls {
  canUndo: boolean;
  canRedo: boolean;
  undo: () => void;
  redo: () => void;
}

interface Props {
  readOnly?: boolean;
  /** 실행 취소·다시 실행은 단축키(Ctrl+Z/Y)로만 쓴다. 호출부 호환을 위해 받기만 한다. */
  history?: HistoryControls;
  editor: Editor | null;
}

const FONT_SIZES = [12, 13, 14, 16, 18, 20, 24, 28, 32];
const SERIF = "Inkism Flags, Noto Serif KR, Nanum Myeongjo, Batang, serif";
const MONO = "Inkism Flags, D2Coding, JetBrains Mono, Consolas, monospace";
const FONTS: [string, string | null][] = [
  [t("고딕"), null],
  [t("명조"), SERIF],
  [t("고정폭"), MONO],
];
const PARAGRAPHS: [string, string][] = [
  ["paragraph", t("본문")],
  ["1", t("제목 1")],
  ["2", t("제목 2")],
  ["3", t("제목 3")],
];
const ALIGNS = [
  ["left", t("왼쪽"), AlignLeft],
  ["center", t("가운데"), AlignCenter],
  ["right", t("오른쪽"), AlignRight],
  ["justify", t("양쪽"), AlignJustify],
] as const;
const PIN_KEY = "inkism.toolbar.pinExtra";
const DIR_TYPES = ["paragraph", "heading"];

type PopName = "more" | "para" | "font" | "ol" | "ul" | "emoji" | "note" | "insert" | "ai" | "aiResult" | ColorKind;
interface Pop {
  name: PopName;
  anchor: HTMLElement;
  under: HTMLElement;
}

const Divider = () => <span className="tb-divider" aria-hidden />;
const Group = ({ children, label }: { children: ReactNode; label?: string }) => (
  <fieldset className="tb-group plain-fieldset" aria-label={label}>
    {children}
  </fieldset>
);

function fontNameOf(fontFamily: string) {
  if (fontFamily.includes("Myeongjo")) return t("명조");
  if (fontFamily.includes("monospace")) return t("고정폭");
  return t("고딕");
}

/** 리치 텍스트 편집기 서식 도구 모음 (Figma EditorToolbar 33:5340). 모든 버튼에 접근 이름을 제공한다. */
export function EditorToolbar({ editor, readOnly = false }: Readonly<Props>) {
  const s = useStore();
  const [registeredFonts] = usePref(FONTS_KEY, parseEditorFonts);
  const [, refreshPlugins] = useState(0);
  useEffect(() => subscribePlugins(() => refreshPlugins((x) => x + 1)), []);
  const pluginFonts = activePluginFonts();
  const fonts: [string, string | null][] = [...new Map([...FONTS, ...pluginFonts.map(f => [f.label, f.family] as [string, string]), ...registeredFonts.map(f => [f.label, f.family] as [string, string])].map(([label, family]) => [family?.toLowerCase() ?? "default", [label, family] as [string, string | null]])).values()];
  // AI 블록처럼 툴바 밖에서 부르는 AI 요청도 같은 앱 안내창을 쓴다.
  useEffect(() => {
    registerAiNotice(s.showError);
    return () => registerAiNotice(null);
  }, [s.showError]);
  const [, force] = useReducer((x: number) => x + 1, 0);
  const [stack, setStack] = useState<Pop[]>([]);
  const [pinExtra, setPinExtra] = useState(() => toolbarStore.get<boolean>(PIN_KEY, false));
  const [palettePinned, setPalettePinned] = useState(false);
  const [layout, setLayout] = useState(0);
  const [lastColor, setLastColor] = useState(() => ({
    highlight: toolbarStore.get("inkism.colors.last.highlight", "#fff176"),
    color: toolbarStore.get("inkism.colors.last.color", "#f44336"),
  }));
  const [ai, setAi] = useState<{ result: AiResult; from: number; to: number } | null>(null);
  const row = useRef<HTMLDivElement>(null);
  const aiGroup = useRef<HTMLDivElement>(null);
  const pinnedRow = useRef<HTMLDivElement>(null);
  const aiButton = useRef<HTMLButtonElement>(null);
  const needs = useRef<number[]>([]);

  useEffect(() => {
    if (!editor) return;
    const refresh = () => force();
    editor.on("transaction", refresh);
    editor.on("create", refresh);
    // onCreate may restore history with view.updateState before this effect
    // subscribes. Read the current state once instead of retaining first-render flags.
    refresh();
    return () => {
      editor.off("transaction", refresh);
      editor.off("create", refresh);
    };
  }, [editor]);

  const paraValue = editor?.isActive("heading") ? String(editor.getAttributes("heading").level) : "paragraph";
  const fontFamily = String(editor?.getAttributes("textStyle").fontFamily ?? "");
  const fontName = [...registeredFonts, ...pluginFonts].find(font=>font.family.toLowerCase()===fontFamily.replace(/^["']|["']$/g,"").toLowerCase())?.label ?? fontNameOf(fontFamily);
  // 배치 단계: 0 = 넓게 + 고정한 더보기를 같은 줄에, 1 = 넓게(고정한 더보기는 아랫줄), 2 = 좁게.
  // 들어가지 않으면 한 단계 내리고, 각 단계의 실제 폭을 기억해 창이 넓어지면 되돌린다.
  const step = Math.max(layout, pinExtra ? 0 : 1);
  const compact = step === 2;
  useLayoutEffect(() => {
    const el = row.current;
    if (!el) return;
    const check = () => {
      const last = aiGroup.current;
      if (!last) return;
      const width = el.clientWidth;
      needs.current[step] = last.offsetLeft + last.offsetWidth + 12;
      if (needs.current[step] > width && step < 2) setLayout(step + 1);
      else if (step > (pinExtra ? 0 : 1) && width >= (needs.current[step - 1] ?? Infinity)) setLayout(step - 1);
    };
    check();
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => ro.disconnect();
  }, [editor, step, pinExtra, paraValue, fontName]);

  // 블록 메뉴·"/" 메뉴의 "이모지" 항목이 보내는 요청: 툴바의 이모지 창을 연다(좁은 툴바면 줄 끝에 붙여 연다).
  useEffect(() => {
    const open = (event: Event) => {
      const target = (event as CustomEvent<{ editor?: Editor }>).detail?.editor;
      if (target && target !== editor) return;
      const bar = row.current;
      if (!bar) return;
      const button = bar.querySelector<HTMLElement>(`[aria-label="${t("이모지")}"]`) ?? bar;
      setStack([{ name: "emoji", anchor: button, under: pinnedRow.current ?? bar }]);
    };
    window.addEventListener("inkism-open-emoji-picker", open);
    return () => window.removeEventListener("inkism-open-emoji-picker", open);
  }, [editor]);
  if (!editor) return null;
  const disabled = readOnly || !editor.isEditable;
  const isOpen = (name: PopName) => stack.some((p) => p.name === name);
  const closeAt = (level: number) => setStack((st) => st.slice(0, level));
  const toggle = (name: PopName, level: number) => (event: React.MouseEvent<HTMLElement>) => {
    const anchor = event.currentTarget;
    const under = level ? anchor.closest<HTMLElement>("[data-tb-popover]")! : (pinnedRow.current ?? row.current!);
    setStack((st) =>
      st[level]?.name === name ? st.slice(0, level) : [...st.slice(0, level), { name, anchor, under }],
    );
  };
  const cmd = (fn: (chain: ChainedCommands) => ChainedCommands) => () => {
    if (disabled) return;
    fn(editor.chain().focus()).run();
    force();
  };
  const markButton = (
    label: string,
    icon: ReactNode,
    name: string,
    fn: (chain: ChainedCommands) => ChainedCommands,
  ) => (
    <IconButton label={label} active={editor.isActive(name)} disabled={disabled} onClick={cmd(fn)}>
      {icon}
    </IconButton>
  );
  const popButton = (name: PopName, level: number, label: string, icon: ReactNode) => (
    <IconButton
      label={label}
      active={isOpen(name)}
      aria-haspopup="dialog"
      aria-expanded={isOpen(name)}
      disabled={disabled}
      onClick={toggle(name, level)}
    >
      {icon}
    </IconButton>
  );
  const split = (
    name: PopName,
    level: number,
    label: string,
    menuLabel: string,
    icon: ReactNode,
    active: boolean,
    main: () => void,
  ) => (
    <span className={`tb-split${isOpen(name) ? " is-open" : ""}`}>
      <button
        type="button"
        className={`tb-split-main${active ? " is-active" : ""}`}
        aria-label={label}
        title={label}
        aria-pressed={active}
        disabled={disabled}
        onClick={main}
      >
        {icon}
      </button>
      <button
        type="button"
        className="tb-split-toggle"
        aria-label={menuLabel}
        title={menuLabel}
        aria-haspopup="dialog"
        aria-expanded={isOpen(name)}
        disabled={disabled}
        onClick={toggle(name, level)}
      >
        <ChevronDown size={12} aria-hidden />
      </button>
    </span>
  );
  const select = (name: PopName, level: number, label: string, value: string) => (
    <button
      type="button"
      className={`tb-select${isOpen(name) ? " is-open" : ""}`}
      aria-label={`${label}: ${value}`}
      title={label}
      aria-haspopup="listbox"
      aria-expanded={isOpen(name)}
      disabled={disabled}
      onClick={toggle(name, level)}
    >
      <span>{value}</span>
      <ChevronDown size={12} aria-hidden />
    </button>
  );

  /* ---------- 동작 ---------- */
  const colorOf = (kind: ColorKind) =>
    ((kind === "highlight" ? editor.getAttributes("highlight").color : editor.getAttributes("textStyle").color) as
      string | null) ?? null;
  const applyColor = (kind: ColorKind, color: string | null) => {
    if (disabled) return;
    const chain = editor.chain().focus();
    if (kind === "highlight") (color ? chain.setHighlight({ color }) : chain.unsetHighlight()).run();
    else (color ? chain.setColor(color) : chain.unsetColor()).run();
    if (color) {
      setLastColor((c) => ({ ...c, [kind]: color }));
      toolbarStore.set(`inkism.colors.last.${kind}`, color);
    }
    if (!palettePinned) setStack([]);
  };
  const setListStyle = (type: "orderedList" | "bulletList", style: string) => {
    if (disabled) return;
    const chain = editor.chain().focus();
    if (!editor.isActive(type)) type === "orderedList" ? chain.toggleOrderedList() : chain.toggleBulletList();
    chain.updateAttributes(type, { listStyleType: style === "decimal" || style === "disc" ? null : style }).run();
    closeAt(0);
  };
  const sizeNow = (() => {
    const attr = Number.parseFloat(String(editor.getAttributes("textStyle").fontSize ?? ""));
    if (attr) return attr;
    try {
      const { node } = editor.view.domAtPos(editor.state.selection.from);
      const el = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
      return Math.round(Number.parseFloat(getComputedStyle(el!).fontSize)) || 16;
    } catch {
      return 16;
    }
  })();
  const stepSize = (up: boolean) => {
    const next = up
      ? (FONT_SIZES.find((n) => n > sizeNow) ?? FONT_SIZES.at(-1)!)
      : ([...FONT_SIZES].reverse().find((n) => n < sizeNow) ?? FONT_SIZES[0]);
    cmd((c) => c.setFontSize(`${next}px`))();
  };
  const align = ALIGNS.find(([value]) => value !== "left" && editor.isActive({ textAlign: value })) ?? ALIGNS[0];
  const nextAlign = ALIGNS[(ALIGNS.indexOf(align) + 1) % ALIGNS.length];
  const rtl = editor.isActive({ dir: "rtl" });
  const setDir = (dir: string | null) => (chain: ChainedCommands) =>
    DIR_TYPES.reduce((c, type) => c.updateAttributes(type, { dir }), chain);
  const togglePin = () => {
    setPinExtra((pin) => {
      toolbarStore.set(PIN_KEY, !pin);
      return !pin;
    });
    needs.current = [];
    setLayout(0);
    setStack([]);
  };
  const insertNoteLink = (note: { id: string; title: string }) => {
    if (disabled) return;
    const href = `note://${note.id}`;
    if (editor.state.selection.empty) {
      editor
        .chain()
        .focus()
        .insertContent([
          { type: "text", text: note.title || "제목 없음", marks: [{ type: "link", attrs: { href } }] },
          { type: "text", text: " " },
        ])
        .run();
    } else editor.chain().focus().setLink({ href }).run();
    setStack([]);
  };
  const aiTarget = () => {
    const { from, to, empty } = editor.state.selection;
    return { from, to, empty, text: empty ? editor.getText() : editor.state.doc.textBetween(from, to, "\n") };
  };
  const runAi = async (action: AiAction, prompt?: string) => {
    const target = aiTarget();
    setStack([]);
    const result = await requestAi(action, { selection: target.text, prompt }, s.showError);
    if (!result || editor.isDestroyed || !aiButton.current || !row.current) return;
    setAi({ result, from: target.from, to: target.to });
    setStack([{ name: "aiResult", anchor: aiButton.current, under: row.current }]);
  };
  const closeAi = () => {
    setAi(null);
    setStack([]);
  };

  /* ---------- 도구 묶음 ---------- */
  const extraTools = (level: number) => (
    <>
      {markButton(t("취소선"), <Strikethrough size={16} aria-hidden />, "strike", (c) => c.toggleStrike())}
      {markButton(t("인라인 코드"), <InlineCode size={16} aria-hidden />, "code", (c) => c.toggleCode())}
      {markButton(t("아래 첨자"), <SubscriptIcon size={16} aria-hidden />, "subscript", (c) => c.toggleSubscript())}
      {markButton(t("위 첨자"), <SuperscriptIcon size={16} aria-hidden />, "superscript", (c) => c.toggleSuperscript())}
      <Divider />
      {split(
        "highlight",
        level,
        t("형광펜"),
        t("배경색 고르기"),
        <Highlighter size={16} aria-hidden />,
        editor.isActive("highlight"),
        () => applyColor("highlight", editor.isActive("highlight") ? null : lastColor.highlight),
      )}
      {split(
        "color",
        level,
        t("글자색"),
        t("글자색 고르기"),
        <TextColor size={16} aria-hidden />,
        Boolean(colorOf("color")),
        () => applyColor("color", colorOf("color") ? null : lastColor.color),
      )}
      <IconButton
        label={t("인라인 수식")}
        disabled={disabled}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => requestMath(editor, { kind: "inlineMath" })}
      >
        <SquareSigma size={16} aria-hidden />
      </IconButton>
      <Divider />
      <IconButton label={pinExtra ? t("도구줄 고정 해제") : t("도구줄에 고정")} active={pinExtra} onClick={togglePin}>
        <Pin size={16} aria-hidden />
      </IconButton>
    </>
  );
  const fontSize = (
    <Group label={t("글자 크기")}>
      <IconButton
        label={t("글자 작게")}
        disabled={disabled || sizeNow <= FONT_SIZES[0]}
        onClick={() => stepSize(false)}
      >
        <Minus size={16} aria-hidden />
      </IconButton>
      <span className="tb-size" aria-live="polite" aria-label={t("글자 크기 {size}px", { size: sizeNow })}>
        {sizeNow}px
      </span>
      <IconButton
        label={t("글자 크게")}
        disabled={disabled || sizeNow >= FONT_SIZES.at(-1)!}
        onClick={() => stepSize(true)}
      >
        <Plus size={16} aria-hidden />
      </IconButton>
    </Group>
  );
  const linkTools = (level: number) => (
    <>
      <IconButton
        label={t("링크")}
        active={editor.isActive("link")}
        disabled={disabled}
        onClick={() => void linkAction(s, editor)}
      >
        <Link2 size={16} aria-hidden />
      </IconButton>
      {popButton("note", level, t("노트 연결"), <NoteLink size={16} aria-hidden />)}
    </>
  );
  const imageItem = BLOCK_ITEMS.find((item) => item.id === "image");
  const insertImage = () => {
    if (disabled || !imageItem) return;
    void Promise.resolve(imageItem.run(editor));
  };
  const AlignIcon = align[2];
  const blockTools = (
    <Group label={t("정렬·글 방향")}>
      <IconButton
        label={t("정렬: {current} (누르면 {next})", { current: align[1], next: nextAlign[1] })}
        disabled={disabled}
        onClick={cmd((c) => (nextAlign[0] === "left" ? c.unsetTextAlign() : c.setTextAlign(nextAlign[0])))}
      >
        <AlignIcon size={16} aria-hidden />
      </IconButton>
      <IconButton
        label={rtl ? t("글 방향: 끝에서 시작 (오른쪽→왼쪽)") : t("글 방향: 앞에서 시작 (왼쪽→오른쪽)")}
        active={rtl}
        disabled={disabled}
        onClick={cmd(setDir(rtl ? null : "rtl"))}
      >
        {rtl ? <DirectionRtl size={16} aria-hidden /> : <DirectionLtr size={16} aria-hidden />}
      </IconButton>
    </Group>
  );
  const clearTool = (
    <IconButton
      label={t("서식 지우기 (글자만 남김)")}
      disabled={disabled}
      onClick={cmd((c) => setDir(null)(c.unsetAllMarks().unsetTextAlign()))}
    >
      <ClearFormatting size={16} aria-hidden />
    </IconButton>
  );

  /* ---------- 팝오버 ---------- */
  const renderPop = (pop: Pop, level: number) => {
    const common = { anchor: pop.anchor, under: pop.under, bounds: row.current, onClose: () => closeAt(level) };
    switch (pop.name) {
      case "more":
        return (
          <Popover
            key={pop.name}
            {...common}
            keepOpen={palettePinned && (isOpen("highlight") || isOpen("color"))}
            label={t("서식 더보기")}
            role="toolbar"
            className="tb-more"
          >
            {!pinExtra && <div className="tb-more-row">{extraTools(level + 1)}</div>}
            {/* Figma 도구줄에 자리가 없는 도구: 글자 크기·정렬·글 방향·서식 지우기·이모지 */}
            <div className="tb-more-row">
              {fontSize}
              {compact && select("font", level + 1, t("글꼴"), fontName)}
              <Divider />
              {compact && linkTools(level + 1)}
              {popButton("emoji", level + 1, t("이모지"), <Smile size={16} aria-hidden />)}
              <Divider />
              {blockTools}
              <Divider />
              {clearTool}
            </div>
          </Popover>
        );
      case "highlight":
      case "color":
        return (
          <Popover
            key={pop.name}
            {...common}
            keepOpen={palettePinned}
            label={pop.name === "highlight" ? t("배경색") : t("글자색")}
            className="tb-pop-panel"
          >
            <ColorPalette
              kind={pop.name}
              current={colorOf(pop.name)}
              pinned={palettePinned}
              onPick={(color) => applyColor(pop.name as ColorKind, color)}
              onPin={() => setPalettePinned((p) => !p)}
              onClose={() => closeAt(level)}
            />
          </Popover>
        );
      case "para":
        return (
          <Popover key={pop.name} {...common} label={t("문단 스타일")} role="listbox" className="tb-menu">
            {PARAGRAPHS.map(([value, label]) => (
              <button
                key={value}
                type="button"
                role="option"
                aria-selected={paraValue === value}
                className={paraValue === value ? "is-active" : ""}
                onClick={() => {
                  if (!disabled) {
                    if (value === "paragraph") editor.chain().focus().setParagraph().run();
                    else
                      editor
                        .chain()
                        .focus()
                        .setHeading({ level: Number(value) as 1 | 2 | 3 })
                        .run();
                  }
                  closeAt(level);
                }}
              >
                {label}
              </button>
            ))}
          </Popover>
        );
      case "font":
        return (
          <Popover key={pop.name} {...common} label={t("글꼴")} role="listbox" className="tb-menu">
            {fonts.map(([label, stack]) => (
              <button
                key={stack??"default"}
                type="button"
                role="option"
                aria-selected={fontName === label}
                className={fontName === label ? "is-active" : ""}
                style={{ fontFamily: stack ?? undefined }}
                onClick={() => {
                  cmd((c) => (stack ? c.setFontFamily(stack) : c.unsetFontFamily()))();
                  closeAt(level);
                }}
              >
                {label}
              </button>
            ))}
          </Popover>
        );
      case "ol":
        return (
          <Popover key={pop.name} {...common} label={t("번호 목록 모양")} className="tb-pop-panel">
            <ListStyles
              styles={ORDERED_STYLES}
              label={t("번호 목록 모양")}
              onPick={(style) => setListStyle("orderedList", style)}
              current={
                editor.isActive("orderedList") ? (editor.getAttributes("orderedList").listStyleType ?? "decimal") : ""
              }
            />
          </Popover>
        );
      case "ul":
        return (
          <Popover key={pop.name} {...common} label={t("글머리 목록 모양")} className="tb-pop-panel">
            <ListStyles
              styles={BULLET_STYLES}
              label={t("글머리 목록 모양")}
              onPick={(style) => setListStyle("bulletList", style)}
              current={
                editor.isActive("bulletList") ? (editor.getAttributes("bulletList").listStyleType ?? "disc") : ""
              }
            />
          </Popover>
        );
      case "emoji":
        return (
          <Popover key={pop.name} {...common} label={t("이모지")} className="tb-pop-panel">
            <Suspense fallback={<p className="tb-empty">{t("이모지를 불러오는 중…")}</p>}>
              <EmojiPicker
                onPick={(char) => {
                  if (!disabled) editor.chain().focus().insertContent(char).run();
                  setStack([]);
                }}
              />
            </Suspense>
          </Popover>
        );
      case "insert":
        return (
          <Popover key={pop.name} {...common} label={t("블록 삽입")} className="tb-pop-panel tb-insert-pop">
            <BlockInsertPanel editor={editor} onClose={() => closeAt(level)} />
          </Popover>
        );
      case "note":
        return (
          <Popover key={pop.name} {...common} label={t("노트 연결")} className="tb-pop-panel">
            <NotePicker exclude={s.selectedId} onPick={insertNoteLink} />
          </Popover>
        );
      case "ai": {
        const target = aiTarget();
        return (
          <Popover key={pop.name} {...common} label={t("AI 요청")} className="tb-pop-panel">
            <AiMenu
              scope={t("대상: {target} · {count}자", {
                target: target.empty ? t("노트 전체") : t("고른 글"),
                count: Array.from(target.text).length,
              })}
              onRun={(action, prompt) => void runAi(action, prompt)}
            />
          </Popover>
        );
      }
      case "aiResult":
        return (
          ai && (
            <Popover key={pop.name} {...common} onClose={closeAi} label={t("AI 결과")} className="tb-pop-panel">
              <AiResultView
                result={ai.result}
                onReplace={() => {
                  editor.chain().focus().insertContentAt({ from: ai.from, to: ai.to }, ai.result.text).run();
                  closeAi();
                }}
                onInsertBelow={() => {
                  const $to = editor.state.doc.resolve(Math.min(ai.to, editor.state.doc.content.size));
                  editor
                    .chain()
                    .focus()
                    .insertContentAt($to.depth ? $to.after(1) : $to.pos, {
                      type: "paragraph",
                      content: [{ type: "text", text: ai.result.text }],
                    })
                    .run();
                  closeAi();
                }}
                onRetry={() => void runAi(ai.result.action, ai.result.input.prompt)}
                onDiscard={closeAi}
              />
            </Popover>
          )
        );
    }
  };

  const tableIn = editor.isActive("table");
  const tableCommands = [
    [t("위에 행 추가"), "addRowBefore"],
    [t("아래에 행 추가"), "addRowAfter"],
    [t("왼쪽에 열 추가"), "addColumnBefore"],
    [t("오른쪽에 열 추가"), "addColumnAfter"],
    [t("행 삭제"), "deleteRow"],
    [t("열 삭제"), "deleteColumn"],
    [t("셀 병합"), "mergeCells"],
    [t("셀 분할"), "splitCell"],
    [t("제목 행 전환"), "toggleHeaderRow"],
    [t("제목 열 전환"), "toggleHeaderColumn"],
    [t("표 삭제"), "deleteTable"],
  ] as const;
  const inlineExtra = pinExtra && step === 0;
  const aiOpen = isOpen("ai") || isOpen("aiResult");

  return (
    <>
      <div
        ref={row}
        className={`editor-toolbar tb-row${compact ? " is-compact" : ""}`}
        role="toolbar"
        aria-label={t("서식 도구 모음")}
      >
        {/* Figma 01 도구줄 순서: 본문 ▾ · B I U · 목록 · 연결·이미지·블록 삽입 · 미리보기 · 더보기 */}
        <Group label={t("문단·글꼴")}>
          {select("para", 0, t("문단 스타일"), PARAGRAPHS.find(([v]) => v === paraValue)?.[1] ?? t("제목 {level}",{level:paraValue}))}
          {!compact && select("font", 0, t("글꼴"), fontName)}
        </Group>
        <Group label={t("글자 모양")}>
          {markButton(t("굵게 (Ctrl+B)"), <Bold size={16} aria-hidden />, "bold", (c) => c.toggleBold())}
          {markButton(t("기울임 (Ctrl+I)"), <Italic size={16} aria-hidden />, "italic", (c) => c.toggleItalic())}
          {markButton(t("밑줄 (Ctrl+U)"), <UnderlineIcon size={16} aria-hidden />, "underline", (c) =>
            c.toggleUnderline(),
          )}
        </Group>
        {inlineExtra && (
          <>
            <Divider />
            <Group label={t("서식 더보기")}>{extraTools(0)}</Group>
          </>
        )}
        <Group label={t("목록")}>
          {markButton(t("할 일 목록"), <TaskList size={16} aria-hidden />, "taskList", (c) => c.toggleTaskList())}
          {split(
            "ol",
            0,
            t("번호 목록"),
            t("번호 목록 모양"),
            <ListOrdered size={16} aria-hidden />,
            editor.isActive("orderedList"),
            cmd((c) => c.toggleOrderedList()),
          )}
          {split(
            "ul",
            0,
            t("글머리 목록"),
            t("글머리 목록 모양"),
            <List size={16} aria-hidden />,
            editor.isActive("bulletList"),
            cmd((c) => c.toggleBulletList()),
          )}
        </Group>
        <Group label={t("넣기")}>
          {!compact && linkTools(0)}
          <IconButton label={t("이미지")} disabled={disabled || !imageItem?.available(editor)} onClick={insertImage}>
            <ImageIcon size={16} aria-hidden />
          </IconButton>
          {popButton("insert", 0, t("블록 삽입"), <Plus size={16} aria-hidden />)}
          <IconButton label={t("미리보기")} onClick={() => window.dispatchEvent(new Event(PREVIEW_EVENT))}>
            <Eye size={16} aria-hidden />
          </IconButton>
          {popButton("more", 0, t("서식 더보기"), <MoreVertical size={16} weight="bold" aria-hidden />)}
        </Group>
        <div className="tb-group" ref={aiGroup}>
          <button
            ref={aiButton}
            type="button"
            className={`tb-ai-btn${aiOpen ? " is-open" : ""}`}
            aria-label={t("AI에게 요청")}
            title={t("AI에게 요청")}
            aria-haspopup="dialog"
            aria-expanded={aiOpen}
            disabled={disabled}
            onClick={toggle("ai", 0)}
          >
            <span className="tb-ai-halo" aria-hidden />
            <span className="tb-ai-face" aria-hidden />
            <span className="tb-ai-particles" aria-hidden>
              {Array.from({ length: 12 }, (_, i) => (
                <i key={i} />
              ))}
            </span>
            <svg className="tb-ai-stars" width="16" height="16" viewBox="0 0 16 16" aria-hidden>
              <path d="M6 3.4C6.448 6.685 8.315 8.552 11.6 9 8.315 9.448 6.448 11.315 6 14.6 5.552 11.315 3.685 9.448.4 9 3.685 8.552 5.552 6.685 6 3.4Z" />
              <path d="M12.2 1.5c.232 1.701 1.199 2.668 2.9 2.9-1.701.232-2.668 1.199-2.9 2.9-.232-1.701-1.199-2.668-2.9-2.9 1.701-.232 2.668-1.199 2.9-2.9Z" />
              <path d="M12.2 9.7c.232 1.701 1.199 2.668 2.9 2.9-1.701.232-2.668 1.199-2.9 2.9-.232-1.701-1.199-2.668-2.9-2.9 1.701-.232 2.668-1.199 2.9-2.9Z" />
            </svg>
          </button>
        </div>
        {/* 파일 붙여넣기·끌어넣기와 수식 편집 창은 여기서 계속 동작한다. 넣기 버튼은 블록 손잡이로 옮겨 감춘다. */}
        <span className="tb-hidden-host">
          <AttachmentButton editor={editor} />
          <MathTools editor={editor} />
        </span>
      </div>
      {pinExtra && !inlineExtra && (
        <div ref={pinnedRow} className="tb-row-pinned" role="toolbar" aria-label={t("고정한 서식 도구")}>
          {extraTools(0)}
        </div>
      )}
      {stack.map((pop, level) => renderPop(pop, level))}
      {editor.isActive("callout") && (
        <fieldset
          className="callout-tools"
          aria-label={t("콜아웃 설정")}
          // Reset only the fieldset defaults .callout-tools leaves alone (it owns padding and border-bottom).
          style={{ margin: 0, minWidth: 0, borderTop: 0, borderInline: 0 }}
        >
          <button
            type="button"
            disabled={readOnly}
            onClick={async () => {
              if (readOnly || !editor.isEditable) return;
              const result = await s.prompt({
                title: t("콜아웃 아이콘"),
                message: t("이모지나 짧은 글자를 입력하세요."),
                label: t("아이콘"),
                initial: String(editor.getAttributes("callout").icon),
                confirmLabel: t("적용"),
              });
              if (result !== null && !editor.isDestroyed)
                editor
                  .chain()
                  .focus()
                  .updateAttributes("callout", { icon: result.value.slice(0, 32) })
                  .run();
            }}
          >
            {t("아이콘 변경")}
          </button>
          <button
            type="button"
            disabled={readOnly}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() =>
              editor
                .chain()
                .focus()
                .updateAttributes("callout", {
                  backColor: "#fff5d6",
                  backColorDark: "#3d3420",
                  borderColor: "#e8cc7b",
                  borderColorDark: "#6d5b2a",
                })
                .run()
            }
          >
            {t("노란 배경")}
          </button>
          <button
            type="button"
            disabled={readOnly}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() =>
              editor
                .chain()
                .focus()
                .resetAttributes("callout", ["backColor", "backColorDark", "borderColor", "borderColorDark"])
                .run()
            }
          >
            {t("기본 배경")}
          </button>
          <button
            type="button"
            disabled={readOnly}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => editor.chain().focus().toggleCallout().run()}
          >
            {t("콜아웃 해제")}
          </button>
        </fieldset>
      )}
      <CsvTools editor={editor}/>
      {tableIn && (
        <div className="table-tools" role="toolbar" aria-label={t("표 편집 도구")}>
          {tableCommands.map(([label, command]) => (
            <button
              type="button"
              key={command}
              disabled={readOnly || !editor.can()[command]()}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() =>
                editor
                  .chain()
                  .command(({ tr }) => {
                    closeHistory(tr);
                    return true;
                  })
                  .focus()
                  [command]()
                  .run()
              }
            >
              {label}
            </button>
          ))}
        </div>
      )}
    </>
  );
}

async function linkAction(s: ReturnType<typeof useStore>, editor: Editor) {
  const existing = (editor.getAttributes("link").href as string | undefined) ?? "";
  const r = await s.prompt({
    title: t("링크 편집"),
    message: t("이동할 주소를 입력하세요. 비우면 링크가 제거됩니다."),
    label: "URL",
    initial: existing,
    placeholder: "https://example.com",
    confirmLabel: t("적용"),
    allowEmpty: true,
  });
  if (r === null) return;
  const url = r.value.trim();
  if (!url) {
    editor.chain().focus().extendMarkRange("link").unsetLink().run();
    return;
  }
  const safe = /^(https?:\/\/|mailto:|note:\/\/|#|\/)/i.test(url) ? url : `https://${url}`;
  editor.chain().focus().extendMarkRange("link").setLink({ href: safe }).run();
}
