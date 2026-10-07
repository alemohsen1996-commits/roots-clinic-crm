// Service Worker — إشعارات الشات (Web Push) فقط، مفيش كاش للصفحات
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()))

self.addEventListener('push', (event) => {
  let d = {}
  try { d = event.data ? event.data.json() : {} } catch { d = { body: event.data?.text() } }
  const url = d.url || '/chat'

  event.waitUntil((async () => {
    // الرقم على أيقونة الأبلكيشن
    if (typeof d.unread === 'number' && self.navigator.setAppBadge) {
      try { await self.navigator.setAppBadge(d.unread) } catch {}
    }

    // السيستم مفتوح قدام الموظف → الإشعار يظهر من غير صوت الجهاز (الصوت المميز بيشتغل جوه السيستم)
    const wins0 = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    const appVisible = wins0.some(w => w.visibilityState === 'visible')

    await self.registration.showNotification(d.title || 'رسالة جديدة', {
      silent: appVisible,
      body: d.body || '',
      icon: '/icon-192.png',
      tag: d.tag || 'chat',        // رسائل نفس المحادثة بتستبدل بعض بدل ما تتراكم
      renotify: true,
      dir: 'rtl',
      lang: 'ar',
      data: { url },
    })

    // الموظف فاتح نفس المحادثة قدامه → نشيل الإشعار فورًا
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    const watching = wins.some(w => w.visibilityState === 'visible' && w.url.includes(url))
    if (watching) {
      const list = await self.registration.getNotifications({ tag: d.tag || 'chat' })
      list.forEach(n => n.close())
    }
  })())
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = event.notification.data?.url || '/chat'
  event.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    const win = wins.find(w => new URL(w.url).origin === self.location.origin)
    if (win) {
      await win.focus()
      win.postMessage({ type: 'open-url', url })   // التطبيق بيتنقل من غير إعادة تحميل
      return
    }
    await self.clients.openWindow(url)
  })())
})
