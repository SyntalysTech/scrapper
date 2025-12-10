'use client';

import { useState, useEffect } from 'react';
import BrowserSimulator from '@/components/BrowserSimulator';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

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

interface ContactedBusiness extends BusinessResult {
  contactedAt: string;
  contactMethod: 'email' | 'phone' | 'both';
  notes?: string;
}

interface ScrapeResponse {
  success: boolean;
  query: string;
  location: string;
  totalFound: number;
  results: BusinessResult[];
  scrapedAt: string;
}

type FilterType = 'all' | 'with_email' | 'with_phone' | 'contacted' | 'not_contacted';
type ViewMode = 'table' | 'cards';

export default function Home() {
  const [query, setQuery] = useState('');
  const [location, setLocation] = useState('');
  const [maxResults, setMaxResults] = useState(20);
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<ScrapeResponse | null>(null);
  const [error, setError] = useState('');
  const [contacted, setContacted] = useState<Set<string>>(new Set());
  const [contactedData, setContactedData] = useState<Map<string, ContactedBusiness>>(new Map());
  const [filter, setFilter] = useState<FilterType>('all');
  const [viewMode, setViewMode] = useState<ViewMode>('table');
  const [copiedItem, setCopiedItem] = useState<string | null>(null);
  const [searchInResults, setSearchInResults] = useState('');
  const [showExportMenu, setShowExportMenu] = useState(false);
  const [selectedRows, setSelectedRows] = useState<Set<string>>(new Set());
  const [selectAll, setSelectAll] = useState(false);

  // Load contacted from localStorage
  useEffect(() => {
    const saved = localStorage.getItem('contactedBusinesses');
    if (saved) {
      const data = JSON.parse(saved);
      setContacted(new Set(data.ids || []));
      setContactedData(new Map(data.details || []));
    }
  }, []);

  // Save contacted to localStorage
  useEffect(() => {
    localStorage.setItem('contactedBusinesses', JSON.stringify({
      ids: Array.from(contacted),
      details: Array.from(contactedData.entries())
    }));
  }, [contacted, contactedData]);

  const getBusinessKey = (business: BusinessResult) => {
    return `${business.name}-${business.email || ''}-${business.phone || ''}`;
  };

  const handleScrape = async () => {
    if (!query.trim() || !location.trim()) {
      setError('Introduce el nicho y la ubicación');
      return;
    }

    setLoading(true);
    setError('');
    setResults(null);
    setSelectedRows(new Set());
    setSelectAll(false);

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

  const markAsContacted = (business: BusinessResult, method: 'email' | 'phone') => {
    const key = getBusinessKey(business);
    const newContacted = new Set(contacted);
    newContacted.add(key);
    setContacted(newContacted);

    const existingData = contactedData.get(key);
    const newContactedData = new Map(contactedData);
    newContactedData.set(key, {
      ...business,
      contactedAt: new Date().toISOString(),
      contactMethod: existingData?.contactMethod === 'email' && method === 'phone' ? 'both' :
                     existingData?.contactMethod === 'phone' && method === 'email' ? 'both' : method,
    });
    setContactedData(newContactedData);
  };

  const copyToClipboard = (text: string, business: BusinessResult, type: 'email' | 'phone') => {
    navigator.clipboard.writeText(text);
    setCopiedItem(text);
    setTimeout(() => setCopiedItem(null), 2000);
    markAsContacted(business, type);
  };

  const toggleRowSelection = (business: BusinessResult) => {
    const key = getBusinessKey(business);
    const newSelected = new Set(selectedRows);
    if (newSelected.has(key)) {
      newSelected.delete(key);
    } else {
      newSelected.add(key);
    }
    setSelectedRows(newSelected);
  };

  const toggleSelectAll = () => {
    if (selectAll) {
      setSelectedRows(new Set());
    } else {
      const allKeys = filteredResults.map(b => getBusinessKey(b));
      setSelectedRows(new Set(allKeys));
    }
    setSelectAll(!selectAll);
  };

  const markSelectedAsContacted = () => {
    if (!results) return;

    results.results.forEach(business => {
      const key = getBusinessKey(business);
      if (selectedRows.has(key)) {
        markAsContacted(business, business.email ? 'email' : 'phone');
      }
    });
  };

  const getFilteredResults = () => {
    if (!results) return [];

    let filtered = results.results;

    // Apply filter
    switch (filter) {
      case 'with_email':
        filtered = filtered.filter(b => b.email);
        break;
      case 'with_phone':
        filtered = filtered.filter(b => b.phone);
        break;
      case 'contacted':
        filtered = filtered.filter(b => contacted.has(getBusinessKey(b)));
        break;
      case 'not_contacted':
        filtered = filtered.filter(b => !contacted.has(getBusinessKey(b)));
        break;
    }

    // Apply search
    if (searchInResults) {
      const search = searchInResults.toLowerCase();
      filtered = filtered.filter(b =>
        b.name.toLowerCase().includes(search) ||
        b.email?.toLowerCase().includes(search) ||
        b.phone?.includes(search) ||
        b.owner?.toLowerCase().includes(search)
      );
    }

    return filtered;
  };

  const filteredResults = getFilteredResults();

  const stats = {
    total: results?.results.length || 0,
    withEmail: results?.results.filter(b => b.email).length || 0,
    withPhone: results?.results.filter(b => b.phone).length || 0,
    contacted: results?.results.filter(b => contacted.has(getBusinessKey(b))).length || 0,
  };

  const downloadJSON = (onlyContacted: boolean = false) => {
    if (!results) return;

    const dataToExport = onlyContacted
      ? results.results.filter(b => contacted.has(getBusinessKey(b)))
      : results.results;

    const exportData = {
      ...results,
      results: dataToExport,
      totalFound: dataToExport.length,
      exportedAt: new Date().toISOString(),
      onlyContacted,
    };

    const dataStr = JSON.stringify(exportData, null, 2);
    const blob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${results.query}-${results.location}${onlyContacted ? '-contactados' : ''}-${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    setShowExportMenu(false);
  };

  const downloadPDF = (onlyContacted: boolean = false) => {
    if (!results) return;

    const dataToExport = onlyContacted
      ? results.results.filter(b => contacted.has(getBusinessKey(b)))
      : results.results;

    const doc = new jsPDF();

    // Header
    doc.setFontSize(20);
    doc.setTextColor(23, 23, 23);
    doc.text('Syntalys Scraper', 14, 22);

    doc.setFontSize(12);
    doc.setTextColor(115, 115, 115);
    doc.text(`${results.query} en ${results.location}`, 14, 30);
    doc.text(`${dataToExport.length} ${onlyContacted ? 'contactados' : 'resultados'} · ${new Date().toLocaleDateString('es-ES')}`, 14, 36);

    // Table
    const tableData = dataToExport.map(b => [
      b.name.substring(0, 30),
      b.owner || '-',
      b.email || '-',
      b.phone || '-',
      b.website?.replace(/^https?:\/\//, '').split('/')[0] || '-',
      contacted.has(getBusinessKey(b)) ? '✓' : '-'
    ]);

    autoTable(doc, {
      startY: 45,
      head: [['Negocio', 'Propietario', 'Email', 'Teléfono', 'Web', 'Contactado']],
      body: tableData,
      styles: {
        fontSize: 8,
        cellPadding: 3,
      },
      headStyles: {
        fillColor: [23, 23, 23],
        textColor: [255, 255, 255],
        fontStyle: 'bold',
      },
      alternateRowStyles: {
        fillColor: [250, 250, 250],
      },
      columnStyles: {
        0: { cellWidth: 35 },
        1: { cellWidth: 25 },
        2: { cellWidth: 45 },
        3: { cellWidth: 28 },
        4: { cellWidth: 35 },
        5: { cellWidth: 15 },
      },
    });

    // Footer
    const pageCount = doc.getNumberOfPages();
    for (let i = 1; i <= pageCount; i++) {
      doc.setPage(i);
      doc.setFontSize(8);
      doc.setTextColor(150, 150, 150);
      doc.text(
        `Generado por Syntalys Scraper · Página ${i} de ${pageCount}`,
        doc.internal.pageSize.getWidth() / 2,
        doc.internal.pageSize.getHeight() - 10,
        { align: 'center' }
      );
    }

    doc.save(`${results.query}-${results.location}${onlyContacted ? '-contactados' : ''}-${new Date().toISOString().split('T')[0]}.pdf`);
    setShowExportMenu(false);
  };

  const downloadSelected = (format: 'json' | 'pdf') => {
    if (!results) return;

    const selectedData = results.results.filter(b => selectedRows.has(getBusinessKey(b)));

    if (format === 'json') {
      const exportData = {
        ...results,
        results: selectedData,
        totalFound: selectedData.length,
        exportedAt: new Date().toISOString(),
        selectedExport: true,
      };

      const dataStr = JSON.stringify(exportData, null, 2);
      const blob = new Blob([dataStr], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${results.query}-${results.location}-seleccionados-${new Date().toISOString().split('T')[0]}.json`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } else {
      const doc = new jsPDF();

      doc.setFontSize(20);
      doc.setTextColor(23, 23, 23);
      doc.text('Syntalys Scraper', 14, 22);

      doc.setFontSize(12);
      doc.setTextColor(115, 115, 115);
      doc.text(`${results.query} en ${results.location}`, 14, 30);
      doc.text(`${selectedData.length} seleccionados · ${new Date().toLocaleDateString('es-ES')}`, 14, 36);

      const tableData = selectedData.map(b => [
        b.name.substring(0, 30),
        b.owner || '-',
        b.email || '-',
        b.phone || '-',
        b.website?.replace(/^https?:\/\//, '').split('/')[0] || '-',
      ]);

      autoTable(doc, {
        startY: 45,
        head: [['Negocio', 'Propietario', 'Email', 'Teléfono', 'Web']],
        body: tableData,
        styles: { fontSize: 8, cellPadding: 3 },
        headStyles: { fillColor: [23, 23, 23], textColor: [255, 255, 255], fontStyle: 'bold' },
        alternateRowStyles: { fillColor: [250, 250, 250] },
      });

      doc.save(`${results.query}-${results.location}-seleccionados-${new Date().toISOString().split('T')[0]}.pdf`);
    }
    setShowExportMenu(false);
  };

  const clearContacted = () => {
    if (confirm('¿Borrar todos los contactados guardados?')) {
      setContacted(new Set());
      setContactedData(new Map());
    }
  };

  return (
    <div className="min-h-screen bg-neutral-50">
      <div className="max-w-7xl mx-auto px-6 py-12">
        {/* Header */}
        <header className="mb-12">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold text-neutral-900 tracking-tight">
                Syntalys Scraper
              </h1>
              <p className="mt-1 text-neutral-500">
                Encuentra contactos públicos de negocios con IA
              </p>
            </div>
            {contacted.size > 0 && (
              <div className="flex items-center gap-3">
                <span className="text-sm text-neutral-500">
                  {contacted.size} contactados guardados
                </span>
                <button
                  onClick={clearContacted}
                  className="text-xs text-red-500 hover:text-red-600"
                >
                  Limpiar
                </button>
              </div>
            )}
          </div>
        </header>

        {/* Search Form */}
        <div className="mb-8 p-6 bg-white rounded-2xl border border-neutral-200 shadow-sm">
          <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-neutral-700 mb-1.5">
                Nicho de negocio
              </label>
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleScrape()}
                placeholder="veterinarios, restaurantes, gimnasios..."
                className="w-full px-4 py-2.5 bg-neutral-50 border border-neutral-200 rounded-xl text-neutral-900 placeholder-neutral-400 focus:outline-none focus:ring-2 focus:ring-neutral-900 focus:border-transparent focus:bg-white transition-all"
              />
            </div>
            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-neutral-700 mb-1.5">
                Ubicación
              </label>
              <input
                type="text"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleScrape()}
                placeholder="Madrid, Barcelona, Valencia..."
                className="w-full px-4 py-2.5 bg-neutral-50 border border-neutral-200 rounded-xl text-neutral-900 placeholder-neutral-400 focus:outline-none focus:ring-2 focus:ring-neutral-900 focus:border-transparent focus:bg-white transition-all"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-neutral-700 mb-1.5">
                Máx. resultados
              </label>
              <select
                value={maxResults}
                onChange={(e) => setMaxResults(Number(e.target.value))}
                className="w-full px-4 py-2.5 bg-neutral-50 border border-neutral-200 rounded-xl text-neutral-900 focus:outline-none focus:ring-2 focus:ring-neutral-900 focus:border-transparent focus:bg-white transition-all"
              >
                <option value={10}>10</option>
                <option value={20}>20</option>
                <option value={50}>50</option>
                <option value={100}>100</option>
              </select>
            </div>
          </div>

          <div className="mt-4 flex items-center gap-3">
            <button
              onClick={handleScrape}
              disabled={loading}
              className="px-6 py-2.5 bg-neutral-900 hover:bg-neutral-800 text-white font-medium rounded-xl transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
            >
              {loading ? (
                <>
                  <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" fill="none" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  Buscando...
                </>
              ) : (
                <>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                  </svg>
                  Buscar negocios
                </>
              )}
            </button>

            {results && (
              <span className="text-sm text-green-600 flex items-center gap-1">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                Powered by OpenAI
              </span>
            )}
          </div>

          {error && (
            <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-xl text-red-600 text-sm flex items-center gap-2">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              {error}
            </div>
          )}
        </div>

        {/* Browser Simulator - Loading State */}
        <BrowserSimulator
          query={query || 'negocios'}
          location={location || 'España'}
          isActive={loading}
        />

        {/* Results */}
        {results && (
          <div className="space-y-6">
            {/* Stats Cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="bg-white p-4 rounded-xl border border-neutral-200">
                <div className="text-2xl font-bold text-neutral-900">{stats.total}</div>
                <div className="text-sm text-neutral-500">Total encontrados</div>
              </div>
              <div className="bg-white p-4 rounded-xl border border-neutral-200">
                <div className="text-2xl font-bold text-blue-600">{stats.withEmail}</div>
                <div className="text-sm text-neutral-500">Con email</div>
              </div>
              <div className="bg-white p-4 rounded-xl border border-neutral-200">
                <div className="text-2xl font-bold text-green-600">{stats.withPhone}</div>
                <div className="text-sm text-neutral-500">Con teléfono</div>
              </div>
              <div className="bg-white p-4 rounded-xl border border-neutral-200">
                <div className="text-2xl font-bold text-purple-600">{stats.contacted}</div>
                <div className="text-sm text-neutral-500">Contactados</div>
              </div>
            </div>

            {/* Toolbar */}
            <div className="flex flex-wrap items-center justify-between gap-4 p-4 bg-white rounded-xl border border-neutral-200">
              <div className="flex items-center gap-3">
                {/* Search in results */}
                <div className="relative">
                  <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                  </svg>
                  <input
                    type="text"
                    value={searchInResults}
                    onChange={(e) => setSearchInResults(e.target.value)}
                    placeholder="Buscar en resultados..."
                    className="pl-9 pr-3 py-1.5 text-sm bg-neutral-50 border border-neutral-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-neutral-900 focus:bg-white w-48"
                  />
                </div>

                {/* Filters */}
                <div className="flex items-center gap-1 p-1 bg-neutral-100 rounded-lg">
                  {[
                    { value: 'all', label: 'Todos' },
                    { value: 'with_email', label: 'Email' },
                    { value: 'with_phone', label: 'Teléfono' },
                    { value: 'contacted', label: 'Contactados' },
                    { value: 'not_contacted', label: 'Sin contactar' },
                  ].map((f) => (
                    <button
                      key={f.value}
                      onClick={() => setFilter(f.value as FilterType)}
                      className={`px-3 py-1 text-xs font-medium rounded-md transition-all ${
                        filter === f.value
                          ? 'bg-white text-neutral-900 shadow-sm'
                          : 'text-neutral-600 hover:text-neutral-900'
                      }`}
                    >
                      {f.label}
                    </button>
                  ))}
                </div>

                {/* View Mode */}
                <div className="flex items-center gap-1 p-1 bg-neutral-100 rounded-lg">
                  <button
                    onClick={() => setViewMode('table')}
                    className={`p-1.5 rounded-md transition-all ${viewMode === 'table' ? 'bg-white shadow-sm' : 'text-neutral-500'}`}
                    title="Vista tabla"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 10h18M3 14h18m-9-4v8m-7 0h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                    </svg>
                  </button>
                  <button
                    onClick={() => setViewMode('cards')}
                    className={`p-1.5 rounded-md transition-all ${viewMode === 'cards' ? 'bg-white shadow-sm' : 'text-neutral-500'}`}
                    title="Vista tarjetas"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zm10 0a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zm10 0a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
                    </svg>
                  </button>
                </div>
              </div>

              <div className="flex items-center gap-2">
                {/* Selection actions */}
                {selectedRows.size > 0 && (
                  <div className="flex items-center gap-2 mr-2 pr-2 border-r border-neutral-200">
                    <span className="text-sm text-neutral-500">{selectedRows.size} seleccionados</span>
                    <button
                      onClick={markSelectedAsContacted}
                      className="text-xs px-2 py-1 bg-purple-100 text-purple-700 rounded-lg hover:bg-purple-200"
                    >
                      Marcar contactados
                    </button>
                    <button
                      onClick={() => downloadSelected('json')}
                      className="text-xs px-2 py-1 bg-blue-100 text-blue-700 rounded-lg hover:bg-blue-200"
                    >
                      JSON
                    </button>
                    <button
                      onClick={() => downloadSelected('pdf')}
                      className="text-xs px-2 py-1 bg-red-100 text-red-700 rounded-lg hover:bg-red-200"
                    >
                      PDF
                    </button>
                  </div>
                )}

                {/* Export Menu */}
                <div className="relative">
                  <button
                    onClick={() => setShowExportMenu(!showExportMenu)}
                    className="flex items-center gap-2 px-3 py-1.5 text-sm text-neutral-600 hover:text-neutral-900 border border-neutral-200 hover:border-neutral-300 rounded-lg transition-colors"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                    </svg>
                    Exportar
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>

                  {showExportMenu && (
                    <div className="absolute right-0 mt-2 w-56 bg-white rounded-xl shadow-lg border border-neutral-200 py-2 z-10">
                      <div className="px-3 py-1 text-xs font-medium text-neutral-400 uppercase">Todos los resultados</div>
                      <button
                        onClick={() => downloadJSON(false)}
                        className="w-full px-3 py-2 text-left text-sm text-neutral-700 hover:bg-neutral-50 flex items-center gap-2"
                      >
                        <span className="w-6 h-6 rounded bg-blue-100 text-blue-600 flex items-center justify-center text-xs font-bold">J</span>
                        Exportar JSON
                      </button>
                      <button
                        onClick={() => downloadPDF(false)}
                        className="w-full px-3 py-2 text-left text-sm text-neutral-700 hover:bg-neutral-50 flex items-center gap-2"
                      >
                        <span className="w-6 h-6 rounded bg-red-100 text-red-600 flex items-center justify-center text-xs font-bold">P</span>
                        Exportar PDF
                      </button>

                      <div className="my-2 border-t border-neutral-100" />

                      <div className="px-3 py-1 text-xs font-medium text-neutral-400 uppercase">Solo contactados ({stats.contacted})</div>
                      <button
                        onClick={() => downloadJSON(true)}
                        disabled={stats.contacted === 0}
                        className="w-full px-3 py-2 text-left text-sm text-neutral-700 hover:bg-neutral-50 flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        <span className="w-6 h-6 rounded bg-purple-100 text-purple-600 flex items-center justify-center text-xs font-bold">J</span>
                        Contactados JSON
                      </button>
                      <button
                        onClick={() => downloadPDF(true)}
                        disabled={stats.contacted === 0}
                        className="w-full px-3 py-2 text-left text-sm text-neutral-700 hover:bg-neutral-50 flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        <span className="w-6 h-6 rounded bg-purple-100 text-purple-600 flex items-center justify-center text-xs font-bold">P</span>
                        Contactados PDF
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Results Count */}
            <div className="text-sm text-neutral-500">
              Mostrando {filteredResults.length} de {results.results.length} resultados
            </div>

            {/* Table View */}
            {viewMode === 'table' && filteredResults.length > 0 && (
              <div className="overflow-hidden border border-neutral-200 rounded-xl bg-white">
                <table className="w-full">
                  <thead>
                    <tr className="bg-neutral-50 border-b border-neutral-200">
                      <th className="text-left px-4 py-3 w-10">
                        <input
                          type="checkbox"
                          checked={selectAll}
                          onChange={toggleSelectAll}
                          className="rounded border-neutral-300 text-neutral-900 focus:ring-neutral-900"
                        />
                      </th>
                      <th className="text-left text-xs font-semibold text-neutral-600 uppercase tracking-wider px-4 py-3">Negocio</th>
                      <th className="text-left text-xs font-semibold text-neutral-600 uppercase tracking-wider px-4 py-3">Email</th>
                      <th className="text-left text-xs font-semibold text-neutral-600 uppercase tracking-wider px-4 py-3">Teléfono</th>
                      <th className="text-left text-xs font-semibold text-neutral-600 uppercase tracking-wider px-4 py-3">Web</th>
                      <th className="text-left text-xs font-semibold text-neutral-600 uppercase tracking-wider px-4 py-3">Estado</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-neutral-100">
                    {filteredResults.map((business, index) => {
                      const key = getBusinessKey(business);
                      const isContacted = contacted.has(key);
                      const isSelected = selectedRows.has(key);

                      return (
                        <tr
                          key={index}
                          className={`transition-colors ${isContacted ? 'bg-purple-50/50' : 'hover:bg-neutral-50'} ${isSelected ? 'bg-blue-50' : ''}`}
                        >
                          <td className="px-4 py-3">
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={() => toggleRowSelection(business)}
                              className="rounded border-neutral-300 text-neutral-900 focus:ring-neutral-900"
                            />
                          </td>
                          <td className="px-4 py-3">
                            <div>
                              <div className="font-medium text-neutral-900 text-sm flex items-center gap-2">
                                {business.name}
                                {isContacted && (
                                  <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-purple-100 text-purple-700">
                                    ✓
                                  </span>
                                )}
                              </div>
                              {business.owner && (
                                <div className="text-xs text-neutral-500 mt-0.5 flex items-center gap-1">
                                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                                  </svg>
                                  {business.owner}
                                </div>
                              )}
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            {business.email ? (
                              <div className="flex items-center gap-2 group">
                                <span className="text-sm text-neutral-700 font-mono">{business.email}</span>
                                <button
                                  onClick={() => copyToClipboard(business.email!, business, 'email')}
                                  className={`p-1.5 rounded-lg transition-all ${
                                    copiedItem === business.email
                                      ? 'bg-green-100 text-green-600'
                                      : 'opacity-0 group-hover:opacity-100 hover:bg-neutral-100 text-neutral-400'
                                  }`}
                                  title={copiedItem === business.email ? 'Copiado!' : 'Copiar y marcar contactado'}
                                >
                                  {copiedItem === business.email ? (
                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                    </svg>
                                  ) : (
                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                                    </svg>
                                  )}
                                </button>
                              </div>
                            ) : (
                              <span className="text-sm text-neutral-300">—</span>
                            )}
                          </td>
                          <td className="px-4 py-3">
                            {business.phone ? (
                              <div className="flex items-center gap-2 group">
                                <span className="text-sm text-neutral-700 whitespace-nowrap font-mono">{business.phone}</span>
                                <button
                                  onClick={() => copyToClipboard(business.phone!, business, 'phone')}
                                  className={`p-1.5 rounded-lg transition-all ${
                                    copiedItem === business.phone
                                      ? 'bg-green-100 text-green-600'
                                      : 'opacity-0 group-hover:opacity-100 hover:bg-neutral-100 text-neutral-400'
                                  }`}
                                  title={copiedItem === business.phone ? 'Copiado!' : 'Copiar y marcar contactado'}
                                >
                                  {copiedItem === business.phone ? (
                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                    </svg>
                                  ) : (
                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                                    </svg>
                                  )}
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
                                className="text-sm text-blue-600 hover:text-blue-700 hover:underline flex items-center gap-1"
                              >
                                {business.website.replace(/^https?:\/\//, '').split('/')[0]}
                                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                                </svg>
                              </a>
                            ) : (
                              <span className="text-sm text-neutral-300">—</span>
                            )}
                          </td>
                          <td className="px-4 py-3">
                            <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${
                              isContacted
                                ? 'bg-purple-100 text-purple-700'
                                : 'bg-neutral-100 text-neutral-500'
                            }`}>
                              {isContacted ? 'Contactado' : 'Pendiente'}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {/* Cards View */}
            {viewMode === 'cards' && filteredResults.length > 0 && (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {filteredResults.map((business, index) => {
                  const key = getBusinessKey(business);
                  const isContacted = contacted.has(key);

                  return (
                    <div
                      key={index}
                      className={`p-4 rounded-xl border transition-all ${
                        isContacted
                          ? 'bg-purple-50 border-purple-200'
                          : 'bg-white border-neutral-200 hover:border-neutral-300'
                      }`}
                    >
                      <div className="flex items-start justify-between mb-3">
                        <div>
                          <h3 className="font-semibold text-neutral-900">{business.name}</h3>
                          {business.owner && (
                            <p className="text-sm text-neutral-500 flex items-center gap-1 mt-0.5">
                              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                              </svg>
                              {business.owner}
                            </p>
                          )}
                        </div>
                        {isContacted && (
                          <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-purple-200 text-purple-800">
                            ✓ Contactado
                          </span>
                        )}
                      </div>

                      <div className="space-y-2">
                        {business.email && (
                          <div
                            onClick={() => copyToClipboard(business.email!, business, 'email')}
                            className="flex items-center gap-2 p-2 bg-neutral-50 hover:bg-neutral-100 rounded-lg cursor-pointer group transition-colors"
                          >
                            <svg className="w-4 h-4 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                            </svg>
                            <span className="text-sm text-neutral-700 font-mono flex-1 truncate">{business.email}</span>
                            <svg className="w-4 h-4 text-neutral-400 opacity-0 group-hover:opacity-100" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                            </svg>
                          </div>
                        )}

                        {business.phone && (
                          <div
                            onClick={() => copyToClipboard(business.phone!, business, 'phone')}
                            className="flex items-center gap-2 p-2 bg-neutral-50 hover:bg-neutral-100 rounded-lg cursor-pointer group transition-colors"
                          >
                            <svg className="w-4 h-4 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
                            </svg>
                            <span className="text-sm text-neutral-700 font-mono flex-1">{business.phone}</span>
                            <svg className="w-4 h-4 text-neutral-400 opacity-0 group-hover:opacity-100" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                            </svg>
                          </div>
                        )}

                        {business.website && (
                          <a
                            href={business.website}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center gap-2 p-2 bg-neutral-50 hover:bg-neutral-100 rounded-lg transition-colors"
                          >
                            <svg className="w-4 h-4 text-purple-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" />
                            </svg>
                            <span className="text-sm text-blue-600 truncate flex-1">{business.website.replace(/^https?:\/\//, '').split('/')[0]}</span>
                            <svg className="w-4 h-4 text-neutral-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                            </svg>
                          </a>
                        )}
                      </div>

                      <div className="mt-3 pt-3 border-t border-neutral-100 flex items-center justify-between">
                        <span className="text-xs text-neutral-400">{business.source}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* No results */}
            {filteredResults.length === 0 && (
              <div className="text-center py-16 bg-white rounded-xl border border-neutral-200">
                <svg className="w-12 h-12 text-neutral-300 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <p className="text-neutral-500">No hay resultados con el filtro actual</p>
                <button
                  onClick={() => { setFilter('all'); setSearchInResults(''); }}
                  className="mt-2 text-sm text-blue-600 hover:text-blue-700"
                >
                  Limpiar filtros
                </button>
              </div>
            )}
          </div>
        )}

        {/* Footer */}
        <footer className="mt-16 pt-8 border-t border-neutral-200">
          <div className="flex items-center justify-between">
            <p className="text-xs text-neutral-400">
              Solo datos públicos. Cumple con GDPR.
            </p>
            <p className="text-xs text-neutral-400">
              Syntalys Scraper v4.2
            </p>
          </div>
        </footer>
      </div>

      {/* Toast for copy */}
      {copiedItem && (
        <div className="fixed bottom-6 right-6 bg-neutral-900 text-white px-4 py-2 rounded-lg shadow-lg flex items-center gap-2 animate-in fade-in slide-in-from-bottom-4 duration-300">
          <svg className="w-4 h-4 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
          Copiado y marcado como contactado
        </div>
      )}

      {/* Click outside to close export menu */}
      {showExportMenu && (
        <div
          className="fixed inset-0 z-0"
          onClick={() => setShowExportMenu(false)}
        />
      )}
    </div>
  );
}
