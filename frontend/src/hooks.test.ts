import { expect, it, vi } from "vitest";
import { api } from "./api";
import { act, renderHook, waitFor } from "@testing-library/react";
import { fetchAllPages, useOptions, useResource } from "./hooks";
it.each([
  ["/tenants", "/tenants?optionsOnly=true&page=1&pageSize=100"],
  [
    "/users?role=Annotator",
    "/users?role=Annotator&optionsOnly=true&page=1&pageSize=100",
  ],
])("loads cleaned selector options for %s", async (path, expected) => {
  const get = vi
    .spyOn(api, "get")
    .mockResolvedValue({ items: [{ id: "real" }], totalPages: 1 });
  const { result } = renderHook(() => useOptions<{ id: string }>(path));
  await waitFor(() =>
    expect(result.current.data?.items).toEqual([{ id: "real" }]),
  );
  expect(get).toHaveBeenCalledWith(expected);
});
it("loads all selector pages beyond 100 without imposing an option cap", async () => {
  const get = vi.spyOn(api, "get").mockImplementation(async (path) => ({
    items: path.includes("page=1&")
      ? Array.from({ length: 100 }, (_, i) => ({ id: i }))
      : [{ id: 100 }],
    page: path.includes("page=1&") ? 1 : 2,
    totalPages: 2,
    pageSize: 100,
    totalItems: 101,
  }));
  const items = await fetchAllPages<{ id: number }>("/users?role=Annotator");
  expect(items).toHaveLength(101);
  expect(items.at(-1)?.id).toBe(100);
  expect(get).toHaveBeenNthCalledWith(
    2,
    "/users?role=Annotator&page=2&pageSize=100",
  );
});

it("hides previous results while another query is pending and after it fails", async () => {
  let rejectNext!: (reason: Error) => void;
  vi.spyOn(api, "get")
    .mockResolvedValueOnce({ total: 3000 })
    .mockImplementationOnce(
      () =>
        new Promise((_, reject) => {
          rejectNext = reject;
        }),
    );
  const { result, rerender } = renderHook(
    ({ path }) => useResource<{ total: number }>(path),
    { initialProps: { path: "/statistics?tenantId=a" } },
  );
  await waitFor(() => expect(result.current.data?.total).toBe(3000));
  rerender({ path: "/statistics?tenantId=b" });
  expect(result.current.loading).toBe(true);
  expect(result.current.data).toBeUndefined();
  await act(async () => rejectNext(new Error("offline")));
  expect(result.current.loading).toBe(false);
  expect(result.current.error).toBeInstanceOf(Error);
  expect(result.current.data).toBeUndefined();
});

it("ignores late responses from an obsolete query", async () => {
  let resolveOld!: (value: unknown) => void;
  vi.spyOn(api, "get")
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveOld = resolve;
        }),
    )
    .mockResolvedValueOnce({ total: 2000 });
  const { result, rerender } = renderHook(
    ({ path }) => useResource<{ total: number }>(path),
    { initialProps: { path: "/statistics?tenantId=a" } },
  );
  rerender({ path: "/statistics?tenantId=b" });
  await waitFor(() => expect(result.current.data?.total).toBe(2000));
  await act(async () => resolveOld({ total: 3000 }));
  expect(result.current.data?.total).toBe(2000);
});
