import React, { useEffect, useMemo, useRef, useState } from "react";
import { GraphIcon, TableIcon, LinkIcon, MagnifyingGlassIcon } from "@phosphor-icons/react";
import { createPortal } from "react-dom";
import { X, FileText } from "../icons";
import { useStore } from "../store";
import { t, lang } from "../i18n";
import { api, rpc } from "../api";
import {
  knowledge,
  displayProperty,
  filterView,
  groupView,
  initialPropertyValue,
  graphLayout,
  graphNeighborhood,
  type GraphData,
  type KnowledgeItem,
  type NoteKnowledge,
  type NoteProperty,
  type SavedView,
  type KnowledgeSettings,
} from "../lib/knowledge";
import { AttachmentPropertyEditor } from "./AttachmentPropertyEditor";
import { PropertyValueEditor } from "./PropertyValueEditor";
import { NoteConnections } from "./NoteConnections";
import "./KnowledgeTools.css";
import { CollectionManager } from "./CollectionManager";
import { calculate, aggregate } from "../lib/collection-calculation";

const rowKeys = new WeakMap<object, string>();
function rowKey(row: object): string {
  let key = rowKeys.get(row);
  if (!key) {
    key = crypto.randomUUID();
    rowKeys.set(row, key);
  }
  return key;
}
function rowPatch<T extends object>(row: T, patch: Partial<T>): T {
  const next = { ...row, ...patch };
  rowKeys.set(next, rowKey(row));
  return next;
}
function knowledgePanelTitle(panel: string) {
  if (panel === "graph") return t("관계 그래프");
  if (panel === "views") return t("노트 모아보기");
  return t("속성과 노트 연결");
}
function propertyInputType(type: NoteProperty["type"]) {
  if (type === "number") return "number";
  return type === "date" ? "date" : "text";
}
function propertyInputValue(type: NoteProperty["type"], value: string) {
  return type === "number" && value !== "" ? Number(value) : value;
}
function PropertyInput({
  property,
  items,
  onChange,
}: Readonly<{ property: NoteProperty; items: KnowledgeItem[]; onChange: (patch: Partial<NoteProperty>) => void }>) {
  if (property.type === "attachment")
    return <AttachmentPropertyEditor value={String(property.value)} onChange={(value) => onChange({ value })} />;
  if (["select", "multiselect", "relation"].includes(property.type))
    return <PropertyValueEditor property={property} items={items} onChange={onChange} />;
  if (property.type === "checkbox")
    return (
      <input
        type="checkbox"
        aria-label={t("속성 값")}
        checked={property.value === true}
        onChange={(e) => onChange({ value: e.target.checked })}
      />
    );
  if (["list", "person"].includes(property.type))
    return <ListPropertyValue value={property.value as string[]} onChange={(value) => onChange({ value })} />;
  return (
    <input
      aria-label={t("속성 값")}
      type={propertyInputType(property.type)}
      step="any"
      value={displayProperty(property.value)}
      onChange={(e) => onChange({ value: propertyInputValue(property.type, e.target.value) })}
    />
  );
}
function configuredLanes(property: NoteProperty): string[] {
  if (property.type === "checkbox") return ["false", "true"];
  if (property.type === "select") return ["", ...(property.options ?? [])];
  return property.type === "text" ? [String(property.value)] : [];
}
function formulaError(error: string) {
  if (error === "missing") return t("수식: 속성이 없거나 자료형이 맞지 않음");
  if (error === "zero") return t("수식: 0으로 나눌 수 없음");
  if (error === "limit") return t("수식: 계산 범위 초과");
  return t("수식: 문법 오류");
}
function moveValues(property: NoteProperty | undefined, items: KnowledgeItem[], groupBy: string | undefined) {
  if (property?.type === "checkbox") return ["false", "true"];
  if (property?.type === "select") return ["", ...(property.options ?? [])];
  return Array.from(
    new Set(["", ...items.map((item) => displayProperty(item.properties.find((p) => p.name === groupBy)?.value))]),
  );
}

export const KNOWLEDGE_EVENT = "inkism-open-knowledge";
type Panel = "graph" | "views" | "note";
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
const formatDate = (ms: number) => new Date(ms).toLocaleDateString(lang, { month: "long", day: "numeric" });
export function KnowledgeTools() {
  const s = useStore(),
    dialog = useRef<HTMLDialogElement>(null);
  const [panel, setPanel] = useState<Panel | null>(null);
  useEffect(() => {
    const open = (e: Event) => setPanel((e as CustomEvent<Panel>).detail || "note");
    window.addEventListener(KNOWLEDGE_EVENT, open);
    return () => window.removeEventListener(KNOWLEDGE_EVENT, open);
  }, []);
  // 관계 그래프·노트 모아보기는 셸 안 화면이고, 속성과 노트 연결만 대화상자다.
  useEffect(() => {
    if (panel === "note") dialog.current?.showModal();
    else dialog.current?.close();
  }, [panel]);
  // 사이드바에서 다른 보기로 가면 모아보기 화면을 닫는다.
  const viewKey = JSON.stringify(s.view);
  useEffect(() => setPanel((p) => (p === "views" ? null : p)), [viewKey]);
  const host = panel === "views" ? document.querySelector(".app-content") : null;
  const close = () => setPanel(null);
  useEffect(() => {
    window.addEventListener("inkism-close-knowledge", close);
    return () => window.removeEventListener("inkism-close-knowledge", close);
  }, []);
  return (
    <>
      <div className="knowledge-actions">
        <button
          type="button"
          className="icon-btn"
          title={t("관계 그래프")}
          aria-label={t("관계 그래프")}
          onClick={() => setPanel("graph")}
        >
          <GraphIcon size={17} />
        </button>
        <button
          type="button"
          className="icon-btn"
          title={t("노트 모아보기")}
          aria-label={t("노트 모아보기")}
          onClick={() => setPanel("views")}
        >
          <TableIcon size={17} />
        </button>
        <button
          type="button"
          className="icon-btn"
          title={t("속성과 노트 연결")}
          aria-label={t("속성과 노트 연결")}
          disabled={!s.note}
          onClick={() => setPanel("note")}
        >
          <LinkIcon size={17} />
        </button>
      </div>
      <dialog ref={dialog} className="knowledge-dialog" aria-label={t("지식 도구")} onCancel={close}>
        <header>
          <nav aria-label={t("지식 도구")}>
            {(["graph", "views", "note"] as Panel[]).map((p) => (
              <button
                type="button"
                key={p}
                disabled={p === "note" && !s.note}
                aria-pressed={panel === p}
                onClick={() => setPanel(p)}
              >
                {knowledgePanelTitle(p)}
              </button>
            ))}
          </nav>
          <button type="button" className="icon-btn" aria-label={t("닫기")} onClick={close}>
            <X size={16} />
          </button>
        </header>
        <div className="knowledge-body">
          {panel === "note" && s.note && (
            <>
              <h2>{s.note.title || t("제목 없음")}</h2>
              <PropertyEditor key={s.note.id} />
              <NoteConnections key={`links-${s.note.id}`} onClose={close} />
            </>
          )}
        </div>
      </dialog>
      {panel === "graph" && <GraphScreen onClose={close} />}
      {panel === "views" && (host ? createPortal(<NoteViews onClose={close} />, host) : <NoteViews onClose={close} />)}
    </>
  );
}

