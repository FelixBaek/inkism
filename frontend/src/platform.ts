import { t } from "./i18n";
export async function closeAfterSave() {
  const response = await fetch("/api/close", { method: "POST" });
  if (!response.ok) throw new Error(t("앱을 닫을 수 없습니다"));
}
