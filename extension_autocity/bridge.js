(() => {
  'use strict';

  const FACEBOOK_FORM_URL = 'https://www.facebook.com/marketplace/create/vehicle';
  const status = document.getElementById('status');

  function show(message, error) {
    if (!status) return;
    status.textContent = message;
    status.classList.toggle('error', !!error);
  }

  function parsePayload() {
    const params = new URLSearchParams(window.location.hash.slice(1));
    const value = params.get('autocity');

    if (value) {
      const payload = JSON.parse(value);
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
      if (!payload.id && !payload.marca && !payload.titulo) return null;
      return payload;
    }

    if (!params.has('id') && !params.has('marca') && !params.has('titulo')) return null;

    return {
      id: params.get('id') || '',
      marca: params.get('marca') || '',
      modelo: params.get('modelo') || '',
      anio: params.get('anio') || '',
      km: params.get('km') || params.get('kilometraje') || params.get('mileage') || '',
      precio: params.get('precio') || '',
      tipo_vehiculo: params.get('tipo_vehiculo') || params.get('tipo') || 'Auto/camioneta',
      carroceria: params.get('carroceria') || params.get('carroceria_marketplace') || '',
      estado: params.get('estado') || 'Excelente',
      combustible: params.get('combustible') || '',
      transmision: params.get('transmision') || '',
      titulo: params.get('titulo') || '',
      descripcion: params.get('copy') || params.get('descripcion') || '',
      fotos: (params.get('fotos') || '').split(/[\r\n,]+/).map(url => url.trim()).filter(url => url.indexOf('http') === 0)
    };
  }

  try {
    const payload = parsePayload();
    if (!payload) {
      show('No se recibieron datos de vehiculo. Volve a abrirlo desde Autocity.', true);
      return;
    }

    show('Guardando datos en la extension...');
    chrome.runtime.sendMessage({ action: 'storePendingVehicle', payload }, response => {
      if (chrome.runtime.lastError || !response || !response.success) {
        show('No se pudo conectar con la extension. Verifica que este instalada y recargada.', true);
        return;
      }
      show('Datos listos. Abriendo Marketplace...');
      window.location.replace(FACEBOOK_FORM_URL);
    });
  } catch (error) {
    show('Los datos recibidos no son validos. Volve a abrirlo desde Autocity.', true);
  }
})();
