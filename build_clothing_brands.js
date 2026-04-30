/**
 * Fetches real clothing/fashion brands from Wikidata (SPARQL) and writes JSON
 * with Clearbit logo URLs derived from official websites (P856).
 */

const fs = require("fs");
const path = require("path");
const axios = require("axios");

const SPARQL_ENDPOINT = "https://query.wikidata.org/sparql";
const OUTPUT_FILE = path.join(__dirname, "clothing_brands_4000.json");
const TARGET_COUNT = 4000;
const BATCH_SIZE = 350;
const REQUEST_GAP_MS = 320;
const MAX_RETRIES = 4;
/** Max OFFSET steps per (criterion × country) — subclass queries need deep paging for large countries */
const MAX_BATCHES_PER_COUNTRY_CRITERION = 450;
/** Safety valve only (most runs finish when each query is exhausted first) */
const MAX_TOTAL_SPARQL_REQUESTS = 120000;

// Check if output file exists and has data
if (fs.existsSync(OUTPUT_FILE)) {
  try {
    const existingData = JSON.parse(fs.readFileSync(OUTPUT_FILE, 'utf8'));
    if (Array.isArray(existingData) && existingData.length > 0) {
      console.log(`Output file ${OUTPUT_FILE} already exists with ${existingData.length} records. Skipping fetch.`);
      process.exit(0);
    }
  } catch (e) {
    // Invalid JSON, proceed to fetch
  }
}

/** Allowed countries (output labels), keyed by Wikidata Q-ID */
const COUNTRY_BY_QID = {
  Q30: "USA",
  Q16: "Canada",
  Q183: "Germany",
  Q55: "Netherlands",
  Q145: "UK",
  Q35: "Denmark",
  Q45: "Portugal",
  Q29: "Spain",
  Q28: "Hungary",
  Q142: "France",
  Q38: "Italy",
  Q878: "UAE/Dubai",
  Q869: "Thailand",
  Q8646: "Hong Kong",
  Q881: "Vietnam",
  Q334: "Singapore",
};

const COUNTRY_QIDS = Object.keys(COUNTRY_BY_QID);

