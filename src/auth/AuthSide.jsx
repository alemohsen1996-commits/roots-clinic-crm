// الجانب البصري لشاشات الدخول — رمز الجذور + اسم العيادة
export default function AuthSide() {
  return (
    <aside className="auth-side">
      <div className="auth-emblem">
        {/* رمز الجذور: بذرة/بصيلة تنبت منها ورقتان، وتحتها شبكة جذور متفرّعة */}
        <svg viewBox="0 0 160 150" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
          {/* ورقتان في الأعلى */}
          <path d="M80 34 C80 22, 90 12, 104 12 C104 26, 94 34, 80 34Z"
                fill="url(#g)" opacity="0.9" />
          <path d="M80 34 C80 22, 70 12, 56 12 C56 26, 66 34, 80 34Z"
                fill="url(#g)" opacity="0.9" />
          {/* عرق الورقة */}
          <path d="M80 34 C86 26, 94 20, 100 17" stroke="var(--ink)" strokeWidth="1" opacity="0.25" />
          <path d="M80 34 C74 26, 66 20, 60 17" stroke="var(--ink)" strokeWidth="1" opacity="0.25" />

          {/* البذرة/البصيلة */}
          <ellipse cx="80" cy="46" rx="9" ry="11" fill="url(#g)" />

          {/* الجذر الرئيسي (وتد) */}
          <path d="M80 57 L80 128" stroke="url(#g)" strokeWidth="2.5" strokeLinecap="round" />

          {/* الجذور الجانبية الكبيرة — تتفرّع تدريجيًا على طول الوتد */}
          <path d="M80 70 C72 74, 64 78, 56 90 C51 98, 48 106, 46 114"
                stroke="url(#g)" strokeWidth="2" strokeLinecap="round" fill="none" />
          <path d="M80 70 C88 74, 96 78, 104 90 C109 98, 112 106, 114 114"
                stroke="url(#g)" strokeWidth="2" strokeLinecap="round" fill="none" />
          <path d="M80 88 C74 92, 68 96, 63 106 C60 112, 58 118, 57 124"
                stroke="url(#g)" strokeWidth="1.8" strokeLinecap="round" fill="none" />
          <path d="M80 88 C86 92, 92 96, 97 106 C100 112, 102 118, 103 124"
                stroke="url(#g)" strokeWidth="1.8" strokeLinecap="round" fill="none" />

          {/* شعيرات جذرية دقيقة */}
          <path d="M56 90 C52 92, 49 95, 47 99" stroke="url(#g)" strokeWidth="1.2" strokeLinecap="round" opacity="0.7" fill="none" />
          <path d="M104 90 C108 92, 111 95, 113 99" stroke="url(#g)" strokeWidth="1.2" strokeLinecap="round" opacity="0.7" fill="none" />
          <path d="M80 104 C77 108, 75 112, 74 116" stroke="url(#g)" strokeWidth="1.2" strokeLinecap="round" opacity="0.6" fill="none" />
          <path d="M80 104 C83 108, 85 112, 86 116" stroke="url(#g)" strokeWidth="1.2" strokeLinecap="round" opacity="0.6" fill="none" />
          <path d="M63 106 C60 109, 58 113, 57 117" stroke="url(#g)" strokeWidth="1" strokeLinecap="round" opacity="0.55" fill="none" />
          <path d="M97 106 C100 109, 102 113, 103 117" stroke="url(#g)" strokeWidth="1" strokeLinecap="round" opacity="0.55" fill="none" />

          {/* نقاط أطراف الجذور (بصيلات) */}
          <circle cx="46" cy="114" r="2.4" fill="url(#g)" />
          <circle cx="114" cy="114" r="2.4" fill="url(#g)" />
          <circle cx="57" cy="124" r="2.2" fill="url(#g)" />
          <circle cx="103" cy="124" r="2.2" fill="url(#g)" />
          <circle cx="80" cy="128" r="2.6" fill="url(#g)" />

          <defs>
            <linearGradient id="g" x1="46" y1="12" x2="120" y2="130" gradientUnits="userSpaceOnUse">
              <stop stopColor="#e3c576" />
              <stop offset="1" stopColor="#c9a24b" />
            </linearGradient>
          </defs>
        </svg>
      </div>

      <div className="auth-name">
        <h2>Roots Clinic</h2>
        <span>عيادة الجذور</span>
      </div>
    </aside>
  )
}
