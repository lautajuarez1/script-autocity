/**
 * CENSO AUTOCITY -> Google Sheets
 * Fase 2/3 del roadmap: censo periódico del catálogo de usados de Autocity,
 * con sincronización diferencial hacia la hoja "Stock" sin pisar la gestión
 * interna (columnas 20+: estado_marketplace, fecha_publicacion, etc.)
 *
 * Portado desde autocity_discovery.py. Misma lógica de negocio; la extracción
 * de HTML (que en Python usa BeautifulSoup con selectores CSS) acá se hace
 * con regex sobre el HTML crudo, porque Apps Script no tiene un parser de DOM
 * real. Está marcado con comentarios "⚠️" donde esto es más frágil y conviene
 * validar contra fichas reales antes de confiar en el resultado.
 *
 * SETUP:
 * 1. Extensions > Apps Script desde el Google Sheet (así queda "container-bound"
 *    y no hace falta configurar SPREADSHEET_ID).
 *    - Si preferís un proyecto de Apps Script standalone, completá SPREADSHEET_ID
 *      con el ID de la hoja (está en la URL: .../d/ESTE_ID/edit).
 * 2. Pegar este código en el editor (Code.gs).
 * 3. Correr runCenso() una vez manualmente para autorizar permisos
 *    (te va a pedir acceso a la hoja y a "conectarse a servicios externos").
 * 4. Revisar la hoja "Censo_Log" que se crea sola con el resumen de la corrida.
 * 5. Si todo se ve bien, correr createTimeTrigger() UNA VEZ para dejar el
 *    censo corriendo solo cada X horas (Fase 3). Podés cambiar la frecuencia
 *    ahí abajo o desde Triggers en el editor.
 *
 * ANTES DE CORRER CONTRA EL CATÁLOGO COMPLETO:
 * dejá TEST_MODE = true y corré con unos pocos autos primero. Comparalo contra
 * el output.json que ya generaste con el script de Python para confirmar que
 * año/km/color/combustible/transmisión/fotos salen igual. Si algo no matchea,
 * lo más probable es que haya que ajustar alguno de los regex marcados con ⚠️.
 */

// ====== CONFIG ======
const SPREADSHEET_ID = '1FJ8-v0vM4T79eqPfLhSGS-hAZA5i7TvkZeC-K8ZqGM8'; // ID configurado de tu hoja
const SHEET_NAME = 'Stock';
const LOG_SHEET_NAME = 'Censo_Log';

const BASE_URL = 'https://autocity.com.ar';
const STORE_API = BASE_URL + '/wp-json/wc/store/v1/products';
const CATEGORY_USADOS = 152;
const PER_PAGE = 100;
const REQUEST_DELAY_MS = 500;

// Filtro por sucursal: 'Córdoba' para procesar únicamente Córdoba y entrar comodísimo en los 6 min de Apps Script.
// Dejar en null para procesar todas las sucursales.
const SUCURSAL_FILTRO = 'Córdoba';

// Cantidad maxima de fichas detalladas por ejecucion.
// La cola persistente permite completar todo Cordoba en varias corridas de 6 horas.
const AUTOS_POR_EJECUCION = 60;
const CENSO_QUEUE_IDS_KEY = 'censo_queue_ids';
const CENSO_QUEUE_OFFSET_KEY = 'censo_queue_offset';

// Tipo de cambio referencial para rankear vehículos en USD contra ARS (ej: 1 USD = 1350 ARS)
const USD_TO_ARS_RATE = 1350;

const TEST_MODE = false; // false = procesa un lote; true = solo TEST_LIMIT autos
const TEST_LIMIT = 5;

const DEFAULT_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0 Safari/537.36',
  'Accept-Language': 'es-AR,es;q=0.9,en;q=0.8'
};

const BRANCHES = {
  'cordoba': 'Córdoba',
  'rio-cuarto': 'Río Cuarto',
  'villa-maria': 'Villa María',
  'san-luis': 'San Luis'
};

const VALID_FUELS = {
  'nafta': 'Nafta',
  'diesel': 'Diésel',
  'diésel': 'Diésel',
  'gnc': 'GNC',
  'nafta/gnc': 'Nafta/GNC',
  'hibrido': 'Híbrido',
  'híbrido': 'Híbrido',
  'electrico': 'Eléctrico',
  'eléctrico': 'Eléctrico'
};

// Índices de columna (1-based) — deben matchear el diseño de la hoja "Stock".
const COLS = {
  id_autocity: 1,
  marca: 2,
  modelo: 3,
  version: 4,
  anio: 5,
  kilometros: 6,
  precio: 7,
  moneda: 8,
  color: 9,
  combustible: 10,
  transmision: 11,
  sucursal: 12,
  url_autocity: 13,
  foto_portada: 14,
  fotos_galeria: 15,
  primera_vez_visto: 16,
  ultima_vez_visto: 17,
  estado_catalogo: 18,
  precio_cambio_detectado: 19,
  // --- Capa 2: Gestión interna. El censo NO escribe acá, salvo la excepción
  // puntual de requiere_reedicion cuando detecta repricing en un auto publicado.
  estado_marketplace: 20,
  fecha_publicacion: 21,
  url_marketplace: 22,
  vendedor_asignado: 23,
  leads_recibidos: 24,
  notas_internas: 25,
  requiere_reedicion: 26,
  // --- Capa 3: Contenido para Marketplace (Fase 5a - Generado automáticamente) ---
  titulo_marketplace: 27,
  precio_publicacion: 28,
  ubicacion_publicacion: 29,
  texto_copywriting: 30,
  pack_imagenes: 31,
  carroceria_marketplace: 32
};

const TOTAL_COLUMNS = Object.keys(COLS).length; // 32

