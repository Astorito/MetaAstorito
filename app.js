// Importar dependencias
const express = require('express');
const axios = require('axios');
const mongoose = require('mongoose');
const { DateTime } = require('luxon');
require('dotenv').config();

const app = express();
app.use(express.json());

// Variables de entorno
const port = process.env.PORT || 3000;
const verifyToken = process.env.VERIFY_TOKEN;
const whatsappToken = process.env.WHATSAPP_TOKEN;
const phoneNumberId = process.env.PHONE_NUMBER_ID;
const openaiToken = process.env.OPENAI_API_KEY;
const model = process.env.OPENAI_MODEL || "gpt-3.5-turbo";
const mongoUri = process.env.MONGODB_URI;

// --- Esquema y modelo MongoDB para recordatorios ---
const reminderSchema = new mongoose.Schema({
  phone: String,
  title: String,
  emoji: String,
  date: Date,
  notifyAt: Date,
  sent: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now }
});
const Reminder = mongoose.model('Reminder', reminderSchema);

// --- Conectar a MongoDB ---
mongoose.connect(mongoUri, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(() => console.log("✅ Conectado a MongoDB"))
  .catch(err => {
    console.error("❌ Error conectando a MongoDB:", err);
    process.exit(1);
  });

// --- Función para enviar mensaje WhatsApp ---
async function sendWhatsAppMessage(to, message) {
  try {
    await axios.post(
      `https://graph.facebook.com/v21.0/${phoneNumberId}/messages`,
      {
        messaging_product: "whatsapp",
        to,
        text: { body: message }
      },
      {
        headers: {
          Authorization: `Bearer ${whatsappToken}`,
          "Content-Type": "application/json"
        }
      }
    );
  } catch (err) {
    console.error("Error enviando mensaje WhatsApp:", err.response?.data || err.message);
  }
}

// --- Función para parsear recordatorio con OpenAI ---
async function parseReminderWithOpenAI(text) {
  const now = new Date();
  const today = now.toISOString().split('T')[0];
  
  const systemPrompt = `Eres un asistente que extrae información de recordatorios en español.
CONTEXTO IMPORTANTE:
- HOY ES: ${today}
- HORA ACTUAL: ${now.getHours()}:${now.getMinutes()}
- Si dice "mañana", la fecha debe ser ${formatDateLocal(new Date(now.getTime() + 86400000))}

REGLAS:
1. Si menciona una hora específica (ej: "a las 10"), usa esa hora exacta
2. Si dice "mañana", usa la fecha de mañana (no más)
3. Si dice "en X minutos", el aviso debe ser hora_actual + X minutos
4. Nunca modifiques la hora que el usuario especifica

Formato JSON requerido:
{
  "title": "título del evento",
  "emoji": "emoji relacionado o 📝",
  "date": "YYYY-MM-DD",
  "time": "HH:MM",
  "notify": "instrucción de aviso exacta del usuario"
}

Analizar este mensaje: "${text}"`;

  try {
    const response = await axios.post('https://api.openai.com/v1/chat/completions', {
      model: model,
      messages: [{ role: "system", content: systemPrompt }],
      temperature: 0.3
    }, {
      headers: {
        'Authorization': `Bearer ${openaiToken}`,
        'Content-Type': 'application/json'
      }
    });

    let parsed = JSON.parse(response.data.choices[0].message.content);
    
    // Validar que la fecha no sea anterior a hoy
    const today = new Date();
    today.setHours(0,0,0,0);
    const parsedDate = new Date(parsed.date);
    parsedDate.setHours(0,0,0,0);
    
    if (parsedDate < today) {
      // Si la fecha es anterior a hoy, usar mañana
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      parsed.date = tomorrow.toISOString().split('T')[0];
    }

    return { type: "reminder", data: parsed };
  } catch (err) {
    console.error("Error parseando con OpenAI:", err);
    return { type: "error", message: "No pude entender el recordatorio" };
  }
}

// --- Programar recordatorio para enviar aviso ---
function scheduleReminder(reminder) {
  const now = new Date();
  const delay = reminder.notifyAt.getTime() - now.getTime();

  if (delay <= 0) {
    console.log("Recordatorio vencido, no se programa:", reminder);
    return;
  }

  setTimeout(async () => {
    const message = `Hola! Acordate que hoy tenes ${reminder.title} ${reminder.emoji}`;
    await sendWhatsAppMessage(reminder.phone, message);

    reminder.sent = true;
    await reminder.save();
  }, delay);

  console.log(`Recordatorio programado para ${reminder.notifyAt.toLocaleString()} (en ${delay} ms)`);
}

// --- Cargar y programar recordatorios pendientes al iniciar ---
async function initScheduledReminders() {
  const now = new Date();
  const pending = await Reminder.find({ sent: false, notifyAt: { $gt: now } });
  pending.forEach(r => scheduleReminder(r));
}
initScheduledReminders();

// --- Diccionario simple para emojis por palabra clave ---
const emojiMap = {
  peluqueria: "✂️",
  corte: "✂️",
  doctor: "🩺",
  medico: "🩺",
  odontologo: "🦷",
  cumpleaños: "🎂",
  cumple: "🎉",
  reunion: "📅",
  gimnasio: "🏋️‍♂️",
  clase: "📚",
  cita: "📌",
  default: "📝",
};

// --- Estado temporal para recordatorios pendientes de confirmación de aviso ---
const pendingReminders = new Map(); // key = phone, value = partial reminder data

// --- Función para parsear fechas relativas simples ---
function parseRelativeDate(input) {
  const now = new Date();
  
  if (typeof input !== 'string') return null;
  input = input.toLowerCase().trim();

  if (input === "mañana") {
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    return formatDateLocal(tomorrow);
  }

  // En 2 días, en 3 dias, en 1 semana, etc
  let match = input.match(/en (\d+) (día|dias|días|semana|semanas)/);
  if (match) {
    const num = parseInt(match[1]);
    const unit = match[2];
    const date = new Date(now);
    if (unit.startsWith('semana')) {
      date.setDate(date.getDate() + (num * 7));
    } else {
      date.setDate(date.getDate() + num);
    }
    return formatDateLocal(date);
  }

  // Si viene en formato YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(input)) {
    const inputDate = new Date(input);
    if (!isNaN(inputDate.getTime())) {
      return input;
    }
  }

  // No pudo interpretar
  return null;
}

