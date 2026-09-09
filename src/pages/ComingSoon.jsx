// عنصر مؤقت للوحدات التي ستُبنى في المراحل القادمة
export default function ComingSoon({ title }) {
  return (
    <>
      <div className="page-head"><h1>{title}</h1></div>
      <div className="card empty">
        <strong>هذه الوحدة في المرحلة القادمة</strong>
        قاعدة البيانات جاهزة لها بالكامل — تبقى بناء الشاشة فقط
      </div>
    </>
  )
}