/** One lightweight SPARQL constraint per row — queried separately with BIND(country) for scalable OFFSET */
const QUERY_TEMPLATES = [
  {
    kind: "fashion_label",
    body: `
      ?item wdt:P31/wdt:P279* wd:Q1618899 .
    `,
  },
  {
    kind: "clothing_industry",
    body: `
      ?item wdt:P452 wd:Q11828862 .
    `,
  },
  {
    kind: "footwear_industry",
    body: `
      ?item wdt:P452 wd:Q5915560 .
    `,
  },
  {
    kind: "optics_industry",
    body: `
      ?item wdt:P452 wd:Q56604313 .
    `,
  },
  {
    kind: "sporting_goods_industry",
    body: `
      ?item wdt:P452 wd:Q57264543 .
    `,
  },
  {
    kind: "textile_industry",
    body: `
      ?item wdt:P452 wd:Q607081 .
    `,
  },
  {
    kind: "clothing_store_chain",
    body: `
      ?item wdt:P31 wd:Q76213285 .
    `,
  },
  {
    kind: "retail_chain_keywords",
    body: `
      ?item wdt:P31 wd:Q507619 .
    `,
    extraFilters: `
      FILTER(REGEX(LCASE(STR(?itemLabel)), "(fashion|apparel|cloth|wear|foot|shoe|sport|luxury|optic|boutique|garment|streetwear|tailor|denim|lingerie|outerwear)"))
    `,
  },
  {
    kind: "department_store_keywords",
    body: `
      ?item wdt:P31 wd:Q216107 .
    `,
    extraFilters: `
      FILTER(REGEX(LCASE(STR(?itemLabel)), "(fashion|apparel|cloth|wear|style|boutique|department|luxury|closet)"))
    `,
  },
  {
    kind: "business_fashion_keywords",
    body: `
      ?item wdt:P31 wd:Q4830453 .
    `,
    extraFilters: `
      FILTER(REGEX(LCASE(STR(?itemLabel)), "(fashion|apparel|cloth|wear|footwear|foot wear|shoe|sneaker|boot|boutique|luxury|sportswear|streetwear|tailor|denim|lingerie|garment|textile|couture|jeans|outerwear|activewear|eyewear|sunglass|handbag|athletic|swimwear|knitwear|millinery|hosiery|jewelry|jewellery|watch|bags|wallet|belt|lingerie|underwear|socks|uniform|kids wear|menswear|womenswear)"))
    `,
  },
  /** Industry is any subclass of clothing industry (broader than single P452 id) */
  {
    kind: "p452_subclass_clothing_industry",
    body: `
      ?item wdt:P452 ?ind .
      ?ind wdt:P279* wd:Q11828862 .
    `,
  },
  {
    kind: "p452_subclass_footwear_industry",
    body: `
      ?item wdt:P452 ?ind .
      ?ind wdt:P279* wd:Q5915560 .
    `,
  },
  {
    kind: "jewelry_industry",
    body: `
      ?item wdt:P452 wd:Q57262277 .
    `,
  },
  {
    kind: "hat_industry",
    body: `
      ?item wdt:P452 wd:Q115933818 .
    `,
  },
  {
    kind: "company_fashion_keywords",
    body: `
      ?item wdt:P31 wd:Q783794 .
    `,
    extraFilters: `
      FILTER(REGEX(LCASE(STR(?itemLabel)), "(fashion|apparel|cloth|wear|footwear|shoe|sneaker|boutique|luxury|sportswear|streetwear|tailor|denim|garment|textile|couture|jeans|outerwear|activewear|eyewear|handbag|swimwear|knitwear|jewelry|jewellery|watch|lingerie|menswear|womenswear|kids wear|uniform|socks|underwear|bags|wallet|belt|hosiery)"))
    `,
  },
  {
    kind: "department_store_chain",
    body: `
      ?item wdt:P31 wd:Q2549179 .
    `,
  },
  {
    kind: "online_shop_fashion_keywords",
    body: `
      ?item wdt:P31 wd:Q4382945 .
    `,
    extraFilters: `
      FILTER(REGEX(LCASE(STR(?itemLabel)), "(fashion|apparel|cloth|wear|shoe|footwear|boutique|luxury|sport|streetwear|tailor|denim|jeans|lingerie|activewear|swimwear|jewelry|jewellery|bags|watch|menswear|womenswear|kids|underwear|socks|uniform)"))
    `,
  },
  /** Luxury positioning on industry — filtered by label */
  {
    kind: "luxury_goods_industry_keywords",
    body: `
      ?item wdt:P452 wd:Q949715 .
    `,
    extraFilters: `
      FILTER(REGEX(LCASE(STR(?itemLabel)), "(fashion|apparel|cloth|wear|leather|bag|shoe|jewelry|jewellery|watch|belt|wallet|scarf|textile|tailor|boutique|couture|lingerie|denim|outerwear|underwear|socks|knit|fur|cashmere)"))
    `,
  },
  /** Many listed apparel retailers use “public company” */
  {
    kind: "public_company_fashion_keywords",
    body: `
      ?item wdt:P31 wd:Q891723 .
    `,
    extraFilters: `
      FILTER(REGEX(LCASE(STR(?itemLabel)), "(fashion|apparel|cloth|wear|shoe|sportswear|boutique|luxury|tailor|denim|textile|garment|outerwear|underwear|socks|bags|jewelry|jewellery|watch|lingerie|kids wear|menswear|womenswear|streetwear|uniform|cap|hat)"))
    `,
  },
  /** Broader keyword net — still excludes obviously unrelated sectors */
  {
    kind: "company_loose_fashion_keywords",
    body: `
      ?item wdt:P31 wd:Q783794 .
    `,
    extraFilters: `
      FILTER(REGEX(LCASE(STR(?itemLabel)), "(wear|boutique|cloth|garment|textile|tailor|sock|hosiery|denim|jersey|jerseys|hoodie|tee|tees|polo|cardigan|parka|puffer|tracksuit|tracksuits|onesie|scrubs|swimwear|swim|surfwear|runners|trainers|slippers|loafers|sandal|parka|rainwear|outerwear|streetwear|sportswear|activewear|knitwear|lingerie|underwear|sleepwear|uniform|workwear|kids wear|menswear|womenswear|eyewear|optical|optics|jewelry|jewellery|handbag|bag maker|hat |caps |capsule|wardrobe)"))
    `,
  },
];

const CATEGORY_POOL = ["shoes", "cap", "dress", "sunglasses", "clothing"];

