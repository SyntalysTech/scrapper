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

// Regex patterns para extraer datos
const EMAIL_REGEX = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const PHONE_REGEX_ES = /(?:\+34\s?)?(?:6\d{2}|7[1-9]\d|9\d{2})[\s.-]?\d{3}[\s.-]?\d{3}/g;
const PHONE_REGEX_INTL = /(?:\+\d{1,3}[\s.-]?)?\(?\d{2,4}\)?[\s.-]?\d{3,4}[\s.-]?\d{3,4}/g;

// Lista de emails genéricos a evitar como primera opción
const GENERIC_EMAILS = [
  'info@', 'contact@', 'hello@', 'admin@', 'support@', 'noreply@',
  'no-reply@', 'webmaster@', 'mail@', 'email@', 'test@', 'example@',
  'sales@', 'marketing@', 'press@', 'media@', 'jobs@', 'careers@',
  'privacy@', 'legal@', 'abuse@', 'postmaster@'
];

// Dominios de email a ignorar
const IGNORE_EMAIL_DOMAINS = [
  'example.com', 'test.com', 'localhost', 'sentry.io', 'wixpress.com',
  'placeholder.com', 'yourdomain.com', 'domain.com', 'email.com',
  'w3.org', 'schema.org', 'google.com', 'facebook.com', 'twitter.com'
];

async function fetchWithTimeout(url: string, timeout = 10000): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8',
        'Cache-Control': 'no-cache',
      },
    });
    clearTimeout(timeoutId);
    return response;
  } catch {
    clearTimeout(timeoutId);
    throw new Error('Request timeout or failed');
  }
}

function isValidEmail(email: string): boolean {
  const lower = email.toLowerCase();

  // Verificar dominios a ignorar
  for (const domain of IGNORE_EMAIL_DOMAINS) {
    if (lower.includes(domain)) return false;
  }

  // Verificar que no sea un archivo de imagen/recurso
  if (/\.(png|jpg|jpeg|gif|svg|webp|css|js)$/i.test(email)) return false;

  // Verificar formato básico
  const parts = email.split('@');
  if (parts.length !== 2) return false;
  if (parts[0].length < 2 || parts[1].length < 4) return false;

  return true;
}

function isGenericEmail(email: string): boolean {
  const lower = email.toLowerCase();
  return GENERIC_EMAILS.some(generic => lower.startsWith(generic));
}

function cleanPhone(phone: string): string {
  return phone.replace(/[\s.-]/g, '').replace(/^\+/, '+');
}

function formatPhoneDisplay(phone: string): string {
  const cleaned = phone.replace(/[^\d+]/g, '');
  if (cleaned.startsWith('+34') && cleaned.length === 12) {
    return `+34 ${cleaned.slice(3, 6)} ${cleaned.slice(6, 9)} ${cleaned.slice(9)}`;
  }
  if (cleaned.length === 9) {
    return `${cleaned.slice(0, 3)} ${cleaned.slice(3, 6)} ${cleaned.slice(6)}`;
  }
  return cleaned;
}

function isValidPhone(phone: string): boolean {
  const cleaned = phone.replace(/[^\d]/g, '');
  // Al menos 9 dígitos
  if (cleaned.length < 9 || cleaned.length > 15) return false;
  // No puede ser todo el mismo número
  if (/^(\d)\1+$/.test(cleaned)) return false;
  // No puede empezar con 0 múltiples
  if (/^0{2,}/.test(cleaned)) return false;
  return true;
}

async function verifyWebsite(url: string): Promise<{ status: number; accessible: boolean }> {
  try {
    const response = await fetchWithTimeout(url, 8000);
    return { status: response.status, accessible: response.ok };
  } catch {
    return { status: 0, accessible: false };
  }
}

async function verifyEmailDomain(email: string): Promise<boolean> {
  const domain = email.split('@')[1];
  if (!domain) return false;

  try {
    const response = await fetchWithTimeout(`https://${domain}`, 5000);
    return response.status < 500;
  } catch {
    try {
      const response = await fetchWithTimeout(`http://${domain}`, 5000);
      return response.status < 500;
    } catch {
      return false;
    }
  }
}

