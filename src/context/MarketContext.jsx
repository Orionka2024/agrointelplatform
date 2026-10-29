import { useState, useEffect, useCallback } from 'react';
import { MarketContext } from './marketContextDef.js';
import { todayISO } from '../../shared/dates.js';
import { computeMarketModel } from '../../shared/marketModel.js';

export function MarketProvider({ children }) {
  const [demo, setDemoState] = useState(() => {
    try {
      const saved = localStorage.getItem('agro_demo_mode');
      if (saved === 'false') return false;
      if (saved === 'true') return true;
      // Real mode does not use unverified seed data.
      return false;
    } catch {
      return false;
    }
  });

  const [basis, setBasis] = useState('warehouse');
  const [scenario, setScenario] = useState('base');
  const [today, setToday] = useState(() => todayISO());
  useEffect(() => { const timer = setInterval(() => setToday(todayISO()), 60000); return () => clearInterval(timer); }, []);
  const [model, setModel] = useState(() => {
    // Immediate fallback synchronous model so screens never render empty
    return computeMarketModel({
      observations: [],
      indicators: [],
      forecasts: [],
      assumptions: null,
      macro: null,
      demo: false,
      today: todayISO(),
      storeAvailable: false,
    });
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const setDemo = useCallback((val) => {
    setDemoState(val);
    try {
      localStorage.setItem('agro_demo_mode', String(val));
    } catch {
      // silent
    }
  }, []);

  const fetchModel = useCallback(async (isDemo = demo) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/market?demo=${isDemo}&today=${today}`);
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const data = await res.json();
      setModel(data);
    } catch (err) {
      console.warn('[MarketContext] Fetch /api/market failed, computing client fallback:', err.message);
      setError(err.message);
      // Fallback client-side computation
      setModel(computeMarketModel({
        observations: [],
        indicators: [],
        forecasts: [],
        assumptions: null,
        macro: null,
        demo: isDemo,
        today,
        storeAvailable: false,
      }));
    } finally {
      setLoading(false);
    }
  }, [demo, today]);

  // Initial load and on demo mode change: asynchronous resolution without synchronous setState in effect body
  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch(`/api/market?demo=${demo}&today=${today}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (!cancelled) {
          setModel(data);
          setLoading(false);
        }
      } catch (err) {
        if (!cancelled) {
          console.warn('[MarketContext] Fetch /api/market failed, fallback to client computation:', err.message);
          setError(err.message);
          setModel(computeMarketModel({
            observations: [],
            indicators: [],
            forecasts: [],
            assumptions: null,
            macro: null,
            demo,
            today,
            storeAvailable: false,
          }));
          setLoading(false);
        }
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [demo, today]);

  const updateAssumptions = useCallback(async (patch) => {
    try {
      const res = await fetch('/api/assumptions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await fetchModel(demo);
      return true;
    } catch (err) {
      console.error('[MarketContext] Failed to update assumptions:', err);
      setError(err.message);
      return false;
    }
  }, [demo, fetchModel]);

  const importData = useCallback(async (type, csv) => {
    try {
      const res = await fetch('/api/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, csv, importDate: today }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || `HTTP ${res.status}`);
      await fetchModel(demo);
      return data;
    } catch (err) {
      console.error('[MarketContext] Import failed:', err);
      throw err;
    }
  }, [demo, fetchModel, today]);

  const issueNewForecast = useCallback(async (targetBasis) => {
    try {
      const res = await fetch('/api/forecast', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ basis: targetBasis, issueDate: today }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || `HTTP ${res.status}`);
      await fetchModel(demo);
      return data.forecast;
    } catch (err) {
      console.error('[MarketContext] Forecast issuance failed:', err);
      throw err;
    }
  }, [demo, fetchModel, today]);

  const value = {
    model,
    demo,
    setDemo,
    basis,
    setBasis,
    scenario,
    setScenario,
    today,
    loading,
    error,
    refresh: () => fetchModel(demo),
    updateAssumptions,
    importData,
    issueNewForecast,
  };

  return (
    <MarketContext.Provider value={value}>
      {children}
    </MarketContext.Provider>
  );
}
export default MarketProvider;
