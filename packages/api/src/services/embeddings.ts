let extractor: unknown = null;

export async function initEmbeddings(): Promise<void> {
  if (extractor) return;
  console.log('Loading embedding model (nomic-embed-text-v1.5)...');
  const { pipeline } = await import('@huggingface/transformers');
  extractor = await (pipeline as Function)('feature-extraction', 'nomic-ai/nomic-embed-text-v1.5', {
    dtype: 'fp32',
  });
  console.log('Embedding model loaded.');
}

export async function embed(text: string, type: 'document' | 'query' = 'document'): Promise<number[]> {
  if (!extractor) await initEmbeddings();
  const prefixed = type === 'query' ? `search_query: ${text}` : `search_document: ${text}`;
  const output = await (extractor as Function)(prefixed, { pooling: 'mean', normalize: true });
  const data = (output as { data: Float32Array }).data;
  return Array.from(data).slice(0, 768);
}

export async function embedBatch(texts: string[], type: 'document' | 'query' = 'document'): Promise<number[][]> {
  return Promise.all(texts.map(t => embed(t, type)));
}
