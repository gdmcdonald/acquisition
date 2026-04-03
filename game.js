/**
 * game.js — All game logic and UI components.
 *
 * All text, names, sectors, events, and tuning data lives in gameContent.js.
 * This file should contain no hardcoded strings beyond UI labels.
 *
 * v4 changes:
 *  - Deal grid is now slot-based: MAX_DEALS fixed positions, expired deals leave
 *    an empty placeholder in place rather than shifting the whole grid
 *  - Ticker tape now scrolls the activity log alongside financial metrics
 *  - DealCard thesis tags now use THESIS_TAG_RULES (no duplicated thresholds)
 *  - Retire screen: shows the full human cost summary and ends with "You won."
 *
 * v3 changes (still present):
 *  - Runs via Babel CDN — no build step, open index.html directly in a browser
 *  - Content separated into gameContent.js
 *  - Ticker tape animation bug fixed (keyframes moved to index.html <head>)
 *  - Offline progress: saves timestamp, fast-forwards income/decay on return
 *  - hydrateState deep-merges nested objects so new fields survive schema changes
 *  - Graveyard: bankrupt companies tracked and shown in the dashboard
 *  - Employees: headcount tracked through every restructuring action
 *  - Family mechanic surfaced via threshold-crossing log events
 *  - Lobbying log messages show the specific policy mechanism
 *  - Merger log names the redundancies as "synergies"
 */

const { useEffect, useMemo, useRef, useState } = React;

const {
  COMPANY_PREFIX, SECTOR_LIST,
  RARITY_CONFIG, SIZE_CONFIG, EMPLOYEE_BASE,
  THESIS_TAG_RULES, EVENT_DECK,
  FAILURE_HEADLINES,
} = window.CONTENT;

// Derive the four legacy lookup structures from the unified SECTOR_LIST.
// All downstream code continues to use these names unchanged.
const SECTORS             = SECTOR_LIST.map(s => s.id);
const SECTOR_EMOJI        = Object.fromEntries(SECTOR_LIST.map(s => [s.id, s.emoji]));
const COMPANY_SUFFIX      = Object.fromEntries(SECTOR_LIST.map(s => [s.id, s.suffixes]));
const LOBBYING_MECHANISMS = Object.fromEntries(SECTOR_LIST.map(s => [s.id, s.lobbyMechanisms]));

// ── Constants ────────────────────────────────────────────────────────────────
const TICK_MS       = 200;
const DEAL_LIFETIME = 22;
const MAX_DEALS     = 8;   // fixed grid slots — always exactly this many positions
const STORAGE_KEY   = "acquisition-lol-v4";  // bumped: deals schema changed to fixed-slot array

// ── Pure helpers ─────────────────────────────────────────────────────────────
function clamp(v, min, max)  { return Math.max(min, Math.min(max, v)); }
function rand(min, max)       { return min + Math.random() * (max - min); }
function choice(arr)          { return arr[Math.floor(Math.random() * arr.length)]; }
function uid()                { return Math.random().toString(36).slice(2, 10); }

function weightedPick(items) {
  const total = items.reduce((sum, item) => sum + item.weight, 0);
  let roll = Math.random() * total;
  for (const item of items) {
    roll -= item.weight;
    if (roll <= 0) return item;
  }
  return items[items.length - 1];
}

function formatMoney(m) {
  if (m >= 1_000_000) return `$${(m / 1_000_000).toFixed(2)}T`;
  if (m >= 1_000)     return `$${(m / 1_000).toFixed(1)}B`;
  return `$${m.toFixed(1)}M`;
}

// Compact version — no decimal places, for tight mobile tiles
function formatMoneyInt(m) {
  if (m >= 1_000_000) return `$${Math.round(m / 1_000_000)}T`;
  if (m >= 1_000)     return `$${Math.round(m / 1_000)}B`;
  return `$${Math.round(m)}M`;
}

function makeName(sector) {
  return `${choice(COMPANY_PREFIX)} ${choice(COMPANY_SUFFIX[sector])}`;
}

// ── Game mechanics helpers ────────────────────────────────────────────────────
function baseDebtCeiling(state) {
  return 90
    + state.aum * 0.22
    + (state.unlocked.debtDesk ? 120 : 0)
    + state.reputation * 1.4;
}

function addLog(state, text, kind = "info") {
  return {
    ...state,
    log: [{ id: uid(), text, kind }, ...state.log].slice(0, 16),
  };
}

// ── Deal factory ──────────────────────────────────────────────────────────────
function createDeal(aum, modifiers) {
  const rarityKey = weightedPick(
    Object.entries(RARITY_CONFIG).map(([key, cfg]) => ({ key, ...cfg }))
  );
  const sector = choice(SECTORS);
  const size = aum > 700
    ? weightedPick([{ value: "Small", weight: 15 }, { value: "Mid", weight: 45 }, { value: "Large", weight: 40 }]).value
    : aum > 220
      ? weightedPick([{ value: "Small", weight: 28 }, { value: "Mid", weight: 52 }, { value: "Large", weight: 20 }]).value
      : weightedPick([{ value: "Small", weight: 58 }, { value: "Mid", weight: 35 }, { value: "Large", weight: 7 }]).value;

  const cfg           = SIZE_CONFIG[size];
  const empRange      = EMPLOYEE_BASE[size];
  const fragility     = rand(0.15, 0.9);
  const assetStrip    = rand(0.2, 0.95);
  const brand         = rand(0.2, 0.95);
  const debtTolerance = clamp(cfg.debtCap + rand(-0.08, 0.08), 0.35, 0.88);
  const basePrice     = cfg.priceBase * rand(0.82, 1.22) * rarityKey.multiplier * (1 + aum / 2500);
  const price         = basePrice * (modifiers.dealPriceMult ?? 1);
  const sectorBoost   = (modifiers.sectorProfitBoosts || {})[sector] || 0;
  const income        = cfg.incomeBase * rand(0.85, 1.2) * rarityKey.multiplier * (1 + sectorBoost);
  const employees     = Math.round(rand(empRange[0], empRange[1]));

  return {
    id: uid(),
    name: makeName(sector),
    sector,
    size,
    rarity:       rarityKey.key,
    rarityLabel:  rarityKey.label,
    logo:         SECTOR_EMOJI[sector] || "🏢",
    price,
    income,
    fragility,
    assetStrip,
    brand,
    debtTolerance,
    employees,
    expiry: DEAL_LIFETIME,
  };
}

// ── State factories ───────────────────────────────────────────────────────────
function createInitialState() {
  // deals is a FIXED-LENGTH array of MAX_DEALS slots.
  // null = empty slot waiting for a deal.
  // This keeps card positions stable — expired deals leave a gap, not a shuffle.
  const deals = Array(MAX_DEALS).fill(null);
  const state = {
    cash:          40,
    aum:           120,
    reputation:    52,
    stress:        18,
    family:        76,
    debtCapacity:  90,
    deals,
    portfolio:     [],
    graveyard:     [],
    log: [{ id: uid(), kind: "info", text: "Fund I raised. Time to start rolling up the world." }],
    modifiers: {
      incomeMult:         1,
      dealPriceMult:      1,
      timerCheapCredit:   0,
      timerIncomeShock:   0,
      sectorProfitBoosts: {},
    },
    lobbying:       {},
    time:           0,
    eventCooldown:  18,
    totalExtracted: 0,
    lifetimeDeals:  0,
    unlocked: {
      debtDesk: false,
      megaFund: false,
      cloDesk:  false,
    },
  };
  // Pre-fill 6 of the 8 slots
  for (let i = 0; i < 6; i++) {
    state.deals[i] = createDeal(state.aum, state.modifiers);
  }
  return state;
}

/**
 * Fast-forward state for offline progress.
 * No events, no new deals — avoids log spam on return.
 */
