// الصدارة (سباق السيلز): ميدالية 🥇/🥈 جنب الاسم + بطاقة «صدارة الشهر» في لوحة التحكم
// الترتيب بعدد العمليات الجراحية اللي تمت في الشهر الحالي (السيلز بس)، والتعادل لصاحب المركز الحالي
import useT from '../i18n/useT'
import { fmtMonth } from '../lib/format'
import { useSalesRace, medalOf } from '../lib/salesRace'

const GLYPH = { 1: '🥇', 2: '🥈' }

// ميدالية جنب اسم الموظف — مابتظهرش لو مالوش مركز
export function Medal({ userId, className = '' }) {
  const { t } = useT()
  const race = useSalesRace()
  const m = medalOf(race, userId)
  if (!m) return null
  const label = t(m === 1 ? 'race.medal1' : 'race.medal2', { month: fmtMonth(race.month) })
  return (
    <span className={'race-medal-badge ' + className} title={label} aria-label={label} role="img">
      {GLYPH[m]}
    </span>
  )
}

// اسم الشهر بس (أكتوبر) للعنوان
const monthName = (d, lang) => d
  ? new Date(d).toLocaleDateString(lang === 'en' ? 'en-GB' : 'ar-EG', { month: 'long' }) : ''

const initial = (name = '') => name.trim()[0] ?? '؟'

function Champ({ place, who, isMe }) {
  const { t } = useT()
  return (
    <div className={'race-champ ' + (place === 1 ? 'is-gold' : 'is-silver') + (isMe ? ' is-me' : '')}>
      <span className="race-av" aria-hidden="true">
        {place === 1 && who && <span className="race-crown">👑</span>}
        {who ? initial(who.name) : '؟'}
      </span>
      <span className="race-who">
        <small>{t(place === 1 ? 'race.first' : 'race.second')}</small>
        {who
          ? <b>{who.name}{isMe && <em> · {t('race.you')}</em>}</b>
          : <b className="race-empty">{t('race.emptySpot')}</b>}
      </span>
      {who && (
        <span className="race-num">
          <b>{who.ops}</b>
          <small>{t('race.opsLabel')}</small>
        </span>
      )}
    </div>
  )
}

// شريط التقدّم: عملياتي من المطلوب عشان أعدّي اللي قدامي
function Progress({ value, target }) {
  const { t } = useT()
  const pct = target > 0 ? Math.max(4, Math.min(100, Math.round((value / target) * 100))) : 0
  return (
    <>
      <span className="race-bar" role="progressbar" aria-valuemin={0} aria-valuemax={target} aria-valuenow={value}>
        <i style={{ width: pct + '%' }} />
      </span>
      <span className="race-cnt">{t('race.ofTarget', { n: value, target })}</span>
    </>
  )
}

// السطر الخاص بالسيلز: مكانه والفرق
function MyLine({ race }) {
  const { t } = useT()
  const { first, second, me } = race
  const ops = (n) => t('race.ops', { count: n })

  if (me.pos === 1) {
    const gap = second ? first.ops - second.ops : null
    return (
      <div className="race-mine is-gold">
        <strong>{t('race.me1')}</strong>
        <span>
          {gap == null ? t('race.me1Alone')
            : gap === 0 ? t('race.me1Tie', { name: second.name })
            : t('race.me1Gap', { name: second.name, ops: ops(gap) })}
        </span>
      </div>
    )
  }
  if (me.pos === 2) {
    const target = first.ops + 1
    return (
      <div className="race-mine">
        <strong>{t('race.me2')}</strong>
        <span>{t('race.me2Gap', { name: first.name, ops: ops(target - me.ops) })}</span>
        <Progress value={me.ops} target={target} />
      </div>
    )
  }
  if (!first) {
    return <div className="race-mine"><span>{t('race.startHint')}</span></div>
  }
  // عشان تاخد التاني لازم تعدّيه (التعادل لصاحب المركز)
  const target = (second ? second.ops : 0) + 1
  return (
    <div className="race-mine">
      <span>{t('race.meNeed', { ops: ops(target - me.ops) })}</span>
      <Progress value={me.ops} target={target} />
    </div>
  )
}

export function RaceBanner() {
  const { t, lang } = useT()
  const race = useSalesRace()
  if (!race.ready) return null
  const myPos = race.me?.in_race ? race.me.pos : null
  const title = t('race.title', { month: monthName(race.month, lang) })

  return (
    <section className="race-hero" aria-label={title}>
      <div className="race-title"><span aria-hidden="true">🏆</span>{title}</div>
      <div className="race-row">
        <Champ place={1} who={race.first} isMe={myPos === 1} />
        <Champ place={2} who={race.second} isMe={myPos === 2} />
      </div>
      {race.me?.in_race && <MyLine race={race} />}
    </section>
  )
}