// Búsqueda en DuckDuckGo HTML
async function searchDuckDuckGo(query: string, location: string): Promise<BusinessResult[]> {
  const results: BusinessResult[] = [];
  const searchQuery = encodeURIComponent(`${query} ${location} contacto email teléfono`);

  try {
    const response = await fetchWithTimeout(
      `https://html.duckduckgo.com/html/?q=${searchQuery}`,
      15000
    );

    if (!response.ok) return results;

    const html = await response.text();
    const $ = cheerio.load(html);

    $('.result').each((_, element) => {
      const title = $(element).find('.result__title').text().trim();
      const link = $(element).find('.result__url').text().trim();
      const snippet = $(element).find('.result__snippet').text().trim();

      if (title && link) {
        const emails = snippet.match(EMAIL_REGEX) || [];
        const phones = snippet.match(PHONE_REGEX_ES) || snippet.match(PHONE_REGEX_INTL) || [];

        const validEmails = emails.filter(e => isValidEmail(e));
        const validPhones = phones.filter(p => isValidPhone(p));

        if (validEmails.length > 0 || validPhones.length > 0 || link) {
          results.push({
            name: title.substring(0, 100),
            email: validEmails[0],
            emailVerified: false,
            phone: validPhones[0] ? formatPhoneDisplay(validPhones[0]) : undefined,
            phoneVerified: validPhones.length > 0,
            website: link.startsWith('http') ? link : `https://${link}`,
            source: 'DuckDuckGo',
            scrapedAt: new Date().toISOString(),
          });
        }
      }
    });
  } catch (error) {
    console.error('Error searching DuckDuckGo:', error);
  }

  return results;
}

// Búsqueda en Páginas Amarillas España
async function scrapePaginasAmarillas(query: string, location: string): Promise<BusinessResult[]> {
  const results: BusinessResult[] = [];
  const searchQuery = encodeURIComponent(query);
  const searchLocation = encodeURIComponent(location);

  try {
    const response = await fetchWithTimeout(
      `https://www.paginasamarillas.es/search/${searchQuery}/all-ma/${searchLocation}/all-is/${searchLocation}/all-ba/all-pu/all-nc/1`,
      15000
    );

    if (!response.ok) return results;

    const html = await response.text();
    const $ = cheerio.load(html);

    // Selector principal para items
    $('[class*="listado-item"], .yellow-result, .business-card').each((_, element) => {
      const name = $(element).find('[class*="titulo"], h2, h3').first().text().trim();
      const phoneEl = $(element).find('[class*="phone"], [href^="tel:"], .telefono');
      const phone = phoneEl.attr('href')?.replace('tel:', '') || phoneEl.text().trim();
      const address = $(element).find('[class*="direccion"], .address').text().trim();
      const website = $(element).find('a[href*="http"]:not([href*="paginasamarillas"])').attr('href');

      if (name && name.length > 2) {
        results.push({
          name: name.substring(0, 100),
          phone: phone && isValidPhone(phone) ? formatPhoneDisplay(phone) : undefined,
          phoneVerified: !!phone && isValidPhone(phone),
          address: address || undefined,
          website: website || undefined,
          emailVerified: false,
          source: 'Páginas Amarillas',
          scrapedAt: new Date().toISOString(),
        });
      }
    });
  } catch (error) {
    console.error('Error scraping Páginas Amarillas:', error);
  }

  return results;
}

