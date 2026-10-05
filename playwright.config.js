// اختبار مظهر الموبايل — بيشغّل Vite محليًا (متصل بقاعدة البيانات اللي في .env) ويصوّر الصفحات بأدوار مختلفة.
// بيانات الدخول من .env.test (متجاهَل في git).
import { defineConfig, devices } from '@playwright/test'
import fs from 'node:fs'

// تحميل .env.test يدويًا (من غير dotenv)
if (fs.existsSync('.env.test')) {
  for (const line of fs.readFileSync('.env.test', 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/)
    if (m && !line.trim().startsWith('#') && process.env[m[1]] === undefined) process.env[m[1]] = m[2]
  }
}

const PORT = 5199

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 25 * 60 * 1000,
  workers: 1,                 // دخول واحد في الوقت — عشان منعدّيش rate limit على الداتا الحقيقية
  retries: 0,
  reporter: [['list']],
  outputDir: 'test-results',
  use: { actionTimeout: 8000, navigationTimeout: 30000, baseURL: `http://localhost:${PORT}`, locale: 'ar-EG', trace: 'off' },
  webServer: {
    command: `npm run dev -- --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: true,
    timeout: 60_000,
  },
  projects: [
    { name: 'iphone14', use: { ...devices['iPhone 14'] } },                       // WebKit 390×844
    {
      name: 'android-small',                                                       // Chromium 360×780
      use: { ...devices['Pixel 5'], viewport: { width: 360, height: 780 }, screen: { width: 360, height: 780 } },
    },
    { name: 'desktop', use: { browserName: 'chromium', viewport: { width: 1440, height: 900 } } },
    // لابتوبات (Chromium — الموظفين على كروم وإيدج). كل الأسماء بتبدأ بـ desktop
    { name: 'desktop-1366', use: { browserName: 'chromium', viewport: { width: 1366, height: 768 } } },
    { name: 'desktop-1536', use: { browserName: 'chromium', viewport: { width: 1536, height: 864 } } },
    { name: 'desktop-1280', use: { browserName: 'chromium', viewport: { width: 1280, height: 720 } } },
    { name: 'desktop-1024', use: { browserName: 'chromium', viewport: { width: 1024, height: 768 } } },   // أسوأ حالة فوق حد الموبايل (900)
    // لابتوب 1366×768 بتكبير متصفح 125%: deviceScaleFactor 1.25 + مقاس CSS الفعلي (1366/1.25 × 768/1.25) زي ما الكروم بيحسبه
    { name: 'desktop-1366-z125', use: { browserName: 'chromium', viewport: { width: 1093, height: 614 }, deviceScaleFactor: 1.25 } },
  ],
})
