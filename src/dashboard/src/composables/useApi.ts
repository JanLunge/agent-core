import { ref, type Ref } from 'vue';

const BASE = '';

export interface ApiResult<T> {
  data: Ref<T | null>;
  loading: Ref<boolean>;
  error: Ref<string | null>;
  refresh: () => Promise<void>;
}

export function useApi<T>(url: string, immediate = true): ApiResult<T> {
  const data = ref<T | null>(null) as Ref<T | null>;
  const loading = ref(false);
  const error = ref<string | null>(null);

  async function refresh() {
    loading.value = true;
    error.value = null;
    try {
      const res = await fetch(`${BASE}${url}`);
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      data.value = await res.json();
    } catch (err) {
      error.value = err instanceof Error ? err.message : String(err);
    } finally {
      loading.value = false;
    }
  }

  if (immediate) refresh();
  return { data, loading, error, refresh };
}

export async function apiFetch<T>(url: string): Promise<T> {
  const res = await fetch(`${BASE}${url}`);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}
