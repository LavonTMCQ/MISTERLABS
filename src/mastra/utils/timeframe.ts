// Map natural phrases to TapTools timeframe strings
// Supported outputs: '1h','4h','12h','24h','7d','30d','180d','1y','all'
export function mapTimePhraseToTapTools(input?: string): '1h'|'4h'|'12h'|'24h'|'7d'|'30d'|'180d'|'1y'|'all' {
  const s = (input || '').toLowerCase().trim();
  if (!s) return '24h';
  if (['1h','1hr','hour','an hour','last hour'].includes(s)) return '1h';
  if (['4h','4hr','four hours','last 4 hours'].includes(s)) return '4h';
  if (['12h','12hr','twelve hours','half day'].includes(s)) return '12h';
  if (['24h','day','daily','today','last day'].includes(s)) return '24h';
  if (['7d','week','weekly','last 7 days','past week'].includes(s)) return '7d';
  if (['30d','month','monthly','last 30 days','past month'].includes(s)) return '30d';
  if (['180d','6m','six months','half year'].includes(s)) return '180d';
  if (['1y','year','12m','last year','past year','annual'].includes(s)) return '1y';
  if (['all','max','lifetime'].includes(s)) return 'all';
  return '24h';
}

