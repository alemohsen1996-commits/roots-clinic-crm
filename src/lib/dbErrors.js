// ترجمة رسايل الأخطاء الراجعة من الداتابيز (triggers / RPC)
// الدوال في Supabase بترمي نص عربي ثابت — هنا بنطابقه ونعرضه بلغة الموظف،
// وأي رسالة مش معروفة بتتعرض زي ما هي. لو ضفت raise exception جديد، ضيف سطر هنا.
import i18n from '../i18n'

// [نص الداتابيز (% = أي قيمة), مفتاح الترجمة]
const MAP = [
  ['غير مصرح لك بتوزيع الليدات', 'distributeNotAllowed'],
  ['الموافقة على الإلغاء تتطلب صلاحية مدير أو محاسب', 'voidApproveRole'],
  ['لا يوجد طلب إلغاء معلّق لهذه الدفعة', 'noPendingVoid'],
  ['الأرشفة للمدير العام فقط', 'archiveSuperOnly'],
  ['الموظف الوجهة غير موجود أو غير مفعّل', 'targetUserInvalid'],
  ['نقل الليدات يتطلب صلاحية مدير', 'reassignManager'],
  ['إنشاء الجروبات للمديرين فقط', 'groupsManagersOnly'],
  ['اكتب اسم الجروب', 'groupNameRequired'],
  ['الرسالة فاضية', 'emptyMessage'],
  ['التعديل متاح خلال 24 ساعة من الإرسال فقط', 'edit24h'],
  ['الليد غير متاح', 'leadUnavailable'],
  ['المحادثة الفردية لا يمكن الخروج منها', 'cantLeaveDirect'],
  ['الموظف غير موجود أو غير مفعّل', 'userInvalid'],
  ['اختار موظف تاني', 'pickAnotherUser'],
  ['مينفعش تشيل صورة الإيصال', 'cantRemoveReceipt'],
  ['صورة الإيصال مش موجودة — ارفعها تاني', 'receiptMissing'],
  ['غير مسموح — قفل الشهر للمدير بس', 'closeMonthManager'],
  ['المسح النهائي للمدير العام فقط', 'deleteSuperOnly'],
  ['حدد فرع العميل «%» قبل تحويله للمتابعة', 'branchBeforeFollowup'],
  ['غير مصرح: إرجاع المريض من بورد المنسقات إلى المبيعات يتم عبر المدير فقط', 'backflowManager'],
  ['لا يمكن حذف مرحلة جوهرية (%)', 'coreStageDelete'],
  ['لا يمكن نقل مرحلة جوهرية (%) بين البوردين', 'coreStageBoard'],
  ['لا يمكن تغيير كود مرحلة جوهرية (%) — النظام يعتمد عليه', 'coreStageCode'],
  ['لا يمكن تعطيل مرحلة جوهرية (%)', 'coreStageDisable'],
  ['غير مصرح: تغيير المنسقة المسؤولة عن الديل يتم عبر المدير فقط', 'dealCoordManager'],
  ['غير مصرح: تعديل بيانات العملية يتم عبر المنسقة أو المحاسب أو المدير', 'dealEditRoles'],
  ['غير مصرح: تعديل المبالغ يتم عبر المنسقة أو المحاسب أو المدير', 'dealAmountsRoles'],
  ['غير مصرح: تحديد نتيجة العملية يتم عبر المنسقة أو المحاسب أو المدير', 'dealOutcomeRoles'],
  ['لازم يتفتح ديل تعاقد للمريض الأول قبل ما ينتقل للمرحلة دي', 'stageNeedsDeal'],
  ['غير مسموح — الاستيراد للمدير فقط', 'importManagerOnly'],
  ['غير مصرح: الاستيراد متاح للمدير فقط', 'importManagerOnly'],
  ['حدّد المرحلة', 'pickStage'],
  ['لا يمكن إتمام العملية بتاريخ في المستقبل — عدّل تاريخ العملية لليوم أو قبله', 'doneFuture'],
  ['يجب اختيار سبب الخسارة قبل نقل الليد إلى مرحلة الخسارة', 'lostReasonRequired'],
  ['سجل التدقيق للقراءة فقط', 'auditReadOnly'],
  ['هذا الديل مقفول محاسبيًا — التعديل يتطلب صلاحية المدير العام', 'dealLocked'],
  ['حساب المدير العام محمي ومينفعش يتمسح', 'superAdminProtected'],
  ['حساب المدير العام محمي — مينفعش تتغيّر صلاحياته أو حالته من التطبيق', 'superAdminProtected'],
  ['مفيش جلسات متبقية في الباقة', 'noSessionsLeft'],
  ['اختر تاريخ النهارده أو بعده', 'pickTodayOrLater'],
  ['اشتراك غير صالح', 'badSubscription'],
  ['المبلغ غير صالح', 'badAmount'],
  ['القسط لا يخص هذا الديل', 'installmentWrongDeal'],
  ['القسط المحدَّد غير موجود', 'installmentMissing'],
  ['اختر نوع الشبكة: مدى أو فيزا أو ماستركارد', 'pickCardType'],
  ['رفض الإلغاء يتطلب صلاحية مدير أو محاسب', 'voidRejectRole'],
  ['سبب الإلغاء مطلوب', 'voidReasonRequired'],
  ['الدفعة غير موجودة أو سبق طلب إلغائها', 'paymentMissingOrVoided'],
  ['الإلغاء المباشر يتطلب صلاحية مدير أو محاسب', 'voidDirectRole'],
  ['الدفعة غير موجودة أو سبق إلغاؤها', 'paymentMissingOrVoidedNow'],
  ['حدد فرع العميل قبل فتح ملف التعاقد', 'branchBeforeDeal'],
  ['صورة الإيصال مطلوبة لتسجيل الدفعة', 'receiptRequired'],
  ['غير مسجل الدخول', 'notSignedIn'],
  ['الاسترجاع للمدير العام فقط', 'restoreSuperOnly'],
  ['غير مصرح لك بالتراجع', 'undoNotAllowed'],
  ['تم التراجع عن هذه الدفعة من قبل', 'alreadyUndone'],
  ['غير مسموح', 'notAllowed'],
  ['غير مصرح', 'notAllowed'],
]

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const RULES = MAP.map(([txt, key]) => ({
  key,
  re: new RegExp('^\\s*' + esc(txt).replace(/%/g, '(.+?)') + '\\s*$'),
}))

// بيرجّع الرسالة مترجمة لو معروفة، وإلا النص الأصلي (أو نص افتراضي لو فاضي)
export function dbErr(message, fallbackKey = 'common.failed') {
  const msg = String(message ?? '').trim()
  if (!msg) return i18n.t(fallbackKey)
  for (const r of RULES) {
    const m = r.re.exec(msg)
    if (m) return i18n.t(`dbErr.${r.key}`, { v: m[1] ?? '' })
  }
  return msg
}
