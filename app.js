const API_ROOT = 'https://api.dexscreener.com/token-pairs/v1/solana/';
const REFRESH_MS = 45_000;
const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

const $ = (id) => document.getElementById(id);
const ui = {
  form: $('check-form'), input: $('mint-input'), error: $('form-error'), button: $('check-button'),
  result: $('result'), name: $('coin-name'), symbol: $('coin-symbol'), avatar: $('coin-avatar'),
  updated: $('last-updated'), pulse: $('pulse-number'), status: $('pulse-status'),
  caption: $('pulse-caption'), monitor: document.querySelector('.monitor-card'), wave: $('wave-path'),
  title: $('triage-title'), copy: $('triage-copy'), bars: $('activity-bars'),
  toast: $('toast'), address: $('mint-address'), dexLink: $('dex-link'), pumpLink: $('pump-link')
};

let activeMint = null;
let currentReport = null;
let activeRequest = null;
let toastTimer = null;

function extractMint(value) {
  const raw = value.trim();
  if (BASE58.test(raw)) return raw;
  try {
    const url = new URL(raw);
    if (!['pump.fun', 'www.pump.fun', 'dexscreener.com', 'www.dexscreener.com'].includes(url.hostname)) return null;
    return url.pathname.split('/').find((part) => BASE58.test(part)) || null;
  } catch {
    return null;
  }
}

function num(value) { return typeof value === 'number' && Number.isFinite(value) ? value : null; }
function count(value) { return num(value) ?? 0; }
function compact(value, digits = 1) {
  if (num(value) === null) return '—';
  if (Math.abs(value) < 1_000) return new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(value);
  return new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: digits }).format(value);
}
function money(value) {
  if (num(value) === null) return '—';
  return '$' + compact(value);
}
function age(timestamp) {
  if (num(timestamp) === null) return '—';
  const minutes = Math.max(0, Math.floor((Date.now() - timestamp) / 60_000));
  if (minutes < 60) return `${minutes}m`;
  if (minutes < 1_440) return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
  return `${Math.floor(minutes / 1_440)}d`;
}
function choosePair(pairs, mint) {
  const matching = pairs.filter((pair) => pair?.chainId === 'solana' && pair?.baseToken?.address === mint);
  return matching.sort((a, b) => {
    const aScore = (num(a.liquidity?.usd) ?? 0) || (num(a.volume?.h24) ?? 0) / 100;
    const bScore = (num(b.liquidity?.usd) ?? 0) || (num(b.volume?.h24) ?? 0) / 100;
    return bScore - aScore;
  })[0] || null;
}
function diagnosis(trades, buys, sells) {
  if (trades === 0) return {kind: 'quiet', label: 'QUIET RIGHT NOW', title: 'No recent trades.', copy: 'DEX Screener reports no buys or sells in the last five minutes for this tracked pair. That can change quickly; check again before drawing conclusions.'};
  if (trades < 5) return {kind: 'faint', label: 'FAINT PULSE', title: 'A faint pulse.', copy: `There ${trades === 1 ? 'was' : 'were'} ${trades} trade${trades === 1 ? '' : 's'} in the last five minutes: ${buys} buy${buys === 1 ? '' : 's'} and ${sells} sell${sells === 1 ? '' : 's'}. Activity is thin right now.`};
  if (trades < 25) return {kind: 'active', label: 'STILL BREATHING', title: 'There is movement.', copy: `${trades} trades in the last five minutes: ${buys} buys and ${sells} sells. That shows attention, but says nothing by itself about safety or future price.`};
  return {kind: 'active', label: 'ROOM IS BUSY', title: 'A lot of movement.', copy: `${trades} trades in the last five minutes: ${buys} buys and ${sells} sells. High activity can reflect excitement or rapid exits; read the full numbers.`};
}
function wavePath(trades) {
  if (trades === 0) return 'M0 55 H600';
  const beats = Math.min(6, Math.max(2, Math.round(trades / 8)));
  const step = 600 / beats;
  let path = 'M0 55';
  for (let i = 0; i < beats; i++) {
    const x = i * step;
    path += ` L${(x + step * .22).toFixed(1)} 55 L${(x + step * .33).toFixed(1)} 55 L${(x + step * .39).toFixed(1)} 43 L${(x + step * .45).toFixed(1)} 68 L${(x + step * .52).toFixed(1)} 13 L${(x + step * .59).toFixed(1)} 82 L${(x + step * .66).toFixed(1)} 55 L${(x + step).toFixed(1)} 55`;
  }
  return path;
}
function showError(message) { ui.error.textContent = message; ui.error.hidden = false; }
function clearError() { ui.error.textContent = ''; ui.error.hidden = true; }
function notify(message) {
  ui.toast.textContent = message;
  ui.toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => ui.toast.classList.remove('show'), 2800);
}
function shareUrl() {
  const url = new URL(window.location.href);
  url.search = '';
  url.searchParams.set('mint', activeMint);
  url.hash = '';
  return url.toString();
}
function safeUrl(value) {
  try { const url = new URL(value); return ['https:', 'http:'].includes(url.protocol) ? url.href : null; }
  catch { return null; }
}

