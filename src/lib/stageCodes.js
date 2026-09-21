// أكواد المراحل الجوهرية التي يعتمد عليها النظام نصًّا — مصدر واحد للحقيقة.
// أي غلطة إملائية في الثابت تصبح خطأً فوريًا بدل فشل صامت في مطابقة الكود.
// المراحل التي ينشئها المستخدم لها أكواد ديناميكية (stage_…) ولا تُذكر هنا،
// وسلسلة "لا يرد" (no_response_N) تُطابَق بنمط منفصل داخل LeadDrawer.
export const STAGE = {
  NEW: 'new',
  CONTACTED: 'contacted',
  INTERESTED: 'interested',
  FOLLOWUP: 'followup',
  DEAL: 'deal',
  DONE: 'done',
  LOST: 'lost',
  DEAD: 'dead',
  REPEAT_PROCEDURE: 'repeat_procedure',
}

// مراحل لا تحتاج متابعة (لا إشعار فيها إطلاقًا).
// 'won' فئة (category) لا كود مرحلة — مُبقاة احتياطًا كما كانت.
export const QUIET_STAGES = [STAGE.DEAD, STAGE.LOST, STAGE.DONE, 'won']