function fastTickState(state, elapsedSec) {
  let next = { ...state, time: state.time + elapsedSec };

  const incomeMult      = next.modifiers.incomeMult ?? 1;
  const feeIncome       = next.aum * 0.00022;
  const portfolioIncome = next.portfolio.reduce(
    (sum, c) => sum + c.income * (c.health / 100) * incomeMult, 0
  ) * 0.09;
  next.cash = clamp(next.cash + (feeIncome + portfolioIncome) * elapsedSec, 0, 9_999_999);

  const maxDebt = baseDebtCeiling(next);
  next.debtCapacity = clamp(
    next.debtCapacity + (2.8 + next.reputation * 0.04 + next.portfolio.length * 0.12) * elapsedSec,
    0, maxDebt
  );

  next.portfolio = next.portfolio.map(c => ({
    ...c,
    health:    clamp(c.health - (0.015 + c.debt / Math.max(40, c.price) * 0.006) * elapsedSec, 0, 100),
    morale:    clamp(c.morale - 0.01 * elapsedSec, 0, 100),
    timeOwned: c.timeOwned + elapsedSec,
  }));

  const stressDrift = next.portfolio.length > 0 ? 0.025 * next.portfolio.length : -0.02;
  next.stress  = clamp(next.stress + stressDrift * elapsedSec, 0, 100);

  if (next.stress > 65)      next.family     = clamp(next.family - 0.07 * elapsedSec, 0, 100);
  else if (next.stress < 25) next.family     = clamp(next.family + 0.03 * elapsedSec, 0, 100);
  if (next.family < 30)      next.reputation = clamp(next.reputation - 0.015 * elapsedSec, 0, 100);

  return next;
}

/**
 * Hydrate from localStorage.
 * Deep-merges nested objects, normalises the deals array to fixed length,
 * and fast-forwards offline progress.
 */
function hydrateState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return createInitialState();
    const parsed  = JSON.parse(raw);
    const initial = createInitialState();

    const hydrated = {
      ...initial,
      ...parsed,
      modifiers: { ...initial.modifiers, ...(parsed.modifiers || {}) },
      unlocked:  { ...initial.unlocked,  ...(parsed.unlocked  || {}) },
      lobbying:  { ...(parsed.lobbying   || {}) },
      graveyard: parsed.graveyard || [],
    };

    // Normalise deals to fixed MAX_DEALS slots (handles saves from older schema)
    let rawDeals = Array.isArray(parsed.deals) ? parsed.deals : [];
    if (rawDeals.length !== MAX_DEALS) {
      rawDeals = [...rawDeals, ...Array(MAX_DEALS).fill(null)].slice(0, MAX_DEALS);
    }
    hydrated.deals = rawDeals;

    // Offline progress — cap at 6 minutes
    const savedAt    = parsed.savedAt || Date.now();
    const elapsedSec = Math.min((Date.now() - savedAt) / 1000, 360);

    if (elapsedSec > 5) {
      const progressed = fastTickState(hydrated, elapsedSec);
      const mins = Math.round(elapsedSec / 60);
      return addLog(
        progressed,
        `Welcome back. ${mins < 1 ? "Less than a minute" : `${mins} minute${mins !== 1 ? "s" : ""}`} passed. Income accumulated while you were away.`,
        "info"
      );
    }
    return hydrated;
  } catch {
    return createInitialState();
  }
}

// ── Game actions ──────────────────────────────────────────────────────────────

function buyDeal(state, dealId) {
  const deal = state.deals.find(d => d && d.id === dealId);
  if (!deal) return state;

  const preferredDebt  = deal.price * deal.debtTolerance;
  const maxDebtUsable  = Math.min(state.debtCapacity, preferredDebt);
  const equityNeeded   = deal.price - maxDebtUsable;
  const actualLeverage = deal.price > 0 ? maxDebtUsable / deal.price : 0;
  const sectorBoost    = (state.modifiers.sectorProfitBoosts || {})[deal.sector] || 0;

  if (state.cash < equityNeeded) {
    return addLog(state, `Missed ${deal.name}: need ${formatMoney(equityNeeded)} cash to close.`, "bad");
  }

  const initialHealth  = clamp(80 - deal.fragility * 35, 18, 95);
  const initialMorale  = clamp(72 - deal.fragility * 28, 15, 92);
  const initialRisk    = clamp(deal.fragility * 35 + (actualLeverage - 0.5) * 40, 4, 82);
  const initialIncome  = deal.income * (1 + sectorBoost);
  const stripValue     = deal.price * deal.assetStrip * 0.35;

  const thesisTags = THESIS_TAG_RULES.map(rule =>
    deal[rule.stat] > rule.threshold ? rule.high : rule.low
  );

  const company = {
    id:                   deal.id,
    name:                 deal.name,
    logo:                 deal.logo,
    sector:               deal.sector,
    size:                 deal.size,
    rarity:               deal.rarity,
    price:                deal.price,
    originalPrice:        deal.price,
    debt:                 maxDebtUsable,
    originalDebt:         maxDebtUsable,
    income:               initialIncome,
    originalIncome:       initialIncome,
    health:               initialHealth,
    originalHealth:       initialHealth,
    morale:               initialMorale,
    originalMorale:       initialMorale,
    brand:                Math.round(deal.brand * 100),
    stripValue,
    originalStripValue:   stripValue,
    collapseRisk:         initialRisk,
    originalCollapseRisk: initialRisk,
    debtTolerance:        deal.debtTolerance,
    originalLeverage:     actualLeverage,
    employees:            deal.employees,
    originalEmployees:    deal.employees,
    thesisTags,
    timeOwned: 0,
    status: "active",
  };

  let next = {
    ...state,
    cash:          state.cash - equityNeeded,
    debtCapacity:  clamp(state.debtCapacity - maxDebtUsable, 0, baseDebtCeiling(state)),
    aum:           state.aum + deal.price,
    lifetimeDeals: state.lifetimeDeals + 1,
    // Null the slot in-place — keeps other cards stationary
    deals:         state.deals.map(d => d && d.id === dealId ? null : d),
    portfolio:     [company, ...state.portfolio],
    stress:        clamp(state.stress + 4, 0, 100),
  };

  return addLog(
    next,
    `Acquired ${deal.name} (${deal.employees.toLocaleString()} employees) for ${formatMoney(deal.price)} using ${Math.round(actualLeverage * 100)}% leverage.`,
    "good"
  );
}

function applyCompanyAction(state, companyId, action) {
  const idx      = state.portfolio.findIndex(c => c.id === companyId);
  if (idx === -1) return state;
  const company  = state.portfolio[idx];
  const portfolio = [...state.portfolio];
  let next = { ...state };

  if (action === "stabilise") {
    const cost = Math.max(2, company.price * 0.03);
    if (state.cash < cost) return addLog(state, `Not enough cash to stabilise ${company.name}.`, "bad");
    portfolio[idx] = {
      ...company,
      health:       clamp(company.health + 14, 0, 100),
      morale:       clamp(company.morale + 10, 0, 100),
      collapseRisk: clamp(company.collapseRisk - 8, 0, 100),
      income:       company.income * 0.98,
    };
    next = { ...state, cash: state.cash - cost, reputation: clamp(state.reputation + 2, 0, 100), stress: clamp(state.stress - 2, 0, 100), portfolio };
    return addLog(next, `Operators sent into ${company.name}. Cash flow softened, collapse risk reduced.`, "info");
  }

  if (action === "cut") {
    const cut = Math.round(company.employees * 0.22);
    portfolio[idx] = {
      ...company,
      income:       company.income * 1.18,
      health:       clamp(company.health - 10, 0, 100),
      morale:       clamp(company.morale - 18, 0, 100),
      collapseRisk: clamp(company.collapseRisk + 9, 0, 100),
      employees:    Math.round(company.employees * 0.78),
    };
    next = { ...state, reputation: clamp(state.reputation - 3, 0, 100), family: clamp(state.family - 1, 0, 100), stress: clamp(state.stress + 3, 0, 100), portfolio };
    return addLog(next, `${company.name}: ${cut.toLocaleString()} jobs cut. Margins up, morale gutted.`, "warn");
  }

  if (action === "load") {
    const extraDebt = company.price * 0.12;
    const dividend  = company.price * 0.08;
    portfolio[idx] = {
      ...company,
      debt:         company.debt + extraDebt,
      health:       clamp(company.health - 8, 0, 100),
      collapseRisk: clamp(company.collapseRisk + 11, 0, 100),
      income:       company.income * 1.06,
    };
    next = { ...state, cash: state.cash + dividend, totalExtracted: state.totalExtracted + dividend, stress: clamp(state.stress + 4, 0, 100), portfolio };
    return addLog(next, `${company.name}: dividend recap paid out ${formatMoney(dividend)}. Future somebody else's problem.`, "good");
  }

  if (action === "strip") {
    const payout = Math.max(4, company.stripValue * 0.45);
    portfolio[idx] = {
      ...company,
      stripValue:   company.stripValue * 0.48,
      health:       clamp(company.health - 15, 0, 100),
      morale:       clamp(company.morale - 8, 0, 100),
      collapseRisk: clamp(company.collapseRisk + 14, 0, 100),
      employees:    Math.round((company.employees || 0) * 0.93),
    };
    next = { ...state, cash: state.cash + payout, totalExtracted: state.totalExtracted + payout, reputation: clamp(state.reputation - 4, 0, 100), portfolio };
    return addLog(next, `${company.name}: sold the furniture, leased back the floorboards.`, "warn");
  }

  if (action === "exit") {
    const exitValue = company.health > 45
      ? company.price * rand(0.9, 1.45)
      : company.price * rand(0.35, 0.95);
    next = {
      ...state,
      cash:         state.cash + exitValue * 0.3,
      aum:          clamp(state.aum - company.price * 0.75 + exitValue * 0.5, 0, 999_999),
      debtCapacity: clamp(state.debtCapacity + company.debt * 0.85, 0, baseDebtCeiling(state)),
      stress:       clamp(state.stress - 3, 0, 100),
      portfolio:    state.portfolio.filter(c => c.id !== companyId),
    };
    return addLog(
      next,
      `Exited ${company.name}. Marked at ${formatMoney(exitValue)}. ${(company.employees || 0).toLocaleString()} employees transferred to new owners.`,
      company.health > 45 ? "good" : "warn"
    );
  }

  return state;
}

