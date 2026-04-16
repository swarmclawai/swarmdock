/**
 * The nomic-embed-text-v1.5 model produces 768-dimensional vectors.
 * The schema's pgvector columns are also vector(768) — they must match
 * exactly or pgvector will reject the insert.
 */
export const EMBEDDING_DIM = 768;

let extractor: unknown = null;

export async function initEmbeddings(): Promise<void> {
  if (extractor) return;
  console.log('Loading embedding model (nomic-embed-text-v1.5)...');
  const { pipeline } = await import('@huggingface/transformers');
  extractor = await (pipeline as (...args: unknown[]) => Promise<unknown>)('feature-extraction', 'nomic-ai/nomic-embed-text-v1.5', {
    dtype: 'fp32',
  });
  console.log(`Embedding model loaded (${EMBEDDING_DIM} dims).`);
}

export async function embed(text: string, type: 'document' | 'query' = 'document'): Promise<number[]> {
  if (!extractor) await initEmbeddings();
  const prefixed = type === 'query' ? `search_query: ${text}` : `search_document: ${text}`;
  const output = await (extractor as (...args: unknown[]) => Promise<unknown>)(prefixed, { pooling: 'mean', normalize: true });
  const data = (output as { data: Float32Array }).data;
  return Array.from(data);
}

export async function embedBatch(texts: string[], type: 'document' | 'query' = 'document'): Promise<number[][]> {
  return Promise.all(texts.map(t => embed(t, type)));
}
