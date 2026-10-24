import { useState, useEffect } from 'react';

const DISTRICTS = [
  { id: 'gorodishche', name: 'Городищенский р-н', lat: 48.80, lng: 44.47, crops: '🧅 Лук, 🥕 Морковь, 🥔 Картофель, 🟣 Свекла', note: 'Крупнейший производитель лука и корнеплодов в РФ.' },
  { id: 'bykovo', name: 'Быковский р-н', lat: 49.76, lng: 45.39, crops: '🍉 Арбуз, 🍈 Дыня', note: 'Центр российского бахчеводства, знаменитые быковские арбузы.' },
  { id: 'srednyaya_ahtuba', name: 'Среднеахтубинский р-н', lat: 48.71, lng: 44.86, crops: '🥬 Капуста, 🍅 Томаты', note: 'Специализация на открытом грунте и ранних овощах.' }
];

function weatherDesc(code) {
  if (code === 0) return { icon: '☀️', text: 'Ясно' };
  if (code <= 3) return { icon: '🌤️', text: 'Малооблачно' };
  if (code === 45 || code === 48) return { icon: '🌫️', text: 'Туман' };
  if (code >= 51 && code <= 55) return { icon: '🌧️', text: 'Морось' };
  if (code >= 61 && code <= 65) return { icon: '🌧️', text: 'Дождь' };
  if (code >= 71 && code <= 75) return { icon: '🌨️', text: 'Снег' };
  if (code >= 80 && code <= 82) return { icon: '🌧️', text: 'Ливень' };
  if (code >= 95) return { icon: '⛈️', text: 'Гроза' };
  return { icon: '🌡️', text: 'Ясно' };
}

function getImpact(maxTemp, minTemp, prec) {
  if (minTemp <= 0) {
    return { cls: 'dn', title: 'Опасность: Ночные заморозки', desc: 'Риск подмерзания неубранных корнеплодов и капусты в поле. Ускорить закладку в овощехранилища.' };
  }
  if (maxTemp > 33 && prec === 0) {
    return { cls: 'dn', title: 'Опасность: Суховей / Жара', desc: 'Критическая температура для налива плодов. Риск засухи. Требуется усиленный полив.' };
  }
  if (prec > 12) {
    return { cls: 'warn', title: 'Ограничение: Осенняя распутица', desc: 'Сильные осадки затрудняют выход техники в поле и снижают лежкость корнеплодов при закладке на хранение.' };
  }
  if (maxTemp < 12) {
    return { cls: 'info', title: 'Завершение сезона · Озимый сев', desc: 'Температурный режим оптимален для укоренения озимого чеснока и охлаждения вентиляционных камер хранения.' };
  }
  return { cls: 'up', title: 'Благоприятное окно уборки', desc: 'Сухая осенняя погода оптимальна для доуборки поздних культур, закладки на хранение и зяблевой вспашки.' };
}

function buildFallbackWeather(districtId) {
  const offset = districtId === 'bykovo' ? -1 : districtId === 'srednyaya_ahtuba' ? 1 : 0;
  const baseMax = [12, 11, 9, 10, 8, 7, 9];
  const baseMin = [4, 3, 2, 1, 0, -1, 2];
  const basePrec = [0.0, 1.2, 4.5, 0.0, 0.0, 0.4, 0.0];
  const baseCode = [2, 3, 61, 1, 0, 2, 1];
  const time = Array.from({ length: 7 }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() + i);
    return d.toISOString().split('T')[0];
  });
  return {
    time,
    temperature_2m_max: baseMax.map(t => t + offset),
    temperature_2m_min: baseMin.map(t => t + offset),
    precipitation_sum: basePrec,
    weathercode: baseCode,
  };
}

