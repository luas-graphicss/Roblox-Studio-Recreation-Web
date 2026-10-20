import { bus } from "../core/eventBus.js";
import { logger } from "../core/logger.js";
import { settings } from "../config/settings.js";
import { readJSON, writeJSON } from "../utils/storage.js";
import { generateSecureUuid } from "../cloud/secureTokenGenerator.js";
import { project } from "../core/project.js";
import * as DS from "./dataServices.js";
import { RuntimeEvents } from "./engine.js";
import { openPurchasePrompt } from "../ui/purchasePrompt.js";
import { showGameNotification, clearGameNotifications } from "../ui/gameNotifications.js";

export const MonetizationEvents = Object.freeze({
  TransactionsChanged: "monetization:transactionsChanged",
  WalletChanged: "monetization:walletChanged",
  GamePassPromptFinished: "monetization:gamePassPromptFinished",
  ProductPromptFinished: "monetization:productPromptFinished",
  AssetPromptFinished: "monetization:assetPromptFinished",
});

export const OWNERSHIP_STORE = "_MarketplaceOwnership";
export const BADGE_STORE = "_BadgeOwnership";
export const WALLET_MAX = 999999;

const OWNERSHIP_SCOPE = "global";
const MAX_TRANSACTIONS = 500;
const RETRY_BASE_SEC = 5;
const RETRY_MAX_SEC = 60;
const MARKETPLACE_SRC = "MarketplaceService";
const BADGE_SRC = "BadgeService";

const wallets = new Map();
const passCache = new Map();
const badgeCache = new Map();
const activePrompts = new Set();
const openPrompts = new Set();
const pendingReceipts = new Map();
const grantedPurchases = new Set();
const transactions = [];
let receiptProcessor = null;
let txSeq = 1;
let running = false;
let wired = false;

function monetizationConfig() {
  try {
    return project.getSettings().monetization || {};
  } catch (_) {
    return {};
  }
}

export function getProducts() {
  const c = monetizationConfig();
  return Array.isArray(c.products) ? c.products : [];
}

export function getPasses() {
  const c = monetizationConfig();
  return Array.isArray(c.passes) ? c.passes : [];
}

export function getBadges() {
  const c = monetizationConfig();
  return Array.isArray(c.badges) ? c.badges : [];
}

export function findProduct(id) {
  return getProducts().find((p) => Number(p.id) === Number(id)) || null;
}

export function findPass(id) {
  return getPasses().find((p) => Number(p.id) === Number(id)) || null;
}

export function findBadge(id) {
  return getBadges().find((b) => Number(b.id) === Number(id)) || null;
}

export function getProductInfo(id, infoType) {
  const t = String(infoType || "Asset");
  let item = null;
  if (t === "Product") item = findProduct(id);
  else if (t === "GamePass") item = findPass(id);
  else item = findProduct(id) || findPass(id);
  if (!item) return null;
  const now = new Date().toISOString();
  return {
    Name: item.name,
    Description: item.description || "",
    PriceInRobux: Math.max(0, Math.round(Number(item.price) || 0)),
    IconImageAssetId: item.icon || "",
    Created: now,
    Updated: now,
  };
}

function clampBalance(v) {
  return Math.max(0, Math.min(WALLET_MAX, Math.round(Number(v) || 0)));
}

export function getDefaultBalance() {
  const v = Number(settings.get("robuxDefaultBalance"));
  return Number.isFinite(v) ? clampBalance(v) : 1000;
}

function walletStorageKey() {
  return "wallets:" + DS.getProjectId();
}

function persistWallets() {
  if (settings.get("persistRobuxBalance") !== true) return;
  const obj = {};
  for (const [k, v] of wallets) obj[k] = v;
  writeJSON(walletStorageKey(), obj);
}

function hydrateWallets() {
  wallets.clear();
  const stored = readJSON(walletStorageKey(), null);
  if (!stored || typeof stored !== "object") return;
  for (const [k, v] of Object.entries(stored)) {
    const id = Number(k);
    if (Number.isFinite(id)) wallets.set(id, clampBalance(v));
  }
}