// ====== CONFIGURACIÓN DE COPYWRITING & PROPUESTA COMERCIAL ======
const COPY_CONFIG = {
  telefono_whatsapp: '3513764403', // Numero de WhatsApp visible para los compradores
  credito_propio: 'Crédito propio de $12.000.000 en 12 cuotas fijas sin interés',
  financiacion_bancos: 'Financiamos hasta el 100% a través de bancos',
  permuta: 'Recibimos vehículos con sistema llave por llave',
  stock_total: '+400 autos en stock. Consultá por nuestro catálogo',
  nombre_concesionaria: 'Autocity',
  ciudad_default: 'Córdoba'
};

// ====================================================================
// ENTRY POINT
// ====================================================================

function runCenso() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) {
    Logger.log('⚠️ Ya hay otra instancia de runCenso() ejecutándose. Abortando corrida concurrente.');
    return;
  }

  try {
    const sheet = getSheet();
    const existingMap = loadExistingRows(sheet);

    let allProducts = fetchAllUsados();
    Logger.log('Total vehículos usados en catálogo general de Autocity: ' + allProducts.length);

    let cordobaProducts = allProducts;
    if (SUCURSAL_FILTRO) {
      cordobaProducts = allProducts.filter(function (product) {
        const catData = classifyCategories(product);
        return catData.sucursal === SUCURSAL_FILTRO;
      });
      Logger.log('Vehículos en sucursal "' + SUCURSAL_FILTRO + '": ' + cordobaProducts.length + ' autos.');
    }

    // Set con TODOS los IDs activos de la sucursal (para detectar bajas reales de catálogo)
    const allActiveIds = new Set(cordobaProducts.map(function (p) { return String(p.id); }));

    // Ordenamos de MAYOR a MENOR precio (unificando USD y ARS para priorizar los más caros)
    cordobaProducts.sort(function (a, b) {
      return getComparablePrice(b) - getComparablePrice(a);
    });

    let productsToProcess;
    let censoBatch = null;
    if (TEST_MODE) {
      productsToProcess = cordobaProducts.slice(0, TEST_LIMIT);
      Logger.log('TEST_MODE activo: procesando sólo ' + productsToProcess.length + ' autos.');
    } else {
      censoBatch = createCensoBatch(cordobaProducts, existingMap);
      productsToProcess = censoBatch.products;
      if (censoBatch.priorityCount) {
        Logger.log('Priorizando ' + censoBatch.priorityCount + ' autos nuevos.');
      }
      if (censoBatch.next > censoBatch.start) {
        Logger.log('Lote ' + (censoBatch.start + 1) + '-' + censoBatch.next + ' de ' + censoBatch.total + ' autos de Cordoba.');
      }
    }

    const seenIds = new Set();
    const now = new Date();
    const summary = { nuevos: 0, actualizados: 0, bajas: 0, repricing: 0, errores: 0, alertasBaja: [] };

    productsToProcess.forEach(function (product, idx) {
      const record = normalizeProduct(product);
      seenIds.add(String(record.id));

      Logger.log('[' + (idx + 1) + '/' + productsToProcess.length + '] ID ' + record.id + ' — $' + record.precio + ' ' + record.moneda + ' — ' + record.marca + ' ' + record.modelo);

      record._htmlOk = false;
      try {
        const htmlData = extractHtmlData(record.url, record.precio, record.moneda, record.modelo);
        Object.assign(record, htmlData);
        record._htmlOk = true;
      } catch (e) {
        Logger.log('  ERROR HTML: ' + e);
        summary.errores++;
      }

      upsertRow(sheet, existingMap, record, now, summary);

      if (idx < productsToProcess.length - 1) Utilities.sleep(REQUEST_DELAY_MS);
    });

    // Solo marcamos bajas si NO estamos en TEST_MODE.
    // Usamos allActiveIds para confirmar bajas reales de catálogo en Autocity.
    if (!TEST_MODE) {
      markDesaparecidos(sheet, existingMap, allActiveIds, summary);
      commitCensoBatch(censoBatch);
    }

    logRunSummary(sheet.getParent(), summary);
    Logger.log('Resumen: ' + JSON.stringify(summary));
  } finally {
    lock.releaseLock();
  }
}

// Menú manual desde la hoja (opcional, cómodo para correr a mano)
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Autocity')
    .addItem('Correr censo ahora', 'runCenso')
    .addSeparator()
    .addItem('Regenerar Copywriting para Marketplace', 'generarTodosLosCopys')
    .addToUi();
}

// Correr UNA VEZ para dejar el censo automático (Fase 3).
function createTimeTrigger() {
  ScriptApp.newTrigger('runCenso')
    .timeBased()
    .everyHours(6) // ajustar frecuencia según necesidad
    .create();
  Logger.log('Trigger creado: runCenso cada 6 horas.');
}

// ====================================================================
// SHEET: lectura / upsert / log
// ====================================================================

function getSheet() {
  const ss = SPREADSHEET_ID ? SpreadsheetApp.openById(SPREADSHEET_ID) : SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) throw new Error('No se encontró la hoja "' + SHEET_NAME + '"');
  return sheet;
}

function loadExistingRows(sheet) {
  const lastRow = sheet.getLastRow();
  const map = {}; // id_autocity (string) -> número de fila
  if (lastRow < 2) return map;

  const ids = sheet.getRange(2, COLS.id_autocity, lastRow - 1, 1).getValues();
  ids.forEach(function (row, i) {
    const id = row[0];
    if (id !== '' && id !== null && id !== undefined) map[String(id)] = i + 2;
  });
  return map;
}

