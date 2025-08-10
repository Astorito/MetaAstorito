// Importar dependencias
const express = require('express');
const axios = require('axios');
const mongoose = require('mongoose');
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

// --- Función para formato YYYY-MM-DD local ---
function formatDateLocal(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// --- Función para normalizar texto (quita tildes y pone minúscula) ---
function normalizeText(text) {
  return text.toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

// --- Función para crear Date local a partir de fecha y hora ---
function createLocalDate(fechaReal, hora) {
  const [year, month, day] = fechaReal.split('-').map(Number);
  const [hour, minute] = (hora || "09:00").split(':').map(Number);
  return new Date(year, month - 1, day, hour, minute, 0);
}

// --- Función para obtener emoji a partir del título ---
function getEmojiFromTitle(title, defaultEmoji = "📝") {
  const normalizedTitle = normalizeText(title);
  const found = Object.entries(emojiMap).find(([key]) => normalizedTitle.includes(key));
  return found ? found[1] : defaultEmoji;
}

// --- Función para parsear recordatorio con OpenAI ---
async function parseReminderWithOpenAI(text) {
  const systemPrompt = `Eres un asistente que extrae información de recordatorios en español.
Devuelve SOLO un JSON con: "title", "emoji", "date" (YYYY-MM-DD), "time" (HH:MM), "notify" (instrucciones para aviso).
Si falta hora usa "09:00".
Si falta emoji usa "📝".
Ejemplo:
{"title":"Ir al médico","emoji":"🩺","date":"2025-08-15","time":"14:30","notify":"1 antes"}
Devuelve solo JSON puro.
Mensaje a analizar: "${text}"`;

  try {
    const response = await axios.post(
      "https://api.openai.com/v1/chat/completions",
      {
        model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: text }
        ],
        temperature: 0
      },
      {
        headers: {
          Authorization: `Bearer ${openaiToken}`,
          "Content-Type": "application/json"
        }
      }
    );

    let content = response.data.choices[0].message.content.trim();

    if (content.startsWith("```")) {
      content = content.replace(/```json?/, '').replace(/```$/, '').trim();
    }

    const reminderData = JSON.parse(content);

    reminderData.emoji = reminderData.emoji || "📝";
    reminderData.time = reminderData.time || "09:00";

    return { type: "reminder", data: reminderData };

  } catch (err) {
    console.error("Error parseando recordatorio con OpenAI:", err.response?.data || err.message);
    return { type: "message", content: "No pude entender tu recordatorio." };
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
  input = input.toLowerCase().trim();
  const now = new Date();

  if (input === "hoy") return formatDateLocal(now);
  if (input === "mañana") {
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    return formatDateLocal(tomorrow);
  }
  // En 2 días, en 3 dias, en 1 semana, etc
  let match = input.match(/en (\d+) (día|dias|días|semana|semanas)/);
  if (match) {
    const val = parseInt(match[1]);
    if (isNaN(val)) return null;
    const date = new Date(now);
    if (match[2].startsWith("dia")) {
      date.setDate(date.getDate() + val);
    } else if (match[2].startsWith("semana")) {
      date.setDate(date.getDate() + val * 7);
    }
    return formatDateLocal(date);
  }
  // Si viene en formato YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(input)) return input;

  // No pudo interpretar
  return null;
}

// --- Función auxiliar para formatear fecha y hora tipo "11/08/2025 a las 09:00 AM"
function formatDateTime(date) {
  return `${date.toLocaleDateString('es-AR')} a las ${date.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: true })}`;
}

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

      // Construir fecha real
      const fechaReal = parseRelativeDate(partial.date);
      if (!fechaReal) {
        await sendWhatsAppMessage(from, "No pude entender la fecha. Por favor escribila en formato YYYY-MM-DD o como 'mañana', 'en 2 días', etc.");
        return res.sendStatus(200);
      }

      // Hora o default 09:00
      const hora = partial.time || "09:00";
      const eventDate = createLocalDate(fechaReal, hora);
      if (isNaN(eventDate.getTime())) {
        await sendWhatsAppMessage(from, "La fecha u hora no es válida. Por favor intenta de nuevo.");
        return res.sendStatus(200);
      }

      // Calcular notifyAt según notify
      let notifyAt = eventDate;
      const notifyLower = notifyText;

      if (notifyLower.includes("antes")) {
        const hoursBefore = parseInt(notifyLower.split(" ")[0]);
        if (!isNaN(hoursBefore)) {
          notifyAt = new Date(eventDate.getTime() - hoursBefore * 3600 * 1000);
        }
      } else if (notifyLower.match(/\d{4}-\d{2}-\d{2} a las \d{2}:\d{2}/)) {
        const notifyMatch = notifyLower.match(/(\d{4}-\d{2}-\d{2}) a las (\d{2}:\d{2})/);
        if (notifyMatch) {
          notifyAt = createLocalDate(notifyMatch[1], notifyMatch[2]);
        }
      }

      if (notifyAt < new Date()) {
        notifyAt = new Date(Date.now() + 60 * 1000);
      }

      // Elegir emoji por palabra clave en title si no viene o está default
      let emoji = partial.emoji || getEmojiFromTitle(partial.title);

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

    // No hay recordatorio pendiente, parseamos normalmente
    const parsed = await parseReminderWithOpenAI(messageText);

    if (parsed.type === "reminder") {
      // Interpretar fecha relativa o absoluta
      let fechaReal = parseRelativeDate(parsed.data.date);
      if (!fechaReal) {
        await sendWhatsAppMessage(from, "No pude entender la fecha. Por favor escribila en formato YYYY-MM-DD o como 'mañana', 'en 2 días', etc.");
        return res.sendStatus(200);
      }

      // Fecha completa con hora (o default 09:00)
      const eventDate = createLocalDate(fechaReal, parsed.data.time);

      if (isNaN(eventDate.getTime())) {
        await sendWhatsAppMessage(from, "La fecha u hora no es válida. Por favor intenta de nuevo.");
        return res.sendStatus(200);
      }

      // Si no se indicó notify, guardar parcialmente y pedir aviso
      if (!parsed.data.notify || parsed.data.notify.trim() === "") {
        // Guardamos parcialmente para esperar aviso
        pendingReminders.set(from, {
          title: parsed.data.title,
          emoji: parsed.data.emoji || "📝",
          date: parsed.data.date,
          time: parsed.data.time || "09:00"
        });

        await sendWhatsAppMessage(from, "Perfecto! ¿A qué hora querés que te avise? Por favor decímelo (ejemplo: '1 hora antes', 'a la hora del evento', '2025-08-15 a las 14:00')");
        return res.sendStatus(200);
      }

      // Si notify está definido, calculamos notifyAt normalmente
      let emoji = parsed.data.emoji || getEmojiFromTitle(parsed.data.title);

      let notifyAt = eventDate;
      const notifyLower = parsed.data.notify.toLowerCase();

      if (notifyLower.includes("antes")) {
        const hoursBefore = parseInt(notifyLower.split(" ")[0]);
        if (!isNaN(hoursBefore)) {
          notifyAt = new Date(eventDate.getTime() - hoursBefore * 3600 * 1000);
        }
      } else if (notifyLower.match(/\d{4}-\d{2}-\d{2} a las \d{2}:\d{2}/)) {
        const notifyMatch = notifyLower.match(/(\d{4}-\d{2}-\d{2}) a las (\d{2}:\d{2})/);
        if (notifyMatch) {
          notifyAt = createLocalDate(notifyMatch[1], notifyMatch[2]);
        }
      }

      if (notifyAt < new Date()) {
        notifyAt = new Date(Date.now() + 60 * 1000);
      }

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
