export interface TextChunk {
  text: string;
  index: number;
}

export function chunkText(
  text: string,
  chunkSize: number = 1000,
  overlap: number = 200
): TextChunk[] {
  const chunks: TextChunk[] = [];
  let start = 0;
  let index = 0;

  while (start < text.length) {
    const end = Math.min(start + chunkSize, text.length);
    const chunkText = text.slice(start, end).trim();

    if (chunkText.length > 0) {
      chunks.push({ text: chunkText, index });
      index++;
    }

    if (end >= text.length) break;
    start += chunkSize - overlap;
  }

  return chunks;
}