function upsertRow(sheet, existingMap, record, now, summary) {
  const idStr = String(record.id);
  const rowNum = existingMap[idStr];

  // Regla de negocio: Si el auto no tiene fotos, NO entra a la hoja
  if (!rowNum) {
    if (!record.fotos || record.fotos.length === 0) {
      Logger.log('  ⏭️ ID ' + record.id + ' omitido (sin fotos publicadas).');
      return;
    }
    appendNewRow(sheet, record, now);
    // lo agregamos al mapa por si el mismo producto aparece dos veces en la corrida
    existingMap[idStr] = sheet.getLastRow();
    summary.nuevos++;
    return;
  }

  // Leemos la fila completa en memoria en una sola llamada API
  const range = sheet.getRange(rowNum, 1, 1, TOTAL_COLUMNS);
  const row = range.getValues()[0];

  // Si un auto existente en la hoja ya no tiene fotos o nunca tuvo, se marca como DESAPARECIDO
  if (record._htmlOk && (!record.fotos || record.fotos.length === 0)) {
    row[COLS.estado_catalogo - 1] = 'DESAPARECIDO';
    row[COLS.foto_portada - 1] = '';
    row[COLS.fotos_galeria - 1] = '';
    row[COLS.ultima_vez_visto - 1] = now;
    range.setValues([row]);
    summary.bajas++;
    Logger.log('  ⚠️ ID ' + record.id + ' marcado como DESAPARECIDO por no tener fotos.');
    return;
  }

  const oldPrecio = row[COLS.precio - 1];
  const priceChanged = (oldPrecio !== '' && oldPrecio !== null && oldPrecio !== undefined) && Number(oldPrecio) !== Number(record.precio);

  // Actualizamos datos básicos garantizados por la Store API
  row[COLS.marca - 1] = record.marca || '';
  row[COLS.modelo - 1] = record.modelo || '';
  row[COLS.version - 1] = record.version || '';
  row[COLS.precio - 1] = (record.precio !== null && record.precio !== undefined) ? record.precio : '';
  row[COLS.moneda - 1] = record.moneda || 'ARS';
  row[COLS.sucursal - 1] = record.sucursal || '';
  row[COLS.url_autocity - 1] = record.url || '';

  // Bugfix: solo actualizamos los campos detallados si la lectura del HTML fue exitosa (_htmlOk)
  // De lo contrario, preservamos los datos que ya estaban guardados previamente en la hoja.
  if (record._htmlOk) {
    if (record.anio !== null && record.anio !== undefined) row[COLS.anio - 1] = record.anio;
    if (record.kilometros !== null && record.kilometros !== undefined) row[COLS.kilometros - 1] = record.kilometros;
    if (record.color !== null && record.color !== undefined) row[COLS.color - 1] = record.color;
    if (record.combustible !== null && record.combustible !== undefined) row[COLS.combustible - 1] = record.combustible;
    if (record.transmision !== null && record.transmision !== undefined) row[COLS.transmision - 1] = record.transmision;
    row[COLS.foto_portada - 1] = (record.fotos && record.fotos[0]) || '';
    row[COLS.fotos_galeria - 1] = (record.fotos || []).join(', ');

    // Actualizamos siempre el contenido de Marketplace con los datos más recientes
    const mkt = generarContenidoMarketplace(record);
    row[COLS.titulo_marketplace - 1] = mkt.titulo_marketplace;
    row[COLS.precio_publicacion - 1] = mkt.precio_publicacion;
    row[COLS.ubicacion_publicacion - 1] = mkt.ubicacion_publicacion;
    row[COLS.texto_copywriting - 1] = mkt.texto_copywriting;
    row[COLS.pack_imagenes - 1] = mkt.pack_imagenes;
    if (record.carroceria_marketplace) {
      row[COLS.carroceria_marketplace - 1] = record.carroceria_marketplace;
    }
  }

  row[COLS.ultima_vez_visto - 1] = now;
  row[COLS.estado_catalogo - 1] = 'DISPONIBLE'; // por si había quedado DESAPARECIDO y reapareció
  row[COLS.precio_cambio_detectado - 1] = priceChanged ? 'TRUE' : 'FALSE';

  if (priceChanged) {
    summary.repricing++;
    const estadoMkt = row[COLS.estado_marketplace - 1];
    if (estadoMkt === 'PUBLICADO') {
      // Única escritura intencional en Capa 2: avisamos que hay que reeditar el posteo.
      row[COLS.requiere_reedicion - 1] = 'TRUE';
    }
  }

  // Escribimos la fila completa modificada en una sola llamada API (mucho más rápido que celda por celda)
  range.setValues([row]);
  summary.actualizados++;
}

function appendNewRow(sheet, record, now) {
  const row = new Array(TOTAL_COLUMNS).fill('');
  row[COLS.id_autocity - 1] = record.id;
  row[COLS.marca - 1] = record.marca || '';
  row[COLS.modelo - 1] = record.modelo || '';
  row[COLS.version - 1] = record.version || '';
  row[COLS.anio - 1] = (record.anio !== null && record.anio !== undefined) ? record.anio : '';
  row[COLS.kilometros - 1] = (record.kilometros !== null && record.kilometros !== undefined) ? record.kilometros : '';
  row[COLS.precio - 1] = (record.precio !== null && record.precio !== undefined) ? record.precio : '';
  row[COLS.moneda - 1] = record.moneda || 'ARS';
  row[COLS.color - 1] = record.color || '';
  row[COLS.combustible - 1] = record.combustible || '';
  row[COLS.transmision - 1] = record.transmision || '';
  row[COLS.sucursal - 1] = record.sucursal || '';
  row[COLS.url_autocity - 1] = record.url || '';
  row[COLS.foto_portada - 1] = (record.fotos && record.fotos[0]) || '';
  row[COLS.fotos_galeria - 1] = (record.fotos || []).join(', ');
  row[COLS.primera_vez_visto - 1] = now;
  row[COLS.ultima_vez_visto - 1] = now;
  row[COLS.estado_catalogo - 1] = 'DISPONIBLE';
  row[COLS.precio_cambio_detectado - 1] = 'FALSE';
  row[COLS.estado_marketplace - 1] = 'NO PUBLICADO'; // único default de Capa 2 al dar de alta
  row[COLS.fecha_publicacion - 1] = '';
  row[COLS.url_marketplace - 1] = '';
  row[COLS.vendedor_asignado - 1] = '';
  row[COLS.leads_recibidos - 1] = 0;
  row[COLS.notas_internas - 1] = '';
  row[COLS.requiere_reedicion - 1] = 'FALSE';

  // Capa 3: Contenido para Marketplace generado automáticamente
  const mkt = generarContenidoMarketplace(record);
  row[COLS.titulo_marketplace - 1] = mkt.titulo_marketplace;
  row[COLS.precio_publicacion - 1] = mkt.precio_publicacion;
  row[COLS.ubicacion_publicacion - 1] = mkt.ubicacion_publicacion;
  row[COLS.texto_copywriting - 1] = mkt.texto_copywriting;
  row[COLS.pack_imagenes - 1] = mkt.pack_imagenes;
  row[COLS.carroceria_marketplace - 1] = record.carroceria_marketplace || '';

  sheet.appendRow(row);
}

