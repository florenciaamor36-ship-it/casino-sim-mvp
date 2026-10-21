# Preview en Cloudflare Workers

El Worker sirve `public/index.html` desde KV y expone la API de demostración. El namespace `CASINO_KV` conserva un saldo ficticio por cookie de navegador. La preview es para pruebas individuales; Cloudflare KV no ofrece transacciones atómicas para el saldo y no debe usarse como billetera de producción.

La variante local oficial sigue siendo `app.py` + SQLite; ejecutá sus pruebas con `python3 -m unittest discover -s tests -v`.

El Worker se sube como módulo ES (`worker.js`) con `metadata.json` y la binding `CASINO_KV`. La UI se carga en la clave `index.html`. El token de Cloudflare se mantiene fuera del repo y debe tener permisos de Workers Scripts y Workers KV.