export function getBalance(userId) {
  const id = Number(userId) || 0;
  if (!wallets.has(id)) wallets.set(id, getDefaultBalance());
  return wallets.get(id);
}

export function setBalance(userId, value) {
  const id = Number(userId) || 0;
  const v = clampBalance(value);
  wallets.set(id, v);
  persistWallets();
  bus.emit(MonetizationEvents.WalletChanged, { userId: id, balance: v });
  return v;
}

export function setAllBalances(value) {
  const v = clampBalance(value);
  for (const id of wallets.keys()) wallets.set(id, v);
  persistWallets();
  bus.emit(MonetizationEvents.WalletChanged, { userId: null, balance: v });
  return v;
}

function debit(userId, amount) {
  const id = Number(userId) || 0;
  const cost = clampBalance(amount);
  const bal = getBalance(id);
  if (bal < cost) return false;
  setBalance(id, bal - cost);
  return true;
}

function ownershipKey(userId) {
  return "u" + (Number(userId) || 0);
}

function loadOwnedSet(cacheMap, storeName, fieldName, userId) {
  const id = Number(userId) || 0;
  let promise = cacheMap.get(id);
  if (!promise) {
    promise = (async () => {
      const set = new Set();
      try {
        const rec = await DS.dsGet(storeName, OWNERSHIP_SCOPE, ownershipKey(id));
        if (rec && rec[fieldName] && typeof rec[fieldName] === "object") {
          for (const k of Object.keys(rec[fieldName])) {
            const n = Number(k);
            if (Number.isFinite(n)) set.add(n);
          }
        }
      } catch (_) {                                             }
      return set;
    })();
    cacheMap.set(id, promise);
  }
  return promise;
}

async function persistOwnedSet(storeName, fieldName, userId, set) {
  const obj = {};
  for (const v of set) obj[String(v)] = true;
  await DS.dsSet(storeName, OWNERSHIP_SCOPE, ownershipKey(userId), { [fieldName]: obj }, [Number(userId) || 0]);
}

export async function userOwnsPassAsync(userId, passId) {
  const set = await loadOwnedSet(passCache, OWNERSHIP_STORE, "passes", userId);
  return set.has(Number(passId));
}

export async function userHasBadgeAsync(userId, badgeId) {
  const set = await loadOwnedSet(badgeCache, BADGE_STORE, "badges", userId);
  return set.has(Number(badgeId));
}

async function grantPass(userId, passId) {
  const set = await loadOwnedSet(passCache, OWNERSHIP_STORE, "passes", userId);
  set.add(Number(passId));
  await persistOwnedSet(OWNERSHIP_STORE, "passes", userId, set);
}

export function getTransactions() {
  return transactions.slice();
}

export function clearTransactions() {
  transactions.length = 0;
  bus.emit(MonetizationEvents.TransactionsChanged, {});
}

function addTransaction(entry) {
  const tx = Object.assign({ id: txSeq++, time: Date.now() }, entry);
  transactions.push(tx);
  if (transactions.length > MAX_TRANSACTIONS) {
    transactions.splice(0, transactions.length - MAX_TRANSACTIONS);
  }
  bus.emit(MonetizationEvents.TransactionsChanged, {});
  return tx;
}

function setTransactionStatus(id, status) {
  const tx = transactions.find((t) => t.id === id);
  if (!tx) return;
  tx.status = status;
  bus.emit(MonetizationEvents.TransactionsChanged, {});
}

function userIdOf(player) {
  try {
    const v = Number(player.getProperty("UserId"));
    return Number.isFinite(v) ? v : 0;
  } catch (_) {
    return 0;
  }
}

function displayNameOf(player) {
  try {
    const dn = player.getProperty("DisplayName");
    if (dn) return String(dn);
  } catch (_) {                               }
  return player && player.name ? String(player.name) : "Player";
}

