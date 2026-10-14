import React, { useEffect, useRef, useState } from "react";
import { Node } from "@tiptap/core";
import { NodeViewWrapper, ReactNodeViewRenderer, type ReactNodeViewProps } from "@tiptap/react";
import { Cube } from "../../icons";
import { Caption, FilePick, hostOf, linkChild, safeSrc, useEditable, useUpload } from "./shared";
import { t } from "../../i18n";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    model3d: { insertModel3d: (options?: { src?: string; title?: string }) => ReturnType };
  }
}

export const Model3d = Node.create({
  name: "model3d",
  group: "block",
  atom: true,
  draggable: true,
  addAttributes() {
    return {
      src: { default: "", parseHTML: (el) => safeSrc(el.dataset.src), rendered: false },
      title: { default: "", parseHTML: (el) => (el.dataset.title || "").slice(0, 200), rendered: false },
    };
  },
  parseHTML() {
    return [{ tag: 'div[data-type="inkism-model3d"]' }];
  },
  renderHTML({ node }) {
    const { src, title } = node.attrs;
    return ["div", { "data-type": "inkism-model3d", "data-src": src, "data-title": title }, ...linkChild(src, title)];
  },
  renderText({ node }) {
    return node.attrs.title || node.attrs.src;
  },
  addNodeView() {
    return ReactNodeViewRenderer(Model3dView);
  },
  addCommands() {
    return {
      insertModel3d:
        (options = {}) =>
        ({ commands }) =>
          commands.insertContent({ type: this.name, attrs: { src: safeSrc(options.src), title: options.title ?? "" } }),
    };
  },
});

// Import the renderer and load the model only after an explicit request.
let viewer: Promise<unknown> | null = null;
function ModelPreview({src,title,retry}:Readonly<{src:string;title:string;retry:()=>void}>) {
  const element=useRef<HTMLElement|null>(null);
  const [state,setState]=useState<"loading"|"ready"|"error">("loading");
  useEffect(()=>{
    let live=true;
    const el=element.current;
    const loaded=()=>{if(live)setState("ready");};
    const failed=()=>{
      // model-viewer 4.3 caches failed GLTF loads as empty instances. Evict only
      // this failed URL so retry can recover without changing signed URLs.
      void import("@google/model-viewer/lib/three-components/CachingGLTFLoader.js")
        .then(async({CachingGLTFLoader})=>{
          await CachingGLTFLoader.delete(src);
          const absolute=new URL(src,document.baseURI).href;
          if(absolute!==src)await CachingGLTFLoader.delete(absolute);
        }).catch(()=>{}).finally(()=>{if(live)setState("error");});
    };
    el?.addEventListener("load",loaded);el?.addEventListener("error",failed);
    const pending=viewer??=import("@google/model-viewer");
    pending.catch(()=>{if(viewer===pending)viewer=null;failed();});
    return ()=>{live=false;el?.removeEventListener("load",loaded);el?.removeEventListener("error",failed);};
  },[]);
  return <>
    {state!=="ready"&&<Cube size={96} className="model-placeholder" aria-hidden/>}
    {React.createElement("model-viewer",{ref:element,src,alt:title||t("3D 모델"),"camera-controls":"","interaction-prompt":"none","touch-action":"pan-y","shadow-intensity":"0.6",style:{display:state==="error"?"none":undefined,opacity:state==="ready"?1:0,pointerEvents:state==="ready"?"auto":"none"}})}
    <output className="model-hint">{state==="error"?t("모델을 불러오지 못했습니다"):state==="loading"?t("불러오는 중…"):t("끌어서 돌리기 · 휠로 확대")}</output>
    {state==="error"&&<button type="button" className="media-action" onClick={retry}>{t("다시 시도")}</button>}
  </>;
}

function Model3dView({ node, editor, updateAttributes }: ReactNodeViewProps) {
  const { src, title } = node.attrs as { src: string; title: string };
  const editable = useEditable(editor);
  const { busy, error, upload } = useUpload();
  const [request,setRequest]=useState<{src:string;attempt:number}|null>(null);
  useEffect(()=>setRequest(null),[src]);
  const active=request?.src===src;
  const load=()=>setRequest(previous=>({src,attempt:(previous?.attempt??0)+1}));

  if (!src) {
    return (
      <NodeViewWrapper className="media-block media-empty" data-type="inkism-model3d" contentEditable={false}>
        <div className="media-empty-head">
          <Cube size={16} aria-hidden />
          <span>{t("3D 모델")}</span>
        </div>
        {editable ? (
          <div className="media-empty-row">
            <FilePick
              accept=".glb,.gltf,model/gltf-binary,model/gltf+json"
              label={busy ? t("올리는 중…") : t("모델 파일 선택")}
              disabled={busy}
              onFile={async (file) => {
                const asset = await upload(file);
                if (asset) updateAttributes({ src: asset.src, title: asset.name });
              }}
            />
            <span className="media-note">{t("glb 또는 한 파일로 된 gltf를 지원합니다.")}</span>
          </div>
        ) : (
          <p className="media-note">{t("3D 모델이 비어 있습니다.")}</p>
        )}
        {error && (
          <p className="media-error" role="alert">
            {error}
          </p>
        )}
      </NodeViewWrapper>
    );
  }

  const ext = (/\.(glb|gltf)$/i.exec(title)?.[1] || "glb").toUpperCase();
  return (
    <NodeViewWrapper className="media-block" data-type="inkism-model3d" contentEditable={false}>
      <div className="media-stage model-stage">
        {active?<ModelPreview key={src+":"+request.attempt} src={src} title={title} retry={load}/>:<button type="button" className="media-action" onClick={load}><Cube size={24} aria-hidden/>{t("3D 모델 불러오기")}</button>}
      </div>
      {active&&<button type="button" className="media-action" onClick={()=>setRequest(null)}>{t("3D 보기 닫기")}</button>}
      <Caption
        icon={<Cube size={14} />}
        title={title}
        fallback={t("3D 모델")}
        meta={src.startsWith("/api/") ? ext : hostOf(src)}
        editable={editable}
        onTitle={(next) => updateAttributes({ title: next })}
      />
    </NodeViewWrapper>
  );
}
