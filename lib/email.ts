export type ParsedEmail = {
  name: string; email: string; company: string; country: string; phone: string;
  subject: string; body: string; receivedAt: string; confidence: number;
};

export function parseRawEmail(rawInput: string): ParsedEmail {
  const raw = rawInput.replace(/\r\n/g, "\n").trim();
  const unfolded = raw.replace(/\n[ \t]+/g, " ");
  const split = unfolded.search(/\n\s*\n/);
  const headerText = split >= 0 ? unfolded.slice(0, split) : "";
  let body = split >= 0 ? unfolded.slice(split).replace(/^\s+/, "") : raw;
  const headers = new Map<string, string>();
  for (const line of headerText.split("\n")) {
    const match = line.match(/^([A-Za-z-]+):\s*(.*)$/);
    if (match) headers.set(match[1].toLowerCase(), match[2].trim());
  }

  const from = headers.get("reply-to") || headers.get("from") || "";
  const allText = `${from}\n${raw}`;
  const emailMatch = allText.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  const email = emailMatch?.[0]?.toLowerCase() || "";
  const fromName = from.replace(/<[^>]+>/g, "").replace(/^['"]|['"]$/g, "").trim();
  const fallbackName = email ? findNameNearEmail(raw, email) : "";
  const name = cleanName(fromName || fallbackName || email.split("@")[0] || "待识别客户");
  const subject = headers.get("subject") || matchLabel(raw, ["主题", "Subject", "邮件主题"]) || "无主题询盘";
  const date = headers.get("date") || "";
  const receivedAt = safeDate(date);
  if (split < 0) body = stripLeadingMetadata(body, [email, subject, name]);
  const company = findCompany(raw, email);
  const country = findCountry(raw, email);
  const phone = raw.match(/(?:\+|00)?\d[\d\s().-]{7,}\d/)?.[0]?.trim() || "";
  const confidence = email ? (headers.size >= 2 ? 92 : 74) : 35;
  return { name, email, company, country, phone, subject: decodeMimeWord(subject), body: body.trim(), receivedAt, confidence };
}

function matchLabel(raw: string, labels: string[]) {
  for (const label of labels) {
    const match = raw.match(new RegExp(`(?:^|\\n)${label}[:：]\\s*(.+)`, "i"));
    if (match) return match[1].trim();
  }
  return "";
}

function findNameNearEmail(raw: string, email: string) {
  const index = raw.toLowerCase().indexOf(email.toLowerCase());
  const nearby = raw.slice(Math.max(0, index - 100), index);
  const quoted = nearby.match(/["“]([^"”\n]{2,50})["”]\s*<?\s*$/);
  if (quoted) return quoted[1];
  const line = nearby.split("\n").pop()?.replace(/(?:From|发件人|Email|邮箱)[:：]?/gi, "").replace(/[<>()]/g, "").trim();
  return line && line.length <= 60 ? line : "";
}

function cleanName(value: string) {
  return value.replace(/[<>]/g, "").replace(/\s+/g, " ").slice(0, 80).trim();
}

function findCompany(raw: string, email: string) {
  const labelled = matchLabel(raw, ["Company", "Organization", "公司", "单位"]);
  if (labelled) return labelled.slice(0, 120);
  const signatureLines = raw.split("\n").slice(-18).filter((line) => !/^(From|To|Date|Subject|Reply-To|发件人|收件人|日期|主题)[:：]/i.test(line.trim()) && !line.includes("@"));
  const companyLine = signatureLines.reverse().find((line) => line.trim().length <= 120 && /\b(ltd|limited|inc\.?|llc|gmbh|sarl|trading|clinic|hospital|rehab|medical|healthcare|center|centre)\b/i.test(line));
  if (companyLine) return companyLine.trim().slice(0, 120);
  const domain = email.split("@")[1]?.split(".")[0] || "";
  return /^(gmail|hotmail|outlook|yahoo|icloud|qq|163|126)$/i.test(domain) ? "" : domain.replace(/[-_]/g, " ").replace(/\b\w/g, (m) => m.toUpperCase());
}

function findCountry(raw: string, email: string) {
  const countries = ["Germany", "UAE", "United Arab Emirates", "Saudi Arabia", "Philippines", "Malaysia", "Indonesia", "Thailand", "Vietnam", "India", "Pakistan", "Brazil", "Mexico", "Chile", "Peru", "Egypt", "Turkey", "Türkiye", "Poland", "France", "Italy", "Spain", "United Kingdom", "UK", "United States", "USA", "Canada", "Australia", "Nigeria", "Kenya", "South Africa"];
  const found = countries.find((country) => new RegExp(`\\b${country.replace(" ", "\\s+")}\\b`, "i").test(raw));
  if (found) return found;
  const tld = email.split(".").pop()?.toLowerCase();
  return ({ de: "Germany", ae: "UAE", ph: "Philippines", my: "Malaysia", id: "Indonesia", th: "Thailand", vn: "Vietnam", br: "Brazil", mx: "Mexico", tr: "Turkey", uk: "United Kingdom", au: "Australia", za: "South Africa" } as Record<string, string>)[tld || ""] || "";
}

function safeDate(value: string) {
  if (!value) return new Date().toISOString();
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

function stripLeadingMetadata(body: string, values: string[]) {
  const lines = body.split("\n");
  while (lines.length && (!lines[0].trim() || values.some((value) => value && lines[0].includes(value)) || /^(From|To|Date|Subject|发件人|收件人|日期|主题)[:：]/i.test(lines[0]))) lines.shift();
  return lines.join("\n");
}

function decodeMimeWord(value: string) {
  return value.replace(/=\?UTF-8\?B\?([^?]+)\?=/gi, (_, encoded) => {
    try { return Buffer.from(encoded, "base64").toString("utf8"); } catch { return value; }
  });
}