export function initialsOf(name) {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  const a = parts[0].charAt(0);
  const b = parts.length > 1 ? parts[parts.length - 1].charAt(0) : (parts[0].charAt(1) || "");
  return (a + b).toUpperCase();
}


function guid() {
  return generateSecureUuid();
}

function warnMarketplace(msg) {
  logger.warn("[MarketplaceService] " + msg, { source: MARKETPLACE_SRC });
}

function openPromptTracked(uiOpts, userId, onBuy, onCancel) {
  let settled = false;
  let handle = null;
  const done = (buy) => {
    if (settled) return;
    settled = true;
    activePrompts.delete(userId);
    if (handle) openPrompts.delete(handle);
    if (buy) onBuy();
    else onCancel();
  };
  handle = openPurchasePrompt(Object.assign({}, uiOpts, { onDecision: done }));
  openPrompts.add(handle);
  return handle;
}

export function promptGamePassPurchase(player, passId) {
  const userId = userIdOf(player);
  const id = Number(passId);
  const playerName = displayNameOf(player);
  const finish = (wasPurchased) => bus.emit(MonetizationEvents.GamePassPromptFinished, { player, id, wasPurchased });
  if (!running) {
    warnMarketplace("PromptGamePassPurchase ignorado: o Playtest n\u00e3o est\u00e1 rodando.");
    return;
  }
  const pass = findPass(id);
  if (!pass) {
    warnMarketplace(`PromptGamePassPurchase: Game Pass ${id} n\u00e3o existe neste jogo (configure em Game Settings > Monetization).`);
    finish(false);
    return;
  }
  if (activePrompts.has(userId)) {
    warnMarketplace(`PromptGamePassPurchase: ${playerName} j\u00e1 tem um prompt de compra ativo (m\u00e1x. 1 por jogador).`);
    return;
  }
  activePrompts.add(userId);
  userOwnsPassAsync(userId, id).then((owned) => {
    if (!running) {
      activePrompts.delete(userId);
      return;
    }
    openPromptTracked({
      kindLabel: "Game Pass",
      name: pass.name,
      description: pass.description || "",
      price: pass.price,
      balance: getBalance(userId),
      iconUrl: pass.icon || "",
      iconInitials: initialsOf(pass.name),
      alreadyOwned: owned === true,
    }, userId, () => {
      if (!debit(userId, pass.price)) {
        addTransaction({ userId, playerName, type: "GamePass", itemName: pass.name, amount: pass.price, status: "Failed" });
        warnMarketplace(`Compra do Game Pass "${pass.name}" bloqueada: saldo insuficiente de ${playerName}.`);
        finish(false);
        return;
      }
      grantPass(userId, id).then(() => {
        addTransaction({ userId, playerName, type: "GamePass", itemName: pass.name, amount: pass.price, status: "Success" });
        showGameNotification({
          iconUrl: pass.icon || "",
          iconText: initialsOf(pass.name),
          title: "Purchase Successful!",
          subtitle: pass.name,
        });
        logger.info(`[MarketplaceService] ${playerName} comprou o Game Pass "${pass.name}" (${pass.price} Robux).`, { source: MARKETPLACE_SRC });
        finish(true);
      });
    }, () => finish(false));
  });
}

