import { Pinecone } from "@pinecone-database/pinecone";

let pineconeClient: Pinecone | null = null;

function getPinecone(): Pinecone {
  if (!pineconeClient) {
    pineconeClient = new Pinecone({
      apiKey: process.env.PINECONE_API_KEY!,
    });
  }
  return pineconeClient;
}

export function getIndex() {
  const pc = getPinecone();
  return pc.index(process.env.PINECONE_INDEX!);
}

export async function upsertVectors(
  vectors: { id: string; values: number[]; metadata: Record<string, string> }[]
) {
  const index = getIndex();
  const batchSize = 100;
  for (let i = 0; i < vectors.length; i += batchSize) {
    const batch = vectors.slice(i, i + batchSize);
    await index.upsert(batch);
  }
}

export async function queryVectors(
  embedding: number[],
  topK: number = 5
): Promise<{ id: string; score: number; metadata: Record<string, string> }[]> {
  const index = getIndex();
  const results = await index.query({
    vector: embedding,
    topK,
    includeMetadata: true,
  });
  return (results.matches || []).map((m) => ({
    id: m.id,
    score: m.score ?? 0,
    metadata: (m.metadata as Record<string, string>) || {},
  }));
}