function renderBars(pair) {
  ui.bars.replaceChildren();
  const pairAgeMinutes = num(pair.pairCreatedAt) === null ? null : Math.max(1, (Date.now() - pair.pairCreatedAt) / 60_000);
  const windows = [
    ['5 MIN', 5, pair.txns?.m5], ['1 HOUR', 60, pair.txns?.h1], ['24 HOUR', 1_440, pair.txns?.h24]
  ].map(([label, minutes, txns]) => ({label, perMinute: (count(txns?.buys) + count(txns?.sells)) / (pairAgeMinutes === null ? minutes : Math.min(minutes, pairAgeMinutes))}));
  const max = Math.max(...windows.map((item) => item.perMinute), .01);
  for (const item of windows) {
    const row = document.createElement('div'); row.className = 'activity-row';
    const label = document.createElement('span'); label.textContent = item.label;
    const track = document.createElement('div'); track.className = 'bar-track';
    const bar = document.createElement('div'); bar.className = 'bar-fill';
    bar.style.width = `${Math.max(0, Math.min(100, item.perMinute / max * 100))}%`;
    track.append(bar);
    const value = document.createElement('strong'); value.textContent = item.perMinute < .1 ? item.perMinute.toFixed(2) : item.perMinute.toFixed(1);
    row.append(label, track, value); ui.bars.append(row);
  }
}

function render(pair, mint) {
  const buys = count(pair.txns?.m5?.buys), sells = count(pair.txns?.m5?.sells);
  const trades = buys + sells, state = diagnosis(trades, buys, sells);
  const symbol = pair.baseToken?.symbol || 'TOKEN';
  const name = pair.baseToken?.name || symbol;
  const refreshedAt = new Date();
  currentReport = {pair, mint, buys, sells, trades, state, name, symbol, refreshedAt};
  ui.name.textContent = name; ui.symbol.textContent = '$' + symbol;
  ui.avatar.textContent = symbol.slice(0, 2).toUpperCase();
  ui.pulse.textContent = compact(trades); ui.status.textContent = state.label;
  ui.caption.textContent = 'Visual pulse represents the 5 minute trade count.';
  ui.monitor.classList.remove('quiet', 'faint', 'active'); ui.monitor.classList.add(state.kind);
  ui.wave.setAttribute('d', wavePath(trades));
  ui.title.textContent = state.title; ui.copy.textContent = state.copy;
  $('buys-five').textContent = compact(buys); $('sells-five').textContent = compact(sells);
  $('volume-hour').textContent = money(num(pair.volume?.h1));
  $('liquidity').textContent = money(num(pair.liquidity?.usd));
  $('liquidity-note').textContent = num(pair.liquidity?.usd) === null ? 'NOT REPORTED FOR THIS PAIR' : 'USD IN TRACKED PAIR';
  $('market-cap').textContent = money(num(pair.marketCap));
  $('pair-age').textContent = age(num(pair.pairCreatedAt));
  ui.updated.textContent = `CHECKED ${refreshedAt.toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'})}`;
  ui.address.textContent = mint;
  ui.dexLink.href = safeUrl(pair.url) || `https://dexscreener.com/solana/${encodeURIComponent(pair.pairAddress || mint)}`;
  ui.pumpLink.href = `https://pump.fun/coin/${encodeURIComponent(mint)}`;
  renderBars(pair);
  ui.result.hidden = false;
}

