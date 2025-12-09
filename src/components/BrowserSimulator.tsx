'use client';

import { useEffect, useState, useRef } from 'react';

interface BrowserSimulatorProps {
  query: string;
  location: string;
  isActive: boolean;
}

const FAKE_SITES = [
  { url: 'google.com/search?q=', name: 'Google', color: '#4285f4' },
  { url: 'paginasamarillas.es/search/', name: 'Páginas Amarillas', color: '#ffcc00' },
  { url: 'yelp.es/search?find_desc=', name: 'Yelp', color: '#d32323' },
  { url: 'linkedin.com/search/', name: 'LinkedIn', color: '#0077b5' },
  { url: 'maps.google.com/search/', name: 'Google Maps', color: '#34a853' },
];

const ACTIONS = [
  'Buscando negocios...',
  'Extrayendo emails...',
  'Verificando contactos...',
  'Analizando páginas web...',
  'Encontrando propietarios...',
  'Recopilando datos...',
];

export default function BrowserSimulator({ query, location, isActive }: BrowserSimulatorProps) {
  const [currentSite, setCurrentSite] = useState(0);
  const [currentAction, setCurrentAction] = useState(0);
  const [typedUrl, setTypedUrl] = useState('');
  const [cursorPos, setCursorPos] = useState({ x: 50, y: 50 });
  const [isClicking, setIsClicking] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const [foundCount, setFoundCount] = useState(0);
  const browserRef = useRef<HTMLDivElement>(null);

  // Simular typing de URL
  useEffect(() => {
    if (!isActive) {
      setTypedUrl('');
      setLogs([]);
      setFoundCount(0);
      return;
    }

    const site = FAKE_SITES[currentSite];
    const fullUrl = `https://${site.url}${query}+${location}`;
    let index = 0;

    const typeInterval = setInterval(() => {
      if (index <= fullUrl.length) {
        setTypedUrl(fullUrl.slice(0, index));
        index++;
      } else {
        clearInterval(typeInterval);
      }
    }, 30);

    return () => clearInterval(typeInterval);
  }, [isActive, currentSite, query, location]);

  // Cambiar de sitio cada 3 segundos
  useEffect(() => {
    if (!isActive) return;

    const siteInterval = setInterval(() => {
      setCurrentSite((prev) => (prev + 1) % FAKE_SITES.length);
      setCurrentAction((prev) => (prev + 1) % ACTIONS.length);
    }, 3000);

    return () => clearInterval(siteInterval);
  }, [isActive]);

  // Mover cursor aleatoriamente
  useEffect(() => {
    if (!isActive) return;

    const moveInterval = setInterval(() => {
      setCursorPos({
        x: 20 + Math.random() * 60,
        y: 30 + Math.random() * 50,
      });

      // Simular clicks ocasionales
      if (Math.random() > 0.7) {
        setIsClicking(true);
        setTimeout(() => setIsClicking(false), 150);
      }
    }, 800);

    return () => clearInterval(moveInterval);
  }, [isActive]);

  // Añadir logs
  useEffect(() => {
    if (!isActive) return;

    const logInterval = setInterval(() => {
      const newLog = getRandomLog();
      setLogs((prev) => [...prev.slice(-4), newLog]);

      if (Math.random() > 0.5) {
        setFoundCount((prev) => prev + 1);
      }
    }, 1200);

    return () => clearInterval(logInterval);
  }, [isActive, query, location]);

  const getRandomLog = () => {
    const templates = [
      `[OK] Email encontrado: ${getRandomEmail()}`,
      `[OK] Teléfono: +34 ${Math.floor(600000000 + Math.random() * 99999999)}`,
      `[INFO] Escaneando ${FAKE_SITES[Math.floor(Math.random() * FAKE_SITES.length)].name}...`,
      `[OK] Negocio: ${getRandomBusiness()} ${location}`,
      `[INFO] Verificando contacto...`,
      `[OK] Propietario encontrado`,
    ];
    return templates[Math.floor(Math.random() * templates.length)];
  };

  const getRandomEmail = () => {
    const names = ['info', 'contacto', 'admin', 'hola', 'clinica', 'centro'];
    const domains = ['gmail.com', 'hotmail.es', 'outlook.com'];
    return `${names[Math.floor(Math.random() * names.length)]}@${domains[Math.floor(Math.random() * domains.length)]}`;
  };

  const getRandomBusiness = () => {
    const prefixes = ['Clínica', 'Centro', 'Hospital', 'Consulta'];
    return `${prefixes[Math.floor(Math.random() * prefixes.length)]} ${query}`;
  };

  if (!isActive) return null;

  const site = FAKE_SITES[currentSite];

  return (
    <div className="mb-8 animate-in fade-in duration-500">
      {/* Browser Window */}
      <div
        ref={browserRef}
        className="bg-white rounded-xl shadow-2xl border border-neutral-200 overflow-hidden"
      >
        {/* Title Bar */}
        <div className="bg-neutral-100 px-4 py-2 flex items-center gap-2 border-b border-neutral-200">
          <div className="flex gap-1.5">
            <div className="w-3 h-3 rounded-full bg-red-400" />
            <div className="w-3 h-3 rounded-full bg-yellow-400" />
            <div className="w-3 h-3 rounded-full bg-green-400" />
          </div>
          <div className="flex-1 mx-4">
            <div className="bg-white rounded-md px-3 py-1.5 text-sm text-neutral-600 font-mono flex items-center gap-2 border border-neutral-200">
              <svg className="w-4 h-4 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
              </svg>
              <span className="truncate">{typedUrl || 'https://'}</span>
              <span className="animate-pulse">|</span>
            </div>
          </div>
          <div className="flex gap-2 text-neutral-400">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          </div>
        </div>

        {/* Browser Content */}
        <div className="relative h-64 bg-gradient-to-br from-neutral-50 to-neutral-100 overflow-hidden">
          {/* Fake Website Content */}
          <div className="absolute inset-4">
            {/* Site Header */}
            <div className="flex items-center gap-3 mb-4">
              <div
                className="w-8 h-8 rounded-lg flex items-center justify-center text-white font-bold text-sm"
                style={{ backgroundColor: site.color }}
              >
                {site.name[0]}
              </div>
              <div>
                <div className="font-semibold text-neutral-800">{site.name}</div>
                <div className="text-xs text-neutral-500">Buscando: {query} en {location}</div>
              </div>
            </div>

            {/* Fake Search Results */}
            <div className="space-y-2">
              {[1, 2, 3].map((i) => (
                <div
                  key={i}
                  className="bg-white rounded-lg p-3 shadow-sm border border-neutral-100 animate-pulse"
                  style={{ animationDelay: `${i * 200}ms` }}
                >
                  <div className="h-3 bg-neutral-200 rounded w-3/4 mb-2" />
                  <div className="h-2 bg-neutral-100 rounded w-1/2" />
                </div>
              ))}
            </div>
          </div>

          {/* Animated Cursor */}
          <div
            className="absolute transition-all duration-700 ease-out pointer-events-none z-10"
            style={{
              left: `${cursorPos.x}%`,
              top: `${cursorPos.y}%`,
              transform: 'translate(-50%, -50%)'
            }}
          >
            <svg
              className={`w-6 h-6 drop-shadow-lg transition-transform ${isClicking ? 'scale-90' : 'scale-100'}`}
              viewBox="0 0 24 24"
              fill="none"
            >
              <path
                d="M5.5 3.21V20.8c0 .45.54.67.85.35l4.86-4.86a.5.5 0 01.35-.15h6.87a.5.5 0 00.35-.85L6.35 2.86a.5.5 0 00-.85.35z"
                fill="#000"
                stroke="#fff"
                strokeWidth="1.5"
              />
            </svg>
            {isClicking && (
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="w-8 h-8 rounded-full bg-blue-400/30 animate-ping" />
              </div>
            )}
          </div>

          {/* Scanning Overlay */}
          <div className="absolute inset-0 pointer-events-none">
            <div
              className="absolute inset-x-0 h-1 bg-gradient-to-r from-transparent via-blue-500/50 to-transparent animate-scan"
            />
          </div>
        </div>

        {/* Status Bar */}
        <div className="bg-neutral-800 px-4 py-2 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
            <span className="text-green-400 text-xs font-mono">{ACTIONS[currentAction]}</span>
          </div>
          <div className="text-neutral-400 text-xs font-mono">
            {foundCount} contactos encontrados
          </div>
        </div>
      </div>

      {/* Console Logs */}
      <div className="mt-4 bg-neutral-900 rounded-lg p-4 font-mono text-xs overflow-hidden">
        <div className="flex items-center gap-2 mb-3 text-neutral-500">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
          </svg>
          <span>Console Output</span>
        </div>
        <div className="space-y-1">
          {logs.map((log, i) => (
            <div
              key={i}
              className={`${
                log.includes('[OK]') ? 'text-green-400' : 'text-neutral-400'
              } animate-in slide-in-from-left duration-300`}
            >
              {log}
            </div>
          ))}
          {logs.length === 0 && (
            <div className="text-neutral-600">Iniciando búsqueda...</div>
          )}
        </div>
      </div>
    </div>
  );
}
