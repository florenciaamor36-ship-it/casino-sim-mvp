# Slot Lab conectado al backend de prueba

Esta es una copia aislada de `slot-lab-demo`, no cambia el repositorio original. Las 21 skins usan `/api/slot-spin`: el servidor genera la grilla 5×3, evalúa las 20 líneas y responde con el saldo. El cliente conserva los assets/animaciones y solo convierte los IDs del resultado a los símbolos de cada skin.

El saldo inicial y los movimientos son créditos ficticios por navegador. La config de skin enviada por el cliente es válida únicamente para esta demo; para producción debe residir y validarse en el backend. Los sonidos sintetizados se mantienen apagados en esta preview.