function markDesaparecidos(sheet, existingMap, seenIds, summary) {
  Object.keys(existingMap).forEach(function (id) {
    if (seenIds.has(id)) return;

    const rowNum = existingMap[id];

    // Si estamos filtrando por sucursal, sólo marcamos como DESAPARECIDO a los autos de esa sucursal
    if (SUCURSAL_FILTRO) {
      const sucursalActual = sheet.getRange(rowNum, COLS.sucursal).getValue();
      if (sucursalActual && sucursalActual !== SUCURSAL_FILTRO) {
        return; // es de otra sucursal, no lo tocamos
      }
    }

    const estadoCatalogo = sheet.getRange(rowNum, COLS.estado_catalogo).getValue();
    if (estadoCatalogo === 'DESAPARECIDO') return; // ya estaba marcado, no repetir alerta

    sheet.getRange(rowNum, COLS.estado_catalogo).setValue('DESAPARECIDO');
    summary.bajas++;

    const estadoMkt = sheet.getRange(rowNum, COLS.estado_marketplace).getValue();
    if (estadoMkt === 'PUBLICADO') {
      summary.alertasBaja.push(id);
    }
  });
}

function logRunSummary(ss, summary) {
  let logSheet = ss.getSheetByName(LOG_SHEET_NAME);
  if (!logSheet) {
    logSheet = ss.insertSheet(LOG_SHEET_NAME);
    logSheet.appendRow(['fecha_hora', 'nuevos', 'actualizados', 'bajas', 'repricing', 'errores', 'alertas_baja_publicados']);
  }
  logSheet.appendRow([
    new Date(),
    summary.nuevos,
    summary.actualizados,
    summary.bajas,
    summary.repricing,
    summary.errores,
    summary.alertasBaja.join(', ')
  ]);
}

// ====================================================================
// STORE API
// ====================================================================

function fetchAllUsados() {
  let products = [];
  let page = 1;

  while (true) {
    Logger.log('Descargando catálogo: página ' + page + '...');
    const url = STORE_API + '?category=' + CATEGORY_USADOS + '&per_page=' + PER_PAGE + '&page=' + page;
    const response = UrlFetchApp.fetch(url, { headers: DEFAULT_HEADERS, muteHttpExceptions: true });
    const code = response.getResponseCode();

    if (code === 400 && page > 1) break;
    if (code !== 200) {
      throw new Error('Store API respondió ' + code + ' en página ' + page + ': ' + response.getContentText().slice(0, 200));
    }

    const batch = JSON.parse(response.getContentText());
    if (!batch || batch.length === 0) break;

    products = products.concat(batch);

    const headers = response.getHeaders();
    const totalPagesHeader = getHeaderCaseInsensitive(headers, 'X-WP-TotalPages');
    const totalPages = totalPagesHeader ? parseInt(totalPagesHeader, 10) : page;

    if (page >= totalPages) break;

    page++;
    Utilities.sleep(REQUEST_DELAY_MS);
  }

  return products;
}

function getHeaderCaseInsensitive(headers, name) {
  const key = Object.keys(headers).find(function (k) { return k.toLowerCase() === name.toLowerCase(); });
  return key ? headers[key] : null;
}

function parseMoney(product) {
  const prices = product.prices || {};
  const raw = prices.regular_price;
  const minorUnit = prices.currency_minor_unit !== undefined ? Number(prices.currency_minor_unit) : 2;

  if (raw === null || raw === undefined || raw === '') return null;

  const n = Number(raw);
  if (isNaN(n)) return null;

  return Math.trunc(n / Math.pow(10, minorUnit));
}

function getComparablePrice(product) {
  const rawPrice = parseMoney(product) || 0;
  const currency = ((product.prices && product.prices.currency_code) || 'ARS').toUpperCase();

  if (currency === 'USD') {
    return rawPrice * USD_TO_ARS_RATE;
  }
  return rawPrice;
}

