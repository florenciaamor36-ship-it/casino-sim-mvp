# Casino Sim MVP

**Demo online:** https://casino-sim-mvp-preview.tiendasshoficial.workers.dev/

Prototipo aislado de backend para casino **de simulación**, con créditos ficticios. No contiene juegos comerciales, arte ajeno, depósitos ni retiros.

La preview web usa un Worker de Cloudflare y una KV separada; el backend local con SQLite es la variante de referencia. La KV de la preview no ofrece transacciones atómicas, por eso es solo para pruebas individuales y no para manejar saldos de producción.

## Ejecutar en local

Requiere Python 3.11 o superior; no hay dependencias externas.

```bash
python3 app.py
```

Abrir `http://localhost:8000`.

## Probar reglas y contabilidad

```bash
python3 -m unittest discover -s tests -v
```

## Qué demuestra

- El resultado de la tirada lo genera el servidor usando `secrets`, no el navegador.
- La apuesta, el premio y el saldo se actualizan dentro de una transacción SQLite.
- Cada giro exige `requestId`; repetir la misma petición no vuelve a descontar créditos.
- Se registran los movimientos en un ledger virtual y la respuesta del giro queda guardada.
- El endpoint de reinicio solo restablece los créditos de demostración y deja constancia en el ledger.

## API de la demo

- `GET /api/health`
- `GET /api/state`
- `POST /api/spin` con `{"requestId":"id-unico-1234","bet":100}`
- `POST /api/demo/reset`

Apuestas permitidas: 10 a 1.000 créditos, en saltos de 10.

## Alcance y seguridad

Esto es una **demo técnica**, no una plataforma de casino lista para producción. La cuenta `demo` es única y no hay autenticación real; la tabla de pagos y probabilidades son ilustrativas y no están certificadas. No usar con dinero real, pagos, datos personales ni como sistema de cuentas de clientes. Para el producto habría que añadir autenticación, autorización de administración, límites, monitoreo, pruebas de concurrencia, copias de seguridad y revisión legal/de seguridad.

La interfaz usa símbolos tipográficos únicamente para probar el flujo; no reemplaza el arte ni las animaciones de tus máquinas.


## Integración aislada de Slot Lab

`slot-lab/` es una copia para pruebas del demo de 21 skins. El repositorio original queda intacto. La demo usa el mismo Worker de créditos virtuales y la página se construye con GitHub Actions.

**Importante:** es una prueba técnica sin usuarios registrados ni dinero real. El backend de preview recibe la configuración de la skin desde el cliente; no es una arquitectura de producción.
