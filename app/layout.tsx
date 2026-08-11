import type { Metadata } from "next";
import { headers } from "next/headers";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("host") || "localhost:3011";
  const protocol = requestHeaders.get("x-forwarded-proto") || (host.startsWith("localhost") ? "http" : "https");
  const image = `${protocol}://${host}/og.png`;
  return {
    title: "RehabIntl 询盘工作台",
    description: "客户询盘管理、AI分析与英文回复草稿工作台",
    openGraph: { title: "RehabIntl Inquiry CRM", description: "AI-assisted customer analysis & reply drafts", images: [image] },
    twitter: { card: "summary_large_image", title: "RehabIntl Inquiry CRM", description: "AI-assisted customer analysis & reply drafts", images: [image] },
  };
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="zh-CN"><body>{children}</body></html>;
}
