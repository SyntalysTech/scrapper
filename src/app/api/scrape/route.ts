import { NextRequest, NextResponse } from 'next/server';
import * as cheerio from 'cheerio';
import OpenAI from 'openai';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

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

// Regex mejorado para emails - más estricto
const EMAIL_REGEX = /\b[a-zA-Z0-9._%+-]{2,30}@[a-zA-Z0-9.-]{2,30}\.[a-zA-Z]{2,6}\b/gi;
const PHONE_REGEX_ES = /(?:\+34\s?)?[6789]\d{2}[\s.-]?\d{3}[\s.-]?\d{3}/g;

// Dominios de email a ignorar
const IGNORE_EMAIL_DOMAINS = [
  'example.com', 'test.com', 'localhost', 'sentry.io', 'wixpress.com',
  'placeholder.com', 'yourdomain.com', 'domain.com', 'email.com',
  'w3.org', 'schema.org', 'mailinator.com', 'yelp.com', 'yelp.es',
  'facebook.com', 'twitter.com', 'instagram.com', 'linkedin.com',
  'google.com', 'googleapis.com', 'gstatic.com', 'apple.com',
  'microsoft.com', 'amazon.com', 'cloudflare.com', 'sentry-next.wixpress.com',
  'elpais.es', 'elmundo.es', 'abc.es', 'lavanguardia.com' // Periódicos
];

// TLDs válidos para España
const VALID_TLDS = ['com', 'es', 'org', 'net', 'info', 'eu', 'cat', 'gal', 'eus', 'co', 'io', 'me', 'biz'];

// Palabras que indican email falso o de JS
const INVALID_EMAIL_PATTERNS = [
  'window', 'document', 'location', 'function', 'return', 'const', 'var',
  'let', 'this', 'children', 'prototype', 'handler', 'callback', 'element',
  'node', 'array', 'object', 'string', 'null', 'undefined', 'true', 'false',
  'module', 'export', 'import', 'require', 'async', 'await', 'promise',
  'fetch', 'jquery', 'react', 'angular', 'vue', 'script', 'style',
  'suscripcion', 'newsletter', 'noreply', 'no-reply', 'donotreply',
  'mailer-daemon', 'postmaster', 'webmaster'
];

function cleanEmail(email: string): string | null {
  if (!email) return null;

  let cleaned = email.toLowerCase().trim();

  // Decodificar URL encoding
  try {
    cleaned = decodeURIComponent(cleaned);
  } catch {
    // Si falla, continuar con el original
  }

  // Eliminar prefijos comunes de basura
  cleaned = cleaned
    .replace(/^[0-9]+/, '') // Números al inicio
    .replace(/^contacto\+?/, '') // "contacto+" al inicio
    .replace(/\+34\d+/g, '') // Teléfonos concatenados
    .replace(/^[^a-z]+/i, '') // Caracteres no-letra al inicio
    .trim();

  // Buscar el email real dentro del string si hay basura
  const emailMatch = cleaned.match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,6})/);
  if (emailMatch) {
    cleaned = emailMatch[1];
  }

  return cleaned;
}

function isValidEmail(email: string): boolean {
  const cleaned = cleanEmail(email);
  if (!cleaned) return false;

  // Longitud razonable
  if (cleaned.length < 6 || cleaned.length > 60) return false;

  // No tiene espacios
  if (cleaned.includes(' ')) return false;

  // Formato básico
  const parts = cleaned.split('@');
  if (parts.length !== 2) return false;
  if (parts[0].length < 2 || parts[1].length < 5) return false;

  // No tiene caracteres repetidos extraños
  if (/(.)\1{4,}/.test(cleaned)) return false;

  // No tiene números excesivos antes del @
  if (/\d{6,}/.test(parts[0])) return false;

  // Validar TLD
  const domainParts = parts[1].split('.');
  if (domainParts.length < 2) return false;
  const tld = domainParts[domainParts.length - 1];
  if (!VALID_TLDS.includes(tld) && tld.length > 4) return false;

  // Ignorar dominios conocidos
  for (const domain of IGNORE_EMAIL_DOMAINS) {
    if (parts[1].includes(domain)) return false;
  }

  // No patrones de JS/código
  for (const pattern of INVALID_EMAIL_PATTERNS) {
    if (cleaned.includes(pattern)) return false;
  }

  // No extensiones de archivo
  if (/\.(png|jpg|gif|svg|css|js|woff|ico|pdf|doc)$/i.test(cleaned)) return false;

  return true;
}

