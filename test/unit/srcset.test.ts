import { describe, expect, it } from "vitest";
import { largestSrc, smallestSrc, srcsetAttr } from "../../src/shared/srcset";

const s = { "1920": "https://x/c.webp", "480": "https://x/a.webp", "960": "https://x/b.webp" };

describe("srcset helpers", () => {
  it("orders numerically, not lexically", () => {
    expect(srcsetAttr(s)).toBe("https://x/a.webp 480w, https://x/b.webp 960w, https://x/c.webp 1920w");
    expect(smallestSrc(s)).toBe("https://x/a.webp");
    expect(largestSrc(s)).toBe("https://x/c.webp");
  });
});