export function PropertyEditor() {
  const s = useStore(),
    id = s.note?.id;
  const [items, setItems] = useState<KnowledgeItem[]>([]);
  useEffect(() => {
    let live = true;
    knowledge
      .list()
      .then((d) => {
        if (live) setItems(d.items);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);
  const [data, setData] = useState<NoteKnowledge | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [saved, setSaved] = useState(false),
    [aliasText, setAliasText] = useState("");
  useEffect(() => {
    let live = true;
    if (id)
      knowledge
        .get(id)
        .then((d) => {
          if (live) {
            setData(d);
            setAliasText(d.aliases.join(", "));
          }
        })
        .catch((e) => {
          if (live) setError(message(e));
        });
    return () => {
      live = false;
    };
  }, [id]);
  const change = (next: NoteKnowledge) => {
    setData(next);
    setSaved(false);
  };
  const save = async () => {
    if (!data || !id || busy) return;
    setBusy(true);
    setError("");
    try {
      if (!(await s.flushNow())) throw new Error(t("먼저 노트를 저장해 주세요."));
      const current = s.readDraft();
      if (current?.id !== id) throw new Error(t("선택한 노트가 바뀌었습니다."));
      setData(
        await knowledge.set(
          {
            ...data,
            aliases:
              aliasText === data.aliases.join(", ")
                ? data.aliases
                : aliasText
                    .split(",")
                    .map((x) => x.trim())
                    .filter(Boolean),
          },
          current.revision,
        ),
      );
      setSaved(true);
      window.dispatchEvent(new Event("inkism-knowledge-changed"));
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  };
  const update = (index: number, patch: Partial<NoteProperty>) =>
    data && change({ ...data, properties: data.properties.map((p, i) => (i === index ? rowPatch(p, patch) : p)) });
  return (
    <section className="knowledge-properties">
      <h3>{t("별칭과 사용자 속성")}</h3>
      {error && <p role="alert">{error}</p>}
      {!data && !error && (
        <p>
          <output>{t("불러오는 중…")}</output>
        </p>
      )}
      {data && (
        <fieldset disabled={busy || Boolean(s.draft?.readonly)} className="plain-fieldset">
          <label>
            {t("별칭 (쉼표로 구분)")}
            <input
              aria-label={t("별칭 (쉼표로 구분)")}
              value={aliasText}
              onChange={(e) => {
                setAliasText(e.target.value);
                setSaved(false);
              }}
            />
          </label>
          <div className="knowledge-property-list">
            {data.properties.map((property, index) => (
              <div className="knowledge-property" key={rowKey(property)}>
                <input
                  disabled={!!property.definition_id}
                  aria-label={t("속성 이름")}
                  value={property.name}
                  maxLength={80}
                  onChange={(e) => update(index, { name: e.target.value })}
                />
                <select
                  disabled={!!property.definition_id}
                  aria-label={t("속성 종류")}
                  value={property.type}
                  onChange={(e) =>
                    update(index, {
                      type: e.target.value as NoteProperty["type"],
                      value: initialPropertyValue(e.target.value as NoteProperty["type"]),
                      options: ["select", "multiselect"].includes(e.target.value) ? [] : undefined,
                    })
                  }
                >
                  {(
                    [
                      "text",
                      "number",
                      "date",
                      "checkbox",
                      "list",
                      "select",
                      "multiselect",
                      "person",
                      "relation",
                      "attachment",
                    ] as const
                  ).map((type, i) => (
                    <option key={type} value={type}>
                      {t(
                        [
                          "텍스트",
                          "숫자",
                          "날짜",
                          "체크박스",
                          "목록",
                          "단일 선택",
                          "다중 선택",
                          "사람",
                          "노트 관계",
                          "첨부 이미지",
                        ][i],
                      )}
                    </option>
                  ))}
                </select>
                <PropertyInput property={property} items={items} onChange={(patch) => update(index, patch)} />
                <button
                  type="button"
                  className="btn"
                  aria-label={t("속성 삭제")}
                  onClick={() => change({ ...data, properties: data.properties.filter((_, i) => i !== index) })}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
          <div className="knowledge-row">
            <button
              type="button"
              className="btn"
              disabled={data.properties.length >= 64}
              onClick={() =>
                change({ ...data, properties: [...data.properties, { name: "", type: "text", value: "" }] })
              }
            >
              {t("속성 추가")}
            </button>
            <button type="button" className="btn" onClick={() => void save()}>
              {t("속성 저장")}
            </button>
            {saved && (
              <p>
                <output>{t("저장됨")}</output>
              </p>
            )}
          </div>
        </fieldset>
      )}
    </section>
  );
}

function ListPropertyValue({ value, onChange }: Readonly<{ value: string[]; onChange: (value: string[]) => void }>) {
  const [raw, setRaw] = useState(value.join(", "));
  useEffect(() => setRaw(value.join(", ")), [value]);
  return (
    <input
      aria-label={t("속성 값")}
      value={raw}
      onChange={(e) => setRaw(e.target.value)}
      onBlur={() => {
        if (raw !== value.join(", "))
          onChange(
            raw
              .split(",")
              .map((x) => x.trim())
              .filter(Boolean),
          );
      }}
    />
  );
}

/** Full-height graph screen drawn over the list and editor; they stay mounted underneath so drafts are untouched. */
function GraphScreen({ onClose }: { onClose: () => void }) {
  const [host] = useState(() => document.querySelector<HTMLElement>(".app-content"));
  useEffect(() => {
    if (!host) return;
    const siblings = Array.from(host.children).filter((el) => !el.classList.contains("graph-screen"));
    siblings.forEach((el) => el.setAttribute("inert", ""));
    return () => siblings.forEach((el) => el.removeAttribute("inert"));
  }, [host]);
  const screenRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      const target = event.target;
      if (
        event.key === "Escape" &&
        target instanceof Element &&
        screenRef.current?.contains(target) &&
        !target.closest("input,select")
      ) {
        event.preventDefault();
        onClose();
      }
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);
  const s = useStore(),
    view = useRef(s.view);
  // Sidebar navigation or opening a note elsewhere leaves the graph.
  useEffect(() => {
    if (view.current !== s.view) onClose();
  }, [s.view]);
  const screen = (
    <section ref={screenRef} className="graph-screen" aria-label={t("관계 그래프")}>
      <NoteGraph onClose={onClose} />
    </section>
  );
  return host ? createPortal(screen, host) : screen;
}

function NoteGraph({ onClose }: Readonly<{ onClose: () => void }>) {
  const s = useStore(),
    [data, setData] = useState<GraphData | null>(null),
    [error, setError] = useState(""),
    [query, setQuery] = useState(""),
    [tag, setTag] = useState(""),
    [local, setLocal] = useState(false),
    [depth, setDepth] = useState(1),
    [orphans, setOrphans] = useState(true),
    [attempt, setAttempt] = useState(0);
  const [zoom, setZoom] = useState(1),
    [pan, setPan] = useState({ x: 0, y: 0 });
  const drag = useRef<{ x: number; y: number; px: number; py: number } | null>(null);
  const [picked, setPicked] = useState<string | null>(s.note?.id ?? null),
    [panel, setPanel] = useState(true),
    [info, setInfo] = useState<{ id: string; notebook: string } | null>(null);
  const search = useRef<HTMLInputElement>(null);
  useEffect(() => {
    let live = true;
    setError("");
    (async () => {
      if (!(await s.flushNow())) throw new Error(t("먼저 노트를 저장해 주세요."));
      await rpc("wait_index");
      return knowledge.graph();
    })()
      .then((d) => {
        if (live) setData(d);
      })
      .catch((e) => {
        if (live) setError(message(e));
      });
    return () => {
      live = false;
    };
  }, [attempt]);
  const subset = useMemo(() => {
    if (!data) return { nodes: [], edges: [], total: 0 };
    const neighborhood = local && s.note ? graphNeighborhood(data, s.note.id, depth) : null;
    const connected = new Set(data.edges.flatMap((e) => [e.source, e.target]));
    const all = data.nodes.filter(
      (n) =>
        (!neighborhood || neighborhood.has(n.id)) &&
        (!tag || n.tags.includes(tag)) &&
        (orphans || connected.has(n.id)) &&
        [n.title, ...n.aliases].some((x) => x.toLocaleLowerCase().includes(query.toLocaleLowerCase())),
    );
    const nodes = all.slice(0, 250),
      ids = new Set(nodes.map((n) => n.id));
    return { nodes, edges: data.edges.filter((e) => ids.has(e.source) && ids.has(e.target)), total: all.length };
  }, [data, local, s.note?.id, depth, tag, query, orphans]);
  const positions = useMemo(() => graphLayout(subset.nodes, subset.edges), [subset]);
  const byId = new Map(positions.map((n) => [n.id, n]));
  const selected = data?.nodes.find((n) => n.id === picked) ?? null;
  const linked = useMemo(() => {
    if (!data || !picked) return [];
    const ids = new Set(
      data.edges.flatMap((e) => {
        if (e.source === picked) return [e.target];
        return e.target === picked ? [e.source] : [];
      }),
    );
    return data.nodes.filter((n) => ids.has(n.id));
  }, [data, picked]);
  useEffect(() => {
    let live = true;
    if (picked)
      api
        .documentInfo(picked)
        .then((d) => {
          if (live)
            setInfo({
              id: picked,
              notebook: latest.current.notebooks.find((n) => n.id === d.summary.notebook_id)?.name ?? "",
            });
        })
        .catch(() => {});
    return () => {
      live = false;
    };
  }, [picked]);
  const latest = useRef(s);
  latest.current = s;
  const open = async (id: string) => {
    try {
      if (!(await s.flushNow())) return;
      onClose();
      await s.selectNote(id);
    } catch (e) {
      setError(message(e));
    }
  };
  const nodeTitle = (n: { title: string }) => n.title || t("제목 없음");
  const tags = Array.from(new Set(data?.nodes.flatMap((n) => n.tags) ?? [])).sort((a, b) => a.localeCompare(b));
  return (
    <div className="graph-layout">
      <div className="graph-main">
        <div className="graph-toolbar">
          <select
            className="graph-scope"
            aria-label={t("표시 범위")}
            value={local ? "local" : "all"}
            onChange={(e) => setLocal(e.target.value === "local")}
          >
            <option value="all">{t("전체")}</option>
            <option value="local" disabled={!s.note}>
              {t("현재 노트 주변")}
            </option>
          </select>
          <select aria-label={t("그래프 태그")} value={tag} onChange={(e) => setTag(e.target.value)}>
            <option value="">{t("모든 태그")}</option>
            {tags.map((x) => (
              <option key={x} value={x}>
                {t("태그: {name}", { name: x })}
              </option>
            ))}
          </select>
          <select
            aria-label={t("연결 깊이")}
            value={depth}
            disabled={!local}
            onChange={(e) => setDepth(Number(e.target.value))}
          >
            {[1, 2, 3].map((x) => (
              <option key={x} value={x}>
                {t("깊이: {count}", { count: x })}
              </option>
            ))}
          </select>
          <input
            ref={search}
            aria-label={t("그래프 검색")}
            placeholder={t("노트 찾기")}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <label className="graph-orphans">
            <input type="checkbox" checked={orphans} onChange={(e) => setOrphans(e.target.checked)} />
            {t("연결 없는 노트")}
          </label>
          <span className="graph-spacer" />
          <button
            type="button"
            className="icon-btn"
            aria-label={t("그래프 검색")}
            onClick={() => search.current?.focus()}
          >
            <MagnifyingGlassIcon size={16} />
          </button>
          <button
            type="button"
            className="graph-ghost"
            aria-label={t("그래프 축소")}
            onClick={() => setZoom((z) => Math.max(0.5, z / 1.25))}
          >
            −
          </button>
          <button
            type="button"
            className="graph-ghost"
            aria-label={t("그래프 확대")}
            onClick={() => setZoom((z) => Math.min(4, z * 1.25))}
          >
            +
          </button>
          <button
            type="button"
            className="graph-ghost"
            onClick={() => {
              setZoom(1);
              setPan({ x: 0, y: 0 });
            }}
          >
            {t("위치 초기화")}
          </button>
          <button type="button" className="graph-ghost" onClick={() => setAttempt((x) => x + 1)}>
            {t("새로고침")}
          </button>
          <button type="button" className="icon-btn" aria-label={t("관계 그래프 닫기")} onClick={onClose}>
            <X size={16} />
          </button>
        </div>
        {(error || !data || data.truncated || subset.total > 250) && (
          <div className="graph-notices">
            {error && <p role="alert">{error}</p>}
            {!data && !error && (
              <p>
                <output>{t("불러오는 중…")}</output>
              </p>
            )}
            {data?.truncated && (
              <p>
                <output>{t("큰 보관함의 일부만 불러왔습니다.")}</output>
              </p>
            )}
            {subset.total > 250 && (
              <p>
                <output>{t("그래프는 250개까지 표시합니다. 검색이나 태그로 범위를 좁혀 주세요.")}</output>
              </p>
            )}
          </div>
        )}
        <fieldset
          className="note-graph semantic-group"
          aria-label={t("노트 연결 지도")}
          onPointerDown={(e) => {
            if ((e.target as Element).closest("[data-node]")) return;
            drag.current = { x: e.clientX, y: e.clientY, px: pan.x, py: pan.y };
            e.currentTarget.setPointerCapture(e.pointerId);
          }}
          onPointerMove={(e) => {
            if (!drag.current) return;
            setPan({
              x: drag.current.px + e.clientX - drag.current.x,
              y: drag.current.py + e.clientY - drag.current.y,
            });
          }}
          onPointerUp={() => {
            drag.current = null;
          }}
          onPointerCancel={() => {
            drag.current = null;
          }}
        >
          <div className="note-graph-scene" style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }}>
            <svg viewBox="0 0 800 560" preserveAspectRatio="none" aria-hidden="true">
              {subset.edges.map((e) => {
                const a = byId.get(e.source)!,
                  b = byId.get(e.target)!;
                return (
                  <line
                    key={`${e.source}:${e.target}`}
                    x1={a.x}
                    y1={a.y}
                    x2={b.x}
                    y2={b.y}
                    stroke="var(--border-strong)"
                    vectorEffect="non-scaling-stroke"
                  />
                );
              })}
            </svg>
            {positions.map((n) => (
              <button
                type="button"
                key={n.id}
                data-node={n.id}
                className="graph-node"
                aria-pressed={n.id === picked}
                aria-current={n.id === s.note?.id ? "page" : undefined}
                title={nodeTitle(n)}
                style={{ left: `${n.x / 8}%`, top: `${n.y / 5.6}%` }}
                aria-label={t("노트 선택: {title}", { title: nodeTitle(n) })}
                onClick={() => {
                  setPicked(n.id);
                  setPanel(true);
                }}
                onDoubleClick={() => void open(n.id)}
              >
                <FileText size={16} aria-hidden />
                <span>{nodeTitle(n)}</span>
              </button>
            ))}
          </div>
        </fieldset>
        <details className="graph-list">
          <summary>
            {t("노트 목록으로 보기")} · {t("노트 {count}개", { count: subset.total })} ·{" "}
            {t("연결 {count}개", { count: subset.edges.length })}
          </summary>
          <div className="knowledge-link-list">
            {subset.nodes.map((n) => (
              <button className="btn" key={n.id} onClick={() => void open(n.id)}>
                {nodeTitle(n)}
              </button>
            ))}
          </div>
        </details>
      </div>
      {panel && (
        <aside className="graph-panel" aria-labelledby="graph-panel-title">
          <header>
            <h2 id="graph-panel-title">{t("선택한 노트")}</h2>
            <button
              type="button"
              className="icon-btn"
              aria-label={t("선택한 노트 패널 닫기")}
              onClick={() => setPanel(false)}
            >
              <X size={16} />
            </button>
          </header>
          {selected ? (
            <>
              <section>
                <h3>{nodeTitle(selected)}</h3>
                <dl>
                  <div>
                    <dt>{t("폴더")}</dt>
                    <dd>{info?.id === selected.id && info.notebook ? info.notebook : t("없음")}</dd>
                  </div>
                  <div>
                    <dt>{t("태그")}</dt>
                    <dd>{selected.tags.join(", ") || t("없음")}</dd>
                  </div>
                </dl>
                <button type="button" className="btn" onClick={() => void open(selected.id)}>
                  {t("노트 열기")}
                </button>
              </section>
              <section>
                <h3>
                  {t("연결된 노트")} · {linked.length}
                </h3>
                <ul>
                  {linked.map((n) => (
                    <li key={n.id}>
                      <button type="button" onClick={() => setPicked(n.id)}>
                        <FileText size={16} aria-hidden />
                        <span>{nodeTitle(n)}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            </>
          ) : (
            <section>
              <p className="graph-hint">{t("지도에서 노트를 선택해 주세요.")}</p>
            </section>
          )}
          <section>
            <h3>{t("표시 범위")}</h3>
            <p className="graph-note">
              {local ? t("현재 노트 주변 · {count}단계", { count: depth }) : t("전체 노트")}
              <br />
              {t("표시 상한에 도달하면 범위를 좁혀 주세요.")}
            </p>
          </section>
        </aside>
      )}
    </div>
  );
}

const initialView = (): SavedView => ({
  id: crypto.randomUUID(),
  name: "",
  layout: "table",
  filter: { property: "", operator: "contains", value: "" },
  sort: { property: "$title", direction: "asc" },
});
function CollectionCover({ value }: { value: unknown }) {
  const id =
    typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
      ? value.toLowerCase()
      : "";
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [id]);
  return id && !failed ? (
    <img
      className="knowledge-card-cover"
      src={`/api/attachments/${id}?preview=1`}
      alt={t("카드 표지")}
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
    />
  ) : (
    <span className="knowledge-card-cover-empty">{t("표지 이미지 없음")}</span>
  );
}
function NoteViews({ onClose }: Readonly<{ onClose: () => void }>) {
  const s = useStore(),
    [items, setItems] = useState<KnowledgeItem[]>([]),
    [settings, setSettings] = useState<KnowledgeSettings | null>(null),
    [view, setView] = useState<SavedView>(initialView),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [truncated, setTruncated] = useState(false),
    [page, setPage] = useState(0);
  useEffect(() => {
    let live = true;
    Promise.all([knowledge.list(), knowledge.settings()])
      .then(([list, config]) => {
        if (!live) return;
        setItems(list.items);
        setTruncated(list.truncated);
        setSettings(config);
      })
      .catch((e) => {
        if (live) setError(message(e));
      });
    return () => {
      live = false;
    };
  }, []);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const dragging = useRef<string | null>(null),
    [tool, setTool] = useState<string | null>(null);
  const reload = async (config?: KnowledgeSettings) => {
    const [list, fresh] = await Promise.all([
      knowledge.list(),
      config ? Promise.resolve(config) : knowledge.settings(),
    ]);
    setItems(list.items);
    setTruncated(list.truncated);
    setSettings(fresh);
    setSelected(new Set());
    window.dispatchEvent(new Event("inkism-knowledge-changed"));
  };
  const select = (id: string, checked: boolean) =>
    setSelected((current) => {
      const next = new Set(current);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  const names = Array.from(new Set(items.flatMap((n) => n.properties.map((p) => p.name)))).sort((a, b) =>
    a.localeCompare(b),
  );
  const result = useMemo(() => filterView(items, view), [items, view]);
  const shown = result.slice(page * 50, (page + 1) * 50),
    columns = (view.card?.visible_properties ?? names).slice(0, 32);
  const groups = groupView(shown, view.group_by ?? "");
  // Show empty configured lanes too, so a first card can be dragged into them.
  if (view.layout === "kanban" && view.group_by) {
    const source = items.flatMap((n) => n.properties).filter((p) => p.name === view.group_by);
    const lanes = new Set(source.flatMap(configuredLanes));
    for (const label of lanes) {
      if (!groups.some((g) => g.label === label)) groups.push({ key: `empty:${label}`, label, items: [] });
    }
  }
  const summary = aggregate(result, view, items);
  const formulaText = (expression: string, note: KnowledgeItem) => {
    const result = calculate(expression, note, items);
    return result.error ? formulaError(result.error) : String(result.value);
  };
  const labels = new Map<string, string>(items.map((n) => [n.id, n.title || t("제목 없음")]));
  const display = (p: NoteProperty | undefined) =>
    p?.type === "relation"
      ? (p.value as string[]).map((id) => labels.get(id) ?? t("사용할 수 없는 노트")).join(", ")
      : displayProperty(p?.value);
  const move = async (note: KnowledgeItem, value: string) => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      if (!(await s.flushNow())) throw new Error(t("먼저 노트를 저장해 주세요."));
      const property = note.properties.find((p) => p.name === view.group_by);
      if (!property || !["text", "select", "checkbox"].includes(property.type)) return;
      if (property.type === "checkbox" && !["true", "false"].includes(value)) return;
      const revision = s.readDraft()?.id === note.id ? s.readDraft()!.revision : note.revision;
      const data = await knowledge.set(
        {
          ...note,
          properties: note.properties.map((p) =>
            p === property ? { ...p, value: p.type === "checkbox" ? value === "true" : value } : p,
          ),
        },
        revision,
      );
      setItems((current) => current.map((n) => (n.id === note.id ? { ...n, ...data, revision } : n)));
      window.dispatchEvent(new Event("inkism-knowledge-changed"));
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    setPage(0);
    setSelected(new Set());
  }, [view]);
  useEffect(() => setPage((p) => Math.min(p, Math.max(0, Math.ceil(result.length / 50) - 1))), [result.length]);
  const save = async (remove = false) => {
    if (!settings || busy) return;
    setBusy(true);
    setError("");
    try {
      if (!remove && !view.name.trim()) throw new Error(t("보기 이름을 입력해 주세요."));
      const views = settings.views.filter((v) => v.id !== view.id);
      if (!remove) views.push({ ...view, name: view.name.trim() });
      setSettings(await knowledge.saveSettings({ ...settings, views }));
      if (remove) setView(initialView());
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  };
  const options = (
    <>
      <option value="">{t("조건 없음")}</option>
      <option value="$title">{t("제목")}</option>
      <option value="$tag">{t("태그")}</option>
      <option value="$updated">{t("수정한 날짜")}</option>
      {names.map((n) => (
        <option key={n} value={n}>
          {n}
        </option>
      ))}
    </>
  );
  const folder = (n: KnowledgeItem & { notebook_id?: string | null }) =>
    s.notebooks.find((b) => b.id === n.notebook_id)?.name ?? "";
  const filterCount = (view.filter.property ? 1 : 0) + (view.filters?.length ?? 0);
  return (
    <section className="knowledge-views" aria-label={t("노트 모아보기")}>
      <div className="kv-toolbar">
        <select
          aria-label={t("저장한 보기")}
          value={settings?.views.some((x) => x.id === view.id) ? view.id : ""}
          onChange={(e) => setView(settings?.views.find((v) => v.id === e.target.value) ?? initialView())}
        >
          <option value="">{t("새 보기")}</option>
          {settings?.views.map((v) => (
            <option key={v.id} value={v.id}>
              {v.name}
            </option>
          ))}
        </select>
        <input
          aria-label={t("보기 이름")}
          placeholder={t("보기 이름")}
          value={view.name}
          onChange={(e) => setView({ ...view, name: e.target.value })}
        />
        <fieldset className="kv-layouts semantic-group" aria-label={t("보기 형식")}>
          {(["table", "cards", "kanban"] as const).map((layout, i) => (
            <button
              key={layout}
              type="button"
              aria-pressed={view.layout === layout}
              onClick={() => setView({ ...view, layout })}
            >
              {t(["표", "카드", "칸반"][i])}
            </button>
          ))}
        </fieldset>
        <button
          type="button"
          className="btn kv-tool"
          aria-expanded={tool === "filter"}
          onClick={() => setTool(tool === "filter" ? null : "filter")}
        >
          {filterCount ? t("필터 {count}", { count: filterCount }) : t("필터")}
        </button>
        <button
          type="button"
          className="btn kv-tool"
          aria-expanded={tool === "sort"}
          onClick={() => setTool(tool === "sort" ? null : "sort")}
        >
          {t("정렬")}
        </button>
        <button
          type="button"
          className="btn kv-tool"
          aria-expanded={tool === "group"}
          onClick={() => setTool(tool === "group" ? null : "group")}
        >
          {t("그룹")}
        </button>
        <button
          type="button"
          className="btn kv-tool"
          aria-expanded={tool === "collection"}
          onClick={() => setTool(tool === "collection" ? null : "collection")}
        >
          {t("공통 속성")}
        </button>
        <button
          type="button"
          className="btn kv-tool"
          aria-expanded={tool === "formula"}
          onClick={() => setTool(tool === "formula" ? null : "formula")}
        >
          {t("수식과 집계")}
        </button>
        <button
          type="button"
          className="btn kv-tool"
          aria-expanded={tool === "card"}
          onClick={() => setTool(tool === "card" ? null : "card")}
        >
          {t("표시 속성과 카드 표지")}
        </button>
        <button className="btn btn-primary" disabled={busy || !settings} onClick={() => void save()}>
          {t("보기 저장")}
        </button>
        <button
          className="btn btn-ghost"
          disabled={busy || !settings?.views.some((x) => x.id === view.id)}
          onClick={() => void save(true)}
        >
          {t("보기 삭제")}
        </button>
        <span className="kv-gap" />
        <button type="button" className="icon-btn" aria-label={t("닫기")} onClick={onClose}>
          <X size={16} />
        </button>
      </div>
      <div className="kv-panel" hidden={tool !== "filter"}>
        <div className="knowledge-row">
          <label>
            {t("필터")}
            <select
              aria-label={t("필터 속성")}
              value={view.filter.property}
              onChange={(e) => setView({ ...view, filter: { ...view.filter, property: e.target.value } })}
            >
              {options}
            </select>
          </label>
          <select
            aria-label={t("필터 조건")}
            value={view.filter.operator}
            onChange={(e) =>
              setView({
                ...view,
                filter: { ...view.filter, operator: e.target.value as SavedView["filter"]["operator"] },
              })
            }
          >
            {(["contains", "equals", "gt", "lt", "exists"] as const).map((x, i) => (
              <option key={x} value={x}>
                {t(["포함", "같음", "보다 큼", "보다 작음", "값 있음"][i])}
              </option>
            ))}
          </select>
          <input
            aria-label={t("필터 값")}
            disabled={!view.filter.property || view.filter.operator === "exists"}
            value={view.filter.value}
            onChange={(e) => setView({ ...view, filter: { ...view.filter, value: e.target.value } })}
          />
        </div>
        <div className="knowledge-row">
          <select
            aria-label={t("필터 결합")}
            value={view.filter_mode ?? "all"}
            onChange={(e) => setView({ ...view, filter_mode: e.target.value as "all" | "any" })}
          >
            <option value="all">{t("모든 조건")}</option>
            <option value="any">{t("하나 이상의 조건")}</option>
          </select>
          <button
            className="btn"
            disabled={(view.filters?.length ?? 0) >= 8}
            onClick={() =>
              setView({
                ...view,
                filters: [...(view.filters ?? []), { property: "", operator: "contains", value: "" }],
              })
            }
          >
            {t("조건 추가")}
          </button>
        </div>
        {(view.filters ?? []).map((filter, index) => (
          <div className="knowledge-row" key={rowKey(filter)}>
            <select
              aria-label={t("추가 필터 속성")}
              value={filter.property}
              onChange={(e) =>
                setView({
                  ...view,
                  filters: view.filters!.map((f, i) => (i === index ? rowPatch(f, { property: e.target.value }) : f)),
                })
              }
            >
              {options}
            </select>
            <select
              aria-label={t("추가 필터 조건")}
              value={filter.operator}
              onChange={(e) =>
                setView({
                  ...view,
                  filters: view.filters!.map((f, i) =>
                    i === index ? rowPatch(f, { operator: e.target.value as SavedView["filter"]["operator"] }) : f,
                  ),
                })
              }
            >
              {(["contains", "equals", "gt", "lt", "exists"] as const).map((x, i) => (
                <option key={x} value={x}>
                  {t(["포함", "같음", "보다 큼", "보다 작음", "값 있음"][i])}
                </option>
              ))}
            </select>
            <input
              aria-label={t("추가 필터 값")}
              disabled={!filter.property || filter.operator === "exists"}
              value={filter.value}
              onChange={(e) =>
                setView({
                  ...view,
                  filters: view.filters!.map((f, i) => (i === index ? rowPatch(f, { value: e.target.value }) : f)),
                })
              }
            />
            <button
              className="btn"
              onClick={() => setView({ ...view, filters: view.filters!.filter((_, i) => i !== index) })}
            >
              {t("조건 삭제")}
            </button>
          </div>
        ))}
      </div>
      <div className="kv-panel" hidden={tool !== "sort"}>
        <div className="knowledge-row">
          <label>
            {t("정렬")}
            <select
              aria-label={t("정렬 속성")}
              value={view.sort.property}
              onChange={(e) => setView({ ...view, sort: { ...view.sort, property: e.target.value } })}
            >
              {options}
            </select>
          </label>
          <select
            aria-label={t("정렬 방향")}
            value={view.sort.direction}
            onChange={(e) => setView({ ...view, sort: { ...view.sort, direction: e.target.value as "asc" | "desc" } })}
          >
            <option value="asc">{t("오름차순")}</option>
            <option value="desc">{t("내림차순")}</option>
          </select>
        </div>
      </div>
      <div className="kv-panel" hidden={tool !== "group"}>
        <div className="knowledge-row">
          <label>
            {t("그룹 속성")}
            <select
              aria-label={t("그룹 속성")}
              value={view.group_by ?? ""}
              onChange={(e) => setView({ ...view, group_by: e.target.value })}
            >
              {options}
            </select>
          </label>
        </div>
      </div>
      <div className="kv-panel" hidden={tool !== "collection"}>
        {settings && (
          <CollectionManager
            settings={settings}
            items={items}
            selected={selected}
            onSaved={reload}
            flush={() => s.flushNow()}
          />
        )}
      </div>
      <div className="kv-panel" hidden={tool !== "formula"}>
        <p>
          {t(
            "수식은 속성, 사칙연산, 비교, if, 문자열·날짜 함수와 relation_sum을 지원합니다. 결과는 보기에서만 계산됩니다.",
          )}
        </p>
        {(view.formulas ?? []).map((f, index) => (
          <div className="knowledge-row" key={f.id}>
            <input
              aria-label={t("수식 이름")}
              maxLength={80}
              value={f.name}
              onChange={(e) =>
                setView({
                  ...view,
                  formulas: view.formulas!.map((x, i) => (i === index ? { ...x, name: e.target.value } : x)),
                })
              }
            />
            <input
              aria-label={t("수식")}
              maxLength={512}
              value={f.expression}
              onChange={(e) =>
                setView({
                  ...view,
                  formulas: view.formulas!.map((x, i) => (i === index ? { ...x, expression: e.target.value } : x)),
                })
              }
            />
            <button
              className="btn"
              onClick={() =>
                setView({
                  ...view,
                  formulas: view.formulas!.filter((x) => x.id !== f.id),
                  aggregate: view.aggregate?.property === `formula:${f.id}` ? undefined : view.aggregate,
                })
              }
            >
              {t("수식 삭제")}
            </button>
          </div>
        ))}
        <button
          className="btn"
          disabled={(view.formulas?.length ?? 0) >= 8}
          onClick={() =>
            setView({
              ...view,
              formulas: [...(view.formulas ?? []), { id: crypto.randomUUID(), name: t("계산 결과"), expression: "0" }],
            })
          }
        >
          {t("수식 추가")}
        </button>
        <div className="knowledge-row">
          <select
            aria-label={t("집계 방식")}
            value={view.aggregate?.operation ?? "count"}
            onChange={(e) =>
              setView({
                ...view,
                aggregate: {
                  property: view.aggregate?.property ?? "",
                  operation: e.target.value as NonNullable<SavedView["aggregate"]>["operation"],
                },
              })
            }
          >
            {(["count", "sum", "average", "min", "max"] as const).map((op, i) => (
              <option key={op} value={op}>
                {t(["개수", "합계", "평균", "최솟값", "최댓값"][i])}
              </option>
            ))}
          </select>
          <select
            aria-label={t("집계 속성")}
            disabled={!view.aggregate || view.aggregate.operation === "count"}
            value={view.aggregate?.property ?? ""}
            onChange={(e) =>
              setView({
                ...view,
                aggregate: { operation: view.aggregate?.operation ?? "count", property: e.target.value },
              })
            }
          >
            <option value="">{t("선택 없음")}</option>
            {names
              .filter((name) => items.some((n) => n.properties.some((p) => p.name === name && p.type === "number")))
              .map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            {view.formulas?.map((f) => (
              <option key={f.id} value={`formula:${f.id}`}>
                {f.name}
              </option>
            ))}
          </select>
        </div>
        <p>
          {t("집계는 현재 페이지가 아닌 필터에 맞는 전체 로드된 노트를 기준으로 합니다. 숫자가 없는 값은 제외합니다.")}
        </p>
      </div>
      <div className="kv-panel" hidden={tool !== "card"}>
        <label>
          {t("표지 첨부 ID 속성")}
          <select
            aria-label={t("표지 첨부 ID 속성")}
            value={view.card?.cover_property ?? ""}
            onChange={(e) => setView({ ...view, card: { ...view.card, cover_property: e.target.value } })}
          >
            <option value="">{t("선택 없음")}</option>
            {names
              .filter((name) => items.some((n) => n.properties.some((p) => p.name === name && p.type === "attachment")))
              .map((name) => (
                <option key={name}>{name}</option>
              ))}
          </select>
        </label>
        <p>{t("첨부 이미지 속성의 파일을 표지로 표시합니다. 노트 본문이나 외부 주소는 읽지 않습니다.")}</p>
        <button onClick={() => setView({ ...view, card: { ...view.card, visible_properties: undefined } })}>
          {t("표시 속성 초기화")}
        </button>
        <div className="knowledge-visible-properties">
          {names.map((name) => (
            <label key={name}>
              <input
                type="checkbox"
                aria-label={t("표시 속성: {name}", { name })}
                checked={columns.includes(name)}
                disabled={!columns.includes(name) && columns.length >= 32}
                onChange={(e) =>
                  setView({
                    ...view,
                    card: {
                      ...view.card,
                      visible_properties: e.target.checked ? [...columns, name] : columns.filter((p) => p !== name),
                    },
                  })
                }
              />
              {name}
            </label>
          ))}
        </div>
      </div>
      <div className="kv-selection">
        <span className="kv-selected">{t("{count}개 선택됨", { count: selected.size })}</span>
        <button className="btn" disabled={busy} onClick={() => void reload().catch((e) => setError(message(e)))}>
          {t("새로고침")}
        </button>
        <label>
          <input
            type="checkbox"
            checked={shown.length > 0 && shown.every((n) => selected.has(n.id))}
            onChange={(e) => {
              const checked = e.target.checked;
              setSelected((current) => {
                const next = new Set(current);
                for (const n of shown) {
                  if (checked) next.add(n.id);
                  else next.delete(n.id);
                }
                return next;
              });
            }}
          />
          {t("현재 페이지 선택")}
        </label>
        <button className="btn" onClick={() => setSelected(new Set())}>
          {t("선택 해제")}
        </button>
        <button type="button" className="btn" disabled={!selected.size} onClick={() => setTool("collection")}>
          {t("선택한 값 덮어쓰기")}
        </button>
      </div>
      <div className="kv-body">
        {error && <p role="alert">{error}</p>}
        {truncated && (
          <p>
            <output>{t("큰 보관함의 일부만 불러왔습니다.")}</output>
          </p>
        )}
        {view.layout === "kanban" && !view.group_by && <p>{t("그룹 속성을 선택하면 열별로 정리합니다.")}</p>}
        <div className={view.layout === "kanban" ? "knowledge-board" : ""}>
          {groups.map((group) => (
            <section
              className="knowledge-group"
              key={group.key}
              onDragOver={(e) => {
                if (view.layout === "kanban" && dragging.current && !busy) e.preventDefault();
              }}
              onDrop={(e) => {
                e.preventDefault();
                const note = shown.find((n) => n.id === dragging.current);
                dragging.current = null;
                if (note && !note.readonly) void move(note, group.label);
              }}
            >
              {view.group_by && (
                <h3>
                  {group.label || t("값 없음")} · {group.items.length}
                </h3>
              )}
              {view.layout === "table" ? (
                <div className="knowledge-table-wrap">
                  <table className="knowledge-table">
                    <thead>
                      <tr>
                        <th>{t("선택")}</th>
                        <th>{t("제목")}</th>
                        {columns.map((n) => (
                          <th key={n}>{n}</th>
                        ))}
                        {view.formulas?.map((f) => (
                          <th key={f.id}>{f.name}</th>
                        ))}
                        <th>{t("폴더")}</th>
                        <th>{t("수정한 날짜")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {group.items.map((n) => (
                        <tr key={n.id} className={selected.has(n.id) ? "is-selected" : undefined}>
                          <td>
                            <input
                              type="checkbox"
                              aria-label={t("노트 선택: {title}", { title: n.title })}
                              checked={selected.has(n.id)}
                              onChange={(e) => select(n.id, e.target.checked)}
                            />
                          </td>
                          <td>
                            <button
                              onClick={() => {
                                onClose();
                                void s.selectNote(n.id);
                              }}
                            >
                              {n.title || t("제목 없음")}
                            </button>
                          </td>
                          {columns.map((name) => (
                            <td key={name}>{display(n.properties.find((p) => p.name === name))}</td>
                          ))}
                          {view.formulas?.map((f) => (
                            <td key={f.id}>{formulaText(f.expression, n)}</td>
                          ))}
                          <td>{folder(n)}</td>
                          <td>{formatDate(n.updated_at)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="knowledge-cards">
                  {group.items.map((n) => {
                    const property = n.properties.find((p) => p.name === view.group_by);
                    const movable = property && ["text", "select", "checkbox"].includes(property.type);
                    const values = moveValues(property, items, view.group_by);
                    return (
                      <article
                        key={n.id}
                        draggable={view.layout === "kanban" && !!movable && !n.readonly && !busy}
                        onDragStart={(e) => {
                          dragging.current = n.id;
                          e.dataTransfer.setData("text/plain", n.id);
                          e.dataTransfer.effectAllowed = "move";
                        }}
                        onDragEnd={() => {
                          dragging.current = null;
                        }}
                        className="knowledge-card"
                        data-tone={n.document?.tone ?? "default"}
                        data-shadow={n.document?.card_shadow || undefined}
                        data-size={n.document?.card_size ?? "medium"}
                      >
                        <label>
                          <input
                            type="checkbox"
                            aria-label={t("노트 선택: {title}", { title: n.title })}
                            checked={selected.has(n.id)}
                            onChange={(e) => select(n.id, e.target.checked)}
                          />
                          {t("선택")}
                        </label>
                        {view.formulas?.map((f) => (
                          <span key={f.id}>
                            {f.name}: {formulaText(f.expression, n)}
                          </span>
                        ))}
                        {view.card?.cover_property && (
                          <CollectionCover
                            value={n.properties.find((p) => p.name === view.card?.cover_property)?.value}
                          />
                        )}
                        <button
                          className="knowledge-card-open"
                          onClick={() => {
                            onClose();
                            void s.selectNote(n.id);
                          }}
                        >
                          <strong>{n.title || t("제목 없음")}</strong>
                          {n.properties
                            .filter((p) => columns.includes(p.name))
                            .map((p) => (
                              <span key={p.name}>
                                {p.name}: {display(p)}
                              </span>
                            ))}
                        </button>
                        {view.layout === "kanban" && movable && (
                          <label>
                            {t("열 이동")}
                            <select
                              aria-label={t("열 이동")}
                              disabled={busy || n.readonly}
                              value={displayProperty(property.value)}
                              onChange={(e) => void move(n, e.target.value)}
                            >
                              {values.map((value) => (
                                <option key={value} value={value}>
                                  {value || t("값 없음")}
                                </option>
                              ))}
                            </select>
                          </label>
                        )}
                      </article>
                    );
                  })}
                </div>
              )}
            </section>
          ))}
        </div>
        {names.length > 12 && view.layout === "table" && (
          <p>{t("처음 12개 속성을 표시합니다. 전체 속성은 노트에서 확인할 수 있습니다.")}</p>
        )}
      </div>
      <footer className="kv-footer">
        <p>
          <output>
            {t("노트 {count}개", { count: result.length })} · {t("집계 결과")}: {summary.value ?? "—"}
            {summary.errors > 0 && ` · ${t("계산 오류 {count}개", { count: summary.errors })}`}
          </output>
        </p>
        <span className="kv-gap" />
        <button className="btn" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
          {t("이전")}
        </button>
        <span>{page + 1}</span>
        <button className="btn" disabled={(page + 1) * 50 >= result.length} onClick={() => setPage((p) => p + 1)}>
          {t("다음")}
        </button>
      </footer>
    </section>
  );
}
