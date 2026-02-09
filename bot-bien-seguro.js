// bot-inmobiliaria-final.js
// Bot completo con mejoras: Manual obligatorio, memoria, español strict

const { default: makeWASocket, DisconnectReason, useMultiFileAuthState } = require('@whiskeysockets/baileys');
const qrcode = require('qrcode-terminal');
const pino = require('pino');
const { Ollama } = require('ollama');
const sqlite3 = require('sqlite3').verbose();
const { google } = require('googleapis');
const fs = require('fs');

// ============= CONFIGURACIÓN =============
const HORARIO_OFICINA = {
  inicio: 9,
  fin: 20,
  diasLaborables: [1, 2, 3, 4, 5, 6]
};

const ollama = new Ollama({ host: 'http://localhost:11434' });
const db = new sqlite3.Database('./inmobiliaria.db');
const conversaciones = new Map();
const historialesChat = new Map();
let manualGestion = '';

// ============= GOOGLE CALENDAR =============
const SCOPES = ['https://www.googleapis.com/auth/calendar'];
const TOKEN_PATH = 'token.json';
const CREDENTIALS_PATH = 'credentials.json';

async function getGoogleAuth() {
  if (!fs.existsSync(CREDENTIALS_PATH)) {
    return null;
  }

  const credentials = JSON.parse(fs.readFileSync(CREDENTIALS_PATH));
  const { client_secret, client_id, redirect_uris } = credentials.installed;
  const oAuth2Client = new google.auth.OAuth2(client_id, client_secret, redirect_uris[0]);

  if (fs.existsSync(TOKEN_PATH)) {
    const token = fs.readFileSync(TOKEN_PATH);
    oAuth2Client.setCredentials(JSON.parse(token));
    return oAuth2Client;
  }
  
  return null;
}

async function agendarEnCalendar(auth, propiedad, cliente, fecha) {
  if (!auth) return null;
  
  try {
    const calendar = google.calendar({ version: 'v3', auth });
    const ref = propiedad.referencia;
    
    let ubicacion = '';
    if (propiedad.ciudad) ubicacion += propiedad.ciudad;
    if (propiedad.zona) ubicacion += (ubicacion ? ', ' : '') + propiedad.zona;
    if (propiedad.departamento) ubicacion += (ubicacion ? ', ' : '') + propiedad.departamento;
    
    let precio = '';
    if (propiedad.en_venta == 1 && propiedad.precio_venta) {
      precio = `${propiedad.moneda_venta || '$'} ${propiedad.precio_venta.toLocaleString()}`;
    } else if (propiedad.en_alquiler == 1 && propiedad.precio_aqluiler) {
      precio = `${propiedad.moneda_alquiler || '$'} ${propiedad.precio_aqluiler.toLocaleString()}/mes`;
    }
    
    const event = {
      summary: `Visita: ${ref} - ${cliente.nombre}`,
      description: `Cliente: ${cliente.nombre}\nTeléfono: ${cliente.telefono}\nPropiedad: ${ref}\nUbicación: ${ubicacion}\nPrecio: ${precio}`,
      location: ubicacion,
      start: {
        dateTime: fecha.toISOString(),
        timeZone: 'America/Montevideo',
      },
      end: {
        dateTime: new Date(fecha.getTime() + 60 * 60000).toISOString(),
        timeZone: 'America/Montevideo',
      },
    };

    const res = await calendar.events.insert({
      calendarId: 'primary',
      resource: event,
    });
    return res.data;
  } catch (error) {
    console.error('Error Calendar:', error.message);
    return null;
  }
}

// ============= MANUAL DE GESTIÓN =============

