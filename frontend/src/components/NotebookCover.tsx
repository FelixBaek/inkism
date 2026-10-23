import React, { useEffect, useRef, useState } from "react";
import { api } from "../api";
import type { NotebookCover, UnsplashPhoto } from "../types";
import { ChevronLeft, ChevronRight, Image as ImageIcon, Loader2, Search, Trash2, Upload } from "../icons";
import "./NotebookCover.css";
import { t } from "../i18n";

const UNSPLASH_HOME = "https://unsplash.com/?utm_source=inkism&utm_medium=referral";
const NO_KEY = t("사진 검색을 쓰려면 설정 > 사진 검색에 Unsplash 키를 넣어 주세요");
/** /api/attachments GET은 ?preview=1일 때만 검사한 래스터 이미지를 인라인으로 보낸다. */
const IMAGE_TYPES = "image/png,image/jpeg,image/gif,image/webp";
const MAX_COVER_BYTES = 32 << 20;

export const coverSrc = (cover: NotebookCover, small = false) => {
  if (cover.kind === "attachment") return cover.url + "?preview=1";
  return small ? cover.thumb : cover.url;
};

/** Unsplash 표기 규칙: 작가 프로필과 Unsplash에 referral 링크. */
export function CoverCredit({ cover, className = "" }: Readonly<{ cover: NotebookCover; className?: string }>) {
  if (cover.kind !== "unsplash") return null;
  return (
    <small className={`cover-credit ${className}`}>
      {t("사진:")}{" "}
      <a href={cover.author_url} target="_blank" rel="noopener noreferrer">
        {cover.author}
      </a>
      {" · "}
      <a href={UNSPLASH_HOME} target="_blank" rel="noopener noreferrer">
        Unsplash
      </a>
    </small>
  );
}

/** 폴더 머리말 위 배너: object-fit cover + 아래쪽 바탕색 그라데이션. */
export function CoverBanner({ cover }: Readonly<{ cover: NotebookCover }>) {
  const [broken, setBroken] = useState(false);
  useEffect(() => setBroken(false), [cover.url]);
  if (broken) return null;
  return (
    <div className="cover-banner">
      <img src={coverSrc(cover)} alt="" decoding="async" onError={() => setBroken(true)} />
      <CoverCredit cover={cover} className="cover-banner__credit" />
    </div>
  );
}

