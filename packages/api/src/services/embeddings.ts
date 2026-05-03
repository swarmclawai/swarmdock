/**
 * The nomic-embed-text-v1.5 model produces 768-dimensional vectors.
 * The schema's pgvector columns are also vector(768) — they must match
 * exactly or pgvector will reject the insert.
 */
export const EMBEDDING_DIM = 768;

let extractor: unknown = null;

export async function initEmbeddings(): Promise<void> {
  if (extractor) return;
  // q8 quantization keeps the model under ~150MB so it fits alongside the
  // worker's other memory on Render's 512MB starter plan. fp32 loaded ~550MB
  // and OOM-killed the worker on every MCP ingest cycle. Override with
  // EMBEDDING_DTYPE if running on a larger instance and absolute fidelity
  // is required (q8 cosine similarity is within ~1% of fp32).
  const dtype = process.env.EMBEDDING_DTYPE ?? 'q8';
  console.log(`Loading embedding model (nomic-embed-text-v1.5, dtype=${dtype})...`);
  const { pipeline } = await import('@huggingface/transformers');
  extractor = await (pipeline as (...args: unknown[]) => Promise<unknown>)('feature-extraction', 'nomic-ai/nomic-embed-text-v1.5', {
    dtype,
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
