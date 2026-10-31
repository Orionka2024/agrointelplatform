import { useState, useEffect, useCallback } from 'react';
import { MarketContext } from './marketContextDef.js';
import { todayISO } from '../../shared/dates.js';
import { computeMarketModel } from '../../shared/marketModel.js';
import { importPriceCSV } from '../../shared/observations.js';
import { buildUserPriceCsv } from '../../shared/localBasis.js';
import { officialDrivers, officialSnapshot } from '../../shared/officialData.js';
import {
  loadStoredUserPrices,
  loadStoredAssumptions,
  mergeStoredAssumptions,
  clearStoredUserPrices,
} from '../utils/userPriceStore.js';
import {
  buildDefaultMarketSignals,
  computeMarketFactorAnalytics,
} from '../../shared/marketSignals.js';

function buildClientFallbackMacro(serverMacro, today) {
  const fromView = (k) => {
    const m = serverMacro?.[k];
    if (m && m.value != null) {
      return {
        value: m.value,
        asOf: m.provenance?.asOf || today,
        origin: m.provenance?.origin || 'cached',
        source: m.provenance?.source || 'cbr.ru',
        fetchedAt: m.provenance?.fetchedAt || null,
      };
    }
    return null;
  };
  const usd = officialDrivers.usdRub.filter((r) => r.availableDate <= today).at(-1);
  const kzt = (officialDrivers.kztRub || []).filter((r) => r.availableDate <= today).at(-1);
  const kr = officialDrivers.keyRate.filter((r) => r.availableDate <= today).at(-1);
  return {
    usdRub: fromView('usdRub') ?? (usd ? { value: usd.value, asOf: usd.availableDate, origin: 'cached', source: 'cbr.ru (месячный архив)' } : null),
    kztRub: fromView('kztRub') ?? (kzt ? { value: kzt.value, asOf: kzt.availableDate, origin: 'cached', source: 'cbr.ru (месячный архив)' } : null),
    keyRate: fromView('keyRate') ?? (kr ? { value: kr.value, asOf: kr.availableDate, origin: 'cached', source: 'cbr.ru (месячный архив)' } : null),
  };
}

function hydrateWithBrowserEntries(serverData, isDemo, today) {
  if (isDemo) return serverData;
  const localEntries = loadStoredUserPrices();
  const localAssumptions = loadStoredAssumptions();
  // When running on durable local SQLite, serverData already contains imported observations;
  // only overlay browser entries when server storage is ephemeral (e.g. Vercel serverless) or empty.
  if (serverData && serverData.storeDurable !== false) {
    return serverData;
  }
  if (!localEntries.length && !localAssumptions && serverData) {
    return serverData;
  }

  const parsedObs = localEntries.length
    ? importPriceCSV(buildUserPriceCsv(localEntries, today), [], { importDate: today, today }).accepted
    : [];

  const baseAssumptions = serverData?.assumptions || { version: 2 };
  const mergedAssumptions = localAssumptions
    ? {
        ...baseAssumptions,
        version: 2,
        bridge: { ...(baseAssumptions.bridge || {}), ...(localAssumptions.bridge || {}) },
        storage: { ...(baseAssumptions.storage || {}), ...(localAssumptions.storage || {}) },
        manualPrices: { ...(baseAssumptions.manualPrices || {}), ...(localAssumptions.manualPrices || {}) },
      }
    : baseAssumptions;

  const computed = computeMarketModel({
    observations: parsedObs,
    indicators: [],
    forecasts: [],
    assumptions: mergedAssumptions,
    macro: buildClientFallbackMacro(serverData?.macro, today),
    demo: false,
    today,
    storeAvailable: Boolean(serverData),
  });
  computed.storeDurable = serverData ? serverData.storeDurable : false;
  computed.official = serverData?.official ?? officialSnapshot(today);
  computed.annualHistory = serverData?.annualHistory ?? [];
  computed.annualEvidence = serverData?.annualEvidence ?? null;
  return computed;
}

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
    const initial = computeMarketModel({
      observations: [],
      indicators: [],
      forecasts: [],
      assumptions: null,
      macro: buildClientFallbackMacro(null, todayISO()),
      demo: false,
      today: todayISO(),
      storeAvailable: false,
    });
    initial.storeDurable = false;
    return hydrateWithBrowserEntries(initial, false, todayISO());
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [rawSignals, setRawSignals] = useState(() => buildDefaultMarketSignals(todayISO(), 15.5));
  const [signalsBusy, setSignalsBusy] = useState(false);

  const effBaseWh = model?.prices?.warehouse?.exVat ?? 15.5;

  const refreshSignals = useCallback(async (force = true) => {
    setSignalsBusy(true);
    try {
      const res = await fetch(
        `/api/signals?today=${today}&baseWh=${effBaseWh}${force ? '&force=1' : ''}`
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setRawSignals(data);
      return data;
    } catch (err) {
      console.warn('[MarketContext] /api/signals fallback to baseline snapshot:', err.message);
      setRawSignals((prev) => prev || buildDefaultMarketSignals(today, effBaseWh));
      return null;
    } finally {
      setSignalsBusy(false);
    }
  }, [today, effBaseWh]);

  useEffect(() => {
    let cancelled = false;
    async function loadSignals() {
      setSignalsBusy(true);
      try {
        const res = await fetch(`/api/signals?today=${today}&baseWh=15.5`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (!cancelled) setRawSignals(data);
      } catch {
        if (!cancelled) {
          setRawSignals((prev) => prev || buildDefaultMarketSignals(today, 15.5));
        }
      } finally {
        if (!cancelled) setSignalsBusy(false);
      }
    }
    loadSignals();
    return () => {
      cancelled = true;
    };
  }, [today]);

  const signals = {
    ...rawSignals,
    analytics: computeMarketFactorAnalytics({
      fx: rawSignals.fx,
      weatherHubs: rawSignals.weatherHubs,
      spotChannels: rawSignals.spotChannels,
      baseWarehouseExVat: effBaseWh,
      today,
    }),
  };

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
      setModel(hydrateWithBrowserEntries(data, isDemo, today));
    } catch (err) {
      console.warn('[MarketContext] Fetch /api/market failed, computing client fallback:', err.message);
      setError(err.message);
      setModel(hydrateWithBrowserEntries(null, isDemo, today));
    } finally {
      setLoading(false);
    }
  }, [demo, today]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch(`/api/market?demo=${demo}&today=${today}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (!cancelled) {
          setModel(hydrateWithBrowserEntries(data, demo, today));
          setLoading(false);
        }
      } catch (err) {
        if (!cancelled) {
          console.warn('[MarketContext] Fetch /api/market failed, fallback to client computation:', err.message);
          setError(err.message);
          setModel(hydrateWithBrowserEntries(null, demo, today));
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
    mergeStoredAssumptions(patch);
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
      setModel((prev) => hydrateWithBrowserEntries(prev, demo, today));
      return false;
    }
  }, [demo, fetchModel, today]);

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

  const clearLocalEntries = useCallback(async () => {
    clearStoredUserPrices();
    await fetchModel(demo);
  }, [demo, fetchModel]);

  const value = {
    model,
    signals,
    signalsBusy,
    refreshSignals,
    demo,
    setDemo,
    basis,
    setBasis,
    scenario,
    setScenario,
    today,
    loading,
    error,
    refresh: async () => {
      await Promise.all([fetchModel(demo), refreshSignals(true)]);
    },
    updateAssumptions,
    importData,
    issueNewForecast,
    clearLocalEntries,
  };

  return (
    <MarketContext.Provider value={value}>
      {children}
    </MarketContext.Provider>
  );
}
export default MarketProvider;