function buildQuery(tmpl, countryQid, offset, limit) {
  const extra = tmpl.extraFilters ?? "";
  return `
SELECT DISTINCT ?item ?itemLabel ?website WHERE {
  BIND(wd:${countryQid} AS ?country)
  ?item wdt:P17 ?country .
  ?item wdt:P856 ?website .
  FILTER(STRSTARTS(STR(?website), "http"))
  ${tmpl.body}
  ?item rdfs:label ?itemLabel .
  FILTER(LANG(?itemLabel) IN ("en", "fr", "de", "es", "it", "nl", "pt", "ja", "th", "vi", "zh", "ko"))
  ${extra}
}
ORDER BY ?item
LIMIT ${limit}
OFFSET ${offset}
`.trim();
}

function literalValue(binding) {
  if (!binding) return "";
  if (binding.type === "literal") return binding.value;
  if (binding.type === "uri") return binding.value;
  return binding.value ?? "";
}

/** Prefer English brand names when Wikidata returns multiple language labels for one entity */
function pickPreferredLabel(bindingsForItem) {
  const pref = ["en", "fr", "de", "es", "it", "nl", "pt", "ja", "th", "vi", "zh", "ko"];
  const literals = [];
  for (const b of bindingsForItem) {
    const lit = b.itemLabel;
    if (!lit || lit.type !== "literal") continue;
    const lang = lit["xml:lang"] || "";
    literals.push({ lang, value: String(lit.value || "").trim() });
  }
  if (!literals.length) return "";
  for (const lang of pref) {
    const hit = literals.find((x) => x.lang === lang);
    if (hit?.value) return hit.value;
  }
  return literals[0].value || "";
}

