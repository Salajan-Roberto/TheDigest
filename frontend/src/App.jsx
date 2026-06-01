import { useState, useEffect, useCallback, useRef } from "react";
import { BrowserProvider, Contract, parseUnits, formatUnits } from "ethers";
import { FAUCET_ADDRESS, DIGEST_ADDRESS } from "./addresses.js";

// ─── ABIs ────────────────────────────────────────────────────────────────────

const FAUCET_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function approve(address spender, uint256 amount) external returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function burnFrom(address account, uint256 amount) external",
  "function symbol() view returns (string)",
  "function claim() external",
  "function timeUntilNextClaim(address user) external view returns (uint256)",
  "function claimAmount() view returns (uint256)",
];

const DIGEST_ABI = [
  "function getAllArticles() view returns (tuple(uint256 id,string title,string url,string description,uint256 burnCost,uint256 publishedAt,uint256 readCount,bool active)[])",
  "function markAsRead(uint256 articleId) external",
  "function getReadHistory(address) view returns (uint256[])",
  "function totalTokensBurned() view returns (uint256)",
  "function totalBurnedBy(address) view returns (uint256)",
  "function publish(string,string,string,uint256) external returns (uint256)",
  "function owner() view returns (address)",
  "function deactivate(uint256 id) external",
  "event ArticleRead(uint256 indexed articleId, address indexed reader, uint256 burnCost, uint256 timestamp)",
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

const fmt       = (wei) => (Number(BigInt(wei)) / 1e18).toLocaleString(undefined, { maximumFractionDigits: 1 });
const fmtInt    = (wei) => Math.round(Number(BigInt(wei)) / 1e18).toLocaleString();
const shortAddr = (a)   => `${a.slice(0, 6)}…${a.slice(-4)}`;
const fmtDate   = (ts)  => new Date(Number(ts) * 1000).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
const fmtTime   = (ts)  => new Date(Number(ts) * 1000).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });

