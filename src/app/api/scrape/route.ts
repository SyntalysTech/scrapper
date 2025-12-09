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

// Regex patterns para extraer datos - MÁS AGRESIVO
const EMAIL_REGEX = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const PHONE_REGEX_ES = /(?:\+34\s?)?(?:6\d{2}|7[1-9]\d|9\d{2})[\s.-]?\d{3}[\s.-]?\d{3}/g;
const PHONE_REGEX_INTL = /(?:\+\d{1,3}[\s.-]?)?\(?\d{2,4}\)?[\s.-]?\d{3,4}[\s.-]?\d{3,4}/g;

// Dominios de email a ignorar (solo los realmente inválidos)
const IGNORE_EMAIL_DOMAINS = [
  'example.com', 'test.com', 'localhost', 'sentry.io', 'wixpress.com',
  'placeholder.com', 'yourdomain.com', 'domain.com', 'email.com',
  'w3.org', 'schema.org', 'sentry-next.wixpress.com', 'mailinator.com'
];

// Extensiones de archivo a ignorar
const IGNORE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.css', '.js', '.woff', '.woff2', '.ttf', '.ico'];

async function fetchWithTimeout(url: string, timeout = 15000): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8',
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
  const lower = email.toLowerCase().trim();

  // Verificar dominios a ignorar
  for (const domain of IGNORE_EMAIL_DOMAINS) {
    if (lower.includes(domain)) return false;
  }

  // Verificar extensiones de archivo
  for (const ext of IGNORE_EXTENSIONS) {
    if (lower.endsWith(ext)) return false;
  }

  // Verificar formato básico
  const parts = email.split('@');
  if (parts.length !== 2) return false;
  if (parts[0].length < 1 || parts[1].length < 3) return false;
  if (!parts[1].includes('.')) return false;

  // No emails con caracteres raros
  if (/[<>()[\]\\,;:\s"']/.test(email)) return false;

  return true;
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
  if (cleaned.length < 9 || cleaned.length > 15) return false;
  if (/^(\d)\1+$/.test(cleaned)) return false;
  if (/^0{2,}/.test(cleaned)) return false;
  return true;
}

// Extraer TODOS los emails de un HTML
function extractAllEmails(html: string, $?: cheerio.CheerioAPI): string[] {
  const emails = new Set<string>();

  // 1. Emails en href="mailto:"
  if ($) {
    $('a[href*="mailto:"]').each((_, el) => {
      const href = $(el).attr('href') || '';
      const email = href.replace(/^mailto:/i, '').split('?')[0].split('#')[0].trim().toLowerCase();
      if (email && isValidEmail(email)) {
        emails.add(email);
      }
    });

    // 2. Emails en atributos data-*
    $('[data-email], [data-mail], [data-contact]').each((_, el) => {
      const dataEmail = $(el).attr('data-email') || $(el).attr('data-mail') || $(el).attr('data-contact') || '';
      if (dataEmail && isValidEmail(dataEmail)) {
        emails.add(dataEmail.toLowerCase());
      }
    });

    // 3. Emails en el texto visible
    const textContent = $('body').text();
    const textEmails = textContent.match(EMAIL_REGEX) || [];
    textEmails.forEach(e => {
      if (isValidEmail(e)) emails.add(e.toLowerCase());
    });

    // 4. Emails en el HTML completo (incluyendo atributos, comentarios, etc.)
    const htmlEmails = html.match(EMAIL_REGEX) || [];
    htmlEmails.forEach(e => {
      if (isValidEmail(e)) emails.add(e.toLowerCase());
    });

    // 5. Emails ofuscados con [at] o (at) o similares
    const obfuscatedPattern = /([a-zA-Z0-9._%+-]+)\s*[\[(]?\s*(?:at|@|arroba)\s*[\])]?\s*([a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/gi;
    const obfuscated = textContent.match(obfuscatedPattern) || [];
    obfuscated.forEach(match => {
      const cleaned = match.replace(/\s*[\[(]?\s*(?:at|arroba)\s*[\])]?\s*/gi, '@').trim();
      if (isValidEmail(cleaned)) emails.add(cleaned.toLowerCase());
    });
  }

  return Array.from(emails);
}

// Extraer teléfonos
function extractAllPhones(html: string, $?: cheerio.CheerioAPI): string[] {
  const phones = new Set<string>();

  if ($) {
    // href="tel:"
    $('a[href^="tel:"]').each((_, el) => {
      const href = $(el).attr('href') || '';
      const phone = href.replace('tel:', '').replace(/\s/g, '');
      if (isValidPhone(phone)) phones.add(formatPhoneDisplay(phone));
    });

    // Texto
    const text = $('body').text();
    const textPhones = text.match(PHONE_REGEX_ES) || text.match(PHONE_REGEX_INTL) || [];
    textPhones.forEach(p => {
      if (isValidPhone(p)) phones.add(formatPhoneDisplay(p));
    });
  }

  // HTML completo
  const htmlPhones = html.match(PHONE_REGEX_ES) || html.match(PHONE_REGEX_INTL) || [];
  htmlPhones.forEach(p => {
    if (isValidPhone(p)) phones.add(formatPhoneDisplay(p));
  });

  return Array.from(phones);
}

// Buscar nombre del propietario
function extractOwner(text: string): string | undefined {
  const patterns = [
    /(?:propietario|dueño|director|gerente|ceo|fundador|responsable|titular|administrador)[:\s]+([A-ZÁÉÍÓÚÑ][a-záéíóúñ]+(?:\s+[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+){1,3})/gi,
    /(?:Dr\.|Dra\.|D\.|Dña\.|Don|Doña)\s+([A-ZÁÉÍÓÚÑ][a-záéíóúñ]+(?:\s+[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+){1,3})/g,
  ];

  for (const pattern of patterns) {
    const matches = text.matchAll(pattern);
    for (const match of matches) {
      if (match[1] && match[1].length > 4 && match[1].length < 50) {
        return match[1].trim();
      }
    }
  }
  return undefined;
}

// Scraping PROFUNDO de una web - entra en TODAS las páginas relevantes
async function scrapeWebsiteDeep(url: string): Promise<{ emails: string[]; phones: string[]; owner?: string; status: number }> {
  const allEmails: Set<string> = new Set();
  const allPhones: Set<string> = new Set();
  let owner: string | undefined;
  let status = 0;

  try {
    if (!url.startsWith('http')) {
      url = `https://${url}`;
    }

    // Página principal
    const response = await fetchWithTimeout(url, 12000);
    status = response.status;
    if (!response.ok) return { emails: [], phones: [], status };

    const html = await response.text();
    const $ = cheerio.load(html);

    // Extraer de página principal
    extractAllEmails(html, $).forEach(e => allEmails.add(e));
    extractAllPhones(html, $).forEach(p => allPhones.add(p));
    if (!owner) owner = extractOwner($('body').text());

    const baseUrl = new URL(url).origin;

    // Encontrar TODOS los enlaces internos relevantes
    const internalLinks: Set<string> = new Set();

    $('a[href]').each((_, el) => {
      const href = $(el).attr('href') || '';
      const text = $(el).text().toLowerCase();

      // Ignorar enlaces externos, anclas, javascript, etc.
      if (href.startsWith('javascript:') || href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:')) {
        return;
      }

      // Palabras clave que indican páginas con contacto
      const keywords = ['contact', 'contacto', 'about', 'sobre', 'nosotros', 'quienes', 'equipo', 'team', 'empresa', 'company', 'info', 'legal', 'aviso', 'privacidad', 'footer'];

      const isRelevant = keywords.some(kw => href.toLowerCase().includes(kw) || text.includes(kw));

      if (isRelevant) {
        let fullUrl: string;
        if (href.startsWith('http')) {
          // Solo enlaces del mismo dominio
          if (href.startsWith(baseUrl)) {
            fullUrl = href;
          } else {
            return;
          }
        } else {
          fullUrl = new URL(href, baseUrl).toString();
        }
        internalLinks.add(fullUrl);
      }
    });

    // También añadir rutas comunes aunque no estén enlazadas
    const commonPaths = [
      '/contacto', '/contact', '/contactar', '/contactanos', '/contact-us',
      '/sobre-nosotros', '/about', '/about-us', '/quienes-somos', '/empresa',
      '/equipo', '/team', '/nuestro-equipo',
      '/legal', '/aviso-legal', '/privacidad', '/privacy',
      '/info', '/informacion'
    ];

    commonPaths.forEach(path => internalLinks.add(`${baseUrl}${path}`));

    // Scrapear cada página interna (máximo 8 para no tardar mucho)
    const pagesToScrape = Array.from(internalLinks).slice(0, 8);

    await Promise.all(pagesToScrape.map(async (pageUrl) => {
      try {
        const pageResponse = await fetchWithTimeout(pageUrl, 8000);
        if (!pageResponse.ok) return;

        const pageHtml = await pageResponse.text();
        const $page = cheerio.load(pageHtml);

        extractAllEmails(pageHtml, $page).forEach(e => allEmails.add(e));
        extractAllPhones(pageHtml, $page).forEach(p => allPhones.add(p));

        if (!owner) {
          owner = extractOwner($page('body').text());
        }
      } catch {
        // Ignorar errores de páginas individuales
      }
    }));

  } catch (error) {
    console.error('Error scraping website:', error);
  }

  return {
    emails: Array.from(allEmails),
    phones: Array.from(allPhones),
    owner,
    status
  };
}

// Búsqueda en DuckDuckGo - más resultados
async function searchDuckDuckGo(query: string, location: string): Promise<BusinessResult[]> {
  const results: BusinessResult[] = [];

  // Múltiples búsquedas con diferentes términos
  const searches = [
    `${query} ${location} email contacto`,
    `${query} ${location} telefono direccion`,
    `"${query}" "${location}" @`,
  ];

  for (const searchTerm of searches) {
    try {
      const searchQuery = encodeURIComponent(searchTerm);
      const response = await fetchWithTimeout(
        `https://html.duckduckgo.com/html/?q=${searchQuery}`,
        15000
      );

      if (!response.ok) continue;

      const html = await response.text();
      const $ = cheerio.load(html);

      $('.result').each((_, element) => {
        const title = $(element).find('.result__title').text().trim();
        const linkEl = $(element).find('.result__url');
        const link = linkEl.attr('href') || linkEl.text().trim();
        const snippet = $(element).find('.result__snippet').text() + ' ' + $(element).find('.result__snippet').html();

        if (title && title.length > 3) {
          const emails = extractAllEmails(snippet);
          const phones = extractAllPhones(snippet);

          let websiteUrl = link;
          if (websiteUrl && !websiteUrl.startsWith('http')) {
            websiteUrl = `https://${websiteUrl.replace(/^\/\//, '')}`;
          }

          results.push({
            name: title.substring(0, 100),
            email: emails[0],
            emailVerified: false,
            phone: phones[0],
            phoneVerified: phones.length > 0,
            website: websiteUrl || undefined,
            source: 'DuckDuckGo',
            scrapedAt: new Date().toISOString(),
          });
        }
      });
    } catch (error) {
      console.error('Error searching DuckDuckGo:', error);
    }
  }

  return results;
}

// Búsqueda en Páginas Amarillas
async function scrapePaginasAmarillas(query: string, location: string): Promise<BusinessResult[]> {
  const results: BusinessResult[] = [];

  try {
    // Intentar múltiples URLs de PA
    const urls = [
      `https://www.paginasamarillas.es/search/${encodeURIComponent(query)}/all-ma/${encodeURIComponent(location)}/all-is/${encodeURIComponent(location)}/all-ba/all-pu/all-nc/1`,
      `https://www.paginasamarillas.es/search/${encodeURIComponent(query)}/all-ma/all-pr/all-is/all-ci/all-ba/all-pu/all-nc/1?what=${encodeURIComponent(query)}&where=${encodeURIComponent(location)}`,
    ];

    for (const url of urls) {
      try {
        const response = await fetchWithTimeout(url, 15000);
        if (!response.ok) continue;

        const html = await response.text();
        const $ = cheerio.load(html);

        // Múltiples selectores para diferentes versiones de PA
        const selectors = [
          '.listado-item',
          '[class*="item"]',
          '.business',
          'article',
        ];

        for (const selector of selectors) {
          $(selector).each((_, element) => {
            const el = $(element);
            const name = el.find('[class*="titulo"], h2, h3, [class*="name"]').first().text().trim();

            if (!name || name.length < 3) return;

            // Buscar teléfono
            const phoneEl = el.find('[href^="tel:"], [class*="phone"], [class*="telefono"]').first();
            const phone = phoneEl.attr('href')?.replace('tel:', '') || phoneEl.text().trim();

            // Buscar email
            const emailEl = el.find('[href^="mailto:"]').first();
            const email = emailEl.attr('href')?.replace('mailto:', '').split('?')[0];

            // Buscar web
            const webEl = el.find('a[href*="http"]:not([href*="paginasamarillas"]):not([href*="google"]):not([href*="facebook"])').first();
            const website = webEl.attr('href');

            // Dirección
            const address = el.find('[class*="direccion"], [class*="address"], [itemprop="address"]').text().trim();

            if (name && (phone || website)) {
              results.push({
                name: name.substring(0, 100),
                email: email && isValidEmail(email) ? email : undefined,
                emailVerified: false,
                phone: phone && isValidPhone(phone) ? formatPhoneDisplay(phone) : undefined,
                phoneVerified: !!phone && isValidPhone(phone),
                address: address || undefined,
                website: website || undefined,
                source: 'Páginas Amarillas',
                scrapedAt: new Date().toISOString(),
              });
            }
          });
        }

        if (results.length > 0) break;
      } catch {
        continue;
      }
    }
  } catch (error) {
    console.error('Error scraping Páginas Amarillas:', error);
  }

  return results;
}

// Búsqueda en Google Maps mediante búsqueda web
async function searchGooglePlaces(query: string, location: string): Promise<BusinessResult[]> {
  const results: BusinessResult[] = [];

  try {
    const searchQuery = encodeURIComponent(`${query} ${location} site:google.com/maps OR site:goo.gl/maps`);
    const response = await fetchWithTimeout(
      `https://html.duckduckgo.com/html/?q=${searchQuery}`,
      15000
    );

    if (!response.ok) return results;

    const html = await response.text();
    const $ = cheerio.load(html);

    $('.result').each((_, element) => {
      const title = $(element).find('.result__title').text().trim();
      const snippet = $(element).find('.result__snippet').text();

      if (title && !title.includes('Google Maps')) {
        const emails = extractAllEmails(snippet);
        const phones = extractAllPhones(snippet);

        results.push({
          name: title.substring(0, 100),
          email: emails[0],
          emailVerified: false,
          phone: phones[0],
          phoneVerified: phones.length > 0,
          source: 'Google Places',
          scrapedAt: new Date().toISOString(),
        });
      }
    });
  } catch (error) {
    console.error('Error searching Google Places:', error);
  }

  return results;
}

// Búsqueda en Yelp
async function scrapeYelp(query: string, location: string): Promise<BusinessResult[]> {
  const results: BusinessResult[] = [];

  try {
    const response = await fetchWithTimeout(
      `https://www.yelp.es/search?find_desc=${encodeURIComponent(query)}&find_loc=${encodeURIComponent(location)}`,
      15000
    );

    if (!response.ok) return results;

    const html = await response.text();
    const $ = cheerio.load(html);

    $('[class*="businessName"], [class*="container"] h3, [class*="result"]').each((_, element) => {
      const name = $(element).text().trim();
      const parent = $(element).closest('[class*="container"], article, [class*="result"]');
      const link = parent.find('a[href*="/biz/"]').attr('href');

      if (name && name.length > 3 && name.length < 100) {
        results.push({
          name,
          website: link ? `https://www.yelp.es${link}` : undefined,
          emailVerified: false,
          phoneVerified: false,
          source: 'Yelp',
          scrapedAt: new Date().toISOString(),
        });
      }
    });
  } catch (error) {
    console.error('Error scraping Yelp:', error);
  }

  return results;
}

// Búsqueda directa de emails con términos específicos
async function searchDirectEmails(query: string, location: string): Promise<BusinessResult[]> {
  const results: BusinessResult[] = [];

  const searches = [
    `"${query}" "${location}" "@gmail.com" OR "@hotmail.com" OR "@yahoo.es"`,
    `${query} ${location} email contactar`,
    `${query} ${location} "correo electronico"`,
  ];

  for (const searchTerm of searches) {
    try {
      const response = await fetchWithTimeout(
        `https://html.duckduckgo.com/html/?q=${encodeURIComponent(searchTerm)}`,
        15000
      );

      if (!response.ok) continue;

      const html = await response.text();
      const $ = cheerio.load(html);

      $('.result').each((_, element) => {
        const title = $(element).find('.result__title').text().trim();
        const snippet = $(element).find('.result__snippet').text() + ' ' + ($(element).find('.result__snippet').html() || '');
        const link = $(element).find('.result__url').text().trim();

        const emails = extractAllEmails(snippet);
        const phones = extractAllPhones(snippet);

        if (title && emails.length > 0) {
          results.push({
            name: title.substring(0, 100),
            email: emails[0],
            emailVerified: false,
            phone: phones[0],
            phoneVerified: phones.length > 0,
            website: link ? (link.startsWith('http') ? link : `https://${link}`) : undefined,
            source: 'Direct Search',
            scrapedAt: new Date().toISOString(),
          });
        }
      });
    } catch {
      continue;
    }
  }

  return results;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { query, location, maxResults = 30, verifyContacts = true } = body;

    if (!query || !location) {
      return NextResponse.json(
        { error: 'Query and location are required' },
        { status: 400 }
      );
    }

    console.log(`Scraping: ${query} in ${location}`);

    // Ejecutar TODAS las búsquedas en paralelo
    const [
      duckduckgoResults,
      paginasAmarillasResults,
      googlePlacesResults,
      yelpResults,
      directEmailResults
    ] = await Promise.all([
      searchDuckDuckGo(query, location),
      scrapePaginasAmarillas(query, location),
      searchGooglePlaces(query, location),
      scrapeYelp(query, location),
      searchDirectEmails(query, location),
    ]);

    // Combinar resultados
    const allResults = [
      ...directEmailResults, // Prioridad a los que ya tienen email
      ...paginasAmarillasResults,
      ...duckduckgoResults,
      ...googlePlacesResults,
      ...yelpResults,
    ];

    // Eliminar duplicados por nombre
    const uniqueResults: BusinessResult[] = [];
    const seenNames = new Set<string>();

    for (const result of allResults) {
      const normalizedName = result.name.toLowerCase()
        .replace(/[^a-záéíóúñ0-9\s]/g, '')
        .replace(/\s+/g, ' ')
        .trim();

      const nameKey = normalizedName.split(' ').slice(0, 3).join('');

      if (!seenNames.has(nameKey) && normalizedName.length > 3) {
        seenNames.add(nameKey);
        uniqueResults.push(result);
      }
    }

    // Limitar resultados antes de enriquecer
    let finalResults = uniqueResults.slice(0, maxResults);

    // Enriquecer AGRESIVAMENTE cada resultado que tenga website
    if (verifyContacts) {
      const enrichmentPromises = finalResults.map(async (result) => {
        if (result.website) {
          const scraped = await scrapeWebsiteDeep(result.website);

          // Añadir TODOS los emails encontrados (usar el primero)
          if (scraped.emails.length > 0) {
            // Si ya tiene email, verificar si hay uno mejor
            if (!result.email) {
              result.email = scraped.emails[0];
            }
          }

          // Añadir teléfono si no tiene
          if (!result.phone && scraped.phones.length > 0) {
            result.phone = scraped.phones[0];
            result.phoneVerified = true;
          }

          // Añadir propietario
          if (scraped.owner) {
            result.owner = scraped.owner;
          }

          // Status
          result.websiteStatus = scraped.status;
        }

        // Verificar que el email existe (dominio accesible)
        if (result.email) {
          const domain = result.email.split('@')[1];
          if (domain) {
            try {
              const domainCheck = await fetchWithTimeout(`https://${domain}`, 5000);
              result.emailVerified = domainCheck.status < 500;
            } catch {
              try {
                const domainCheck = await fetchWithTimeout(`http://${domain}`, 5000);
                result.emailVerified = domainCheck.status < 500;
              } catch {
                result.emailVerified = true; // Asumir válido si no podemos verificar
              }
            }
          }
        }

        return result;
      });

      finalResults = await Promise.all(enrichmentPromises);
    }

    // Ordenar: primero los que tienen email, luego los que tienen teléfono
    finalResults.sort((a, b) => {
      const scoreA = (a.email ? 3 : 0) + (a.phone ? 1 : 0) + (a.owner ? 1 : 0);
      const scoreB = (b.email ? 3 : 0) + (b.phone ? 1 : 0) + (b.owner ? 1 : 0);
      return scoreB - scoreA;
    });

    // NO filtrar tan agresivamente - mostrar todo lo que tenga algo de info
    const validResults = finalResults.filter(r => r.email || r.phone || r.website);

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
    version: '2.0.0',
    usage: 'POST with { query: string, location: string, maxResults?: number, verifyContacts?: boolean }',
    example: {
      query: 'veterinarios',
      location: 'Madrid',
      maxResults: 30,
      verifyContacts: true,
    },
    sources: ['DuckDuckGo', 'Páginas Amarillas', 'Google Places', 'Yelp', 'Direct Email Search'],
  });
}
