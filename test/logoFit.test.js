import { describe, it, expect } from "vitest";
import { containIn, opaqueBounds } from "@/lib/logoFit";

// lib/logoFit.js: the arithmetic of fitting a picture into the team's square
// logo. The drawing itself needs a browser's canvas (seen in the app).
describe("containIn", () => {
  it("fits a picture whole in the square, as big as it goes, centred", () => {
    expect(containIn(512, 256, 256)).toEqual({ s: 0.5, dx: 0, dy: 64, dw: 256, dh: 128 });
    expect(containIn(100, 200, 256)).toEqual({ s: 1.28, dx: 64, dy: 0, dw: 128, dh: 256 });
    expect(containIn(64, 64, 256)).toEqual({ s: 4, dx: 0, dy: 0, dw: 256, dh: 256 });
  });
});

describe("opaqueBounds", () => {
  // A w by h picture, see-through but for the pixels given (x, y, alpha).
  const picture = (w, h, dots) => {
    const px = new Uint8ClampedArray(w * h * 4);
    for (const [x, y, a = 255] of dots) px[(y * w + x) * 4 + 3] = a;
    return px;
  };

  it("finds the box round what can be seen", () => {
    expect(opaqueBounds(picture(10, 8, [[2, 3], [7, 5], [4, 1]]), 10, 8)).toEqual({ x: 2, y: 1, w: 6, h: 5 });
    expect(opaqueBounds(picture(4, 4, [[0, 0], [3, 3]]), 4, 4)).toEqual({ x: 0, y: 0, w: 4, h: 4 });
    expect(opaqueBounds(picture(5, 5, [[2, 2]]), 5, 5)).toEqual({ x: 2, y: 2, w: 1, h: 1 });
  });

  it("passes over pixels too faint to see, and says when nothing can be seen", () => {
    expect(opaqueBounds(picture(6, 6, [[0, 0, 8], [5, 5, 3], [2, 3, 9]]), 6, 6)).toEqual({ x: 2, y: 3, w: 1, h: 1 });
    expect(opaqueBounds(picture(6, 6, [[1, 1, 8]]), 6, 6)).toBeNull();
    expect(opaqueBounds(picture(3, 3, []), 3, 3)).toBeNull();
  });
});
