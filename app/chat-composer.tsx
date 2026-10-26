"use client";
import { useRef, useState } from "react";
import { ImagePlus, Send, Square, X } from "lucide-react";
import NextImage from "next/image";
type Image = { id: string; url: string; name: string };
export function SavedChatImages({ value }: { value: string }) {
  let ids: string[] = [];
  try {
    ids = JSON.parse(value || "[]");
  } catch {}
  return (
    <div className="v2-chat-images">
      {ids
        .filter((id) => /^[a-f0-9-]{36}$/.test(id))
        .map((id) => (
          <a
            key={id}
            href={`/api/chat/images?id=${id}`}
            target="_blank"
            rel="noreferrer"
          >
            <NextImage
              unoptimized
              width={100}
              height={88}
              src={`/api/chat/images?id=${id}`}
              alt="本条对话附图"
              loading="lazy"
            />
          </a>
        ))}
    </div>
  );
}
export default function ChatComposer({
  customerId,
  projectId,
  text,
  onText,
  disabled,
  generating,
  onStop,
  onSubmit,
  onNotify,
  placeholder,
}: {
  customerId: number;
  projectId: number;
  text: string;
  onText: (s: string) => void;
  disabled: boolean;
  generating: boolean;
  onStop: () => void;
  onSubmit: (text: string, images: string[]) => Promise<boolean>;
  onNotify: (s: string) => void;
  placeholder: string;
}) {
  const [images, setImages] = useState<Image[]>([]),
    [uploading, setUploading] = useState(false);
  const chooser = useRef<HTMLInputElement>(null),
    uploadLock = useRef(false),
    sendLock = useRef(false);
  const blocked = disabled || generating || uploading;
  async function add(files: File[]) {
    if (blocked || uploadLock.current) return;
    const accepted = files.filter((f) =>
      /^image\/(png|jpeg|webp)$/.test(f.type),
    );
    if (!accepted.length) {
      onNotify("请粘贴或选择 PNG、JPG、WebP 图片");
      return;
    }
    if (images.length + accepted.length > 4) {
      onNotify("每条对话最多4张图片");
      return;
    }
    uploadLock.current = true;
    setUploading(true);
    try {
      for (const file of accepted) {
        if (file.size > 8 * 1024 * 1024) throw new Error("单张图片须小于8MB");
        const form = new FormData();
        form.set("customerId", String(customerId));
        form.set("projectId", String(projectId));
        form.set("image", file);
        const response = await fetch("/api/chat/images", {
          method: "POST",
          body: form,
        });
        const d = await response.json();
        if (!response.ok) throw new Error(d.error || "图片上传失败");
        setImages((prev) => [...prev, d.image]);
      }
    } catch (e) {
      onNotify((e as Error).message);
    } finally {
      uploadLock.current = false;
      setUploading(false);
    }
  }
  async function submit() {
    if (blocked || sendLock.current || (!text.trim() && !images.length)) return;
    sendLock.current = true;
    try {
      if (
        await onSubmit(
          text,
          images.map((i) => i.id),
        )
      )
        setImages([]);
    } finally {
      sendLock.current = false;
    }
  }
  return (
    <form
      className="v2-ai-compose"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
      onPaste={(e) => {
        const files = Array.from(e.clipboardData.items)
          .filter((i) => i.kind === "file" && i.type.startsWith("image/"))
          .map((i) => i.getAsFile())
          .filter((f): f is File => Boolean(f));
        if (files.length) {
          e.preventDefault();
          void add(files);
        }
      }}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes("Files")) e.preventDefault();
      }}
      onDrop={(e) => {
        if (e.dataTransfer.files.length) {
          e.preventDefault();
          void add(Array.from(e.dataTransfer.files));
        }
      }}
    >
      {images.length > 0 && (
        <div className="v2-chat-images pending">
          {images.map((image) => (
            <figure key={image.id}>
              <NextImage
                unoptimized
                width={100}
                height={88}
                src={image.url}
                alt={image.name}
              />
              <button
                type="button"
                aria-label={`移除图片 ${image.name}`}
                disabled={blocked}
                onClick={() =>
                  setImages((prev) => prev.filter((i) => i.id !== image.id))
                }
              >
                <X size={13} />
              </button>
            </figure>
          ))}
        </div>
      )}
      <textarea
        aria-label="与客户AI助手对话"
        placeholder={placeholder}
        value={text}
        onChange={(e) => onText(e.target.value)}
        disabled={disabled || generating}
        rows={3}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            void submit();
          }
        }}
      />
      <input
        ref={chooser}
        type="file"
        hidden
        accept="image/png,image/jpeg,image/webp"
        multiple
        onChange={(e) => {
          void add(Array.from(e.target.files || []));
          e.target.value = "";
        }}
      />
      <div>
        <button
          type="button"
          className="v2-image-add"
          aria-label="添加图片"
          disabled={blocked}
          onClick={() => chooser.current?.click()}
        >
          <ImagePlus size={17} />
        </button>
        <small>
          {uploading
            ? "正在上传图片…"
            : images.length
              ? `${images.length}/4 张图片 · 仅当前客户/项目`
              : "可粘贴/拖入图片，或点击添加"}
        </small>
        {generating ? (
          <button
            type="button"
            className="v2-send"
            aria-label="停止生成"
            onClick={onStop}
          >
            <Square size={15} />
          </button>
        ) : (
          <button
            className="v2-send"
            aria-label="发送给AI"
            disabled={blocked || (!text.trim() && !images.length)}
          >
            <Send size={16} />
          </button>
        )}
      </div>
      <p className="v2-image-hint">
        图片会随对话交给当前 AI 接口；需要支持看图的模型，不会发送给客户。
      </p>
    </form>
  );
}
