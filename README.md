# xDelete

Extensión de Chrome para borrar todos los posts y reposts de tu propia cuenta de X.

X no tiene borrado masivo. Las herramientas que existen cobran por volumen y te piden
acceso a tu cuenta. Esto corre en tu navegador, con tu sesión, sin intermediarios.

Probado vaciando una cuenta de 2010 con 5.587 posts.

## Instalar

1. Descargá o cloná este repo
2. Entrá a `chrome://extensions`
3. Activá **Modo de desarrollador** (arriba a la derecha)
4. **Cargar descomprimida** → elegí la carpeta del repo

## Usar

1. Abrí tu perfil: `https://x.com/tu_usuario`
2. Click en el ícono de la extensión
3. Escribí tu usuario sin `@` y dale **Empezar a borrar**

Dejá esa pestaña abierta y en primer plano. Chrome congela el scroll en pestañas
de fondo y la recolección se frena.

El popup muestra posts borrados, reposts, fallos, recargas, fecha más vieja
alcanzada y el crédito restante de la ventana.

Para cortar: **Detener**. El progreso queda guardado y al volver a empezar retoma
sin repetir lo ya borrado.

## Cómo funciona

Cada vuelta hace esto:

```
recolecta lo visible → borra esa tanda → recarga la página → repite
```

La recarga es la parte importante. X sirve el timeline del perfil desde una caché
interna de su SPA: cuando se agota, cambiar de pestaña con un click no lo revive,
sólo una recarga completa. Y una recarga mata cualquier script pegado en la consola
del navegador — por eso esto es una extensión y no un snippet. El content script se
re-inyecta solo en cada carga y sigue donde quedó.

Rota entre las tres pestañas del perfil (Posts, Respuestas, Reposts) porque cada una
expone material distinto. Termina cuando nueve pasadas seguidas no encuentran nada.

### Endpoints

- **`DeleteTweet`** para posts propios
- **`DeleteRetweet`** para reposts, sobre el id del tuit original

Sus `queryId` cambian con cada deploy de X, así que la extensión los busca en los
bundles que la página ya cargó y sólo usa un valor de respaldo si no los encuentra.

## Límites del servidor

X limita `DeleteTweet` a **200 borrados cada 15 minutos** y lo informa en los headers
de cada respuesta:

```
x-rate-limit-limit:     200
x-rate-limit-remaining: baja 1 por borrado
x-rate-limit-reset:     epoch del reinicio
```

La extensión lee ese presupuesto en vez de adivinarlo: borra a fondo mientras queda
crédito y duerme hasta el reset exacto que informa el servidor.

Ese tope es del servidor y es por cuenta. Medido: con concurrencia 8 se borra a 65 ms
por tuit, pero el presupuesto se agota en 13 segundos y después hay que esperar los 15
minutos igual. **No hay forma de ir más rápido desde el cliente.**

`DeleteRetweet` no devuelve headers de rate limit y parece regirse por otro presupuesto.

## Cosas que conviene saber

**Es irreversible y no guarda respaldo.** Borra y registra el id, nada más. Si querés
conservar el contenido, pedí el archivo de datos a X antes de empezar
(`Configuración → Descargar un archivo con tus datos`) y esperá a tenerlo.

**El timeline tiene un techo.** El perfil no expone todo el historial de una sola vez.
Borrar destapa material más viejo, y por eso el ciclo con recargas avanza — pero puede
frenarse antes de vaciar la cuenta entera. El archivo de datos es la única fuente que
trae todos los ids.

**El contador de posts miente un rato.** Se actualiza con retraso y puede incluso subir
entre dos lecturas. El perfil vacío es mejor señal que el número.

**Borrar desde la interfaz de X no siempre borra.** Si superaste el límite, X saca el
post de pantalla y te redirige igual, pero el servidor devolvió 429 y el post sigue
publicado. Es actualización optimista sin verificar la respuesta. Otra razón para
usar algo que mire el status real.

## Sobre el token

`content.js` incluye un bearer token en texto plano. **No es una credencial personal**:
es el token público del cliente web de X, el mismo que viaja en todos sus bundles
JavaScript y que usa cualquiera que abra x.com. La autenticación real la da la cookie
de sesión, que se lee del navegador en cada pedido y nunca sale de él.

La extensión no manda datos a ningún lado. No hay servidor, no hay analítica, no hay
telemetría.

## Permisos

| Permiso | Para qué |
|---|---|
| `storage` | guardar el progreso y poder reanudar |
| `notifications` | avisar si el proceso se traba |
| `https://x.com/*` | leer el perfil y mandar los pedidos de borrado |
| `https://abs.twimg.com/*` | leer los bundles para descubrir los `queryId` |

## Licencia

MIT
