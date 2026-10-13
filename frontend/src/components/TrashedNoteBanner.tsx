/** 지운 노트를 열었을 때 편집기 위 안내 띠 (Figma 08 "지운 노트 안내"). */
import React, { useEffect, useState } from "react";
import { api, type TrashDays } from "../api";
import { useStore } from "../store";
import { t } from "../i18n";
import "./TrashedNoteBanner.css";

const DAY = 86_400_000;

export function TrashedNoteBanner() {
  const s = useStore();
  const id = s.note?.trashed && s.note.id === s.draft?.id ? s.note.id : null;
  const [info, setInfo] = useState<{ at?: number; days: TrashDays } | null>(null);
  useEffect(() => {
    setInfo(null);
    if (!id) return;
    let live = true;
    api
      .trashTimes([id])
      .then((r) => live && setInfo({ at: r.times[id], days: r.days }))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [id]);
  if (!id) return null;
  const left =
    !s.note?.archived && info?.days != null && info.at !== undefined ? Math.max(0, info.days - Math.floor((Date.now() - info.at) / DAY)) : null;
  return (
    <output className="trashed-banner">
      <span>
        {left === null
          ? t("지운 노트예요. 읽기만 할 수 있어요. 복원하면 다시 편집할 수 있어요.")
          : t("지운 노트예요. 읽기만 할 수 있고, {n}일 뒤 자동으로 삭제돼요. 복원하면 다시 편집할 수 있어요.", { n: left })}
      </span>
      <button type="button" className="btn btn-ghost" onClick={() => void s.restoreSelected()}>
        {t("복원")}
      </button>
    </output>
  );
}
