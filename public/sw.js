self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting())
})

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim())
})

self.addEventListener("message", (event) => {
  const data = event.data || {}
  if (data.type !== "lp-burn" && data.type !== "test") return
  const title = data.title || "WETH live pairs"
  const body = data.body || ""
  const url = data.url || "/lp-burns/"
  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      tag: data.tag || "weth-lp-burn",
      data: { url },
      requireInteraction: data.type === "lp-burn",
    }),
  )
})

self.addEventListener("notificationclick", (event) => {
  event.notification.close()
  const target = new URL(event.notification.data?.url || "/lp-burns/", self.location.origin).href
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows) => {
      for (const client of windows) {
        if (client.url.startsWith(self.location.origin) && "focus" in client) {
          client.focus()
          if ("navigate" in client) return client.navigate(target)
          return client
        }
      }
      return self.clients.openWindow(target)
    }),
  )
})
