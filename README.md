# Viseña

Aplicación de práctica de Lengua de Señas Ecuatoriana con cámara, espejo digital, avatar 3D, calificación de similitud e historial persistente. Incluye 40 plantillas experimentales en Saludos, Familia, Colores y Números.

## Arranque con Docker en Windows

Requisitos previos: Docker Desktop con motor Linux, Node.js 24 y Bun. La primera instalación necesita conexión para descargar dependencias. Los modelos de visión, el avatar y las 40 plantillas forman parte del proyecto.

~~~powershell
cd C:\Visenia\visenia\frontend
bun install --frozen-lockfile
bun run build
cd ..
if (!(Test-Path deploy/.env)) {
    Copy-Item deploy/.env.example deploy/.env
    notepad deploy/.env
}
docker compose --env-file deploy/.env -f deploy/docker-compose.yml up -d --build
~~~

En la primera instalación, asigna una contraseña a POSTGRES_PASSWORD en .env. Conserva la contraseña de un volumen existente.

Abre [Viseña](https://localhost). Caddy genera un certificado local. Para confiar en la autoridad de este laboratorio, ejecuta una sola vez:

~~~powershell
$certificadoVisenia = Join-Path $env:TEMP 'visenia-caddy-root.crt'
docker cp visenia-caddy-proxy:/data/caddy/pki/authorities/local/root.crt "$certificadoVisenia"
Import-Certificate -FilePath $certificadoVisenia -CertStoreLocation Cert:\CurrentUser\Root
~~~

Recarga Viseña con conexión después de compilar una actualización del frontend.

## Primera práctica

1. Abre una temática y elige una seña.
2. Permite el acceso a la cámara y reproduce la guía.
3. Pulsa **Probar seña**, realiza un gesto y pulsa **Terminar toma**. La captura termina a los seis segundos.
4. Revisa la nota sobre 100, el consejo y la zona resaltada.
5. Abre **Mi historial y progreso** para consultar resultados y exportarlos. Cada intento con nota suma 10 XP.

El coach ofrece un consejo local y permite ampliarlo con Groq cuando el servidor tiene configurada `GROQ_API_KEY`. [Proyecto y operación](docs/PROYECTO.md)

**Reconocimiento libre** busca la coincidencia más cercana en las 40 plantillas. La calificación de similitud describe la comparación geométrica. La aprobación educativa y sus estrellas requieren umbrales revisados por seña.

## Documentación mantenida

- [Proyecto y operación](docs/PROYECTO.md), con arquitectura, configuración, persistencia, pruebas y respaldo.
- [Contrato de API LSEC](docs/visena-lsec-contract.md).
- [Fuentes y vocabulario](docs/fuentes-lsec.md).