async function cargarManual(rutaArchivo) {
  try {
    if (rutaArchivo.endsWith('.txt')) {
      manualGestion = fs.readFileSync(rutaArchivo, 'utf8');
    } else if (rutaArchivo.endsWith('.pdf')) {
      const pdf = require('pdf-parse');
      const dataBuffer = fs.readFileSync(rutaArchivo);
      const data = await pdf(dataBuffer);
      manualGestion = data.text;
    }
    
    console.log(`✅ Manual: ${manualGestion.length} caracteres`);
    
    // Verificar contenido
    const palabrasClave = ['documento', 'procedimiento', 'comisión', 'requisito'];
    const tieneContenido = palabrasClave.some(palabra => 
      manualGestion.toLowerCase().includes(palabra)
    );
    
    if (tieneContenido) {
      console.log('✅ Manual tiene contenido válido');
    } else {
      console.log('⚠️  Manual parece vacío o sin contenido relevante');
    }
    
  } catch (error) {
    console.error('⚠️  Error manual:', error.message);
  }
}

async function buscarEnManual(pregunta) {
  if (!manualGestion) return '';
  
  const preguntaLower = pregunta.toLowerCase();
  const secciones = manualGestion.split(/\n\n+/);
  
  const palabrasClave = [
    'documento', 'documentos', 'documentación',
    'procedimiento', 'proceso',
    'requisito', 'requisitos', 'necesito', 'necesita',
    'comisión', 'comisiones', 'honorario',
    'política', 'políticas', 'norma',
    'contrato', 'contratos',
    'reserva', 'reservar',
    'alquiler', 'alquilar', 'arrendar',
    'venta', 'vender', 'compra', 'comprar',
    'cancelación', 'cancelar',
    'visita', 'visitas',
    'pago', 'pagos', 'forma de pago',
    'garantía', 'garantías', 'fianza',
    'seña', 'depósito'
  ];
  
  const relevantes = secciones.filter(seccion => {
    const seccionLower = seccion.toLowerCase();
    return palabrasClave.some(palabra => 
      preguntaLower.includes(palabra) && seccionLower.includes(palabra)
    );
  });
  
  if (relevantes.length > 0) {
    return relevantes.slice(0, 3).join('\n\n');
  }
  
  const palabras = preguntaLower.split(/\s+/).filter(p => p.length > 3);
  const coincidencias = secciones.filter(seccion => {
    const seccionLower = seccion.toLowerCase();
    return palabras.some(palabra => seccionLower.includes(palabra));
  });
  
  return coincidencias.slice(0, 2).join('\n\n');
}

// ============= BASE DE DATOS =============

function buscarPorTexto(texto) {
  return new Promise((resolve, reject) => {
    const query = `
      SELECT * FROM propiedades 
      WHERE estado = "disponible"
      AND (
        descripcion LIKE ? OR
        ciudad LIKE ? OR
        zona LIKE ? OR
        departamento LIKE ? OR
        notas LIKE ?
      )
      LIMIT 10
    `;
    
    const searchTerm = `%${texto}%`;
    const params = [searchTerm, searchTerm, searchTerm, searchTerm, searchTerm];

    db.all(query, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows || []);
    });
  });
}

function obtenerPropiedad(referencia) {
  return new Promise((resolve, reject) => {
    db.get(
      'SELECT * FROM propiedades WHERE referencia = ?',
      [referencia],
      (err, row) => {
        if (err) reject(err);
        else resolve(row);
      }
    );
  });
}

function guardarVisita(propiedadRef, nombre, telefono, fecha, notas) {
  return new Promise((resolve, reject) => {
    db.get(
      'SELECT rowid FROM propiedades WHERE referencia = ?',
      [propiedadRef],
      (err, row) => {
        if (err || !row) {
          reject(err || new Error('Propiedad no encontrada'));
          return;
        }

        db.run(
          `INSERT INTO visitas (propiedad_id, cliente_nombre, cliente_telefono, fecha_visita, estado, notas)
           VALUES (?, ?, ?, ?, 'pendiente', ?)`,
          [row.rowid, nombre, telefono, fecha, notas],
          function(err) {
            if (err) reject(err);
            else resolve(this.lastID);
          }
        );
      }
    );
  });
}

// ============= INTELIGENCIA ARTIFICIAL =============

const INFO_NEGOCIO = `
INMOBILIARIA:
Horario: Lunes a Sábado 9:00-20:00
Servicios: Venta, Alquiler, Asesoramiento
`;

