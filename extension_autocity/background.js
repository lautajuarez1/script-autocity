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

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'fetchImages') {
    const urls = request.urls || [];
    console.log('[Background] Recibida solicitud para descargar ' + urls.length + ' imagenes.');

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
            console.log('[Background] Imagen ' + (idx + 1) + ' descargada (' + bytes.byteLength + ' bytes).');
            return { index: idx, success: true, base64: b64, size: bytes.byteLength };
          })
          .catch(err => {
            console.error('[Background] Error en imagen ' + (idx + 1) + ':', err.message);
            return { index: idx, success: false, error: err.message };
          })
      )
    ).then(results => {
      console.log('[Background] Lote completo. Enviando respuesta al content script.');
      sendResponse({ success: true, images: results });
    });

    return true; // Canal asincrono abierto
  }
});
