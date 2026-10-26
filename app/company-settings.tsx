"use client";
import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
} from "react";
import { Upload, RotateCcw, Image as ImageIcon, Check } from "lucide-react";
import CompanyMark from "./company-mark";
import { COMPANY_FIELDS, MAX_LOGO_BYTES } from "../lib/branding";
import "./company-settings.css";

export default function CompanySettings({
  profile,
  onNotify,
  onSaved,
  onStateChange,
}: {
  profile: Record<string, string>;
  onNotify: (message: string) => void;
  onSaved: (profile: Record<string, string>) => void;
  onStateChange: (dirty: boolean, busy: boolean) => void;
}) {
  const [baseline, setBaseline] = useState(profile),
    [form, setForm] = useState(profile);
  const [file, setFile] = useState<File | null>(null),
    [preview, setPreview] = useState("");
  const [removeLogo, setRemoveLogo] = useState(false),
    [saving, setSaving] = useState(false);
  const [error, setError] = useState(""),
    [saved, setSaved] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null),
    objectUrl = useRef("");
  const dirty = Boolean(
    file ||
    removeLogo ||
    COMPANY_FIELDS.some((key) => (form[key] || "") !== (baseline[key] || "")),
  );
  useEffect(() => {
    onStateChange(dirty, saving);
  }, [dirty, saving, onStateChange]);
  useEffect(
    () => () => {
      if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
    },
    [],
  );
  function clearFile() {
    if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
    objectUrl.current = "";
    setPreview("");
    setFile(null);
  }
  function pick(event: ChangeEvent<HTMLInputElement>) {
    const next = event.target.files?.[0];
    event.target.value = "";
    if (!next) return;
    setError("");
    setSaved(false);
    if (next.size > MAX_LOGO_BYTES) {
      setError("Logo 不能超过 2MB，请先压缩图片。");
      return;
    }
    if (!/\.(png|jpe?g|webp)$/i.test(next.name)) {
      setError("请选择 PNG、JPG 或 WebP 图片，不支持 SVG、GIF。");
      return;
    }
    clearFile();
    objectUrl.current = URL.createObjectURL(next);
    setPreview(objectUrl.current);
    setFile(next);
    setRemoveLogo(false);
  }
  function reset() {
    clearFile();
    setForm(baseline);
    setRemoveLogo(false);
    setError("");
    setSaved(false);
  }
  async function save(event: FormEvent) {
    event.preventDefault();
    if (saving || !dirty) return;
    setSaving(true);
    setError("");
    setSaved(false);
    try {
      const data = new FormData();
      for (const key of COMPANY_FIELDS)
        if ((form[key] || "") !== (baseline[key] || ""))
          data.set(key, form[key] || "");
      if (file) data.set("logo", file);
      if (removeLogo) data.set("remove_logo", "true");
      const response = await fetch("/api/settings", {
        method: "PATCH",
        body: data,
      });
      const result = (await response.json()) as {
        error?: string;
        profile?: Record<string, string>;
      };
      if (!response.ok || !result.profile)
        throw new Error(result.error || "保存失败，请重试");
      const next = result.profile;
      setBaseline(next);
      setForm(next);
      clearFile();
      setRemoveLogo(false);
      setSaved(true);
      onSaved(next);
      onNotify("公司信息已保存，左上角品牌和图标已同步更新");
    } catch (e) {
      setError(
        e instanceof Error &&
          !(e instanceof TypeError) &&
          !(e instanceof SyntaxError)
          ? e.message
          : "网络异常或服务暂不可用，未保存的内容仍保留，请重试",
      );
    } finally {
      setSaving(false);
    }
  }
  const displayedLogo = preview || (removeLogo ? "" : baseline.logo_url || "");
  const set = (key: string, value: string) => {
    setForm((current) => ({ ...current, [key]: value }));
    setSaved(false);
  };
  return (
    <form
      className="settings-content company-form company-settings-form"
      onSubmit={save}
      aria-label="公司信息配置"
      aria-busy={saving}
    >
      <section
        className="company-logo-editor"
        aria-labelledby="company-logo-heading"
      >
        <div className="company-logo-preview">
          <CompanyMark profile={{ ...form, logo_url: displayedLogo }} />
        </div>
        <div className="company-logo-controls">
          <h3 id="company-logo-heading">
            <ImageIcon size={16} />
            公司 Logo / 左上角图标
          </h3>
          <p>
            支持 PNG、JPG、WebP，最大
            2MB。建议使用方形透明底图片；完整保留比例，不裁切。
          </p>
          <input
            ref={fileInput}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            aria-label="上传公司Logo"
            onChange={pick}
            hidden
            disabled={saving}
          />
          <div className="company-logo-actions">
            <button
              className="secondary-button"
              type="button"
              disabled={saving}
              onClick={() => fileInput.current?.click()}
            >
              <Upload size={14} />
              {displayedLogo ? "更换 Logo" : "上传 Logo"}
            </button>
            {displayedLogo && (
              <button
                type="button"
                className="company-text-button"
                disabled={saving}
                onClick={() => {
                  clearFile();
                  setRemoveLogo(Boolean(baseline.logo_url));
                  setSaved(false);
                  setError("");
                }}
              >
                移除图标
              </button>
            )}
            {(file || removeLogo) && (
              <span className="company-pending">待保存</span>
            )}
          </div>
          <small>点击下方“保存公司配置”后生效；没有图片时显示品牌首字。</small>
        </div>
      </section>
      <fieldset disabled={saving}>
        <div className="form-grid">
          <label>
            公司名称
            <input
              value={form.company_name || ""}
              required
              maxLength={200}
              onChange={(e) => set("company_name", e.target.value)}
            />
          </label>
          <label>
            对外品牌
            <input
              aria-label="对外品牌"
              aria-describedby="company-brand-help"
              value={form.brand || ""}
              required
              maxLength={100}
              onChange={(e) => set("brand", e.target.value)}
            />
            <small id="company-brand-help" className="company-field-help">
              同步显示在左上角和工作台浏览器标题。
            </small>
          </label>
          <label>
            销售邮箱
            <input
              type="email"
              value={form.sales_email || ""}
              maxLength={254}
              onChange={(e) => set("sales_email", e.target.value)}
            />
          </label>
          <label>
            WhatsApp
            <input
              type="tel"
              value={form.whatsapp || ""}
              maxLength={60}
              onChange={(e) => set("whatsapp", e.target.value)}
            />
          </label>
        </div>
        <label>
          官网
          <input
            type="url"
            placeholder="https://example.com"
            value={form.website || ""}
            maxLength={2048}
            onChange={(e) => set("website", e.target.value)}
          />
        </label>
        <label>
          公司业务简介
          <textarea
            rows={5}
            value={form.business_summary || ""}
            maxLength={10000}
            onChange={(e) => set("business_summary", e.target.value)}
          />
        </label>
        <label>
          AI 销售规则
          <textarea
            rows={6}
            value={form.sales_rules || ""}
            maxLength={10000}
            onChange={(e) => set("sales_rules", e.target.value)}
          />
        </label>
        <label>
          英文回复署名
          <textarea
            rows={4}
            value={form.reply_signature || ""}
            maxLength={8000}
            onChange={(e) => set("reply_signature", e.target.value)}
          />
        </label>
      </fieldset>
      {error && (
        <p className="company-error" role="alert">
          {error} 原有已保存配置不受影响。
        </p>
      )}
      <footer className="company-settings-footer">
        <span role="status" aria-live="polite">
          {saving ? (
            "正在保存，请稍候…"
          ) : dirty ? (
            "有未保存的修改"
          ) : saved ? (
            <>
              <Check size={14} />
              已保存
            </>
          ) : (
            "修改后请保存"
          )}
        </span>
        <button
          type="button"
          className="company-text-button"
          disabled={saving || !dirty}
          onClick={reset}
        >
          <RotateCcw size={14} />
          撤销修改
        </button>
        <button className="primary-button" disabled={saving || !dirty}>
          {saving ? "保存中…" : "保存公司配置"}
        </button>
      </footer>
    </form>
  );
}
