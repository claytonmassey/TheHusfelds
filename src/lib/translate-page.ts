export type PageTranslation = {
  language: string;
  english: string;
};

export async function translatePage(text: string): Promise<PageTranslation> {
  const writing = text.replace(/\s+\n/g, "\n").trim().slice(0, 8000);
  if (writing.length < 2) throw new Error("Nothing to translate.");
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is not set.");

  const raw = await chat(writing, apiKey);
  return parseTranslation(raw);
}

async function chat(writing: string, apiKey: string): Promise<string> {
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      temperature: 0,
      max_tokens: 2500,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: [
            "Translate the user's family paper into English.",
            'Return JSON with two strings: "language" and "english".',
            "language is the name of the paper's language. english is the complete English translation of every paragraph.",
            "Translate every sentence. Keep personal names, place names, dates, and [unclear] unchanged. If a sentence is unfinished, leave it unfinished.",
            "Keep a blank line between paragraphs. Do not add notes or facts that are not on the page.",
            "If the paper is already English, set language to English and put the same writing in english.",
          ].join(" "),
        },
        { role: "user", content: `Translate this into English:\n\n${writing}` },
      ],
    }),
  });
  if (!response.ok) {
    throw new Error(`OpenAI request failed. ${(await response.text()).slice(0, 200)}`);
  }
  const payload = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const answer = payload.choices?.[0]?.message?.content?.trim();
  if (!answer) throw new Error("The translation did not come back.");
  return answer;
}

function parseTranslation(raw: string): PageTranslation {
  let payload: { language?: unknown; english?: unknown };
  try {
    payload = JSON.parse(raw) as { language?: unknown; english?: unknown };
  } catch {
    throw new Error("The translation did not come back.");
  }
  const language = typeof payload.language === "string" && payload.language.trim() ? payload.language.trim().slice(0, 40) : "another language";
  const english = typeof payload.english === "string" ? payload.english.trim().slice(0, 12000) : "";
  if (!english) throw new Error("The translation did not come back.");
  return { language, english };
}