async function responderConIA(pregunta, contexto = {}) {
  try {
    let contextoAdicional = '';
    let usaManual = false;

    if (manualGestion) {
      const infoManual = await buscarEnManual(pregunta);
      if (infoManual && infoManual.length > 50) {
        contextoAdicional += '\n\n📚 INFORMACIÓN DEL MANUAL (USAR ESTA INFO OBLIGATORIAMENTE):\n' + infoManual;
        usaManual = true;
      }
    }

    if (contexto.propiedades && contexto.propiedades.length > 0) {
      contextoAdicional += '\n\n🏠 PROPIEDADES DISPONIBLES:\n';
      contexto.propiedades.forEach((p, i) => {
        let precio = '';
        if (p.en_venta == 1 && p.precio_venta) {
          precio = `${p.moneda_venta || '$'} ${p.precio_venta.toLocaleString()}`;
        } else if (p.en_alquiler == 1 && p.precio_aqluiler) {
          precio = `${p.moneda_alquiler || '$'} ${p.precio_aqluiler.toLocaleString()}/mes`;
        }
        
        contextoAdicional += `${i + 1}. REF: ${p.referencia} - ${p.ciudad || ''} - ${p.dormitorios || 0} dorm - ${precio || 'Consultar'}\n`;
      });
    }

    let historialTexto = '';
    if (contexto.historial && contexto.historial.length > 0) {
      historialTexto = '\n\nCONVERSACIÓN PREVIA (recordar contexto):\n';
      contexto.historial.slice(-6).forEach(h => {
        historialTexto += `${h.rol === 'user' ? 'Cliente' : 'Tú'}: ${h.mensaje}\n`;
      });
    }

    const systemPrompt = `Eres un asistente de inmobiliaria profesional.

${INFO_NEGOCIO}

🔴 REGLAS OBLIGATORIAS:
1. SIEMPRE responde SOLO en ESPAÑOL RIOPLATENSE (nunca portugués, inglés u otro)
2. Si hay INFO DEL MANUAL arriba, DEBES usarla PRIMERO y de forma LITERAL
3. NO inventes datos si están en el manual - cita EXACTAMENTE
4. Si el manual no tiene la info, di "según lo habitual en Uruguay" y usa conocimiento general
5. Respuestas CORTAS (máximo 4 líneas para WhatsApp)
6. Usa emojis con moderación 🏠
7. RECUERDA toda la conversación previa
8. Para agendar: primero nombre, luego fecha/hora formato DD/MM/AAAA HH:MM

${usaManual ? '⚠️⚠️⚠️ HAY INFO DEL MANUAL - USARLA ES OBLIGATORIO ⚠️⚠️⚠️' : ''}
${historialTexto}
${contextoAdicional}`;

    const response = await ollama.chat({
      model: 'llama3.2',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: pregunta }
      ],
      stream: false,
    });

    return response.message.content;
  } catch (error) {
    console.error('Error IA:', error);
    return 'Disculpa, hubo un error. Escribe "menu" para ver opciones.';
  }
}

// ============= FORMATEAR PROPIEDAD =============