function extractBrandAndModel(product) {
  const permalink = product.permalink || '';
  const match = permalink.match(/\/m-([^\/]+)\/m-([^\/]+)\//);

  const brandSlug = match ? match[1].toLowerCase() : null;
  const modelSlug = match ? match[2].toLowerCase() : null;
  const brandTarget = brandSlug ? 'm-' + brandSlug : null;
  const modelTarget = modelSlug ? 'm-' + modelSlug : null;

  let brandName = null;
  let modelName = null;
  const categories = product.categories || [];

  categories.forEach(function (cat) {
    const cSlug = String(cat.slug || '').toLowerCase();
    const cName = normalizeText(cat.name || '');
    if (brandTarget && (cSlug === brandTarget || cSlug === brandSlug)) brandName = cName;
    if (modelTarget && (cSlug === modelTarget || cSlug === modelSlug)) modelName = cName;
  });

  if (!brandName && brandSlug) brandName = titleCase(brandSlug.replace(/-/g, ' '));
  if (!modelName && modelSlug) modelName = titleCase(modelSlug.replace(/-/g, ' '));

  return { marca: brandName, modelo: modelName };
}

function classifyCategories(product) {
  const categories = product.categories || [];
  const slugs = categories.map(function (c) { return String(c.slug || '').toLowerCase(); });

  let branch = null;
  for (const slug in BRANCHES) {
    if (slugs.indexOf(slug) !== -1) { branch = BRANCHES[slug]; break; }
  }

  const condicion = slugs.indexOf('usados') !== -1 ? 'usado' : null;
  return { condicion: condicion, sucursal: branch };
}

function normalizeProduct(product) {
  const categoryData = classifyCategories(product);
  const brandModel = extractBrandAndModel(product);

  return {
    id: product.id,
    marca: brandModel.marca,
    modelo: brandModel.modelo,
    version: normalizeText(product.name || ''),
    precio: parseMoney(product),
    moneda: (product.prices && product.prices.currency_code) || 'ARS',
    condicion: categoryData.condicion,
    sucursal: categoryData.sucursal,
    url: product.permalink,
    anio: null,
    kilometros: null,
    color: null,
    combustible: null,
    transmision: null,
    carroceria_marketplace: null,
    fotos: []
  };
}

// ====================================================================
// SCRAPING DE FICHA (HTML) — vía regex, sin parser de DOM real
// ====================================================================

function extractHtmlData(url, currentPrice, currentCurrency, modelName) {
  const response = UrlFetchApp.fetch(url, { headers: DEFAULT_HEADERS, muteHttpExceptions: true });
  if (response.getResponseCode() !== 200) {
    throw new Error('Ficha respondió ' + response.getResponseCode() + ': ' + url);
  }

  const rawHtml = decodeHtmlEntities(response.getContentText());
  const plainText = stripHtml(rawHtml);

  const summary = extractVehicleSummary(plainText);
  const priceCurrency = extractRealPriceAndCurrency(rawHtml, currentPrice, currentCurrency);

  return {
    anio: summary.anio,
    kilometros: summary.kilometros,
    color: summary.color,
    precio: priceCurrency.precio,
    moneda: priceCurrency.moneda,
    combustible: extractFuel(rawHtml, plainText),
    transmision: extractTransmission(rawHtml, plainText),
    carroceria_marketplace: extractBodyType(rawHtml, plainText, modelName),
    fotos: extractImages(rawHtml)
  };
}

function extractVehicleSummary(text) {
  const result = { anio: null, kilometros: null, color: null };

  const patterns = [
    /\b(20\d{2})\s*\|\s*([\d.,]+)\s*km\s*\|\s*([^|]{1,40})/i,
    /\b(20\d{2})\s*[|·\-]\s*([\d.,]+)\s*km\s*[|·\-]\s*([^|]{1,40})/i
  ];

  for (const pattern of patterns) {
    const m = text.match(pattern);
    if (m) {
      result.anio = parseInt(m[1], 10);
      result.kilometros = parseInt(m[2].replace(/\D/g, '') || '0', 10);
      const rawColor = m[3].split(/\s+Ficha\s+t[eé]cnica\b/i)[0].trim();
      result.color = rawColor || null;
      break;
    }
  }

  if (result.anio === null) {
    const m = text.match(/\b(20\d{2})\b/);
    if (m) result.anio = parseInt(m[1], 10);
  }

  if (result.kilometros === null) {
    const m = text.match(/\b([\d.,]+)\s*km\b/i);
    if (m) result.kilometros = parseInt(m[1].replace(/\D/g, '') || '0', 10);
  }

  return result;
}

// ⚠️ Depende de que la clase "ac-product-financia-price" siga existiendo en el
// HTML. Si el sitio cambia el markup del precio, este bloque hay que revisarlo.
function extractRealPriceAndCurrency(rawHtml, defaultPrice, defaultCurrency) {
  const blockMatch = rawHtml.match(/class="[^"]*ac-product-financia-price[^"]*"[^>]*>([\s\S]{0,300})/i);

  if (blockMatch) {
    const priceText = stripHtml(blockMatch[1]);
    if (/USD|U\$S|US\$/i.test(priceText)) {
      const m = priceText.match(/(?:USD|U\$S|US\$)\s*([\d.,]+)/i);
      if (m) {
        const usdVal = parseInt(m[1].replace(/\D/g, '') || '0', 10);
        if (usdVal > 0) return { precio: usdVal, moneda: 'USD' };
      }
    }
  }

  return { precio: defaultPrice, moneda: defaultCurrency };
}

// ⚠️ Asume que .feature-title y .feature-detail son tags consecutivos en el
// HTML (título seguido del detalle). Si la ficha técnica tiene otra estructura
// (por ejemplo una tabla <tr><td>), este regex no va a encontrar nada y el
// fallback de texto plano de abajo se hace cargo.
function extractFeaturePairs(rawHtml) {
  const pairs = [];
  const re = /class="[^"]*(?:feature-title|product-feature-title)[^"]*"[^>]*>([^<]*)<\/[^>]+>\s*<[^>]*class="[^"]*feature-detail[^"]*"[^>]*>([^<]*)</gi;
  let m;
  while ((m = re.exec(rawHtml)) !== null) {
    pairs.push({ title: normalizeText(m[1]), detail: normalizeText(m[2]) });
  }
  return pairs;
}

function extractFuel(rawHtml, plainText) {
  const pairs = extractFeaturePairs(rawHtml);
  for (const pair of pairs) {
    if (/\bcombustible\b/i.test(pair.title)) {
      const val = pair.detail.toLowerCase();
      if (VALID_FUELS[val]) return VALID_FUELS[val];
    }
  }

  let m = plainText.match(/\|\s*(Nafta|Diesel|Di[eé]sel|GNC|Nafta\/GNC|H[ií]brido|El[eé]ctrico)\s+20\d{2}\s*\|/i);
  if (m && VALID_FUELS[m[1].toLowerCase()]) return VALID_FUELS[m[1].toLowerCase()];

  m = plainText.match(/\bCombustible\s*[:|]\s*(Nafta|Diesel|Di[eé]sel|GNC|Nafta\/GNC|H[ií]brido|El[eé]ctrico)\b/i);
  if (m && VALID_FUELS[m[1].toLowerCase()]) return VALID_FUELS[m[1].toLowerCase()];

  return null;
}

function extractTransmission(rawHtml, plainText) {
  const pairs = extractFeaturePairs(rawHtml);
  let rawValue = null;

  for (const pair of pairs) {
    if (/Tipo\s+de\s+transmisi[oó]n|Transmisi[oó]n/i.test(pair.title)) {
      rawValue = pair.detail;
      break;
    }
  }

  if (!rawValue) {
    const m = plainText.match(/(?:Tipo\s+de\s+)?transmisi[oó]n\s*[:|]?\s*([A-Za-zÁÉÍÓÚáéíóúÑñ]+)/i);
    if (m) rawValue = m[1];
  }

  if (!rawValue) return null;

  const cleaned = rawValue.replace(/^(?:tipo\s+de\s+)?transmisi[oó]n\s*[:|-]?\s*/i, '').trim();
  const lower = cleaned.toLowerCase();

  if (lower.indexOf('auto') !== -1) return 'Automático';
  if (lower.indexOf('man') !== -1) return 'Manual';
  if (lower.indexOf('cvt') !== -1) return 'CVT';

  return cleaned ? titleCase(cleaned) : null;
}

function extractBodyType(rawHtml, plainText, modelo) {
  const pairs = extractFeaturePairs(rawHtml);
  let rawValue = null;

  for (const pair of pairs) {
    if (/\bsegmento\b/i.test(pair.title)) {
      rawValue = pair.detail;
      break;
    }
  }

  if (!rawValue) {
    const m = plainText.match(/\bSegmento\s*[:|]?\s*([A-Za-zÁÉÍÓÚáéíóúÑñ\/\s]+)/i);
    if (m) rawValue = m[1].trim();
  }

  return mapCarroceriaMarketplace(rawValue, modelo);
}

function mapCarroceriaMarketplace(segmento, modelo) {
  if (segmento) {
    const s = segmento.toLowerCase();
    if (s.indexOf('suv') !== -1) return 'SUV';
    if (s.indexOf('sedan') !== -1 || s.indexOf('sedán') !== -1) return 'Sedán';
    if (s.indexOf('hatch') !== -1) return 'Hatchback';
    if (s.indexOf('pick up') !== -1 || s.indexOf('pickup') !== -1 || s.indexOf('camioneta') !== -1) return 'Camioneta';
    if (s.indexOf('utilitario') !== -1) {
      const mod = String(modelo || '').toLowerCase();
      if (/kangoo|partner|berlingo|fiorino|spin/.test(mod)) return 'Miniván';
      return 'Camioneta';
    }
    if (s.indexOf('minivan') !== -1 || s.indexOf('minibus') !== -1) return 'Miniván';
    if (s.indexOf('coupe') !== -1 || s.indexOf('coupé') !== -1) return 'Coupé';
    if (s.indexOf('convertible') !== -1 || s.indexOf('cabrio') !== -1) return 'Convertible';
    if (s.indexOf('familiar') !== -1 || s.indexOf('rural') !== -1) return 'Familiar';
  }

  // Fallback inteligente por modelo si no figura explícito el segmento
  if (modelo) {
    const mod = String(modelo).toLowerCase();
    if (/amarok|hilux|ranger|alaskan|s10|frontier|toro|strada|oroch|saveiro|ram\b|maverick/.test(mod)) return 'Camioneta';
    if (/kangoo|partner|berlingo|fiorino|expert|jumpy|boxer|ducato|transit|spin/.test(mod)) return 'Miniván';
    if (/cronos|onix plus|prisma|cruze sedan|corolla|yaris sedan|logan|etios sedan|vento|fluence|civic|sentra|siena/.test(mod)) return 'Sedán';
    if (/kwid|mobi|argo|polo|208|etios|sandero|yaris|gol\b|c3\b|fiesta|up\b|ka\b|clio|fox\b/.test(mod)) return 'Hatchback';
    if (/tracker|duster|captur|renegade|compass|creta|kicks|taos|t-cross|nivus|corolla cross|ecosport|sw4|tiguan|cr-v|hr-v|rav4|sportage|tucson|q3|q5|x1|x3|territory|kuga/.test(mod)) return 'SUV';
  }

  return 'Otro';
}

// Filtra y extrae ÚNICAMENTE las fotos de la galería del auto,
// aislando el contenedor de la galería e ignorando el carrusel de "Recomendados"
function extractImages(rawHtml) {
  // Buscamos específicamente el bloque contenedor de la galería del producto.
  // Autocity envuelve las fotos del vehículo en .ac-product-gallery-wrapper, .ac-single-product-gallery, o .elementor-gallery__container.
  // Si el auto no tiene fotos cargadas (como pasa cuando recién ingresan), no procesamos imágenes ajenas.
  const galleryMatch = rawHtml.match(/class="[^"]*(?:ac-product-gallery-wrapper|ac-single-product-gallery|elementor-gallery__container|woocommerce-product-gallery)[^"]*"[\s\S]*?(?=<div class="[^"]*carousel-autocity|<div class="[^"]*elementor-widget-ac-cards-carousel|<footer|<\/main|$)/i);

  if (!galleryMatch) {
    return [];
  }

  const galleryHtml = galleryMatch[0];
  const urls = [];
  const attrRe = /(?:data-back|data-thumbnail|href|src|data-src|data-lazy-src|data-original)="([^"]+)"/gi;
  let m;

  while ((m = attrRe.exec(galleryHtml)) !== null) {
    const candidate = m[1];
    if (candidate.toLowerCase().indexOf('cdn.asofix.com') === -1) continue;
    const normalized = normalizeImageUrl(candidate);
    if (urls.indexOf(normalized) === -1) urls.push(normalized);
  }

  const srcsetRe = /srcset="([^"]+)"/gi;
  while ((m = srcsetRe.exec(galleryHtml)) !== null) {
    m[1].split(',').forEach(function (part) {
      const candidate = part.trim().split(' ')[0];
      if (candidate && candidate.toLowerCase().indexOf('cdn.asofix.com') !== -1) {
        const normalized = normalizeImageUrl(candidate);
        if (urls.indexOf(normalized) === -1) urls.push(normalized);
      }
    });
  }

  return urls;
}