async function checkMint(mint, {scroll = false} = {}) {
  if (activeRequest) activeRequest.abort();
  const request = new AbortController(); activeRequest = request;
  ui.button.disabled = true; ui.button.querySelector('span').textContent = 'CHECKING…';
  clearError();
  try {
    const response = await fetch(API_ROOT + encodeURIComponent(mint), {signal: request.signal});
    if (!response.ok) throw new Error('Market data is unavailable right now. Try again shortly.');
    const pairs = await response.json();
    if (!Array.isArray(pairs)) throw new Error('The market data response was unexpected. Try again shortly.');
    const pair = choosePair(pairs, mint);
    if (!pair) throw new Error('No tracked Solana pair was found for that mint. Check the address or try a different token.');
    if (request.signal.aborted) return;
    activeMint = mint;
    ui.input.value = mint;
    window.history.replaceState(null, '', `?mint=${encodeURIComponent(mint)}`);
    render(pair, mint);
    if (scroll) ui.result.scrollIntoView({behavior: 'smooth', block: 'start'});
  } catch (error) {
    if (error.name !== 'AbortError') {
      const message = error instanceof TypeError ? 'Could not connect to market data. Check your connection and try again.' : error.message;
      showError(currentReport && mint !== activeMint ? `${message} The previous report is still shown below.` : message);
      if (currentReport && mint === activeMint) { ui.updated.textContent = 'LAST CHECK MAY BE STALE'; notify('Refresh failed. Showing the last check.'); }
    }
  } finally {
    if (activeRequest === request) {
      activeRequest = null; ui.button.disabled = false;
      ui.button.querySelector('span').textContent = 'RUN CHECK';
    }
  }
}

