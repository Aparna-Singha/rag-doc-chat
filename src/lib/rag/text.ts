export function normalizeDocumentText(text: string): string {
  const normalizedText = text
    .replace(/\u0000/g, "")
    .replace(/\uFEFF/g, "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/(\w)-\n(\w)/g, "$1$2");

  const normalizedLines = normalizedText
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim());

  const cleanedLines: string[] = [];
  let previousLineWasEmpty = false;

  for (const line of normalizedLines) {
    if (!line) {
      if (!previousLineWasEmpty && cleanedLines.length > 0) {
        cleanedLines.push("");
      }

      previousLineWasEmpty = true;
      continue;
    }

    cleanedLines.push(line);
    previousLineWasEmpty = false;
  }

  return cleanedLines.join("\n").trim();
}
