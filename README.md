# ChatBotBienSeguro 🤖🏠

Chatbot de WhatsApp para inmobiliaria con inteligencia artificial.

## Descripción

Bot de WhatsApp automatizado que utiliza IA (Ollama/Llama 3.2) para atender clientes, buscar propiedades, agendar visitas y gestionar información de una inmobiliaria en Uruguay.

## Características

- 💬 **Atención por WhatsApp** - Conexión mediante @whiskeysockets/baileys
- 🧠 **Inteligencia Artificial** - Respuestas inteligentes con Ollama (modelo llama3.2)
- 🏠 **Búsqueda de Propiedades** - Búsqueda por texto en base de datos SQLite
- 📅 **Agendamiento** - Integración con Google Calendar para programar visitas
- 📚 **Manual de Gestión** - Soporta PDF o TXT con procedimientos de la inmobiliaria
- ⏰ **Horario de Oficina** - Respuestas personalizadas según el horario (9:00-20:00)
- 💾 **Historial de Conversaciones** - Memoria persistente durante cada sesión

## Requisitos

- Node.js 18+
- Ollama instalado con modelo llama3.2
- Base de datos SQLite (inmobiliaria.db)
- Credenciales de Google Calendar (credentials.json)

## Instalación

```bash
npm install
```

## Configuración

1. **Variables de entorno**: Crear archivo `.env` con las configuraciones necesarias

2. **Base de datos**: Asegurarse de que exista `inmobiliaria.db` con la tabla `propiedades`

3. **Google Calendar**:
   - Colocar `credentials.json` en la raíz del proyecto
   - El token se generará automáticamente en `token.json`

4. **Manual de Gestión** (opcional):
   - Colocar `manual.txt` o `manual.pdf` en la raíz
   - El bot lo cargará automáticamente

## Uso

```bash
node bot-bien-seguro.js
```

El bot mostrará un código QR para escanear con WhatsApp y vincular el dispositivo.

## Funcionalidades del Menú

1️⃣ **Buscar propiedades** - Búsqueda por texto (ciudad, zona, características)

2️⃣ **Ver detalles** - Información completa de una propiedad por referencia

3️⃣ **Agendar visita** - Programar visita a propiedad en Google Calendar

4️⃣ **Contacto** - Información de contacto de la inmobiliaria

## Base de Datos

### Tabla `propiedades`
- referencia (PK)
- ciudad, zona, departamento
- en_venta, en_alquiler
- precio_venta, precio_alquiler
- moneda_venta, moneda_alquiler
- dormitorios, banios, superficie
- piscina, parrillero, calefaccion
- descripcion, notas

### Tabla `visitas`
- propiedad_id (FK)
- cliente_nombre, cliente_telefono
- fecha_visita, estado, notas

## Dependencias

```json
{
  "@whiskeysockets/baileys": "^6.0.0",
  "googleapis": "^171.4.0",
  "ollama": "^0.6.3",
  "pdf-parse": "^2.4.5",
  "qrcode-terminal": "^0.12.0",
  "sqlite3": "^5.1.7"
}
```

## Estructura del Proyecto

```
ChatBotBienSeguro/
├── bot-bien-seguro.js    # Main del bot
├── importar.js           # Script de importación (WIP)
├── inmobiliaria.db       # Base de datos SQLite
├── credentials.json      # Google API credentials
├── token.json           # Google OAuth token
├── manual.pdf/txt       # Manual de gestión
└── auth_baileys/        # Datos de sesión WhatsApp
```

## Desarrollo

- **Modelo IA**: Llama 3.2 (configurado en `responderConIA`)
- **Respuestas**: Español rioplatense
- **Horario**: Lunes a Sábado 9:00-20:00

## Licencia

ISC

---

Generado con ❤️ para Inmobiliaria Bien Seguro
