import React, { useState, useEffect, useRef } from 'react';
import './App.css';

const DATA_URL = "clothing_brands_4000.json";
const PAGE_SIZE = 20;

const KNOWN_COUNTRIES = [
  "USA",
  "Canada",
  "Germany",
  "Netherlands",
  "UK",
  "Denmark",
  "Portugal",
  "Spain",
  "Hungary",
  "France",
  "Italy",
  "UAE/Dubai",
  "Thailand",
  "Hong Kong",
  "Vietnam",
  "Singapore",
];

function App() {
  const [allBrands, setAllBrands] = useState(null);
  const [filtered, setFiltered] = useState([]);
  const [loadedCount, setLoadedCount] = useState(0);
  const [loadingFile, setLoadingFile] = useState(false);
  const [loadingChunk, setLoadingChunk] = useState(false);
  const [status, setStatus] = useState('');
  const [isError, setIsError] = useState(false);
  const [query, setQuery] = useState('');
  const [catalogTotal, setCatalogTotal] = useState('…');
  const [isLoadingCatalog, setIsLoadingCatalog] = useState(true);
  const [showResults, setShowResults] = useState(false);
  const [emptyMessage, setEmptyMessage] = useState('');
  const [isSearching, setIsSearching] = useState(false);

  const sentinelRef = useRef(null);
  const gridRef = useRef(null);

  useEffect(() => {
    loadJsonOnce();
  }, []);

  useEffect(() => {
    if (allBrands) {
      setCatalogTotal(allBrands.length.toLocaleString());
      setIsLoadingCatalog(false);
    }
  }, [allBrands]);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting && filtered.length > 0 && !loadingChunk) {
            loadNextChunk();
          }
        });
      },
      { root: null, rootMargin: '240px', threshold: 0 }
    );

    if (sentinelRef.current) {
      observer.observe(sentinelRef.current);
    }

    return () => {
      if (sentinelRef.current) {
        observer.unobserve(sentinelRef.current);
      }
    };
  }, [filtered, loadedCount, loadingChunk]);

  const loadJsonOnce = async () => {
    if (allBrands !== null) return;
    if (loadingFile) return;
    setLoadingFile(true);
    try {
      const res = await fetch(DATA_URL);
      if (!res.ok) throw new Error(`Could not load ${DATA_URL} (${res.status})`);
      const data = await res.json();
      setAllBrands(Array.isArray(data) ? data : []);
    } catch (err) {
      setStatus(err.message || "Failed to load JSON. Serve this folder over HTTP so clothing_brands_4000.json can be fetched.");
      setIsError(true);
      setCatalogTotal('?');
      setIsLoadingCatalog(true);
    } finally {
      setLoadingFile(false);
    }
  };

  const applyFilter = (q) => {
    if (!q.trim()) {
      setFiltered([]);
      return [];
    }
    const filteredBrands = allBrands.filter(b =>
      (b.country || '').toLowerCase().includes(q.toLowerCase())
    );
    setFiltered(filteredBrands);
    return filteredBrands;
  };

  const loadNextChunk = (start = loadedCount) => {
    if (loadingChunk || start >= filtered.length) return;
    setLoadingChunk(true);
    const next = filtered.slice(start, start + PAGE_SIZE);
    setLoadedCount(prev => prev + next.length);
    setLoadingChunk(false);

    const catalogHint = ` · ${allBrands ? allBrands.length.toLocaleString() : '—'} in full catalog`;
    const totalShown = start + next.length;
    if (totalShown >= filtered.length) {
      setStatus(`Showing all ${filtered.length.toLocaleString()} brand(s) for this search${catalogHint}.`);
      setIsError(false);
    } else {
      setStatus(`Showing ${totalShown.toLocaleString()} of ${filtered.length.toLocaleString()} — scroll for more${catalogHint}.`);
      setIsError(false);
    }
  };

  const performSearch = async (q) => {
    if (loadingFile || isSearching) return;

    const normalizedQuery = q.trim();
    setIsSearching(true);
    setStatus(normalizedQuery ? `Searching for "${normalizedQuery}"…` : 'Searching catalog…');
    setIsError(false);
    setShowResults(true);

    try {
      await loadJsonOnce();
      const filteredBrands = applyFilter(q);
      setLoadedCount(0);
      setShowResults(true);
      setEmptyMessage('');

      if (filteredBrands.length === 0) {
        setShowResults(false);
        setEmptyMessage(normalizedQuery === '' ? 'Enter a country to search.' : `No brands found for "${normalizedQuery}". Try another country.`);
        setStatus(allBrands && allBrands.length ? `No matches. Catalog has ${allBrands.length.toLocaleString()} brands total.` : '');
        setIsError(false);
        return;
      }

      loadNextChunk(0);
    } catch (err) {
      console.error(err);
      setStatus(err.message || "Failed to load JSON. Serve this folder over HTTP so clothing_brands_4000.json can be fetched.");
      setIsError(true);
      setShowResults(false);
      setEmptyMessage('');
    } finally {
      setIsSearching(false);
    }
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    performSearch(query);
  };

  const handleSuggestionClick = (country) => {
    setQuery(country);
    performSearch(country);
  };

  const renderCard = (b) => {
    const initials = (b.name || '?').trim().slice(0, 2).toUpperCase();
    return (
      <article key={b.name} className="card">
        <div className="card-top">
          <div className="logo-wrap">
            {b.logo ? (
              <img
                src={b.logo}
                alt=""
                loading="lazy"
                decoding="async"
                onError={(e) => {
                  e.target.style.display = 'none';
                  e.target.nextSibling.style.display = 'block';
                }}
              />
            ) : null}
            <span className="logo-fallback" style={{ display: b.logo ? 'none' : 'block' }}>
              {initials}
            </span>
          </div>
          <div>
            <h2 className="card-title">{b.name || 'Unknown'}</h2>
          </div>
        </div>
        <span className="badge">{b.country || '—'}</span>
        <div className="card-meta">
          {b.website ? (
            <a href={b.website} target="_blank" rel="noopener noreferrer">
              {b.website.replace(/^https?:\/\//i, '')}
            </a>
          ) : (
            'No website'
          )}
        </div>
        {b.categories && b.categories.length > 0 && (
          <div className="tags">
            {b.categories.map((c, i) => (
              <span key={i} className="tag">{c}</span>
            ))}
          </div>
        )}
      </article>
    );
  };

  const displayedBrands = filtered.slice(0, loadedCount);

  return (
    <div className="wrap">
      <header>
        <h1>Clothing brands</h1>
        <p>Search by country — cards appear after you search. Catalog loads in the background for totals.</p>
      </header>

      <p className={`catalog-total ${isLoadingCatalog ? 'is-loading' : ''}`} aria-live="polite">
        <strong>{catalogTotal}</strong>
        <span> brands in catalog</span>
      </p>

      <section className="search-panel" aria-label="Country search">
        <form className="search-row" onSubmit={handleSubmit} autoComplete="off">
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Type a country (e.g. USA, France, UK, UAE/Dubai…)"
            list="countries"
            aria-label="Country name"
          />
          <datalist id="countries">
            {KNOWN_COUNTRIES.map(c => <option key={c} value={c} />)}
          </datalist>
          <button type="submit" disabled={loadingFile || isSearching}>
            {isSearching ? <><span className="spinner" aria-hidden="true" /> Searching…</> : 'Search'}
          </button>
        </form>

        <div className="search-suggestions" aria-label="Quick country searches">
          {KNOWN_COUNTRIES.slice(0, 8).map(c => (
            <button
              key={c}
              type="button"
              className="suggestion-pill"
              onClick={() => handleSuggestionClick(c)}
              disabled={isSearching}
            >
              {c}
            </button>
          ))}
        </div>

        <p className="hint">Matches brands whose country label contains your text (case-insensitive). Click a suggested country to search instantly.</p>
      </section>

      <div className={`status ${isError ? 'error' : ''}`} aria-live="polite">{status}</div>

      {showResults && (
        <section id="results-section">
          <div className="grid" ref={gridRef}>
            {displayedBrands.map(renderCard)}
          </div>
          <div ref={sentinelRef} aria-hidden="true"></div>
        </section>
      )}

      {emptyMessage && <div className="empty">{emptyMessage}</div>}
    </div>
  );
}

export default App;