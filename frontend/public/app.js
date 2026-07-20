const API_BASE = "https://kobo-terminal.onrender.com";
const POLL_MS = 2500;

let stocks = [];
let portfolio = { cash: 0, holdings: {}, activity: [], value: 0 };
let selected = "MTNN";
let qty = 1;
let chart = null;

function fmt(n) {
  return "₦" + n.toLocaleString("en-NG", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// ---------- API calls ----------
async function fetchStocks() {
  const res = await fetch(`${API_BASE}/api/stocks`);
  stocks = await res.json();
}

async function fetchPortfolio() {
  const res = await fetch(`${API_BASE}/api/portfolio`);
  portfolio = await res.json();
}

async function trade(side) {
  const errEl = document.getElementById("errorMsg");
  errEl.textContent = "";
  try {
    const res = await fetch(`${API_BASE}/api/trade`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ symbol: selected, qty, side }),
    });
    const data = await res.json();
    if (!res.ok) {
      errEl.textContent = data.error || "Trade failed";
      return;
    }
    portfolio = data;
    await fetchStocks();
    renderAll();
  } catch (e) {
    errEl.textContent = "Could not reach the backend at " + API_BASE;
  }
}

async function resetPortfolio() {
  const res = await fetch(`${API_BASE}/api/portfolio/reset`, { method: "POST" });
  portfolio = await res.json();
  renderAll();
}

// ---------- rendering ----------
function renderTicker() {
  const track = document.getElementById("tickerTrack");
  const items = [...stocks, ...stocks].map(s => {
    const up = s.change >= 0;
    return `<div class="tick-item">
      <span class="sym">${s.symbol}</span>
      <span>${fmt(s.price)}</span>
      <span class="${up ? 'up' : 'down'}">${up ? '▲' : '▼'} ${Math.abs(s.change).toFixed(2)}%</span>
    </div>`;
  }).join("");
  track.innerHTML = items;
}

function renderWatchlist() {
  const el = document.getElementById("watchlist");
  el.innerHTML = stocks.map(s => {
    const up = s.change >= 0;
    const active = s.symbol === selected ? "active" : "";
    return `<button class="stock-row ${active}" data-symbol="${s.symbol}">
      <div class="row-top">
        <span class="sym mono">${s.symbol}</span>
        <span class="chg mono ${up ? 'up' : 'down'}">${up ? '+' : ''}${s.change.toFixed(2)}%</span>
      </div>
      <div class="name">${s.name}</div>
      <div class="price mono">${fmt(s.price)}</div>
    </button>`;
  }).join("");
  el.querySelectorAll(".stock-row").forEach(btn => {
    btn.addEventListener("click", () => {
      selected = btn.dataset.symbol;
      renderAll();
    });
  });
}

function renderChartPanel() {
  const s = stocks.find(x => x.symbol === selected);
  if (!s) return;
  const up = s.change >= 0;

  document.getElementById("stockSymbol").textContent = s.symbol;
  document.getElementById("stockName").textContent = s.name;
  document.getElementById("stockPrice").textContent = fmt(s.price);
  const deltaEl = document.getElementById("stockDelta");
  deltaEl.textContent = (up ? "▲ " : "▼ ") + Math.abs(s.change).toFixed(2) + "%";
  deltaEl.className = "delta mono " + (up ? "up" : "down");

  const ctx = document.getElementById("priceChart").getContext("2d");
  const lineColor = up ? "#34d399" : "#fb7185";
  const data = {
    labels: s.history.map((_, i) => i),
    datasets: [{
      data: s.history,
      borderColor: lineColor,
      backgroundColor: "transparent",
      borderWidth: 2,
      pointRadius: 0,
      tension: 0.3,
    }],
  };
  const options = {
    responsive: true,
    maintainAspectRatio: false,
    animation: false,
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: "#0f172a",
        borderColor: "#1e293b",
        borderWidth: 1,
        titleFont: { family: "IBM Plex Mono" },
        bodyFont: { family: "IBM Plex Mono" },
        callbacks: {
          title: () => "",
          label: (ctx) => fmt(ctx.parsed.y),
        }
      }
    },
    scales: {
      x: { display: false },
      y: {
        ticks: {
          color: "#64748b",
          font: { family: "IBM Plex Mono", size: 11 },
          callback: (v) => "₦" + Number(v).toLocaleString("en-NG"),
        },
        grid: { color: "#1e293b" },
      }
    }
  };

  if (chart) {
    chart.data = data;
    chart.options = options;
    chart.update();
  } else {
    chart = new Chart(ctx, { type: "line", data, options });
  }

  const owned = portfolio.holdings[s.symbol] || 0;
  document.getElementById("ownedQty").textContent = owned;
  document.getElementById("cashDisplay").textContent = fmt(portfolio.cash);
  document.getElementById("estCost").textContent = "Est. cost: " + fmt(s.price * qty);
  document.getElementById("buyBtn").disabled = s.price * qty > portfolio.cash;
  document.getElementById("sellBtn").disabled = qty > owned;
}

function renderWallet() {
  document.getElementById("portfolioValue").textContent = fmt(portfolio.value);
}

function renderHoldings() {
  const el = document.getElementById("holdingsList");
  const entries = Object.entries(portfolio.holdings).filter(([, sh]) => sh > 0);
  if (entries.length === 0) {
    el.innerHTML = '<p class="empty">No positions yet. Buy a stock to start building your paper portfolio.</p>';
    return;
  }
  el.innerHTML = entries.map(([sym, sh]) => {
    const s = stocks.find(x => x.symbol === sym);
    if (!s) return "";
    return `<div class="holding-row">
      <div>
        <div class="sym mono">${sym}</div>
        <div class="shares">${sh} shares</div>
      </div>
      <div class="mono">${fmt(sh * s.price)}</div>
    </div>`;
  }).join("");
}

function renderActivity() {
  const el = document.getElementById("activityList");
  if (!portfolio.activity || portfolio.activity.length === 0) {
    el.innerHTML = '<p class="empty">No trades yet.</p>';
    return;
  }
  el.innerHTML = portfolio.activity.map(a => `<div class="activity-item mono">${a.msg}</div>`).join("");
}

function renderAll() {
  renderTicker();
  renderWatchlist();
  renderChartPanel();
  renderWallet();
  renderHoldings();
  renderActivity();
}

// ---------- events ----------
document.getElementById("qtyMinus").addEventListener("click", () => {
  qty = Math.max(1, qty - 1);
  document.getElementById("qtyInput").value = qty;
  renderChartPanel();
});
document.getElementById("qtyPlus").addEventListener("click", () => {
  qty = qty + 1;
  document.getElementById("qtyInput").value = qty;
  renderChartPanel();
});
document.getElementById("qtyInput").addEventListener("input", (e) => {
  qty = Math.max(1, parseInt(e.target.value) || 1);
  renderChartPanel();
});
document.getElementById("buyBtn").addEventListener("click", () => trade("buy"));
document.getElementById("sellBtn").addEventListener("click", () => trade("sell"));
document.getElementById("resetBtn").addEventListener("click", resetPortfolio);

// ---------- init + polling loop ----------
async function refresh() {
  await Promise.all([fetchStocks(), fetchPortfolio()]);
  renderAll();
}

refresh();
setInterval(refresh, POLL_MS);
