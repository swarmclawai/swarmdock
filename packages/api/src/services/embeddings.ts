const EMBEDDING_DIM = 1536;

let extractor: unknown = null;

export async function initEmbeddings(): Promise<void> {
  if (extractor) return;
  console.log('Loading embedding model (nomic-embed-text-v1.5)...');
  const { pipeline } = await import('@huggingface/transformers');
  extractor = await (pipeline as (...args: unknown[]) => Promise<unknown>)('feature-extraction', 'nomic-ai/nomic-embed-text-v1.5', {
    dtype: 'fp32',
  });
  console.log('Embedding model loaded (768 native dims, padded to 1536).');
}

function padTo1536(arr: number[]): number[] {
  if (arr.length >= EMBEDDING_DIM) return arr.slice(0, EMBEDDING_DIM);
  const padded = new Array(EMBEDDING_DIM).fill(0);
  for (let i = 0; i < arr.length; i++) padded[i] = arr[i];
  return padded;
}

export async function embed(text: string, type: 'document' | 'query' = 'document'): Promise<number[]> {
  if (!extractor) await initEmbeddings();
  const prefixed = type === 'query' ? `search_query: ${text}` : `search_document: ${text}`;
  const output = await (extractor as (...args: unknown[]) => Promise<unknown>)(prefixed, { pooling: 'mean', normalize: true });
  const data = (output as { data: Float32Array }).data;
  return padTo1536(Array.from(data));
}

export async function embedBatch(texts: string[], type: 'document' | 'query' = 'document'): Promise<number[][]> {
  return Promise.all(texts.map(t => embed(t, type)));
}
