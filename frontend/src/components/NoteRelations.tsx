import { t } from "../i18n";
import React, { useEffect, useState } from "react";
import { useStore } from "../store";
import { knowledge, type RelationEdge } from "../lib/knowledge";
import { openBacklinkLocation, readBacklinkLocation } from "../lib/backlink-location";

const groupKey = (e: RelationEdge) => (e.kind === "relation" ? `relation:${e.property ?? ""}` : e.kind.replace("title_", ""));
function groupLabel(e: RelationEdge) {
  if (e.kind === "relation") return e.property ?? "";
  if (e.kind === "parent") return t("문서 계층");
  return t("링크");
}
const other = (e: RelationEdge) => (e.direction === "out" ? { id: e.target, title: e.target_title } : { id: e.source, title: e.source_title });

/** Typed relations of the open note: links, relation properties and document parents, both directions. */
export function NoteRelations({ id, revision, onClose }: Readonly<{ id: string; revision?: number; onClose: () => void }>) {
  const s = useStore();
  const [items, setItems] = useState<RelationEdge[] | null>(null);
  const [property, setProperty] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    knowledge.relations({ id, limit: 200 }, controller.signal).then(r => setItems(r.items), e => {
      if (!controller.signal.aborted) setError(e instanceof Error ? e.message : String(e));
    });
    return () => controller.abort();
  }, [id, revision]);
  const open = async (edge: RelationEdge) => {
    const target = other(edge);
    setError("");
    try {
      if (!(await s.flushNow())) return;
      // Incoming body links open the linking note at the link itself when it can be located.
      const location = edge.direction === "in" && edge.evidence?.label ? await readBacklinkLocation(target.id, edge.target, [edge.target_title], new AbortController().signal).catch(() => undefined) : undefined;
      onClose();
      if (location) await openBacklinkLocation(s, target.id, location);
      else await s.selectNote(target.id);
    } catch (e) {
      setError(e instanceof Error ? t(e.message) : String(e));
    }
  };
  if (!items) return error ? <p role="alert">{error}</p> : null;
  const properties = [...new Set(items.flatMap(e => (e.property ? [e.property] : [])))].sort((a, b) => a.localeCompare(b));
  const shown = property ? items.filter(e => e.property === property) : items;
  const groups = new Map<string, RelationEdge[]>();
  for (const e of shown) groups.set(groupKey(e), [...(groups.get(groupKey(e)) ?? []), e]);
  return (
    <section className="note-relations" aria-label={t("관계")}>
      <h4>{t("관계")}</h4>
      {properties.length > 0 && (
        <label>
          {t("관계 속성")}{" "}
          <select value={property} onChange={e => setProperty(e.target.value)}>
            <option value="">{t("모든 관계")}</option>
            {properties.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
        </label>
      )}
      {error && <p role="alert">{error}</p>}
      {!shown.length && <p>{t("연결된 관계가 없습니다.")}</p>}
      {[...groups].map(([key, edges]) => (
        <section key={key} aria-label={groupLabel(edges[0])}>
          <h5>{groupLabel(edges[0])}</h5>
          <ul className="inspector-list">
            {edges.map(e => {
              const note = other(e);
              const name = note.title || t("제목 없음");
              const label = e.direction === "out" ? t("나가는 관계 {relation}: {title} 열기", { relation: groupLabel(e), title: name }) : t("들어오는 관계 {relation}: {title} 열기", { relation: groupLabel(e), title: name });
              return (
                <li key={`${e.kind}-${e.source}-${e.target}-${e.property ?? ""}`}>
                  <button type="button" aria-label={label} onClick={() => void open(e)}>
                    <span aria-hidden="true">{e.direction === "out" ? "→" : "←"}</span> {name}
                    <small>{e.direction === "out" ? t("나가는") : t("들어오는")}</small>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </section>
  );
}
