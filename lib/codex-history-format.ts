export function historicalLink(
  url: string,
  files: { id: number; original_path: string }[],
) {
  if (/^[a-z]:[\\/]/i.test(url) || /^file:/i.test(url)) return undefined;
  const relative = url.replace(/^\.\//, "");
  const file = files.find((f) => f.original_path === relative);
  if (file) return `/api/files/${file.id}`;
  if (/^(https?:|mailto:)/i.test(url)) return url;
  return undefined;
}
export function historicalMessage(body: string, role: string) {
  const marker = "## My request:";
  if (
    role === "user" &&
    body.includes("# Files mentioned by the user:") &&
    body.includes(marker)
  ) {
    const position = body.indexOf(marker);
    return {
      text: body.slice(position + marker.length).trim(),
      metadata: body.slice(0, position).trim(),
    };
  }
  return { text: body, metadata: "" };
}
