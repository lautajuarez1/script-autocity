# Contexto completo: Autocity Marketplace Publisher

## Objetivo actual

Extensión Chrome Manifest V3 que recibe datos de un vehículo desde AppSheet/Google Sheets mediante la URL de Facebook Marketplace, completa el formulario vehicular, sube fotos desde el CDN de Asofix y deja el botón final de Publicar para acción manual.

La extensión no debe publicar automáticamente. El panel indica `MODO SIMULACION` y debe dejar la publicación final a una persona.

## Reglas de trabajo del usuario

- Llamar al usuario `lautaro` al inicio de cada respuesta.
- No usar acentos en comentarios de código ni dentro de código, salvo que sea imprescindible para representar texto real del formulario.
- Cada cambio de la extensión debe aumentar la versión visible en Chrome, en el panel flotante, en el lanzador de prueba y en las instrucciones.

## Directorio de trabajo

`C:\Users\admin\Desktop\script autocity`

No hay un repositorio Git inicializado en este directorio.

Archivos relevantes:

- `extension_autocity\manifest.json`: configuración Manifest V3, versión actual 3.0.
- `extension_autocity\content.js`: panel y llenado del formulario. Es el archivo principal.
- `extension_autocity\background.js`: descarga fotos del CDN sin el bloqueo CORS de la página de Facebook.
- `extension_autocity\styles.css`: estilos del panel.
- `extension_autocity\INSTRUCCIONES.txt`: instrucciones de instalación y versión visible.
- `probar_extension.html`: lanzador local con un vehículo de prueba y URL con JSON codificado.
- `CONTEXTO_AUTOCITY.md`: este documento.

## Arquitectura implementada

Flujo actual:

1. Google Sheet/AppSheet construye una URL de Facebook con datos en hash o query string.
2. `content.js` obtiene datos desde `#autocity=<JSON>` o parámetros de URL.
3. El usuario abre Marketplace, ve el panel Autocity y presiona `AUTOCOMPLETAR FORMULARIO`.
4. La extensión selecciona Tipo de vehículo antes de cualquier otro dato dependiente.
5. `background.js` descarga fotos desde `cdn.asofix.com`, las devuelve como base64 y `content.js` las inyecta en el `input[type=file]` usando `DataTransfer`.
6. El script completa campos, pero no presiona Siguiente ni Publicar.

## Reglas de negocio confirmadas

- Precio estructurado de Marketplace: siempre `1`.
- El precio real se comunica exclusivamente dentro de la descripción comercial.
- Tipo de vehículo: siempre `Auto/camioneta` en la interfaz actual observada.
- Estado de vehículo esperado: `Excelente`, sujeto a comprobar la lista actual del formulario vehicular.
- Combustible: `Nafta` debe mapear a `Gasolina`.
- Transmisión: `Manual` debe mapear a `Transmision manual`; `Automatica` a `Transmision automatica`.
- Checkbox de título limpio: intentar marcarlo si el campo está presente.
- Publicación final: manual.

## Versiones realizadas

Se hicieron incrementos consecutivos de 2.4 a 3.0. La versión vigente es **3.0**.

La versión se actualizó en:

- `extension_autocity\manifest.json`
- encabezado y bandera global de `content.js`
- panel flotante de `content.js`
- `probar_extension.html`
- `extension_autocity\INSTRUCCIONES.txt`

Al recargar en `chrome://extensions`, Chrome debe mostrar versión 3.0 y el panel debe decir `AUTOCITY PUBLISHER v3.0`.

## Evidencia obtenida del DOM real

Esta es la evidencia mas importante. Debe prevalecer sobre supuestos o especificaciones antiguas.

### Formulario correcto

La URL debe corresponder al formulario de vehículos, por ejemplo una ruta que contiene:

`/marketplace/create/vehicle`

Se detectó antes un formulario genérico equivocado: solo tenía Título, Precio y Estado con opciones Nuevo/Usado. No usar ese formulario para probar esta extensión.

### Tipo de vehículo

Se abrió el primer combobox correcto y se capturó este DOM:

- Contenedor: `DIV`, `role=listbox`, `aria-label=Selecciona una opción`.
- Opciones: `DIV`, `role=option`.
- Texto de opción confirmado: `Auto/camioneta`.
- Otras opciones observadas: Motocicleta, Todoterreno, Casa rodante/caravana, Remolque, Barco, Comercial/industrial y Otro.

El trigger visible es:

- `LABEL`, `role=combobox`, texto `Tipo de vehículoAuto/camioneta` después de seleccionar.

Conclusión: los comboboxes son controles ARIA y las opciones se renderizan en un `listbox` portal fuera del formulario. Se deben abrir y seleccionar por texto, nunca por clases CSS ni por coordenadas.

### Inputs visibles antes de elegir Auto/camioneta

- Ubicación: `INPUT type=text`, `aria-label=Ubicación`.
- Marca: `INPUT type=text`, sin `aria-label`, sin placeholder; contenedor cercano con texto `Marca`.
- Modelo: `INPUT type=text`, sin `aria-label`, sin placeholder; contenedor cercano con texto `Modelo`.
- Precio: `INPUT type=text`, sin `aria-label`, sin placeholder; contenedor cercano con texto `Precio`.
- Descripción: `TEXTAREA`, sin `aria-label`; contenedor cercano con texto `Descripción`.

### Inputs visibles después de elegir Auto/camioneta

Además de los campos anteriores, aparecieron:

- Millaje: `INPUT type=text`, sin `aria-label`; contenedor cercano con texto **`Millaje`**. No se llama Kilometraje en esta interfaz.
- Título limpio: `INPUT type=checkbox`, `aria-label=Este vehículo tiene título limpio`, `name=title_status`.

Los campos no son un supuesto: esta tabla fue obtenida directamente desde la consola de Facebook.

### Comboboxes visibles después de elegir Auto/camioneta

- `LABEL role=combobox`: Tipo de vehículo.
- `LABEL role=combobox`: Año.
- `LABEL role=combobox`: Carrocería.
- `LABEL role=combobox`: Estado del vehículo.
- `LABEL role=combobox`: Tipo de combustible.
- `LABEL role=combobox`: Transmisión. En una prueba mostró valor inicial `Transmisión automática`.

### Capturas anteriores de opciones

Hay capturas adjuntas en el historial que mostraban:

- Estado del vehículo: Excelente, Muy bueno, Bueno, Aceptable, Malo.
- Tipo de combustible: Diésel, Eléctrico, Gasolina, Flexible, Híbrido, Gasolina repetido, Híbrido eléctrico enchufable.
- Transmisión: Transmisión manual y Transmisión automática.

Estas listas todavía se deben capturar con la consola en el formulario vehicular actual antes de asumir que los textos no cambiaron.

## Problemas diagnosticados en versiones anteriores

### 1. Se probó un formulario incorrecto

En el formulario genérico, el estado ofrecía Nuevo, Usado - Como nuevo, Usado - Buen estado y Usado - Aceptable. No existían Marca, Modelo, Año, Millaje ni los campos específicos de vehículos. Esto no era una falla de los seis selectores: era otra pantalla de Facebook.

### 2. `findField()` era demasiado genérico para inputs nativos

Los logs mostraron:

- Año localizado pero no se pudo asignar.
- Marca localizada pero no se pudo asignar.
- Modelo localizado pero no se pudo asignar.
- Kilometraje no encontrado.
- Precio no encontrado.

La causa era que `findField()` podía devolver un contenedor o combobox padre al buscar textos como Marca o Modelo. `assignFieldValue()` entonces intentaba usarlo como dropdown y fallaba. No se debía a React ni al valor del inventario.

### 3. Precio se localizaba por posición

Una versión intentaba encontrar Precio como el input posterior a Modelo. Eso dependía de que Modelo se hubiera encontrado correctamente y podía fallar. La evidencia actual permite encontrar Precio por su label, igual que Marca, Modelo, Millaje y Descripción.

### 4. El menú se cerraba al inspeccionarlo

Al abrir un combobox y volver a la consola, el popup se cerraba. Se solucionó la investigación usando un `MutationObserver` que se arma primero y captura el `listbox` automáticamente al abrirse.

## Implementación actual de content.js (v3.0)

### Datos desde URL

`parseHash()` admite:

- JSON en `#autocity=<JSON>` o query equivalente.
- Parámetros individuales de URL como `id`, `marca`, `modelo`, `anio`, `km`, `precio`, `copy`, `fotos`.
- Alias para kilometraje: `km`, `kilometraje`, `mileage`.
- Alias para datos de vehiculo: `tipo_vehiculo`, `tipo`, `vehicle_type`, `carroceria`, `tipo_carroceria`, `body_style`, `estado`, `estado_vehiculo`, `condition`, `combustible`, `fuel`, `transmision`, `transmission`.

El lanzador `probar_extension.html` usa JSON, por lo que sus claves pasan sin ser transformadas.

### Selección de comboboxes

Las funciones relevantes son:

- `userClick(el)`: envía PointerEvent cuando está disponible, seguido de mousedown, mouseup y click.
- `waitForElement(find, timeout)`: usa `MutationObserver` sobre `document.body` y timeout controlado.
- `findListboxOption(value)`: busca el `role=listbox` visible y dentro suyo una `role=option` por texto normalizado.
- `selectChoice(tokens, value, useFirstChoice)`: abre el trigger, espera el portal, hace click real en la opción y confirma que el texto del trigger refleja el valor.

`Auto/camioneta` se ejecuta antes de fotos y del resto de los datos. Si no se confirma, el flujo hace `return` para impedir que Facebook borre campos al cambiar el tipo después.

### Inputs nativos

La versión 3.0 agregó `findNativeField(tokenList)`.

Busca `input` visibles no ocultos/no file/no search y `textarea`. Desde cada input sube hasta cuatro padres y compara el texto completo del contenedor con el label normalizado. Esto coincide con el relevamiento real: cada campo tiene un contenedor cuyo texto es exactamente Marca, Modelo, Millaje, Precio o Descripción.

Actualmente se usa para:

- Marca
- Modelo
- Millaje (el script conserva el nombre interno Kilometraje, pero acepta el token `millaje`)
- Precio
- Descripción

Para escribir React controlado se usa `setInput()`, que intenta `document.execCommand('insertText')` y, si hace falta, usa el setter nativo del prototipo y eventos `input`/`change`.

### Precio

`var price = '1';`

No se toma `data.precio` para el input estructurado. El panel también muestra `$1`.

### Checkbox

`setCleanTitle()` espera el campo mediante `MutationObserver`, busca textos `titulo limpio` o `clean title`, confirma el estado con `checked` o `aria-checked` y usa `userClick()` en lugar de escribir `.checked` directamente.

### Fotos

La lógica existente funciona según las pruebas anteriores:

1. `content.js` manda URLs al worker.
2. `background.js` descarga binarios con `fetch()`.
3. Convierte a base64 y los devuelve.
4. `content.js` transforma a `File` y asigna todos juntos mediante `DataTransfer` al input de fotos.

El manifest permite Facebook y Asofix. No modificar esta parte sin necesidad.

## Estado exacto de pruebas

Verificado localmente:

- `node --check extension_autocity\content.js` pasa.
- `manifest.json` parsea correctamente y contiene versión 3.0.
- La evidencia DOM arriba fue extraída manualmente desde el formulario real de vehículos.

Todavía no verificado en el formulario real con la versión 3.0:

- Que Marca, Modelo, Millaje, Precio y Descripción se llenen luego de recargar la extensión 3.0.
- Que Año se seleccione correctamente con el `listbox` de años.
- Que Estado, Combustible y Transmisión coincidan con sus opciones actuales.
- Que el checkbox quede marcado por React.
- Que el flujo de fotos siga funcionando junto con el nuevo orden.

## Limitaciones o tareas pendientes

### Carrocería

El script solo selecciona carrocería si el dato `carroceria` llega en la URL/JSON. El vehículo de prueba no trae esa clave. La fuente Asofix aparentemente no la expone de manera uniforme.

Para que siempre se complete se necesita una de estas decisiones:

1. Agregar una columna `carroceria` al Google Sheet y pasarla en la URL.
2. Crear una tabla de mapeo marca/modelo/version a carrocería.
3. Hacer una heurística por texto de modelo, menos confiable.

No inventar una carrocería por defecto para todos los vehículos.

### Millaje mínimo

