#!/usr/bin/env python3
"""
PoC: Autocity -> usados -> datos estructurados.

Objetivo:
- Obtener el catálogo de usados desde la Store API de WooCommerce.
- Descargar la ficha HTML de cada vehículo.
- Extraer datos que no aparecen en la Store API:
  año, kilometraje, color, combustible, transmisión, fotos y moneda/precio real (ARS/USD).
- Guardar el resultado en output.json.

Dependencias:
    pip install requests beautifulsoup4
"""

import html
import json
import re
import time
from decimal import Decimal
from pathlib import Path
from typing import Any
from urllib.parse import quote, unquote, urljoin, urlsplit, urlunsplit

import requests
from bs4 import BeautifulSoup


BASE_URL = "https://autocity.com.ar"
STORE_API = f"{BASE_URL}/wp-json/wc/store/v1/products"

# Para pruebas puntuales dejamos los 3 usados iniciales del discovery.
TEST_IDS = [93401, 93181, 93018]

# False = prueba con los TEST_IDS.
# True  = recorre todo el catálogo de usados.
FULL_CATALOG = True

REQUEST_DELAY_SECONDS = 0.5
TIMEOUT_SECONDS = 20

VALID_FUELS = {
    "nafta": "Nafta",
    "diesel": "Diésel",
    "diésel": "Diésel",
    "gnc": "GNC",
    "nafta/gnc": "Nafta/GNC",
    "hibrido": "Híbrido",
    "híbrido": "Híbrido",
    "electrico": "Eléctrico",
    "eléctrico": "Eléctrico",
}

session = requests.Session()
session.headers.update(
    {
        "User-Agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/139.0 Safari/537.36"
        ),
        "Accept-Language": "es-AR,es;q=0.9,en;q=0.8",
    }
)


def get_json(url: str, params: dict[str, Any] | None = None) -> Any:
    response = session.get(url, params=params, timeout=TIMEOUT_SECONDS)
    response.raise_for_status()
    return response.json()


def normalize_text(value: str | None) -> str:
    if not value:
        return ""
    unescaped = html.unescape(str(value))
    return re.sub(r"\s+", " ", unescaped).strip()


def parse_money(product: dict[str, Any]) -> int | None:
    prices = product.get("prices") or {}
    raw = prices.get("regular_price")
    minor_unit = int(prices.get("currency_minor_unit", 2))

    if raw in (None, ""):
        return None

    try:
        return int(Decimal(str(raw)) / (Decimal(10) ** minor_unit))
    except Exception:
        return None


def extract_brand_and_model(product: dict[str, Any]) -> tuple[str | None, str | None]:
    permalink = product.get("permalink") or ""
    match = re.search(r"/m-([^/]+)/m-([^/]+)/", permalink)

    brand_slug = match.group(1).lower() if match else None
    model_slug = match.group(2).lower() if match else None

    brand_target = f"m-{brand_slug}" if brand_slug else None
    model_target = f"m-{model_slug}" if model_slug else None

    brand_name: str | None = None
    model_name: str | None = None

    categories = product.get("categories") or []
    for cat in categories:
        c_slug = str(cat.get("slug", "")).lower()
        c_name = normalize_text(cat.get("name", ""))

        if brand_target and (c_slug == brand_target or c_slug == brand_slug):
            brand_name = c_name
        if model_target and (c_slug == model_target or c_slug == model_slug):
            model_name = c_name

    if not brand_name and brand_slug:
        brand_name = brand_slug.replace("-", " ").title()
    if not model_name and model_slug:
        model_name = model_slug.replace("-", " ").title()

    return brand_name, model_name


def classify_categories(product: dict[str, Any]) -> dict[str, Any]:
    categories = product.get("categories") or []
    names = [normalize_text(c.get("name", "")) for c in categories]
    slugs = [str(c.get("slug", "")).lower() for c in categories]

    branches = {
        "cordoba": "Córdoba",
        "rio-cuarto": "Río Cuarto",
        "villa-maria": "Villa María",
        "san-luis": "San Luis",
    }

    branch = None
    for slug, label in branches.items():
        if slug in slugs:
            branch = label
            break

    condition = "usado" if "usados" in slugs else None

    return {
        "condicion": condition,
        "sucursal": branch,
        "categorias": names,
    }


