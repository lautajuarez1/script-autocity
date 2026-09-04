/**
 * Autocity Marketplace Publisher - Background Service Worker (v2.0)
 *
 * El CDN de Autocity (cdn.asofix.com) NO envía Access-Control-Allow-Origin.
 * Esto significa que un fetch() desde content.js en facebook.com falla por CORS.
 * El service worker de la extension NO tiene restriccion CORS, asi que descarga
 * las imagenes aca y las devuelve como base64 al content script.
 *
 * Problema potencial: imagenes grandes pueden exceder el limite de mensajeria
 * de Chrome (~64MB), pero las fotos de Autocity son thumbnails de ~50KB, no hay riesgo.
 */

const BOUNCE_PREFIX = 'https://lautajuarez1.github.io/autocity-bounce/';
const PENDING_VEHICLE_KEY = 'autocityPendingVehicle';
const PENDING_VEHICLE_TTL_MS = 10 * 60 * 1000;

function validVehicle(payload) {
  return !!payload && typeof payload === 'object' && !Array.isArray(payload) &&
    !!(payload.id || payload.marca || payload.titulo);
}

function fromBouncePage(sender) {
  return !!sender.url && sender.url.indexOf(BOUNCE_PREFIX) === 0;
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'storePendingVehicle') {
    if (!fromBouncePage(sender) || !validVehicle(request.payload)) {
      sendResponse({ success: false, error: 'Datos de vehiculo no validos.' });
      return;
    }

    chrome.storage.session.set({
      [PENDING_VEHICLE_KEY]: {
        payload: request.payload,
        expiresAt: Date.now() + PENDING_VEHICLE_TTL_MS
      }
    }, () => {
      if (chrome.runtime.lastError) {
        sendResponse({ success: false, error: chrome.runtime.lastError.message });
        return;
      }
      sendResponse({ success: true });
    });
    return true;
  }

  if (request.action === 'takePendingVehicle') {
    chrome.storage.session.get(PENDING_VEHICLE_KEY, (result) => {
      const pending = result[PENDING_VEHICLE_KEY];
      const expired = !pending || pending.expiresAt <= Date.now() || !validVehicle(pending.payload);
      chrome.storage.session.remove(PENDING_VEHICLE_KEY, () => {
        sendResponse(expired ? { success: false } : { success: true, payload: pending.payload });
      });
    });
    return true;
  }

  if (request.action === 'fetchImages') {
    const urls = request.urls || [];
    Promise.all(
      urls.map((url, idx) =>
        fetch(url)
          .then(response => {
            if (!response.ok) throw new Error('HTTP ' + response.status);
            return response.arrayBuffer();
          })
          .then(buffer => {
            const bytes = new Uint8Array(buffer);
            let binary = '';
            const chunkSize = 8192;
            for (let i = 0; i < bytes.byteLength; i += chunkSize) {
              binary += String.fromCharCode.apply(null, bytes.subarray(i, Math.min(i + chunkSize, bytes.byteLength)));
            }
            const b64 = btoa(binary);
            return { success: true, base64: b64 };
          })
          .catch(err => {
            console.error('[Background] Error en imagen ' + (idx + 1) + ':', err.message);
            return { success: false, error: err.message };
          })
      )
    ).then(results => {
      sendResponse({ success: true, images: results });
    });

    return true; // Canal asincrono abierto
  }
});
