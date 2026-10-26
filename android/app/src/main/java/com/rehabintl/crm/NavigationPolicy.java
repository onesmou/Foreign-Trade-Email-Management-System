package com.rehabintl.crm;

import java.net.URI;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.util.Locale;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** Pure-Java allowlist: no UI, cookies, tokens or customer data. */
public final class NavigationPolicy {
    private final URI origin;
    public NavigationPolicy(String base) {
        origin = URI.create(base);
        if (!secure(origin)) throw new IllegalArgumentException("CRM address must be HTTPS");
    }
    private static boolean secure(URI uri) {
        return "https".equalsIgnoreCase(uri.getScheme()) && uri.getHost() != null
            && uri.getUserInfo() == null && (uri.getPort() == -1 || uri.getPort() == 443);
    }
    public boolean trusted(String value) {
        try {
            URI uri = URI.create(value);
            return secure(uri) && origin.getHost().equalsIgnoreCase(uri.getHost());
        } catch (RuntimeException e) { return false; }
    }
    public boolean downloadable(String value) {
        if (!trusted(value)) return false;
        String path = URI.create(value).getPath();
        return path != null && (path.matches("/api/files/[0-9]+") || path.equals("/api/backups/download"));
    }
    public boolean external(String value) {
        try {
            URI uri = URI.create(value);
            String scheme = uri.getScheme() == null ? "" : uri.getScheme().toLowerCase(Locale.ROOT);
            return secure(uri) || scheme.equals("mailto") || scheme.equals("tel");
        } catch (RuntimeException e) { return false; }
    }
    public static String filename(String disposition, String fallback) {
        String name = fallback;
        if (disposition != null) {
            Matcher utf8 = Pattern.compile("filename\\*=UTF-8''([^;]+)", Pattern.CASE_INSENSITIVE).matcher(disposition);
            Matcher simple = Pattern.compile("filename=\"?([^\";]+)", Pattern.CASE_INSENSITIVE).matcher(disposition);
            try {
                if (utf8.find()) name = URLDecoder.decode(utf8.group(1), StandardCharsets.UTF_8.name());
                else if (simple.find()) name = simple.group(1);
            } catch (Exception ignored) { name = fallback; }
        }
        if (name == null) name = "CRM-file";
        name = name.replaceAll("[\\\\/:*?\"<>|\\p{Cntrl}]", "_").trim();
        if (name.isEmpty() || name.equals(".") || name.equals("..")) name = "CRM-file";
        return name.substring(0, Math.min(name.length(), 120));
    }
}
