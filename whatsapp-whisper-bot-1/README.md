# WhatsApp Whisper Bot

Este proyecto es un bot de WhatsApp que integra la API de Whisper para procesar mensajes de audio. Permite a los usuarios enviar mensajes de voz a través de WhatsApp, que luego son transcritos y respondidos automáticamente.

## Estructura del Proyecto

```
whatsapp-whisper-bot
├── src
│   ├── app.js                  # Punto de entrada de la aplicación
│   ├── whisper.js              # Lógica para interactuar con la API de Whisper
│   ├── controllers
│   │   └── whatsappController.js # Manejo de interacciones con la API de WhatsApp
│   ├── services
│   │   └── audioService.js      # Lógica relacionada con el manejo de archivos de audio
│   └── utils
│       └── index.js            # Funciones utilitarias
├── package.json                 # Configuración de npm y dependencias
├── .env                         # Variables de entorno
└── README.md                    # Documentación del proyecto
```

## Requisitos

- Node.js
- npm

## Instalación

1. Clona el repositorio:
   ```
   git clone <URL_DEL_REPOSITORIO>
   ```
2. Navega al directorio del proyecto:
   ```
   cd whatsapp-whisper-bot
   ```
3. Instala las dependencias:
   ```
   npm install
   ```

## Configuración

Crea un archivo `.env` en la raíz del proyecto y agrega las siguientes variables de entorno:

```
WHATSAPP_API_URL=<URL_DE_LA_API_DE_WHATSAPP>
WHATSAPP_TOKEN=<TOKEN_DE_WHATSAPP>
WHISPER_API_URL=<URL_DE_LA_API_DE_WHISPER>
WHISPER_API_KEY=<CLAVE_DE_API_DE_WHISPER>
```

## Ejecución

Para iniciar la aplicación, ejecuta el siguiente comando:

```
npm start
```

## Uso

Una vez que la aplicación esté en funcionamiento, puedes enviar mensajes de voz a través de WhatsApp. El bot procesará el audio y responderá con la transcripción del mensaje.

## Contribuciones

Las contribuciones son bienvenidas. Si deseas contribuir, por favor abre un issue o envía un pull request.

## Licencia

Este proyecto está bajo la Licencia MIT.