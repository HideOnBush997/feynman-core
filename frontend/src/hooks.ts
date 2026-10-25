import { useEffect, useState } from "react";
import { api } from "./api";
import type { Page } from "./types";
export async function fetchAllPages<T>(path: string): Promise<T[]> {
  const separator = path.includes("?") ? "&" : "?";
  const first = await api.get<Page<T>>(
    `${path}${separator}page=1&pageSize=100`,
  );
  const result = [...first.items];
  for (let page = 2; page <= first.totalPages; page++) {
    const next = await api.get<Page<T>>(
      `${path}${separator}page=${page}&pageSize=100`,
    );
    result.push(...next.items);
  }
  return result;
}
export function useOptions<T>(path: string | null, revision = 0) {
  const [data, setData] = useState<{ items: T[] }>();
  const [error, setError] = useState<unknown>();
  useEffect(() => {
    let alive = true;
    if (!path) return;
    setError(undefined);
    fetchAllPages<T>(`${path}${path.includes("?") ? "&" : "?"}optionsOnly=true`)
      .then((items) => {
        if (alive) setData({ items });
      })
      .catch((e) => {
        if (alive) setError(e);
      });
    return () => {
      alive = false;
    };
  }, [path, revision]);
  return { data, error };
}
export function useResource<T>(path: string | null, revision = 0) {
  const [state, setState] = useState<{
    path: string | null;
    revision: number;
    data?: T;
    error?: unknown;
    loading: boolean;
  }>({ path, revision, loading: !!path });
  useEffect(() => {
    let alive = true;
    if (!path) {
      setState({ path, revision, loading: false });
      return;
    }
    setState({ path, revision, loading: true });
    api
      .get<T>(path)
      .then((value) => {
        if (alive) setState({ path, revision, data: value, loading: false });
      })
      .catch((e) => {
        if (alive) setState({ path, revision, error: e, loading: false });
      });
    return () => {
      alive = false;
    };
  }, [path, revision]);
  const current = state.path === path && state.revision === revision;
  return {
    data: current ? state.data : undefined,
    error: current ? state.error : undefined,
    loading: current ? state.loading : !!path,
  };
}