function mergeCompanies(state, sector) {
  const matches = state.portfolio.filter(c => c.sector === sector);
  if (matches.length < 2) return addLog(state, `Need at least two ${sector} companies to merge.`, "bad");

  const sorted         = [...matches].sort((a, b) => b.price - a.price);
  const [a, b]         = sorted;
  const synergyBonus   = (a.price + b.price) * 0.08;
  const sectorBoost    = (state.modifiers.sectorProfitBoosts || {})[sector] || 0;
  const mergedIncome   = (a.income + b.income) * 1.2 * (1 + sectorBoost);
  const totalEmployees = (a.employees || 0) + (b.employees || 0);
  const redundancies   = Math.round(totalEmployees * 0.12);

  const merged = {
    id:                   uid(),
    name:                 `${a.name.split(" ")[0]}-${b.name.split(" ")[0]} ${sector} Group`,
    logo:                 SECTOR_EMOJI[sector] || "🏢",
    sector,
    size:                 a.size === "Large" || b.size === "Large" ? "Large" : "Mid",
    rarity:               a.rarity,
    price:                a.price + b.price + synergyBonus,
    originalPrice:        a.price + b.price + synergyBonus,
    debt:                 a.debt + b.debt,
    originalDebt:         a.debt + b.debt,
    income:               mergedIncome,
    originalIncome:       mergedIncome,
    health:               clamp((a.health + b.health) / 2 + 8, 0, 100),
    originalHealth:       clamp((a.health + b.health) / 2 + 8, 0, 100),
    morale:               clamp((a.morale + b.morale) / 2 - 4, 0, 100),
    originalMorale:       clamp((a.morale + b.morale) / 2 - 4, 0, 100),
    brand:                Math.round((a.brand + b.brand) / 2),
    stripValue:           a.stripValue + b.stripValue,
    originalStripValue:   a.stripValue + b.stripValue,
    collapseRisk:         clamp((a.collapseRisk + b.collapseRisk) / 2 - 10, 0, 100),
    originalCollapseRisk: clamp((a.collapseRisk + b.collapseRisk) / 2 - 10, 0, 100),
    debtTolerance:        Math.max(a.debtTolerance || 0, b.debtTolerance || 0),
    originalLeverage:     (a.price + b.price + synergyBonus) > 0
      ? (a.debt + b.debt) / (a.price + b.price + synergyBonus) : 0,
    employees:            totalEmployees - redundancies,
    originalEmployees:    totalEmployees,
    thesisTags: Array.from(
      new Set([...(a.thesisTags || []), ...(b.thesisTags || []), "Roll-up synergy"])
    ).slice(0, 4),
    timeOwned: 0,
    status: "active",
  };

  const removed = new Set([a.id, b.id]);
  const next = {
    ...state,
    aum:       state.aum + synergyBonus,
    stress:    clamp(state.stress + 2, 0, 100),
    portfolio: [merged, ...state.portfolio.filter(c => !removed.has(c.id))],
  };
  return addLog(
    next,
    `Merged ${a.name} and ${b.name} into ${merged.name}. ${redundancies.toLocaleString()} roles eliminated as "synergies".`,
    "good"
  );
}

function lobbySector(state, sector) {
  const sectorCount = state.portfolio.filter(c => c.sector === sector).length;
  if (sectorCount < 3) return addLog(state, `Need at least three ${sector} companies before lobbying.`, "bad");

  const attempts      = (state.lobbying?.[sector] || 0) + 1;
  const successChance = Math.max(0.2, 0.65 - attempts * 0.08 + (state.reputation - 50) * 0.002);
  const success       = Math.random() < successChance;
  const nextBoosts    = { ...(state.modifiers.sectorProfitBoosts || {}) };
  const nextLobbying  = { ...(state.lobbying || {}), [sector]: attempts };

  let next = {
    ...state,
    lobbying:  nextLobbying,
    modifiers: { ...state.modifiers, sectorProfitBoosts: nextBoosts },
  };

  if (success) {
    nextBoosts[sector] = (nextBoosts[sector] || 0) + 0.03;
    next.portfolio = next.portfolio.map(c =>
      c.sector === sector ? { ...c, income: c.income * 1.03 } : c
    );
    const mechanism = choice(LOBBYING_MECHANISMS[sector] || ["regulatory environment softened"]);
    next = addLog(next, `${sector} lobby succeeded: ${mechanism}. Sector profits +3%.`, "good");
  } else {
    next.reputation = clamp(next.reputation - 2, 0, 100);
    next.stress     = clamp(next.stress + 2, 0, 100);
    next = addLog(next, `Lobbying push in ${sector} fizzled. A few journalists noticed.`, "warn");
  }
  return next;
}

