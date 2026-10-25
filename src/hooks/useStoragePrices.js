import { useState, useEffect, useCallback } from 'react';
import { CASH_DEFAULTS } from '../data/marketData';

const STORAGE_PRICES_KEY = 'agro_storage_prices';

function getInitialPrices() {
  try {
    const saved = localStorage.getItem(STORAGE_PRICES_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      return { ...CASH_DEFAULTS, ...parsed };
    }
  } catch (e) {
    console.error('Failed to load storage prices from localStorage', e);
  }
  return { ...CASH_DEFAULTS };
}

export function useStoragePrices() {
  const [storagePrices, setStoragePricesState] = useState(getInitialPrices);

  const setStoragePrice = useCallback((cropId, price) => {
    const num = isNaN(price) ? 0 : price;
    setStoragePricesState(prev => {
      const updated = { ...prev, [cropId]: num };
      try {
        localStorage.setItem(STORAGE_PRICES_KEY, JSON.stringify(updated));
        window.dispatchEvent(new Event('agro_storage_prices_changed'));
      } catch (e) {
        console.error('Failed to save storage price', e);
      }
      return updated;
    });
  }, []);

  const resetStoragePrice = useCallback((cropId) => {
    setStoragePricesState(prev => {
      const updated = { ...prev, [cropId]: CASH_DEFAULTS[cropId] };
      try {
        localStorage.setItem(STORAGE_PRICES_KEY, JSON.stringify(updated));
        window.dispatchEvent(new Event('agro_storage_prices_changed'));
      } catch {
        // silent fail if localStorage is disabled
      }
      return updated;
    });
  }, []);

  const resetAll = useCallback(() => {
    setStoragePricesState({ ...CASH_DEFAULTS });
    try {
      localStorage.removeItem(STORAGE_PRICES_KEY);
      window.dispatchEvent(new Event('agro_storage_prices_changed'));
    } catch {
      // silent fail if localStorage is disabled
    }
  }, []);

  useEffect(() => {
    function handleStorageChange() {
      setStoragePricesState(getInitialPrices());
    }
    window.addEventListener('storage', handleStorageChange);
    window.addEventListener('agro_storage_prices_changed', handleStorageChange);
    return () => {
      window.removeEventListener('storage', handleStorageChange);
      window.removeEventListener('agro_storage_prices_changed', handleStorageChange);
    };
  }, []);

  const isCustom = useCallback((cropId) => {
    return Math.abs((storagePrices[cropId] ?? CASH_DEFAULTS[cropId]) - CASH_DEFAULTS[cropId]) > 0.001;
  }, [storagePrices]);

  const hasAnyCustom = Object.keys(CASH_DEFAULTS).some(k => isCustom(k));

  return {
    storagePrices,
    setStoragePrice,
    resetStoragePrice,
    resetAll,
    isCustom,
    hasAnyCustom,
  };
}
