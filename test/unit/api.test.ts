import { describe, expect, it } from "vitest";
import { ApiError, errorMessage, interpretProbe } from "../../src/app/api";

describe("interpretProbe", () => {
  it("treats a redirect to the Access login or a 401 as an expired session", () => {
    expect(interpretProbe({ type: "opaqueredirect", status: 0 })).toBe("signin");
    expect(interpretProbe({ type: "basic", status: 401 })).toBe("signin");
    expect(interpretProbe({ type: "basic", status: 200 })).toBe("ok");
  });
});

describe("errorMessage", () => {
  it("tells the uploader to sign in again when the session expired", () => {
    expect(errorMessage(new ApiError(401, "signin_required", "x"))).toBe("Your sign-in expired. Reload the page to sign in again.");
    expect(errorMessage(new ApiError(400, "bad_request", "Caption too long"))).toBe("Caption too long");
  });
});