// --- Función auxiliar para formatear fecha y hora tipo "11/08/2025 a las 09:00 AM"
function formatDateTime(date) {
  return DateTime.fromJSDate(date).setZone('America/Argentina/Buenos_Aires')
    .toFormat("dd/MM/yyyy 'a las' HH:mm");
}

// --- Formatear fecha local YYYY-MM-DD para comparar ---
function formatDateLocal(date) {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

// --- Crear Date local con fecha + hora (HH:MM) ---
function createLocalDate(fechaStr, horaStr) {
  // fechaStr: YYYY-MM-DD, horaStr: HH:MM (24h)
  return new Date(`${fechaStr}T${horaStr}:00`);
}

// Agrega arriba, junto a otros requires
const chrono = require('chrono-node');
const fs = require('fs');
const FormData = require('form-data');

// --- Manejo del webhook POST ---
app.post("/", async (req, res) => {
  console.log(`\n\nWebhook recibido: ${new Date().toISOString()}\n`);
  console.log(JSON.stringify(req.body, null, 2));

  try {
    const entry = req.body.entry?.[0];
    const changes = entry?.changes?.[0];
    const message = changes?.value?.messages?.[0];
    const from = message?.from;
    const messageText = message?.text?.body;

    if (!message || !from || !messageText) {
      console.log("No hay mensaje válido");
      return res.sendStatus(200);
    }

    console.log(`Mensaje de ${from}: ${messageText}`);

    // Chequear si hay recordatorio pendiente sin notify para este usuario
    if (pendingReminders.has(from)) {
      const partial = pendingReminders.get(from);

      // Este mensaje debería ser la respuesta para notify
      const notifyText = messageText.toLowerCase();

      // Guardar notify en el partial
      partial.notify = notifyText;

      // Construir fecha real usando parseRelativeDate (tu función que retorna fecha YYYY-MM-DD)
      const fechaReal = parseRelativeDate(partial.date);
      if (!fechaReal) {
        await sendWhatsAppMessage(from, "No pude entender la fecha. Por favor escribila en formato YYYY-MM-DD o como 'mañana', 'en 2 días', etc.");
        return res.sendStatus(200);
      }

      // Fecha completa con hora (o default 09:00)
      const hora = partial.time || "09:00";
      const eventDate = createLocalDate(fechaReal, hora);

      if (isNaN(eventDate.getTime())) {
        await sendWhatsAppMessage(from, "La fecha u hora no es válida. Por favor intenta de nuevo.");
        return res.sendStatus(200);
      }

      // Calcular notifyAt usando chrono para interpretar notifyText
      let notifyAt = null;
      // Intentamos parsear offset tipo "en 5 minutos", "en 1 hora"
      const matchMinutos = notifyText.match(/en (\d+)\s*min/);
      const matchHoras = notifyText.match(/en (\d+)\s*hora/);

      if (matchMinutos) {
        notifyAt = new Date(Date.now() + parseInt(matchMinutos[1]) * 60000);
      } else if (matchHoras) {
        notifyAt = new Date(Date.now() + parseInt(matchHoras[1]) * 3600000);
      } else if (notifyText.includes("antes")) {
        // Si dice "1 hora antes", "2 horas antes"
        const horasAntes = parseInt(notifyText.split(" ")[0]);
        if (!isNaN(horasAntes)) {
          notifyAt = new Date(eventDate.getTime() - horasAntes * 3600000);
        }
      } else {
        // Intentamos parsear fecha y hora absoluta con chrono
        const parsedNotify = chrono.es.parseDate(notifyText);
        if (parsedNotify) notifyAt = parsedNotify;
      }

      // Si no pudimos calcular notifyAt o es en el pasado, lo ponemos 1 minuto en el futuro
      if (!notifyAt || notifyAt < new Date()) {
        notifyAt = new Date(Date.now() + 60 * 1000);
      }

      // Elegir emoji por palabra clave en title si no viene o está default
      let emoji = partial.emoji || "📝";
      const lowerTitle = partial.title.toLowerCase();
      const foundEmoji = Object.entries(emojiMap).find(([key]) => lowerTitle.includes(key))?.[1];
      if (foundEmoji) emoji = foundEmoji;

      const newReminder = new Reminder({
        phone: from,
        title: partial.title,
        emoji,
        date: eventDate,
        notifyAt,
        sent: false
      });

      await newReminder.save();
      scheduleReminder(newReminder);
      pendingReminders.delete(from);

      await sendWhatsAppMessage(from,
        `Genial! Ya agendamos tu evento 🚀\n\n` +
        `${emoji} *${partial.title}*\n` +
        `🗓️ Fecha: ${formatDateTime(eventDate)}\n` +
        `⌛ Aviso: ${formatDateTime(notifyAt)}\n\n` +
        `Avisanos si necesitás que agendemos otro evento!`
      );

      return res.sendStatus(200);
    }

    // No hay recordatorio pendiente, parseamos normalmente usando OpenAI
    const parsed = await parseReminderWithOpenAI(messageText);

    if (parsed.type === "reminder") {
      // Extraer hora específica del mensaje original - MEJORADO
      let hora = parsed.data.time || "09:00"; // default
      
      // Buscar patrones más específicos primero
      const horaPatterns = [
        /a las (\d{1,2})(?::(\d{2}))?\s*(?:de la)?\s*(mañana|tarde|noche)?/i,
        /(\d{1,2})(?::(\d{2}))?\s*(?:de la)?\s*(mañana|tarde|noche)/i,
        /(\d{1,2})(?::(\d{2}))?\s*(am|pm)/i
      ];

      for (const pattern of horaPatterns) {
        const match = messageText.match(pattern);
        if (match) {
          let h = parseInt(match[1]);
          const m = match[2] ? match[2].padStart(2, '0') : "00";
          const period = match[3]?.toLowerCase();
          
          // Ajustar AM/PM
          if (period === "tarde" && h < 12) h += 12;
          if (period === "noche" && h < 12) h += 12;
          if (period === "mañana" && h === 12) h = 0;
          if (period === "pm" && h < 12) h += 12;
          if (period === "am" && h === 12) h = 0;
          
          hora = `${h.toString().padStart(2, '0')}:${m}`;
          break;
        }
      }

      console.log(`Hora extraída del mensaje: ${hora}`); // Debug

      // Parsear fecha relativa
      const fechaReal = parseRelativeDate(messageText.includes("mañana") ? "mañana" : parsed.data.date);
      if (!fechaReal) {
        await sendWhatsAppMessage(from, "No pude entender la fecha correctamente.");
        return res.sendStatus(200);
      }

      const eventDate = createLocalDate(fechaReal, hora);
      
      // Calcular tiempo de aviso
      let notifyAt = new Date();
      const minutosMatch = messageText.match(/en (\d+)\s*minutos?/);
      const horasMatch = messageText.match(/en (\d+)\s*horas?/);
      
      if (minutosMatch) {
        notifyAt = new Date(Date.now() + parseInt(minutosMatch[1]) * 60000);
      } else if (horasMatch) {
        notifyAt = new Date(Date.now() + parseInt(horasMatch[1]) * 3600000);
      } else if (parsed.data.notify.includes("antes")) {
        const horasAntes = parseInt(parsed.data.notify.split(" ")[0]);
        if (!isNaN(horasAntes)) {
          notifyAt = new Date(eventDate.getTime() - horasAntes * 3600000);
        }
      } else {
        // Intentamos parsear fecha y hora absoluta con chrono
        const parsedNotify = chrono.es.parseDate(parsed.data.notify);
        if (parsedNotify) notifyAt = parsedNotify;
      }

      if (!notifyAt || notifyAt < new Date()) {
        notifyAt = new Date(Date.now() + 60 * 1000);
      }

      // Elegir emoji por palabra clave en title si no viene o está default
      let emoji = parsed.data.emoji || "📝";
      const lowerTitle = parsed.data.title.toLowerCase();
      const foundEmoji = Object.entries(emojiMap).find(([key]) => lowerTitle.includes(key))?.[1];
      if (foundEmoji) emoji = foundEmoji;

      const newReminder = new Reminder({
        phone: from,
        title: parsed.data.title,
        emoji,
        date: eventDate,
        notifyAt,
        sent: false
      });

      await newReminder.save();
      scheduleReminder(newReminder);

      await sendWhatsAppMessage(from,
        `Genial! Ya agendamos tu evento 🚀\n\n` +
        `${emoji} *${parsed.data.title}*\n` +
        `🗓️ Fecha: ${formatDateTime(eventDate)}\n` +
        `⌛ Aviso: ${formatDateTime(notifyAt)}\n\n` +
        `Avisanos si necesitás que agendemos otro evento!`
      );

    } else {
      // Respuesta normal GPT u otro texto
      await sendWhatsAppMessage(from, parsed.content);
    }
  } catch (err) {
    console.error("Error:", err?.response?.data || err.message);
  }

  res.sendStatus(200);
});

// --- Verificación webhook ---
app.get('/', (req, res) => {
  const { 'hub.mode': mode, 'hub.challenge': challenge, 'hub.verify_token': token } = req.query;
  if (mode === 'subscribe' && token === verifyToken) {
    console.log('WEBHOOK VERIFIED');
    res.status(200).send(challenge);
  } else {
    res.status(403).end();
  }
});

// --- Iniciar servidor ---
app.listen(port, () => {
  console.log(`Servidor escuchando en puerto ${port}`);
});