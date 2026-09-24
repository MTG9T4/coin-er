# Coin ER

Coin ER is a small, shareable activity check for Solana tokens. Paste a mint or Pump.fun coin URL to see recent buys and sells, trade intensity, volume, liquidity, market cap and pair age. Save a time stamped PNG or share a link that rechecks live data.

**Live site:** https://mtg9t4.github.io/coin-er/

## Run

From this directory: `python3 -m http.server 4181`, then open `http://localhost:4181/`.

There is no build step or wallet connection. The static site fetches [DEX Screener's token pair API](https://docs.dexscreener.com/api/reference) directly in the browser and refreshes every 45 seconds while visible.

## Scope and limits

- The status reflects only the number of trades in the latest 5 minute window for the selected tracked pair. It is not a safety rating, investment recommendation, or price prediction.
- A flat pulse means zero trades in that window according to DEX Screener; it does not mean a token is permanently dead.
- Liquidity and other metrics are shown as unavailable when the source does not report them. The app does not infer creator sales, holder concentration, or contract safety.
- Market data can lag or be incomplete. Pair selection favors the most liquid pair where the mint is the base token; otherwise it uses volume.
- No analytics or user data is stored.

## Launch approach

Share the site first. Test whether traders actually share receipts and return to check tokens. If that happens, consider a separate community token plan. The app itself has no token requirement and no token is launched here.

The square project icon is at [`brand/coin-er-icon.png`](brand/coin-er-icon.png). A token name or ticker is intentionally not represented as launched or reserved.
