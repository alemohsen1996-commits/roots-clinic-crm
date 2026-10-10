// سباق السيلز: ميدالية 🥇/🥈 جنب الاسم + شريط لوحة التحكم
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

function Spot({ place, who, isMe }) {
  const { t } = useT()
  return (
    <div className={'race-spot ' + (place === 1 ? 'is-gold' : 'is-silver') + (isMe ? ' is-me' : '')}>
      <span className="race-spot-medal" aria-hidden="true">{GLYPH[place]}</span>
      <span className="race-spot-main">
        <small>{t(place === 1 ? 'race.first' : 'race.second')}</small>
        {who
          ? <b>{who.name}{isMe && <em> · {t('race.you')}</em>}</b>
          : <b className="race-empty">{t('race.emptySpot')}</b>}
      </span>
      {who && (
        <span className="race-spot-ops">
          <b>{who.ops}</b>
          <small>{t('race.opsLabel')}</small>
        </span>
      )}
    </div>
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
      <div className="race-me is-gold">
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
    return (
      <div className="race-me is-silver">
        <strong>{t('race.me2')}</strong>
        <span>{t('race.me2Gap', { name: first.name, ops: ops(first.ops - me.ops + 1) })}</span>
      </div>
    )
  }
  if (!first) {
    return <div className="race-me"><span>{t('race.startHint')}</span></div>
  }
  // عشان تاخد التاني لازم تعدّيه (التعادل لصاحب المركز)
  const need = (second ? second.ops : 0) - me.ops + 1
  return (
    <div className="race-me">
      <span>{t('race.meNeed', { ops: ops(need) })}</span>
    </div>
  )
}

export function RaceBanner() {
  const { t } = useT()
  const race = useSalesRace()
  if (!race.ready) return null
  const myPos = race.me?.in_race ? race.me.pos : null

  return (
    <section className="card race-card" aria-label={t('race.title', { month: fmtMonth(race.month) })}>
      <div className="race-head">
        <h2>🏁 {t('race.title', { month: fmtMonth(race.month) })}</h2>
        <small>{t('race.hint')}</small>
      </div>
      <div className="race-podium">
        <Spot place={1} who={race.first} isMe={myPos === 1} />
        <Spot place={2} who={race.second} isMe={myPos === 2} />
      </div>
      {race.me?.in_race && <MyLine race={race} />}
    </section>
  )
}
