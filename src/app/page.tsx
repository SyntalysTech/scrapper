'use client';

import { useState } from 'react';

interface BusinessResult {
  name: string;
  owner?: string;
  email?: string;
  emailVerified: boolean;
  phone?: string;
  phoneVerified: boolean;
  website?: string;
  websiteStatus?: number;
  address?: string;
  source: string;
  scrapedAt: string;
}

interface ScrapeResponse {
  success: boolean;
  query: string;
  location: string;
  totalFound: number;
  results: BusinessResult[];
  scrapedAt: string;
}

export default function Home() {
  const [query, setQuery] = useState('');
  const [location, setLocation] = useState('');
  const [maxResults, setMaxResults] = useState(20);
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<ScrapeResponse | null>(null);
  const [error, setError] = useState('');

  const handleScrape = async () => {
    if (!query.trim() || !location.trim()) {
      setError('Introduce el nicho y la ubicación');
      return;
    }

    setLoading(true);
    setError('');
    setResults(null);

    try {
      const response = await fetch('/api/scrape', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: query.trim(),
          location: location.trim(),
          maxResults,
          verifyContacts: true,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Error en el scraping');
      }

      setResults(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error desconocido');
    } finally {
      setLoading(false);
    }
  };

  const downloadJSON = () => {
    if (!results) return;

    const dataStr = JSON.stringify(results, null, 2);
    const blob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${results.query}-${results.location}-${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
  };

  return (
    <div className="min-h-screen bg-neutral-50">
      <div className="max-w-6xl mx-auto px-6 py-12">
        {/* Header */}
        <header className="mb-16">
          <h1 className="text-3xl font-semibold text-neutral-900 tracking-tight">
            Syntalys Scraper
          </h1>
          <p className="mt-2 text-neutral-500">
            Encuentra contactos públicos de negocios
          </p>
        </header>

        {/* Search Form */}
        <div className="mb-12">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="md:col-span-1">
              <label className="block text-sm font-medium text-neutral-700 mb-1.5">
                Nicho
              </label>
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="veterinarios, restaurantes..."
                className="w-full px-3 py-2 bg-white border border-neutral-200 rounded-lg text-neutral-900 placeholder-neutral-400 focus:outline-none focus:ring-2 focus:ring-neutral-900 focus:border-transparent transition-shadow"
              />
            </div>
            <div className="md:col-span-1">
              <label className="block text-sm font-medium text-neutral-700 mb-1.5">
                Ubicación
              </label>
              <input
                type="text"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                placeholder="Madrid, Barcelona..."
                className="w-full px-3 py-2 bg-white border border-neutral-200 rounded-lg text-neutral-900 placeholder-neutral-400 focus:outline-none focus:ring-2 focus:ring-neutral-900 focus:border-transparent transition-shadow"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-neutral-700 mb-1.5">
                Resultados
              </label>
              <select
                value={maxResults}
                onChange={(e) => setMaxResults(Number(e.target.value))}
                className="w-full px-3 py-2 bg-white border border-neutral-200 rounded-lg text-neutral-900 focus:outline-none focus:ring-2 focus:ring-neutral-900 focus:border-transparent transition-shadow"
              >
                <option value={10}>10</option>
                <option value={20}>20</option>
                <option value={50}>50</option>
                <option value={100}>100</option>
              </select>
            </div>
            <div className="flex items-end">
              <button
                onClick={handleScrape}
                disabled={loading}
                className="w-full px-4 py-2 bg-neutral-900 hover:bg-neutral-800 text-white font-medium rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loading ? 'Buscando...' : 'Buscar'}
              </button>
            </div>
          </div>

          {error && (
            <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-600 text-sm">
              {error}
            </div>
          )}
        </div>

        {/* Loading State */}
        {loading && (
          <div className="flex items-center justify-center py-16">
            <div className="flex items-center gap-3 text-neutral-500">
              <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" fill="none" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
              <span>Escaneando fuentes...</span>
            </div>
          </div>
        )}

        {/* Results */}
        {results && (
          <div>
            {/* Stats Bar */}
            <div className="flex items-center justify-between mb-6 pb-6 border-b border-neutral-200">
              <div className="flex items-center gap-4">
                <span className="text-sm text-neutral-500">
                  {results.totalFound} resultados para <span className="font-medium text-neutral-900">{results.query}</span> en <span className="font-medium text-neutral-900">{results.location}</span>
                </span>
              </div>
              <button
                onClick={downloadJSON}
                className="flex items-center gap-2 px-3 py-1.5 text-sm text-neutral-600 hover:text-neutral-900 border border-neutral-200 hover:border-neutral-300 rounded-lg transition-colors"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                </svg>
                Exportar JSON
              </button>
            </div>

            {/* Results Table */}
            {results.results.length > 0 ? (
              <div className="overflow-hidden border border-neutral-200 rounded-lg">
                <table className="w-full">
                  <thead>
                    <tr className="bg-neutral-50 border-b border-neutral-200">
                      <th className="text-left text-xs font-medium text-neutral-500 uppercase tracking-wider px-4 py-3">Negocio</th>
                      <th className="text-left text-xs font-medium text-neutral-500 uppercase tracking-wider px-4 py-3">Email</th>
                      <th className="text-left text-xs font-medium text-neutral-500 uppercase tracking-wider px-4 py-3">Teléfono</th>
                      <th className="text-left text-xs font-medium text-neutral-500 uppercase tracking-wider px-4 py-3">Web</th>
                      <th className="text-left text-xs font-medium text-neutral-500 uppercase tracking-wider px-4 py-3">Fuente</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-neutral-100">
                    {results.results.map((business, index) => (
                      <tr key={index} className="hover:bg-neutral-50 transition-colors">
                        <td className="px-4 py-3">
                          <div>
                            <div className="font-medium text-neutral-900 text-sm">{business.name}</div>
                            {business.owner && (
                              <div className="text-xs text-neutral-500 mt-0.5">{business.owner}</div>
                            )}
                            {business.address && (
                              <div className="text-xs text-neutral-400 mt-0.5 max-w-xs truncate">{business.address}</div>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          {business.email ? (
                            <div className="flex items-center gap-2 group">
                              <span className="text-sm text-neutral-700">{business.email}</span>
                              {business.emailVerified && (
                                <span className="text-xs text-green-600">✓</span>
                              )}
                              <button
                                onClick={() => copyToClipboard(business.email!)}
                                className="opacity-0 group-hover:opacity-100 p-1 hover:bg-neutral-100 rounded transition-all"
                                title="Copiar"
                              >
                                <svg className="w-3.5 h-3.5 text-neutral-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                                </svg>
                              </button>
                            </div>
                          ) : (
                            <span className="text-sm text-neutral-300">—</span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          {business.phone ? (
                            <div className="flex items-center gap-2 group">
                              <span className="text-sm text-neutral-700 whitespace-nowrap">{business.phone}</span>
                              <button
                                onClick={() => copyToClipboard(business.phone!)}
                                className="opacity-0 group-hover:opacity-100 p-1 hover:bg-neutral-100 rounded transition-all"
                                title="Copiar"
                              >
                                <svg className="w-3.5 h-3.5 text-neutral-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                                </svg>
                              </button>
                            </div>
                          ) : (
                            <span className="text-sm text-neutral-300">—</span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          {business.website ? (
                            <a
                              href={business.website}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-sm text-neutral-600 hover:text-neutral-900 hover:underline"
                            >
                              {business.website.replace(/^https?:\/\//, '').split('/')[0]}
                            </a>
                          ) : (
                            <span className="text-sm text-neutral-300">—</span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <span className="text-xs text-neutral-400">{business.source}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="text-center py-16">
                <p className="text-neutral-500">No se encontraron contactos verificados</p>
                <p className="text-neutral-400 text-sm mt-1">Prueba con otro nicho o ubicación</p>
              </div>
            )}
          </div>
        )}

        {/* Footer */}
        <footer className="mt-16 pt-8 border-t border-neutral-200">
          <p className="text-xs text-neutral-400">
            Solo datos públicos. Cumple con GDPR.
          </p>
        </footer>
      </div>
    </div>
  );
}
