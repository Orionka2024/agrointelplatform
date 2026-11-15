/**
 * Offline queue and attestation validator for transaction entries (P1-8, F-06, F-11).
 * Allows field and mobile entry without immediate connectivity, syncing to server when online.
 */

const QUEUE_STORAGE_KEY = 'agro_offline_tx_queue';

let customStorageProvider = null;

function getStorage() {
  if (customStorageProvider) return customStorageProvider;
  if (typeof window !== 'undefined' && window.localStorage) {
    return window.localStorage;
  }
  return null;
}

export function setOfflineStorageProvider(provider) {
  customStorageProvider = provider;
}

/**
 * Validates that an attested transaction has all required physical and contractual parameters.
 */
export function validateAttestedTransaction(tx = {}) {
  const errors = [];

  if (!tx.attested) {
    errors.push('Необходимо подтвердить фактическое совершение сделки по накладным (ТТН/УПД)');
  }

  const price = Number(tx.priceRubKg ?? tx.price ?? tx.priceExVat);
  if (!Number.isFinite(price) || price <= 0) {
    errors.push('Укажите корректную положительную цену (₽/кг)');
  }

  const lotSize = Number(tx.lotSizeT ?? tx.volumeT ?? tx.volume);
  if (!Number.isFinite(lotSize) || lotSize <= 0) {
    errors.push('Укажите физический объём партии (тонн)');
  }

  if (!tx.date && !tx.observationDate) {
    errors.push('Укажите дату совершения сделки');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Reads pending offline queue from storage.
 */
export function getPendingQueue() {
  const storage = getStorage();
  if (!storage) return [];
  try {
    const raw = storage.getItem(QUEUE_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    console.warn('[offlineQueue] Error reading queue from storage:', err);
    return [];
  }
}

/**
 * Enqueues a transaction entry to localStorage.
 */
export function enqueuePendingTransaction(tx = {}) {
  const validation = validateAttestedTransaction(tx);
  if (!validation.valid) {
    throw new Error(`Невозможно добавить в очередь: ${validation.errors.join('; ')}`);
  }

  const queue = getPendingQueue();
  const entry = {
    ...tx,
    id: tx.id || `offline-tx-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    enqueuedAt: new Date().toISOString(),
  };

  queue.push(entry);
  const storage = getStorage();
  if (storage) {
    storage.setItem(QUEUE_STORAGE_KEY, JSON.stringify(queue));
  }
  return entry;
}

/**
 * Removes a single item from the pending queue.
 */
export function removePendingTransaction(id) {
  const queue = getPendingQueue().filter((item) => item.id !== id);
  const storage = getStorage();
  if (storage) {
    storage.setItem(QUEUE_STORAGE_KEY, JSON.stringify(queue));
  }
  return queue;
}

/**
 * Clears the entire offline queue.
 */
export function clearPendingQueue() {
  const storage = getStorage();
  if (storage) {
    storage.removeItem(QUEUE_STORAGE_KEY);
  }
}

/**
 * Flushes pending queue to server via provided import function or fetch.
 */
export function flushPendingQueue({ importFn } = {}) {
  return (async () => {
    const queue = getPendingQueue();
    if (!queue.length) {
      return { successCount: 0, failedCount: 0, remaining: 0 };
    }

    let successCount = 0;
    let failedCount = 0;
    const remaining = [];

    for (const item of queue) {
      try {
        if (typeof importFn === 'function') {
          await importFn(item);
        } else {
          // Default browser fetch to /api/import
          const res = await fetch('/api/import', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              type: 'prices',
              data: [
                {
                  id: item.id,
                  kind: 'transaction',
                  market: item.basis || 'warehouse_volgograd',
                  geography: 'Волгоградская обл.',
                  observationDate: item.date || item.observationDate,
                  priceRubKg: item.priceRubKg || item.price,
                  priceExVatRubKg: item.priceExVat || item.priceRubKg || item.price,
                  deliveryBasis: 'EXW',
                  volumeT: item.lotSizeT,
                  spec: {
                    grade: item.grade || '1 сорт (ГОСТ 34306-2017)',
                    caliber: item.caliber || '5+ см',
                    packaging: item.packaging || 'Сетка 25-30 кг на паллетах',
                    paymentTerms: item.paymentTerms || '100% предоплата',
                    buyerType: item.buyerType || 'Оптовик (EXW склад)',
                  },
                  verification: {
                    status: 'verified',
                    by: 'attested_user',
                    at: new Date().toISOString(),
                    evidence: 'Товарно-транспортная накладная / УПД',
                  },
                },
              ],
            }),
          });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
        }
        successCount++;
      } catch (err) {
        console.warn(`[offlineQueue] Failed to sync item ${item.id}:`, err);
        failedCount++;
        remaining.push(item);
      }
    }

    const storage = getStorage();
    if (storage) {
      storage.setItem(QUEUE_STORAGE_KEY, JSON.stringify(remaining));
    }

    return {
      successCount,
      failedCount,
      remaining: remaining.length,
    };
  })();
}

/**
 * Initializes automatic background synchronization when browser reconnects.
 */
export function initOfflineSyncListener({ onSync } = {}) {
  if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') {
    return () => {};
  }

  const handler = async () => {
    console.info('[offlineQueue] Network online event detected, flushing queue...');
    const res = await flushPendingQueue();
    if (typeof onSync === 'function') {
      onSync(res);
    }
  };

  window.addEventListener('online', handler);
  return () => window.removeEventListener('online', handler);
}
