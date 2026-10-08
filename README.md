# MetaLimpia

[![Privacy Guard](https://github.com/DarakoG/metalimpia/actions/workflows/deploy.yml/badge.svg)](https://github.com/DarakoG/metalimpia/actions/workflows/deploy.yml)
[![0 external requests](https://img.shields.io/badge/privacy-0%20external%20requests-brightgreen)](docs/PRIVACY_AUDIT.md)

> Tu archivo nunca sale del navegador. No podemos verlo aunque quisiéramos.

MetaLimpia es una página web gratuita que te permite **revisar y eliminar los metadatos** de tus archivos (fotos, PDFs, documentos de Office) **directamente en tu navegador**, sin subirlos a ningún servidor.

## Por qué existe

Cuando compartís una foto o un documento, frecuentemente está lleno de metadatos invisibles: dónde se tomó la foto, qué cámara usaste, quién editó el documento, en qué organización trabajás. Las herramientas existentes para limpiar esto:

- Requieren conocimiento técnico (línea de comandos)
- O suben tu archivo a servidores remotos (riesgo de privacidad)

MetaLimpia resuelve ambas: usa el motor de metadatos más completo del mundo (ExifTool) ejecutándose localmente en tu navegador.

## Características

- **Privacidad real**: cero subida de archivos. Tu archivo se abre, se procesa y se descarga limpio, todo en tu navegador.
- **Limpieza automática en serie**: seleccioná uno o varios archivos; cada archivo compatible se limpia y su descarga se inicia antes de procesar el siguiente.
- **Revisión selectiva disponible**: la ruta manual permite revisar los metadatos y elegir cuáles borrar.
- **Cobertura amplia**: JPG, PNG, TIFF, HEIC, PDF, DOCX, XLSX, PPTX — según lo que cada formato y motor permita eliminar.
- **Verificable**: código fuente público, sin servicios externos, sin analytics.
- **Gratis y de código abierto** (MIT).

## Verificador de privacidad

La página incluye un widget que te muestra en tiempo real que **cero conexiones** se hacen con servidores externos. La promesa de privacidad es técnica, no marketing.

## Cómo usar

1. Abrí [MetaLimpia](https://darakog.github.io/metalimpia/) (o tu instancia local).
2. Arrastrá o seleccioná uno o varios archivos para iniciar la limpieza automática, en orden.
3. Consultá el estado de cada archivo; si uno falla, los siguientes continúan.
4. Si necesitás elegir qué borrar, usá **Revisar metadatos y elegir qué borrar** antes de seleccionar el archivo.

El navegador puede bloquear descargas múltiples; MetaLimpia informa que inició cada descarga, pero no puede confirmar que se haya guardado. Los originales no se modifican. El límite técnico es de 200 MiB por archivo; archivos grandes pueden tardar y consumir memoria del navegador, sin una garantía de rendimiento para dispositivos móviles.

Antes de procesar un PDF, tené en cuenta que reescribirlo invalida firmas digitales. No se eliminan autores de anotaciones por página ni datos personales visibles en el contenido.

## Privacidad y seguridad

- Sin cuentas, sin login, sin cookies de rastreo.
- Sin Google Fonts, sin CDNs externos, sin analytics.
- Sin telemetría. Lo que pasa en tu navegador se queda en tu navegador.
- HTTPS obligatorio (GitHub Pages lo fuerza por defecto).
- Política de privacidad completa: [/privacidad.html](https://darakog.github.io/metalimpia/privacidad.html).

### Limitaciones honestas de la plataforma

MetaLimpia se sirve desde GitHub Pages, que **no permite** configurar headers HTTP personalizados en el sitio estático. Esto tiene dos consecuencias para el modelo de privacidad:

- **Content Security Policy**: se aplica vía `<meta http-equiv="Content-Security-Policy">` en `index.html`. La forma `<meta>` es **idéntica en alcance a la forma header** para todas las directivas excepto `frame-ancestors` y `report-uri` / `report-to`, que los navegadores ignoran cuando vienen del `<meta>`. La política sigue siendo suficiente para prevenir XSS (no hay `unsafe-inline`, no hay `unsafe-eval`).
- **Frame-ancestors no se enforce**: un sitio malicioso *podría* iframar esta página. La app no tiene acciones que cambien estado, así que el peor caso es vandalismo visual. Aceptable para MVP.
- **Sin service worker intencionalmente**: no instalamos un SW que inyecte headers CSP, porque eso contradice la promesa de "cero estado del lado servidor" y agrega superficie de ataque.

Las opciones para llegar a header-CSP completo serían migrar a Netlify, Vercel o Cloudflare Pages (que soportan `_headers` o equivalentes). Esa migración queda fuera del MVP.

## Desarrollo

### Requisitos

- Node.js 20 o superior
- npm

### Comandos

```bash
npm install     # instalar dependencias
npm run dev     # servidor local de desarrollo
npm run build   # generar build de producción en dist/
npm run preview # servir el build localmente
```

### Testing

La privacidad se garantiza con una **suite automatizada de Playwright** que corre en cada push a `main`. Si una prueba falla, el deploy a GitHub Pages se bloquea (el job `deploy` en `.github/workflows/deploy.yml` tiene `needs: build → needs: test`).

#### Cómo correr los tests localmente

```bash
# Una vez por máquina:
npm install
npx playwright install chromium

# Cada vez:
node scripts/generate-test-fixture.mjs   # genera tests/fixtures/sample-with-author.png
npx playwright test                       # corre la suite
```

Chromium es el único navegador instalado — la decisión de la Fase 8 es explícita (la matriz cross-browser es trabajo de la Fase 9 / QA manual). El binario del navegador vive en `~/.cache/ms-playwright/` (Linux/macOS) o `%LOCALAPPDATA%\ms-playwright\` (Windows) y **no** se commitea.

#### Qué cubre cada spec

| Archivo                              | Qué verifica                                                                                                                                                              |
|--------------------------------------|---------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `tests/privacy-guard.spec.js`        | **El gate.** Corre el flujo completo (drop → analyze → results → clean → download) y verifica que cada `request` capturado por Playwright sea same-origin. Falla el deploy si cualquier request cruza el origen. |
| `tests/full-flow.spec.js`            | Verificación funcional de la máquina de estados: drop de archivo → la tarjeta de resultados muestra el tag `Author` clasificado bajo el grupo `author`. Cobertura mínima para detectar regresiones del parser o del clasificador de grupos. |
| `tests/regression.spec.js`           | Dos pruebas: (1) que Playwright detectaría un `fetch` cross-origin inyectado vía `addInitScript`, y (2) que la lógica de clasificación de origins (origen page vs. opaco vs. cross-origin) replica exactamente la del verifier en producción. |

#### Garantía enforced por la suite

- **Cero requests cross-origin** durante el flujo completo del usuario.
- El Privacy Verifier en pantalla reporta `data-external-count="0"`.
- La lógica de clasificación de URLs no confunde origines opacos (`data:`, `about:blank`, `blob:`) con origines externos — un error allí marcaría URLs internas como "externas" y rompería la garantía en cualquier página que use URLs internas legítimas.
- Las fases futuras que agreguen cualquier dependencia externa (CDN, analytics, fonts remotas, telemetría) deben fallar este gate antes de hacer merge.

#### Cómo agregar tests

1. Crear un archivo nuevo en `tests/<algo>.spec.js`. Playwright auto-descubre specs por nombre (`*.spec.js`).
2. Si el test necesita el Worker de ExifTool, llamar a la helper `patchWorkerBundle(page)` documentada en `tests/full-flow.spec.js` (workaround para un bug de detección en el runtime de ZeroPerl vendoreado).
3. Correr `npx playwright test --grep "<test name>"` para iterar.
4. Si el test modifica `dist/` (por ejemplo, agrega un asset nuevo), actualizar `playwright.config.js` → `webServer.command` o el listado de assets verificados por `tests/privacy-guard.spec.js`.

Los artefactos del test (screenshots, traces, video on failure) van a `test-results/` y `playwright-report/` (ambos en `.gitignore`).

### Estructura del proyecto

```
metalimpia/
├── index.html
├── css/
│   └── styles.css
├── js/
│   ├── main.js
│   ├── i18n.js
│   ├── fileHandler.js
│   ├── exiftoolLoader.js
│   ├── metadataParser.js
│   ├── ui/
│   └── workers/
├── assets/
├── locales/
│   └── es.json
├── docs/
│   └── privacidad.html
└── .github/
    └── workflows/
        └── deploy.yml
```

### Documentación

Toda la documentación del proyecto está en [`docs/superpowers/specs/`](./docs/superpowers/specs/):

- [Design Spec](./docs/superpowers/specs/2026-09-21-metalimpia-design.md)
- [PRD](./docs/superpowers/specs/2026-09-21-metalimpia-prd.md)
- [TRD](./docs/superpowers/specs/2026-09-21-metalimpia-trd.md)
- [Data Model](./docs/superpowers/specs/2026-09-21-metalimpia-data-model.md)
- [Flow](./docs/superpowers/specs/2026-09-21-metalimpia-flow.md)
- [Adversarial Testing](./docs/superpowers/specs/2026-09-21-metalimpia-adversarial-testing.md)
- [Implementation Plan](./docs/superpowers/specs/2026-09-21-metalimpia-implementation-plan.md)

## Licencia

MIT. Ver [LICENSE](./LICENSE).

## Créditos

- **ExifTool** por Phil Harvey — el motor de metadatos que hace todo el trabajo pesado. Licencia Artistic / GPL.
- **Vite** — herramienta de build.
