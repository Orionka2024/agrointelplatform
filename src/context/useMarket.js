import { useContext } from 'react';
import { MarketContext } from './marketContextDef.js';

export function useMarket() {
  const ctx = useContext(MarketContext);
  if (!ctx) {
    throw new Error('useMarket must be used within a MarketProvider');
  }
  return ctx;
}
