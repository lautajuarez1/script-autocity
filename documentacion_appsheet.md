# ESPECIFICACION TECNICA: PANEL OPERATIVO APPSHEET
## Sistema de Publicación y Gestión de Stock - Autocity Marketplace

---

### 1. Control del Documento y Arquitectura General

* **Documento:** Especificación de Implementación - Capa de Aplicación Móvil/Web (AppSheet)
* **Estado:** Producción / Operativo
* **Fuente de Datos (Data Source):** Google Sheets
* **Spreadsheet ID:** `1FJ8-v0vM4T79eqPfLhSGS-hAZA5i7TvkZeC-K8ZqGM8`
* **Tabla Principal:** `Stock`
* **Clave Primaria (Key Column):** `id_autocity` (Tipo: Number, Unique, Non-editable)
* **Etiqueta Visual (Label Column):** `titulo_marketplace` (Alternativa visual: `foto_portada`)
* **Total Columnas Mapeadas:** 32 (Capas 1, 2 y 3)

---

### 2. Diccionario de Datos y Tipado en AppSheet

El esquema en AppSheet mapea de forma estricta las 3 capas funcionales definidas en la base de datos. Para asegurar la integridad de lectura y evitar fallas en la resolución de URLs en el almacenamiento de AppSheet, la configuración de tipos por columna se define de la siguiente manera:

| Columna | Capa Funcional | Tipo AppSheet | Restricciones / Configuración |
| :--- | :--- | :--- | :--- |
| `id_autocity` | 1. Autocity Técnico | Number | Key = TRUE, Editable = FALSE |
| `marca` | 1. Autocity Técnico | Text | Editable = FALSE |
| `modelo` | 1. Autocity Técnico | Text | Editable = FALSE |
| `version` | 1. Autocity Técnico | Text | Editable = FALSE |
| `anio` | 1. Autocity Técnico | Number | Decimal separator = None, Thousands = FALSE |
| `kilometros` | 1. Autocity Técnico | Number | Thousands = TRUE |
| `precio` | 1. Autocity Técnico | Price / Number | Moneda base de extracción |
| `moneda` | 1. Autocity Técnico | Enum | Values: `ARS`, `USD` |
| `color` | 1. Autocity Técnico | Text | |
| `combustible` | 1. Autocity Técnico | Enum | Values: `Nafta`, `Diésel`, `GNC`, `Híbrido`, `Eléctrico` |
| `transmision` | 1. Autocity Técnico | Enum | Values: `Manual`, `Automático`, `CVT` |
| `sucursal` | 1. Autocity Técnico | Text | |
| `url_autocity` | 1. Autocity Técnico | Url | Protocolo HTTPS estricto (no tipar como File) |
| `foto_portada` | 1. Autocity Técnico | Image | URL pública CDN (no tipar como File) |
| `fotos_galeria` | 1. Autocity Técnico | LongText | Concatenación delimitada por coma |
| `primera_vez_visto`| 1. Autocity Técnico | DateTime | Timestamp de ingesta |
| `ultima_vez_visto` | 1. Autocity Técnico | DateTime | Timestamp de confirmación de stock |
| `estado_catalogo` | 1. Autocity Técnico | Enum | Values: `DISPONIBLE`, `DESAPARECIDO` |
| `precio_cambio_detectado` | 1. Autocity Técnico | Yes/No | Flag booleano de repricing |
| `estado_marketplace` | 2. Gestión Interna | Enum | Values: `NO PUBLICADO`, `POR PUBLICAR`, `PUBLICADO`, `PAUSADO`, `BAJA REALIZADA` |
| `fecha_publicacion`| 2. Gestión Interna | Date | Fecha de alta en Facebook Marketplace |
| `url_marketplace` | 2. Gestión Interna | Url | Enlace directo a la publicación activa |
| `vendedor_asignado`| 2. Gestión Interna | Text | Responsable comercial en Autocity |
| `leads_recibidos` | 2. Gestión Interna | Number | Initial value = 0 |
| `notas_internas` | 2. Gestión Interna | LongText | Observaciones del operador |
| `requiere_reedicion`| 2. Gestión Interna | Yes/No | Flag de alerta si hubo cambio de precio en unidad publicada |
| `titulo_marketplace`| 3. Marketplace | Text | Título optimizado para algoritmo de búsqueda |
| `precio_publicacion`| 3. Marketplace | Price / Number | Precio publicado |
| `ubicacion_publicacion`| 3. Marketplace | Text | Plaza/Ciudad de publicación |
| `texto_copywriting`| 3. Marketplace | LongText | Redacción comercial persuasiva con llamada a la acción |
| `pack_imagenes` | 3. Marketplace | LongText | URLs de imágenes seleccionadas |
| `carroceria_marketplace`| 3. Marketplace | Enum | Values: `SUV`, `Sedán`, `Hatchback`, `Camioneta`, `Miniván`, `Coupé`, `Convertible`, `Familiar`, `Auto pequeño`, `Otro` |

