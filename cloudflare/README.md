# Preview en Cloudflare Workers

El Worker sirve la demo técnica desde KV y expone dos APIs de simulación: `/api/spin` para el panel simple y `/api/slot-spin` para el motor común SlotEngine. El cliente de Slot Lab manda la configuración de su skin; el Worker calcula el giro y el saldo, y devuelve la grilla 5×3 y las líneas ganadoras.

El namespace KV es exclusivo de esta preview y guarda créditos ficticios por sesión. KV no ofrece transacciones atómicas; la configuración de skins que llega desde el cliente es solo aceptable en esta demo. **No usar para dinero real ni como billetera de producción.** La versión local con SQLite sigue siendo un prototipo independiente.

El origen permitido para la app pública es `https://florenciaamor36-ship-it.github.io`. El token de Cloudflare no está en el repo.
