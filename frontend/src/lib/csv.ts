/** Reads a quoted run after its opening quote; `end` is the closing quote's index (src.length if unclosed). */
function readQuoted(src: string, start: number) {
  let text = "";
  let i = start;
  for (; i < src.length; i++) {
    if (src[i] !== '"') text += src[i];
    else if (src[i + 1] === '"') {
      text += '"';
      i++;
    } else break;
  }
  return { text, end: i };
}

/** RFC 4180 CSV: quoted fields, "" escapes, CRLF/LF rows. Trailing empty line is dropped. */
export function parseCsv(text: string, limits?: {maxCells:number;maxColumns:number;strict?:boolean}): string[][] {
  const rows: string[][] = [];
  let row: string[] = [],
    field = "";
  const src = text.replace(/^﻿/, "");
  let cells=0;
  const pushField=()=>{if(limits&&(++cells>limits.maxCells||row.length>=limits.maxColumns))throw new Error("CSV exceeds cell or column limit");row.push(field);field="";};
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === '"' && field === "") {
      const run = readQuoted(src, i + 1);
      if(limits?.strict&&(run.end>=src.length||!([undefined,",","\r","\n"].includes(src[run.end+1]))))throw new Error("Invalid quoted CSV field");
      field += run.text;
      i = run.end;
    } else if (c === ",") {
      pushField();
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      pushField();
      rows.push(row);
      row = [];
      field = "";
    } else {if(limits?.strict&&c==='"')throw new Error("Invalid CSV quote");field += c;}
    i++;
  }
  // A quoted empty field still forms a row at EOF.
  if (field !== "" || row.length || src.endsWith('"')) {
    pushField();
    rows.push(row);
  }
  return rows;
}