function formatearPropiedad(p, completo = false) {
  const ref = p.referencia || 'Sin ref';
  
  let operacion = '';
  if (p.en_venta == 1 && p.en_alquiler == 1) operacion = 'Venta/Alquiler';
  else if (p.en_venta == 1) operacion = 'Venta';
  else if (p.en_alquiler == 1) operacion = 'Alquiler';
  
  let precio = '';
  if (p.en_venta == 1 && p.precio_venta) {
    precio = `${p.moneda_venta || '$'} ${p.precio_venta.toLocaleString()}`;
  } else if (p.en_alquiler == 1 && p.precio_aqluiler) {
    precio = `${p.moneda_alquiler || '$'} ${p.precio_aqluiler.toLocaleString()}/mes`;
  } else {
    precio = 'Consultar';
  }
  
  const caracteristicas = [];
  if (p.piscina == 1) caracteristicas.push('Piscina');
  if (p.parrillero == 1) caracteristicas.push('Parrillero');
  if (p.calefaccion == 1) caracteristicas.push('Calefacción');
  if (p.amueblado == 1) caracteristicas.push('Amueblado');
  if (p.ascensor == 1) caracteristicas.push('Ascensor');
  if (p.seguridad == 1) caracteristicas.push('Seguridad');
  if (p.garages > 0) caracteristicas.push(`${p.garages} garage(s)`);
  
  let mensaje = `🏠 *${ref}*\n\n`;
  mensaje += `📋 ${operacion}\n`;
  mensaje += `💰 ${precio}\n`;
  
  let ubicacion = '';
  if (p.ciudad) ubicacion += p.ciudad;
  if (p.zona) ubicacion += (ubicacion ? ', ' : '') + p.zona;
  if (p.departamento) ubicacion += (ubicacion ? ', ' : '') + p.departamento;
  
  mensaje += `📍 ${ubicacion || 'Sin ubicación'}\n`;
  mensaje += `🛏️ ${p.dormitorios || 0} dorm | 🚿 ${p.banios || 0} baños | 📏 ${p.superficie || 0}m²\n`;
  
  if (p.superficie_terreno > 0) {
    mensaje += `🌳 Terreno: ${p.superficie_terreno}m²\n`;
  }
  
  if (completo && p.descripcion) {
    mensaje += `\n📝 ${p.descripcion.substring(0, 150)}${p.descripcion.length > 150 ? '...' : ''}\n`;
  }
  
  if (completo && caracteristicas.length > 0) {
    mensaje += `\n✨ ${caracteristicas.slice(0, 5).join(', ')}\n`;
  }
  
  if (p.gastos_comunes > 0) {
    mensaje += `💵 GC: ${p.moneda_gastos_comunes || '$'} ${p.gastos_comunes}\n`;
  }
  
  return mensaje;
}

// ============= BOT WHATSAPP =============

