# MetaLimpia

> Tu archivo nunca sale del navegador. No podemos verlo aunque quisiéramos.

MetaLimpia es una página web gratuita que te permite **revisar y eliminar los metadatos** de tus archivos (fotos, PDFs, documentos de Office) **directamente en tu navegador**, sin subirlos a ningún servidor.

## Por qué existe

Cuando compartís una foto o un documento, frecuentemente está lleno de metadatos invisibles: dónde se tomó la foto, qué cámara usaste, quién editó el documento, en qué organización trabajás. Las herramientas existentes para limpiar esto:

- Requieren conocimiento técnico (línea de comandos)
- O suben tu archivo a servidores remotos (riesgo de privacidad)

MetaLimpia resuelve ambas: usa el motor de metadatos más completo del mundo (ExifTool) ejecutándose localmente en tu navegador.

## Características

- **Privacidad real**: cero subida de archivos. Tu archivo se abre, se procesa y se descarga limpio, todo en tu navegador.
- **Cobertura amplia**: JPG, PNG, TIFF, HEIC, PDF, DOCX, XLSX, PPTX — y más en el futuro.
- **Verificable**: código fuente público, sin servicios externos, sin analytics.
- **Gratis y de código abierto** (MIT).

## Verificador de privacidad

La página incluye un widget que te muestra en tiempo real que **cero conexiones** se hacen con servidores externos. La promesa de privacidad es técnica, no marketing.

## Cómo usar

1. Abrí [metalimpia.app](https://metalimpia.app) (o tu instancia local).
2. Arrastrá tu archivo o hacé click para seleccionarlo.
3. Revisá los metadatos encontrados.
4. Elegí qué borrar (todo o selectivo).
5. Descargá el archivo limpio.

## Privacidad y seguridad

- Sin cuentas, sin login, sin cookies de rastreo.
- Sin Google Fonts, sin CDNs externos, sin analytics.
- Sin telemetría. Lo que pasa en tu navegador se queda en tu navegador.
- HTTPS obligatorio.
- Política de privacidad completa: [/privacidad](https://metalimpia.app/privacidad).

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