function pickOfficialWebsite(bindingsForItem) {
  const urls = new Set();
  for (const b of bindingsForItem) {
    const w = literalValue(b.website);
    if (!w || !/^https?:\/\//i.test(w)) continue;
    try {
      const u = new URL(w);
      if (!u.hostname) continue;
      urls.add(u.href.split("#")[0]);
    } catch {
      continue;
    }
  }
  if (!urls.size) return null;
  return [...urls].sort()[0];
}

function domainForClearbit(urlString) {
  try {
    const u = new URL(urlString);
    return u.hostname.replace(/^www\./i, "") || null;
  } catch {
    return null;
  }
}

function inferCategoriesFromKinds(kinds, nameLower) {
  const out = new Set();
  const footwearish = /foot|shoe|sneaker|boot|sandal|trainer|sb\b/;
  const capish = /\bcap\b|hat\b|headwear|beanie|snapback/;
  const dressish = /\bdress\b|gown\b/;
  const eyewearish = /optic|eyewear|sunglass|glass(es)?\b|spectacle|vision\b|lens\b/;
  const shoeWords = /foot|shoe|sneaker|boot|sandal|trainer|stride/i;

  for (const k of kinds) {
    if (k === "footwear_industry") out.add("shoes");
    if (k === "optics_industry") out.add("sunglasses");
    if (
      k === "clothing_industry" ||
      k === "fashion_label" ||
      k === "clothing_store_chain" ||
      k === "textile_industry" ||
      k === "retail_chain_keywords" ||
      k === "department_store_keywords" ||
      k === "business_fashion_keywords" ||
      k === "p452_subclass_clothing_industry" ||
      k === "p452_subclass_footwear_industry" ||
      k === "jewelry_industry" ||
      k === "hat_industry" ||
      k === "company_fashion_keywords" ||
      k === "department_store_chain" ||
      k === "online_shop_fashion_keywords" ||
      k === "luxury_goods_industry_keywords" ||
      k === "public_company_fashion_keywords" ||
      k === "company_loose_fashion_keywords"
    ) {
      out.add("clothing");
    }
    if (k === "sporting_goods_industry") {
      out.add("clothing");
      if (shoeWords.test(nameLower)) out.add("shoes");
    }
  }

  if (footwearish.test(nameLower)) out.add("shoes");
  if (capish.test(nameLower)) out.add("cap");
  if (dressish.test(nameLower)) out.add("dress");
  if (eyewearish.test(nameLower)) out.add("sunglasses");

  const filtered = [...out].filter((c) => CATEGORY_POOL.includes(c));
  if (!filtered.length) filtered.push("clothing");
  return [...new Set(filtered)].sort();
}

function dedupeKey(name, website) {
  return `${String(name).toLowerCase()}|${String(website).toLowerCase()}`;
}

async function runSparql(query) {
  const res = await axios.post(SPARQL_ENDPOINT, new URLSearchParams({ query }), {
    headers: {
      Accept: "application/sparql-results+json",
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": "clothing-brand-dataset-generator/1.0",
    },
    timeout: 240000,
    validateStatus: (s) => s >= 200 && s < 600,
  });
  if (res.status >= 400) {
    const err = new Error(`SPARQL HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return res.data;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchWithRetries(query) {
  let lastErr;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt += 1) {
    try {
      return await runSparql(query);
    } catch (err) {
      lastErr = err;
      const status = err.response?.status ?? err.status;
      const retryable = status === 429 || status === 504 || status === 502 || status === 503;
      if (!retryable && err.code !== "ECONNABORTED") throw err;
      const wait = Math.min(30000, 2000 * 2 ** attempt);
      console.warn(`SPARQL retry ${attempt + 1}/${MAX_RETRIES} (${status || err.message}), waiting ${wait}ms`);
      await sleep(wait);
    }
  }
  throw lastErr;
}

async function main() {
  /** @type {Map<string, { rows: any[], kinds: Set<string>, countryQid: string }>} */
  const accum = new Map();
  let sparqlRequests = 0;

  console.log(
    "Fetching brands from Wikidata (per-country SPARQL — scalable paging). Press Ctrl+C to stop early.",
  );

  outer: for (const tmpl of QUERY_TEMPLATES) {
    for (const countryQid of COUNTRY_QIDS) {
      let offset = 0;
      let batches = 0;
      while (batches < MAX_BATCHES_PER_COUNTRY_CRITERION) {
        batches += 1;
        if (sparqlRequests >= MAX_TOTAL_SPARQL_REQUESTS) {
          console.warn(`Stopping: reached SPARQL request cap (${MAX_TOTAL_SPARQL_REQUESTS}).`);
          break outer;
        }
        sparqlRequests += 1;
        const query = buildQuery(tmpl, countryQid, offset, BATCH_SIZE);
        let data;
        try {
          data = await fetchWithRetries(query);
        } catch (err) {
          console.error(`Stopped ${tmpl.kind} / ${countryQid} @${offset}:`, err.message || err);
          break;
        }

        const bindings = data?.results?.bindings ?? [];
        if (!bindings.length) break;

        for (const b of bindings) {
          const uri = b.item?.value;
          if (!uri) continue;
          if (!accum.has(uri)) accum.set(uri, { rows: [], kinds: new Set(), countryQid });
          const slot = accum.get(uri);
          slot.rows.push(b);
          slot.kinds.add(tmpl.kind);
          slot.countryQid = countryQid;
        }

        offset += BATCH_SIZE;
        if (bindings.length < BATCH_SIZE) break;

        await sleep(REQUEST_GAP_MS);
      }
    }
  }

  const brands = [];
  const globalDedupe = new Set();

  for (const [, slot] of accum) {
    const rows = slot.rows;
    const name = pickPreferredLabel(rows);
    const country = COUNTRY_BY_QID[slot.countryQid];
    const website = pickOfficialWebsite(rows);

    if (!name || !website || !country) continue;

    const key = dedupeKey(name, website);
    if (globalDedupe.has(key)) continue;

    const categories = inferCategoriesFromKinds([...slot.kinds], name.toLowerCase());
    const domain = domainForClearbit(website);
    if (!domain) continue;

    globalDedupe.add(key);
    brands.push({
      name,
      logo: `https://logo.clearbit.com/${domain}`,
      country,
      website,
      categories,
    });
  }

  brands.sort((a, b) => a.country.localeCompare(b.country) || a.name.localeCompare(b.name));

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(brands, null, 2), "utf8");

  console.log(`SPARQL requests executed: ${sparqlRequests}`);
  console.log(`Unique Wikidata entities collected (before output dedupe): ${accum.size}`);
  console.log(`Saved ${brands.length} records to ${OUTPUT_FILE}`);

  if (brands.length < TARGET_COUNT) {
    console.warn(
      `Warning: only ${brands.length} valid records (target was ${TARGET_COUNT}). Dataset saved with available rows.`,
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