function drawReceipt(report) {
  const canvas = document.createElement('canvas'); canvas.width = 1200; canvas.height = 675;
  const c = canvas.getContext('2d');
  c.fillStyle = '#0a0d0d'; c.fillRect(0, 0, 1200, 675);
  c.fillStyle = '#162019'; c.fillRect(30, 30, 1140, 615);
  c.strokeStyle = '#4d6344'; c.lineWidth = 2; c.strokeRect(30, 30, 1140, 615);
  c.fillStyle = '#bbf75c'; c.fillRect(65, 65, 52, 52);
  c.fillStyle = '#0a0d0d'; c.font = 'bold 43px Arial'; c.fillText('+', 77, 105);
  c.fillStyle = '#f0f5eb'; c.font = 'bold 30px Arial'; c.fillText('COIN', 136, 102);
  c.fillStyle = '#bbf75c'; c.fillText('ER', 220, 102);
  c.textAlign = 'right'; c.fillStyle = '#a8b7a9'; c.font = '17px monospace'; c.fillText('TOKEN ACTIVITY RECEIPT', 1135, 100); c.textAlign = 'left';
  c.fillStyle = '#bbf75c'; c.font = '18px monospace'; c.fillText('PATIENT UNDER OBSERVATION', 67, 173);
  c.fillStyle = '#f0f5eb'; c.font = 'bold 56px Arial'; c.fillText(report.name.slice(0, 29), 65, 237);
  c.fillStyle = '#9aae9d'; c.font = '23px monospace'; c.fillText(`$${report.symbol}  ·  ${report.mint.slice(0, 7)}…${report.mint.slice(-7)}`, 68, 276);
  c.strokeStyle = '#405240'; c.beginPath(); c.moveTo(65, 310); c.lineTo(1135, 310); c.stroke();
  c.fillStyle = report.state.kind === 'quiet' ? '#ff7169' : report.state.kind === 'faint' ? '#ffc46b' : '#bbf75c';
  c.font = 'bold 118px Arial'; c.fillText(String(report.trades), 65, 440);
  c.fillStyle = '#a8b7a9'; c.font = '19px monospace'; c.fillText('TRADES / 5 MIN', 66, 477);
  c.fillStyle = '#f0f5eb'; c.font = 'bold 35px Arial'; c.fillText(report.state.label, 430, 388);
  c.fillStyle = '#a8b7a9'; c.font = '21px monospace';
  c.fillText(`${report.buys} BUYS    ${report.sells} SELLS`, 432, 433);
  c.fillText(`1H VOL ${money(num(report.pair.volume?.h1))}    LIQ ${money(num(report.pair.liquidity?.usd))}`, 432, 469);
  c.strokeStyle = '#405240'; c.beginPath(); c.moveTo(65, 515); c.lineTo(1135, 515); c.stroke();
  c.fillStyle = '#a8b7a9'; c.font = '17px monospace';
  c.fillText(`CHECKED ${report.refreshedAt.toLocaleString()}  ·  DEX SCREENER`, 65, 560);
  c.fillText('ACTIVITY ≠ SAFETY OR A PRICE PREDICTION', 65, 592);
  c.textAlign = 'right'; c.fillStyle = '#bbf75c'; c.fillText('COIN ER  ↗', 1135, 588);
  return canvas;
}

ui.form.addEventListener('submit', (event) => {
  event.preventDefault();
  const mint = extractMint(ui.input.value);
  if (!mint) { showError('Paste a valid Solana mint address or Pump.fun coin link.'); return; }
  checkMint(mint, {scroll: true});
});
document.querySelectorAll('[data-mint]').forEach((button) => button.addEventListener('click', () => checkMint(button.dataset.mint, {scroll: true})));
$('refresh-button').addEventListener('click', () => { if (activeMint) checkMint(activeMint); });
$('copy-link-button').addEventListener('click', async () => {
  if (!activeMint) return;
  try { await navigator.clipboard.writeText(shareUrl()); notify('Live link copied.'); }
  catch { notify('Clipboard unavailable. Use the address bar link.'); }
});
$('share-button').addEventListener('click', async () => {
  if (!currentReport) return;
  const url = shareUrl();
  const text = `${currentReport.name} has ${currentReport.trades} trades in the last 5 minutes. Check its pulse on Coin ER:`;
  if (navigator.share) {
    try { await navigator.share({title: 'Coin ER', text, url}); } catch { /* user cancelled */ }
  } else window.open(`https://x.com/intent/post?text=${encodeURIComponent(`${text} ${url}`)}`, '_blank', 'noopener,noreferrer');
});
$('save-card-button').addEventListener('click', () => {
  if (!currentReport) return;
  const link = document.createElement('a');
  link.download = `coin-er-${currentReport.symbol.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${Date.now()}.png`;
  link.href = drawReceipt(currentReport).toDataURL('image/png'); link.click();
  notify('Receipt saved as PNG.');
});
setInterval(() => { if (activeMint && !document.hidden && !activeRequest) checkMint(activeMint); }, REFRESH_MS);
const initial = new URLSearchParams(location.search).get('mint');
if (initial) {
  const mint = extractMint(initial);
  if (mint) checkMint(mint);
  else showError('The shared link does not contain a valid Solana mint.');
}