/** 폴더 고치기 대화상자의 "표지 사진" 칸: Unsplash 검색, 파일, 빼기. */
export function CoverPicker({
  value,
  onChange,
  onBusy,
}: Readonly<{
  value: NotebookCover | null;
  onChange: (cover: NotebookCover | null) => void;
  onBusy: (busy: boolean) => void;
}>) {
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<{ q: string; page: number; total: number; items: UnsplashPhoto[] } | null>(null);
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const file = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let alive = true;
    api.unsplash
      .status()
      .then((s) => alive && setConfigured(s.configured))
      .catch(() => alive && setConfigured(false));
    return () => {
      alive = false;
    };
  }, []);
  useEffect(() => onBusy(uploading), [uploading, onBusy]);

  const find = async (q: string, page: number) => {
    q = q.trim();
    if (!q || loading) return;
    setLoading(true);
    setStatus(t("찾는 중…"));
    try {
      const res = await api.unsplash.search(q, page);
      setResult({ q, page, total: Math.min(res.total_pages || 1, 50), items: res.items });
      setStatus(res.items.length ? "" : t("맞는 사진이 없어요. 다른 말로 찾아 보세요."));
    } catch (e) {
      const message = e instanceof Error ? e.message : "";
      if (message === "unsplash_key_missing") {
        setConfigured(false);
        setStatus("");
      } else setStatus(t("사진을 찾지 못했어요. {message}", { message }).trim());
    } finally {
      setLoading(false);
    }
  };

  const pick = (p: UnsplashPhoto) => {
    onChange({
      kind: "unsplash",
      url: p.url,
      thumb: p.thumb,
      author: p.author,
      author_url: p.author_url,
      unsplash_id: p.id,
    });
    void api.unsplash.use(p.id).catch(() => {}); // Unsplash 다운로드 집계 규칙
  };

  const upload = async (f: File) => {
    if (!IMAGE_TYPES.split(",").includes(f.type)) {
      setStatus(t("PNG·JPEG·GIF·WebP 이미지만 표지로 쓸 수 있어요."));
      return;
    }
    if (f.size > MAX_COVER_BYTES) {
      setStatus(t("표지 이미지는 32MB 이하로 골라 주세요."));
      return;
    }
    setUploading(true);
    setStatus(t("이미지를 올리는 중…"));
    try {
      const asset = await api.uploadAttachment(f, new AbortController().signal);
      onChange({ kind: "attachment", url: "/api/attachments/" + asset.id });
      setStatus("");
    } catch (e) {
      setStatus(e instanceof Error ? e.message : t("이미지를 올리지 못했어요."));
    } finally {
      setUploading(false);
    }
  };

  const selectedId = value?.kind === "unsplash" ? value.unsplash_id : null;
  return (
    <fieldset className="cover-picker plain-fieldset" aria-labelledby="cover-label">
      <span className="field-label" id="cover-label">
        {t("표지 사진")}
      </span>
      <div className="cover-preview">
        {value ? (
          <img src={coverSrc(value, true)} alt={t("지금 고른 표지 사진")} />
        ) : (
          <span className="cover-preview__empty">
            <ImageIcon size={18} aria-hidden /> {t("표지 사진 없음")}
          </span>
        )}
      </div>
      <div className="cover-row">
        {value ? <CoverCredit cover={value} /> : <span />}
        <span className="cover-row__actions">
          <button
            type="button"
            className="btn btn-small"
            disabled={uploading}
            onClick={() => file.current?.click()}
            aria-label={t("파일에서 표지 사진 고르기")}
          >
            {uploading ? <Loader2 size={14} aria-hidden className="spin" /> : <Upload size={14} aria-hidden />}{" "}
            {t("파일에서 고르기")}
          </button>
          <button
            type="button"
            className="btn btn-small"
            disabled={!value || uploading}
            onClick={() => onChange(null)}
            aria-label={t("표지 사진 빼기")}
          >
            <Trash2 size={14} aria-hidden /> {t("사진 빼기")}
          </button>
        </span>
        <input
          ref={file}
          type="file"
          accept={IMAGE_TYPES}
          hidden
          aria-hidden="true"
          tabIndex={-1}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void upload(f);
            e.target.value = "";
          }}
        />
      </div>

      {configured === false && <p className="cover-note">{NO_KEY}</p>}
      {configured && (
        <>
          <div className="cover-search">
            <Search size={14} aria-hidden className="cover-search__icon" />
            <input
              type="search"
              className="text-field"
              value={query}
              maxLength={100}
              aria-label={t("Unsplash 사진 검색")}
              placeholder={t("Unsplash에서 찾기 (영어로 찾으면 더 많아요)")}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  void find(query, 1);
                }
              }}
            />
            <button
              type="button"
              className="btn"
              disabled={!query.trim() || loading}
              onClick={() => void find(query, 1)}
            >
              {t("찾기")}
            </button>
          </div>
          {result && result.items.length > 0 && (
            <>
              <div className="cover-grid" aria-label={t("Unsplash 사진 결과")} aria-busy={loading}>
                {result.items.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    className={`cover-thumb${p.id === selectedId ? " is-selected" : ""}`}
                    aria-pressed={p.id === selectedId}
                    aria-label={`${p.alt || t("사진")} · ${p.author}`}
                    title={`${p.alt ? p.alt + " · " : ""}${p.author}`}
                    onClick={() => pick(p)}
                  >
                    <img src={p.thumb} alt="" loading="lazy" />
                  </button>
                ))}
              </div>
              <div className="cover-pager">
                <button
                  type="button"
                  className="btn btn-small"
                  disabled={loading || result.page <= 1}
                  onClick={() => void find(result.q, result.page - 1)}
                  aria-label={t("이전 사진 페이지")}
                >
                  <ChevronLeft size={14} aria-hidden /> {t("이전")}
                </button>
                <span>
                  {result.page} / {result.total}
                </span>
                <button
                  type="button"
                  className="btn btn-small"
                  disabled={loading || result.page >= result.total}
                  onClick={() => void find(result.q, result.page + 1)}
                  aria-label={t("다음 사진 페이지")}
                >
                  {t("다음")} <ChevronRight size={14} aria-hidden />
                </button>
              </div>
            </>
          )}
        </>
      )}
      {status && (
        <p className="cover-note">
          <output>{status}</output>
        </p>
      )}
    </fieldset>
  );
}

function keySavedMessage(next: string | null, configured: boolean) {
  if (next) return t("키를 저장했어요.");
  return configured ? t("저장한 키를 지웠어요. 환경 변수 키는 남아 있어요.") : t("키를 지웠어요.");
}

function keyStateLabel(configured: boolean | null) {
  if (configured === null) return t("확인할 수 없어요");
  return configured ? t("키 있음") : t("키 없음");
}

/** 설정 > 사진 검색: 키는 셸로 한 번만 보내고, 돌려받는 것은 설정 여부뿐이다. */
export function UnsplashKeySettings() {
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [key, setKey] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api.unsplash
      .status()
      .then((s) => setConfigured(s.configured))
      .catch(() => setConfigured(null));
  }, []);
  const save = async (next: string | null) => {
    setBusy(true);
    setMessage("");
    try {
      const s = await api.unsplash.setKey(next);
      setConfigured(s.configured);
      setKey("");
      setMessage(keySavedMessage(next, s.configured));
    } catch (e) {
      setMessage(e instanceof Error ? e.message : t("저장하지 못했어요."));
    } finally {
      setBusy(false);
    }
  };
  return (
    <form
      className="unsplash-key"
      onSubmit={(e) => {
        e.preventDefault();
        if (key.trim()) void save(key.trim());
      }}
    >
      <span className="unsplash-key__state">{keyStateLabel(configured)}</span>
      <input
        type="password"
        className="text-field"
        value={key}
        autoComplete="off"
        spellCheck={false}
        aria-label="Unsplash Access Key"
        placeholder={configured ? t("새 키로 바꾸기") : "Unsplash Access Key"}
        onChange={(e) => setKey(e.target.value)}
      />
      <button type="submit" className="btn" disabled={busy || !key.trim()}>
        {configured ? t("바꾸기") : t("저장")}
      </button>
      <button
        type="button"
        className="btn"
        disabled={busy || !configured}
        onClick={() => void save(null)}
        aria-label={t("Unsplash 키 지우기")}
      >
        {t("지우기")}
      </button>
      {message && (
        <small>
          <output>{message}</output>
        </small>
      )}
    </form>
  );
}