def extract_vehicle_summary(soup: BeautifulSoup) -> dict[str, Any]:
    text = normalize_text(soup.get_text(" ", strip=True))

    result: dict[str, Any] = {
        "anio": None,
        "kilometros": None,
        "color": None,
    }

    patterns = [
        re.compile(
            r"\b(20\d{2})\s*\|\s*([\d\.\,]+)\s*km\s*\|\s*([^|]{1,40})",
            re.I,
        ),
        re.compile(
            r"\b(20\d{2})\s*[|·\-]\s*([\d\.\,]+)\s*km\s*[|·\-]\s*([^|]{1,40})",
            re.I,
        ),
    ]

    for pattern in patterns:
        match = pattern.search(text)
        if match:
            result["anio"] = int(match.group(1))
            result["kilometros"] = int(
                re.sub(r"\D", "", match.group(2)) or "0"
            )
            raw_color = normalize_text(
                re.split(r"\s+Ficha\s+t[eé]cnica\b", match.group(3), maxsplit=1, flags=re.I)[0]
            )
            result["color"] = raw_color if raw_color else None
            break

    if result["anio"] is None:
        match = re.search(r"\b(20\d{2})\b", text)
        if match:
            result["anio"] = int(match.group(1))

    if result["kilometros"] is None:
        match = re.search(r"\b([\d\.\,]+)\s*km\b", text, re.I)
        if match:
            result["kilometros"] = int(re.sub(r"\D", "", match.group(1)) or "0")

    return result


def extract_real_price_and_currency(soup: BeautifulSoup, default_price: int | None, default_currency: str = "ARS") -> tuple[int | None, str]:
    """
    Detecta si el vehículo está publicado en USD en el HTML de la página.
    Si está en USD, extrae el precio en dólares. De lo contrario, conserva ARS.
    """
    price_el = soup.select_one(".ac-product-financia-price")
    if price_el:
        price_text = normalize_text(price_el.get_text(" ", strip=True))
        if any(sym in price_text for sym in ["USD", "U$S", "US$"]):
            m = re.search(r"(?:USD|U\$S|US\$)\s*([\d\.\,]+)", price_text, re.I)
            if m:
                usd_val = int(re.sub(r"\D", "", m.group(1)) or "0")
                if usd_val > 0:
                    return usd_val, "USD"

    return default_price, default_currency


def extract_fuel(soup: BeautifulSoup) -> str | None:
    for title in soup.select(".feature-title, .product-feature-title, th, dt"):
        title_text = normalize_text(title.get_text(" ", strip=True))
        if re.search(r"\bcombustible\b", title_text, re.I):
            sibling = title.find_next_sibling(class_="feature-detail") or title.find_next_sibling()
            if sibling:
                val = normalize_text(sibling.get_text(" ", strip=True)).lower()
                if val in VALID_FUELS:
                    return VALID_FUELS[val]

    text = normalize_text(soup.get_text(" ", strip=True))
    match = re.search(
        r"\|\s*(Nafta|Diesel|Di[eé]sel|GNC|Nafta/GNC|H[ií]brido|El[eé]ctrico)\s+20\d{2}\s*\|",
        text,
        re.I,
    )
    if match:
        val = match.group(1).lower()
        if val in VALID_FUELS:
            return VALID_FUELS[val]

    match = re.search(
        r"\bCombustible\s*[:|]\s*(Nafta|Diesel|Di[eé]sel|GNC|Nafta/GNC|H[ií]brido|El[eé]ctrico)\b",
        text,
        re.I,
    )
    if match:
        val = match.group(1).lower()
        if val in VALID_FUELS:
            return VALID_FUELS[val]

    return None


def extract_transmission(soup: BeautifulSoup) -> str | None:
    raw_value = None

    label_re = re.compile(r"Tipo\s+de\s+transmisi[oó]n|Transmisi[oó]n", re.I)
    for title in soup.select(".feature-title, .product-feature-title, th, dt"):
        if label_re.search(normalize_text(title.get_text(" ", strip=True))):
            detail = title.find_next_sibling(class_="feature-detail") or title.find_next_sibling()
            if detail:
                raw_value = normalize_text(detail.get_text(" ", strip=True))
                break

    if not raw_value:
        text = normalize_text(soup.get_text(" ", strip=True))
        match = re.search(
            r"(?:Tipo\s+de\s+)?transmisi[oó]n\s*[:|]?\s*([A-Za-zÁÉÍÓÚáéíóúÑñ]+)",
            text,
            re.I,
        )
        if match:
            raw_value = match.group(1)

    if not raw_value:
        return None

    cleaned = re.sub(r"^(?:tipo\s+de\s+)?transmisi[oó]n\s*[:|-]?\s*", "", raw_value, flags=re.I).strip()
    cleaned_lower = cleaned.lower()

    if "auto" in cleaned_lower:
        return "Automático"
    elif "man" in cleaned_lower:
        return "Manual"
    elif "cvt" in cleaned_lower:
        return "CVT"

    return cleaned.capitalize() if cleaned else None


def normalize_image_url(url: str) -> str:
    parts = urlsplit(url)
    path = quote(unquote(parts.path), safe="/%:@-._~!$&'()*+,;=")
    clean_url = urlunsplit((parts.scheme, parts.netloc, path, parts.query, parts.fragment))
    clean_url = clean_url.rstrip(")\"'")
    return clean_url


