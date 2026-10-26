import { randomInt } from "node:crypto";
import sharp from "sharp";
// Font-independent synthetic image: no customer files are sent for capability checks.
export async function createVisionProbe(code = String(randomInt(1000, 10000))) {
  if (!/^\d{4}$/.test(code)) throw new Error("测试图编号无效");
  const digits = [
    "abcdef",
    "bc",
    "abdeg",
    "abcdg",
    "bcfg",
    "acdfg",
    "acdefg",
    "abc",
    "abcdefg",
    "abcdfg",
  ];
  const segments: Record<string, number[]> = {
    a: [4, 2, 20, 4],
    b: [24, 6, 4, 18],
    c: [24, 28, 4, 18],
    d: [4, 46, 20, 4],
    e: [0, 28, 4, 18],
    f: [0, 6, 4, 18],
    g: [4, 24, 20, 4],
  };
  const shapes = [...code]
    .map((digit, i) =>
      [...digits[Number(digit)]]
        .map((s) => {
          const [x, y, w, h] = segments[s];
          return `<rect x="${18 + i * 38 + x}" y="${12 + y}" width="${w}" height="${h}" fill="black"/>`;
        })
        .join(""),
    )
    .join("");
  const png = await sharp(
    Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="184" height="78"><rect width="184" height="78" fill="white"/>${shapes}</svg>`,
    ),
  )
    .png()
    .toBuffer();
  return { expected: code, image: png };
}