export function promptProductPurchase(player, productId) {
  const userId = userIdOf(player);
  const id = Number(productId);
  const playerName = displayNameOf(player);
  const finish = (wasPurchased) => bus.emit(MonetizationEvents.ProductPromptFinished, { player, id, wasPurchased });
  if (!running) {
    warnMarketplace("PromptProductPurchase ignorado: o Playtest n\u00e3o est\u00e1 rodando.");
    return;
  }
  const product = findProduct(id);
  if (!product) {
    warnMarketplace(`PromptProductPurchase: Developer Product ${id} n\u00e3o existe neste jogo (configure em Game Settings > Monetization).`);
    finish(false);
    return;
  }
  if (activePrompts.has(userId)) {
    warnMarketplace(`PromptProductPurchase: ${playerName} j\u00e1 tem um prompt de compra ativo (m\u00e1x. 1 por jogador).`);
    return;
  }
  activePrompts.add(userId);
  openPromptTracked({
    kindLabel: "Developer Product",
    name: product.name,
    description: product.description || "",
    price: product.price,
    balance: getBalance(userId),
    iconUrl: product.icon || "",
    iconInitials: initialsOf(product.name),
    alreadyOwned: false,
  }, userId, () => {
    if (!receiptProcessor) {
      warnMarketplace("ProcessReceipt not implemented \u2014 defina MarketplaceService.ProcessReceipt em um Script do Server para conceder Developer Products. A compra falhou.");
      addTransaction({ userId, playerName, type: "Product", itemName: product.name, amount: product.price, status: "Failed" });
      showGameNotification({
        iconText: "!",
        title: "Purchase Failed",
        subtitle: product.name,
        kind: "error",
      });
      finish(false);
      return;
    }
    if (!debit(userId, product.price)) {
      addTransaction({ userId, playerName, type: "Product", itemName: product.name, amount: product.price, status: "Failed" });
      warnMarketplace(`Compra do produto "${product.name}" bloqueada: saldo insuficiente de ${playerName}.`);
      finish(false);
      return;
    }
    const receipt = {
      PurchaseId: guid(),
      PlayerId: userId,
      ProductId: id,
      CurrencySpent: Math.max(0, Math.round(Number(product.price) || 0)),
      CurrencyType: "Robux",
    };
    const tx = addTransaction({ userId, playerName, type: "Product", itemName: product.name, amount: product.price, status: "Pending" });
    finish(true);
    processReceipt(receipt, tx.id, product.name, 1);
  }, () => finish(false));
}

export function promptAssetPurchase(player, assetId) {
  const userId = userIdOf(player);
  const id = Number(assetId);
  const finish = (wasPurchased) => bus.emit(MonetizationEvents.AssetPromptFinished, { player, id, wasPurchased });
  if (!running) {
    warnMarketplace("PromptPurchase ignorado: o Playtest n\u00e3o est\u00e1 rodando.");
    return;
  }
  if (activePrompts.has(userId)) {
    warnMarketplace("PromptPurchase: o jogador j\u00e1 tem um prompt de compra ativo (m\u00e1x. 1 por jogador).");
    return;
  }
  activePrompts.add(userId);
  openPromptTracked({
    kindLabel: "Asset",
    name: "Asset " + id,
    description: "Compra simulada de asset (sempre bem-sucedida).",
    price: 0,
    balance: getBalance(userId),
    iconUrl: "",
    iconInitials: "A",
    alreadyOwned: false,
  }, userId, () => {
    showGameNotification({ iconText: "A", title: "Purchase Successful!", subtitle: "Asset " + id });
    finish(true);
  }, () => finish(false));
}

function scheduleReceiptRetry(entry) {
  if (!running) {
    pendingReceipts.delete(entry.receipt.PurchaseId);
    return;
  }
  const delaySec = Math.min(RETRY_MAX_SEC, RETRY_BASE_SEC * Math.pow(2, entry.attempt - 1));
  entry.timer = setTimeout(() => {
    entry.timer = 0;
    pendingReceipts.delete(entry.receipt.PurchaseId);
    processReceipt(entry.receipt, entry.txId, entry.itemName, entry.attempt + 1);
  }, delaySec * 1000);
}

