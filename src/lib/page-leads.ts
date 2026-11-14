export type PageLead = {
  id: string;
  label: string;
  cue: string;
  score: number;
  excerpt: string;
  mapQuery: string | null;
};

const HISTORIC = /\b(born|birth|died|death|buried|burial|cemetery|married|marriage|grave|memorial)\b/i;
const YEAR = /\b(1[6-9]\d{2}|20\d{2})\b/;
const BOILER = /database on-line|operations, inc|learn more|original data|find a grave site|corrections and additions/i;
const CEMETERY = "(?:([A-Z][a-z]+)\\s+at\\s+)?([A-Z][\\p{L}'’.-]+(?:\\s+[A-Z][\\p{L}'’.-]+){0,3}\\s+Cemetery)";
const COUNTY = "\\b([A-Z][a-z]+,\\s+[A-Z][a-z]+\\s+County,\\s+[A-Z][a-z]+)\\b";

export function pageLeads(paragraphs: string[], summary: string): PageLead[] {
  const historic = HISTORIC.test(paragraphs.join(" ")) || YEAR.test(paragraphs.join(" "));
  const found: PageLead[] = [];
  for (const paragraph of paragraphs) {
    if (!paragraph || paragraph.length < 12 || BOILER.test(paragraph)) continue;
    const excerpt = clip(paragraph);
    const burial = burialPlace(paragraph);
    const cemeteries = cemeteryNames(paragraph);
    const counties = [...paragraph.matchAll(new RegExp(COUNTY, "g"))].map((match) => match[1]);
    if (burial && cemeteries.length > 0) {
      pushLead(found, {
        label: `${cemeteries[0]}, ${burial}`,
        cue: "Burial",
        excerpt,
        paragraph,
        summary,
        historic,
      });
    } else {
      for (const name of cemeteries) {
        pushLead(found, { label: name, cue: "Burial", excerpt, paragraph, summary, historic });
      }
      for (const name of counties) {
        if (burial && burial.includes(name)) continue;
        pushLead(found, { label: name, cue: "Place", excerpt, paragraph, summary, historic });
      }
    }
    for (const field of sheetFields(paragraph)) {
      pushLead(found, { label: field.label, cue: field.cue, excerpt, paragraph, summary, historic });
    }
    const born = paragraph.match(/\bBorn in\s+([^.]{4,90})/i);
    if (born) {
      pushLead(found, { label: tidyPlace(born[1]), cue: "Birth", excerpt, paragraph, summary, historic });
    }
    const died = paragraph.match(/\bDied in\s+([A-Z][a-z]+(?:\s+County)?)/);
    if (died) {
      const place = tidyPlace(died[1]);
      if (!found.some((lead) => lead.label.includes(place))) {
        pushLead(found, { label: place, cue: "Death", excerpt, paragraph, summary, historic });
      }
    }
  }
  return found.sort((left, right) => right.score - left.score || right.label.length - left.label.length).slice(0, 4);
}

export function leadSearchTerm(label: string): string {
  const cemetery = label.match(/([A-Z][\p{L}'’.-]+(?:\s+[A-Z][\p{L}'’.-]+){0,3}\s+Cemetery)/u);
  if (cemetery) return cemetery[1];
  const first = label.split(",")[0]?.trim() ?? label;
  return first.length >= 4 ? first : label;
}

export function mapHref(query: string): string {
  return `https://www.openstreetmap.org/search?query=${encodeURIComponent(query)}`;
}

function pushLead(
  found: PageLead[],
  input: { label: string; cue: string; excerpt: string; paragraph: string; summary: string; historic: boolean },
) {
  const label = input.label.replace(/\s+/g, " ").trim().replace(/[.,;]+$/, "");
  if (label.length < 4 || label.length > 90) return;
  const key = fold(label);
  if (found.some((lead) => fold(lead.label) === key || fold(lead.label).includes(key) || key.includes(fold(lead.label)))) {
    const shorter = found.findIndex((lead) => key.includes(fold(lead.label)) && key.length > fold(lead.label).length);
    if (shorter >= 0) found.splice(shorter, 1);
    else return;
  }
  let score =
    input.cue === "Birth" ? 0.86 : input.cue === "Burial" ? 0.84 : input.cue === "Marriage" ? 0.82 : input.cue === "Death" ? 0.8 : input.cue === "Church" ? 0.76 : 0.62;
  if (input.summary && fold(input.summary).includes(key.slice(0, 24))) score += 0.06;
  if (YEAR.test(input.paragraph)) score += 0.06;
  if (/\b(birth date|death date|buried|burial)\b/i.test(input.paragraph)) score += 0.05;
  if (label.includes("County")) score += 0.04;
  found.push({
    id: `${input.cue}-${key}`,
    label,
    cue: input.cue,
    score: Math.min(0.96, Math.round(score * 100) / 100),
    excerpt: input.excerpt,
    mapQuery: input.historic ? label : null,
  });
}