def extract_images(soup: BeautifulSoup) -> list[str]:
    urls: list[str] = []

    gallery_container = soup.select_one(
        ".ac-single-product-gallery, .elementor-gallery__container, .woocommerce-product-gallery"
    )
    scope = gallery_container if gallery_container else soup

    for item in scope.select(".e-gallery-item, [data-thumbnail], [data-back]"):
        for attr in ["data-back", "data-thumbnail", "href"]:
            val = item.get(attr)
            if val and "cdn.asofix.com" in val:
                norm = normalize_image_url(urljoin(BASE_URL, val))
                if norm not in urls:
                    urls.append(norm)

    for img in scope.find_all("img"):
        if any("carousel-autocity" in str(c) for p in img.parents for c in (p.get("class") or [])):
            continue

        candidates = [
            img.get("src"),
            img.get("data-src"),
            img.get("data-lazy-src"),
            img.get("data-original"),
        ]

        srcset = img.get("srcset") or img.get("data-srcset")
        if srcset:
            candidates.extend(
                part.strip().split(" ")[0]
                for part in srcset.split(",")
                if part.strip()
            )

        for candidate in candidates:
            if not candidate:
                continue

            absolute = normalize_image_url(urljoin(BASE_URL, candidate))
            if "cdn.asofix.com" in absolute.lower() and absolute not in urls:
                urls.append(absolute)

    return urls


def extract_html_data(url: str, current_price: int | None, current_currency: str = "ARS") -> dict[str, Any]:
    response = session.get(url, timeout=TIMEOUT_SECONDS)
    response.raise_for_status()

    response.encoding = "utf-8"
    cleaned_html = html.unescape(response.text)
    soup = BeautifulSoup(cleaned_html, "html.parser")

    summary = extract_vehicle_summary(soup)
    real_price, real_currency = extract_real_price_and_currency(soup, current_price, current_currency)

    return {
        **summary,
        "precio": real_price,
        "moneda": real_currency,
        "combustible": extract_fuel(soup),
        "transmision": extract_transmission(soup),
        "fotos": extract_images(soup),
    }


def fetch_used_catalog() -> list[dict[str, Any]]:
    if not FULL_CATALOG:
        products = []

        for product_id in TEST_IDS:
            url = f"{STORE_API}/{product_id}"
            product = get_json(url)

            slugs = {
                str(c.get("slug", "")).lower()
                for c in product.get("categories", [])
            }
            if "usados" in slugs:
                products.append(product)

        return products

    products: list[dict[str, Any]] = []
    page = 1

    while True:
        print(f"Descargando catálogo: página {page}...")

        response = session.get(
            STORE_API,
            params={
                "category": 152,
                "per_page": 100,
                "page": page,
            },
            timeout=TIMEOUT_SECONDS,
        )

        if response.status_code == 400 and page > 1:
            break

        response.raise_for_status()
        batch = response.json()

        if not batch:
            break

        products.extend(batch)

        total_pages = int(response.headers.get("X-WP-TotalPages", page))
        if page >= total_pages:
            break

        page += 1
        time.sleep(REQUEST_DELAY_SECONDS)

    return products


def normalize_product(product: dict[str, Any]) -> dict[str, Any]:
    category_data = classify_categories(product)
    brand_name, model_name = extract_brand_and_model(product)

    raw_name = product.get("name") or ""
    version = normalize_text(raw_name)

    record = {
        "id": product.get("id"),
        "marca": brand_name,
        "modelo": model_name,
        "version": version,
        "precio": parse_money(product),
        "moneda": (product.get("prices") or {}).get("currency_code") or "ARS",
        "condicion": category_data["condicion"],
        "sucursal": category_data["sucursal"],
        "categorias": category_data["categorias"],
        "stock": product.get("is_in_stock"),
        "url": product.get("permalink"),
        "anio": None,
        "kilometros": None,
        "color": None,
        "combustible": None,
        "transmision": None,
        "fotos": [],
        "error_html": None,
    }

    return record


def main() -> None:
    products = fetch_used_catalog()

    print(f"\nVehículos usados encontrados: {len(products)}")

    results = []

    for index, product in enumerate(products, start=1):
        record = normalize_product(product)

        print(
            f"[{index}/{len(products)}] "
            f"ID {record['id']} — {record['marca']} {record['modelo']} ({record['version']})"
        )

        try:
            html_data = extract_html_data(record["url"], record["precio"], record["moneda"])
            record.update(html_data)
        except Exception as exc:
            record["error_html"] = f"{type(exc).__name__}: {exc}"
            print(f"  ERROR HTML: {record['error_html']}")

        results.append(record)

        if index < len(products):
            time.sleep(REQUEST_DELAY_SECONDS)

    output = Path("output.json")
    output.write_text(
        json.dumps(results, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    print(f"\nListo. Resultado guardado en: {output.resolve()}")


if __name__ == "__main__":
    main()
