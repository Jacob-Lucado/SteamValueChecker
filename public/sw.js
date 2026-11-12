// Shows price alerts as browser notifications. It does nothing else: no caching, no offline mode.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", e => e.waitUntil(self.clients.claim()));
self.addEventListener("push", e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (err) { d = { title: "Steam Value Checker", body: e.data ? e.data.text() : "" }; }
  e.waitUntil(self.registration.showNotification(String(d.title || "Steam Value Checker").slice(0, 120), {
    body: String(d.body || "").slice(0, 240),
    icon: "/icon-192.png", badge: "/icon-192.png",
    tag: d.tag || undefined, data: { url: typeof d.url === "string" ? d.url : "/" }
  }));
});
self.addEventListener("notificationclick", e => {
  e.notification.close();
  let url = "/";
  try { const u = new URL(e.notification.data && e.notification.data.url || "/", self.location.origin); if (u.origin === self.location.origin) url = u.pathname + u.search; } catch (err) { /* open home */ }
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(list => {
    for (const c of list) if (c.url.startsWith(self.location.origin) && "focus" in c) { c.navigate(url); return c.focus(); }
    return self.clients.openWindow(url);
  }));
});
