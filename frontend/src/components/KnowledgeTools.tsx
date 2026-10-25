import React, { useEffect, useMemo, useRef, useState } from "react";
import { GraphIcon, LinkIcon, MagnifyingGlassIcon } from "@phosphor-icons/react";
import { createPortal } from "react-dom";
import { X, FileText } from "../icons";
import { useStore } from "../store";
import { t } from "../i18n";
import { api, rpc } from "../api";
import {
  knowledge,
  displayProperty,
  initialPropertyValue,
  graphLayout,
  graphNeighborhood,
  type GraphData,
  type KnowledgeItem,
  type NoteKnowledge,
  type NoteProperty,
} from "../lib/knowledge";
import { AttachmentPropertyEditor } from "./AttachmentPropertyEditor";
import { PropertyValueEditor } from "./PropertyValueEditor";
import { NoteConnections } from "./NoteConnections";
import "./KnowledgeTools.css";

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

export const KNOWLEDGE_EVENT = "inkism-open-knowledge";
type Panel = "graph" | "note";
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
export function KnowledgeTools() {
  const s = useStore(),
    dialog = useRef<HTMLDialogElement>(null);
  const [panel, setPanel] = useState<Panel | null>(null);
  useEffect(() => {
    const open = (e: Event) => setPanel((e as CustomEvent<Panel>).detail || "note");
    window.addEventListener(KNOWLEDGE_EVENT, open);
    return () => window.removeEventListener(KNOWLEDGE_EVENT, open);
  }, []);
  // 관계 그래프는 셸 안 화면이고, 속성과 노트 연결만 대화상자다.
  useEffect(() => {
    if (panel === "note") dialog.current?.showModal();
    else dialog.current?.close();
  }, [panel]);
  // 사이드바 항목을 누르면 그래프 화면을 닫는다. 그래프 단추는 클릭 뒤 다시 연다.
  useEffect(() => {
    const leave = (e: MouseEvent) => {
      if (e.target instanceof Element && e.target.closest(".sidebar .side-item"))
        setPanel((p) => (p === "graph" ? null : p));
    };
    document.addEventListener("click", leave, true);
    return () => document.removeEventListener("click", leave, true);
  }, []);
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
            {(["graph", "note"] as Panel[]).map((p) => (
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
