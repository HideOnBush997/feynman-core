import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";
import { sessionStore } from "./api";
afterEach(() => {
  cleanup();
  sessionStore.set(null);
});
