// Importar dependencias
const express = require('express');
const axios = require('axios');
const mongoose = require('mongoose');
require('dotenv').config();

const app = express();
app.use(express.json());

// Variables de entorno
const port = process.env.PORT || 3000;
const mongoUri = process.env.MONGODB_URI;
const openaiToken = process.env.OPENAI_API_KEY;
const whatsappToken = process.env.WHATSAPP_TOKEN;
const phoneNumberId = process.env.PHONE_NUMBER_ID;
const model = process.env.OPENAI_MODEL || "gpt-3.5-turbo";

// Conexión a MongoDB
mongoose.connect(mongoUri, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(() => console.log("✅ Conectado a MongoDB"))
  .catch(err => console.error("❌ Error conectando a MongoDB", err));

// Modelo de evento
const EventSchema = new mongoose.Schema({
  phone: String,
  title: String,
  emoji: String,
  date: Date,
  notifyAt: Date,
  notified: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now }
});
const Event = mongoose.model('Event', EventSchema);

// Formatear fecha y hora "dd/mm/yyyy a las hh:mm AM/PM"
function formatDateTime(date) {
  return `${date.toLocaleDateString('es-AR')} a las ${date.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: true })}`;
}

// Función para interpretar texto con OpenAI y extraer recordatorio
async function parseReminderWithOpenAI(text) {
  const systemPrompt = `Eres un asistente que extrae información de recordatorios en español.
Devuelve SOLO un JSON con: "title", "emoji", "date" (YYYY-MM-DD), "time" (HH:MM, 24h), "notify" (texto libre para aviso).
Si falta hora usa "09:00".
Si falta emoji usa "📝".
Ejemplo:
{"title":"Ir al médico","emoji":"🩺","date":"2025-08-15","time":"14:30","notify":"1 hora antes"}
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

    // Limpiar posible markdown
    if (content.startsWith("```")) {
      content = content.replace(/```json?/, '').replace(/```$/, '').trim();
    }

    const reminderData = JSON.parse(content);

    reminderData.emoji = reminderData.emoji || "📝";
    reminderData.time = reminderData.time || "09:00";

    return reminderData;

  } catch (err) {
    console.error("Error parseando recordatorio con OpenAI:", err.response?.data || err.message);
    return null;
  }
}

// Calcular notifyAt a partir de date, time y notify string
function calculateNotifyAt(dateStr, timeStr, notifyStr) {
  const eventDate = new Date(`${dateStr}T${timeStr}:00`);
  let notifyAt = new Date(eventDate);

  if (!notifyStr || notifyStr.trim() === "") {
    return notifyAt; // Sin ajuste
  }

  const notifyLower = notifyStr.toLowerCase();

  // Manejar "1 hora antes", "2 horas antes", etc.
  const matchAntes = notifyLower.match(/(\d+)\s*hora/);
  if (matchAntes) {
    const horasAntes = parseInt(matchAntes[1], 10);
    if (!isNaN(horasAntes)) {
      notifyAt = new Date(eventDate.getTime() - horasAntes * 3600 * 1000);
      return notifyAt;
    }
  }

  // Manejar notify tipo "2025-08-15 a las 14:00"
  const matchFecha = notifyLower.match(/(\d{4}-\d{2}-\d{2}) a las (\d{2}:\d{2})/);
  if (matchFecha) {
    notifyAt = new Date(`${matchFecha[1]}T${matchFecha[2]}:00`);
    return notifyAt;
  }

  return notifyAt; // Default sin cambio
}

// Función para enviar mensaje WhatsApp (para recordatorios y respuestas)
async function sendWhatsAppMessage(to, text) {
  try {
    await axios.post(`https://graph.facebook.com/v17.0/${phoneNumberId}/messages`, {
      messaging_product: "whatsapp",
      to,
      text: { body: text }
    }, {
      headers: { Authorization: `Bearer ${whatsappToken}` }
    });
  } catch (err) {
    console.error("Error enviando mensaje WhatsApp:", err.response?.data || err.message);
  }
}

// Programar recordatorio con setTimeout (máximo 24h, para evitar timeouts grandes)
function scheduleReminder(event) {
  const now = new Date();
  const msToNotify = event.notifyAt.getTime() - now.getTime();

  if (msToNotify <= 0) {
    console.log(`Recordatorio ya vencido para evento ${event._id}, no se programa.`);
    return;
  }

  // Si supera 24h, programa solo 24h y luego deberá recargar (idealmente)
  const maxTimeout = 24 * 3600 * 1000;
  const timeout = msToNotify > maxTimeout ? maxTimeout : msToNotify;

  setTimeout(async () => {
    // Si el timeout fue parcial, reprogramamos recursivamente
    if (timeout === maxTimeout) {
      const freshEvent = await Event.findById(event._id);
      if (freshEvent && !freshEvent.notified) {
        scheduleReminder(freshEvent);
      }
      return;
    }

    // Enviar aviso
    const msg = `⏰ Recordatorio:\n${event.emoji} ${event.title}\nFecha: ${formatDateTime(event.date)}`;
    await sendWhatsAppMessage(event.phone, msg);

    // Marcar como notificado
    await Event.findByIdAndUpdate(event._id, { notified: true });

    console.log(`Recordatorio enviado para evento ${event._id}`);
  }, timeout);

  console.log(`Recordatorio programado para evento ${event._id} en ${timeout/1000} segundos.`);
}

// Cargar y programar recordatorios pendientes al iniciar
async function loadPendingReminders() {
  const now = new Date();
  const pendientes = await Event.find({ notified: false, notifyAt: { $gt: now } });
  console.log(`Cargando ${pendientes.length} recordatorios pendientes...`);
  pendientes.forEach(scheduleReminder);
}

// Endpoint para recibir mensajes WhatsApp
app.post('/webhook', async (req, res) => {
  try {
    const message = req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
    const from = message?.from;
    const text = message?.text?.body;

    if (!text || !from) {
      return res.sendStatus(200);
    }

    // Parsear recordatorio
    const reminder = await parseReminderWithOpenAI(text);
    if (!reminder) {
      await sendWhatsAppMessage(from, "No pude entender tu recordatorio. Por favor intentá de nuevo con otra redacción.");
      return res.sendStatus(200);
    }

    // Calcular fechas
    const notifyAt = calculateNotifyAt(reminder.date, reminder.time, reminder.notify);
    const eventDate = new Date(`${reminder.date}T${reminder.time}:00`);

    // Guardar evento
    const newEvent = await Event.create({
      phone: from,
      title: reminder.title,
      emoji: reminder.emoji,
      date: eventDate,
      notifyAt,
      notified: false
    });

    // Programar recordatorio
    scheduleReminder(newEvent);

    // Responder confirmación
    const respuesta = `Genial! Ya agendamos tu evento 🚀

${reminder.emoji} ${reminder.title}
🗓️ Fecha: ${formatDateTime(eventDate)}
⌛ Aviso: ${formatDateTime(notifyAt)}

Avisanos si necesitás que agendemos otro evento!`;

    await sendWhatsAppMessage(from, respuesta);

  } catch (err) {
    console.error("Error en webhook:", err);
  }
  res.sendStatus(200);
});

// Webhook GET para verificación (Facebook)
app.get('/webhook', (req, res) => {
  const { 'hub.mode': mode, 'hub.challenge': challenge, 'hub.verify_token': token } = req.query;
  if (mode === 'subscribe' && token === process.env.VERIFY_TOKEN) {
    console.log('WEBHOOK VERIFICADO');
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
});

app.listen(port, () => {
  console.log(`🚀 Servidor corriendo en puerto ${port}`);
  loadPendingReminders();
});