// ── Main tick ─────────────────────────────────────────────────────────────────
function tickState(state) {
  let next = { ...state, time: state.time + TICK_MS / 1000 };

  // Income
  const incomeMult      = next.modifiers.incomeMult ?? 1;
  const feeIncome       = next.aum * 0.00022;
  const portfolioIncome = next.portfolio.reduce(
    (sum, c) => sum + c.income * (c.health / 100) * incomeMult, 0
  ) * 0.09;
  next.cash += (feeIncome + portfolioIncome) * (TICK_MS / 1000);

  // Debt recovery
  const maxDebtCapacity = baseDebtCeiling(next);
  next.debtCapacity = clamp(
    next.debtCapacity + (2.8 + next.reputation * 0.04 + next.portfolio.length * 0.12) * (TICK_MS / 1000),
    0, maxDebtCapacity
  );

  // Stress drift
  const stressDrift = next.portfolio.length > 0 ? 0.025 * next.portfolio.length : -0.02;
  next.stress = clamp(next.stress + stressDrift, 0, 100);

  // Family / reputation cascade
  if (next.stress > 65)      next.family     = clamp(next.family - 0.07, 0, 100);
  else if (next.stress < 25) next.family     = clamp(next.family + 0.03, 0, 100);
  if (next.family < 30)      next.reputation = clamp(next.reputation - 0.015, 0, 100);

  // Surface the cascade to the player at key thresholds (fires once per crossing)
  if (next.family < 60 && state.family >= 60)
    next = addLog(next, "You've been missing dinners. Things at home are getting strained.", "warn");
  if (next.family < 35 && state.family >= 35)
    next = addLog(next, "Your family barely sees you. The stress is bleeding into everything.", "warn");
  if (next.family < 15 && state.family >= 15)
    next = addLog(next, "Family at breaking point. Your absence is now costing you professionally.", "bad");
  if (next.stress > 80 && state.stress <= 80)
    next = addLog(next, "Stress is critical. You're running on fumes.", "bad");
  if (next.stress < 30 && state.stress >= 30)
    next = addLog(next, "Things have calmed down. You're almost sleeping normally.", "info");

  // Deal expiry — null the slot in-place, keeping all other cards stationary
  next.deals = next.deals.map(d =>
    d === null              ? null :
    d.expiry - TICK_MS / 1000 <= 0 ? null :
    { ...d, expiry: d.expiry - TICK_MS / 1000 }
  );

  // New deal fills a random empty slot (random to distribute evenly across the grid)
  const nullSlotIndices = next.deals.reduce((acc, d, i) => d === null ? [...acc, i] : acc, []);
  if (
    nullSlotIndices.length > 0 &&
    Math.random() < 0.12 + Math.max(0, nullSlotIndices.length * 0.03)
  ) {
    const slotIdx = nullSlotIndices[Math.floor(Math.random() * nullSlotIndices.length)];
    const newDeals = [...next.deals];
    newDeals[slotIdx] = createDeal(next.aum, next.modifiers);
    next.deals = newDeals;
  }

  // Portfolio decay + bankruptcy
  const newGraveyard = [];
  next.portfolio = next.portfolio.flatMap(company => {
    const timeOwned = company.timeOwned + TICK_MS / 1000;
    let updated = { ...company, timeOwned };
    updated.health       = clamp(updated.health - 0.015 - updated.debt / Math.max(40, updated.price) * 0.006, 0, 100);
    updated.morale       = clamp(updated.morale - 0.01, 0, 100);
    updated.collapseRisk = clamp(
      updated.collapseRisk + (updated.health < 35 ? 0.05 : -0.01) + (updated.morale < 25 ? 0.03 : 0),
      0, 100
    );

    const collapseProb = updated.collapseRisk / 1000;
    if (Math.random() < collapseProb * (TICK_MS / 1000) * 0.9) {
      next.cash       = Math.max(0, next.cash - updated.debt * 0.03);
      next.reputation = clamp(next.reputation - 8, 0, 100);
      next.stress     = clamp(next.stress + 10, 0, 100);
      newGraveyard.push({
        name:              updated.name,
        sector:            updated.sector,
        logo:              updated.logo || SECTOR_EMOJI[updated.sector] || "🏢",
        employees:         updated.employees || 0,
        originalEmployees: updated.originalEmployees || 0,
        debt:              updated.debt,
        health:            updated.health,
        timeOwned:         updated.timeOwned,
        collapseTime:      next.time,
      });
      return [];
    }
    return [updated];
  });

  if (newGraveyard.length > 0) {
    next.graveyard = [...(next.graveyard || []), ...newGraveyard];
    newGraveyard.forEach(g => {
      const msg = choice(FAILURE_HEADLINES)
        .replace("{name}", g.name)
        .replace("{employees}", g.employees.toLocaleString());
      next = addLog(next, msg, "bad");
    });
  }

  // Modifier timers
  next.modifiers = {
    ...next.modifiers,
    timerCheapCredit: Math.max(0, next.modifiers.timerCheapCredit - TICK_MS / 1000),
    timerIncomeShock: Math.max(0, next.modifiers.timerIncomeShock - TICK_MS / 1000),
  };
  if (next.modifiers.timerCheapCredit <= 0) next.modifiers.dealPriceMult = 1;
  if (next.modifiers.timerIncomeShock  <= 0) next.modifiers.incomeMult   = 1;

  // Random events
  next.eventCooldown -= TICK_MS / 1000;
  if (next.eventCooldown <= 0 && Math.random() < 0.06) {
    const event = weightedPick(EVENT_DECK);
    next = addLog(event.apply(next), `${event.title}: ${event.body}`, "event");
    next.eventCooldown = rand(18, 35);
  }

  // AUM milestone unlocks
  if (!next.unlocked.debtDesk && next.aum >= 250) {
    next.unlocked.debtDesk = true;
    next.debtCapacity += 80;
    next = addLog(next, "Unlocked Debt Desk: lenders now return your calls. Debt capacity expanded.", "good");
  }
  if (!next.unlocked.megaFund && next.aum >= 750) {
    next.unlocked.megaFund = true;
    next.cash += 40;
    next = addLog(next, "Unlocked Mega Fund: prestige money pours in. Dry powder topped up.", "good");
  }
  if (!next.unlocked.cloDesk && next.totalExtracted >= 180) {
    next.unlocked.cloDesk = true;
    next.cash += 30;
    next.reputation = clamp(next.reputation - 5, 0, 100);
    next = addLog(next, "Unlocked CLO Desk: you found a cleaner shelf for dirtier debt.", "warn");
  }

  next.cash = clamp(next.cash, 0, 9_999_999);
  next.aum  = clamp(next.aum,  0, 9_999_999);
  return next;
}

// ── Styles ────────────────────────────────────────────────────────────────────
const styles = {
  page: {
    minHeight: "100vh",
    background: "linear-gradient(180deg, #0f172a 0%, #111827 55%, #172033 100%)",
    color: "#f8fafc",
    fontFamily: "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif",
    padding: 20,
  },
  wrap:        { maxWidth: 1280, margin: "0 auto" },
  title:       { fontSize: 44, fontWeight: 700, letterSpacing: "-0.03em", margin: "4px 0 10px" },
  eyebrow:     { fontSize: 12, color: "#94a3b8", letterSpacing: "0.22em", textTransform: "uppercase" },
  subtitle:    { color: "#cbd5e1", maxWidth: 760, lineHeight: 1.5 },
  resources:   { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: 12, marginTop: 12 },
  card: {
    background: "rgba(15, 23, 42, 0.92)",
    border: "1px solid rgba(71, 85, 105, 0.85)",
    borderRadius: 20,
    padding: 16,
    boxShadow: "0 10px 30px rgba(0,0,0,0.18)",
  },
  softCard: {
    background: "rgba(15, 23, 42, 0.75)",
    border: "1px solid rgba(71, 85, 105, 0.65)",
    borderRadius: 20,
    padding: 16,
  },
  statLabel:    { fontSize: 12, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.08em" },
  statValue:    { fontSize: 28, fontWeight: 700, marginTop: 4 },
  sectionTitle: { fontSize: 24, fontWeight: 700, marginBottom: 8 },
  smallText:    { fontSize: 14, color: "#cbd5e1", lineHeight: 1.45 },
  button: {
    background: "#2563eb", color: "white", border: 0,
    borderRadius: 14, padding: "10px 14px", fontWeight: 600, cursor: "pointer",
    minHeight: 44,
  },
  buttonSecondary: {
    background: "#1e293b", color: "#f8fafc", border: "1px solid #475569",
    borderRadius: 14, padding: "10px 14px", fontWeight: 600, cursor: "pointer",
    minHeight: 44,
  },
  buttonDisabled: {
    background: "#334155", color: "#94a3b8", border: 0,
    borderRadius: 14, padding: "10px 14px", fontWeight: 600, cursor: "not-allowed",
    minHeight: 44,
  },
  badge:         { display: "inline-block", background: "#1e293b", color: "#e2e8f0", padding: "5px 10px", borderRadius: 999, fontSize: 12, fontWeight: 600 },
  pill:          { display: "inline-block", background: "#111827", border: "1px solid #334155", color: "#e2e8f0", padding: "5px 10px", borderRadius: 999, fontSize: 12, marginRight: 6, marginBottom: 6 },
  progressOuter: { width: "100%", height: 10, background: "#1e293b", borderRadius: 999, overflow: "hidden" },
  progressInner: (v) => ({ width: `${v}%`, height: "100%", background: "linear-gradient(90deg, #38bdf8, #818cf8)" }),
  logBox:        { display: "flex", flexDirection: "column", gap: 8, maxHeight: 360, overflow: "auto" },
  dealGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
    gap: 14,
    alignItems: "start",
  },
};

// Ticker tape colour map — matches log entry kinds
const TICKER_COLORS = {
  good:  "#86efac",
  bad:   "#fca5a5",
  warn:  "#fcd34d",
  event: "#e879f9",
  info:  "#94a3b8",
};

// ── UI Components ─────────────────────────────────────────────────────────────

function ResourceCard({ label, value, sub, valueColor, compact }) {
  return (
    <div style={{ ...styles.card, padding: compact ? "10px 12px" : 16 }}>
      <div style={{ ...styles.statLabel, fontSize: compact ? 10 : 12 }}>{label}</div>
      <div style={{ ...styles.statValue, fontSize: compact ? 20 : 28, color: valueColor || "#f8fafc" }}>{value}</div>
      {sub && !compact ? <div style={{ fontSize: 13, color: "#94a3b8" }}>{sub}</div> : null}
    </div>
  );
}

function ProgressBar({ value }) {
  return (
    <div style={styles.progressOuter}>
      <div style={styles.progressInner(clamp(value, 0, 100))} />
    </div>
  );
}

