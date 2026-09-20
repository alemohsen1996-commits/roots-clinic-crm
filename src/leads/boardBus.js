// ناقل أحداث خفيف بين الدرور (LeadDrawer) والكانبان (Kanban)
// الهدف: تحديث موضعي للأعمدة المتأثرة فقط، بدل إعادة تحميل البورد كله
// فلا يتعطّل شغل السيلز مع النت البطيء والدرور مفتوح.
//
// شكل الـ patch المُرسَل عبر emitBoardPatch:
//   { removeId, removeFrom }              → شِيل الكارت من عموده المصدر محليًا (بلا نداء قاعدة)
//   { removeId, removeFrom, refetch: [] } → نقل: المصدر يشيله فورًا، والأعمدة في refetch تحدّث نفسها فقط
//   { refetch: [stageId, …] }             → حدّث هذه الأعمدة فقط (تعديل بيانات/نشاط/تاسك بلا نقل)
//
// أي عمود لا يظهر في removeFrom ولا في refetch لا يُلمَس إطلاقًا.

const target = new EventTarget()

export function emitBoardPatch(detail) {
  target.dispatchEvent(new CustomEvent('board-patch', { detail }))
}

// يعيد دالة لإلغاء الاشتراك — استعملها في تنظيف useEffect
export function onBoardPatch(handler) {
  const wrapped = (e) => handler(e.detail || {})
  target.addEventListener('board-patch', wrapped)
  return () => target.removeEventListener('board-patch', wrapped)
}
