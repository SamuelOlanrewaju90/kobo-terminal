const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 4000;
const PORTFOLIO_FILE = path.join(__dirname, "data", "portfolio.json");
const STARTING_CASH = 100000;
const HIST_LEN = 32;
const TICK_MS = 2500;

// Frontend runs on a different origin/port, so CORS must be enabled explicitly.
// Restrict this to your actual frontend URL in production.
app.use(cors({ origin: "*" }));
app.use(express.json());

// ---------- market data (in-memory, lives on the server) ----------
const SEED_STOCKS = [
  { symbol: "MTNN", name: "MTN Nigeria", base: 245.0 },
  { symbol: "DANGCEM", name: "Dangote Cement", base: 495.0 },
  { symbol: "GTCO", name: "Guaranty Trust Holding", base: 78.2 },
  { symbol: "ZENITHBANK", name: "Zenith Bank", base: 52.4 },
  { symbol: "BUACEMENT", name: "BUA Cement", base: 130.5 },
  { symbol: "NESTLE", name: "Nestle Nigeria", base: 1450.0 },
  { symbol: "ACCESSCORP", name: "Access Holdings", base: 24.1 },
  { symbol: "AIRTELAFRI", name: "Airtel Africa", base: 2300.0 },
  { symbol: "SEPLAT", name: "Seplat Energy", base: 5800.0 },
  { symbol: "BUAFOODS", name: "BUA Foods", base: 420.0 },
];

function genHistory(base) {
  const out = [];
  let price = base;
  for (let i = 0; i < HIST_LEN; i++) {
    price = Math.max(0.5, price * (1 + (Math.random() - 0.5) * 0.03));
    out.push(+price.toFixed(2));
  }
  return out;
}

let stocks = SEED_STOCKS.map((s) => {
  const history = genHistory(s.base);
  return { ...s, price: history[history.length - 1], history };
});

function tickMarket() {
  stocks = stocks.map((s) => {
    const last = s.history[s.history.length - 1];
    const next = Math.max(0.5, +(last * (1 + (Math.random() - 0.5) * 0.02)).toFixed(2));
    const hist = [...s.history, next];
    if (hist.length > 60) hist.shift();
    return { ...s, price: next, history: hist };
  });
}
setInterval(tickMarket, TICK_MS);

function pctChange(history) {
  if (history.length < 2) return 0;
  const first = history[0];
  const last = history[history.length - 1];
  return ((last - first) / first) * 100;
}

// ---------- portfolio persistence (simple JSON file "database") ----------
function defaultPortfolio() {
  return { cash: STARTING_CASH, holdings: {}, activity: [] };
}

function loadPortfolio() {
  try {
    const raw = fs.readFileSync(PORTFOLIO_FILE, "utf-8");
    return JSON.parse(raw);
  } catch (e) {
    const fresh = defaultPortfolio();
    savePortfolio(fresh);
    return fresh;
  }
}

function savePortfolio(portfolio) {
  fs.mkdirSync(path.dirname(PORTFOLIO_FILE), { recursive: true });
  fs.writeFileSync(PORTFOLIO_FILE, JSON.stringify(portfolio, null, 2));
}

function logActivity(portfolio, msg) {
  portfolio.activity.unshift({ msg, at: new Date().toISOString() });
  portfolio.activity = portfolio.activity.slice(0, 6);
}

function portfolioValue(portfolio) {
  return stocks.reduce((sum, s) => {
    const sh = portfolio.holdings[s.symbol] || 0;
    return sum + sh * s.price;
  }, portfolio.cash);
}

// ---------- API routes ----------

// All stocks with current price + rolling history + % change
app.get("/api/stocks", (req, res) => {
  const withChange = stocks.map((s) => ({ ...s, change: pctChange(s.history) }));
  res.json(withChange);
});

// Single stock by symbol
app.get("/api/stocks/:symbol", (req, res) => {
  const s = stocks.find((x) => x.symbol === req.params.symbol.toUpperCase());
  if (!s) return res.status(404).json({ error: "Symbol not found" });
  res.json({ ...s, change: pctChange(s.history) });
});

// Current portfolio state
app.get("/api/portfolio", (req, res) => {
  const portfolio = loadPortfolio();
  res.json({ ...portfolio, value: portfolioValue(portfolio) });
});

// Execute a buy or sell
app.post("/api/trade", (req, res) => {
  const { symbol, qty, side } = req.body;
  if (!symbol || !qty || !side || !["buy", "sell"].includes(side)) {
    return res.status(400).json({ error: "symbol, qty, and side ('buy'|'sell') are required" });
  }
  const quantity = parseInt(qty, 10);
  if (!Number.isInteger(quantity) || quantity <= 0) {
    return res.status(400).json({ error: "qty must be a positive integer" });
  }

  const stock = stocks.find((s) => s.symbol === symbol.toUpperCase());
  if (!stock) return res.status(404).json({ error: "Symbol not found" });

  const portfolio = loadPortfolio();

  if (side === "buy") {
    const cost = stock.price * quantity;
    if (cost > portfolio.cash) {
      return res.status(400).json({ error: "Insufficient cash for this trade" });
    }
    portfolio.cash = +(portfolio.cash - cost).toFixed(2);
    portfolio.holdings[stock.symbol] = (portfolio.holdings[stock.symbol] || 0) + quantity;
    logActivity(portfolio, `Bought ${quantity} ${stock.symbol} @ ₦${stock.price.toFixed(2)}`);
  } else {
    const owned = portfolio.holdings[stock.symbol] || 0;
    if (quantity > owned) {
      return res.status(400).json({ error: "Not enough shares to sell" });
    }
    portfolio.cash = +(portfolio.cash + stock.price * quantity).toFixed(2);
    portfolio.holdings[stock.symbol] = owned - quantity;
    if (portfolio.holdings[stock.symbol] === 0) delete portfolio.holdings[stock.symbol];
    logActivity(portfolio, `Sold ${quantity} ${stock.symbol} @ ₦${stock.price.toFixed(2)}`);
  }

  savePortfolio(portfolio);
  res.json({ ...portfolio, value: portfolioValue(portfolio) });
});

// Reset portfolio back to starting state
app.post("/api/portfolio/reset", (req, res) => {
  const fresh = defaultPortfolio();
  savePortfolio(fresh);
  res.json({ ...fresh, value: portfolioValue(fresh) });
});

app.listen(PORT, () => {
  console.log(`Kobo Terminal API running at http://localhost:${PORT}`);
});