function fmtCountdown(secs) {
  if (secs <= 0) return null;
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function parseContractError(e) {
  if (e?.reason) return e.reason;
  const msg = e?.message ?? "";
  if (msg.includes("user rejected")) return "Transaction cancelled.";
  if (msg.includes("insufficient funds")) return "Not enough ETH for gas.";
  if (msg.includes("cooldown active")) return "Faucet cooldown active — try again later.";
  if (msg.includes("depleted")) return "Faucet is empty. Contact the publisher.";
  if (msg.includes("Already marked")) return "You've already read this article.";
  if (msg.includes("ERC20: insufficient allowance") || msg.includes("allowance")) return "Allowance too low — please try again.";
  if (msg.includes("ERC20: burn amount exceeds balance") || msg.includes("burn amount")) return "Not enough DEV tokens. Claim from the faucet first.";
  const revert = msg.match(/reverted with reason string '(.+?)'/);
  if (revert) return revert[1];
  return msg.slice(0, 100) || "Something went wrong.";
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const css = `
@import url('https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,500;0,700;1,400;1,500&family=Source+Serif+4:ital,opsz,wght@0,8..60,300;0,8..60,400;1,8..60,300;1,8..60,400&family=JetBrains+Mono:wght@400;500&display=swap');
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{
  --ink:#1a1a18;--ink2:#4a4a44;--ink3:#888880;
  --rule:rgba(26,26,24,0.1);--rule2:rgba(26,26,24,0.06);
  --paper:#faf9f5;--paper2:#f3f1ea;
  --accent:#2a3f2a;--accent2:#4a7c4a;
  --burnt:#8b3a1a;--burnt2:#c4622e;
  --serif:'Playfair Display',Georgia,serif;
  --body:'Source Serif 4',Georgia,serif;
  --mono:'JetBrains Mono',monospace;
  --radius:2px;
}
@media(prefers-color-scheme:dark){:root{
  --ink:#e8e4d8;--ink2:#a8a499;--ink3:#706c62;
  --rule:rgba(232,228,216,0.1);--rule2:rgba(232,228,216,0.05);
  --paper:#1a1914;--paper2:#222118;
  --accent:#7ab87a;--accent2:#5a9a5a;
  --burnt:#e07040;--burnt2:#c05020;
}}

/* ── Base ── */
body{font-family:var(--body);background:var(--paper);color:var(--ink);min-height:100vh}
.app{max-width:760px;margin:0 auto;padding:0 1.5rem 6rem}

/* ── Masthead ── */
.masthead{border-bottom:2px solid var(--ink);padding:2rem 0 1.25rem;margin-bottom:2rem}
.masthead-eyebrow{font-family:var(--mono);font-size:10px;letter-spacing:0.2em;text-transform:uppercase;color:var(--ink3);margin-bottom:0.75rem}
.masthead-title{font-family:var(--serif);font-size:clamp(2rem,6vw,3.6rem);font-weight:700;line-height:1;letter-spacing:-0.02em;color:var(--ink)}
.masthead-title em{font-style:italic;color:var(--accent)}
.masthead-rule{height:1px;background:var(--rule);margin:1.25rem 0 0.75rem}
.masthead-meta{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:0.5rem}
.masthead-date{font-family:var(--mono);font-size:10px;color:var(--ink3);letter-spacing:0.1em;text-transform:uppercase}
.masthead-wallet{display:flex;align-items:center;gap:8px;flex-wrap:wrap}

/* ── Nav ── */
.nav{display:flex;gap:0;border-bottom:1px solid var(--rule);margin-bottom:2rem;overflow-x:auto;-webkit-overflow-scrolling:touch;scrollbar-width:none}
.nav::-webkit-scrollbar{display:none}
.nav-tab{font-family:var(--mono);font-size:11px;font-weight:500;letter-spacing:0.08em;text-transform:uppercase;color:var(--ink3);background:none;border:none;border-bottom:2px solid transparent;padding:0.6rem 1rem 0.6rem 0;margin-bottom:-1px;cursor:pointer;transition:color .15s,border-color .15s;white-space:nowrap;flex-shrink:0}
.nav-tab.active{color:var(--ink);border-bottom-color:var(--ink)}
.nav-tab:hover:not(.active){color:var(--ink2)}

/* ── Wallet controls ── */
.wallet-pill{font-family:var(--mono);font-size:11px;color:var(--ink2);background:var(--paper2);border:1px solid var(--rule);border-radius:100px;padding:4px 12px}
.wallet-pill.connected{color:var(--accent);border-color:var(--accent2);background:transparent}
.connect-btn{font-family:var(--mono);font-size:11px;font-weight:500;letter-spacing:0.08em;text-transform:uppercase;color:var(--ink);background:none;border:1px solid var(--ink);border-radius:var(--radius);padding:5px 14px;cursor:pointer;transition:background .12s,color .12s}
.connect-btn:hover{background:var(--ink);color:var(--paper)}
.connect-btn:disabled{opacity:.4;cursor:not-allowed}

/* ── Claim button ── */
.claim-btn{font-family:var(--mono);font-size:11px;font-weight:500;letter-spacing:0.06em;text-transform:uppercase;color:var(--accent);background:transparent;border:1px solid var(--accent2);border-radius:100px;padding:4px 12px;cursor:pointer;transition:background .12s,color .12s;white-space:nowrap}
.claim-btn:hover:not(:disabled){background:var(--accent2);color:var(--paper)}
.claim-btn:disabled{opacity:.45;cursor:not-allowed}
.claim-btn.cooldown{color:var(--ink3);border-color:var(--rule)}

/* ── Stats bar ── */
.stats-bar{display:grid;grid-template-columns:repeat(3,1fr);border:1px solid var(--rule);border-radius:var(--radius);margin-bottom:2.5rem}
.stat-cell{padding:1rem 1.25rem;border-right:1px solid var(--rule)}
.stat-cell:last-child{border-right:none}
.stat-label{font-family:var(--mono);font-size:9px;font-weight:500;letter-spacing:0.15em;text-transform:uppercase;color:var(--ink3);margin-bottom:4px}
.stat-number{font-family:var(--serif);font-size:1.6rem;font-weight:700;color:var(--ink);line-height:1}
.stat-unit{font-family:var(--mono);font-size:10px;color:var(--ink3);margin-top:2px}

/* ── Skeleton loader ── */
@keyframes shimmer{0%{background-position:200% 0}100%{background-position:-200% 0}}
.skeleton{border-radius:var(--radius);background:linear-gradient(90deg,var(--paper2) 25%,var(--rule) 50%,var(--paper2) 75%);background-size:200% 100%;animation:shimmer 1.4s infinite}
.skel-row{padding:1.75rem 0;border-bottom:1px solid var(--rule2);display:flex;flex-direction:column;gap:10px}
.skel-line{height:12px}
.skel-title{height:18px;width:65%}
.skel-desc{height:12px;width:80%}
.skel-meta{height:10px;width:40%}

/* ── Articles ── */
.issue-label{font-family:var(--mono);font-size:9px;font-weight:500;letter-spacing:0.2em;text-transform:uppercase;color:var(--ink3);border-bottom:1px solid var(--rule);padding-bottom:0.5rem;margin-bottom:1.5rem}
.article-row{display:grid;grid-template-columns:1fr auto;gap:1rem;align-items:start;padding:1.75rem 0;border-bottom:1px solid var(--rule2);transition:background .12s}
.article-row:hover{background:var(--paper2);margin:0 -1rem;padding:1.75rem 1rem;border-radius:var(--radius)}
.article-row.read .article-title{color:var(--ink3)}
.article-kicker{font-family:var(--mono);font-size:9px;letter-spacing:0.15em;text-transform:uppercase;color:var(--ink3);margin-bottom:0.4rem}
.article-title{font-family:var(--serif);font-size:1.25rem;font-weight:500;line-height:1.3;color:var(--ink);margin-bottom:0.5rem}
.article-desc{font-family:var(--body);font-size:.9rem;color:var(--ink2);line-height:1.6;margin-bottom:0.75rem;font-style:italic}
.article-footer{display:flex;align-items:center;gap:1rem;flex-wrap:wrap}
.article-meta{font-family:var(--mono);font-size:10px;color:var(--ink3)}
.burn-badge{font-family:var(--mono);font-size:10px;color:var(--burnt2);border:1px solid var(--rule);border-radius:100px;padding:2px 10px}
.read-badge{font-family:var(--mono);font-size:10px;color:var(--accent2);border:1px solid var(--accent2);border-radius:100px;padding:2px 10px}
.ext-link{font-family:var(--mono);font-size:10px;color:var(--ink3);text-decoration:none}
.ext-link:hover{color:var(--ink2)}
.article-action{display:flex;flex-direction:column;align-items:flex-end;gap:6px;padding-top:4px;min-width:90px}
.read-count{font-family:var(--mono);font-size:10px;color:var(--ink3);text-align:right}
.burn-btn{font-family:var(--mono);font-size:11px;font-weight:500;letter-spacing:0.06em;text-transform:uppercase;color:var(--paper);background:var(--burnt);border:none;border-radius:var(--radius);padding:8px 14px;cursor:pointer;transition:background .12s,opacity .12s;white-space:nowrap}
.burn-btn:hover:not(:disabled){background:var(--burnt2)}
.burn-btn:disabled{opacity:.35;cursor:not-allowed}
.burn-btn.verified{background:var(--accent)}

/* ── History ── */
.history-section{display:flex;flex-direction:column}
.history-row{display:flex;align-items:center;justify-content:space-between;padding:1.1rem 0;border-bottom:1px solid var(--rule2);gap:1rem}
.history-title{font-family:var(--serif);font-size:1rem;font-weight:500;color:var(--ink)}
.history-meta{font-family:var(--mono);font-size:10px;color:var(--ink3)}

/* ── Leaderboard ── */
.lb-row{display:grid;grid-template-columns:2rem 1fr auto;gap:12px;align-items:center;padding:1rem 0;border-bottom:1px solid var(--rule2)}
.lb-rank{font-family:var(--serif);font-size:1.25rem;font-weight:700;color:var(--ink3);text-align:center}
.lb-rank.top{color:var(--accent)}
.lb-addr{font-family:var(--mono);font-size:12px;color:var(--ink2)}
.lb-addr.me{color:var(--accent)}
.lb-stat{text-align:right}
.lb-amount{font-family:var(--serif);font-size:1.1rem;font-weight:500;color:var(--ink)}
.lb-reads{font-family:var(--mono);font-size:10px;color:var(--ink3)}

/* ── Activity feed ── */
.feed-row{display:flex;align-items:flex-start;gap:12px;padding:1rem 0;border-bottom:1px solid var(--rule2)}
.feed-dot{width:8px;height:8px;border-radius:50%;background:var(--accent2);flex-shrink:0;margin-top:5px}
.feed-body{flex:1;min-width:0}
.feed-title{font-family:var(--serif);font-size:.95rem;font-weight:500;color:var(--ink);margin-bottom:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.feed-meta{font-family:var(--mono);font-size:10px;color:var(--ink3)}
.feed-amount{font-family:var(--mono);font-size:11px;color:var(--burnt2);white-space:nowrap}
.feed-loading{font-family:var(--body);font-style:italic;color:var(--ink3);padding:2rem 0;text-align:center;font-size:.9rem}

/* ── Publish ── */
.admin-section{display:flex;flex-direction:column;gap:1.5rem}
.field-group{display:flex;flex-direction:column;gap:6px}
.field-label{font-family:var(--mono);font-size:10px;letter-spacing:0.1em;text-transform:uppercase;color:var(--ink3)}
.field-input{font-family:var(--body);font-size:14px;color:var(--ink);background:var(--paper2);border:1px solid var(--rule);border-radius:var(--radius);padding:.6rem .8rem;outline:none;width:100%;transition:border-color .15s}
.field-input:focus{border-color:var(--ink3)}
.field-input::placeholder{color:var(--ink3);font-style:italic}
.field-row{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.submit-btn{font-family:var(--mono);font-size:11px;font-weight:500;letter-spacing:0.08em;text-transform:uppercase;color:var(--paper);background:var(--ink);border:none;border-radius:var(--radius);padding:.75rem 1.5rem;cursor:pointer;transition:opacity .12s;align-self:flex-start}
.submit-btn:disabled{opacity:.35;cursor:not-allowed}
.owner-notice{font-family:var(--body);font-style:italic;color:var(--ink3);padding:2rem 0;text-align:center}

/* ── Misc ── */
.network-warn{font-family:var(--mono);font-size:11px;color:var(--burnt2);border:1px solid var(--rule);border-radius:var(--radius);padding:.5rem 1rem;margin-bottom:1rem;text-align:center}
.empty-state{font-family:var(--body);font-style:italic;color:var(--ink3);padding:3rem 0;text-align:center}
.progress-bar-wrap{height:3px;background:var(--rule);border-radius:2px;margin-bottom:2rem;overflow:hidden}
.progress-bar{height:100%;background:var(--accent2);border-radius:2px;transition:width .4s ease}
.progress-label{font-family:var(--mono);font-size:9px;letter-spacing:0.15em;text-transform:uppercase;color:var(--ink3);margin-top:6px;margin-bottom:2rem}

/* ── Toast ── */
.toast-wrap{position:fixed;bottom:2rem;right:2rem;display:flex;flex-direction:column;gap:8px;z-index:100;pointer-events:none}
.toast{font-family:var(--mono);font-size:12px;color:var(--ink);background:var(--paper);border:1px solid var(--rule);border-radius:var(--radius);padding:.65rem 1rem;animation:toastIn .2s ease;max-width:320px;line-height:1.4}
.toast.success{border-color:var(--accent2);color:var(--accent)}
.toast.error{border-color:var(--burnt2);color:var(--burnt)}
.toast a{color:inherit;text-decoration:underline}
.faucet-warn{font-family:var(--mono);font-size:10px;color:var(--burnt2);text-align:center;margin-top:4px}
@keyframes toastIn{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}

/* ── Mobile ── */
@media(max-width:600px){
  .app{padding:0 1rem 5rem}
  .stats-bar{grid-template-columns:1fr;border:none;gap:0}
  .stat-cell{border-right:none;border-bottom:1px solid var(--rule);padding:.75rem 0}
  .stat-cell:last-child{border-bottom:none}
  .field-row{grid-template-columns:1fr}
  .article-row{grid-template-columns:1fr}
  .article-action{flex-direction:row;align-items:center;justify-content:space-between;min-width:unset;padding-top:0.5rem}
  .masthead-wallet{gap:6px}
  .wallet-pill{font-size:10px;padding:3px 10px}
  .lb-row{grid-template-columns:1.5rem 1fr auto}
  .toast-wrap{left:1rem;right:1rem;bottom:1rem}
  .toast{max-width:100%}
}
`;

// ─── Component ───────────────────────────────────────────────────────────────

export default function App() {
  const [account, setAccount]       = useState(null);
  const [isOwner, setIsOwner]       = useState(false);
  const [wrongNet, setWrongNet]     = useState(false);
  const [tab, setTab]               = useState("digest");
  const [loading, setLoading]       = useState(false);
  const [dataLoading, setDataLoading] = useState(false);
  const [toasts, setToasts]         = useState([]);
  const [articles, setArticles]     = useState([]);
  const [readSet, setReadSet]       = useState(new Set());
  const [readHistory, setReadHist]  = useState([]);
  const [balance, setBalance]       = useState("0");
  const [symbol, setSymbol]         = useState("DEV");
  const [totalBurned, setTotBurn]   = useState("0");
  const [myBurned, setMyBurned]     = useState("0");
  const [actionId, setActionId]     = useState(null);
  const [deactivating, setDeactivating] = useState(null);
  const [form, setForm]             = useState({ title: "", url: "", description: "", burnCost: "" });

  // Faucet claim state
  const [claimCooldown, setClaimCooldown] = useState(0); // seconds remaining
  const [claiming, setClaiming]           = useState(false);
  const [claimAmount, setClaimAmt]        = useState("100");
  const [faucetBalance, setFaucetBal]     = useState(null);
  const countdownRef                      = useRef(null);

  // Leaderboard + feed
  const [leaderboard, setLeaderboard] = useState([]);
  const [feed, setFeed]               = useState([]);
  const [eventsLoading, setEventsLoading] = useState(false);

  // ── Toast helpers ──────────────────────────────────────────────────────────
  const addToast = useCallback((msg, type = "info") => {
    const id = Date.now();
    setToasts(t => [...t, { id, msg, type }]);
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 4500);
  }, []);

  // ── Provider helpers ───────────────────────────────────────────────────────
  const getProvider = () => new BrowserProvider(window.ethereum);
  const getFaucet   = (sp) => new Contract(FAUCET_ADDRESS, FAUCET_ABI, sp);
  const getDigest   = (sp) => new Contract(DIGEST_ADDRESS, DIGEST_ABI, sp);

  // ── Countdown ticker ───────────────────────────────────────────────────────
  const startCountdown = useCallback((secs) => {
    clearInterval(countdownRef.current);
    setClaimCooldown(secs);
    if (secs <= 0) return;
    countdownRef.current = setInterval(() => {
      setClaimCooldown(prev => {
        if (prev <= 1) { clearInterval(countdownRef.current); return 0; }
        return prev - 1;
      });
    }, 1000);
  }, []);

  // ── Main data refresh ──────────────────────────────────────────────────────
  const refresh = useCallback(async (addr) => {
    if (!addr) return;
    setDataLoading(true);
    try {
      const p = getProvider();
      const [bal, sym, arts, history, totBurned, myBurn, owner, cooldown, clAmt, faucetBal] = await Promise.all([
        getFaucet(p).balanceOf(addr),
        getFaucet(p).symbol(),
        getDigest(p).getAllArticles(),
        getDigest(p).getReadHistory(addr),
        getDigest(p).totalTokensBurned(),
        getDigest(p).totalBurnedBy(addr),
        getDigest(p).owner(),
        getFaucet(p).timeUntilNextClaim(addr),
        getFaucet(p).claimAmount(),
        getFaucet(p).balanceOf(FAUCET_ADDRESS),
      ]);
      setBalance(fmt(bal));
      setSymbol(sym);
      setArticles([...arts].filter(a => a.active).reverse());
      setReadSet(new Set(history.map(Number)));
      setReadHist(history.map(Number));
      setTotBurn(fmtInt(totBurned));
      setMyBurned(fmt(myBurn));
      setIsOwner(owner.toLowerCase() === addr.toLowerCase());
      startCountdown(Number(cooldown));
      setClaimAmt(fmt(clAmt));
      setFaucetBal(fmt(faucetBal));
    } catch (e) {
      console.error("refresh error:", e);
    } finally {
      setDataLoading(false);
    }
  }, [startCountdown]);

  // ── Deactivate article ─────────────────────────────────────────────────────
  const deactivateArticle = async (id) => {
    if (!window.confirm("Deactivate this article? It will be hidden from all readers.")) return;
    try {
      setDeactivating(id);
      const signer = await getProvider().getSigner();
      const tx = await getDigest(signer).deactivate(id);
      addToast("Deactivating…");
      await tx.wait();
      addToast("Article deactivated", "success");
      await refresh(account);
    } catch (e) {
      addToast(parseContractError(e), "error");
    } finally {
      setDeactivating(null);
    }
  };

  // ── Load on-chain events for leaderboard + feed ────────────────────────────
  const loadEvents = useCallback(async () => {
    setEventsLoading(true);
    try {
      const p = getProvider();
      const digest = getDigest(p);
      const latest = await p.getBlockNumber();

      // Scan in 5,000-block chunks from genesis to handle RPC range limits.
      // Sepolia contract deployed ~early 2024 so we start from a reasonable block.
      const CHUNK = 5000;
      const START = Math.max(0, latest - 200000); // ~last ~month of Sepolia blocks
      let allEvents = [];
      for (let from = START; from <= latest; from += CHUNK) {
        const to = Math.min(from + CHUNK - 1, latest);
        try {
          const chunk = await digest.queryFilter("ArticleRead", from, to);
          allEvents = allEvents.concat(chunk);
        } catch {
          // RPC rejected this chunk — skip it silently
        }
      }

      // Build article map
      const arts = await digest.getAllArticles();
      const artMap = {};
      arts.forEach(a => { artMap[Number(a.id)] = a; });

      // Feed — newest first, cap at 50
      const feedItems = [...allEvents].reverse().slice(0, 50).map(e => ({
        articleId: Number(e.args.articleId),
        reader:    e.args.reader,
        burnCost:  e.args.burnCost,
        timestamp: Number(e.args.timestamp),
        title:     artMap[Number(e.args.articleId)]?.title ?? `Article #${Number(e.args.articleId)}`,
      }));
      setFeed(feedItems);

      // Leaderboard — aggregate burned per address
      const burned = {};
      const reads  = {};
      allEvents.forEach(e => {
        const addr = e.args.reader.toLowerCase();
        burned[addr] = (burned[addr] ?? 0n) + e.args.burnCost;
        reads[addr]  = (reads[addr]  ?? 0) + 1;
      });
      const lb = Object.entries(burned)
        .map(([addr, total]) => ({ addr, total, reads: reads[addr] }))
        .sort((a, b) => (b.total > a.total ? 1 : -1))
        .slice(0, 20);
      setLeaderboard(lb);
    } catch (e) {
      console.error("event load error:", e);
    } finally {
      setEventsLoading(false);
    }
  }, []);

  // ── Connect wallet ─────────────────────────────────────────────────────────
  const connectWallet = async () => {
    if (!window.ethereum) { addToast("MetaMask not found — please install it.", "error"); return; }
    try {
      setLoading(true);
      const p = getProvider();
      const net = await p.getNetwork();
      if (Number(net.chainId) !== 11155111) {
        setWrongNet(true);
        await window.ethereum.request({
          method: "wallet_switchEthereumChain",
          params: [{ chainId: "0xaa36a7" }],
        });
        setWrongNet(false);
      }
      const [addr] = await p.send("eth_requestAccounts", []);
      setAccount(addr);
      await refresh(addr);
    } catch (e) {
      addToast(parseContractError(e), "error");
    } finally {
      setLoading(false);
    }
  };

  // ── Claim DEV ──────────────────────────────────────────────────────────────
  const claimTokens = async () => {
    if (!account) { addToast("Connect your wallet first.", "error"); return; }
    try {
      setClaiming(true);
      const signer = await getProvider().getSigner();
      const tx = await getFaucet(signer).claim();
      addToast("Claiming DEV tokens…");
      await tx.wait();
      addToast(`${claimAmount} ${symbol} claimed!`, "success");
      await refresh(account);
    } catch (e) {
      addToast(parseContractError(e), "error");
    } finally {
      setClaiming(false);
    }
  };

  // ── Mark as read ───────────────────────────────────────────────────────────
  const markAsRead = async (article) => {
    if (!account) { addToast("Connect your wallet first.", "error"); return; }
    try {
      setActionId(Number(article.id));
      const p = getProvider();
      const signer = await p.getSigner();
      const cost = article.burnCost;
      const allowance = await getFaucet(p).allowance(account, DIGEST_ADDRESS);
      if (allowance < cost) {
        addToast("Approving token spend…");
        const tx = await getFaucet(signer).approve(DIGEST_ADDRESS, cost * 10n);
        await tx.wait();
        addToast("Approved — confirming read…");
      }
      const tx = await getDigest(signer).markAsRead(Number(article.id));
      addToast("Transaction sent — waiting for confirmation…");
      const receipt = await tx.wait();
      addToast(`Verified — ${fmt(cost)} ${symbol} burned`, "success");
      addToast(`↗ View on Etherscan · sepolia.etherscan.io/tx/${receipt.hash}`, "success");
      await refresh(account);
    } catch (e) {
      addToast(parseContractError(e), "error");
    } finally {
      setActionId(null); }
  };

  // ── Publish article ────────────────────────────────────────────────────────
  const publishArticle = async () => {
    try {
      setLoading(true);
      const signer = await getProvider().getSigner();
      const cost = parseUnits(form.burnCost, 18);
      const tx = await getDigest(signer).publish(form.title, form.url, form.description, cost);
      addToast("Publishing to chain…");
      const receipt = await tx.wait();
      addToast(`"${form.title}" published`, "success");
      addToast(`↗ View on Etherscan · sepolia.etherscan.io/tx/${receipt.hash}`, "success");
      setForm({ title: "", url: "", description: "", burnCost: "" });
      await refresh(account);
    } catch (e) {
      addToast(parseContractError(e), "error");
    } finally {
      setLoading(false);
    }
  };

  // ── Load events when switching to leaderboard/feed tabs ───────────────────
  useEffect(() => {
    if ((tab === "leaderboard" || tab === "feed") && feed.length === 0 && !eventsLoading) {
      loadEvents();
    }
  }, [tab]);

  // ── Account change listener ────────────────────────────────────────────────
  useEffect(() => {
    if (!window.ethereum) return;
    const handler = (accounts) => {
      if (accounts.length === 0) { setAccount(null); return; }
      setAccount(accounts[0]);
      refresh(accounts[0]);
    };
    window.ethereum.on("accountsChanged", handler);
    return () => window.ethereum.removeListener("accountsChanged", handler);
  }, [refresh]);

  useEffect(() => () => clearInterval(countdownRef.current), []);

  const today = new Date().toLocaleDateString("en-US", {
    weekday: "long", year: "numeric", month: "long", day: "numeric",
  });

  const readProgress = articles.length > 0 ? (readSet.size / articles.length) * 100 : 0;

  // ─── Render ────────────────────────────────────────────────────────────────
  return (
    <>
      <style>{css}</style>
      <div className="app">

        {/* ── Masthead ── */}
        <header className="masthead">
          <div className="masthead-eyebrow">Est. Sepolia Testnet · Proof of reading</div>
          <h1 className="masthead-title">The <em>Digest</em></h1>
          <div className="masthead-rule" />
          <div className="masthead-meta">
            <span className="masthead-date">{today}</span>
            <div className="masthead-wallet">
              {account ? (
                <>
                  {claimCooldown > 0 ? (
                    <button className="claim-btn cooldown" disabled>
                      Claim in {fmtCountdown(claimCooldown)}
                    </button>
                  ) : (
                    <button className="claim-btn" onClick={claimTokens} disabled={claiming}>
                      {claiming ? "Claiming…" : `Claim ${claimAmount} ${symbol}`}
                    </button>
                  )}
                  {faucetBalance !== null && Number(faucetBalance.replace(/,/g, "")) < 100 && (
                    <span className="faucet-warn">Faucet low: {faucetBalance} {symbol}</span>
                  )}
                  <span className="wallet-pill connected">{balance} {symbol}</span>
                  <span className="wallet-pill connected">{shortAddr(account)}</span>
                </>
              ) : (
                <button className="connect-btn" onClick={connectWallet} disabled={loading}>
                  {loading ? "Connecting…" : "Connect wallet"}
                </button>
              )}
            </div>
          </div>
        </header>

        {wrongNet && (
          <div className="network-warn">⚠ Switch MetaMask to Sepolia testnet</div>
        )}

        {/* ── Nav ── */}
        <nav className="nav">
          {[
            ["digest",      "Issues"],
            ["history",     "My reads"],
            ["leaderboard", "Leaderboard"],
            ["feed",        "Activity"],
            ["admin",       "Publish"],
          ].map(([id, label]) => (
            <button
              key={id}
              className={`nav-tab${tab === id ? " active" : ""}`}
              onClick={() => { setTab(id); if (account) refresh(account); }}
            >
              {label}
            </button>
          ))}
        </nav>

        {/* ══ Issues tab ══ */}
        {tab === "digest" && (
          <>
            <div className="stats-bar">
              <div className="stat-cell">
                <div className="stat-label">Articles</div>
                <div className="stat-number">{articles.length}</div>
                <div className="stat-unit">published</div>
              </div>
              <div className="stat-cell">
                <div className="stat-label">Total burned</div>
                <div className="stat-number">{totalBurned}</div>
                <div className="stat-unit">{symbol} tokens</div>
              </div>
              <div className="stat-cell">
                <div className="stat-label">Your reads</div>
                <div className="stat-number">{readSet.size}</div>
                <div className="stat-unit">{myBurned} {symbol} burned</div>
              </div>
            </div>

            {/* Reading progress bar */}
            {account && articles.length > 0 && (
              <>
                <div className="progress-bar-wrap">
                  <div className="progress-bar" style={{ width: `${readProgress}%` }} />
                </div>
                <div className="progress-label">
                  {readSet.size} of {articles.length} articles read
                </div>
              </>
            )}

            <div className="issue-label">Latest issues</div>

            {!account ? (
              <p className="empty-state">Connect your wallet to read the digest.</p>
            ) : dataLoading ? (
              [1, 2, 3].map(i => (
                <div key={i} className="skel-row">
                  <div className="skeleton skel-meta" />
                  <div className="skeleton skel-title" />
                  <div className="skeleton skel-desc" />
                  <div className="skeleton skel-meta" style={{ width: "30%" }} />
                </div>
              ))
            ) : articles.length === 0 ? (
              <p className="empty-state">No articles published yet.</p>
            ) : articles.map((art) => {
              const id      = Number(art.id);
              const isRead  = readSet.has(id);
              const isAct   = actionId === id;
              const cost    = fmt(art.burnCost);
              return (
                <div key={id} className={`article-row${isRead ? " read" : ""}`}>
                  <div>
                    <div className="article-kicker">{fmtDate(art.publishedAt)}</div>
                    <h2 className="article-title">{art.title}</h2>
                    {art.description && (
                      <p className="article-desc">{art.description}</p>
                    )}
                    <div className="article-footer">
                      <span className="article-meta">{Number(art.readCount)} readers</span>
                      {isRead
                        ? <span className="read-badge">Read · {cost} {symbol} burned</span>
                        : <span className="burn-badge">Burns {cost} {symbol}</span>
                      }
                      {art.url && (
                        <a href={art.url} target="_blank" rel="noreferrer"
                          className="ext-link" onClick={e => e.stopPropagation()}>
                          Read article ↗
                        </a>
                      )}
                    </div>
                  </div>
                  <div className="article-action">
                    <div className="read-count">{Number(art.readCount)} reads</div>
                    {isRead ? (
                      <button className="burn-btn verified" disabled>Verified ✓</button>
                    ) : (
                      <button
                        className="burn-btn"
                        disabled={isAct || !account}
                        onClick={() => markAsRead(art)}
                      >
                        {isAct ? "Burning…" : `Burn ${cost}`}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </>
        )}

        {/* ══ My Reads tab ══ */}
        {tab === "history" && (
          <>
            <div className="issue-label">Your reading record</div>
            {!account ? (
              <p className="empty-state">Connect your wallet to see your reading history.</p>
            ) : readHistory.length === 0 ? (
              <p className="empty-state">You haven't verified any reads yet.</p>
            ) : (
              <div className="history-section">
                {readHistory.map((id) => {
                  const art = articles.find(a => Number(a.id) === id);
                  if (!art) return null;
                  return (
                    <div key={id} className="history-row">
                      <div>
                        <div className="history-title">{art.title}</div>
                        <div className="history-meta">
                          {fmtDate(art.publishedAt)} · {fmt(art.burnCost)} {symbol} burned
                        </div>
                      </div>
                      <span className="read-badge">On-chain ✓</span>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}

        {/* ══ Leaderboard tab ══ */}
        {tab === "leaderboard" && (
          <>
            <div className="issue-label">Top readers by DEV burned</div>
            {eventsLoading ? (
              [1,2,3,4,5].map(i => (
                <div key={i} className="skel-row" style={{ flexDirection: "row", alignItems: "center", gap: "12px" }}>
                  <div className="skeleton" style={{ width: 28, height: 28, borderRadius: "50%" }} />
                  <div className="skeleton skel-meta" style={{ flex: 1 }} />
                  <div className="skeleton skel-meta" style={{ width: 60 }} />
                </div>
              ))
            ) : leaderboard.length === 0 ? (
              <p className="empty-state">No reads recorded yet — be the first!</p>
            ) : leaderboard.map((entry, i) => {
              const isMe = account && entry.addr === account.toLowerCase();
              return (
                <div key={entry.addr} className="lb-row">
                  <div className={`lb-rank${i < 3 ? " top" : ""}`}>{i + 1}</div>
                  <div>
                    <div className={`lb-addr${isMe ? " me" : ""}`}>
                      {isMe ? `${shortAddr(entry.addr)} (you)` : shortAddr(entry.addr)}
                    </div>
                    <div className="lb-reads">{entry.reads} article{entry.reads !== 1 ? "s" : ""} read</div>
                  </div>
                  <div className="lb-stat">
                    <div className="lb-amount">{fmt(entry.total)}</div>
                    <div className="lb-reads">{symbol} burned</div>
                  </div>
                </div>
              );
            })}
          </>
        )}

        {/* ══ Activity feed tab ══ */}
        {tab === "feed" && (
          <>
            <div className="issue-label">Recent on-chain reads</div>
            {eventsLoading ? (
              <p className="feed-loading">Scanning the chain for recent activity…</p>
            ) : feed.length === 0 ? (
              <p className="empty-state">No activity in the last 10,000 blocks.</p>
            ) : feed.map((ev, i) => (
              <div key={i} className="feed-row">
                <div className="feed-dot" />
                <div className="feed-body">
                  <div className="feed-title">{ev.title}</div>
                  <div className="feed-meta">
                    {shortAddr(ev.reader)} · {fmtDate(ev.timestamp)} at {fmtTime(ev.timestamp)}
                  </div>
                </div>
                <div className="feed-amount">−{fmt(ev.burnCost)} {symbol}</div>
              </div>
            ))}
          </>
        )}

        {/* ══ Publish tab ══ */}
        {tab === "admin" && (
          <>
            <div className="issue-label">Publish a new issue</div>
            {!account ? (
              <p className="owner-notice">Connect your wallet first.</p>
            ) : !isOwner ? (
              <p className="owner-notice">Only the contract owner can publish articles.</p>
            ) : (
              <div className="admin-section">
                <div className="field-group">
                  <label className="field-label">Article title</label>
                  <input className="field-input"
                    placeholder="The thing I've been thinking about…"
                    value={form.title}
                    onChange={e => setForm(f => ({ ...f, title: e.target.value }))} />
                </div>
                <div className="field-group">
                  <label className="field-label">Description</label>
                  <input className="field-input"
                    placeholder="A short teaser — one sentence."
                    value={form.description}
                    onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
                </div>
                <div className="field-row">
                  <div className="field-group">
                    <label className="field-label">Link or IPFS hash</label>
                    <input className="field-input"
                      placeholder="https://…"
                      value={form.url}
                      onChange={e => setForm(f => ({ ...f, url: e.target.value }))} />
                  </div>
                  <div className="field-group">
                    <label className="field-label">Burn cost ({symbol})</label>
                    <input className="field-input" type="number" placeholder="e.g. 10"
                      value={form.burnCost}
                      onChange={e => setForm(f => ({ ...f, burnCost: e.target.value }))} />
                  </div>
                </div>
                <button
                  className="submit-btn"
                  disabled={loading || !form.title || !form.burnCost}
                  onClick={publishArticle}
                >
                  {loading ? "Publishing…" : "Publish to chain →"}
                </button>

                {articles.length > 0 && (
                  <>
                    <div className="issue-label" style={{ marginTop: "2rem" }}>Published articles</div>
                    {articles.map(art => {
                      const id = Number(art.id);
                      return (
                        <div key={id} className="history-row">
                          <div>
                            <div className="history-title">{art.title}</div>
                            <div className="history-meta">
                              {fmtDate(art.publishedAt)} · {fmt(art.burnCost)} {symbol} · {Number(art.readCount)} reads
                            </div>
                          </div>
                          <button
                            className="burn-btn"
                            style={{ fontSize: "10px", padding: "5px 10px", background: "transparent", color: "var(--ink3)", border: "1px solid var(--rule)" }}
                            disabled={deactivating === id}
                            onClick={() => deactivateArticle(id)}
                          >
                            {deactivating === id ? "Removing…" : "Deactivate"}
                          </button>
                        </div>
                      );
                    })}
                  </>
                )}
              </div>
            )}
          </>
        )}
      </div>

      {/* ── Toasts ── */}
      <div className="toast-wrap">
        {toasts.map(t => {
          const etherscan = t.msg.match(/sepolia\.etherscan\.io\/tx\/(0x[a-fA-F0-9]+)/);
          return (
            <div key={t.id} className={`toast ${t.type}`}>
              {etherscan ? (
                <a href={`https://sepolia.etherscan.io/tx/${etherscan[1]}`}
                  target="_blank" rel="noreferrer">
                  View transaction on Etherscan ↗
                </a>
              ) : t.msg}
            </div>
          );
        })}
      </div>
    </>
  );
}