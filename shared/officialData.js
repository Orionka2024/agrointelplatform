import history from '../data/official-history.json' with { type: 'json' };
import forecast from '../data/official-forecast.json' with { type: 'json' };
import drivers from '../data/official-drivers.json' with { type: 'json' };

export { history as officialHistory, forecast as officialForecast, drivers as officialDrivers };

export function officialSnapshot(today) {
  const producer = history.producer.monthly.filter((r) => r.availableDate <= today && r.period <= today.slice(0, 7));
  const producerSouth = (history.producer.regional || []).filter(
    (r) =>
      r.region &&
      r.region.trim() === 'Южный федеральный округ' &&
      r.availableDate <= today &&
      r.period <= today.slice(0, 7)
  );
  const retail = history.retail.weekly.filter((r) => r.availableDate <= today && r.date <= today);
  const usdRub = (drivers.usdRub || []).filter((r) => r.availableDate <= today);
  const kztRub = (drivers.kztRub || []).filter((r) => r.availableDate <= today);
  const keyRate = (drivers.keyRate || []).filter((r) => r.availableDate <= today);
  const vlgWeather = (drivers.weather?.volgograd || []).filter((r) => r.availableDate <= today);
  const zhmWeather = (drivers.weather?.zhambyl || []).filter((r) => r.availableDate <= today);

  return {
    collectedAt: history.collectedAt,
    producer: producer.at(-1) ?? null,
    producerSouth: producerSouth.at(-1) ?? null,
    retail: retail.at(-1) ?? null,
    producerCount: producer.length,
    retailCount: retail.length,
    annualCount: history.producer.annual.length,
    drivers: {
      collectedAt: drivers.collectedAt,
      count: Math.min(usdRub.length, keyRate.length),
      usdRub: usdRub.at(-1) ?? null,
      kztRub: kztRub.at(-1) ?? null,
      keyRate: keyRate.at(-1) ?? null,
      weather: {
        volgograd: vlgWeather.at(-1) ?? null,
        zhambyl: zhmWeather.at(-1) ?? null,
      },
      sources: drivers.sources,
      note: drivers.note,
    },
    forecast:
      forecast.issueDate <= today
        ? {
            id: forecast.id,
            issueDate: forecast.issueDate,
            status: forecast.status,
            modelVersion: forecast.modelVersion,
            target: forecast.target,
            rows: forecast.rows.map((r) => ({
              targetMonth: r.targetMonth,
              point: r.point,
              catboostPoint: r.catboostPoint,
              mae: r.validation.final.mae,
              catboostMae: r.catboostHoldoutMae,
              naiveMae: r.validation.naiveFinal.mae,
              selected: r.validation.selected,
              n: r.validation.final.n,
            })),
          }
        : null,
    limitations: history.limitations,
    sources: history.sources,
  };
}
