const GERMAN = new Set(
  "und der die das den dem des ein eine einer einem einen ist sind nicht mit von zu zur zum auf für aus bei nach als auch sich ich wir ihr sie es geboren geburt tauf trauung gestorben jahr ehe".split(
    " ",
  ),
);
const ENGLISH = new Set("the and of to a in that is was for on with as his her they this from by at or be an".split(" "));

export function foreignLanguage(text: string): string | null {
  const writing = text.split("Context added by the family:")[0] ?? "";
  const words = writing
    .toLowerCase()
    .replace(/[^a-zäöüß\s]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 1);
  let german = 0;
  let english = 0;
  for (const word of words) {
    if (GERMAN.has(word)) german += 1;
    if (ENGLISH.has(word)) english += 1;
  }
  if (german >= 4 && german > english) return "German";
  return null;
}
