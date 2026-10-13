/** Engine protocol v1 (.private/docs/protocol.md) 타입 정의. 날짜는 Unix 밀리초 정수. */

export type ContentFormat = "text" | "html" | "markdown";

export interface Note {
  id: string;
  title: string;
  content: string; // Exact source bytes decoded as UTF-8.
  content_format?: ContentFormat; // Missing legacy responses are HTML.
  text: string; // 추출된 일반 텍스트
  notebook_id: string | null;
  notebook_ids?: string[]; // Schema 11: first is the legacy primary notebook.
  tags: string[];
  favorite: boolean;
  pinned: boolean;
  readonly?: boolean; // Absent on legacy responses; no screen/menu change.
  archived: boolean;
  trashed: boolean;
  color: string;
  reminder_at: number | null;
  reminder_repeat_hours?: number | null;
  created_at: number;
  updated_at: number;
  edited_at?: number; // Title/body edit time; absent on legacy responses.
  revision: number;
}

export type Summary = Omit<Note, "content" | "text"> & { preview: string };

export interface DocumentFindResult {
  ready: boolean;
  revision: number;
  items: { ordinal: number; snippet: string }[];
  next_offset: number | null;
}

/** Body-free metadata. Null counts mean the background layout is not current. */
export interface DocumentInfo {
  revision: number;
  summary: Summary;
  ready: boolean;
  total_blocks: number | null;
  total_bytes: number | null;
}

export interface SegmentAncestor {
  tag: string;
  open: string;
  prelude?: string;
}
export interface DocumentSegment {
  ordinal: number;
  byte_offset: number;
  source: string;
  start_context: SegmentAncestor[];
  end_context: SegmentAncestor[];
}
export interface DocumentSegmentPage {
  ready: boolean;
  supported?: boolean;
  revision: number;
  ordinal: number;
  block_bytes?: number;
  total_segments: number | null;
  segments: DocumentSegment[];
  next_offset: number | null;
}
export interface DocumentBlock {
  ordinal: number;
  /** UTF-8 bytes in canonical HTML, not JavaScript string positions. */
  byte_offset: number;
  html: string;
}
export interface DocumentBlockPage {
  ready: boolean;
  revision: number;
  summary: Summary | null;
  blocks: DocumentBlock[];
  total_blocks: number | null;
  total_bytes: number | null;
  next_offset: number | null;
  oversized_block?: boolean;
  /** No source bytes were read for this block. Never treat it as empty HTML. */
  oversized?: { ordinal: number; byte_offset: number; byte_count: number } | null;
}

export interface Notebook {
  id: string;
  name: string;
  color: string;
  parent_id?: string | null;
  description?: string;
  /** 표지 사진 (엔진 schema 15). 없으면 null. */
  cover?: NotebookCover | null;
}

/** 폴더 표지: Unsplash 사진(핫링크 + 작가 표기) 또는 이 기기에 올린 첨부 이미지. */
export type NotebookCover =
  | { kind: "unsplash"; url: string; thumb: string; author: string; author_url: string; unsplash_id: string }
  | { kind: "attachment"; url: string };

export interface UnsplashPhoto {
  id: string;
  url: string;
  thumb: string;
  alt?: string;
  author: string;
  author_url: string;
}

/** 폴더·태그 밖에서 만든 새 노트에 붙는 기본값(원본 settings). */
export interface Defaults {
  notebook_id: string | null;
  tag: string | null;
}

export interface TagCount {
  name: string;
  count: number;
}

export interface Stats {
  notes: number;
  favorites: number;
  archive: number;
  trash: number;
}

export interface HistoryEntry {
  label?: string | null;
  id: string;
  note_id: string;
  title: string;
  created_at: number;
  content_format?: ContentFormat;
  /** 그 시점의 노트 revision. revision_body로 본문을 읽어 비교한다. 오래된 기록은 없을 수 있다. */
  note_revision?: number | null;
}

export interface ListResult {
  items: Summary[];
  next_cursor: string | null;
}

export type View =
  | { type: "all" }
  | { type: "favorites" }
  | { type: "archive" }
  | { type: "trash" }
  | { type: "notebook"; id: string }
  | { type: "tag"; name: string };

/** 편집 중인 노트의 단일 진실 원본(메모리에만 존재, localStorage 사용 금지). */
export interface Draft {
  timestampTitle?: string;
  content_format?: ContentFormat;
  readonly?: boolean;
  readonlyRevision?: number; // Permission receipt; never used as body/save revision.
  id: string;
  title: string;
  content: string;
  text: string;
  notebook_id: string | null;
  tags: string[];
  revision: number;
  /** 아직 한 번도 저장되지 않은 새 노트인지 */
  isNew: boolean;
  /** 원문(소스) 모드에서 본문이 바뀌어 text를 다시 뽑아야 하는지 */
  textDirty: boolean;
  textStats?: { words: number; chars: number };
  /** A partial draft has no full content/text; use this queue for body writes. */
  paged?: import("./lib/paged-edit-queue").PagedEditQueue;
  windowEdit?: import("./lib/body-splice").WindowBodyEdit;
}

export interface BacklinkItem {
  id: string;
  title: string;
  preview?: string;
}

export interface AppInfo {
  draft_journal?: boolean;
  native_encrypted_copy?: boolean;
  native_open_library?: boolean;
  windowed_editor?: boolean;
  lazy_editor?: boolean;
  name: string;
  version: string;
  platform: string;
}

export const LARGE_BYTES = 200 * 1024; // ~200KB
export const LARGE_LINES = 2000;

/** DOM 파싱 없이 문자열 검사만으로 대용량 문서 판별. */
export function isLargeDocument(content: string): boolean {
  if (!content) return false;
  if (content.length > LARGE_BYTES) return true;
  let lines = 1;
  for (let i = 0; i < content.length; i++) {
    if (content.codePointAt(i) === 10) {
      lines++;
      if (lines > LARGE_LINES) return true;
    }
  }
  return false;
}

export function countLines(content: string): number {
  if (!content) return 0;
  let lines = 1;
  for (let i = 0; i < content.length; i++) {
    if (content.codePointAt(i) === 10) lines++;
  }
  return lines;
}
