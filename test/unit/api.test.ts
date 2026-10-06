import { describe, expect, it, vi } from "vitest";
import { ApiError, createStallTimer, errorMessage, interpretProbe } from "../../src/app/api";

describe("interpretProbe", () => {
  it("treats a redirect to the Access login or a 401 as an expired session", () => {
    expect(interpretProbe({ type: "opaqueredirect", status: 0 })).toBe("signin");
    expect(interpretProbe({ type: "basic", status: 401 })).toBe("signin");
    expect(interpretProbe({ type: "basic", status: 200 })).toBe("ok");
  });
});

describe("errorMessage", () => {
  it("tells the uploader to sign in again when the session expired", () => {
    expect(errorMessage(new ApiError(401, "signin_required", "x"))).toBe("Your sign-in expired. Close and reopen the app to sign in again.");
    expect(errorMessage(new ApiError(400, "bad_request", "Caption too long"))).toBe("Caption too long");
  });
});

describe("createStallTimer", () => {
  it("fires after ms without reset, not if reset in time, not after clear", () => {
    vi.useFakeTimers();
    try {
      const fn = vi.fn();
      const t = createStallTimer(1000, fn);
      t.reset();
      vi.advanceTimersByTime(999);
      expect(fn).not.toHaveBeenCalled();
      t.reset();
      vi.advanceTimersByTime(999);
      expect(fn).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1);
      expect(fn).toHaveBeenCalledTimes(1);

      const g = vi.fn();
      const u = createStallTimer(1000, g);
      u.reset();
      u.clear();
      vi.advanceTimersByTime(5000);
      expect(g).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});
