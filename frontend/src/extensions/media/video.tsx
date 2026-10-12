import { t } from "../../i18n";
import React, { useEffect, useRef, useState } from "react";
import { Node } from "@tiptap/core";
import { NodeViewWrapper, ReactNodeViewRenderer, type ReactNodeViewProps } from "@tiptap/react";
import { attachmentURL } from "../attachment";
import { FilmSlate, Play, YoutubeLogo } from "../../icons";
import { Caption, FilePick, hostOf, linkChild, safeSrc, useEditable, useUpload } from "./shared";

import {playbackFailure} from "./playback";

export type VideoKind = "file" | "youtube" | "vimeo" | "url";
const youtube =
  /^https:\/\/(?:www\.|m\.)?(?:youtube\.com\/(?:watch\?(?:[^#]*&)?v=|embed\/|shorts\/|live\/)|youtu\.be\/)([\w-]{11})(?![\w-])/i;
const vimeo = /^https:\/\/(?:www\.|player\.)?vimeo\.com\/(?:video\/)?(\d{1,12})(?!\d)/i;

export function videoKind(src: string): VideoKind {
  if (attachmentURL.test(src)) return "file";
  if (youtube.test(src)) return "youtube";
  if (vimeo.test(src)) return "vimeo";
  return "url";
}
/** Privacy-enhanced embed address, loaded only after the user presses play. */
export function embedURL(src: string): string {
  const y = youtube.exec(src);
  if (y) return `https://www.youtube-nocookie.com/embed/${y[1]}?autoplay=1&rel=0`;
  const v = vimeo.exec(src);
  return v ? `https://player.vimeo.com/video/${v[1]}?dnt=1&autoplay=1` : "";
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    video: { insertVideo: (options?: { src?: string; kind?: VideoKind; title?: string }) => ReturnType };
  }
}

export const Video = Node.create({
  name: "video",
  group: "block",
  atom: true,
  draggable: true,
  addAttributes() {
    return {
      src: { default: "", parseHTML: (el) => safeSrc(el.dataset.src), rendered: false },
      kind: { default: "url", parseHTML: (el) => videoKind(safeSrc(el.dataset.src)), rendered: false },
      title: { default: "", parseHTML: (el) => (el.dataset.title || "").slice(0, 200), rendered: false },
    };
  },
  parseHTML() {
    return [{ tag: 'div[data-type="inkism-video"]' }];
  },
  renderHTML({ node }) {
    const { src, kind, title } = node.attrs;
    return [
      "div",
      { "data-type": "inkism-video", "data-src": src, "data-kind": kind, "data-title": title },
      ...linkChild(src, title),
    ];
  },
  renderText({ node }) {
    return node.attrs.title || node.attrs.src;
  },
  addNodeView() {
    return ReactNodeViewRenderer(VideoView);
  },
  addCommands() {
    return {
      insertVideo:
        (options = {}) =>
        ({ commands }) => {
          const src = safeSrc(options.src);
          return commands.insertContent({
            type: this.name,
            attrs: { src, kind: videoKind(src), title: options.title ?? "" },
          });
        },
    };
  },
});

const VIDEO_FALLBACK: Partial<Record<VideoKind, string>> = { youtube: t("YouTube 동영상"), vimeo: t("Vimeo 동영상") };
function VideoView({ node, editor, updateAttributes }: ReactNodeViewProps) {
  const { src, kind, title } = node.attrs as { src: string; kind: VideoKind; title: string };
  const editable = useEditable(editor);
  const { busy, error, upload, fail } = useUpload();
  const [playing, setPlaying] = useState(false);
  const [playbackError,setPlaybackError]=useState("");
  const player=useRef<HTMLVideoElement>(null);
  useEffect(()=>{setPlaying(false);setPlaybackError("");},[src]);
  const [url, setUrl] = useState("");
  const set = (next: string, name = "") => updateAttributes({ src: next, kind: videoKind(next), title: name });

  if (!src) {
    const submit = () => {
      const next = safeSrc(url);
      if (next) set(next);
      else fail(t("http(s)로 시작하는 동영상 주소를 넣어 주세요."));
    };
    return (
      <NodeViewWrapper className="media-block media-empty" data-type="inkism-video" contentEditable={false}>
        <div className="media-empty-head">
          <FilmSlate size={16} aria-hidden />
          <span>{t("동영상")}</span>
        </div>
        {editable ? (
          <div className="media-empty-row">
            <input
              className="media-input"
              type="url"
              value={url}
              placeholder={t("YouTube·Vimeo 또는 영상 파일 주소 붙여넣기")}
              aria-label={t("동영상 주소")}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  submit();
                }
              }}
            />
            <button type="button" className="media-action" onClick={submit} disabled={busy}>
              {t("추가")}
            </button>
            <FilePick
              accept="video/*"
              label={busy ? t("올리는 중…") : t("파일 선택")}
              disabled={busy}
              onFile={async (file) => {
                const asset = await upload(file);
                if (asset) set(asset.src, asset.name);
              }}
            />
          </div>
        ) : (
          <p className="media-note">{t("동영상이 비어 있습니다.")}</p>
        )}
        {error && (
          <p className="media-error" role="alert">
            {error}
          </p>
        )}
      </NodeViewWrapper>
    );
  }

  const embed = kind === "youtube" || kind === "vimeo" ? embedURL(src) : "";
  const Logo = kind === "youtube" ? YoutubeLogo : FilmSlate;
  const label = title || t("동영상");
  let stage: React.ReactNode;
  if (!embed) stage = <video key={src} ref={player} src={src} controls preload="metadata" aria-label={label} onError={e=>setPlaybackError(playbackFailure(e.currentTarget.error))} onLoadedMetadata={()=>setPlaybackError("")} />;
  else if (playing)
    stage = (
      <iframe
        src={embed}
        title={label}
        allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
        allowFullScreen
        referrerPolicy="strict-origin-when-cross-origin"
        sandbox="allow-scripts allow-same-origin allow-presentation allow-popups"
      />
    );
  else
    stage = (
      <button
        type="button"
        className="video-play"
        aria-label={t("{label} 재생", { label })}
        onClick={() => setPlaying(true)}
      >
        <Play size={22} aria-hidden />
      </button>
    );
  return (
    <NodeViewWrapper className="media-block" data-type="inkism-video" data-kind={kind} contentEditable={false}>
      <div className="media-stage video-stage">{stage}</div>
      {playbackError&&<div className="media-error" role="alert"><p>{playbackError}</p><button type="button" className="media-action" onClick={()=>{setPlaybackError("");player.current?.load();}}>{t("미디어 다시 불러오기")}</button></div>}
      {embed&&playing&&<button type="button" className="media-action" onClick={()=>setPlaying(false)}>{t("동영상 보기 닫기")}</button>}
      <Caption
        icon={<Logo size={14} />}
        title={title}
        fallback={VIDEO_FALLBACK[kind] ?? t("동영상")}
        meta={hostOf(src)}
        editable={editable}
        onTitle={(next) => updateAttributes({ title: next })}
      />
    </NodeViewWrapper>
  );
}
