/** Same as `.replace(/[. ]+$/, "")` without regex backtracking. */
function trimTrailingDotsAndSpaces(value: string) {
  let end = value.length;
  while (end > 0 && (value[end - 1] === "." || value[end - 1] === " ")) end--;
  return value.slice(0, end);
}
export function sourceFilename(title: string, extension: string) {
  let name =
    trimTrailingDotsAndSpaces(
      Array.from(title)
        .slice(0, 80)
        .join("")
        .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_"),
    ).trim() || "inkism";
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)) name = "_" + name;
  return name + "." + extension;
}
