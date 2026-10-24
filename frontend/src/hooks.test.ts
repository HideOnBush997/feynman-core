import { expect, it, vi } from "vitest";
import { api } from "./api";
import { fetchAllPages } from "./hooks";
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