function isValidPhone(phone: string): boolean {
  const cleaned = phone.replace(/[^\d]/g, '');
  if (cleaned.length < 9 || cleaned.length > 12) return false;
  if (/^(\d)\1+$/.test(cleaned)) return false; // No todos iguales
  if (/^(123456|654321|000000|111111|999999)/.test(cleaned)) return false; // Patrones obvios
  return true;
}

function formatPhone(phone: string): string {
  const cleaned = phone.replace(/[^\d+]/g, '');
  if (cleaned.length === 9) {
    return `${cleaned.slice(0, 3)} ${cleaned.slice(3, 6)} ${cleaned.slice(6)}`;
  }
  if (cleaned.startsWith('34') && cleaned.length === 11) {
    return `+34 ${cleaned.slice(2, 5)} ${cleaned.slice(5, 8)} ${cleaned.slice(8)}`;
  }
  if (cleaned.startsWith('+34') && cleaned.length === 12) {
    return `+34 ${cleaned.slice(3, 6)} ${cleaned.slice(6, 9)} ${cleaned.slice(9)}`;
  }
  return cleaned;
}

function cleanName(name: string): string {
  return name
    .replace(/de este sitio web/gi, '')
    .replace(/del tratamiento/gi, '')
    .replace(/Ver más/gi, '')
    .replace(/Leer más/gi, '')
    .replace(/del NegocioToma el control/gi, '')
    .replace(/Toma el control/gi, '')
    .replace(/del Negocio/gi, '')
    .replace(/- Buscar con Google/gi, '')
    .replace(/\| LinkedIn/gi, '')
    .replace(/- Google Maps/gi, '')
    .replace(/\d+\.\s*/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

async function fetchSafe(url: string, timeout = 10000): Promise<Response | null> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8',
      },
    });
    clearTimeout(timeoutId);
    return response;
  } catch {
    clearTimeout(timeoutId);
    return null;
  }
}

