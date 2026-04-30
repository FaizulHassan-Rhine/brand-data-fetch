# Clothing brand dataset generator

Builds `clothing_brands_4000.json` from **Wikidata** (real brands, official websites, countries) and formats **Clearbit** logo URLs from each site’s domain.

## Setup

```bash
npm install axios
```

## Run

```bash
node build_clothing_brands.js
```

## Output

After a successful run:

```bash
clothing_brands_4000.json
```

The script logs how many SPARQL requests ran, how many Wikidata entities were merged, and how many records were written. Reaching exactly **4000** rows depends on Wikidata coverage for the allowed countries plus websites (`P856`) and fashion-related predicates; if fewer valid brands exist, every valid row is still saved and a warning is printed.

## Notes

- Uses the Wikidata SPARQL endpoint (`https://query.wikidata.org/sparql`) with `User-Agent: clothing-brand-dataset-generator/1.0`.
- Logo URLs follow `https://logo.clearbit.com/<domain>` even when Clearbit has no image for that domain.
- No fabricated brands; only data returned by Wikidata for fashion/clothing-related entities in the allowed countries.
