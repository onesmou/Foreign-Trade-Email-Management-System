package com.rehabintl.crm;
import org.junit.Test;
import static org.junit.Assert.*;
public class NavigationPolicyTest {
    private final NavigationPolicy policy = new NavigationPolicy("https://wmcrm.jbenlz.com/");
    @Test public void onlyPinnedHttpsOriginIsTrusted() {
        assertTrue(policy.trusted("https://wmcrm.jbenlz.com/api/files/42"));
        assertTrue(policy.trusted("https://WMCRM.JBENLZ.COM:443/login"));
        for (String value : new String[]{"http://wmcrm.jbenlz.com", "https://wmcrm.jbenlz.com.evil.test", "https://user@wmcrm.jbenlz.com", "https://wmcrm.jbenlz.com:444", "file:///sdcard/a", "javascript:alert(1)", "intent://settings", "https://wmcrm.jbenlz.com@evil.test", "data:text/html,test", "not a url"}) assertFalse(value,policy.trusted(value));
    }
    @Test public void downloadsCannotExfiltrateCookiesToAnotherHost() {
        assertTrue(policy.downloadable("https://wmcrm.jbenlz.com/api/files/9?download=1"));
        assertTrue(policy.downloadable("https://wmcrm.jbenlz.com/api/backups/download?id=example"));
        assertFalse(policy.downloadable("https://evil.test/api/files/9"));
        assertFalse(policy.downloadable("https://wmcrm.jbenlz.com/api/settings"));
        assertFalse(policy.downloadable("https://wmcrm.jbenlz.com/api/files/../settings"));
    }
    @Test public void onlyExplicitSafeExternalSchemesAreSupported() {
        assertTrue(policy.external("https://www.rehabintl.com"));
        assertTrue(policy.external("mailto:sales@example.test"));
        assertTrue(policy.external("tel:+123456"));
        assertFalse(policy.external("intent://anything"));
        assertFalse(policy.external("http://insecure.test"));
        assertFalse(policy.external("file:///data/data/private"));
    }
    @Test public void filenamesPreserveChineseButRemovePathAndControlCharacters() {
        assertEquals("报价单.pdf", NavigationPolicy.filename("attachment; filename*=UTF-8''%E6%8A%A5%E4%BB%B7%E5%8D%95.pdf", "file"));
        assertEquals(".._secret.pdf", NavigationPolicy.filename("attachment; filename=../secret.pdf", "file"));
        assertEquals("CRM-file", NavigationPolicy.filename(null, ".."));
        assertEquals("file.pdf", NavigationPolicy.filename("filename*=UTF-8''%INVALID", "file.pdf"));
    }
}
