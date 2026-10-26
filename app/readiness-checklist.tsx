"use client";
import { useState, useCallback } from "react";
type Readiness = {
  providers: {
    id: number;
    name: string;
    last_test_status: string;
    passed: number;
  }[];
  materials: number;
  materialsPending: number;
  whatsapp: { connected: boolean; selected: number; messages: number };
  sources: number;
  submissions: number;
  backup: {
    enabled: number;
    workerHealthy: boolean;
    lastRun?: { status: string };
  };
  notice: string;
};
export default function ReadinessChecklist() {
  const [data, setData] = useState<Readiness | null>(null),
    [error, setError] = useState("");
  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/readiness", { cache: "no-store" });
      if (!r.ok) throw new Error("仅管理员可查看配置检查");
      setData(await r.json());
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  return (
    <details
      className="v2-card v2-readiness"
      onToggle={(e) => {
        if (e.currentTarget.open && !data) void load();
      }}
    >
      <summary>上线配置与验收清单</summary>
      <button type="button" className="v2-button" onClick={() => void load()}>
        刷新配置状态（不调用外部服务）
      </button>
      {error && <p role="alert">{error}</p>}
      {data && (
        <>
          <p>
            AI：
            {data.providers.length
              ? data.providers
                  .map(
                    (p) =>
                      `${p.name}：${p.last_test_status === "success" ? "文本连接通过" : "连接未验证"}，${p.passed}项能力通过`,
                  )
                  .join("；")
              : "待设置 → AI模型中配置并分项测试"}
          </p>
          <p>
            资料：{data.materials}份可检索，{data.materialsPending}
            份待整理/待审核。实际找报价、目录和图片仍需样例验收。
          </p>
          <p>
            普通WhatsApp：{data.whatsapp.connected ? "已连接" : "未连接"}；已选
            {data.whatsapp.selected}位客户，已收{data.whatsapp.messages}
            条平台记录。请用指定测试联系人验证手机回复、附件及头像，存在记录不等于完整验收。
          </p>
          <p>
            网站/广告：{data.sources}个启用入口，{data.submissions}
            次提交。请将入口链接放到实际渠道并自行提交测试，不会自动修改公司网站。
          </p>
          <p>
            每日备份：
            {data.backup.enabled
              ? data.backup.workerHealthy
                ? "已启用，后台正常"
                : "已启用，后台待检查"
              : "未启用"}
            ；最近执行
            {data.backup.lastRun?.status === "success"
              ? "成功"
              : "尚未成功验证"}
            。异地备份仍需下载保存。
          </p>
          <p>
            安卓：请在小米十五上检查登录、键盘、图片上传、附件下载和重新打开；网页无法代替真机验收。
          </p>
          <small>{data.notice}</small>
        </>
      )}
    </details>
  );
}
