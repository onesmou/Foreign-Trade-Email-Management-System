export const CUSTOMER_PANES = ["customers", "detail", "ai"] as const;
export type CustomerPane = (typeof CUSTOMER_PANES)[number];
export type CustomerLayout = Record<CustomerPane, number>;
export type ColumnMode = "desktop" | "tablet" | "phone";
export const DEFAULT_CUSTOMER_LAYOUT: CustomerLayout = {
  customers: 22,
  detail: 40,
  ai: 38,
};
export const PANE_LABELS: Record<CustomerPane, string> = {
  customers: "全部客户",
  detail: "客户信息",
  ai: "客户 AI 助手",
};
export function parseCustomerLayout(value: unknown): CustomerLayout | null {
  try {
    const parsed = typeof value === "string" ? JSON.parse(value) : value;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      return null;
    const row = parsed as Record<string, unknown>;
    if (
      !CUSTOMER_PANES.every(
        (id) =>
          typeof row[id] === "number" &&
          Number.isFinite(row[id]) &&
          Number(row[id]) > 0 &&
          Number(row[id]) < 100,
      )
    )
      return null;
    const layout = {
      customers: Number(row.customers),
      detail: Number(row.detail),
      ai: Number(row.ai),
    };
    if (Math.abs(layout.customers + layout.detail + layout.ai - 100) > 0.1)
      return null;
    return layout;
  } catch {
    return null;
  }
}
export function responsiveCustomerLayout(
  mode: ColumnMode,
  hasCustomer: boolean,
  mobilePane: string,
  desktop: CustomerLayout,
): CustomerLayout {
  if (mode === "desktop") return desktop;
  if (mode === "tablet")
    return mobilePane === "ai" && hasCustomer
      ? { customers: 28, detail: 0, ai: 72 }
      : { customers: 28, detail: 72, ai: 0 };
  return !hasCustomer
    ? { customers: 100, detail: 0, ai: 0 }
    : mobilePane === "ai"
      ? { customers: 0, detail: 0, ai: 100 }
      : { customers: 0, detail: 100, ai: 0 };
}
