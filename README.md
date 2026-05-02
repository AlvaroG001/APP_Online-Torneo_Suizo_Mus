# Mesa y Mus

Aplicación web para gestionar un torneo presencial de mus en formato suizo desde una mesa de control visual, con flujo móvil por QR para que los jugadores suban su selfie desde el móvil y aparezcan dentro del equipo.

## Qué incluye

- Configuración inicial del torneo desde la propia web:
  - número de parejas
  - vacas por partida
  - juegos por vaca
  - puntos objetivo por juego entre 30 y 40
- Creación automática de equipos `Equipo 1`, `Equipo 2`, etc.
- Edición de nombre de equipo y nombres de ambos jugadores.
- QR por equipo con acceso móvil a `/join/[teamId]`.
- Subida de selfie o foto desde móvil usando cámara o galería.
- Avatares circulares en la mesa de administración.
- Emparejamientos suizos automáticos por bloques de balance.
- Registro de resultados con:
  - vacas
  - juegos
  - puntos agregados
- Clasificación automática con ranking por:
  - victorias
  - Buchholz
  - vacas ganadas
  - juegos ganados
  - puntos acumulados
- Corte automático a top 4.
- Semifinales `1 vs 4` y `2 vs 3`.
- Final y cierre de torneo.

## Decisiones de producto implementadas

### Visualización del suizo

En vez de representar el torneo como un árbol clásico desde el principio, la interfaz usa tres capas:

- panel lateral con todas las parejas
- vista central por bloques de balance `1-0`, `2-1`, `0-2`, etc.
- fase final separada con semifinales y final

Esto funciona mejor para un suizo porque deja claro qué grupos siguen vivos en cada ronda.

### Lógica del suizo

- Número de rondas suizas: `max(3, ceil(log2(numero_de_equipos)))`
- Emparejamiento:
  - primera ronda aleatoria
  - siguientes rondas dentro del mismo balance
  - evitando rematches cuando es posible
- Clasificación/eliminación:
  - se calcula de forma provisional tras cada ronda
  - el suizo se cierra cuando el top 4 queda matemáticamente definido, cuando ya solo quedan 4 contendientes o cuando se consumen las rondas planificadas

### Persistencia

- Estado del torneo: `data/tournament.json`
- Fotos subidas: `data/uploads/`

## Desarrollo local

Arranca siempre el servidor de desarrollo para trabajar con refresco automático:

```bash
npm run dev
```

Abre [http://localhost:3000](http://localhost:3000). Este modo usa Fast Refresh de Next/Turbopack: al modificar componentes, estilos o rutas, el navegador actualiza la vista sin tumbar la app.

Si solo quieres exponerla en tu propia máquina, puedes usar:

```bash
npm run dev:local
```

`npm run start` queda reservado para revisar una build de producción y no tiene refresco automático.

## Cómo exponerla a móviles o internet

La app está pensada para ejecutarse en tu ordenador y publicarse hacia fuera con una de estas dos estrategias:

- acceso desde móviles en la misma red usando la IP local de tu ordenador
- un reverse proxy con HTTPS delante del puerto `3000`
- un túnel HTTPS hacia tu máquina

En ambos casos, introduce la URL pública en el campo `URL pública` dentro de la configuración inicial del torneo. Esa URL es la que se usará para generar QRs válidos desde móviles externos.

## Estructura principal

- `src/app/page.tsx`: mesa de administración
- `src/app/join/[teamId]/page.tsx`: flujo móvil para selfies
- `src/app/api/tournament/route.ts`: API principal de acciones del torneo
- `src/app/api/tournament/photo/route.ts`: subida de fotos
- `src/app/api/uploads/[...slug]/route.ts`: servido de imágenes persistidas
- `src/lib/tournament.ts`: tipos y motor del torneo
- `src/lib/store.ts`: persistencia en disco

## Comprobación realizada

Se ha verificado:

- `npm run lint`
- `npm run build`

## Siguientes mejoras naturales

- autenticación para la mesa de administración
- edición detallada de cada juego dentro de cada vaca
- exportación de clasificación y cuadro final
- temporizador o llamada de rondas en directo
