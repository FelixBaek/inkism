import React, { useEffect, useId, useState, useRef } from "react";
import { createPortal } from "react-dom";
import { Node } from "@tiptap/core";
import { NodeViewWrapper, ReactNodeViewRenderer, type ReactNodeViewProps } from "@tiptap/react";
import DOMPurify from "dompurify";
import { TreeStructure } from "../../icons";
import { t } from "../../i18n";
import { useEditable } from "./shared";

const MAX_CODE = 50_000;
export const sampleDiagram = "flowchart LR\n  A[메모 쓰기] --> B[기기에 저장] --> C[내 서버로 동기화]";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    diagram: { insertDiagram: (options?: { code?: string }) => ReturnType };
  }
}

export const Diagram = Node.create({
  name: "diagram",
  group: "block",
  atom: true,
  draggable: true,
  addAttributes() {
    return {
      code: {
        default: "",
        parseHTML: (el) => (el.querySelector("code")?.textContent ?? "").slice(0, MAX_CODE),
        rendered: false,
      },
      mode: {
        default: "preview",
        parseHTML: (el) => (el.dataset.mode === "code" ? "code" : "preview"),
        rendered: false,
      },
    };
  },
  parseHTML() {
    return [{ tag: 'div[data-type="inkism-diagram"]' }];
  },
  // The Mermaid source stays readable in exports and Markdown fallbacks.
  renderHTML({ node }) {
    return [
      "div",
      { "data-type": "inkism-diagram", "data-mode": node.attrs.mode },
      ["pre", ["code", { class: "language-mermaid" }, node.attrs.code]],
    ];
  },
  renderText({ node }) {
    return node.attrs.code;
  },
  addNodeView() {
    return ReactNodeViewRenderer(DiagramView);
  },
  addCommands() {
    return {
      insertDiagram:
        (options = {}) =>
        ({ commands }) =>
          commands.insertContent({
            type: this.name,
            attrs: { code: (options.code ?? sampleDiagram).slice(0, MAX_CODE), mode: "code" },
          }),
    };
  },
});

const cssVar = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
let queue: Promise<unknown> = Promise.resolve();

/** Mermaid renders one diagram at a time (shared global config), strict mode, plain SVG labels. */
function renderMermaid(id: string, code: string): Promise<string> {
  const job = queue.then(async () => {
    const { default: mermaid } = await import("mermaid");
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: "strict",
      htmlLabels: false,
      theme: "base",
      look: "classic",
      fontFamily: cssVar("--font-sans"),
      themeVariables: {
        background: cssVar("--raised"),
        primaryColor: cssVar("--hover"),
        primaryTextColor: cssVar("--text"),
        primaryBorderColor: cssVar("--border-strong"),
        lineColor: cssVar("--muted"),
        textColor: cssVar("--text"),
        secondaryColor: cssVar("--active"),
        tertiaryColor: cssVar("--surface"),
        fontSize: "12.5px",
      },
    });
    const { svg } = await mermaid.render(id, code);
    return safeDiagramSVG(svg);
  });
  queue = job.catch(() => {});
  return job;
}

