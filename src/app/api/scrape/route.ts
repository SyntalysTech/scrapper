import { NextRequest, NextResponse } from 'next/server';
import * as cheerio from 'cheerio';

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

// Regex para extraer datos
const EMAIL_REGEX = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/gi;
const PHONE_REGEX_ES = /(?:\+34\s?)?[6789]\d{2}[\s.-]?\d{3}[\s.-]?\d{3}/g;

// Dominios de email a ignorar
const IGNORE_EMAIL_DOMAINS = [
  'example.com', 'test.com', 'localhost', 'sentry.io', 'wixpress.com',
  'placeholder.com', 'yourdomain.com', 'domain.com', 'email.com',
  'w3.org', 'schema.org', 'mailinator.com', 'yelp.com', 'yelp.es',
  'facebook.com', 'twitter.com', 'instagram.com', 'linkedin.com',
  'google.com', 'googleapis.com', 'gstatic.com', 'apple.com',
  'microsoft.com', 'amazon.com', 'cloudflare.com'
];

// TLDs válidos
const VALID_TLDS = ['com', 'es', 'org', 'net', 'info', 'eu', 'cat', 'gal', 'eus', 'co', 'io', 'me', 'biz'];

function isValidEmail(email: string): boolean {
  const lower = email.toLowerCase().trim();

  // Ignorar dominios conocidos
  for (const domain of IGNORE_EMAIL_DOMAINS) {
    if (lower.includes(domain)) return false;
  }

  // Formato básico
  const parts = lower.split('@');
  if (parts.length !== 2) return false;
  if (parts[0].length < 2 || parts[1].length < 5) return false;

  // Validar TLD
  const domainParts = parts[1].split('.');
  const tld = domainParts[domainParts.length - 1];
  if (!VALID_TLDS.includes(tld) && tld.length > 4) return false;

  // No código JS
  const jsPatterns = [
    'window', 'document', 'location', 'function', 'return', 'const', 'var',
    'let', 'this', 'children', 'prototype', 'handler', 'callback', 'element',
    'node', 'array', 'object', 'string', 'null', 'undefined', 'true', 'false',
    'module', 'export', 'import', 'require', 'async', 'await', 'promise',
    'fetch', 'jquery', 'react', 'angular', 'vue', 'script', 'style'
  ];
  for (const pattern of jsPatterns) {
    if (lower.includes(pattern)) return false;
  }

  // Extensiones de archivo
  if (/\.(png|jpg|gif|svg|css|js|woff|ico)$/i.test(lower)) return false;

  return true;
}