// Búsqueda en QDQ (otro directorio español)
async function scrapeQDQ(query: string, location: string): Promise<BusinessResult[]> {
  const results: BusinessResult[] = [];
  const searchQuery = encodeURIComponent(query);
  const searchLocation = encodeURIComponent(location);

  try {
    const response = await fetchWithTimeout(
      `https://www.qdq.com/search/?what=${searchQuery}&where=${searchLocation}`,
      15000
    );

    if (!response.ok) return results;

    const html = await response.text();
    const $ = cheerio.load(html);

    $('.business-item, .result-item, [itemtype*="LocalBusiness"]').each((_, element) => {
      const name = $(element).find('[itemprop="name"], h2, h3, .business-name').first().text().trim();
      const phone = $(element).find('[itemprop="telephone"], [href^="tel:"]').first().text().trim() ||
                    $(element).find('[href^="tel:"]').attr('href')?.replace('tel:', '');
      const email = $(element).find('[itemprop="email"], [href^="mailto:"]').attr('href')?.replace('mailto:', '');
      const address = $(element).find('[itemprop="address"], .address').text().trim();
      const website = $(element).find('[itemprop="url"]:not([href*="qdq"]), a[rel="nofollow"]').attr('href');

      if (name && name.length > 2) {
        results.push({
          name: name.substring(0, 100),
          email: email && isValidEmail(email) ? email : undefined,
          emailVerified: false,
          phone: phone && isValidPhone(phone) ? formatPhoneDisplay(phone) : undefined,
          phoneVerified: !!phone && isValidPhone(phone),
          address: address || undefined,
          website: website || undefined,
          source: 'QDQ',
          scrapedAt: new Date().toISOString(),
        });
      }
    });
  } catch (error) {
    console.error('Error scraping QDQ:', error);
  }

  return results;
}

// Búsqueda en Europages
async function scrapeEuropages(query: string, location: string): Promise<BusinessResult[]> {
  const results: BusinessResult[] = [];
  const searchQuery = encodeURIComponent(`${query} ${location}`);

  try {
    const response = await fetchWithTimeout(
      `https://www.europages.es/empresas/${searchQuery}.html`,
      15000
    );

    if (!response.ok) return results;

    const html = await response.text();
    const $ = cheerio.load(html);

    $('.company-item, .company-card, [itemtype*="Organization"]').each((_, element) => {
      const name = $(element).find('[itemprop="name"], .company-name, h2, h3').first().text().trim();
      const phone = $(element).find('[itemprop="telephone"]').text().trim();
      const email = $(element).find('[itemprop="email"]').text().trim();
      const website = $(element).find('[itemprop="url"]:not([href*="europages"])').attr('href');
      const address = $(element).find('[itemprop="address"]').text().trim();

      if (name && name.length > 2) {
        results.push({
          name: name.substring(0, 100),
          email: email && isValidEmail(email) ? email : undefined,
          emailVerified: false,
          phone: phone && isValidPhone(phone) ? formatPhoneDisplay(phone) : undefined,
          phoneVerified: !!phone && isValidPhone(phone),
          address: address || undefined,
          website: website || undefined,
          source: 'Europages',
          scrapedAt: new Date().toISOString(),
        });
      }
    });
  } catch (error) {
    console.error('Error scraping Europages:', error);
  }

  return results;
}

