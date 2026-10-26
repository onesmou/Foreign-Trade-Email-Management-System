export const COMPANY_FIELDS = [
  "company_name",
  "brand",
  "sales_email",
  "whatsapp",
  "website",
  "business_summary",
  "sales_rules",
  "reply_signature",
] as const;
export type CompanyField = (typeof COMPANY_FIELDS)[number];
export const MAX_LOGO_BYTES = 2 * 1024 * 1024;
export function companyBrand(profile?: Record<string, string> | null) {
  return profile?.brand?.trim() || profile?.company_name?.trim() || "RehabIntl";
}