function isValidPhone(phone: string): boolean {
  const cleaned = phone.replace(/[^\d]/g, '');
  if (cleaned.length < 9 || cleaned.length > 12) return false;
  if (/^(\d)\1+$/.test(cleaned)) return false;
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
    $('script, style, noscript').remove();

    // Emails de mailto:
    $('a[href^="mailto:"]').each((_, el) => {
      const email = ($(el).attr('href') || '').replace('mailto:', '').split('?')[0].toLowerCase();
      if (email && isValidEmail(email)) emails.add(email);
    });

    // Emails del texto
    const text = $('body').text();
    const textEmails = text.match(EMAIL_REGEX) || [];
    textEmails.forEach(e => { if (isValidEmail(e)) emails.add(e.toLowerCase()); });

    // Teléfonos de tel:
    $('a[href^="tel:"]').each((_, el) => {
      const phone = ($(el).attr('href') || '').replace('tel:', '');
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

    // Si no hay emails, buscar en /contacto
    if (emails.size === 0) {
      const baseUrl = new URL(url).origin;
      const contactUrls = ['/contacto', '/contact', '/contactar'];

      for (const contactPath of contactUrls) {
        try {
          const contactResponse = await fetchSafe(`${baseUrl}${contactPath}`, 5000);
          if (contactResponse && contactResponse.ok) {
            const contactHtml = await contactResponse.text();
            const $c = cheerio.load(contactHtml);

            $c('a[href^="mailto:"]').each((_, el) => {
              const email = ($c(el).attr('href') || '').replace('mailto:', '').split('?')[0].toLowerCase();
              if (email && isValidEmail(email)) emails.add(email);
            });

            const contactText = $c('body').text();
            const contactEmails = contactText.match(EMAIL_REGEX) || [];
            contactEmails.forEach(e => { if (isValidEmail(e)) emails.add(e.toLowerCase()); });

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

// Búsqueda en DuckDuckGo
async function searchDuckDuckGo(query: string, location: string): Promise<BusinessResult[]> {
  const results: BusinessResult[] = [];
  const searches = [
    `${query} ${location}`,
    `${query} ${location} contacto`,
    `clinica ${query} ${location}`,
    `centro ${query} ${location}`,
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
        const snippetEmails = (snippet.match(EMAIL_REGEX) || []).filter(e => isValidEmail(e));
        const snippetPhones = (snippet.match(PHONE_REGEX_ES) || []).filter(p => isValidPhone(p));

        let website = link;
        if (website && !website.startsWith('http')) {
          website = `https://${website}`;
        }

        // Solo añadir si tiene algo útil
        if (website || snippetEmails.length > 0 || snippetPhones.length > 0) {
          results.push({
            name: name.substring(0, 100),
            email: snippetEmails[0]?.toLowerCase(),
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

// Búsqueda específica de emails
async function searchEmails(query: string, location: string): Promise<BusinessResult[]> {
  const results: BusinessResult[] = [];

  const searches = [
    `"${query}" "${location}" email`,
    `"${query}" "${location}" @gmail.com OR @hotmail.com`,
    `${query} ${location} correo electronico contacto`,
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

        const emails = (snippet.match(EMAIL_REGEX) || []).filter(e => isValidEmail(e));
        if (emails.length === 0) return;

        const name = cleanName(title);
        if (name.length < 3) return;

        const phones = (snippet.match(PHONE_REGEX_ES) || []).filter(p => isValidPhone(p));

        results.push({
          name: name.substring(0, 100),
          email: emails[0].toLowerCase(),
          emailVerified: false,
          phone: phones[0] ? formatPhone(phones[0]) : undefined,
          phoneVerified: phones.length > 0,
          website: link ? (link.startsWith('http') ? link : `https://${link}`) : undefined,
          source: 'Email Search',
          scrapedAt: new Date().toISOString(),
        });
      });
    } catch (error) {
      console.error('Email search error:', error);
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

    console.log(`Scraping: ${query} in ${location}`);

    // Búsquedas en paralelo
    const [duckResults, emailResults] = await Promise.all([
      searchDuckDuckGo(query, location),
      searchEmails(query, location),
    ]);

    // Combinar y eliminar duplicados
    const allResults = [...emailResults, ...duckResults];
    const uniqueResults: BusinessResult[] = [];
    const seenNames = new Set<string>();

    for (const result of allResults) {
      const key = result.name.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 20);
      if (!seenNames.has(key) && key.length > 3) {
        seenNames.add(key);
        uniqueResults.push(result);
      }
    }

    // Limitar y enriquecer con scraping de webs
    const limitedResults = uniqueResults.slice(0, maxResults);

    // Scrapear webs en paralelo para obtener emails
    const enrichedResults = await Promise.all(
      limitedResults.map(async (result) => {
        if (result.website && !result.email) {
          const scraped = await scrapeWebsite(result.website);
          if (scraped.emails.length > 0) {
            result.email = scraped.emails[0];
            result.emailVerified = true;
          }
          if (!result.phone && scraped.phones.length > 0) {
            result.phone = scraped.phones[0];
            result.phoneVerified = true;
          }
          if (scraped.owner) {
            result.owner = scraped.owner;
          }
        }
        return result;
      })
    );

    // Filtrar los que tienen contacto
    const validResults = enrichedResults.filter(r => r.email || r.phone);

    // Ordenar por cantidad de info
    validResults.sort((a, b) => {
      const scoreA = (a.email ? 2 : 0) + (a.phone ? 1 : 0) + (a.owner ? 1 : 0);
      const scoreB = (b.email ? 2 : 0) + (b.phone ? 1 : 0) + (b.owner ? 1 : 0);
      return scoreB - scoreA;
    });

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
    version: '3.0.0',
    usage: 'POST { query, location, maxResults? }',
  });
}
