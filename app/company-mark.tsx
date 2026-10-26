"use client";
import { useState } from "react";
import { companyBrand } from "../lib/branding";
export default function CompanyMark({
  profile,
  className = "",
}: {
  profile?: Record<string, string> | null;
  className?: string;
}) {
  const brand = companyBrand(profile),
    src = profile?.logo_url || "";
  const [failed, setFailed] = useState("");
  return (
    <span
      className={`company-mark ${className} ${src && failed !== src ? "has-logo" : ""}`}
    >
      {src && failed !== src ? (
        // Authenticated image endpoint; do not proxy private images through a public optimizer.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt={`${brand} Logo`} onError={() => setFailed(src)} />
      ) : (
        <span aria-hidden="true">
          {Array.from(brand)[0]?.toUpperCase() || "R"}
        </span>
      )}
    </span>
  );
}
