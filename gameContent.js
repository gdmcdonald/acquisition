/**
 * gameContent.js — All game data and copy lives here.
 *
 * ── Adding a new sector ───────────────────────────────────────────────────
 * Add ONE object to SECTOR_LIST. That's it. No other arrays to update.
 * Each sector object contains its own emoji, company name suffixes, and
 * lobbying mechanism descriptions, so the sector name can only be typed
 * once and there's nothing to fall out of sync.
 *
 * ── Adding company prefix names ───────────────────────────────────────────
 * Edit COMPANY_PREFIX.
 *
 * ── Adding news headlines ─────────────────────────────────────────────────
 * Edit FAILURE_HEADLINES. Tokens: {name}, {employees}.
 *
 * ── Adding random events ──────────────────────────────────────────────────
 * Add an object to EVENT_DECK. Each event needs:
 *   title:  string
 *   body:   string (shown in activity log)
 *   weight: number (higher = more frequent)
 *   apply:  (state) => newState  (must return a new state object)
 *
 * ── Adjusting deal thesis tags ────────────────────────────────────────────
 * Edit THESIS_TAG_RULES. Each rule checks deal[stat] > threshold.
 */

window.CONTENT = {

  // ── Company prefix names ─────────────────────────────────────────────────

  COMPANY_PREFIX: [
    "Summit", "Harbor", "Northbridge", "Oak & Ash", "Silverline",
    "Evergreen", "Redstone", "Ironstone", "Copperleaf", "Beacon", "Grand Union",
    "Apollo", "Bluebird", "Highland", "Southgate", "Sterling", "Cockatoo", "Kiwi", "Capybara",
    "Velvet", "Quantum", "Nimbus", "Crestview", "Ironwood", "iKnow", "Port Jackson",
    "Clearwater", "Blackrock", "Ashford", "Riverstone", "Goldfield", "Mudwater",
  ],

  // ── Sectors ───────────────────────────────────────────────────────────────
  //
  // To add a sector, add ONE object below. Required fields:
  //   id              — the sector name used everywhere in the game (must be unique)
  //   emoji           — displayed on deal and company cards
  //   suffixes        — company name endings (at least 3 recommended for variety)
  //   lobbyMechanisms — 2–4 strings shown in the log when lobbying succeeds;
  //                     keep them specific and uncomfortable

  SECTOR_LIST: [
    {
      id:    "Retail",
      emoji: "🛍️",
      suffixes: ["Homeware", "Fashion Group", "Mart", "Outlet Holdings", "Department Stores"],
      lobbyMechanisms: [
        "minimum-wage floor waiver secured for casual retail workers",
        "zoning restrictions eased — big-box expansion fast-tracked",
        "returns and refund obligations quietly narrowed for large operators",
      ],
    },
    {
      id:    "Logistics",
      emoji: "🚚",
      suffixes: ["Freight", "Distribution", "Last Mile", "Supply Co.", "Warehousing"],
      lobbyMechanisms: [
        "independent contractor classification extended to warehouse staff",
        "fatigue management reporting requirements quietly relaxed",
        "last-mile delivery liability caps introduced after sustained pressure",
      ],
    },
    {
      id:    "Healthcare",
      emoji: "🏥",
      suffixes: ["Care Group", "Clinics", "Diagnostics", "Day Hospitals", "Wellness Co."],
      lobbyMechanisms: [
        "private billing cap removed from specialist referrals",
        "public-private co-payment rules softened for elective procedures",
        "staff-to-patient ratios in private facilities exempted from review",
      ],
    },
    {
      id:    "Hospitality",
      emoji: "🏨",
      suffixes: ["Hotels", "Resorts", "Food Group", "Restaurants", "Leisure Co."],
      lobbyMechanisms: [
        "penalty rate exemptions extended to hospitality workers on weekends",
        "liquor licensing approval process simplified for large operators",
        "heritage building demolition provisions eased for hotel development",
      ],
    },
    {
      id:    "Education",
      emoji: "🎓",
      suffixes: ["Learning", "Colleges", "Training Group", "EdTech", "Tutoring"],
      lobbyMechanisms: [
        "student loan eligibility extended to private provider courses",
        "regulatory oversight of for-profit colleges quietly reduced",
        "public school surplus land released for private campus development",
      ],
    },
    {
      id:    "Web3",
      emoji: "🪙",
      suffixes: ["Chain Labs", "TokenWorks", "Protocol Studio", "Wallet Ventures", "DeFi Systems"],
      lobbyMechanisms: [
        "crypto asset reporting requirements deferred pending 'further review'",
        "exchange registration thresholds raised — smaller players squeezed out",
        "stablecoin consumer protections shelved after industry consultation",
      ],
    },
    {
      id:    "AI Wrapper",
      emoji: "🤖",
      suffixes: ["Copilot Hub", "Prompt Studio", "Agent Layer", "Workflow AI", "Inference Cloud"],
      lobbyMechanisms: [
        "AI liability framework stalled in committee — indefinitely",
        "data scraping protections carved out for 'research and innovation'",
        "disclosure requirements for AI-generated content diluted on appeal",
      ],
    },
    {
      id:    "Military",
      emoji: "🛰️",
      suffixes: ["Systems", "Technologies", "Operations", "Defense Group", "Aerospace"],
      lobbyMechanisms: [
        "procurement fast-track exemption extended to sole-source contractors",
        "export control waivers granted for allied-nation sales",
        "independent audit requirements for defence contracts quietly shelved",
      ],
    },
    {
      id:    "Trades",
      emoji: "🛠️",
      suffixes: ["Plumbing", "Builders", "Hardware", "Electrical", "Contracting"],
      lobbyMechanisms: [
        "apprenticeship ratio requirements waived for large contractors",
        "safety inspection frequency reduced for certified operators",
        "subcontractor payment terms extended following industry consultation",
      ],
    },
    {
      id:    "Property",
      emoji: "🏡",
      suffixes: ["Real Estate", "Holdings", "Agency", "Developments", "Property Group"],
      lobbyMechanisms: [
        "negative gearing tax treatment extended to commercial portfolios",
        "planning approval timelines shortened for large-scale developments",
        "affordable housing quotas quietly reduced in new development codes",
      ],
    },
    {
      id:    "Data Center",
      emoji: "🖥️",
      suffixes: ["Cloud", "DC", "Switch", "Web Services", "Infrastructure"],
      lobbyMechanisms: [
        "data sovereignty requirements narrowed to exclude hyperscale operators",
        "energy use reporting thresholds raised — large operators now exempt",
        "water cooling permits fast-tracked in drought-affected regions",
      ],
    },
  ],

  // ── Deal configuration ────────────────────────────────────────────────────

  RARITY_CONFIG: {
    common:    { label: "Common",    weight: 60, multiplier: 1.0, border: "#334155" },
    uncommon:  { label: "Uncommon",  weight: 24, multiplier: 1.2, border: "#0891b2" },
    rare:      { label: "Rare",      weight: 11, multiplier: 1.5, border: "#c026d3" },
    legendary: { label: "Legendary", weight:  5, multiplier: 2.0, border: "#d97706" },
  },

  SIZE_CONFIG: {
    Small: { priceBase: 12,  incomeBase: 0.28, debtCap: 0.55 },
    Mid:   { priceBase: 48,  incomeBase: 1.1,  debtCap: 0.68 },
    Large: { priceBase: 160, incomeBase: 3.2,  debtCap: 0.78 },
  },

  // Headcount ranges by size [min, max]
  EMPLOYEE_BASE: {
    Small: [45,   280],
    Mid:   [280,  1800],
    Large: [1500, 7500],
  },

  // ── Deal thesis tags ───────────────────────────────────────────────────────
  // Each rule evaluates deal[stat] > threshold and picks high or low label.

  THESIS_TAG_RULES: [
    { stat: "assetStrip", threshold: 0.72, high: "Asset rich",     low: "Light assets"  },
    { stat: "fragility",  threshold: 0.65, high: "Fragile ops",    low: "Stable ops"    },
    { stat: "brand",      threshold: 0.60, high: "Brand strength", low: "Weak moat"     },
  ],

  // ── Failure headlines ──────────────────────────────────────────────────────
  // Shown when a portfolio company collapses. Tokens: {name}, {employees}

  FAILURE_HEADLINES: [
    "{name} enters voluntary administration",
    "{name} collapses — {employees} staff face redundancy",
    "{name} files for liquidation after debt load proves unsustainable",
    "Workers at {name} arrive to find the doors locked",
    "{name} pension fund shortfall confirmed as company folds",
    "{name} ceases operations. Creditors to receive cents in the dollar",
    "{name} administrator appointed. Staff owed weeks of unpaid wages",
    "Collapse of {name} leaves {employees} without jobs or entitlements",
  ],

  // ── Random events ──────────────────────────────────────────────────────────
  // apply(state) must return a new state object (spread, don't mutate).

  EVENT_DECK: [
    {
      title: "Cheap Credit Window",
      body:  "Banks are frothy again. New deals are 12% cheaper for a brief window.",
      weight: 8,
      apply: (s) => ({ ...s, modifiers: { ...s.modifiers, dealPriceMult: 0.88, timerCheapCredit: 35 } }),
    },
    {
      title: "Rate Hike Shock",
      body:  "Refinancing gets nastier. Portfolio income drops temporarily.",
      weight: 7,
      apply: (s) => ({ ...s, modifiers: { ...s.modifiers, incomeMult: 0.84, timerIncomeShock: 35 } }),
    },
    {
      title: "Glowing Profile in Financial Press",
      body:  "Limited partners love your swagger. Reputation rises.",
      weight: 7,
      apply: (s) => ({ ...s, reputation: Math.max(0, Math.min(100, s.reputation + 8)) }),
    },
    {
      title: "Parliamentary Inquiry",
      body:  "Questions are being asked. Reputation slips and stress jumps.",
      weight: 5,
      apply: (s) => ({
        ...s,
        reputation: Math.max(0, Math.min(100, s.reputation - 10)),
        stress:     Math.max(0, Math.min(100, s.stress + 12)),
      }),
    },
    {
      title: "Family Office Dinner",
      body:  "You show up at home for once. Family improves, stress softens.",
      weight: 6,
      apply: (s) => ({
        ...s,
        family: Math.max(0, Math.min(100, s.family + 10)),
        stress: Math.max(0, Math.min(100, s.stress - 8)),
      }),
    },
    {
      title: "Crisis Consultant",
      body:  "You hired operators instead of just cutters. Portfolio health stabilises.",
      weight: 6,
      apply: (s) => ({
        ...s,
        portfolio: s.portfolio.map((c) => ({ ...c, health: Math.max(0, Math.min(100, c.health + 10)) })),
      }),
    },
    {
      title: "AI Hype Bubble",
      body:  "Anything with AI in the deck gets a temporary valuation bump.",
      weight: 5,
      apply: (s) => ({
        ...s,
        portfolio: s.portfolio.map((c) =>
          c.sector === "AI Wrapper" ? { ...c, income: c.income * 1.08 } : c
        ),
      }),
    },
    {
      title: "Journalist Starts Digging",
      body:  "Someone is asking questions about your Healthcare portfolio. Reputation dips.",
      weight: 4,
      apply: (s) => ({
        ...s,
        reputation: Math.max(0, Math.min(100, s.reputation - 6)),
        stress:     Math.max(0, Math.min(100, s.stress + 8)),
      }),
    },
    {
      title: "LP Confidence Surge",
      body:  "Fund II is oversubscribed. Dry powder and reputation both tick up.",
      weight: 5,
      apply: (s) => ({
        ...s,
        cash:       Math.min(s.cash + 20, 9_999_999),
        reputation: Math.max(0, Math.min(100, s.reputation + 5)),
      }),
    },
  ],

};
