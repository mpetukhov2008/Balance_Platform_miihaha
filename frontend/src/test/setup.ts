import { afterEach, beforeEach } from "vitest";
import { cleanup } from "@testing-library/react";

// Существующие тесты проверяют технические подписи — по умолчанию продвинутый режим.
beforeEach(() => localStorage.setItem("bp-mode", "advanced"));
afterEach(() => {
  cleanup();
  localStorage.clear();
});
