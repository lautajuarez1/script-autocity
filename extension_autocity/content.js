/**
 * Autocity Marketplace Publisher - Content Script v3.8
 *
 * Mejoras v3.8:
 * - Usa labels reales para Marca, Modelo, Millaje, Precio y Descripcion.
 * - Confirma comboboxes ARIA con listbox en portal y MutationObserver.
 * - Publica precio 1; el precio comercial vive en la descripcion.
 */

(function () {
  'use strict';

  if (window.__autocity_v3_8) return;
  window.__autocity_v3_8 = true;

  // ============================================================
  // NORMALIZACION DE TEXTO
  // ============================================================
  function norm(s) {
    return (s || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim();
  }

  // ============================================================
  // PARSEO UNIVERSAL DE DATOS (Hash, Query Params o JSON)
  // ============================================================
  function parseHash() {
    try {
      var href = window.location.href || '';

      // 1. Caso JSON (#autocity=... o ?autocity=...)
      var jsonMatch = href.match(/[#&?]autocity=([^&]+)/);
      if (jsonMatch) {
        var payload = JSON.parse(decodeURIComponent(jsonMatch[1]));
        payload.carroceria = payload.carroceria || payload.carroceria_marketplace || payload.tipo_carroceria || payload.body_style || '';
        return payload;
      }

      // 2. Extraer parámetros desde hash (#) o query (?) o codificado (%23)
      var queryString = '';
      if (window.location.hash && window.location.hash.length > 1) {
        queryString = window.location.hash.substring(1);
      } else if (window.location.search && window.location.search.length > 1) {
        queryString = window.location.search.substring(1);
      } else {
        // Buscar si los parámetros quedaron en la URL completa
        var qIdx = href.search(/[#?]/);
        if (qIdx !== -1) {
          queryString = href.substring(qIdx + 1);
        } else if (href.indexOf('%23') !== -1) {
          queryString = href.substring(href.indexOf('%23') + 3);
        }
      }

      if (!queryString) return null;

      // Limpiar posibles prefijos
      queryString = queryString.replace(/^[#?]/, '');
      var params = new URLSearchParams(queryString);

      // Si no tiene al menos id, marca o titulo, no son datos de vehiculo
      if (!params.has('id') && !params.has('marca') && !params.has('titulo')) {
        return null;
      }

      var rawFotos = params.get('fotos') || '';
      var photoList = rawFotos.split(/[\r\n,]+/).map(function (u) { return u.trim(); }).filter(function (u) {
        return u.indexOf('http') === 0;
      });

      return {
        id: params.get('id') || '',
        marca: params.get('marca') || '',
        modelo: params.get('modelo') || '',
        año: params.get('anio') || params.get('año') || '',
        km: params.get('km') || params.get('kilometraje') || params.get('mileage') || '',
        precio: params.get('precio') || '',
        tipo_vehiculo: params.get('tipo_vehiculo') || params.get('tipo') || params.get('vehicle_type') || 'Auto/camioneta',
        carroceria: params.get('carroceria') || params.get('carroceria_marketplace') || params.get('tipo_carroceria') || params.get('body_style') || '',
        estado: params.get('estado') || params.get('estado_vehiculo') || params.get('condition') || 'Excelente',
        combustible: params.get('combustible') || params.get('fuel') || '',
        transmision: params.get('transmision') || params.get('transmission') || '',
        titulo: params.get('titulo') || '',
        descripcion: params.get('copy') || params.get('descripcion') || '',
        fotos: photoList
      };
    } catch (e) {
      console.error('[Autocity] Parse error:', e);
      return null;
    }
  }

  // ============================================================
  // LOG UI
  // ============================================================
  function timestamp() {
    var d = new Date();
    return d.toTimeString().split(' ')[0];
  }

  function log(level, msg) {
    var box = document.getElementById('acp-log');
    if (!box) return;
    var line = document.createElement('div');
    line.className = 'acp-line acp-' + level;
    line.textContent = timestamp() + ' [' + level.toUpperCase() + '] ' + msg;
    box.appendChild(line);
    box.scrollTop = box.scrollHeight;
    console.log('[Autocity][' + level.toUpperCase() + '] ' + msg);
  }

  // ============================================================
  // UI PANEL
  // ============================================================
  function buildUI(data) {
    var old = document.getElementById('acp-panel');
    if (old) old.remove();

    var panel = document.createElement('div');
    panel.id = 'acp-panel';

    var photos = [];
    if (data && data.fotos) {
      photos = data.fotos.filter(function (u) { return typeof u === 'string' && u.indexOf('http') === 0; });
    }

    var title = data ? (data.titulo || data.marca + ' ' + data.modelo) : 'Sin datos';
    var price = '$1';
    var year = data ? (data['año'] || data.anio || '-') : '-';

    panel.innerHTML =
      '<div class="acp-head">' +
        '<span class="acp-brand">AUTOCITY PUBLISHER v3.8</span>' +
        '<button class="acp-close" id="acp-close" type="button" aria-label="Cerrar">X</button>' +
      '</div>' +
      '<div class="acp-body">' +
        (data
          ? '<div class="acp-info">' +
              '<div class="acp-title">' + title + '</div>' +
              '<div class="acp-meta">' + year + ' | ' + price + ' | ' + photos.length + ' fotos</div>' +
            '</div>' +
            '<button class="acp-btn" id="acp-run">COMPLETAR FORMULARIO</button>'
          : '<div class="acp-warn">No hay datos pendientes. Abrilo desde AppSheet.</div>'
        ) +
        '<div class="acp-logheader">Resultados <span class="acp-clear" id="acp-clear">limpiar</span></div>' +
        '<div class="acp-logbox" id="acp-log"></div>' +
      '</div>';

    document.body.appendChild(panel);

    panel.querySelector('#acp-close').onclick = function () { panel.remove(); };
    panel.querySelector('#acp-clear').onclick = function () {
      panel.querySelector('#acp-log').innerHTML = '';
    };

    if (data) {
      document.getElementById('acp-run').onclick = function () {
        run(data, photos);
      };
    }
  }

  // ============================================================
  // DESCARGA DE IMAGENES VIA BACKGROUND WORKER
  // ============================================================
  function downloadAllImages(urls) {
    return new Promise(function (resolve, reject) {
      if (!chrome.runtime || !chrome.runtime.sendMessage) {
        return reject(new Error('chrome.runtime no disponible'));
      }
      chrome.runtime.sendMessage({ action: 'fetchImages', urls: urls }, function (response) {
        if (chrome.runtime.lastError) {
          return reject(new Error(chrome.runtime.lastError.message));
        }
        if (!response || !response.success) {
          return reject(new Error('Respuesta invalida del background worker'));
        }
        resolve(response.images);
      });
    });
  }

  function base64ToFile(b64, filename) {
    var byteString = atob(b64);
    var ab = new ArrayBuffer(byteString.length);
    var ia = new Uint8Array(ab);
    for (var i = 0; i < byteString.length; i++) {
      ia[i] = byteString.charCodeAt(i);
    }
    return new File([ab], filename, { type: 'image/jpeg' });
  }

  // ============================================================
  // INYECCION DE INPUTS Y COMBOBOXES
  // ============================================================
  async function setInput(el, value) {
    if (!el) return false;
    try {
      el.focus();
      if (typeof el.select === 'function') el.select();

      var strVal = String(value);
      var execOk = false;

      // Method 1: native input insertion
      try {
        execOk = document.execCommand('insertText', false, strVal);
      } catch (ex) {}

      // Method 2: native value setter fallback
      if (!execOk || el.value !== strVal) {
        var proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        var setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
        if (setter) {
          setter.call(el, strVal);
        } else {
          el.value = strVal;
        }

        if (el._valueTracker) {
          el._valueTracker.setValue('__reset__');
        }

        el.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: true, inputType: 'insertText', data: strVal }));
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      }

      await new Promise(function (r) { setTimeout(r, 60); });
      el.dispatchEvent(new Event('blur', { bubbles: true }));
      return true;
    } catch (e) {
      console.warn('[Autocity] setInput error:', e);
      return false;
    }
  }

  function isVisible(el) {
    var style = window.getComputedStyle(el);
    return style.display !== 'none' && style.visibility !== 'hidden' && el.getClientRects().length > 0;
  }

  function controlForLabel(node) {
    var selector = 'input, textarea, select, [role="combobox"], [aria-haspopup="listbox"], [role="button"], [role="checkbox"]';
    var ownControl = node.closest(selector);
    if (ownControl) return ownControl;

    if (node.tagName === 'LABEL' && node.htmlFor) {
      var labelled = document.getElementById(node.htmlFor);
      if (labelled) return labelled;
    }

    var parent = node.parentElement;
    for (var depth = 0; parent && depth < 3; depth++, parent = parent.parentElement) {
      var inside = parent.querySelector(selector);
      if (inside) return inside;
      var sibling = parent.nextElementSibling;
      if (sibling) {
        var nextControl = sibling.matches(selector) ? sibling : sibling.querySelector(selector);
        if (nextControl) return nextControl;
      }
    }

    return null;
  }

  function userClick(el) {
    el.focus();
    var opts = { bubbles: true, cancelable: true, view: window };
    if (window.PointerEvent) {
      el.dispatchEvent(new PointerEvent('pointerdown', opts));
    }
    el.dispatchEvent(new MouseEvent('mousedown', opts));
    if (window.PointerEvent) {
      el.dispatchEvent(new PointerEvent('pointerup', opts));
    }
    el.dispatchEvent(new MouseEvent('mouseup', opts));
    el.dispatchEvent(new MouseEvent('click', opts));
  }

  function waitForElement(find, timeout) {
    return new Promise(function (resolve) {
      var found = find();
      if (found) return resolve(found);

      var timer;
      function finish(value) {
        observer.disconnect();
        clearTimeout(timer);
        resolve(value);
      }

      var observer = new MutationObserver(function () {
        found = find();
        if (found) {
          finish(found);
        }
      });
      observer.observe(document.body, { childList: true, subtree: true, attributes: true });
      timer = setTimeout(function () {
        finish(find());
      }, timeout || 1800);
    });
  }

  function findListboxOption(value) {
    var wanted = norm(value);
    var listboxes = document.querySelectorAll('[role="listbox"]');
    for (var i = 0; i < listboxes.length; i++) {
      var listbox = listboxes[i];
      if (!isVisible(listbox)) continue;
      var options = listbox.querySelectorAll('[role="option"]');
      for (var j = 0; j < options.length; j++) {
        var option = options[j];
        var text = norm(option.textContent);
        if (text === wanted || text.indexOf(wanted) !== -1) return { listbox: listbox, option: option };
      }
    }
    return null;
  }

  function findChoiceField(tokenList) {
    var tokens = tokenList.map(norm);
    var controls = document.querySelectorAll('[role="combobox"], [aria-haspopup="listbox"]');

    for (var i = 0; i < controls.length; i++) {
      var control = controls[i];
      if (!isVisible(control) || control.closest('#acp-panel')) continue;
      var text = norm(control.getAttribute('aria-label') || control.innerText);
      for (var j = 0; j < tokens.length; j++) {
        if (text === tokens[j] || text.indexOf(tokens[j]) === 0) return control;
      }
    }
    return null;
  }

  function marketplaceBodyStyle(value, model) {
    var segment = norm(value);
    if (!segment) return '';
    if (segment.indexOf('suv') !== -1) return 'SUV';
    if (segment.indexOf('sedan') !== -1) return 'Sedán';
    if (segment.indexOf('hatch') !== -1) return 'Hatchback';
    if (segment.indexOf('pick up') !== -1 || segment.indexOf('pickup') !== -1) return 'Camioneta';
    if (segment.indexOf('utilitario') !== -1) return /kangoo|partner|berlingo|fiorino|spin|expert|jumpy|boxer|ducato|transit/.test(norm(model)) ? 'Miniván' : 'Camioneta';
    if (segment.indexOf('minivan') !== -1 || segment.indexOf('minibus') !== -1) return 'Miniván';
    if (segment.indexOf('coupe') !== -1) return 'Coupé';
    return 'Otro';
  }

  function marketplaceFuel(value) {
    var fuel = norm(value);
    if (fuel === 'nafta' || fuel === 'gasolina') return 'Gasolina';
    if (fuel === 'diesel') return 'Diésel';
    if (fuel === 'electrico') return 'Eléctrico';
    if (fuel.indexOf('hibrido electrico enchufable') !== -1) return 'Híbrido eléctrico enchufable';
    if (fuel.indexOf('hibrido') !== -1) return 'Híbrido';
    return value;
  }

  async function selectChoice(tokens, value, useFirstChoice) {
    var field = findChoiceField(tokens);
    if (!field && useFirstChoice) {
      var choices = document.querySelectorAll('[role="combobox"], [aria-haspopup="listbox"], [role="button"]');
      for (var i = 0; i < choices.length; i++) {
        if (isVisible(choices[i]) && !choices[i].closest('#acp-panel')) {
          field = choices[i];
          break;
        }
      }
    }
    if (!field || !value) {
      return false;
    }

    var opener = field.closest('[role="combobox"], [aria-haspopup="listbox"], [role="button"]') || field;
    for (var attempt = 0; attempt < 2; attempt++) {
      try {
        userClick(opener);
        var result = await waitForElement(function () { return findListboxOption(value); }, 1800);
        if (!result) continue;
        userClick(result.option);
        var selected = await waitForElement(function () {
          return norm(opener.value || opener.innerText).indexOf(norm(value)) !== -1;
        }, 1000);
        if (selected) return true;
      } catch (e) {
        console.warn('[Autocity] selectChoice error:', e);
      }
    }

    return false;
  }

  async function setCleanTitle() {
    var field = await waitForElement(function () {
      return findField(['titulo limpio', 'clean title']);
    }, 1800);
    var checkbox = field && (field.matches('input[type="checkbox"], [role="checkbox"]') ? field : field.querySelector('input[type="checkbox"], [role="checkbox"]'));
    if (!checkbox) {
      return false;
    }
    if (checkbox.checked || checkbox.getAttribute('aria-checked') === 'true') return true;
    userClick(checkbox);
    return await waitForElement(function () {
      return checkbox.checked || checkbox.getAttribute('aria-checked') === 'true';
    }, 1000);
  }

  // Localizador inteligente con normalizacion NFD y soporte de comboboxes
  function findField(tokenList) {
    var normTokens = tokenList.map(norm);

    // 1. Busqueda directa en elementos interactivos
    var candidates = document.querySelectorAll(
      'input:not([type="hidden"]):not([type="file"]), textarea, select, [role="combobox"], [aria-haspopup="listbox"], [role="button"], [role="checkbox"]'
    );

    for (var i = 0; i < candidates.length; i++) {
      var el = candidates[i];
      var aria = norm(el.getAttribute('aria-label'));
      var ph = norm(el.getAttribute('placeholder'));
      var nm = norm(el.getAttribute('name'));

      for (var j = 0; j < normTokens.length; j++) {
        var t = normTokens[j];
        if ((aria && aria.indexOf(t) !== -1) ||
            (ph && ph.indexOf(t) !== -1) ||
            (nm && nm.indexOf(t) !== -1)) {
          return el;
        }
      }
    }

    // 2. Busqueda por etiquetas o textos contenedores cercanos (span, label, div)
    var textNodes = document.querySelectorAll('label, span, div');
    for (var k = 0; k < textNodes.length; k++) {
      var node = textNodes[k];
      // Solo evaluar nodos con texto corto (etiquetas reales)
      if (node.children.length <= 2 && node.innerText && node.innerText.length > 1 && node.innerText.length < 40) {
        var nText = norm(node.innerText);
        for (var j2 = 0; j2 < normTokens.length; j2++) {
          var t2 = normTokens[j2];
          if (nText === t2 || nText.indexOf(t2) !== -1) {
            var target = controlForLabel(node);
            if (target && target.tagName !== 'SPAN') return target;
          }
        }
      }
    }

    return null;
  }

  function findNativeField(tokenList) {
    var tokens = tokenList.map(norm);
    var elements = document.querySelectorAll('input:not([type="hidden"]):not([type="file"]):not([type="search"]), textarea');

    for (var i = 0; i < elements.length; i++) {
      var element = elements[i];
      if (!isVisible(element)) continue;

      var node = element.parentElement;
      for (var depth = 0; node && depth < 4; depth++, node = node.parentElement) {
        var text = norm(node.innerText);
        for (var j = 0; j < tokens.length; j++) {
          if (text === tokens[j]) return element;
        }
      }
    }

    return null;
  }

  // Inyector de valor para input de Precio
  async function setPriceValue(inp, value) {
    if (!inp) return false;
    try {
      inp.focus();
      await new Promise(function (r) { setTimeout(r, 80); });

      var proto = HTMLInputElement.prototype;
      var setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;

      // Limpiar
      if (setter) setter.call(inp, '');
      else inp.value = '';
      if (inp._valueTracker) inp._valueTracker.setValue('__prev__');
      inp.dispatchEvent(new Event('input', { bubbles: true }));

      await new Promise(function (r) { setTimeout(r, 80); });

      // Inyectar valor
      var strVal = String(value);
      var inserted = false;
      try { inserted = document.execCommand('insertText', false, strVal); } catch (e) {}

      if (!inserted || inp.value !== strVal) {
        if (setter) setter.call(inp, strVal);
        else inp.value = strVal;
        if (inp._valueTracker) inp._valueTracker.setValue('');
        inp.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: true, inputType: 'insertText', data: strVal }));
        inp.dispatchEvent(new Event('input', { bubbles: true }));
        inp.dispatchEvent(new Event('change', { bubbles: true }));
      }

      await new Promise(function (r) { setTimeout(r, 80); });
      inp.blur();
      return String(inp.value).replace(/\D/g, '') === strVal.replace(/\D/g, '');
    } catch (e) {
      console.warn('[Autocity] setPriceValue error:', e);
      return false;
    }
  }

  // ============================================================
  // EJECUCION PRINCIPAL
  // ============================================================
  async function run(data, photos) {
    var btn = document.getElementById('acp-run');
    if (btn) { btn.disabled = true; btn.textContent = 'COMPLETANDO...'; }

    var vehicleType = data.tipo_vehiculo || data.tipo || 'Auto/camioneta';
    if (await selectChoice(['tipo de vehiculo', 'tipo', 'vehicle type'], vehicleType, true)) {
      log('ok', 'Tipo de vehiculo = ' + vehicleType);
    } else {
      log('error', 'Tipo de vehiculo no confirmado. No se completaron campos para evitar que Facebook los borre.');
      if (btn) { btn.disabled = false; btn.textContent = 'RE-INTENTAR TIPO DE VEHICULO'; }
      return;
    }
    await waitForElement(function () {
      return findField(['carroceria', 'estado del vehiculo', 'kilometr', 'tipo de combustible', 'transmision', 'titulo limpio']);
    }, 1800);

    if (await setCleanTitle()) {
      log('ok', 'Titulo limpio = si');
    } else {
      log('warn', 'Titulo limpio: no encontrado.');
    }

    // --- 1. FOTOS ---
    if (photos.length > 0) {
      try {
        var results = await downloadAllImages(photos);

        var files = [];
        for (var i = 0; i < results.length; i++) {
          var r = results[i];
          if (r.success) {
            files.push(base64ToFile(r.base64, 'foto_' + (i + 1) + '.jpg'));
          } else {
            log('warn', 'Imagen ' + (i + 1) + ': fallo - ' + r.error);
          }
        }

        if (files.length > 0) {
          var fileInputs = document.querySelectorAll('input[type="file"]');
          var fileInput = null;
          for (var fi = 0; fi < fileInputs.length; fi++) {
            if ((fileInputs[fi].accept || '').indexOf('image') !== -1) {
              fileInput = fileInputs[fi];
              break;
            }
          }
          if (!fileInput && fileInputs.length > 0) fileInput = fileInputs[0];

          if (fileInput) {
            var dt = new DataTransfer();
            for (var f = 0; f < files.length; f++) dt.items.add(files[f]);
            fileInput.files = dt.files;
            fileInput.dispatchEvent(new Event('change', { bubbles: true }));
            fileInput.dispatchEvent(new Event('input', { bubbles: true }));
            log('ok', 'Fotos = ' + files.length + '/' + photos.length);
          } else {
            log('warn', 'No se encontro input de archivos en la pagina.');
          }
        }
      } catch (err) {
        log('error', 'Error en descarga de imagenes: ' + err.message);
      }
    }

    await new Promise(function (r) { setTimeout(r, 600); });

    // --- 2. CAMPOS DE TEXTO Y DROPDOWNS ---

    var fields = [
      {
        name: 'Año',
        key: 'año',
        tokens: ['ano', 'year'], // Normalized year label
        format: null,
        choice: true
      },
      {
        name: 'Marca',
        key: 'marca',
        tokens: ['marca', 'make', 'fabricante'],
        format: null
      },
      {
        name: 'Modelo',
        key: 'modelo',
        tokens: ['modelo', 'model'],
        format: null
      },
      {
        name: 'Kilometraje',
        key: 'km',
        tokens: ['kilometr', 'millaje', 'odometr', 'cuentakilometr', 'mileage', 'km'], // Supported mileage labels
        format: function (v) { return Number(v).toLocaleString('es-AR') + ' km'; }
      }
    ];

    for (var idx = 0; idx < fields.length; idx++) {
      var f = fields[idx];
      var val = data[f.key] || data[f.key.replace('año', 'anio')];
      if (!val) {
        log('warn', f.name + ': sin dato recibido.');
        continue;
      }

      if (f.name === 'Kilometraje') {
        var kmEl = findNativeField(f.tokens);
        if (kmEl) {
          var kmOk = await setInput(kmEl, val);
          if (kmOk) log('ok', 'Kilometraje = ' + (f.format ? f.format(val) : val));
          else log('warn', 'Campo "Kilometraje" localizado pero no se pudo asignar.');
        } else {
          log('warn', 'Campo "Kilometraje" no encontrado en la pagina.');
        }
        continue;
      }

      var el = f.choice ? findField(f.tokens) : findNativeField(f.tokens);
      if (el) {
        var ok = f.choice ? await selectChoice(f.tokens, val) : await setInput(el, val);
        if (ok) {
          log('ok', f.name + ' = ' + (f.format ? f.format(val) : val));
        } else {
          log('warn', 'Campo "' + f.name + '" localizado pero no se pudo asignar.');
        }
      } else {
        log('warn', 'Campo "' + f.name + '" no encontrado en la pagina.');
      }
    }

    var price = '1';
    var pInp = findNativeField(['precio', 'price']);
    if (pInp) {
      var pOk = await setPriceValue(pInp, price);
      if (pOk) {
        log('ok', 'Precio = $1');
      } else {
        log('warn', 'Campo "Precio" localizado pero no se pudo asignar.');
      }
    } else {
      log('warn', 'Campo "Precio" no encontrado en la pagina.');
    }

    var fuel = marketplaceFuel(data.combustible);
    var normalizedTransmission = norm(data.transmision);
    var transmission = normalizedTransmission === 'manual' ? 'Transmision manual' :
      (normalizedTransmission === 'automatica' || normalizedTransmission === 'automatico' ? 'Transmision automatica' : data.transmision);
    var choices = [
      { name: 'Carroceria', tokens: ['carroceria', 'body style'], value: marketplaceBodyStyle(data.carroceria, data.modelo) },
      { name: 'Estado', tokens: ['estado del vehiculo', 'condicion', 'condition'], value: data.estado || 'Excelente' },
      { name: 'Combustible', tokens: ['tipo de combustible', 'combustible', 'fuel'], value: fuel },
      { name: 'Transmision', tokens: ['transmision', 'caja', 'cambios'], value: transmission }
    ];
    for (var choiceIndex = 0; choiceIndex < choices.length; choiceIndex++) {
      var choice = choices[choiceIndex];
      if (!choice.value) {
        log('warn', choice.name + ': sin dato recibido.');
        continue;
      }
      if (await selectChoice(choice.tokens, choice.value)) {
        log('ok', choice.name + ' = ' + choice.value);
      } else {
        log('warn', 'Campo "' + choice.name + '" no encontrado o sin opcion "' + choice.value + '".');
      }
    }

    // Descripcion comercial
    if (data.descripcion) {
      var ta = findNativeField(['descripcion', 'description', 'detalles']);
      if (ta && await setInput(ta, data.descripcion)) {
        log('ok', 'Descripcion comercial cargada (' + data.descripcion.length + ' caracteres).');
      } else {
        log('warn', 'Textarea de descripcion no localizado.');
      }
    }

    var problems = document.querySelectorAll('#acp-log .acp-warn, #acp-log .acp-error').length;
    log(problems ? 'warn' : 'ok', problems ? 'Completado con ' + problems + ' avisos.' : 'Formulario completado sin avisos.');

    if (btn) { btn.disabled = false; btn.textContent = 'COMPLETAR NUEVAMENTE'; }
  }

  // ============================================================
  // INICIALIZACION
  // ============================================================
  function isVehicleCreationPage() {
    return /^\/marketplace\/create\/vehicle\/?$/.test(window.location.pathname);
  }

  function takePendingVehicle() {
    return new Promise(function (resolve) {
      chrome.runtime.sendMessage({ action: 'takePendingVehicle' }, function (response) {
        if (chrome.runtime.lastError || !response || !response.success) return resolve(null);
        resolve(response.payload || null);
      });
    });
  }

  async function loadData() {
    var directData = parseHash();
    if (directData || !isVehicleCreationPage()) return directData;
    return takePendingVehicle();
  }

  var data = null;

  async function initialize() {
    data = await loadData();
    buildUI(data);
  }

  initialize();

  window.addEventListener('hashchange', async function () {
    data = await loadData();
    buildUI(data);
  });

})();
