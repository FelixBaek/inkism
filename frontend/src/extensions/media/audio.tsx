import React, { useEffect, useMemo, useRef, useState } from "react";
import { Node } from "@tiptap/core";
import { NodeViewWrapper, ReactNodeViewRenderer, type ReactNodeViewProps } from "@tiptap/react";
import { attachmentURL } from "../attachment";
import { Microphone, MusicNotes, Pause, Play } from "../../icons";
import { FilePick, clock, linkChild, safeSrc, useEditable, useUpload } from "./shared";
import { t } from "../../i18n";

import {playbackFailure} from "./playback";
import {readWaveformBytes,waveformDurationAllowed} from "./waveform-budget";

const BARS = 56;

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    audio: { insertAudio: (options?: { src?: string; kind?: "file" | "record"; title?: string }) => ReturnType };
  }
}

export const Audio = Node.create({
  name: "audio",
  group: "block",
  atom: true,
  draggable: true,
  addAttributes() {
    return {
      src: { default: "", parseHTML: (el) => safeSrc(el.dataset.src), rendered: false },
      title: { default: "", parseHTML: (el) => (el.dataset.title || "").slice(0, 200), rendered: false },
      duration: {
        default: 0,
        parseHTML: (el) => {
          const value = Number(el.dataset.duration);
          return Number.isFinite(value) && value >= 0 && value < 1e6 ? value : 0;
        },
        rendered: false,
      },
      // Editor-only request ("record" starts the recorder once); never serialized.
      pending: { default: null, parseHTML: () => null, rendered: false },
    };
  },
  parseHTML() {
    return [{ tag: 'div[data-type="inkism-audio"]' }];
  },
  renderHTML({ node }) {
    const { src, title, duration } = node.attrs;
    return [
      "div",
      { "data-type": "inkism-audio", "data-src": src, "data-title": title, "data-duration": duration },
      ...linkChild(src, title),
    ];
  },
  renderText({ node }) {
    return node.attrs.title || node.attrs.src;
  },
  addNodeView() {
    return ReactNodeViewRenderer(AudioView);
  },
  addCommands() {
    return {
      insertAudio:
        (options = {}) =>
        ({ commands }) =>
          commands.insertContent({
            type: this.name,
            attrs: {
              src: safeSrc(options.src),
              title: options.title ?? "",
              pending: !options.src && options.kind === "record" ? "record" : null,
            },
          }),
    };
  },
});

/** Peak per bar from decoded samples; null when the source can't be decoded here. */
async function decodePeaks(src: string, signal: AbortSignal): Promise<number[] | null> {
  if (!attachmentURL.test(src)) return null; // External audio is not fetched (CORS, privacy).
  const response = await fetch(src, { signal });
  const bytes=await readWaveformBytes(response,signal);
  if(!bytes||signal.aborted)return null;
  const context = new OfflineAudioContext(1, 1, 44100);
  const audio = await context.decodeAudioData(bytes);
  const data = audio.getChannelData(0),
    step = Math.max(1, Math.floor(data.length / BARS)),
    peaks: number[] = [];
  for (let bar = 0; bar < BARS; bar++) {
    let peak = 0;
    for (let i = bar * step, end = Math.min(data.length, i + step); i < end; i += 16)
      peak = Math.max(peak, Math.abs(data[i]));
    peaks.push(peak);
  }
  const max = Math.max(...peaks, 1e-3);
  return peaks.map((p) => p / max);
}

/** Stable decorative bars when real samples are unavailable. */
function pseudoPeaks(seed: string): number[] {
  let h = 2166136261;
  for (const c of seed) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return Array.from({ length: BARS }, () => {
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return 0.2 + ((h >>> 0) % 800) / 1000;
  });
}

function Wave({
  peaks,
  progress,
  tone,
  onSeek,
}: Readonly<{
  peaks: number[];
  progress: number;
  tone: "play" | "rec";
  onSeek?: (ratio: number) => void;
}>) {
  return (
    <div
      className={"audio-wave is-" + tone}
      aria-hidden={!onSeek}
      role={onSeek ? "slider" : undefined}
      aria-label={onSeek ? t("재생 위치") : undefined}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(progress * 100)}
      tabIndex={onSeek ? 0 : undefined}
      onClick={
        onSeek &&
        ((e) => {
          const r = e.currentTarget.getBoundingClientRect();
          onSeek((e.clientX - r.left) / r.width);
        })
      }
      onKeyDown={
        onSeek &&
        ((e) => {
          if (e.key === "ArrowRight") onSeek(Math.min(1, progress + 0.05));
          if (e.key === "ArrowLeft") onSeek(Math.max(0, progress - 0.05));
        })
      }
    >
      {peaks.map((p, i) => (
        <span
          key={i}
          className={i / peaks.length < progress ? "is-on" : ""}
          style={{ height: Math.max(4, Math.round(p * 18)) }}
        />
      ))}
    </div>
  );
}