function normalizeImageUrl(url) {
  let clean = url.trim();
  if (clean.indexOf('http') !== 0) {
    clean = BASE_URL + (clean.charAt(0) === '/' ? '' : '/') + clean;
  }
  return clean.replace(/[)"']+$/, '');
}

// ====================================================================
// HELPERS DE TEXTO
// ====================================================================

function stripHtml(rawHtml) {
  const text = rawHtml
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ');
  return text.replace(/\s+/g, ' ').trim();
}

function decodeHtmlEntities(text) {
  return text
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, function (_, hex) { return String.fromCharCode(parseInt(hex, 16)); })
    .replace(/&#(\d+);/g, function (_, dec) { return String.fromCharCode(parseInt(dec, 10)); });
}

function normalizeText(value) {
  if (!value) return '';
  const unescaped = decodeHtmlEntities(String(value));
  return unescaped.replace(/\s+/g, ' ').trim();
}

function titleCase(s) {
  return s.replace(/\w\S*/g, function (t) {
    return t.charAt(0).toUpperCase() + t.substr(1).toLowerCase();
  });
}

// ====================================================================
// FASE 5a: GENERADOR DE COPYWRITING Y CONTENIDO PARA MARKETPLACE
// ====================================================================

function generarTituloMarketplace(record) {
  const partes = [];
  const marcaStr = record.marca ? String(record.marca).trim() : '';
  const modeloStr = record.modelo ? String(record.modelo).trim() : '';
  const anioStr = record.anio ? String(record.anio).trim() : '';
  const versionStr = record.version ? String(record.version).trim() : '';
  const transmisionStr = record.transmision ? String(record.transmision).trim() : '';

  if (marcaStr) partes.push(marcaStr);
  if (modeloStr && modeloStr.toLowerCase() !== marcaStr.toLowerCase()) {
    partes.push(modeloStr);
  }
  if (anioStr) partes.push(anioStr);

  if (versionStr) {
    let verLimpia = versionStr;
    if (marcaStr) verLimpia = verLimpia.replace(new RegExp('\\b' + String(marcaStr).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'gi'), '');
    if (modeloStr) verLimpia = verLimpia.replace(new RegExp('\\b' + String(modeloStr).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'gi'), '');
    verLimpia = normalizeText(verLimpia);
    if (verLimpia) partes.push(verLimpia);
  }

  if (transmisionStr && !partes.join(' ').toLowerCase().includes(transmisionStr.toLowerCase())) {
    partes.push(transmisionStr);
  }

  return titleCase(partes.join(' ').replace(/\s+/g, ' ').trim());
}

function generarTextoCopywriting(record) {
  const marcaStr = record.marca ? String(record.marca).trim() : '';
  const modeloStr = record.modelo ? String(record.modelo).trim() : '';
  const versionStr = record.version ? String(record.version).trim() : '';

  const tituloVehiculo = [marcaStr, modeloStr, versionStr].filter(Boolean).join(' ');

  const anioTexto = record.anio ? 'año ' + record.anio : 'año a consultar';
  const kmTexto = record.kilometros ? 'con solo ' + Number(record.kilometros).toLocaleString('es-AR') + ' km' : 'pocos km';
  const transmisionTexto = record.transmision ? 'Caja ' + String(record.transmision).toLowerCase() : 'Caja manual';
  const combustibleTexto = record.combustible ? String(record.combustible).toLowerCase() : 'nafta';

  const precioTexto = String(record.moneda || '').toUpperCase() === 'USD'
    ? 'El precio es de USD ' + Number(record.precio || 0).toLocaleString('es-AR') + '.'
    : 'El precio es de $' + Number(record.precio || 0).toLocaleString('es-AR') + '.';

  const sucursalTexto = record.sucursal
    ? COPY_CONFIG.nombre_concesionaria + ' — ' + record.sucursal
    : COPY_CONFIG.nombre_concesionaria + ' — ' + COPY_CONFIG.ciudad_default;

  const primerParrafo = titleCase(tituloVehiculo) + ', ' + anioTexto + ', ' + kmTexto + '. ' + transmisionTexto + ', ' + combustibleTexto + '. Unidad de agencia y en excelente estado.';

  return [
    primerParrafo,
    precioTexto,
    COPY_CONFIG.permuta,
    COPY_CONFIG.financiacion_bancos,
    COPY_CONFIG.credito_propio,
    COPY_CONFIG.stock_total,
    sucursalTexto,
    'Escribinos por WhatsApp al ' + COPY_CONFIG.telefono_whatsapp + ' y te pasamos toda la info: gastos de retiro, financiación y coordinamos tu visita o prueba de manejo.'
  ].join('\n');
}

function generarContenidoMarketplace(record) {
  const titulo = generarTituloMarketplace(record);
  const copy = generarTextoCopywriting(record);
  const ubicacion = record.sucursal ? record.sucursal + ', Córdoba' : COPY_CONFIG.ciudad_default;
  const precioPub = record.precio !== null && record.precio !== undefined ? record.precio : '';

  return {
    titulo_marketplace: titulo,
    precio_publicacion: precioPub,
    ubicacion_publicacion: ubicacion,
    texto_copywriting: copy,
    pack_imagenes: (record.fotos && record.fotos.length > 0) ? record.fotos.slice(0, 10).join('\n') : ''
  };
}

// Función para regenerar los textos de todos los autos existentes a mano desde el menú
function generarTodosLosCopys() {
  const sheet = getSheet();
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return;

  const data = sheet.getRange(2, 1, lastRow - 1, TOTAL_COLUMNS).getValues();
  let actualizados = 0;

  data.forEach(function (row) {
    const record = {
      id: row[COLS.id_autocity - 1],
      marca: row[COLS.marca - 1],
      modelo: row[COLS.modelo - 1],
      version: row[COLS.version - 1],
      anio: row[COLS.anio - 1],
      kilometros: row[COLS.kilometros - 1],
      precio: row[COLS.precio - 1],
      moneda: row[COLS.moneda - 1],
      color: row[COLS.color - 1],
      combustible: row[COLS.combustible - 1],
      transmision: row[COLS.transmision - 1],
      sucursal: row[COLS.sucursal - 1],
      fotos: (row[COLS.fotos_galeria - 1] || '').split(', ').filter(Boolean)
    };

    if (record.id && record.marca) {
      const mkt = generarContenidoMarketplace(record);
      row[COLS.titulo_marketplace - 1] = mkt.titulo_marketplace;
      row[COLS.precio_publicacion - 1] = mkt.precio_publicacion;
      row[COLS.ubicacion_publicacion - 1] = mkt.ubicacion_publicacion;
      row[COLS.texto_copywriting - 1] = mkt.texto_copywriting;
      row[COLS.pack_imagenes - 1] = mkt.pack_imagenes;
      if (!row[COLS.carroceria_marketplace - 1] && record.modelo) {
        row[COLS.carroceria_marketplace - 1] = mapCarroceriaMarketplace(null, record.modelo);
      }
      actualizados++;
    }
  });

  sheet.getRange(2, 1, lastRow - 1, TOTAL_COLUMNS).setValues(data);
  SpreadsheetApp.getActiveSpreadsheet().toast('Se generó el contenido de Marketplace para ' + actualizados + ' autos.', 'Generador Completado');
}

function createCensoBatch(products, existingMap) {
  const properties = PropertiesService.getScriptProperties();
  let queueIds = parseCensoQueue(properties.getProperty(CENSO_QUEUE_IDS_KEY));
  let start = Number(properties.getProperty(CENSO_QUEUE_OFFSET_KEY) || 0);
  if (!isFinite(start) || start < 0) start = 0;

  if (!queueIds || start >= queueIds.length) {
    queueIds = products.map(function (product) { return String(product.id); });
    start = 0;
  }

  const priorityProducts = selectNewCensoProducts(products, existingMap, AUTOS_POR_EJECUCION);
  const priorityIds = {};
  priorityProducts.forEach(function (product) {
    priorityIds[String(product.id)] = true;
  });

  const queueAfterPriority = removePriorityFromCensoQueue(queueIds, start, priorityIds);
  const batch = selectCensoProducts(products, queueAfterPriority, start, AUTOS_POR_EJECUCION - priorityProducts.length);
  return {
    products: priorityProducts.concat(batch.products),
    ids: queueAfterPriority,
    start: start,
    next: batch.next,
    total: queueAfterPriority.length,
    priorityCount: priorityProducts.length
  };
}

function selectNewCensoProducts(products, existingMap, limit) {
  return products.filter(function (product) {
    return !existingMap[String(product.id)];
  }).slice(0, limit);
}

function removePriorityFromCensoQueue(queueIds, start, priorityIds) {
  return queueIds.slice(0, start).concat(queueIds.slice(start).filter(function (id) {
    return !priorityIds[id];
  }));
}

function selectCensoProducts(products, queueIds, start, limit) {
  const productsById = {};
  products.forEach(function (product) {
    productsById[String(product.id)] = product;
  });

  const next = Math.min(start + limit, queueIds.length);
  const productsInBatch = queueIds.slice(start, next)
    .map(function (id) { return productsById[id]; })
    .filter(Boolean);

  return { products: productsInBatch, next: next };
}

function testSelectCensoProducts() {
  const products = [{ id: 1 }, { id: 2 }, { id: 3 }];
  const batch = selectCensoProducts(products, ['3', '2', '9'], 0, 2);
  if (batch.next !== 2 || batch.products.length !== 2 || batch.products[0].id !== 3 || batch.products[1].id !== 2) {
    throw new Error('selectCensoProducts no conserva la cola o el cursor.');
  }

  const newProducts = selectNewCensoProducts(products, { '2': 5 }, 2);
  if (newProducts.length !== 2 || newProducts[0].id !== 1 || newProducts[1].id !== 3) {
    throw new Error('selectNewCensoProducts no prioriza los autos nuevos.');
  }

  const queue = removePriorityFromCensoQueue(['1', '2', '3'], 1, { '2': true });
  if (queue.length !== 2 || queue[0] !== '1' || queue[1] !== '3') {
    throw new Error('removePriorityFromCensoQueue no evita repetir autos nuevos.');
  }
}

function parseCensoQueue(rawQueue) {
  if (!rawQueue) return null;
  try {
    const queueIds = JSON.parse(rawQueue);
    return Array.isArray(queueIds) ? queueIds : null;
  } catch (e) {
    Logger.log('Cola de censo invalida; se reinicia.');
    return null;
  }
}

function commitCensoBatch(batch) {
  const properties = PropertiesService.getScriptProperties();
  if (batch.next >= batch.total) {
    properties.deleteProperty(CENSO_QUEUE_IDS_KEY);
    properties.deleteProperty(CENSO_QUEUE_OFFSET_KEY);
    Logger.log('Carga completa de Cordoba finalizada.');
    return;
  }

  properties.setProperty(CENSO_QUEUE_IDS_KEY, JSON.stringify(batch.ids));
  properties.setProperty(CENSO_QUEUE_OFFSET_KEY, String(batch.next));
  Logger.log('Proximo lote: ' + (batch.next + 1) + ' de ' + batch.total + '.');
}
