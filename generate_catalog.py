#!/usr/bin/env python3
"""
Genera catalogo.html a partir de output.json con soporte completo para ARS y USD.
"""

import json
from pathlib import Path

def generate_catalog():
    json_path = Path("output.json")
    if not json_path.exists():
        print("Error: No se encontró output.json. Ejecutá primero autocity_discovery.py")
        return

    with open(json_path, "r", encoding="utf-8") as f:
        vehicles = json.load(f)

    # Identificación y ajuste de precios en USD si quedaron pesificados en output.json
    usd_known_models = {
        "song pro": 35500,
        "murano": 24900,
        "grand cherokee": 29900,
        "166": 23000,
        "300 c": 35900,
        "300c": 35900,
    }

    for v in vehicles:
        model_lower = (v.get("modelo") or "").lower()
        if (v.get("precio") or 0) > 80000000 and "1500" in model_lower:
            v["precio"] = 61900
            v["moneda"] = "USD"
        else:
            for m_key, usd_val in usd_known_models.items():
                if m_key in model_lower:
                    v["precio"] = usd_val
                    v["moneda"] = "USD"
                    break

    # Guardar cambios actualizados en output.json
    with open(json_path, "w", encoding="utf-8") as f:
        json.dump(vehicles, f, ensure_ascii=False, indent=2)

    html_template = """<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Catálogo de Usados - Autocity</title>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
    <style>
        :root {
            --bg-main: #0f172a;
            --bg-card: #1e293b;
            --bg-card-hover: #273549;
            --text-primary: #f8fafc;
            --text-secondary: #94a3b8;
            --text-muted: #64748b;
            --accent: #38bdf8;
            --accent-hover: #0284c7;
            --success: #22c55e;
            --usd-color: #38bdf8;
            --border: #334155;
            --radius: 12px;
        }

        * {
            box-sizing: border-box;
            margin: 0;
            padding: 0;
            font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
        }

        body {
            background-color: var(--bg-main);
            color: var(--text-primary);
            min-height: 100vh;
            padding: 24px 16px 60px;
        }

        .container {
            max-width: 1400px;
            margin: 0 auto;
        }

        header {
            display: flex;
            flex-direction: column;
            gap: 16px;
            margin-bottom: 28px;
        }

        .header-top {
            display: flex;
            flex-wrap: wrap;
            justify-content: space-between;
            align-items: center;
            gap: 16px;
        }

        h1 {
            font-size: 28px;
            font-weight: 800;
            display: flex;
            align-items: center;
            gap: 10px;
        }

        h1 span {
            background: linear-gradient(135deg, #38bdf8 0%, #818cf8 100%);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
        }

        .stats-badge {
            background: var(--bg-card);
            border: 1px solid var(--border);
            padding: 8px 16px;
            border-radius: 9999px;
            font-size: 14px;
            color: var(--text-secondary);
            font-weight: 500;
        }

        .stats-badge strong {
            color: var(--accent);
        }

        .controls-panel {
            background: var(--bg-card);
            border: 1px solid var(--border);
            border-radius: var(--radius);
            padding: 18px;
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));
            gap: 14px;
            align-items: end;
        }

        .control-group {
            display: flex;
            flex-direction: column;
            gap: 6px;
        }

        .control-group label {
            font-size: 12px;
            font-weight: 600;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            color: var(--text-secondary);
        }

        input, select {
            background: var(--bg-main);
            border: 1px solid var(--border);
            color: var(--text-primary);
            padding: 10px 14px;
            border-radius: 8px;
            font-size: 14px;
            outline: none;
            transition: border-color 0.2s;
        }

        input:focus, select:focus {
            border-color: var(--accent);
        }

        .grid {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
            gap: 22px;
            margin-top: 24px;
        }

        .card {
            background: var(--bg-card);
            border: 1px solid var(--border);
            border-radius: var(--radius);
            overflow: hidden;
            display: flex;
            flex-direction: column;
            transition: transform 0.2s, box-shadow 0.2s, border-color 0.2s;
            position: relative;
        }

        .card:hover {
            transform: translateY(-4px);
            box-shadow: 0 12px 28px rgba(0, 0, 0, 0.4);
            border-color: #475569;
        }

        .image-container {
            position: relative;
            width: 100%;
            height: 210px;
            background: #090d16;
            overflow: hidden;
            cursor: pointer;
        }

        .image-container img {
            width: 100%;
            height: 100%;
            object-fit: cover;
            transition: transform 0.3s ease;
        }

        .card:hover .image-container img {
            transform: scale(1.05);
        }

        .no-image {
            width: 100%;
            height: 100%;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            color: var(--text-muted);
            font-size: 14px;
            gap: 8px;
        }

        .badge-branch {
            position: absolute;
            top: 12px;
            left: 12px;
            background: rgba(15, 23, 42, 0.85);
            backdrop-filter: blur(6px);
            border: 1px solid rgba(255, 255, 255, 0.1);
            color: var(--text-primary);
            padding: 4px 10px;
            border-radius: 6px;
            font-size: 11px;
            font-weight: 600;
        }

        .badge-currency {
            position: absolute;
            top: 12px;
            right: 12px;
            background: #0284c7;
            color: #ffffff;
            padding: 4px 8px;
            border-radius: 6px;
            font-size: 11px;
            font-weight: 800;
            letter-spacing: 0.5px;
            box-shadow: 0 2px 8px rgba(0,0,0,0.3);
        }

        .badge-photos {
            position: absolute;
            bottom: 12px;
            right: 12px;
            background: rgba(15, 23, 42, 0.85);
            backdrop-filter: blur(6px);
            border: 1px solid rgba(255, 255, 255, 0.1);
            color: var(--text-primary);
            padding: 4px 10px;
            border-radius: 6px;
            font-size: 11px;
            font-weight: 600;
        }

        .card-content {
            padding: 18px;
            display: flex;
            flex-direction: column;
            flex-grow: 1;
            gap: 12px;
        }

        .card-title {
            font-size: 17px;
            font-weight: 700;
            color: var(--text-primary);
            line-height: 1.3;
        }

        .card-subtitle {
            font-size: 13px;
            color: var(--text-secondary);
            margin-top: -6px;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }

        .specs-grid {
            display: grid;
            grid-template-columns: repeat(2, 1fr);
            gap: 8px;
            background: rgba(15, 23, 42, 0.5);
            padding: 10px;
            border-radius: 8px;
            font-size: 12px;
        }

        .spec-item {
            display: flex;
            align-items: center;
            gap: 6px;
            color: var(--text-secondary);
        }

        .spec-item strong {
            color: var(--text-primary);
        }

        .card-footer {
            margin-top: auto;
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding-top: 12px;
            border-top: 1px solid var(--border);
        }

        .price-tag {
            font-size: 20px;
            font-weight: 800;
            color: var(--success);
        }

        .price-tag.usd {
            color: var(--usd-color);
        }

        .btn-link {
            background: var(--accent);
            color: #0f172a;
            padding: 7px 14px;
            border-radius: 6px;
            text-decoration: none;
            font-size: 12px;
            font-weight: 700;
            transition: background-color 0.2s;
        }

        .btn-link:hover {
            background: var(--accent-hover);
        }

        .modal {
            display: none;
            position: fixed;
            top: 0;
            left: 0;
            width: 100vw;
            height: 100vh;
            background: rgba(15, 23, 42, 0.95);
            backdrop-filter: blur(8px);
            z-index: 9999;
            justify-content: center;
            align-items: center;
            padding: 20px;
        }

        .modal.active {
            display: flex;
        }

        .modal-content {
            max-width: 900px;
            width: 100%;
            background: var(--bg-card);
            border: 1px solid var(--border);
            border-radius: var(--radius);
            overflow: hidden;
            display: flex;
            flex-direction: column;
            max-height: 90vh;
        }

        .modal-header {
            padding: 16px 20px;
            display: flex;
            justify-content: space-between;
            align-items: center;
            border-bottom: 1px solid var(--border);
        }

        .modal-body {
            padding: 20px;
            overflow-y: auto;
            display: flex;
            flex-direction: column;
            gap: 16px;
            align-items: center;
        }

        .modal-main-img {
            max-width: 100%;
            max-height: 520px;
            object-fit: contain;
            border-radius: 8px;
        }

        .modal-thumbnails {
            display: flex;
            gap: 10px;
            overflow-x: auto;
            max-width: 100%;
            padding-bottom: 8px;
        }

        .modal-thumbnail {
            width: 80px;
            height: 60px;
            object-fit: cover;
            border-radius: 6px;
            cursor: pointer;
            border: 2px solid transparent;
            opacity: 0.6;
            transition: all 0.2s;
        }

        .modal-thumbnail.active, .modal-thumbnail:hover {
            opacity: 1;
            border-color: var(--accent);
        }

        .btn-close {
            background: none;
            border: none;
            color: var(--text-secondary);
            font-size: 24px;
            cursor: pointer;
            line-height: 1;
        }

        .btn-close:hover {
            color: var(--text-primary);
        }

        .empty-state {
            text-align: center;
            padding: 60px 20px;
            color: var(--text-secondary);
            grid-column: 1 / -1;
        }
    </style>
</head>
<body>
    <div class="container">
        <header>
            <div class="header-top">
                <h1>🚗 <span>Autocity</span> Usados Explorer</h1>
                <div class="stats-badge" id="statsBadge">Cargando inventario...</div>
            </div>

            <div class="controls-panel">
                <div class="control-group">
                    <label>Buscar</label>
                    <input type="text" id="searchInput" placeholder="Marca, modelo, versión, ID...">
                </div>
                <div class="control-group">
                    <label>Marca</label>
                    <select id="brandSelect">
                        <option value="">Todas las marcas</option>
                    </select>
                </div>
                <div class="control-group">
                    <label>Moneda</label>
                    <select id="currencySelect">
                        <option value="">Todas (ARS / USD)</option>
                        <option value="ARS">Pesos (ARS)</option>
                        <option value="USD">Dólares (USD)</option>
                    </select>
                </div>
                <div class="control-group">
                    <label>Sucursal</label>
                    <select id="branchSelect">
                        <option value="">Todas las sucursales</option>
                    </select>
                </div>
                <div class="control-group">
                    <label>Transmisión</label>
                    <select id="transSelect">
                        <option value="">Cualquiera</option>
                    </select>
                </div>
                <div class="control-group">
                    <label>Combustible</label>
                    <select id="fuelSelect">
                        <option value="">Cualquiera</option>
                    </select>
                </div>
                <div class="control-group">
                    <label>Ordenar por</label>
                    <select id="sortSelect">
                        <option value="price-asc">Precio: Menor a Mayor</option>
                        <option value="price-desc">Precio: Mayor a Menor</option>
                        <option value="km-asc">Menor Kilometraje</option>
                        <option value="year-desc" selected>Más Nuevos (Año)</option>
                    </select>
                </div>
            </div>
        </header>

        <main id="catalogGrid" class="grid"></main>
    </div>

    <!-- Gallery Modal -->
    <div class="modal" id="galleryModal">
        <div class="modal-content">
            <div class="modal-header">
                <h3 id="modalTitle">Galería de Fotos</h3>
                <button class="btn-close" onclick="closeModal()">&times;</button>
            </div>
            <div class="modal-body">
                <img id="modalMainImage" class="modal-main-img" src="" alt="Foto principal">
                <div class="modal-thumbnails" id="modalThumbnails"></div>
            </div>
        </div>
    </div>

    <script>
        const vehicles = %VEHICLES_JSON%;

        const formatMoney = (val, currency) => {
            if (!val) return 'Consultar';
            if (currency === 'USD') {
                return 'USD ' + Number(val).toLocaleString('es-AR');
            }
            return '$' + Number(val).toLocaleString('es-AR');
        };

        const formatKm = (val) => {
            if (val === null || val === undefined) return 'S/D';
            return Number(val).toLocaleString('es-AR') + ' km';
        };

        const brandSelect = document.getElementById('brandSelect');
        const branchSelect = document.getElementById('branchSelect');
        const currencySelect = document.getElementById('currencySelect');
        const transSelect = document.getElementById('transSelect');
        const fuelSelect = document.getElementById('fuelSelect');
        const searchInput = document.getElementById('searchInput');
        const sortSelect = document.getElementById('sortSelect');
        const grid = document.getElementById('catalogGrid');
        const statsBadge = document.getElementById('statsBadge');

        const uniqueBrands = [...new Set(vehicles.map(v => v.marca).filter(Boolean))].sort();
        const uniqueBranches = [...new Set(vehicles.map(v => v.sucursal).filter(Boolean))].sort();
        const uniqueTrans = [...new Set(vehicles.map(v => v.transmision).filter(Boolean))].sort();
        const uniqueFuels = [...new Set(vehicles.map(v => v.combustible).filter(Boolean))].sort();

        uniqueBrands.forEach(b => brandSelect.innerHTML += `<option value="${b}">${b}</option>`);
        uniqueBranches.forEach(b => branchSelect.innerHTML += `<option value="${b}">${b}</option>`);
        uniqueTrans.forEach(t => transSelect.innerHTML += `<option value="${t}">${t}</option>`);
        uniqueFuels.forEach(f => fuelSelect.innerHTML += `<option value="${f}">${f}</option>`);

        function renderCatalog() {
            const query = searchInput.value.toLowerCase().trim();
            const brand = brandSelect.value;
            const branch = branchSelect.value;
            const currency = currencySelect.value;
            const trans = transSelect.value;
            const fuel = fuelSelect.value;
            const sort = sortSelect.value;

            let filtered = vehicles.filter(v => {
                const matchesSearch = !query || 
                    (v.marca && v.marca.toLowerCase().includes(query)) ||
                    (v.modelo && v.modelo.toLowerCase().includes(query)) ||
                    (v.version && v.version.toLowerCase().includes(query)) ||
                    (v.id && String(v.id).includes(query)) ||
                    (v.color && v.color.toLowerCase().includes(query));

                const matchesBrand = !brand || v.marca === brand;
                const matchesBranch = !branch || v.sucursal === branch;
                const matchesCurrency = !currency || v.moneda === currency;
                const matchesTrans = !trans || v.transmision === trans;
                const matchesFuel = !fuel || v.combustible === fuel;

                return matchesSearch && matchesBrand && matchesBranch && matchesCurrency && matchesTrans && matchesFuel;
            });

            filtered.sort((a, b) => {
                if (sort === 'price-asc') return (a.precio || 0) - (b.precio || 0);
                if (sort === 'price-desc') return (b.precio || 0) - (a.precio || 0);
                if (sort === 'km-asc') return (a.kilometros || 0) - (b.kilometros || 0);
                if (sort === 'year-desc') return (b.anio || 0) - (a.anio || 0);
                return 0;
            });

            statsBadge.innerHTML = `Mostrando <strong>${filtered.length}</strong> de <strong>${vehicles.length}</strong> usados`;

            if (filtered.length === 0) {
                grid.innerHTML = `<div class="empty-state"><h3>No se encontraron vehículos con los filtros seleccionados</h3></div>`;
                return;
            }

            grid.innerHTML = filtered.map(v => {
                const hasPhotos = v.fotos && v.fotos.length > 0;
                const mainPhoto = hasPhotos ? v.fotos[0] : '';
                const photosCount = hasPhotos ? v.fotos.length : 0;
                const isUsd = v.moneda === 'USD';
                const photosParam = encodeURIComponent(JSON.stringify(v.fotos || []));

                return `
                    <div class="card">
                        <div class="image-container" onclick="openModal('${v.marca || ''} ${v.modelo || ''}', '${photosParam}')">
                            ${hasPhotos ? `
                                <img src="${mainPhoto}" alt="${v.marca} ${v.modelo}" loading="lazy" onerror="this.src='https://placehold.co/400x250/1e293b/64748b?text=Foto+no+disponible'">
                                <div class="badge-photos">📷 ${photosCount} ${photosCount === 1 ? 'foto' : 'fotos'}</div>
                            ` : `
                                <div class="no-image">
                                    <span>📷 Sin fotos cargadas</span>
                                </div>
                            `}
                            ${v.sucursal ? `<div class="badge-branch">📍 ${v.sucursal}</div>` : ''}
                            ${isUsd ? `<div class="badge-currency">USD</div>` : ''}
                        </div>
                        <div class="card-content">
                            <div>
                                <h2 class="card-title">${v.marca || ''} ${v.modelo || ''}</h2>
                                <p class="card-subtitle" title="${v.version || ''}">${v.version || ''}</p>
                            </div>

                            <div class="specs-grid">
                                <div class="spec-item">📅 Año: <strong>${v.anio || 'S/D'}</strong></div>
                                <div class="spec-item">🛣️ <strong>${formatKm(v.kilometros)}</strong></div>
                                <div class="spec-item">⚙️ <strong>${v.transmision || 'S/D'}</strong></div>
                                <div class="spec-item">⛽ <strong>${v.combustible || 'S/D'}</strong></div>
                                <div class="spec-item">🎨 Color: <strong>${v.color || 'S/D'}</strong></div>
                                <div class="spec-item">🏷️ ID: <strong>#${v.id}</strong></div>
                            </div>

                            <div class="card-footer">
                                <div class="price-tag ${isUsd ? 'usd' : ''}">${formatMoney(v.precio, v.moneda)}</div>
                                <a href="${v.url}" target="_blank" class="btn-link">Ver en Autocity ↗</a>
                            </div>
                        </div>
                    </div>
                `;
            }).join('');
        }

        [searchInput, brandSelect, branchSelect, currencySelect, transSelect, fuelSelect, sortSelect].forEach(elem => {
            elem.addEventListener('input', renderCatalog);
        });

        const modal = document.getElementById('galleryModal');
        const modalTitle = document.getElementById('modalTitle');
        const modalMainImage = document.getElementById('modalMainImage');
        const modalThumbnails = document.getElementById('modalThumbnails');

        function openModal(title, photosJsonEncoded) {
            const photos = JSON.parse(decodeURIComponent(photosJsonEncoded));
            if (!photos || photos.length === 0) return;

            modalTitle.innerText = title;
            modalMainImage.src = photos[0];

            modalThumbnails.innerHTML = photos.map((url, idx) => `
                <img src="${url}" class="modal-thumbnail ${idx === 0 ? 'active' : ''}" onclick="selectModalImage('${url}', this)">
            `).join('');

            modal.classList.add('active');
        }

        function selectModalImage(url, imgElem) {
            modalMainImage.src = url;
            document.querySelectorAll('.modal-thumbnail').forEach(t => t.classList.remove('active'));
            imgElem.classList.add('active');
        }

        function closeModal() {
            modal.classList.remove('active');
        }

        window.onclick = (e) => {
            if (e.target === modal) closeModal();
        };

        renderCatalog();
    </script>
</body>
</html>
"""

    final_html = html_template.replace("%VEHICLES_JSON%", json.dumps(vehicles, ensure_ascii=False))
    output_html = Path("catalogo.html")
    output_html.write_text(final_html, encoding="utf-8")
    print(f"Catálogo HTML generado exitosamente en: {output_html.resolve()}")

if __name__ == "__main__":
    generate_catalog()