function recordingExtension(type: string): string {
  if (type.includes("mp4")) return "m4a";
  return type.includes("ogg") ? "ogg" : "webm";
}

function Recorder({
  onDone,
  onError,
}: Readonly<{
  onDone: (file: File, seconds: number) => void;
  onError: (message: string) => void;
}>) {
  const [seconds, setSeconds] = useState(0);
  const [levels, setLevels] = useState<number[]>([]);
  const stop = useRef<() => void>(() => {});
  useEffect(() => {
    let cancelled = false,
      saved = false;
    let stream: MediaStream | null = null,
      recorder: MediaRecorder | null = null,
      context: AudioContext | null = null,
      timer = 0;
    const started = performance.now();
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        recorder = new MediaRecorder(stream);
        const chunks: Blob[] = [];
        recorder.ondataavailable = (e) => {
          if (e.data.size) chunks.push(e.data);
        };
        recorder.onstop = () => {
          if (!saved) return;
          const type = recorder!.mimeType || "audio/webm",
            ext = recordingExtension(type);
          const stamp = new Date().toLocaleString("sv-SE").slice(0, 16).replaceAll(":", "-");
          onDone(new File(chunks, `녹음 ${stamp}.${ext}`, { type }), (performance.now() - started) / 1000);
        };
        recorder.start(1000);
        context = new AudioContext();
        const analyser = context.createAnalyser();
        analyser.fftSize = 512;
        context.createMediaStreamSource(stream).connect(analyser);
        const buffer = new Uint8Array(analyser.fftSize);
        timer = window.setInterval(() => {
          analyser.getByteTimeDomainData(buffer);
          let peak = 0;
          for (const v of buffer) peak = Math.max(peak, Math.abs(v - 128) / 128);
          setSeconds((performance.now() - started) / 1000);
          setLevels((prev) => [...prev, Math.min(1, peak * 2.5)].slice(-BARS));
        }, 150);
      } catch (error) {
        onError(
          error instanceof DOMException && error.name === "NotAllowedError"
            ? t("마이크 사용이 허용되지 않았습니다.")
            : t("녹음을 시작하지 못했습니다."),
        );
      }
    })();
    stop.current = () => {
      saved = true;
      recorder?.state === "recording" && recorder.stop();
    };
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      if (recorder?.state === "recording") recorder.stop();
      stream?.getTracks().forEach((t) => t.stop());
      void context?.close();
    };
  }, []);
  const peaks = [...levels, ...new Array(BARS - levels.length).fill(0.3)];
  return (
    <div className="audio-row is-recording">
      <button
        type="button"
        className="audio-button is-stop"
        aria-label={t("녹음 멈추고 저장")}
        onClick={() => stop.current()}
      >
        <span />
      </button>
      <div className="audio-body">
        <div className="audio-top">
          <span className="audio-dot" aria-hidden />
          <output className="audio-title">{t("녹음 중")}</output>
          <span className="audio-time">{clock(seconds)}</span>
        </div>
        <Wave peaks={peaks} progress={levels.length / BARS} tone="rec" />
      </div>
    </div>
  );
}

