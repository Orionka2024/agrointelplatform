/** Deterministic summary only. Missing facts remain missing, no generated recommendations. */
export function generateAutonomousAnalysis(_query, snapshot) {
  const fmt=v=>Number.isFinite(v)?v.toFixed(2):'нет данных';
  const p=snapshot.prices?.warehouse;
  const f=snapshot.forecast?.warehouse;
  const rows=(f?.horizons||[]).filter(r=>[1,4,13,26].includes(r.weeks));
  return [
    '### Сводка по данным платформы',
    `Режим: ${snapshot.mode || 'нет данных'}. Это сводка, а не независимый прогноз AI.`,
    `Склад без НДС: ${fmt(p?.priceExVat)} ₽/кг. Статус: ${p?.status || 'нет данных'}. Дата: ${p?.asOf || 'не указана'}.`,
    `Прогноз: ${f?.status || 'не выпущен'}. Версия: ${f?.modelVersion || 'нет'}.`,
    ...rows.map(r=>`W+${r.weeks}, ${r.targetDate}: ${fmt(r.point)} ₽/кг; ${r.validated?'проверен ретроспективно':'не валидирован'}. 80% диапазон: ${fmt(r.lo80)}–${fmt(r.hi80)}.`),
    ...(f?.reasons||[]),
    `Сезонное давление: ${snapshot.seasonalPressure?.active?.map(x=>`${x.phase}: ${x.reason}`).join('; ') || 'нет подтверждённых активных факторов'}.`,
    'Вероятности роста/падения и причинные эффекты не откалиброваны. Данные по другим культурам и будущему сезону не подставляются из шаблонов.',
  ].join('\n\n');
}