function processReceipt(receipt, txId, itemName, attempt) {
  if (!running) return;
  if (grantedPurchases.has(receipt.PurchaseId)) return;
  const entry = { receipt, txId, itemName, attempt, timer: 0 };
  pendingReceipts.set(receipt.PurchaseId, entry);
  const proc = receiptProcessor;
  if (!proc) {
    scheduleReceiptRetry(entry);
    return;
  }
  Promise.resolve()
    .then(() => proc(Object.assign({}, receipt)))
    .then((decision) => {
      if (!pendingReceipts.has(receipt.PurchaseId)) return;
      if (decision === "PurchaseGranted") {
        pendingReceipts.delete(receipt.PurchaseId);
        if (grantedPurchases.has(receipt.PurchaseId)) return;
        grantedPurchases.add(receipt.PurchaseId);
        setTransactionStatus(txId, "Success");
        logger.info(`[MarketplaceService] Receipt ${receipt.PurchaseId} conclu\u00eddo (PurchaseGranted) \u2014 "${itemName}".`, { source: MARKETPLACE_SRC });
      } else {
        warnMarketplace(`ProcessReceipt retornou ${decision || "NotProcessedYet"} para "${itemName}"; nova tentativa autom\u00e1tica em breve (PurchaseId ${receipt.PurchaseId}).`);
        scheduleReceiptRetry(entry);
      }
    })
    .catch(() => {
      if (pendingReceipts.has(receipt.PurchaseId)) scheduleReceiptRetry(entry);
    });
}

export function setReceiptProcessor(fn) {
  receiptProcessor = typeof fn === "function" ? fn : null;
}

export function hasReceiptProcessor() {
  return receiptProcessor !== null;
}

export async function awardBadgeAsync(userId, badgeId, playerName) {
  const id = Number(badgeId);
  const badge = findBadge(id);
  if (!badge) {
    logger.warn(`[BadgeService] AwardBadge: badge ${id} n\u00e3o existe neste jogo (configure em Game Settings > Monetization).`, { source: BADGE_SRC });
    return false;
  }
  if (badge.enabled === false) {
    logger.warn(`[BadgeService] AwardBadge: o badge "${badge.name}" est\u00e1 desabilitado (Enabled = false).`, { source: BADGE_SRC });
    return false;
  }
  const set = await loadOwnedSet(badgeCache, BADGE_STORE, "badges", userId);
  if (set.has(id)) return false;
  set.add(id);
  await persistOwnedSet(BADGE_STORE, "badges", userId, set);
  addTransaction({
    userId: Number(userId) || 0,
    playerName: playerName || "User " + userId,
    type: "Badge",
    itemName: badge.name,
    amount: 0,
    status: "Success",
  });
  showGameNotification({
    iconUrl: badge.icon || "",
    iconText: initialsOf(badge.name),
    title: "Badge Earned: " + badge.name,
    subtitle: badge.description || "",
  });
  logger.info(`[BadgeService] Badge "${badge.name}" concedido ao userId ${Number(userId) || 0}.`, { source: BADGE_SRC });
  return true;
}

function onPlayStart() {
  transactions.length = 0;
  txSeq = 1;
  grantedPurchases.clear();
  passCache.clear();
  badgeCache.clear();
  activePrompts.clear();
  if (settings.get("persistRobuxBalance") === true) hydrateWallets();
  else wallets.clear();
  bus.emit(MonetizationEvents.TransactionsChanged, {});
}

function onPlayStop() {
  for (const entry of pendingReceipts.values()) {
    if (entry.timer) clearTimeout(entry.timer);
  }
  pendingReceipts.clear();
  for (const handle of openPrompts) {
    try { handle.close(true); } catch (_) {                              }
  }
  openPrompts.clear();
  activePrompts.clear();
  receiptProcessor = null;
  clearGameNotifications();
}

export function isPlaytestRunning() {
  return running;
}

export function initMonetization() {
  if (wired) return;
  wired = true;
  bus.on(RuntimeEvents.ModeChanged, (p) => {
    const nowRunning = !!(p && p.running);
    if (nowRunning === running) return;
    running = nowRunning;
    if (running) onPlayStart();
    else onPlayStop();
  });
  logger.info("Monetiza\u00e7\u00e3o simulada inicializada (Parte 59).", { source: "Studio" });
}