// Scraping profundo de una web individual
async function scrapeWebsiteDeep(url: string): Promise<Partial<BusinessResult>> {
  const result: Partial<BusinessResult> = {};

  try {
    if (!url.startsWith('http')) {
      url = `https://${url}`;
    }

    const response = await fetchWithTimeout(url, 12000);
    if (!response.ok) {
      result.websiteStatus = response.status;
      return result;
    }

    result.websiteStatus = response.status;
    const html = await response.text();
    const $ = cheerio.load(html);

    // Remover scripts y estilos
    $('script, style, noscript, svg, path').remove();
    const bodyText = $('body').text().replace(/\s+/g, ' ');

    // Extraer emails del HTML
    const hrefEmails = $('a[href^="mailto:"]').map((_, el) => {
      const href = $(el).attr('href') || '';
      return href.replace('mailto:', '').split('?')[0].toLowerCase();
    }).get();

    // Emails del texto
    const textEmails = bodyText.match(EMAIL_REGEX) || [];

    // Combinar y filtrar
    const allEmails = [...new Set([...hrefEmails, ...textEmails])].filter(e => isValidEmail(e));
    const personalEmails = allEmails.filter(e => !isGenericEmail(e));
    const genericEmails = allEmails.filter(e => isGenericEmail(e));

    result.email = personalEmails[0] || genericEmails[0];

    // Extraer teléfonos
    const hrefPhones = $('a[href^="tel:"]').map((_, el) => {
      const href = $(el).attr('href') || '';
      return href.replace('tel:', '').replace(/\s/g, '');
    }).get();

    const textPhones = bodyText.match(PHONE_REGEX_ES) || bodyText.match(PHONE_REGEX_INTL) || [];

    const allPhones = [...new Set([...hrefPhones, ...textPhones])].filter(p => isValidPhone(p));
    result.phone = allPhones[0] ? formatPhoneDisplay(allPhones[0]) : undefined;

    // Buscar nombre del propietario/responsable
    const ownerPatterns = [
      /(?:propietario|dueño|director|gerente|ceo|fundador|responsable|titular)[:\s]+([A-ZÁÉÍÓÚÑ][a-záéíóúñ]+(?:\s+[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+){1,3})/gi,
      /(?:Dr\.|Dra\.|D\.|Dña\.|Don|Doña)\s+([A-ZÁÉÍÓÚÑ][a-záéíóúñ]+(?:\s+[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+){1,3})/g,
      /(?:equipo|nuestro\s+equipo)[^.]*?([A-ZÁÉÍÓÚÑ][a-záéíóúñ]+(?:\s+[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+){1,2})/gi,
    ];

    for (const pattern of ownerPatterns) {
      const matches = bodyText.matchAll(pattern);
      for (const match of matches) {
        if (match[1] && match[1].length > 4 && match[1].length < 50) {
          result.owner = match[1].trim();
          break;
        }
      }
      if (result.owner) break;
    }

    // URLs de páginas adicionales a revisar
    const pagesToCheck = [
      '/contacto', '/contact', '/contactar', '/contactanos',
      '/sobre-nosotros', '/about', '/quienes-somos', '/about-us',
      '/equipo', '/team', '/nuestro-equipo'
    ];

    // Buscar enlaces de contacto en la página
    const contactLinks: string[] = [];
    $('a').each((_, el) => {
      const href = $(el).attr('href') || '';
      const text = $(el).text().toLowerCase();
      if (text.includes('contacto') || text.includes('contact') ||
          href.includes('contact') || href.includes('contacto')) {
        contactLinks.push(href);
      }
    });

    // Scrapear páginas adicionales si no tenemos email
    if (!result.email || !result.phone) {
      const baseUrl = new URL(url).origin;
      const urlsToTry = [
        ...contactLinks.slice(0, 2).map(l => l.startsWith('http') ? l : `${baseUrl}${l.startsWith('/') ? '' : '/'}${l}`),
        ...pagesToCheck.slice(0, 3).map(p => `${baseUrl}${p}`)
      ];

      for (const pageUrl of urlsToTry.slice(0, 3)) {
        try {
          const pageResponse = await fetchWithTimeout(pageUrl, 8000);
          if (pageResponse.ok) {
            const pageHtml = await pageResponse.text();
            const $page = cheerio.load(pageHtml);
            $page('script, style').remove();
            const pageText = $page('body').text();

            if (!result.email) {
              const pageEmails = pageText.match(EMAIL_REGEX) || [];
              const pageMailtoEmails = $page('a[href^="mailto:"]').map((_, el) =>
                ($page(el).attr('href') || '').replace('mailto:', '').split('?')[0]
              ).get();

              const validPageEmails = [...new Set([...pageMailtoEmails, ...pageEmails])].filter(e => isValidEmail(e));
              const personalPageEmails = validPageEmails.filter(e => !isGenericEmail(e));
              result.email = personalPageEmails[0] || validPageEmails[0] || result.email;
            }

            if (!result.phone) {
              const pagePhones = pageText.match(PHONE_REGEX_ES) || [];
              const validPagePhones = pagePhones.filter(p => isValidPhone(p));
              result.phone = validPagePhones[0] ? formatPhoneDisplay(validPagePhones[0]) : result.phone;
            }

            if (!result.owner) {
              for (const pattern of ownerPatterns) {
                const matches = pageText.matchAll(pattern);
                for (const match of matches) {
                  if (match[1] && match[1].length > 4 && match[1].length < 50) {
                    result.owner = match[1].trim();
                    break;
                  }
                }
                if (result.owner) break;
              }
            }

            if (result.email && result.phone) break;
          }
        } catch {
          // Continuar con siguiente URL
        }
      }
    }

  } catch (error) {
    console.error('Error scraping website:', error);
  }

  return result;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { query, location, maxResults = 20, verifyContacts = true } = body;

    if (!query || !location) {
      return NextResponse.json(
        { error: 'Query and location are required' },
        { status: 400 }
      );
    }

    console.log(`Scraping: ${query} in ${location}`);

    // Ejecutar todas las búsquedas en paralelo
    const [duckduckgoResults, paginasAmarillasResults, qdqResults, europagesResults] = await Promise.all([
      searchDuckDuckGo(query, location),
      scrapePaginasAmarillas(query, location),
      scrapeQDQ(query, location),
      scrapeEuropages(query, location),
    ]);

    // Combinar resultados
    const allResults = [
      ...paginasAmarillasResults, // Prioridad a directorios específicos
      ...qdqResults,
      ...europagesResults,
      ...duckduckgoResults,
    ];

    // Eliminar duplicados por nombre similar
    const uniqueResults: BusinessResult[] = [];
    const seenNames = new Set<string>();

    for (const result of allResults) {
      const normalizedName = result.name.toLowerCase()
        .replace(/[^a-záéíóúñ0-9\s]/g, '')
        .replace(/\s+/g, ' ')
        .trim();

      // Crear una key más flexible para detectar duplicados
      const nameKey = normalizedName.split(' ').slice(0, 3).join('');

      if (!seenNames.has(nameKey) && normalizedName.length > 3) {
        seenNames.add(nameKey);
        uniqueResults.push(result);
      }
    }

    // Limitar resultados
    let finalResults = uniqueResults.slice(0, maxResults);

    // Enriquecer y verificar cada resultado
    if (verifyContacts) {
      const enrichmentPromises = finalResults.map(async (result) => {
        // Si tiene website, scrapearlo para más info
        if (result.website) {
          const websiteData = await scrapeWebsiteDeep(result.website);

          // Actualizar con datos del website
          if (websiteData.email && !result.email) {
            result.email = websiteData.email;
          } else if (websiteData.email && result.email && isGenericEmail(result.email) && !isGenericEmail(websiteData.email)) {
            // Preferir email personal sobre genérico
            result.email = websiteData.email;
          }

          if (websiteData.phone && !result.phone) {
            result.phone = websiteData.phone;
            result.phoneVerified = true;
          }

          if (websiteData.owner) {
            result.owner = websiteData.owner;
          }

          if (websiteData.websiteStatus !== undefined) {
            result.websiteStatus = websiteData.websiteStatus;
          }
        }

        // Verificar email
        if (result.email) {
          result.emailVerified = await verifyEmailDomain(result.email);
        }

        // Verificar website si no lo hemos hecho
        if (result.website && result.websiteStatus === undefined) {
          const { status, accessible } = await verifyWebsite(result.website);
          result.websiteStatus = status;
          if (!accessible) {
            result.website = undefined;
          }
        }

        return result;
      });

      finalResults = await Promise.all(enrichmentPromises);
    }

    // Filtrar resultados sin contacto útil y webs inaccesibles
    const validResults = finalResults.filter(r => {
      // Debe tener al menos un método de contacto
      const hasContact = (r.email && r.emailVerified) || r.phone;
      // Si tiene web, debe estar online
      const websiteOk = !r.website || (r.websiteStatus && r.websiteStatus >= 200 && r.websiteStatus < 400);
      return hasContact && websiteOk;
    });

    // Ordenar: primero los que tienen email verificado Y teléfono
    validResults.sort((a, b) => {
      const scoreA = (a.email && a.emailVerified ? 2 : 0) + (a.phone ? 1 : 0) + (a.owner ? 1 : 0);
      const scoreB = (b.email && b.emailVerified ? 2 : 0) + (b.phone ? 1 : 0) + (b.owner ? 1 : 0);
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
    return NextResponse.json(
      { error: 'Internal server error during scraping' },
      { status: 500 }
    );
  }
}

export async function GET() {
  return NextResponse.json({
    message: 'Syntalys Business Contact Scraper API',
    version: '1.0.0',
    usage: 'POST with { query: string, location: string, maxResults?: number, verifyContacts?: boolean }',
    example: {
      query: 'veterinarios',
      location: 'Madrid',
      maxResults: 20,
      verifyContacts: true,
    },
    sources: ['DuckDuckGo', 'Páginas Amarillas', 'QDQ', 'Europages'],
  });
}