/**
 * TickerTape — scrolls financial metrics AND recent activity log entries.
 *
 * Seamless looping fix: content is rendered TWICE side-by-side inside the
 * scrolling div. The CSS animation translates by -50% of the total width,
 * which equals exactly one content-width. When it loops back to 0, the
 * position is visually identical — no gap, no jump, no disappearing text.
 *
 * The animation is defined via .ticker-inner in index.html, NOT as an inline
 * style prop. This means React's style reconciler never writes the `animation`
 * property and cannot accidentally reset the scroll mid-loop on re-renders.
 */
function TickerTape({ state }) {
  const debtCeiling = baseDebtCeiling(state);

  // One full set of items. Called twice to produce the seamless duplicate.
  // keyPrefix ensures React keys are unique across the two copies.
  function renderItems(keyPrefix) {
    return (
      <React.Fragment key={keyPrefix}>
        <span style={{ marginRight: 32 }}>💵 Cash {formatMoney(state.cash)}</span>
        <span style={{ marginRight: 32 }}>🏦 AUM {formatMoney(state.aum)}</span>
        <span style={{ marginRight: 32 }}>📉 Debt room {formatMoney(state.debtCapacity)}</span>
        <span style={{ marginRight: 32 }}>📈 Debt ceiling {formatMoney(debtCeiling)}</span>
        <span style={{ marginRight: 32 }}>📰 Reputation {state.reputation.toFixed(0)}/100</span>
        <span style={{ marginRight: 32 }}>😬 Stress {state.stress.toFixed(0)}/100</span>
        <span style={{ marginRight: 32 }}>🏠 Family {state.family.toFixed(0)}/100</span>

        {Object.entries(state.modifiers.sectorProfitBoosts || {}).map(([sector, boost]) => (
          <span key={`${keyPrefix}boost-${sector}`} style={{ marginRight: 32 }}>
            {SECTOR_EMOJI[sector] || "🏢"} {sector} lobby +{Math.round(boost * 100)}%
          </span>
        ))}

        <span style={{ marginRight: 48, color: "#334155" }}>◆◆◆</span>

        {state.log.slice(0, 8).map(entry => (
          <span key={`${keyPrefix}${entry.id}`} style={{ marginRight: 40, color: TICKER_COLORS[entry.kind] || "#94a3b8" }}>
            {entry.text}
          </span>
        ))}

        {/* Gap between end of one loop and start of the next */}
        <span style={{ paddingRight: 80 }} />
      </React.Fragment>
    );
  }

  return (
    <div style={{ ...styles.softCard, overflow: "hidden", marginTop: 18, marginBottom: 14, paddingTop: 10, paddingBottom: 10 }}>
      {/* .ticker-inner drives the animation via CSS class — React never touches it */}
      <div className="ticker-inner">
        {renderItems("a-")}
        {renderItems("b-")}
      </div>
    </div>
  );
}

function MiniStat({ label, value, tooltip, delta, goodDirection = "up" }) {
  let deltaText  = null;
  let deltaColor = "#64748b";
  if (typeof delta === "number" && Math.abs(delta) > 0.001) {
    const positive = delta > 0;
    const arrow    = positive ? "↑" : "↓";
    const good     = goodDirection === "up" ? positive : !positive;
    deltaColor = good ? "#86efac" : "#fca5a5";
    deltaText  = `${arrow} ${Math.abs(delta).toFixed(1)} since buy`;
  }
  return (
    <div style={{ background: "#111827", border: "1px solid #334155", borderRadius: 14, padding: 8 }} title={tooltip || ""}>
      <div style={{ fontSize: 12, color: "#94a3b8" }}>{label}</div>
      <div style={{ fontWeight: 600, marginTop: 2 }}>{value}</div>
      <div style={{ fontSize: 11, color: deltaText ? deltaColor : "#64748b", marginTop: 4 }}>
        {deltaText || (tooltip ? "" : "")}
      </div>
    </div>
  );
}

/**
 * DealCard — thesis tags now come from THESIS_TAG_RULES in gameContent.js.
 * Previously the thresholds (0.72, 0.65, 0.6) were hardcoded here, duplicating
 * the values already used in buyDeal. Single source of truth now.
 */
function DealCard({ deal, onBuy, affordable, affordableDebt, debtCapacity, compact }) {
  const rarity       = RARITY_CONFIG[deal.rarity];
  const equityNeeded = deal.price * (1 - deal.debtTolerance);
  const urgency      = deal.expiry < 6;

  return (
    <div style={{
      ...styles.card,
      minWidth: 0,
      padding: compact ? 10 : 16,
      borderColor: rarity.border,
      boxShadow: urgency
        ? `0 0 0 1px ${rarity.border}, 0 0 22px rgba(255,255,255,0.08)`
        : styles.card.boxShadow,
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8, marginBottom: compact ? 7 : 10 }}>
        <div>
          <div style={{ fontWeight: 700, lineHeight: 1.2, fontSize: compact ? 13 : 15 }}>{deal.logo} {deal.name}</div>
          <div style={{ fontSize: compact ? 11 : 13, color: "#cbd5e1", marginTop: 3 }}>{deal.sector} · {deal.size}</div>
        </div>
        <span style={{ ...styles.badge, fontSize: compact ? 10 : 12 }}>{deal.rarityLabel}</span>
      </div>

      {/* Compact: 3-col grid keeps height down; full: 2-col */}
      <div style={{ display: "grid", gridTemplateColumns: compact ? "1fr 1fr 1fr" : "1fr 1fr", gap: compact ? 5 : 8, marginBottom: compact ? 7 : 10 }}>
        <MiniStat label="Price"     value={formatMoneyInt(deal.price)}                 tooltip="Headline acquisition price." />
        <MiniStat label="Equity"    value={formatMoneyInt(equityNeeded)}               tooltip="Cash needed if preferred debt is available." />
        <MiniStat label="Yield"     value={`${formatMoneyInt(deal.income)}/t`}         tooltip="Base cash contribution if acquired." />
        <MiniStat label="Leverage"  value={`${Math.round(deal.debtTolerance * 100)}%`} tooltip="Preferred debt share under normal credit conditions." />
        <MiniStat label="Employees" value={deal.employees.toLocaleString()}            tooltip="Current headcount. Will change with restructuring decisions." />
      </div>

      {!compact && (
        <div style={{ fontSize: 12, color: "#94a3b8", marginBottom: 10 }}>
          Preferred debt: {formatMoney(deal.price * deal.debtTolerance)} · Debt room: {formatMoney(debtCapacity)}
        </div>
      )}

      {/* Tags from THESIS_TAG_RULES — no hardcoded thresholds here */}
      <div style={{ marginBottom: compact ? 7 : 10 }}>
        {THESIS_TAG_RULES.map(rule => (
          <span key={rule.stat} style={{ ...styles.pill, fontSize: compact ? 10 : 12, padding: compact ? "3px 7px" : "5px 10px" }}>
            {deal[rule.stat] > rule.threshold ? rule.high : rule.low}
          </span>
        ))}
      </div>

      <div style={{ marginBottom: compact ? 7 : 10 }}>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "#94a3b8", marginBottom: 4 }}>
          <span>Offer window</span>
          <span>{deal.expiry.toFixed(0)}s</span>
        </div>
        <ProgressBar value={(deal.expiry / DEAL_LIFETIME) * 100} />
      </div>

      <button
        style={{ ...(affordable ? styles.button : styles.buttonDisabled), width: "100%", fontSize: compact ? 13 : 14 }}
        disabled={!affordable}
        onClick={() => onBuy(deal.id)}
      >
        {!affordable ? "Need more cash" : affordableDebt ? "Acquire" : "Acquire all-cash / low debt"}
      </button>
    </div>
  );
}

/** Empty deal slot — keeps the grid layout stable when a deal has expired */
function EmptyDealSlot() {
  return (
    <div style={{
      ...styles.softCard,
      minHeight: 220,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      color: "#334155",
      fontSize: 13,
      border: "1px dashed #1e293b",
    }}>
      Waiting for deal flow…
    </div>
  );
}