// Extraer contactos de una página web
async function scrapeWebsite(url: string): Promise<{ emails: string[]; phones: string[]; owner?: string }> {
  const emails = new Set<string>();
  const phones = new Set<string>();
  let owner: string | undefined;

  try {
    if (!url.startsWith('http')) url = `https://${url}`;

    const response = await fetchSafe(url, 8000);
    if (!response || !response.ok) return { emails: [], phones: [] };

    const html = await response.text();
    const $ = cheerio.load(html);
    $('script, style, noscript, iframe').remove();

    // Emails de mailto:
    $('a[href^="mailto:"]').each((_, el) => {
      const href = $(el).attr('href') || '';
      const email = href.replace('mailto:', '').split('?')[0].split('&')[0];
      const cleaned = cleanEmail(email);
      if (cleaned && isValidEmail(cleaned)) emails.add(cleaned);
    });

    // Emails del texto visible
    const text = $('body').text();
    const textEmails = text.match(EMAIL_REGEX) || [];
    textEmails.forEach(e => {
      const cleaned = cleanEmail(e);
      if (cleaned && isValidEmail(cleaned)) emails.add(cleaned);
    });

    // Buscar en atributos data-* y meta tags
    $('meta[content*="@"]').each((_, el) => {
      const content = $(el).attr('content') || '';
      const foundEmails = content.match(EMAIL_REGEX) || [];
      foundEmails.forEach(e => {
        const cleaned = cleanEmail(e);
        if (cleaned && isValidEmail(cleaned)) emails.add(cleaned);
      });
    });

    // Teléfonos de tel:
    $('a[href^="tel:"]').each((_, el) => {
      const phone = ($(el).attr('href') || '').replace('tel:', '').replace(/\s/g, '');
      if (isValidPhone(phone)) phones.add(formatPhone(phone));
    });

    // Teléfonos del texto
    const textPhones = text.match(PHONE_REGEX_ES) || [];
    textPhones.forEach(p => { if (isValidPhone(p)) phones.add(formatPhone(p)); });

    // Buscar propietario
    const ownerPatterns = [
      /(?:propietario|director|gerente|ceo|fundador|responsable)[:\s]+([A-ZÁÉÍÓÚÑ][a-záéíóúñ]+(?:\s+[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+){1,2})/gi,
    ];
    for (const pattern of ownerPatterns) {
      const match = text.match(pattern);
      if (match) {
        owner = match[1]?.trim();
        break;
      }
    }

    // Si no hay emails, buscar en páginas de contacto
    if (emails.size === 0) {
      const baseUrl = new URL(url).origin;
      const contactUrls = ['/contacto', '/contact', '/contactar', '/sobre-nosotros', '/quienes-somos'];

      for (const contactPath of contactUrls) {
        try {
          const contactResponse = await fetchSafe(`${baseUrl}${contactPath}`, 5000);
          if (contactResponse && contactResponse.ok) {
            const contactHtml = await contactResponse.text();
            const $c = cheerio.load(contactHtml);
            $c('script, style, noscript').remove();

            $c('a[href^="mailto:"]').each((_, el) => {
              const href = $c(el).attr('href') || '';
              const email = href.replace('mailto:', '').split('?')[0];
              const cleaned = cleanEmail(email);
              if (cleaned && isValidEmail(cleaned)) emails.add(cleaned);
            });

            const contactText = $c('body').text();
            const contactEmails = contactText.match(EMAIL_REGEX) || [];
            contactEmails.forEach(e => {
              const cleaned = cleanEmail(e);
              if (cleaned && isValidEmail(cleaned)) emails.add(cleaned);
            });

            if (emails.size > 0) break;
          }
        } catch {
          continue;
        }
      }
    }

  } catch (error) {
    console.error('Error scraping website:', error);
  }

  return { emails: Array.from(emails), phones: Array.from(phones), owner };
}

// Búsqueda principal con OpenAI Web Search - Mejorado
async function searchWithOpenAI(query: string, location: string, maxResults: number): Promise<BusinessResult[]> {
  const results: BusinessResult[] = [];

  try {
    const searchPrompt = `Eres un asistente experto en búsqueda de datos de contacto empresarial en España.

TAREA: Busca negocios de "${query}" en "${location}", España.

INSTRUCCIONES:
1. Busca en Google, directorios empresariales españoles (Páginas Amarillas, QDQ, Infobel), Google Maps, webs oficiales
2. Para cada negocio, extrae el EMAIL REAL de su página de contacto
3. Prioriza emails de dominio propio (info@empresa.es) sobre genéricos (gmail, hotmail)
4. Incluye el teléfono de contacto principal
5. Busca el nombre del propietario/gerente si aparece

IMPORTANTE:
- Solo incluye emails REALES que hayas encontrado en las fuentes
- NO inventes emails
- Si no encuentras email, deja el campo vacío
- Busca en la página de contacto de cada web

Encuentra al menos ${Math.min(maxResults, 40)} negocios diferentes.

Responde ÚNICAMENTE con un JSON array válido, sin markdown ni explicaciones:
[{"name": "Nombre Negocio", "email": "email@real.com", "phone": "+34 XXX XXX XXX", "website": "https://web.com", "owner": "Nombre Propietario"}]`;

    const response = await openai.responses.create({
      model: "gpt-4o",
      tools: [{ type: "web_search_preview" }],
      input: searchPrompt,
    });

    // Extraer el texto de la respuesta
    let responseText = '';
    for (const item of response.output) {
      if (item.type === 'message') {
        for (const content of item.content) {
          if (content.type === 'output_text') {
            responseText += content.text;
          }
        }
      }
    }

    // Limpiar y parsear JSON
    responseText = responseText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    const jsonMatch = responseText.match(/\[[\s\S]*\]/);

    if (jsonMatch) {
      try {
        const businesses = JSON.parse(jsonMatch[0]);

        for (const biz of businesses) {
          if (!biz.name || biz.name.length < 3) continue;

          const cleanedEmail = biz.email ? cleanEmail(biz.email) : undefined;

          const result: BusinessResult = {
            name: cleanName(biz.name).substring(0, 100),
            email: cleanedEmail && isValidEmail(cleanedEmail) ? cleanedEmail : undefined,
            emailVerified: false,
            phone: biz.phone && isValidPhone(biz.phone) ? formatPhone(biz.phone) : undefined,
            phoneVerified: !!biz.phone,
            website: biz.website || undefined,
            owner: biz.owner || undefined,
            source: 'OpenAI Search',
            scrapedAt: new Date().toISOString(),
          };

          if (result.name.length > 3) {
            results.push(result);
          }
        }
      } catch (parseError) {
        console.error('JSON parse error:', parseError);
      }
    }
  } catch (error) {
    console.error('OpenAI search error:', error);
  }

  return results;
}

// Segunda búsqueda enfocada en emails
async function searchEmailsWithAI(query: string, location: string): Promise<BusinessResult[]> {
  const results: BusinessResult[] = [];

  try {
    const searchPrompt = `Busca EMAILS de contacto REALES de empresas de "${query}" en "${location}", España.

MÉTODO DE BÚSQUEDA:
1. Entra a las páginas web oficiales de estos negocios
2. Busca en la sección "Contacto", "Sobre nosotros", footer
3. Extrae emails de mailto: links o texto visible
4. Verifica que el email pertenece a esa empresa (dominio correcto)

FUENTES PRIORITARIAS:
- Webs oficiales de las empresas
- Google Maps (sección de contacto)
- Páginas Amarillas
- Directorios profesionales del sector

Solo incluye negocios donde hayas ENCONTRADO un email real.
No incluyas emails genéricos de periódicos, redes sociales o plataformas.

Responde SOLO con JSON array:
[{"name": "...", "email": "email@empresa.es", "phone": "...", "website": "...", "owner": "..."}]`;

    const response = await openai.responses.create({
      model: "gpt-4o",
      tools: [{ type: "web_search_preview" }],
      input: searchPrompt,
    });

    let responseText = '';
    for (const item of response.output) {
      if (item.type === 'message') {
        for (const content of item.content) {
          if (content.type === 'output_text') {
            responseText += content.text;
          }
        }
      }
    }

    responseText = responseText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    const jsonMatch = responseText.match(/\[[\s\S]*\]/);

    if (jsonMatch) {
      try {
        const businesses = JSON.parse(jsonMatch[0]);

        for (const biz of businesses) {
          if (!biz.name || !biz.email) continue;

          const cleanedEmail = cleanEmail(biz.email);
          if (!cleanedEmail || !isValidEmail(cleanedEmail)) continue;

          results.push({
            name: cleanName(biz.name).substring(0, 100),
            email: cleanedEmail,
            emailVerified: true,
            phone: biz.phone && isValidPhone(biz.phone) ? formatPhone(biz.phone) : undefined,
            phoneVerified: !!biz.phone,
            website: biz.website || undefined,
            owner: biz.owner || undefined,
            source: 'AI Email Search',
            scrapedAt: new Date().toISOString(),
          });
        }
      } catch (parseError) {
        console.error('JSON parse error:', parseError);
      }
    }
  } catch (error) {
    console.error('AI email search error:', error);
  }

  return results;
}

// Tercera búsqueda - Directorios específicos
async function searchDirectoriesWithAI(query: string, location: string): Promise<BusinessResult[]> {
  const results: BusinessResult[] = [];

  try {
    const searchPrompt = `Busca en directorios empresariales españoles negocios de "${query}" en "${location}".

DIRECTORIOS A CONSULTAR:
- paginasamarillas.es
- qdq.com
- infobel.com/es
- europages.es
- empresite.eleconomista.es
- axesor.es

Para cada empresa encontrada, extrae:
- Nombre comercial
- Email de contacto (de su ficha o web)
- Teléfono
- Web oficial
- Nombre del responsable si aparece

Busca al menos 30-40 empresas con datos de contacto.

Responde SOLO con JSON array válido:
[{"name": "...", "email": "...", "phone": "...", "website": "...", "owner": "..."}]`;

    const response = await openai.responses.create({
      model: "gpt-4o",
      tools: [{ type: "web_search_preview" }],
      input: searchPrompt,
    });

    let responseText = '';
    for (const item of response.output) {
      if (item.type === 'message') {
        for (const content of item.content) {
          if (content.type === 'output_text') {
            responseText += content.text;
          }
        }
      }
    }

    responseText = responseText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    const jsonMatch = responseText.match(/\[[\s\S]*\]/);

    if (jsonMatch) {
      try {
        const businesses = JSON.parse(jsonMatch[0]);

        for (const biz of businesses) {
          if (!biz.name || biz.name.length < 3) continue;

          const cleanedEmail = biz.email ? cleanEmail(biz.email) : undefined;

          results.push({
            name: cleanName(biz.name).substring(0, 100),
            email: cleanedEmail && isValidEmail(cleanedEmail) ? cleanedEmail : undefined,
            emailVerified: false,
            phone: biz.phone && isValidPhone(biz.phone) ? formatPhone(biz.phone) : undefined,
            phoneVerified: !!biz.phone,
            website: biz.website || undefined,
            owner: biz.owner || undefined,
            source: 'Directorios',
            scrapedAt: new Date().toISOString(),
          });
        }
      } catch (parseError) {
        console.error('JSON parse error:', parseError);
      }
    }
  } catch (error) {
    console.error('Directory search error:', error);
  }

  return results;
}

// Cuarta búsqueda - Más resultados con paginación
async function searchMoreWithAI(query: string, location: string, existingNames: string[]): Promise<BusinessResult[]> {
  const results: BusinessResult[] = [];

  try {
    const excludeList = existingNames.slice(0, 20).join(', ');

    const searchPrompt = `Busca MÁS negocios de "${query}" en "${location}", España.

IMPORTANTE: NO incluyas estos negocios que ya tenemos:
${excludeList}

Busca negocios DIFERENTES a los anteriores. Incluye:
- Negocios más pequeños o menos conocidos
- Negocios en diferentes zonas de ${location}
- Negocios con diferentes nombres comerciales

Para cada negocio nuevo, extrae:
- Nombre comercial
- Email de contacto
- Teléfono
- Web

Encuentra 30-40 negocios NUEVOS que no estén en la lista anterior.

Responde SOLO con JSON array:
[{"name": "...", "email": "...", "phone": "...", "website": "..."}]`;

    const response = await openai.responses.create({
      model: "gpt-4o",
      tools: [{ type: "web_search_preview" }],
      input: searchPrompt,
    });

    let responseText = '';
    for (const item of response.output) {
      if (item.type === 'message') {
        for (const content of item.content) {
          if (content.type === 'output_text') {
            responseText += content.text;
          }
        }
      }
    }

    responseText = responseText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    const jsonMatch = responseText.match(/\[[\s\S]*\]/);

    if (jsonMatch) {
      try {
        const businesses = JSON.parse(jsonMatch[0]);

        for (const biz of businesses) {
          if (!biz.name || biz.name.length < 3) continue;

          const cleanedEmail = biz.email ? cleanEmail(biz.email) : undefined;

          results.push({
            name: cleanName(biz.name).substring(0, 100),
            email: cleanedEmail && isValidEmail(cleanedEmail) ? cleanedEmail : undefined,
            emailVerified: false,
            phone: biz.phone && isValidPhone(biz.phone) ? formatPhone(biz.phone) : undefined,
            phoneVerified: !!biz.phone,
            website: biz.website || undefined,
            source: 'AI Extended',
            scrapedAt: new Date().toISOString(),
          });
        }
      } catch (parseError) {
        console.error('JSON parse error:', parseError);
      }
    }
  } catch (error) {
    console.error('Extended search error:', error);
  }

  return results;
}

// Búsqueda en DuckDuckGo (backup)
async function searchDuckDuckGo(query: string, location: string): Promise<BusinessResult[]> {
  const results: BusinessResult[] = [];
  const searches = [
    `${query} ${location} contacto email`,
    `${query} ${location} telefono`,
    `${query} ${location} directorio`,
    `mejores ${query} ${location}`,
  ];

  for (const searchTerm of searches) {
    try {
      const response = await fetchSafe(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(searchTerm)}`, 15000);
      if (!response || !response.ok) continue;

      const html = await response.text();
      const $ = cheerio.load(html);

      $('.result').each((_, element) => {
        const title = $(element).find('.result__title').text().trim();
        const link = $(element).find('.result__url').text().trim();
        const snippet = $(element).find('.result__snippet').text();

        if (!title || title.length < 3) return;

        const name = cleanName(title);
        if (name.length < 3) return;

        // Extraer datos del snippet
        const snippetEmails = (snippet.match(EMAIL_REGEX) || [])
          .map(e => cleanEmail(e))
          .filter((e): e is string => e !== null && isValidEmail(e));
        const snippetPhones = (snippet.match(PHONE_REGEX_ES) || []).filter(p => isValidPhone(p));

        let website = link;
        if (website && !website.startsWith('http')) {
          website = `https://${website}`;
        }

        if (website || snippetEmails.length > 0 || snippetPhones.length > 0) {
          results.push({
            name: name.substring(0, 100),
            email: snippetEmails[0],
            emailVerified: false,
            phone: snippetPhones[0] ? formatPhone(snippetPhones[0]) : undefined,
            phoneVerified: snippetPhones.length > 0,
            website,
            source: 'Web',
            scrapedAt: new Date().toISOString(),
          });
        }
      });
    } catch (error) {
      console.error('DuckDuckGo error:', error);
    }
  }

  return results;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { query, location, maxResults = 30 } = body;

    if (!query || !location) {
      return NextResponse.json({ error: 'Query and location are required' }, { status: 400 });
    }

    console.log(`Scraping: ${query} in ${location}, max: ${maxResults}`);

    const useOpenAI = !!process.env.OPENAI_API_KEY;

    // Búsquedas en paralelo
    const searchPromises: Promise<BusinessResult[]>[] = [
      searchDuckDuckGo(query, location),
    ];

    if (useOpenAI) {
      console.log('Using OpenAI for enhanced search...');
      searchPromises.push(searchWithOpenAI(query, location, maxResults));
      searchPromises.push(searchEmailsWithAI(query, location));
      searchPromises.push(searchDirectoriesWithAI(query, location));
    }

    const searchResults = await Promise.all(searchPromises);

    // Combinar todos los resultados
    let allResults = searchResults.flat();

    // Función para deduplicar
    const deduplicateResults = (results: BusinessResult[]): BusinessResult[] => {
      const unique: BusinessResult[] = [];
      const seenNames = new Set<string>();

      // Ordenar para priorizar los que tienen email
      results.sort((a, b) => {
        const scoreA = (a.email ? 10 : 0) + (a.phone ? 3 : 0) + (a.emailVerified ? 5 : 0);
        const scoreB = (b.email ? 10 : 0) + (b.phone ? 3 : 0) + (b.emailVerified ? 5 : 0);
        return scoreB - scoreA;
      });

      for (const result of results) {
        const key = result.name.toLowerCase()
          .replace(/[^a-záéíóúñ0-9]/g, '')
          .slice(0, 25);

        if (!seenNames.has(key) && key.length > 3) {
          seenNames.add(key);
          unique.push(result);
        }
      }

      return unique;
    };

    let uniqueResults = deduplicateResults(allResults);
    console.log(`First round: ${uniqueResults.length} unique results`);

    // Si necesitamos más resultados y tenemos OpenAI, hacer búsqueda extendida
    if (useOpenAI && uniqueResults.length < maxResults && maxResults > 30) {
      console.log(`Need more results (${uniqueResults.length}/${maxResults}), doing extended search...`);

      const existingNames = uniqueResults.map(r => r.name);
      const moreResults = await searchMoreWithAI(query, location, existingNames);

      allResults = [...uniqueResults, ...moreResults];
      uniqueResults = deduplicateResults(allResults);
      console.log(`After extended search: ${uniqueResults.length} unique results`);
    }

    // Limitar resultados
    const limitedResults = uniqueResults.slice(0, maxResults + 10);

    // Scrapear webs para obtener emails faltantes
    console.log(`Enriching ${limitedResults.length} results...`);

    const enrichedResults = await Promise.all(
      limitedResults.map(async (result) => {
        // Solo scrapear si tiene web pero no tiene email
        if (result.website && !result.email) {
          try {
            const scraped = await scrapeWebsite(result.website);
            if (scraped.emails.length > 0) {
              result.email = scraped.emails[0];
              result.emailVerified = true;
            }
            if (!result.phone && scraped.phones.length > 0) {
              result.phone = scraped.phones[0];
              result.phoneVerified = true;
            }
            if (scraped.owner && !result.owner) {
              result.owner = scraped.owner;
            }
          } catch (e) {
            console.error('Scrape error for', result.website, e);
          }
        }
        return result;
      })
    );

    // Filtrar los que tienen al menos teléfono o email
    const validResults = enrichedResults
      .filter(r => r.email || r.phone)
      .slice(0, maxResults);

    // Ordenar: primero los que tienen email, luego por cantidad de info
    validResults.sort((a, b) => {
      const scoreA = (a.email ? 10 : 0) + (a.phone ? 3 : 0) + (a.owner ? 1 : 0) + (a.website ? 1 : 0);
      const scoreB = (b.email ? 10 : 0) + (b.phone ? 3 : 0) + (b.owner ? 1 : 0) + (b.website ? 1 : 0);
      return scoreB - scoreA;
    });

    console.log(`Found ${validResults.length} valid results (${validResults.filter(r => r.email).length} with email)`);

    return NextResponse.json({
      success: true,
      query,
      location,
      totalFound: validResults.length,
      results: validResults,
      scrapedAt: new Date().toISOString(),
    });

  } catch (error) {
    console.error('Scraping error:', error);
    return NextResponse.json({ error: 'Error during scraping' }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json({
    message: 'Syntalys Business Contact Scraper API',
    version: '4.3.0',
    usage: 'POST { query, location, maxResults? }',
  });
}
