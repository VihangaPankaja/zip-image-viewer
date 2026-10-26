const MAX_FORMATTED_CHARS = 131072;

export function formatPreviewJson(source: string): { text: string; message: string } {
  if (source.length > 65536)
    return {
      text: source,
      message: "JSON formatting is limited to 64 Ki characters. Raw text remains available.",
    };
  let depth = 0;
  let quoted = false;
  let escaped = false;
  for (const char of source) {
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') quoted = false;
    } else if (char === '"') quoted = true;
    else if (char === "{" || char === "[") {
      if (++depth > 64)
        return {
          text: source,
          message: "JSON nesting exceeds 64 levels. Raw text remains available.",
        };
    } else if (char === "}" || char === "]") depth--;
  }
  try {
    JSON.parse(source);
  } catch {
    return { text: source, message: "Invalid JSON. Showing raw text." };
  }
  return indentJson(source);
}

function indentJson(source: string): { text: string; message: string } {
  let text = "";
  let depth = 0;
  let quoted = false;
  let escaped = false;
  let previous = "";
  for (const char of source) {
    if (
      !quoted &&
      !/\s/.test(char) &&
      (previous === "{" || previous === "[") &&
      char !== "}" &&
      char !== "]"
    )
      text += "\n" + "  ".repeat(depth);
    if (quoted) {
      text += char;
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') quoted = false;
    } else if (char === '"') {
      text += char;
      quoted = true;
    } else if (/\s/.test(char)) continue;
    else if (char === "{" || char === "[") {
      text += char;
      depth++;
    } else if (char === "}" || char === "]") {
      depth--;
      if (previous !== "{" && previous !== "[") text += "\n" + "  ".repeat(depth);
      text += char;
    } else if (char === ",") text += ",\n" + "  ".repeat(depth);
    else if (char === ":") text += ": ";
    else text += char;
    if (text.length > MAX_FORMATTED_CHARS)
      return {
        text: source,
        message: "Formatted JSON exceeds 128 Ki characters. Showing raw text.",
      };
    previous = char;
  }
  return { text, message: "Formatted JSON. Numeric values are preserved exactly." };
}

export function parsePreviewTable(source: string, delimiter: string, complete: boolean) {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let closedQuote = false;
  let limited = false;
  let invalid = false;
  const finishField = () => {
    if (row.length < 32) row.push(field);
    else limited = true;
    field = "";
    closedQuote = false;
  };
  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    if (quoted) {
      if (char === '"' && source[i + 1] === '"') {
        if (field.length < 2048) field += '"';
        else limited = true;
        i++;
      } else if (char === '"') {
        quoted = false;
        closedQuote = true;
      } else if (field.length < 2048) field += char;
      else limited = true;
    } else if (char === delimiter) finishField();
    else if (char === "\r" || char === "\n") {
      finishField();
      rows.push(row);
      row = [];
      if (char === "\r" && source[i + 1] === "\n") i++;
      if (rows.length === 200) {
        limited ||= i < source.length - 1;
        return { rows, limited, invalid, incomplete: !complete };
      }
    } else if (char === '"' && field === "" && !closedQuote) quoted = true;
    else {
      if (closedQuote || char === '"') invalid = true;
      if (field.length < 2048) field += char;
      else limited = true;
    }
  }
  if (complete && !quoted && (field || row.length || closedQuote)) {
    finishField();
    rows.push(row);
  }
  return {
    rows,
    limited,
    invalid: invalid || (complete && quoted),
    incomplete: !complete || quoted,
  };
}

export function buildTextRows(text: string, width: number) {
  const rows: { text: string; line: number; continued: boolean; offset: number }[] = [];
  let offset = 0;
  text.split(/(\r\n|\r|\n)/).forEach((line, index) => {
    if (index % 2) {
      offset += line.length;
      return;
    }
    const lineNumber = index / 2 + 1;
    if (!line) rows.push({ text: "", line: lineNumber, continued: false, offset });
    for (let start = 0; start < line.length;) {
      let end = Math.min(line.length, start + width);
      const last = line.charCodeAt(end - 1);
      if (end < line.length && last >= 0xd800 && last <= 0xdbff) end--;
      rows.push({
        text: line.slice(start, end),
        line: lineNumber,
        continued: start > 0,
        offset: offset + start,
      });
      start = end;
    }
    offset += line.length;
  });
  return rows;
}

export function findTextRows(text: string, rows: ReturnType<typeof buildTextRows>, query: string) {
  if (!query) return [];
  const matches: number[] = [];
  const source = text.toLowerCase();
  const needle = query.toLowerCase();
  let row = 0;
  for (
    let index = source.indexOf(needle);
    index >= 0;
    index = source.indexOf(needle, index + Math.max(1, needle.length))
  ) {
    while (row + 1 < rows.length && rows[row + 1].offset <= index) row++;
    if (matches.at(-1) !== row) matches.push(row);
  }
  return matches;
}
