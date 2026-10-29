/**
 * Forecast target definition.
 *
 * The primary target is the price a Volgograd-region seller can obtain for a warehouse lot.
 * Moscow wholesale is a SEPARATE series with a different delivery basis and VAT treatment;
 * the two are only linked through an explicit, editable cost bridge (see bridge.js).
 *
 * Fields flagged `confirmed: false` are working assumptions that the business owner must confirm.
 * They are never presented as verified facts.
 */

export const PRICE_UNIT = 'RUB/kg';
export const DEFAULT_VAT_RATE = 0.10; // 10 % reduced rate for vegetables (user-editable assumption)

export const TARGET_SPECS = {
  warehouse: {
    id: 'onion-volgograd-warehouse',
    market: 'warehouse_volgograd',
    label: 'Лук репчатый · склад продавца, Волгоградская обл.',
    unit: PRICE_UNIT,
    deliveryBasis: ['EXW', 'FCA'],
    vat: 'excl',
    fields: {
      grade: { value: null, confirmed: false, note: 'Сорт / калибр не определён — укажите (например 1-й сорт, 50–70 мм).' },
      packaging: { value: null, confirmed: false, note: 'Фасовка не определена (навалом / сетки / мешки).' },
      lotSizeT: { value: null, confirmed: false, note: 'Размер партии не определён (т).' },
      paymentTerms: { value: null, confirmed: false, note: 'Условия оплаты не определены (предоплата / отсрочка).' },
    },
  },
  moscow: {
    id: 'onion-moscow-wholesale',
    market: 'moscow_wholesale',
    label: 'Лук репчатый · опт Москва (с доставкой)',
    unit: PRICE_UNIT,
    deliveryBasis: ['DAP', 'DDP'],
    vat: 'incl_for_display',
    fields: {
      grade: { value: null, confirmed: false, note: 'Сорт / калибр не определён.' },
      packaging: { value: null, confirmed: false, note: 'Фасовка не определена.' },
      lotSizeT: { value: null, confirmed: false, note: 'Размер партии не определён.' },
      paymentTerms: { value: null, confirmed: false, note: 'Условия оплаты не определены.' },
    },
  },
};

export const MARKETS = ['warehouse_volgograd', 'moscow_wholesale', 'other'];
export const KINDS = ['transaction', 'bid', 'ask', 'index'];
export const KIND_LABELS = {
  transaction: 'Сделка (фактическая)',
  bid: 'Заявка покупателя (bid)',
  ask: 'Цена предложения продавца (ask)',
  index: 'Опубликованный индекс / котировка',
};

export function marketForBasis(basis) {
  return basis === 'moscow' ? 'moscow_wholesale' : 'warehouse_volgograd';
}
