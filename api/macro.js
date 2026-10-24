/**
 * Vercel Serverless Function: /api/macro
 * Fetches live macro data from the Central Bank of Russia (cbr.ru)
 * Returns: { usdRub, keyRate, date, source }
 */
export default async function handler(req, res) {
  // Allow CORS for frontend fetch
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');

  // Cache on Vercel Edge for 6 hours
  res.setHeader('Cache-Control', 's-maxage=21600, stale-while-revalidate=3600');

  try {
    // Fetch daily currency XML from CBR
    const cbrRes = await fetch('https://www.cbr.ru/scripts/XML_daily.asp', {
      headers: { 'Accept': 'application/xml' },
      signal: AbortSignal.timeout(8000),
    });

    if (!cbrRes.ok) throw new Error(`CBR HTTP ${cbrRes.status}`);

    const xml = await cbrRes.text();

    // Extract USD rate (Valute ID R01235 = USD)
    const usdMatch = xml.match(/<Valute ID="R01235">[\s\S]*?<Value>([\d,]+)<\/Value>/);
    const usdRub = usdMatch ? parseFloat(usdMatch[1].replace(',', '.')) : null;

    // Extract KZT rate (Valute ID R01335 = KZT)
    const kztMatch = xml.match(/<Valute ID="R01335">[\s\S]*?<Nominal>([\d,]+)<\/Nominal>[\s\S]*?<Value>([\d,]+)<\/Value>/);
    const kztRub = kztMatch ? parseFloat(kztMatch[2].replace(',', '.')) / parseFloat(kztMatch[1].replace(',', '.')) : null;


    // Extract date from XML header
    const dateMatch = xml.match(/Date="(\d{2})\.(\d{2})\.(\d{4})"/);
    const date = dateMatch
      ? `${dateMatch[3]}-${dateMatch[2]}-${dateMatch[1]}`
      : new Date().toISOString().split('T')[0];

    // Fetch key rate from CBR key rate endpoint
    let keyRate = null;
    try {
      const krRes = await fetch(
        'https://www.cbr.ru/hd_base/KeyRate/?UniDbQuery.Posted=True&UniDbQuery.From=' +
          new Date(Date.now() - 7 * 86400000).toLocaleDateString('ru-RU') +
          '&UniDbQuery.To=' +
          new Date().toLocaleDateString('ru-RU'),
        { signal: AbortSignal.timeout(5000) }
      );
      const krHtml = await krRes.text();
      // Parse most recent key rate value from HTML table
      const krMatch = krHtml.match(/(\d{1,2}[.,]\d{2})\s*<\/td>\s*<\/tr>/);
      if (krMatch) keyRate = parseFloat(krMatch[1].replace(',', '.'));
    } catch {
      // Key rate is not critical — fallback to null (frontend uses marketData.js value)
    }

    res.status(200).json({
      usdRub,
      kztRub,
      keyRate,
      date,
      source: 'cbr.ru',
      fetchedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[api/macro] Error:', err.message);
    res.status(503).json({
      error: 'Failed to fetch macro data',
      message: err.message,
    });
  }
}
