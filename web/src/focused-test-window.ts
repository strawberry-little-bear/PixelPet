import { beforeEach, vi } from "vitest";

// jsdom has no operating-system window and reports hasFocus() as false even
// when tests type on its keys. Existing interaction tests model a focused tab;
// initial/background-focus tests explicitly override this browser signal.
beforeEach(() => { vi.spyOn(document, "hasFocus").mockReturnValue(true); });