export function safeDiagramSVG(svg:string):string {
  const safe=DOMPurify.sanitize(svg,{USE_PROFILES:{svg:true,svgFilters:true},FORBID_TAGS:['foreignObject','image','script']});
  const document=new DOMParser().parseFromString(safe,'image/svg+xml');
  if(document.querySelector('parsererror')||document.documentElement.localName!=='svg')throw new Error(t('도식을 그리지 못했습니다.'));
  const externalCSS=(value:string)=>/\\|@import|@font-face/i.test(value)||[...value.matchAll(/url\(\s*(["']?)(.*?)\1\s*\)/gi)].some(match=>!match[2].trim().startsWith('#'));
  for(const element of document.querySelectorAll('*')){
    for(const attr of [...element.attributes]){
      if((attr.localName==='href'&&!attr.value.startsWith('#'))||/^on/i.test(attr.name))element.removeAttributeNode(attr);
      else if(externalCSS(attr.value))element.removeAttributeNode(attr);
    }
    if(element.localName==='style'&&externalCSS(element.textContent??''))element.remove();
  }
  document.documentElement.setAttribute('xmlns','http://www.w3.org/2000/svg');
  return new XMLSerializer().serializeToString(document.documentElement);
}
export function diagramErrorLine(error:unknown,code:string):number|undefined {
  const value=error as {hash?:{loc?:{first_line?:number}},message?:string};
  const line=value?.hash?.loc?.first_line??Number(/(?:line|줄)\s+(\d+)/i.exec(value?.message??String(error))?.[1]);
  return Number.isInteger(line)&&line>=1&&line<=code.split('\n').length?line:undefined;
}

function DiagramView({ node, editor, updateAttributes }: ReactNodeViewProps) {
  const { code, mode } = node.attrs as { code: string; mode: "preview" | "code" };
  const editable = useEditable(editor);
  const id = "mbx-mermaid-" + useId().replace(/[^\w-]/g, "");
  const [draft, setDraft] = useState(code);
  const [out, setOut] = useState<{ svg: string; error: string;line?:number }>({ svg: "", error: "" });
  const [expanded,setExpanded]=useState(false),[zoom,setZoom]=useState(1),[downloadError,setDownloadError]=useState('');
  const dialog=useRef<HTMLDialogElement>(null),textarea=useRef<HTMLTextAreaElement>(null),opener=useRef<HTMLElement|null>(null),jump=useRef<number|undefined>(undefined);
  useEffect(()=>{if(expanded)dialog.current?.showModal();else {dialog.current?.close();opener.current?.focus();opener.current=null;}},[expanded]);
  const close=()=>setExpanded(false);
  const download=()=>{try{setDownloadError('');const blob=new Blob([safeDiagramSVG(out.svg)],{type:'image/svg+xml;charset=utf-8'});const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download='diagram.svg';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}catch(error){setDownloadError(error instanceof Error?error.message:String(error));}};
  const open=()=>{opener.current=document.activeElement instanceof HTMLElement?document.activeElement:null;setZoom(1);setExpanded(true);};
  useEffect(() => setDraft(code), [code]);
  const showCode = mode === "code" && editable;
  useEffect(()=>{if(!showCode||jump.current===undefined||!textarea.current)return;const line=jump.current;jump.current=undefined;const lines=draft.split('\n');const start=lines.slice(0,line-1).reduce((n,text)=>n+text.length+1,0);textarea.current.focus();textarea.current.setSelectionRange(start,start+(lines[line-1]?.length??0));},[showCode,draft]);
  useEffect(() => {
    if (showCode) return;
    let live = true;
    if (!code.trim()) {
      setOut({ svg: "", error: "" });
      return;
    }
    setOut({svg:"",error:""});setExpanded(false);
    renderMermaid(id, code).then(
      (svg) => live && setOut({ svg, error: "" }),
      (error) =>
        live &&
        setOut({
          svg: "",
          error: error instanceof Error ? error.message.slice(0,2000) : t("도식을 그리지 못했습니다."),
          line:diagramErrorLine(error,code),
        }),
    );
    return () => {
      live = false;
    };
  }, [code, showCode]); // eslint-disable-line react-hooks/exhaustive-deps

  let preview: React.ReactNode;
  if (out.error)
    preview = (
      <div className="media-error" role="alert">
        <p>{t("도식을 그리지 못했습니다: {error}", { error: out.error })}</p>
        {out.line&&<><p>{t('오류 위치: {line}줄',{line:out.line})}</p><pre>{code.split('\n')[out.line-1]}</pre>{editable&&<button type="button" onClick={()=>{jump.current=out.line;updateAttributes({mode:'code'});}}>{t('오류 줄 편집')}</button>}</>}
      </div>
    );
  else if (out.svg)
    preview = (
      <div
        className="diagram-svg"
        role="img"
        aria-label={t("도식 미리보기")}
        dangerouslySetInnerHTML={{ __html: out.svg }}
      />
    );
  else
    preview = (
      <p className="media-note">{code.trim() ? t("도식을 그리는 중…") : t("코드를 입력하면 도식이 그려집니다.")}</p>
    );
  return (
    <NodeViewWrapper className="media-block" data-type="inkism-diagram" contentEditable={false}>
      <div className="diagram-head">
        <TreeStructure size={14} className="diagram-icon" aria-hidden />
        <span className="diagram-label">{t("도식 · Mermaid")}</span>
        {out.svg&&!showCode&&<div className="diagram-actions"><button type="button" onClick={open}>{t('도식 확대')}</button><button type="button" onClick={download}>{t('SVG 내보내기')}</button></div>}
        {editable && (
          <fieldset
            className="media-segment"
            style={{ margin: 0, border: 0, minWidth: 0 }}
            aria-label={t("도식 보기 방식")}
          >
            <button type="button" aria-pressed={mode === "code"} onClick={() => updateAttributes({ mode: "code" })}>
              {t("코드")}
            </button>
            <button
              type="button"
              aria-pressed={mode === "preview"}
              onClick={() => updateAttributes({ mode: "preview" })}
            >
              {t("미리보기")}
            </button>
          </fieldset>
        )}
      </div>
      {showCode ? (
        <textarea
          ref={textarea}
          className="diagram-code"
          value={draft}
          spellCheck={false}
          aria-label={t("Mermaid 코드")}
          rows={Math.min(16, Math.max(4, draft.split("\n").length + 1))}
          onChange={(e) => {
            setDraft(e.target.value);
            updateAttributes({ code: e.target.value.slice(0, MAX_CODE) });
          }}
        />
      ) : (
        <div className="diagram-preview">{preview}</div>
      )}
      {downloadError&&<p role="alert">{downloadError}</p>}
      {expanded&&createPortal(<dialog ref={dialog} className="diagram-dialog" aria-label={t('도식 확대')} onCancel={event=>{event.preventDefault();close();}}>
        <header><strong>{t('도식 · Mermaid')}</strong><button type="button" disabled={zoom<=0.25} onClick={()=>setZoom(z=>Math.max(.25,z-.25))}>{t('축소')}</button><output aria-live="polite">{Math.round(zoom*100)}%</output><button type="button" disabled={zoom>=4} onClick={()=>setZoom(z=>Math.min(4,z+.25))}>{t('확대')}</button><button type="button" onClick={()=>setZoom(1)}>{t('배율 초기화')}</button><button type="button" onClick={download}>{t('SVG 내보내기')}</button><button type="button" onClick={close}>{t('닫기')}</button></header>
        <div className="diagram-zoom-scroll" tabIndex={0} aria-label={t('도식 미리보기')}><div className="diagram-zoom-content" style={{width:`${zoom*100}%`}} dangerouslySetInnerHTML={{__html:out.svg}}/></div>
      </dialog>,document.body)}
    </NodeViewWrapper>
  );
}