La especificación dice que Facebook requiere mínimo 200. La versión actual carga el km recibido directamente. Falta aplicar `max(km, 200)` antes de escribir Millaje. Para vehículos 0 km debe escribir 200 (o la cifra definida por negocio) y conservar el kilometraje real en la descripción.

### Valores de dropdown pendientes de evidencia actual

Antes de cambiar mapeos, capturar en el formulario real las opciones de:

- Año (basta confirmar que la opción del año de prueba existe).
- Carrocería.
- Estado del vehículo.
- Tipo de combustible.
- Transmisión.

El procedimiento de captura está más abajo.

### Scope del manifest

El manifest actualmente inyecta el content script en `*://*.facebook.com/marketplace/*`, un alcance amplio. La extensión puede aparecer en formularios genéricos de Marketplace. En una iteración posterior puede restringirse a rutas de creación de vehículos si se confirma que no se necesitan otras rutas.

## Procedimiento de depuración en Facebook

Abrir DevTools con F12 y usar Console en la pestaña del formulario de vehículo. Si Chrome bloquea pegado, escribir manualmente `allow pasting` cuando lo solicite.

### Verificar ruta

Ejecutar:

```js
location.href
```

Debe contener `/marketplace/create/vehicle`.

### Capturar un dropdown sin que se cierre

Pegar este bloque, ejecutarlo y luego abrir manualmente el dropdown deseado. El observador captura opciones sin volver a enfocar la consola.

```js
(() => {
  const visible = el => el.getClientRects().length > 0;

  const capture = () => {
    const listbox = [...document.querySelectorAll('[role="listbox"]')]
      .find(visible);

    if (!listbox) return false;

    const result = [listbox, ...listbox.querySelectorAll('[role="option"]')]
      .map(el => ({
        tag: el.tagName,
        role: el.getAttribute('role'),
        aria: el.getAttribute('aria-label'),
        text: el.textContent.replace(/\s+/g, ' ').trim(),
        html: el.outerHTML
      }));

    console.table(result);
    observer.disconnect();
    return true;
  };

  const observer = new MutationObserver(capture);
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true
  });

  console.log('Listo. Abra el dropdown.');
  capture();
})();
```

### Listar inputs visibles

Después de seleccionar manualmente Auto/camioneta, ejecutar:

```js
const result = [...document.querySelectorAll('input, textarea')]
  .filter(el => el.getClientRects().length > 0)
  .map(el => ({
    tag: el.tagName,
    type: el.type,
    aria: el.getAttribute('aria-label'),
    placeholder: el.placeholder,
    name: el.name,
    nearby: (el.parentElement?.parentElement?.innerText || '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 160)
  }));

console.table(result);
```

### Listar triggers y checkbox

```js
const result = [...document.querySelectorAll(
  '[role="combobox"], [aria-haspopup="listbox"], [role="checkbox"]'
)]
.filter(el => el.getClientRects().length > 0)
.map(el => ({
  tag: el.tagName,
  role: el.getAttribute('role'),
  aria: el.getAttribute('aria-label'),
  text: el.textContent.replace(/\s+/g, ' ').trim()
}));

console.table(result);
```

## Próximo plan recomendado

1. Recargar la extensión 3.0 en `chrome://extensions`.
2. Abrir el formulario correcto de vehículo con datos de prueba.
3. Presionar Autocompletar y conservar todo el log del panel.
4. Confirmar primero que Tipo de vehículo queda en Auto/camioneta.
5. Confirmar que se llenen Año, Marca, Modelo, Millaje, Precio `$1` y Descripción.
6. Capturar los dropdowns que fallen usando el observador anterior.
7. Aplicar el mínimo cambio específico solo al campo que falle.
8. Definir la fuente o mapeo de carrocería y aplicar el mínimo de Millaje 200.

## Decisiones que no se deben revertir sin pedido

- No llenar el precio real en el input de Marketplace; debe ser `1`.
- No seleccionar Tipo de vehículo después de completar otros campos; Facebook borra datos cuando cambia el tipo.
- No clicar el botón final Publicar automáticamente.
- No usar clases CSS ofuscadas de Facebook como selector estable.
- No usar clicks por coordenadas de pantalla.
- No agregar esperas variables para intentar evadir mecanismos de detección; usar confirmaciones reales del DOM para fiabilidad.
