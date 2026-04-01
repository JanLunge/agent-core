export interface EmbeddingProvider {
  embed(text: string): Promise<number[]>;
  embedBatch(texts: string[]): Promise<number[][]>;
  dimensions: number;
}

export function createOllamaEmbedder(opts: {
  baseUrl?: string;
  model?: string;
  dimensions?: number;
} = {}): EmbeddingProvider {
  const baseUrl = (opts.baseUrl ?? 'http://localhost:11434').replace(/\/$/, '');
  const model = opts.model ?? 'nomic-embed-text';
  const dimensions = opts.dimensions ?? 768;

  return {
    dimensions,

    async embed(text: string): Promise<number[]> {
      const res = await fetch(`${baseUrl}/api/embed`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, input: text }),
      });
      if (!res.ok) {
        throw new Error(`Ollama embed failed (${res.status}): ${await res.text()}`);
      }
      const data = (await res.json()) as { embeddings: number[][] };
      return data.embeddings[0];
    },

    async embedBatch(texts: string[]): Promise<number[][]> {
      const res = await fetch(`${baseUrl}/api/embed`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, input: texts }),
      });
      if (!res.ok) {
        throw new Error(`Ollama embed batch failed (${res.status}): ${await res.text()}`);
      }
      const data = (await res.json()) as { embeddings: number[][] };
      return data.embeddings;
    },
  };
}

export function createOpenAIEmbedder(opts: {
  baseUrl?: string;
  apiKey: string;
  model?: string;
  dimensions?: number;
}): EmbeddingProvider {
  const baseUrl = (opts.baseUrl ?? 'https://api.openai.com/v1').replace(/\/$/, '');
  const model = opts.model ?? 'text-embedding-3-small';
  const dimensions = opts.dimensions ?? 1536;

  return {
    dimensions,

    async embed(text: string): Promise<number[]> {
      const res = await fetch(`${baseUrl}/embeddings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${opts.apiKey}`,
        },
        body: JSON.stringify({ model, input: text }),
      });
      if (!res.ok) {
        throw new Error(`OpenAI embed failed (${res.status}): ${await res.text()}`);
      }
      const data = (await res.json()) as { data: { embedding: number[] }[] };
      return data.data[0].embedding;
    },

    async embedBatch(texts: string[]): Promise<number[][]> {
      const res = await fetch(`${baseUrl}/embeddings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${opts.apiKey}`,
        },
        body: JSON.stringify({ model, input: texts }),
      });
      if (!res.ok) {
        throw new Error(`OpenAI embed batch failed (${res.status}): ${await res.text()}`);
      }
      const data = (await res.json()) as { data: { embedding: number[] }[] };
      return data.data.map((d) => d.embedding);
    },
  };
}