export default function WeatherWidget() {
  const [activeDistrictId, setActiveDistrictId] = useState('gorodishche');
  const [weatherData, setWeatherData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [usingFallback, setUsingFallback] = useState(false);

  const district = DISTRICTS.find(d => d.id === activeDistrictId);

  useEffect(() => {
    let active = true;
    async function fetchWeather() {
      setLoading(true);
      setUsingFallback(false);
      try {
        const res = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${district.lat}&longitude=${district.lng}&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,weathercode&timezone=Europe/Moscow&forecast_days=7`);
        if (!res.ok) throw new Error("Weather service unavailable");
        const data = await res.json();
        if (active && data?.daily?.time) {
          setWeatherData(data.daily);
        }
      } catch {
        if (active) {
          setUsingFallback(true);
          setWeatherData(buildFallbackWeather(activeDistrictId));
        }
      } finally {
        if (active) setLoading(false);
      }
    }
    fetchWeather();
    return () => { active = false; };
  }, [activeDistrictId, district.lat, district.lng]);

  function getDayOfWeek(dateStr) {
    const d = new Date(dateStr);
    return d.toLocaleDateString('ru-RU', { weekday: 'short' });
  }

  function getFormattedDate(dateStr) {
    const d = new Date(dateStr);
    return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
  }

  // Calculate crop impact based on the next 3 days average max temp, min temp and cumulative precipitation
  let impact = { cls: 'up', title: 'Загрузка...', desc: 'Оцениваем влияние на уборку и хранение' };
  if (weatherData) {
    const next3DaysMax = weatherData.temperature_2m_max.slice(0, 3);
    const next3DaysMin = weatherData.temperature_2m_min.slice(0, 3);
    const avgMax = next3DaysMax.reduce((a, b) => a + b, 0) / next3DaysMax.length;
    const minT = Math.min(...next3DaysMin);
    const totalPrec = weatherData.precipitation_sum.slice(0, 3).reduce((a, b) => a + b, 0);
    impact = getImpact(avgMax, minT, totalPrec);
  }

  return (
    <div className="panel" style={{ marginTop: 10 }}>
      <div className="panel-hd">
        <span className="panel-title">
          ☀️ Погода в сырьевых зонах (Волгоградская обл.) · 7 дней
          {usingFallback ? ' (резервный расчёт)' : ''}
        </span>
        <div style={{ display: 'flex', gap: 4 }}>
          {DISTRICTS.map(d => (
            <button
              key={d.id}
              onClick={() => setActiveDistrictId(d.id)}
              style={{
                padding: '4px 8px',
                borderRadius: 4,
                border: activeDistrictId === d.id ? '1px solid var(--blue-border)' : '1px solid var(--border)',
                background: activeDistrictId === d.id ? 'var(--blue-bg)' : 'transparent',
                color: activeDistrictId === d.id ? 'var(--blue)' : 'var(--txt2)',
                fontSize: 11,
                cursor: 'pointer',
                fontWeight: activeDistrictId === d.id ? 600 : 400
              }}
            >
              {d.name.split(' ')[0]}
            </button>
          ))}
        </div>
      </div>
      
      <div className="panel-body" style={{ display: 'grid', gridTemplateColumns: '1.2fr 0.8fr', gap: 16 }}>
        
        {/* Left: 7-day forecast */}
        <div>
          {loading ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div className="skeleton" style={{ height: 30, width: '100%' }} />
              <div className="skeleton" style={{ height: 80, width: '100%' }} />
            </div>
          ) : weatherData ? (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 6 }}>
              {weatherData.time.map((time, idx) => {
                const maxT = weatherData.temperature_2m_max[idx];
                const minT = weatherData.temperature_2m_min[idx];
                const prec = weatherData.precipitation_sum[idx];
                const code = weatherData.weathercode[idx];
                const w = weatherDesc(code);
                return (
                  <div key={time} style={{ background: 'var(--surface2)', borderRadius: 6, padding: '8px 4px', textAlign: 'center', display: 'flex', flexDirection: 'column', gap: 4, border: '1px solid var(--border)' }}>
                    <div style={{ fontSize: 9, textTransform: 'uppercase', color: 'var(--txt3)', fontWeight: 600 }}>
                      {getDayOfWeek(time)}
                    </div>
                    <div style={{ fontSize: 10, color: 'var(--txt2)' }}>
                      {getFormattedDate(time).split(' ')[0]}
                    </div>
                    <div style={{ fontSize: 20, margin: '4px 0' }}>
                      {w.icon}
                    </div>
                    <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--txt)' }}>
                      {Math.round(maxT)}°
                    </div>
                    <div style={{ fontSize: 10, color: minT <= 0 ? 'var(--red)' : 'var(--txt2)' }}>
                      {Math.round(minT)}°
                    </div>
                    <div style={{ fontSize: 9, fontFamily: 'var(--mono)', color: prec > 0 ? 'var(--blue)' : 'var(--txt3)', marginTop: 2 }}>
                      {prec > 0 ? `${prec.toFixed(1)}мм` : '0мм'}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : null}

          <div style={{ display: 'flex', gap: 12, marginTop: 10, fontSize: 11, color: 'var(--txt2)' }}>
            <div><strong>Культуры района:</strong> <span style={{ color: 'var(--txt)' }}>{district.crops}</span></div>
          </div>
        </div>

        {/* Right: Crop impact analysis */}
        <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between', background: 'var(--surface2)', borderRadius: 6, padding: '12px', border: '1px solid var(--border)' }}>
          <div>
            <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--txt3)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 6 }}>
              Влияние на уборку и хранение
            </div>
            
            <div className={`signal-box ${impact.cls}`} style={{ padding: '8px 10px', marginBottom: 8 }}>
              <div className={`signal-label ${impact.cls}`} style={{ fontSize: 11, fontWeight: 600 }}>
                {impact.title}
              </div>
              <div className={`signal-text ${impact.cls}`} style={{ marginTop: 4, fontSize: 11, lineHeight: 1.4 }}>
                {impact.desc}
              </div>
            </div>
          </div>

          <div style={{ fontSize: 10, color: 'var(--txt3)', fontStyle: 'italic', borderTop: '1px dashed var(--border)', paddingTop: 6 }}>
            {district.note}
          </div>
        </div>

      </div>
    </div>
  );
}

