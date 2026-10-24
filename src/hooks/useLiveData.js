/**
 * useLiveData — хук для получения live-данных с ежедневным кешированием
 *
 * Логика:
 * 1. При первом рендере читает кеш из localStorage (ключ: agro_live_cache)
 * 2. Если кеш свежий (< 24 часов) — использует его, не делает запрос
 * 3. Если кеш устарел или отсутствует — запрашивает /api/macro
 * 4. При ошибке сети — использует кеш (даже устаревший) или fallback-значения
 *
 * Возвращает:
 *   liveData:    { usdRub, keyRate, date, fetchedAt }
 *   isLoading:   bool — идёт первый запрос (показать скелетон)
 *   isStale:     bool — данные из кеша (не свежий запрос)
 *   isOffline:   bool — API недоступен, используем кеш
 *   lastUpdated: Date | null — время последнего успешного обновления
 *   refresh:     () => void — принудительное обновление
 */

import { useState, useEffect, useCallback } from 'react';
import { MACRO } from '../data/marketData';

const CACHE_KEY = 'agro_live_cache';
const TTL_MS = 24 * 60 * 60 * 1000; // 24 часа

// Fallback values from static marketData (used when API is unreachable)
const FALLBACK = {
  usdRub:  MACRO.usdRub,
  kztRub:  MACRO.kztRub,
  keyRate: MACRO.keyRate,
  date:    null,
  fetchedAt: null,
};

function readCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed;
  } catch {
    return null;
  }
}

function writeCache(data) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(data));
  } catch {
    // localStorage unavailable (private mode etc.) — silent fail
  }
}

function isCacheValid(cache) {
  if (!cache || !cache.fetchedAt) return false;
  return Date.now() - new Date(cache.fetchedAt).getTime() < TTL_MS;
}

export function useLiveData() {
  const cache = readCache();
  const hasValidCache = isCacheValid(cache);

  const [liveData, setLiveData]     = useState(hasValidCache ? cache : FALLBACK);
  const [isLoading, setIsLoading]   = useState(!hasValidCache);
  const [isStale, setIsStale]       = useState(hasValidCache);
  const [isOffline, setIsOffline]   = useState(false);
  const [lastUpdated, setLastUpdated] = useState(
    cache?.fetchedAt ? new Date(cache.fetchedAt) : null
  );

  const fetchLiveData = useCallback(async (force = false) => {
    const currentCache = readCache();
    if (!force && isCacheValid(currentCache)) {
      setLiveData(currentCache);
      setIsStale(true);
      setIsLoading(false);
      setLastUpdated(new Date(currentCache.fetchedAt));
      return;
    }

    setIsLoading(true);
    try {
      const res = await fetch('/api/macro');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();

      if (data.error) throw new Error(data.error);

      const merged = {
        usdRub:    data.usdRub    ?? FALLBACK.usdRub,
        kztRub:    data.kztRub    ?? FALLBACK.kztRub,
        keyRate:   data.keyRate   ?? FALLBACK.keyRate,
        date:      data.date      ?? null,
        fetchedAt: data.fetchedAt ?? new Date().toISOString(),
      };

      writeCache(merged);
      setLiveData(merged);
      setIsStale(false);
      setIsOffline(false);
      setLastUpdated(new Date(merged.fetchedAt));
    } catch (err) {
      console.warn('[useLiveData] Fetch failed, using cache/fallback:', err.message);
      const staleCache = readCache();
      if (staleCache) {
        setLiveData(staleCache);
        setLastUpdated(new Date(staleCache.fetchedAt));
      } else {
        setLiveData(FALLBACK);
        setLastUpdated(null);
      }
      setIsOffline(true);
      setIsStale(true);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    let ignore = false;
    async function init() {
      const currentCache = readCache();
      if (isCacheValid(currentCache)) {
        return;
      }
      try {
        const res = await fetch('/api/macro');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (ignore) return;
        if (data.error) throw new Error(data.error);

        const merged = {
          usdRub:    data.usdRub    ?? FALLBACK.usdRub,
          kztRub:    data.kztRub    ?? FALLBACK.kztRub,
          keyRate:   data.keyRate   ?? FALLBACK.keyRate,
          date:      data.date      ?? null,
          fetchedAt: data.fetchedAt ?? new Date().toISOString(),
        };

        writeCache(merged);
        setLiveData(merged);
        setIsStale(false);
        setIsOffline(false);
        setLastUpdated(new Date(merged.fetchedAt));
      } catch (err) {
        if (ignore) return;
        console.warn('[useLiveData] Fetch failed, using cache/fallback:', err.message);
        const staleCache = readCache();
        if (staleCache) {
          setLiveData(staleCache);
          setLastUpdated(new Date(staleCache.fetchedAt));
        } else {
          setLiveData(FALLBACK);
          setLastUpdated(null);
        }
        setIsOffline(true);
        setIsStale(true);
      } finally {
        if (!ignore) setIsLoading(false);
      }
    }
    init();
    return () => { ignore = true; };
  }, []);

  return {
    liveData,
    isLoading,
    isStale,
    isOffline,
    lastUpdated,
    refresh: () => fetchLiveData(true),
  };
}