function CompanyCard({ company, onAction, debtDeskUnlocked }) {
  const riskColor       = company.collapseRisk > 60 ? "#fca5a5" : company.collapseRisk > 35 ? "#fcd34d" : "#86efac";
  const currentLeverage = company.price > 0 ? company.debt / company.price : 0;
  const employeeDelta   = (company.employees || 0) - (company.originalEmployees || company.employees || 0);

  return (
    <div style={styles.card}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, marginBottom: 12 }}>
        <div>
          <div style={{ fontWeight: 700 }}>{company.logo || SECTOR_EMOJI[company.sector] || "🏢"} {company.name}</div>
          <div style={{ fontSize: 13, color: "#cbd5e1" }}>{company.sector} · {company.size}</div>
        </div>
        <span style={styles.badge}>Debt {formatMoney(company.debt)}</span>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 10 }}>
        <MiniStat label="Price"    value={formatMoney(company.price)}             tooltip="Purchase price / current paper valuation base."   delta={company.price    - (company.originalPrice    || company.price)}    goodDirection="up" />
        <MiniStat label="Debt"     value={formatMoney(company.debt)}              tooltip="Debt currently on this company."                  delta={company.debt     - (company.originalDebt     || company.debt)}     goodDirection="down" />
        <MiniStat label="Leverage" value={`${Math.round(currentLeverage * 100)}%`} tooltip="Debt as share of company value."                delta={(currentLeverage - (company.originalLeverage || currentLeverage)) * 100} goodDirection="down" />
        <MiniStat label="Yield"    value={`${formatMoney(company.income)}/tick`}  tooltip="Gross cash contribution per tick."                delta={company.income   - (company.originalIncome   || company.income)}   goodDirection="up" />
      </div>

      <div style={{ marginBottom: 10 }}>
        {(company.thesisTags || []).map(tag => <span key={tag} style={styles.pill}>{tag}</span>)}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 12 }}>
        <MiniStat label="Health"    value={company.health.toFixed(0)}                               tooltip="Operational resilience."           delta={company.health       - (company.originalHealth       || company.health)}       goodDirection="up" />
        <MiniStat label="Morale"    value={company.morale.toFixed(0)}                               tooltip="Staff morale."                     delta={company.morale       - (company.originalMorale       || company.morale)}       goodDirection="up" />
        <MiniStat label="Risk"      value={<span style={{ color: riskColor }}>{company.collapseRisk.toFixed(0)}%</span>} tooltip="Collapse probability pressure." delta={company.collapseRisk - (company.originalCollapseRisk || company.collapseRisk)} goodDirection="down" />
        <MiniStat label="Employees" value={(company.employees || 0).toLocaleString()}               tooltip="Headcount since acquisition. Declines with cuts and strips." delta={employeeDelta} goodDirection="up" />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 12 }}>
        <MiniStat label="Strip value" value={formatMoney(company.stripValue)} tooltip="Remaining asset-stripping value." delta={company.stripValue - (company.originalStripValue || company.stripValue)} goodDirection="up" />
        <MiniStat label="Owned"       value={`${company.timeOwned.toFixed(0)}s`} tooltip="Time in your portfolio." />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 8 }}>
        <button style={styles.buttonSecondary}                                                                            onClick={() => onAction(company.id, "stabilise")}>Stabilise</button>
        <button style={debtDeskUnlocked ? styles.buttonSecondary : styles.buttonDisabled} disabled={!debtDeskUnlocked}  onClick={() => onAction(company.id, "cut")}>Cut costs</button>
        <button style={debtDeskUnlocked ? styles.buttonSecondary : styles.buttonDisabled} disabled={!debtDeskUnlocked}  onClick={() => onAction(company.id, "load")}>Load debt</button>
        <button style={debtDeskUnlocked ? styles.buttonSecondary : styles.buttonDisabled} disabled={!debtDeskUnlocked}  onClick={() => onAction(company.id, "strip")}>Strip assets</button>
      </div>
      {!debtDeskUnlocked && (
        <div style={{ fontSize: 12, color: "#94a3b8", marginBottom: 8 }}>Debt Desk unlocks extraction actions at $250M AUM.</div>
      )}
      <button style={{ ...styles.button, width: "100%", background: "#0f766e" }} onClick={() => onAction(company.id, "exit")}>
        Exit position
      </button>
    </div>
  );
}

function LogEntry({ entry }) {
  const palette = {
    good:  { bg: "rgba(16, 185, 129, 0.14)",  border: "#10b981", color: "#d1fae5" },
    bad:   { bg: "rgba(239, 68, 68, 0.14)",   border: "#ef4444", color: "#fee2e2" },
    warn:  { bg: "rgba(245, 158, 11, 0.14)",  border: "#f59e0b", color: "#fef3c7" },
    event: { bg: "rgba(217, 70, 239, 0.14)",  border: "#d946ef", color: "#fae8ff" },
    info:  { bg: "rgba(148, 163, 184, 0.10)", border: "#475569", color: "#e2e8f0" },
  };
  const p = palette[entry.kind] || palette.info;
  return (
    <div style={{ background: p.bg, border: `1px solid ${p.border}`, color: p.color, borderRadius: 14, padding: "10px 12px", fontSize: 14 }}>
      {entry.text}
    </div>
  );
}