function cemeteryNames(paragraph: string): string[] {
  const names: string[] = [];
  for (const match of paragraph.matchAll(new RegExp(CEMETERY, "gu"))) {
    const name = match[1] ? `${match[1]} at ${match[2]}` : match[2];
    if (!names.some((item) => fold(item) === fold(name))) names.push(name);
  }
  return names;
}

const SHEET_LABEL =
  "PLACE OF BIRTH|DATE OF BIRTH|PLACE OF DEATH|DATE OF DEATH|BURIAL PLACE|BIRTH \\(DATE & PLACE\\)|DEATH \\(DATE & PLACE\\)|MARRIAGE \\(DATE & PLACE\\)|MARRIAGE DATE|OTHER HUSBANDS|OTHER WIVES|OCCUPATION|FATHER|MOTHER|SPOUSE'S NAME|SPOUSE'S PARENTS|CHURCH|HUSBAND|WIFE|NAME|NO\\.|PLACE";

function sheetFields(paragraph: string): Array<{ label: string; cue: string }> {
  const pattern = new RegExp(`\\b(${SHEET_LABEL})\\s*:?\\s*`, "gi");
  const marks = [...paragraph.matchAll(pattern)];
  const fields: Array<{ label: string; cue: string }> = [];
  for (let index = 0; index < marks.length; index += 1) {
    const mark = marks[index];
    const start = (mark.index ?? 0) + mark[0].length;
    const end = marks[index + 1]?.index ?? paragraph.length;
    const cue = cueFor(mark[1]);
    const value = placeValue(paragraph.slice(start, end), cue);
    if (value) fields.push({ label: value, cue });
  }
  return fields;
}

function cueFor(label: string): string {
  const name = label.toUpperCase();
  if (name.startsWith("PLACE OF BIRTH") || name.startsWith("BIRTH")) return "Birth";
  if (name.startsWith("PLACE OF DEATH") || name.startsWith("DEATH")) return "Death";
  if (name.startsWith("BURIAL")) return "Burial";
  if (name.startsWith("MARRIAGE DATE")) return "";
  if (name.startsWith("MARRIAGE") || name === "PLACE") return "Marriage";
  if (name.startsWith("CHURCH")) return "Church";
  return "";
}

function placeValue(raw: string, cue: string): string {
  if (!cue) return "";
  const cleaned = raw
    .replace(/_+/g, " ")
    .replace(/\b\d{1,2}-\d{1,2}-\d{2,4}\b/g, " ")
    .replace(/\s+/g, " ")
    .replace(/[.,;]+$/, "")
    .trim();
  if (!cleaned || cleaned.length < 3 || /^(\[unclear\]|n\/?a|none|unknown|no\.?)$/i.test(cleaned)) return "";
  if (!/[A-Za-z]{3}/.test(cleaned)) return "";
  return tidyPlace(cleaned);
}

function burialPlace(paragraph: string): string {
  const match = paragraph.match(/Burial or Cremation Place:\s*([^:]{8,90}?)(?=\s+Has Bio|\s+Spouse|\s+URL|$)/i);
  if (!match) return "";
  return tidyPlace(match[1]);
}

function tidyPlace(value: string): string {
  return value
    .replace(/\s+/g, " ")
    .replace(/,?\s*United States of America\b/i, "")
    .replace(/[.,;]+$/, "")
    .trim();
}

function clip(paragraph: string): string {
  const clean = paragraph.replace(/`+/g, "").replace(/\s+/g, " ").trim();
  if (clean.length <= 280) return clean;
  return `${clean.slice(0, 277).replace(/\s+\S*$/, "")}…`;
}

function fold(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}