function AudioView({ node, editor, getPos, updateAttributes }: ReactNodeViewProps) {
  const { src, title, duration, pending } = node.attrs as {
    src: string;
    title: string;
    duration: number;
    pending: string | null;
  };
  const editable = useEditable(editor);
  const { busy, error, upload, fail } = useUpload();
  const [recording, setRecording] = useState(false);
  const [playbackError,setPlaybackError]=useState("");
  const player = useRef<HTMLAudioElement>(null);
  const [time, setTime] = useState({ current: 0, total: duration, playing: false });
  const [peaks, setPeaks] = useState<number[] | null>(null);
  const [waveformRequest,setWaveformRequest]=useState<{src:string;seconds:number;player:HTMLAudioElement}|null>(null);
  useEffect(()=>{setPlaybackError("");setTime({current:0,total:duration,playing:false});},[src]);

  useEffect(() => {
    if (pending !== "record") return;
    // Consume the one-shot request without an undo step.
    const pos = getPos();
    if (typeof pos === "number")
      editor.view.dispatch(editor.state.tr.setNodeAttribute(pos, "pending", null).setMeta("addToHistory", false));
    if (editable) setRecording(true);
  }, [pending]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setPeaks(null);
    if (!src||waveformRequest?.src!==src||waveformRequest.player!==player.current||!waveformDurationAllowed(waveformRequest.seconds)) return;
    const controller = new AbortController();
    decodePeaks(src, controller.signal).then(
      (p) => {
        if (!controller.signal.aborted) setPeaks(p);
      },
      () => {},
    );
    return () => controller.abort();
  }, [src,waveformRequest]);
  const shown = useMemo(() => peaks || pseudoPeaks(src), [peaks, src]);

  if (!src) {
    return (
      <NodeViewWrapper className="media-block" data-type="inkism-audio" contentEditable={false}>
        {recording ? (
          <Recorder
            onError={(message) => {
              setRecording(false);
              fail(message);
            }}
            onDone={async (file, seconds) => {
              setRecording(false);
              const asset = await upload(file);
              if (asset)
                updateAttributes({ src: asset.src, title: asset.name, duration: Math.round(seconds * 10) / 10 });
            }}
          />
        ) : (
          <div className="media-empty">
            <div className="media-empty-head">
              <MusicNotes size={16} aria-hidden />
              <span>{busy ? t("오디오를 저장하는 중…") : t("오디오")}</span>
            </div>
            {editable ? (
              <div className="media-empty-row">
                <FilePick
                  accept="audio/*"
                  label={t("파일 선택")}
                  disabled={busy}
                  onFile={async (file) => {
                    const asset = await upload(file);
                    if (asset) updateAttributes({ src: asset.src, title: asset.name });
                  }}
                />
                <button
                  type="button"
                  className="media-action"
                  disabled={busy || !navigator.mediaDevices?.getUserMedia}
                  onClick={() => setRecording(true)}
                >
                  <Microphone size={14} aria-hidden /> {t("녹음하기")}
                </button>
              </div>
            ) : (
              <p className="media-note">{t("오디오가 비어 있습니다.")}</p>
            )}
            {error && (
              <p className="media-error" role="alert">
                {error}
              </p>
            )}
          </div>
        )}
      </NodeViewWrapper>
    );
  }

  const total = Number.isFinite(time.total) && time.total > 0 ? time.total : duration;
  const seek = (ratio: number) => {
    const a = player.current;
    if (a && total) a.currentTime = Math.max(0, Math.min(1, ratio)) * total;
  };
  return (
    <NodeViewWrapper className="media-block" data-type="inkism-audio" contentEditable={false}>
      <audio
        key={src}
        ref={player}
        src={src}
        preload="metadata"
        onError={e=>{setPlaybackError(playbackFailure(e.currentTarget.error));setTime(t=>({...t,playing:false}));}}
        onLoadedMetadata={(e) => {
          setPlaybackError("");
          const total = e.currentTarget.duration;
          setWaveformRequest({src,seconds:total,player:e.currentTarget});
          setTime((t) => ({ ...t, total }));
        }}
        onTimeUpdate={(e) => {
          const current = e.currentTarget.currentTime;
          setTime((t) => ({ ...t, current }));
        }}
        onPlay={() => setTime((t) => ({ ...t, playing: true }))}
        onPause={() => setTime((t) => ({ ...t, playing: false }))}
        onEnded={() => setTime((t) => ({ ...t, playing: false }))}
      />
      {playbackError&&<div className="media-error" role="alert"><p>{playbackError}</p><button type="button" className="media-action" onClick={()=>{setPlaybackError("");setTime(t=>({...t,current:0,playing:false}));player.current?.load();}}>{t("미디어 다시 불러오기")}</button></div>}
      <div className="audio-row">
        <button
          type="button"
          className="audio-button"
          aria-label={time.playing ? t("일시정지") : t("재생")}
          onClick={() => {
            const a = player.current;
            if (a) {
              if (a.paused) {
                setPlaybackError("");
                void a.play().catch(reason=>{
                  if(player.current===a&&reason?.name!=="AbortError")setPlaybackError(t("재생을 시작하지 못했습니다. 다시 시도해 주세요."));
                });
              }
              else a.pause();
            }
          }}
        >
          {time.playing ? <Pause size={16} weight="fill" aria-hidden /> : <Play size={16} aria-hidden />}
        </button>
        <div className="audio-body">
          <div className="audio-top">
            <span className="audio-title">{title || t("오디오")}</span>
            <span className="audio-time">
              {clock(time.current)} / {clock(total)}
            </span>
          </div>
          <Wave peaks={shown} progress={total ? time.current / total : 0} tone="play" onSeek={seek} />
        </div>
      </div>
    </NodeViewWrapper>
  );
}
