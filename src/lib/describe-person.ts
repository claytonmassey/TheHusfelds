import { answerAboutPerson, type AskResult } from "@/lib/ask";

export async function describePerson(name: string): Promise<AskResult & { filenames: string[] }> {
  return answerAboutPerson(
    name,
    `Who is ${name.trim()}? Write two short paragraphs from these pages and the recorded parent link. Use only facts a page states about this same person. A shared first name is a different person. If no birth date is written for them, say the pages do not give one. Name a filename only when that page is one of the pages above.`,
    `The pages do not give a longer account of ${name.trim()}.`,
  );
}

export async function describeHistory(name: string): Promise<AskResult & { filenames: string[] }> {
  return answerAboutPerson(
    name,
    `What do these pages say about the schooling, jobs, and other dated events in the life of ${name.trim()}? Use only facts a page states about this same person. A shared first name is a different person. A title written beside this person's name, such as Dr., and a town written with that name, belong under Work. Do not give this person a school, job, or date that the page gives to someone else. Write three short parts labeled School, Work, and Other events. If a part has nothing, say the pages do not give it. Name the filename for each fact you use.`,
    "School:\nThe pages do not give it.\n\nWork:\nThe pages do not give it.\n\nOther events:\nThe pages do not give it.",
  );
}

export async function findDocuments(name: string): Promise<AskResult & { filenames: string[] }> {
  return answerAboutPerson(
    name,
    `These pages name ${name.trim()}. For each page, write one line: the filename, then one sentence of what that page says about this same person. A shared first name is a different person. Do not add a page that is not listed here.`,
    "The pages do not mention them.",
  );
}
