// The team's own logo as its coach's browser makes it, from a picture they
// uploaded or one picked on the club's website: square, LOGO_SIZE pixels a
// side, as a PNG data: URL (what lib/teamSetup.js sanitizeLogo keeps). The
// see-through margin round the picture is cut away first and what is left is
// drawn as big as it fits, whole and centred, so the logo starts out filling
// its circle as far as it can without losing an edge; the coach can enlarge
// it from there (the team's logoFill).
//
// containIn and opaqueBounds are plain arithmetic, for the tests; fitLogo and
// fileToDataUrl need a browser.

export const LOGO_SIZE = 256;
// What the server keeps is at most 300,000 characters; a picture that comes
// out bigger than this (a photo, say) is made again smaller.
const MAX_CHARS = 290_000;

export const FIT_ERRORS = {
  unreadable: "That picture couldn't be opened. Try a PNG or JPG, or another of the logos.",
  empty: "That picture is blank. Try another.",
  blocked: "This browser won't let that picture be used here. Save it from the club's site and upload it instead.",
  tooBig: "That picture is too detailed to keep as a logo. Try another, or a simpler version of it."
};

// Where a w by h picture sits, whole, in a size by size square: as big as it
// fits, centred. `s` is how much it was scaled.
export function containIn(w, h, size) {
  const s = Math.min(size / w, size / h);
  const dw = w * s, dh = h * s;
  return { s, dx: (size - dw) / 2, dy: (size - dh) / 2, dw, dh };
}

// The box round the part of a picture that can be seen, from canvas pixels
// (RGBA, 4 bytes each): { x, y, w, h }, or null when every pixel is see-through.
// A pixel counts once it is more than `min` of 255 opaque.
export function opaqueBounds(rgba, width, height, min = 8) {
  let x0 = width, y0 = height, x1 = -1, y1 = -1;
  for (let y = 0; y < height; y++) {
    const row = y * width * 4;
    for (let x = 0; x < width; x++) {
      if (rgba[row + x * 4 + 3] > min) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

const failWith = (key) => Object.assign(new Error(FIT_ERRORS[key]), { fitError: key });

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(failWith("unreadable"));
    img.src = src;
  });
}

// The picture at `src` (a data: URL) as the team's logo. Rejects with an
// Error whose message is for the coach (FIT_ERRORS).
export async function fitLogo(src) {
  const img = await loadImage(src);
  // A picture with no size of its own (an SVG with only a viewBox) is drawn
  // into the square, keeping its shape as an SVG does.
  const w = img.naturalWidth || img.width || LOGO_SIZE, h = img.naturalHeight || img.height || LOGO_SIZE;
  // Drawn at twice the size first, to find its see-through margin without
  // losing detail when what is left is drawn again.
  const big = LOGO_SIZE * 2;
  const work = document.createElement("canvas");
  work.width = big; work.height = big;
  const wctx = work.getContext("2d");
  if (!wctx) throw failWith("blocked");
  const at = containIn(w, h, big);
  wctx.drawImage(img, at.dx, at.dy, at.dw, at.dh);
  let seen;
  try { seen = opaqueBounds(wctx.getImageData(0, 0, big, big).data, big, big); } catch { throw failWith("blocked"); }
  if (!seen) throw failWith("empty");
  for (const size of [LOGO_SIZE, 192, 128]) {
    const out = document.createElement("canvas");
    out.width = size; out.height = size;
    const fit = containIn(seen.w, seen.h, size);
    out.getContext("2d").drawImage(work, seen.x, seen.y, seen.w, seen.h, fit.dx, fit.dy, fit.dw, fit.dh);
    let url;
    try { url = out.toDataURL("image/png"); } catch { throw failWith("blocked"); }
    if (url.length <= MAX_CHARS) return url;
  }
  throw failWith("tooBig");
}

// A file the coach chose, as a data: URL.
export function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(failWith("unreadable"));
    reader.readAsDataURL(file);
  });
}