function SectorMergePanel({ portfolio, onMerge }) {
  const counts = portfolio.reduce((acc, c) => {
    acc[c.sector] = (acc[c.sector] || 0) + 1;
    return acc;
  }, {});
  return (
    <div style={{ ...styles.softCard, marginBottom: 12 }}>
      <div style={{ fontWeight: 700, marginBottom: 8 }}>Roll-up mergers</div>
      <div style={{ ...styles.smallText, marginBottom: 10 }}>
        Merge two companies in the same sector to boost income and reduce collapse risk. Redundancies are inevitable.
      </div>
      {Object.keys(counts).length === 0 ? (
        <div style={{ color: "#94a3b8", fontSize: 14 }}>No sectors in portfolio yet.</div>
      ) : (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {Object.entries(counts).map(([sector, count]) => (
            <button key={sector} style={count >= 2 ? styles.buttonSecondary : styles.buttonDisabled} disabled={count < 2} onClick={() => onMerge(sector)}>
              Merge {SECTOR_EMOJI[sector] || "🏢"} {sector} ({count})
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function LobbyPanel({ portfolio, lobbying, boosts, onLobby }) {
  const counts   = portfolio.reduce((acc, c) => { acc[c.sector] = (acc[c.sector] || 0) + 1; return acc; }, {});
  const eligible = Object.entries(counts).filter(([, count]) => count >= 3);
  return (
    <div style={{ ...styles.softCard, marginBottom: 12 }}>
      <div style={{ fontWeight: 700, marginBottom: 8 }}>Lobby government</div>
      <div style={{ ...styles.smallText, marginBottom: 10 }}>
        Control enough of a sector and you can tilt policy in your favour. The activity log will show exactly what was traded away for the income bump.
      </div>
      {eligible.length === 0 ? (
        <div style={{ color: "#94a3b8", fontSize: 14 }}>Acquire at least 3 companies in a sector to start lobbying there.</div>
      ) : (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {eligible.map(([sector, count]) => {
            const attempts = lobbying[sector] || 0;
            const bonus    = boosts[sector] || 0;
            return (
              <button key={sector} style={styles.buttonSecondary} onClick={() => onLobby(sector)} title={`Owned: ${count} · Attempts: ${attempts} · Bonus: +${Math.round(bonus * 100)}%`}>
                Lobby {SECTOR_EMOJI[sector] || "🏢"} {sector} (+{Math.round(bonus * 100)}%)
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function GraveyardPanel({ graveyard }) {
  if (!graveyard || graveyard.length === 0) return null;
  const totalOriginal   = graveyard.reduce((sum, g) => sum + (g.originalEmployees || 0), 0);
  const totalAtCollapse = graveyard.reduce((sum, g) => sum + (g.employees || 0), 0);
  return (
    <div style={{ marginTop: 18 }}>
      <div style={{ fontWeight: 700, marginBottom: 4 }}>Former Portfolio</div>
      <div style={{ fontSize: 13, color: "#94a3b8", marginBottom: 10 }}>
        Companies that collapsed under your ownership.{" "}
        {totalOriginal > 0 && (
          <span style={{ color: "#fca5a5" }}>
            Combined headcount at acquisition: {totalOriginal.toLocaleString()}. At collapse: {totalAtCollapse.toLocaleString()}.
          </span>
        )}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {graveyard.map((g, i) => (
          <div key={i} style={{ background: "rgba(239,68,68,0.07)", border: "1px solid rgba(239,68,68,0.22)", borderRadius: 12, padding: "8px 12px", fontSize: 13, display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
            <span style={{ color: "#fca5a5" }}>{g.logo} <strong>{g.name}</strong> · {g.sector}</span>
            <span style={{ color: "#94a3b8" }}>
              {g.originalEmployees > 0 ? `${g.originalEmployees.toLocaleString()} → ${g.employees.toLocaleString()} employees` : `${g.employees.toLocaleString()} employees`}
              {" · "}owned {g.timeOwned.toFixed(0)}s
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function lockedPanel(title, body, progress, milestone) {
  return (
    <div style={styles.softCard}>
      <div style={{ ...styles.sectionTitle, fontSize: 22 }}>{title}</div>
      <div style={{ fontWeight: 600, marginBottom: 8 }}>Locked until {milestone}</div>
      <div style={{ ...styles.smallText, marginBottom: 12 }}>{body}</div>
      <ProgressBar value={progress} />
    </div>
  );
}

/**
 * RetireScreen — the ending.
 *
 * Shows the full human cost summary alongside financial metrics.
 * The financial numbers look great. That's the point.
 * "You won." comes last, after everything else.
 */
function RetireScreen({ state, onNewRun }) {
  const portfolioOriginalEmployees = state.portfolio.reduce((sum, c) => sum + (c.originalEmployees || 0), 0);
  const portfolioCurrentEmployees  = state.portfolio.reduce((sum, c) => sum + (c.employees || 0), 0);
  const portfolioJobsLost          = portfolioOriginalEmployees - portfolioCurrentEmployees;

  const graveyardOriginal  = (state.graveyard || []).reduce((sum, g) => sum + (g.originalEmployees || 0), 0);
  const graveyardCollapse  = (state.graveyard || []).reduce((sum, g) => sum + (g.employees || 0), 0);
  const graveyardJobsLost  = graveyardOriginal - graveyardCollapse;

  const totalJobsLost = portfolioJobsLost + graveyardJobsLost;

  const statRow = (label, value, color) => (
    <div style={{ display: "flex", justifyContent: "space-between", padding: "10px 0", borderBottom: "1px solid #1e293b" }}>
      <span style={{ color: "#94a3b8", fontSize: 15 }}>{label}</span>
      <span style={{ fontWeight: 700, fontSize: 15, color: color || "#f8fafc" }}>{value}</span>
    </div>
  );

  return (
    <div style={{
      position: "fixed", inset: 0,
      background: "rgba(8, 12, 24, 0.97)",
      display: "flex", alignItems: "center", justifyContent: "center",
      zIndex: 1000, padding: 24,
    }}>
      <div style={{ maxWidth: 560, width: "100%" }}>

        <div style={{ fontSize: 11, color: "#475569", letterSpacing: "0.25em", textTransform: "uppercase", marginBottom: 8 }}>
          Acquisition.lol
        </div>
        <div style={{ fontSize: 36, fontWeight: 700, letterSpacing: "-0.03em", marginBottom: 4 }}>
          Fund Closed
        </div>
        <div style={{ fontSize: 14, color: "#64748b", marginBottom: 32 }}>
          Final performance summary
        </div>

        {/* Financial metrics — the good news */}
        <div style={{ marginBottom: 8 }}>
          {statRow("AUM at retirement",      formatMoney(state.aum))}
          {statRow("Total deals acquired",   state.lifetimeDeals)}
          {statRow("Total value extracted",  formatMoney(state.totalExtracted), "#86efac")}
          {statRow("Final reputation",       `${state.reputation.toFixed(0)}/100`)}
        </div>

        {/* The human cost — the context for those numbers */}
        <div style={{ marginTop: 24, marginBottom: 8 }}>
          <div style={{ fontSize: 11, color: "#475569", letterSpacing: "0.2em", textTransform: "uppercase", marginBottom: 8 }}>
            Human cost
          </div>
          {portfolioJobsLost > 0 && statRow(
            "Jobs cut across surviving portfolio",
            `-${portfolioJobsLost.toLocaleString()}`,
            "#fcd34d"
          )}
          {state.graveyard && state.graveyard.length > 0 && (
            <>
              {statRow("Companies that collapsed",        state.graveyard.length, "#fca5a5")}
              {statRow("Employed when you acquired them", graveyardOriginal.toLocaleString(), "#fca5a5")}
              {statRow("Employed when they collapsed",    graveyardCollapse.toLocaleString(), "#fca5a5")}
            </>
          )}
          {totalJobsLost > 0 && (
            <div style={{ marginTop: 12, padding: "12px 16px", background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)", borderRadius: 12, color: "#fca5a5", fontSize: 14 }}>
              {totalJobsLost.toLocaleString()} jobs lost or eliminated under your ownership.
            </div>
          )}
        </div>

        {/* The punchline */}
        <div style={{ marginTop: 40, marginBottom: 32, textAlign: "center" }}>
          <div style={{ fontSize: 28, fontWeight: 700, color: "#f8fafc", letterSpacing: "-0.02em" }}>
            You won.
          </div>
        </div>

        <button style={{ ...styles.buttonSecondary, width: "100%", padding: "14px", fontSize: 15 }} onClick={onNewRun}>
          Start new fund
        </button>
      </div>
    </div>
  );
}

// ── Main App ──────────────────────────────────────────────────────────────────
function App() {
  const [activeTab, setActiveTab] = useState("market");
  const [state, setState]         = useState(createInitialState);
  const [loaded, setLoaded]       = useState(false);
  const [isNarrow, setIsNarrow]   = useState(false);
  const [isMobile, setIsMobile]   = useState(false);
  const [retired, setRetired]     = useState(false);
  const lastSave = useRef(0);

  useEffect(() => {
    setState(hydrateState());
    setLoaded(true);
    const onResize = () => {
      setIsNarrow(window.innerWidth < 900);
      setIsMobile(window.innerWidth < 640);
    };
    onResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    if (!loaded) return undefined;
    const timer = setInterval(() => setState(s => tickState(s)), TICK_MS);
    return () => clearInterval(timer);
  }, [loaded]);

  // Save includes savedAt timestamp for offline progress calculation on next load
  useEffect(() => {
    if (!loaded) return;
    const now = Date.now();
    if (now - lastSave.current > 1000) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...state, savedAt: now }));
      lastSave.current = now;
    }
  }, [state, loaded]);

  const nextAumUnlock = useMemo(() =>
    !state.unlocked.debtDesk ? 250 : !state.unlocked.megaFund ? 750 : 1500,
    [state.unlocked]
  );
  const aumProgress        = clamp((state.aum / nextAumUnlock) * 100, 0, 100);
  const stressColor        = state.stress > 70 ? "#fca5a5" : state.stress > 45 ? "#fcd34d" : "#86efac";
  const familyColor        = state.family < 30 ? "#fca5a5" : state.family < 55 ? "#fcd34d" : "#86efac";
  const portfolioEmployees = state.portfolio.reduce((sum, c) => sum + (c.employees || 0), 0);

  function handleNewRun() {
    setRetired(false);
    setState(createInitialState());
    localStorage.removeItem(STORAGE_KEY);
  }

  return (
    <div style={{ ...styles.page, padding: isMobile ? 12 : 20 }}>
      {retired && <RetireScreen state={state} onNewRun={handleNewRun} />}

      <div style={styles.wrap}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16, flexWrap: "wrap" }}>
          <div>
            <div style={{ ...styles.title, fontSize: isMobile ? 24 : 44 }}>💸 Acqui$ition.lol</div>
            {!isMobile && <div style={styles.subtitle}>Private equity simulator.</div>}
          </div>
          {/* Action buttons: shown in header on desktop, moved to Stats tab on mobile */}
          {!isMobile && (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button style={styles.buttonSecondary} onClick={() => setState(s => addLog(s, "LPs reassured. Nothing material disclosed.", "info"))}>
                Smooth talk LPs
              </button>
              <button style={{ ...styles.buttonSecondary, borderColor: "#475569" }} onClick={() => setRetired(true)}>
                Close fund
              </button>
              <button style={styles.buttonSecondary} onClick={handleNewRun}>
                New run
              </button>
            </div>
          )}
        </div>

        <div style={{ display: "flex", gap: isMobile ? 4 : 8, marginTop: isMobile ? 10 : 18, marginBottom: 14 }}>
          {[
            { id: "market",    emoji: "📈", full: "Market",    short: "Deals"     },
            { id: "portfolio", emoji: "🏢", full: "Portfolio", short: "Portfolio" },
            { id: "dashboard", emoji: "📊", full: "Dashboard", short: "Stats"     },
            { id: "lobbying",  emoji: "🏛️", full: "Lobbying",  short: "Lobby"     },
          ].map(tab => (
            <button
              key={tab.id}
              style={{
                ...(activeTab === tab.id ? styles.button : styles.buttonSecondary),
                ...(isMobile ? { flex: 1, padding: "10px 4px", fontSize: 12 } : {}),
              }}
              onClick={() => setActiveTab(tab.id)}
            >
              {isMobile ? `${tab.emoji} ${tab.short}` : tab.full}
            </button>
          ))}
        </div>

        <TickerTape state={state} />


        <div style={{ ...styles.resources, gridTemplateColumns: isMobile ? "repeat(3, 1fr)" : "repeat(auto-fit, minmax(130px, 1fr))" }}>
          <ResourceCard compact={isMobile} label={isMobile ? "💵 Cash"  : "💵 Cash"}                value={isMobile ? formatMoneyInt(state.cash)         : formatMoney(state.cash)} />
          <ResourceCard compact={isMobile} label={isMobile ? "🏦 AUM"   : "🏦 Assets Under Management"} value={isMobile ? formatMoneyInt(state.aum)          : formatMoney(state.aum)} />
          <ResourceCard compact={isMobile} label={isMobile ? "💸 Debt"  : "💸 Debt Room"}           value={isMobile ? formatMoneyInt(state.debtCapacity)  : formatMoney(state.debtCapacity)} />
          <ResourceCard compact={isMobile} label={isMobile ? "📰 Rep"   : "📰 Reputation"}          value={`${state.reputation.toFixed(0)}%`}  sub="Limited Partners confidence" valueColor={undefined} />
          <ResourceCard compact={isMobile} label={isMobile ? "😥 Stress": "😥 Stress"}              value={`${state.stress.toFixed(0)}%`}       sub="Personal strain"             valueColor={stressColor} />
          <ResourceCard compact={isMobile} label={isMobile ? "🏡 Family": "🏡 Family"}              value={`${state.family.toFixed(0)}%`}       sub="You should maybe go home"    valueColor={familyColor} />
        </div>

        {/* ── Market ── */}
        {activeTab === "market" && (
          <div style={{ marginTop: 16 }}>
            <div style={styles.card}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 12, flexWrap: "wrap", marginBottom: 12 }}>
                <div>
                  <div style={styles.sectionTitle}>Deal Flow</div>
                  <div style={styles.smallText}>Deals expire in place. Rare ones glow.</div>
                </div>
                <div style={{ minWidth: 240 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "#94a3b8", marginBottom: 5 }}>
                    <span>Next AUM milestone</span>
                    <span>{formatMoney(state.aum)} / {formatMoney(nextAumUnlock)}</span>
                  </div>
                  <ProgressBar value={aumProgress} />
                </div>
              </div>

              {/* Fixed slot grid — deals stay in position for their full lifetime */}
              <div style={styles.dealGrid}>
                {state.deals.map((deal, idx) =>
                  deal === null ? (
                    <EmptyDealSlot key={idx} />
                  ) : (
                    <DealCard
                      key={idx}
                      deal={deal}
                      onBuy={id => setState(s => buyDeal(s, id))}
                      affordable={state.cash >= deal.price - Math.min(state.debtCapacity, deal.price * deal.debtTolerance)}
                      affordableDebt={state.debtCapacity >= deal.price * deal.debtTolerance}
                      debtCapacity={state.debtCapacity}
                      compact={isMobile}
                    />
                  )
                )}
              </div>
            </div>
          </div>
        )}

        {/* ── Dashboard ── */}
        {activeTab === "dashboard" && (
          <div style={{ marginTop: 16 }}>
            <div style={{ ...styles.card, maxWidth: 880 }}>
              {/* On mobile, action buttons live here instead of the header */}
              {isMobile && (
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 16 }}>
                  <button style={{ ...styles.buttonSecondary, flex: 1 }} onClick={() => setState(s => addLog(s, "LPs reassured. Nothing material disclosed.", "info"))}>
                    Smooth talk LPs
                  </button>
                  <button style={{ ...styles.buttonSecondary, flex: 1, borderColor: "#475569" }} onClick={() => setRetired(true)}>
                    Close fund
                  </button>
                  <button style={{ ...styles.buttonSecondary, flex: 1 }} onClick={handleNewRun}>
                    New run
                  </button>
                </div>
              )}
              <div style={styles.sectionTitle}>Firm Dashboard</div>
              <div style={{ ...styles.smallText, marginBottom: 12 }}>
                You can always buy all-cash. Debt room replenishes over time and returns faster when you exit positions.
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 14 }}>
                <MiniStat label="Debt room"           value={formatMoney(state.debtCapacity)} />
                <MiniStat label="Debt ceiling"        value={formatMoney(baseDebtCeiling(state))} />
                <MiniStat label="Total extracted"     value={formatMoney(state.totalExtracted)} tooltip="Cumulative cash from debt loads and asset strips." />
                <MiniStat label="Portfolio companies" value={String(state.portfolio.length)} />
                <MiniStat label="Portfolio employees" value={portfolioEmployees.toLocaleString()} tooltip="Total current headcount across all companies you own." />
                <MiniStat label="Deals closed"        value={String(state.lifetimeDeals)} />
              </div>

              <div style={{ marginBottom: 14 }}>
                <div style={{ fontWeight: 700, marginBottom: 8 }}>Unlocks</div>
                <span style={{ ...styles.badge, background: state.unlocked.debtDesk ? "#065f46" : "#1e293b", marginRight: 8 }}>Debt Desk</span>
                <span style={{ ...styles.badge, background: state.unlocked.megaFund ? "#065f46" : "#1e293b", marginRight: 8 }}>Mega Fund</span>
                <span style={{ ...styles.badge, background: state.unlocked.cloDesk  ? "#92400e" : "#1e293b" }}>CLO Desk</span>
              </div>

              <div style={{ marginBottom: 14 }}>
                <div style={{ fontWeight: 700, marginBottom: 8 }}>Activity Log</div>
                <div style={styles.logBox}>
                  {state.log.map(entry => <LogEntry key={entry.id} entry={entry} />)}
                </div>
              </div>

              <GraveyardPanel graveyard={state.graveyard} />
            </div>
          </div>
        )}

        {/* ── Portfolio ── */}
        {activeTab === "portfolio" && (
          <div style={{ marginTop: 16 }}>
            <div style={styles.card}>
              <div style={styles.sectionTitle}>Portfolio</div>
              <SectorMergePanel portfolio={state.portfolio} onMerge={sector => setState(s => mergeCompanies(s, sector))} />
              {state.portfolio.length === 0 ? (
                <div style={{ ...styles.softCard, color: "#94a3b8", textAlign: "center" }}>
                  No companies acquired yet. Wait until a deal is nearly affordable, then do the obviously responsible thing.
                </div>
              ) : (
                <div style={{ display: "grid", gridTemplateColumns: isNarrow ? "1fr" : "1fr 1fr", gap: 12 }}>
                  {state.portfolio.map(company => (
                    <CompanyCard
                      key={company.id}
                      company={company}
                      debtDeskUnlocked={state.unlocked.debtDesk}
                      onAction={(id, action) => setState(s => applyCompanyAction(s, id, action))}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── Lobbying ── */}
        {activeTab === "lobbying" && (
          <div style={{ marginTop: 16 }}>
            {state.unlocked.megaFund ? (
              <div style={{ ...styles.card, maxWidth: 920 }}>
                <div style={styles.sectionTitle}>Advanced Systems</div>
                <LobbyPanel
                  portfolio={state.portfolio}
                  lobbying={state.lobbying || {}}
                  boosts={state.modifiers.sectorProfitBoosts || {}}
                  onLobby={sector => setState(s => lobbySector(s, sector))}
                />
                <div style={styles.smallText}>
                  Own three companies in a sector and you can try lobbying for friendlier rules. The ticker will show you what was exchanged for the income bump.
                </div>
              </div>
            ) : lockedPanel(
              "Lobbying",
              "Reach $750M AUM to unlock.",
              clamp((state.aum / 750) * 100, 0, 100),
              "Mega Fund"
            )}
          </div>
        )}
      </div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<App />);
