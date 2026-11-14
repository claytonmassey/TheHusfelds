export type NamedPerson = {
  id: string;
  name: string;
};

export type TextMark = {
  start: number;
  end: number;
  id: string;
};

export function pageParagraphs(raw: string): string[] {
  const body = raw.replace(/\r/g, "").trim();
  if (!body) return [];
  const noText = body.match(/^no text\b[.:]?\s*([\s\S]*)$/i);
  if (noText) {
    const scene = (noText[1] ?? "").replace(/\s+/g, " ").trim();
    return scene ? [scene] : [];
  }
  return body
    .split(/\n\s*\n/)
    .map((block) =>
      block
        .replace(/^`{1,3}\s*/, "")
        .replace(/[ \t]*\n[ \t]*/g, " ")
        .replace(/[ \t]{2,}/g, " ")
        .trim(),
    )
    .filter(Boolean);
}

export function pageSummary(paragraphs: string[]): string {
  if (paragraphs.length === 0) return "";
  let index = 0;
  let title = "";
  if (paragraphs.length > 1 && isHeading(paragraphs[0])) {
    title = withStop(paragraphs[0]);
    index = 1;
  }
  while (index < paragraphs.length && !startsSentence(paragraphs[index])) index += 1;
  const body = paragraphs[index] ?? paragraphs[paragraphs.length - 1];
  const opening = splitSentences(body).slice(0, 2).join(" ");
  const summary = [title, opening].filter(Boolean).join(" ");
  if (summary.length <= 560) return summary;
  return `${summary.slice(0, 557).replace(/\s+\S*$/, "")}…`;
}

export function marksIn(text: string, people: NamedPerson[]): TextMark[] {
  const hay = fold(text);
  const forms = people.flatMap((person) => nameForms(person.name).map((form) => ({ id: person.id, form: fold(form) })));
  forms.sort((left, right) => right.form.length - left.form.length);
  const marks: TextMark[] = [];
  for (const item of forms) {
    let from = 0;
    while (from <= hay.length - item.form.length) {
      const start = hay.indexOf(item.form, from);
      if (start < 0) break;
      const end = start + item.form.length;
      if (bounded(hay, start, end) && !followedBySuffix(hay, end) && !marks.some((mark) => start < mark.end && end > mark.start)) {
        marks.push({ start, end, id: item.id });
      }
      from = end;
    }
  }
  return marks.sort((left, right) => left.start - right.start);
}

export function peopleInOrder(paragraphs: string[], people: NamedPerson[]): string[] {
  const hay = fold(paragraphs.join("\n"));
  const found: { id: string; at: number }[] = [];
  for (const person of people) {
    let earliest = -1;
    for (const form of nameForms(person.name)) {
      const needle = fold(form);
      let from = 0;
      while (from <= hay.length - needle.length) {
        const start = hay.indexOf(needle, from);
        if (start < 0) break;
        const end = start + needle.length;
        if (bounded(hay, start, end) && !followedBySuffix(hay, end)) {
          earliest = earliest < 0 ? start : Math.min(earliest, start);
          break;
        }
        from = end;
      }
    }
    if (earliest >= 0) found.push({ id: person.id, at: earliest });
  }
  return found.sort((left, right) => left.at - right.at).map((item) => item.id);
}

function isHeading(line: string): boolean {
  if (line.length > 140) return false;
  if (/\(\d{4}\b/.test(line)) return true;
  return !/[.!?]$/.test(line) && line.split(/\s+/).length < 18;
}

function startsSentence(line: string): boolean {
  return /^[\p{Lu}“"']/u.test(line);
}

function withStop(line: string): string {
  return /[.!?]$/.test(line) ? line : `${line}.`;
}

function splitSentences(paragraph: string): string[] {
  const parts: string[] = [];
  let start = 0;
  for (let index = 0; index < paragraph.length; index += 1) {
    const char = paragraph[index];
    if (char !== "." && char !== "!" && char !== "?") continue;
    if (char === "." && abbreviation(paragraph, index)) continue;
    let stop = index + 1;
    while (stop < paragraph.length && /["”']/.test(paragraph[stop])) stop += 1;
    const sentence = paragraph.slice(start, stop).trim();
    if (sentence) parts.push(sentence);
    start = stop;
    while (paragraph[start] === " ") start += 1;
    index = start - 1;
  }
  const rest = paragraph.slice(start).trim();
  if (rest) parts.push(rest);
  return parts;
}

function abbreviation(paragraph: string, period: number): boolean {
  const before = paragraph[period - 1];
  const earlier = paragraph[period - 2];
  if (!before || !/\p{L}/u.test(before)) return false;
  if (!earlier || !/\p{L}/u.test(earlier)) return true;
  const word = paragraph.slice(0, period).match(/[\p{L}]+$/u)?.[0]?.toLowerCase() ?? "";
  return word === "sr" || word === "jr" || word === "mr" || word === "mrs" || word === "dr" || word === "st";
}

function nameForms(name: string): string[] {
  const clean = name.replace(/†/g, "").replace(/\s+/g, " ").trim();
  const forms: string[] = [];
  const add = (value: string) => {
    const next = value.replace(/\s+/g, " ").trim();
    if (next.length < 5 || next.split(/\s+/).length < 2) return;
    if (forms.some((item) => fold(item) === fold(next))) return;
    forms.push(next);
  };
  add(clean);
  add(clean.replace(/\s*\([^)]*\)\s*/g, " "));
  const nick = clean.match(/^(\S+)\s+\(([^)]+)\)\s+(.+)$/);
  if (nick) add(`${nick[2]} ${nick[3]}`);
  add(clean.split(/\s+-\s+/)[0] ?? "");
  return forms;
}

function fold(value: string): string {
  let out = "";
  for (const char of value) {
    if (char === "’" || char === "‘") out += "'";
    else if (char === "“" || char === "”") out += '"';
    else out += char.toLowerCase();
  }
  return out;
}

function bounded(hay: string, start: number, end: number): boolean {
  return !isLetter(hay[start - 1]) && !isLetter(hay[end]);
}

function followedBySuffix(hay: string, end: number): boolean {
  return /^(sr|jr|ii|iii|iv)\b/.test(hay.slice(end).replace(/^[\s,.'"’-]+/, ""));
}

function isLetter(char: string | undefined): boolean {
  return Boolean(char && /\p{L}/u.test(char));
}