---

### 3. Registro de Configuración en AppSheet (Slices y Vistas)

*Nota de integridad técnica:* La configuración interna de Slices, Vistas y Reglas de UX reside directamente en la consola cloud de AppSheet (appsheet.com) y no en el repositorio local. Para evitar discrepancias o datos no verificados al 100%, las fórmulas exactas y definiciones de Slices deben documentarse únicamente copiando los valores reales directamente desde el editor de AppSheet.

---

### 4. Análisis de Causa Raíz (RCA): Fallo XML `NoSuchKey` en Selección de Registro

#### 4.1. Descripción del Incidente
Al hacer clic sobre un registro en una vista de catálogo (`deck` o `table`), la aplicación interrumpe el flujo de navegación interna y despliega un documento XML en el navegador con la siguiente estructura:
```xml
<Error>
  <Code>NoSuchKey</Code>
  <Message>The specified key does not exist.</Message>
</Error>
```

#### 4.2. Causa Raíz Técnica
El código de respuesta `NoSuchKey` corresponde a un error HTTP 404 originado en el almacenamiento de objetos de Amazon S3 (infraestructura de persistencia de AppSheet). Este fallo se produce por una de las siguientes dos condiciones:

1. **Tipado Erróneo de Columna (`File` vs `Url`/`Image`):**
   Si columnas que contienen hipervínculos absolutos (como `url_autocity` o `foto_portada` con dominios `autocity.com.ar` o `cdn.asofix.com`) son tipadas en AppSheet como `File`, el sistema las procesa como rutas relativas locales a buscar dentro del bucket S3 de la aplicación. Al no existir la clave de objeto correspondiente a esa cadena, S3 retorna `NoSuchKey`.
2. **Asignación Anómala en el Disparador `Row Selected`:**
   Si en las propiedades de la vista (`UX > Views > [Nombre_Vista] > Behavior > Event Actions > Row Selected`), la acción configurada no es `Auto`, sino una acción personalizada de tipo "Open a file" o "Open URL" apuntando a una columna vacía o mal resuelta, AppSheet intenta delegar el evento a un recurso externo inexistente en lugar de invocar la vista `Stock_Detail`.

#### 4.3. Procedimiento Correctivo
1. **Verificación de Tipos en Data > Columns:**
   * Constatar que `foto_portada` posea tipo `Image`.
   * Constatar que `url_autocity` y `url_marketplace` posean tipo `Url`.
   * Constatar que `texto_copywriting` y `pack_imagenes` posean tipo `LongText`.
2. **Restablecimiento del Event Action:**
   * Acceder a `UX > Views > Por Publicar` (y análogamente en `Publicados` y `Alertas Bajas`).
   * Navegar a la sección **Behavior > Event Actions**.
   * Establecer `Row Selected` en el valor predeterminado: **`Auto`**.
3. **Validación de la Vista de Detalle:**
   * Comprobar la existencia de la vista `Stock_Detail` de tipo `detail` asociada a la tabla `Stock`. Al estar `Row Selected` en `Auto`, AppSheet resolverá internamente el comando `LINKTOROW([id_autocity], "Stock_Detail")` cargando la ficha completa de forma nativa.