async function connectToWhatsApp() {
  const { state, saveCreds } = await useMultiFileAuthState('auth_baileys');
  
  const sock = makeWASocket({
    auth: state,
    printQRInTerminal: false,
    logger: pino({ level: 'silent' }),
    browser: ['Inmobiliaria Bot', 'Chrome', '1.0.0']
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;
    
    if (qr) {
      console.log('\n📱 ESCANEA QR:\n');
      qrcode.generate(qr, { small: true });
      console.log('\nWhatsApp > Dispositivos vinculados\n');
    }

    if (connection === 'close') {
      const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
      if (shouldReconnect) {
        setTimeout(() => connectToWhatsApp(), 3000);
      }
    } else if (connection === 'open') {
      console.log('\n✅ BOT CONECTADO\n');
      console.log('💬 Listo para recibir mensajes\n');
    }
  });

  sock.ev.on('messages.upsert', async (m) => {
    const msg = m.messages[0];
    
    if (!msg.message) return;
    if (msg.key.fromMe) return;
    if (msg.key.remoteJid.includes('@g.us')) return;
    
    const messageText = msg.message?.conversation || 
                       msg.message?.extendedTextMessage?.text || 
                       '';
    
    const numero = msg.key.remoteJid.split('@')[0];
    console.log(`📨 ${numero}: ${messageText}`);

    const ahora = new Date();
    const enHorario = HORARIO_OFICINA.diasLaborables.includes(ahora.getDay()) &&
                      ahora.getHours() >= HORARIO_OFICINA.inicio &&
                      ahora.getHours() < HORARIO_OFICINA.fin;

    let estado = conversaciones.get(numero) || { paso: 'inicio' };
    const mensaje = messageText.toLowerCase().trim();

    try {
      // MENU
      if (mensaje === 'menu' || mensaje === 'hola' || mensaje === 'inicio' || estado.paso === 'inicio') {
        const respuesta = `¡Hola! 👋\n\n` +
          (enHorario ? '✅ En horario\n\n' : '⏰ Fuera de horario\n\n') +
          '🏠 *MENÚ:*\n\n' +
          '1️⃣ Buscar propiedades\n' +
          '2️⃣ Ver detalles\n' +
          '3️⃣ Agendar visita\n' +
          '4️⃣ Contacto\n\n' +
          '💬 O pregunta directamente';
        
        await sock.sendMessage(msg.key.remoteJid, { text: respuesta });
        estado.paso = 'menu';
        conversaciones.set(numero, estado);
        
        historialesChat.delete(numero);
        return;
      }

      // BUSCAR
      if (mensaje === '1' || estado.paso === 'buscar') {
        if (estado.paso !== 'buscar') {
          await sock.sendMessage(msg.key.remoteJid, { 
            text: '🔍 ¿Qué buscas?\n\nEj: "Casa Montevideo"' 
          });
          estado.paso = 'buscar';
          conversaciones.set(numero, estado);
          return;
        }

        const propiedades = await buscarPorTexto(messageText);
        
        if (propiedades.length === 0) {
          await sock.sendMessage(msg.key.remoteJid, { 
            text: '😔 No encontré. Intenta otros términos' 
          });
          estado.paso = 'menu';
          conversaciones.set(numero, estado);
          return;
        }

        let respuesta = `✅ ${propiedades.length} propiedades:\n\n`;
        propiedades.forEach((p, i) => {
          let precio = '';
          if (p.en_venta == 1 && p.precio_venta) {
            precio = `${p.moneda_venta || '$'} ${p.precio_venta.toLocaleString()}`;
          } else if (p.en_alquiler == 1 && p.precio_aqluiler) {
            precio = `${p.moneda_alquiler || '$'} ${p.precio_aqluiler.toLocaleString()}/mes`;
          }
          respuesta += `${i + 1}️⃣ *${p.referencia}*\n`;
          respuesta += `${p.ciudad || ''} ${p.zona || ''}\n`;
          respuesta += `💰 ${precio || 'Consultar'} | 🛏️ ${p.dormitorios || 0} dorm\n\n`;
        });
        
        respuesta += '💬 Número o referencia';

        await sock.sendMessage(msg.key.remoteJid, { text: respuesta });
        estado.propiedadesEncontradas = propiedades;
        estado.paso = 'menu';
        conversaciones.set(numero, estado);
        return;
      }

      // DETALLE
      if (mensaje === '2' || mensaje.match(/^[0-9]+$/) || mensaje.match(/^[0-9\-]+$/)) {
        let propiedad;
        
        if (mensaje.match(/^[0-9]$/) && estado.propiedadesEncontradas) {
          const indice = parseInt(mensaje) - 1;
          propiedad = estado.propiedadesEncontradas[indice];
        } else if (mensaje !== '2') {
          propiedad = await obtenerPropiedad(messageText);
        } else {
          await sock.sendMessage(msg.key.remoteJid, { 
            text: 'Indica referencia (ej: 125355)' 
          });
          return;
        }

        if (!propiedad) {
          await sock.sendMessage(msg.key.remoteJid, { 
            text: '❌ No encontrada' 
          });
          return;
        }

        const detalles = formatearPropiedad(propiedad, true);
        await sock.sendMessage(msg.key.remoteJid, { text: detalles + '\n📞 "3" para visita' });
        
        estado.propiedadActual = propiedad;
        conversaciones.set(numero, estado);
        return;
      }

      // AGENDAR
      if (mensaje === '3' || estado.paso.includes('visita')) {
        if (estado.paso !== 'visita_nombre' && estado.paso !== 'visita_fecha') {
          if (!estado.propiedadActual) {
            await sock.sendMessage(msg.key.remoteJid, { 
              text: 'Primero selecciona propiedad (opción 1)' 
            });
            return;
          }

          estado.paso = 'visita_nombre';
          conversaciones.set(numero, estado);
          await sock.sendMessage(msg.key.remoteJid, { 
            text: '📅 ¿Tu nombre?' 
          });
          return;
        }

        if (estado.paso === 'visita_nombre') {
          estado.nombreCliente = messageText;
          estado.paso = 'visita_fecha';
          conversaciones.set(numero, estado);
          
          await sock.sendMessage(msg.key.remoteJid, { 
            text: `Gracias ${estado.nombreCliente}!\n\nFecha y hora:\nFormato: DD/MM/AAAA HH:MM\nEj: 05/02/2026 15:00` 
          });
          return;
        }

        if (estado.paso === 'visita_fecha') {
          try {
            const ref = estado.propiedadActual.referencia;
            
            await guardarVisita(ref, estado.nombreCliente, numero, messageText, '');
            
            const auth = await getGoogleAuth();
            if (auth) {
              const partes = messageText.split(' ');
              const fechaPartes = partes[0].split('/');
              const horaPartes = partes[1].split(':');
              
              const fechaVisita = new Date(
                fechaPartes[2],
                fechaPartes[1] - 1,
                fechaPartes[0],
                horaPartes[0],
                horaPartes[1]
              );
              
              await agendarEnCalendar(auth, estado.propiedadActual, {
                nombre: estado.nombreCliente,
                telefono: numero
              }, fechaVisita);
            }

            await sock.sendMessage(msg.key.remoteJid, { 
              text: `✅ *VISITA AGENDADA*\n\n🏠 ${ref}\n👤 ${estado.nombreCliente}\n📅 ${messageText}\n\nTe contactaremos! 🎉` 
            });

            conversaciones.delete(numero);
          } catch (error) {
            console.error('Error:', error);
            await sock.sendMessage(msg.key.remoteJid, { 
              text: '❌ Error. Llámanos.' 
            });
          }
          return;
        }
      }

      // CONTACTO
      if (mensaje === '4') {
        await sock.sendMessage(msg.key.remoteJid, { 
          text: '📞 *CONTACTO*\n\n⏰ Lun-Sáb: 9-20h\n📍 [Dirección]\n📧 [Email]' 
        });
        return;
      }

      // CHAT IA
      if (estado.paso === 'menu' || estado.paso === 'buscar') {
        await sock.sendMessage(msg.key.remoteJid, { 
          text: '⏳ Consultando...' 
        });
        
        let historial = historialesChat.get(numero) || [];
        
        const propiedades = await buscarPorTexto(messageText);
        const contexto = { 
          propiedades: propiedades.slice(0, 3),
          historial: historial 
        };

        const respuestaIA = await responderConIA(messageText, contexto);
        
        historial.push({ rol: 'user', mensaje: messageText });
        historial.push({ rol: 'assistant', mensaje: respuestaIA });
        
        if (historial.length > 10) {
          historial = historial.slice(-10);
        }
        
        historialesChat.set(numero, historial);
        
        await sock.sendMessage(msg.key.remoteJid, { text: respuestaIA });
        return;
      }

    } catch (error) {
      console.error('❌', error.message);
      await sock.sendMessage(msg.key.remoteJid, { text: '❌ Error. "menu"' });
      conversaciones.delete(numero);
    }
  });

  return sock;
}

// ============= INICIAR =============
console.log('🚀 Iniciando Bot Inmobiliaria...\n');

async function iniciar() {
  db.get('SELECT COUNT(*) as total FROM propiedades WHERE estado = "disponible"', async (err, row) => {
    if (err) {
      console.error('❌ BD:', err.message);
    } else {
      console.log(`✅ BD: ${row.total} propiedades disponibles`);
    }
    
    if (fs.existsSync('./manual-gestion.txt')) {
      await cargarManual('./manual-gestion.txt');
    } else if (fs.existsSync('./manual-gestion.pdf')) {
      await cargarManual('./manual-gestion.pdf');
    } else {
      console.log('⚠️  Manual no encontrado (crear manual-gestion.txt)');
    }
    
    try {
      await ollama.list();
      console.log('✅ Ollama conectado');
    } catch (error) {
      console.log('⚠️  Ollama no disponible');
    }
    
    if (fs.existsSync(CREDENTIALS_PATH)) {
      console.log('✅ Google Calendar configurado');
    } else {
      console.log('⚠️  Google Calendar no configurado');
    }
    
    console.log('');
    connectToWhatsApp();
  });
}

iniciar();