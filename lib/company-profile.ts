import "server-only";
import { createHash } from "node:crypto";
import sharp from "sharp";
import { audit, getDb } from "./db";
import { COMPANY_FIELDS, MAX_LOGO_BYTES, type CompanyField } from "./branding";

export class CompanyInputError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
export function companyProfile() {
  const db = getDb();
  const profile = db
    .prepare("SELECT * FROM company_profile WHERE id=1")
    .get() as Record<string, string>;
  const logo = db
    .prepare("SELECT sha256 FROM company_branding WHERE id=1")
    .get() as { sha256: string } | undefined;
  return {
    ...profile,
    logo_url: logo ? `/api/company-logo?v=${logo.sha256}` : "",
  };
}
const limits: Record<CompanyField, number> = {
  company_name: 200,
  brand: 100,
  sales_email: 254,
  whatsapp: 60,
  website: 2048,
  business_summary: 10000,
  sales_rules: 10000,
  reply_signature: 8000,
};
const labels: Record<CompanyField, string> = {
  company_name: "公司名称",
  brand: "对外品牌",
  sales_email: "销售邮箱",
  whatsapp: "WhatsApp",
  website: "官网",
  business_summary: "公司业务简介",
  sales_rules: "AI 销售规则",
  reply_signature: "英文回复署名",
};
async function boundedBody(request: Request) {
  const max = MAX_LOGO_BYTES + 128 * 1024;
  if (Number(request.headers.get("content-length")) > max)
    throw new CompanyInputError("请求过大：Logo 不得超过 2MB", 413);
  const reader = request.body?.getReader();
  if (!reader) throw new CompanyInputError("没有收到公司配置");
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel();
      throw new CompanyInputError("请求过大：Logo 不得超过 2MB", 413);
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}
async function normalizedLogo(file: File) {
  if (!file.size || file.size > MAX_LOGO_BYTES)
    throw new CompanyInputError(
      "请选择不超过 2MB 的 Logo 图片",
      file.size ? 413 : 400,
    );
  const bytes = Buffer.from(await file.arrayBuffer());
  const jpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  const png = bytes
    .subarray(0, 8)
    .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const webp =
    bytes.toString("ascii", 0, 4) === "RIFF" &&
    bytes.toString("ascii", 8, 12) === "WEBP";
  if (!jpeg && !png && !webp)
    throw new CompanyInputError(
      "Logo 仅支持 PNG、JPG、WebP 静态图片，不支持 SVG 或 GIF",
    );
  try {
    const image = sharp(bytes, {
      limitInputPixels: 16_000_000,
      failOn: "warning",
    });
    const info = await image.metadata();
    if (!info.width || !info.height || (info.pages || 1) !== 1)
      throw new Error("invalid image");
    // Decode/re-encode: no original filename, scripts or metadata are served.
    return await image
      .rotate()
      .resize(512, 512, { fit: "inside", withoutEnlargement: true })
      .webp({ quality: 90 })
      .toBuffer();
  } catch {
    throw new CompanyInputError(
      "图片无法读取、为动画或尺寸过大，请换一张静态图片（最多 1600 万像素）",
    );
  }
}
export async function saveCompanyProfile(request: Request, userId: number) {
  const bytes = await boundedBody(request);
  let input: Record<string, unknown>;
  let file: File | null = null;
  let removeLogo = false;
  try {
    if (
      request.headers.get("content-type")?.startsWith("multipart/form-data")
    ) {
      const form = await new Request(request.url, {
        method: "POST",
        headers: request.headers,
        body: bytes,
      }).formData();
      input = Object.fromEntries(
        COMPANY_FIELDS.filter((key) => form.has(key)).map((key) => [
          key,
          form.get(key),
        ]),
      );
      const uploaded = form.get("logo");
      if (uploaded instanceof File) file = uploaded;
      removeLogo = form.get("remove_logo") === "true";
    } else {
      const parsed = JSON.parse(bytes.toString("utf8"));
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
        throw new Error();
      input = parsed;
      removeLogo = input.remove_logo === true;
    }
  } catch {
    throw new CompanyInputError("公司配置格式不正确，请重新选择文件后再保存");
  }
  if (file && removeLogo)
    throw new CompanyInputError("不能同时上传和移除 Logo");
  const changed: Partial<Record<CompanyField, string>> = {};
  for (const key of COMPANY_FIELDS) {
    if (!(key in input)) continue;
    if (typeof input[key] !== "string")
      throw new CompanyInputError(`${labels[key]}格式不正确`);
    const value = (input[key] as string).trim();
    if (value.length > limits[key])
      throw new CompanyInputError(
        `${labels[key]}不能超过 ${limits[key]} 个字符`,
      );
    if ((key === "brand" || key === "company_name") && !value)
      throw new CompanyInputError(`${labels[key]}不能为空`);
    if (
      key === "sales_email" &&
      value &&
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
    )
      throw new CompanyInputError("请输入有效的销售邮箱");
    if (key === "website" && value) {
      try {
        const url = new URL(value);
        if (
          !["http:", "https:"].includes(url.protocol) ||
          url.username ||
          url.password
        )
          throw new Error();
      } catch {
        throw new CompanyInputError(
          "官网请填写完整的 http:// 或 https:// 地址",
        );
      }
    }
    changed[key] = value;
  }
  const logo = file ? await normalizedLogo(file) : null;
  const db = getDb();
  db.exec("BEGIN IMMEDIATE");
  try {
    const keys = Object.keys(changed) as CompanyField[];
    if (keys.length)
      db.prepare(
        `UPDATE company_profile SET ${keys.map((key) => `${key}=?`).join(",")},updated_at=CURRENT_TIMESTAMP WHERE id=1`,
      ).run(...keys.map((key) => changed[key]!));
    if (logo)
      db.prepare(
        "INSERT INTO company_branding(id,logo,sha256) VALUES(1,?,?) ON CONFLICT(id) DO UPDATE SET logo=excluded.logo,sha256=excluded.sha256,updated_at=CURRENT_TIMESTAMP",
      ).run(logo, createHash("sha256").update(logo).digest("hex"));
    else if (removeLogo)
      db.prepare("DELETE FROM company_branding WHERE id=1").run();
    if (keys.length || logo || removeLogo)
      audit(
        userId,
        "更新公司配置",
        "company_profile",
        "1",
        logo ? "更换Logo" : removeLogo ? "移除Logo" : "",
      );
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  return companyProfile();
}
