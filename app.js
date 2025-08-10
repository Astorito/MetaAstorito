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

    return reminderData;

  } catch (err) {
    console.error("Error parseando recordatorio con OpenAI:", err.response?.data || err.message);
    return null;
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
    const message = `⏰ *Recordatorio* ${reminder.emoji}: ${reminder.title} - ${reminder.date.toLocaleString()}`;
    await sendWhatsAppMessage(reminder.phone, message);

    reminder.sent = true;
    await reminder.save();
  }, delay);

  console.log(`Recordatorio programado para ${reminder.notifyAt.toLocaleString()} (en ${delay} ms)`);
}

// --- Al iniciar, cargar y programar recordatorios pendientes ---
async function initScheduledReminders() {
  const now = new Date();
  const pending = await Reminder.find({ sent: false, notifyAt: { $gt: now } });
  pending.forEach(r => scheduleReminder(r));
}
initScheduledReminders();

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

// --- Recepción de mensajes ---
app.post('/', async (req, res) => {
  console.log(`\n\nWebhook recibido: ${new Date().toISOString()}\n`);
  console.log(JSON.stringify(req.body, null, 2));

  try {
    const entry = req.body.entry?.[0];
    const changes = entry?.changes?.[0];
    const message = changes?.value?.messages?.[0];
    const textMessage = message?.text?.body;

    if (message && message.from && textMessage) {
      const from = message.from;
      console.log(`Mensaje de ${from}: ${textMessage}`);

      // Detectar si es recordatorio con palabras clave
      const lowerText = textMessage.toLowerCase();
      const reminderKeywords = ["recordarme", "recordatorio", "recuerdame", "recuérdame", "avísame", "acordarme", "acordar", "acorde", "recordar"];
      const isReminder = reminderKeywords.some(word => lowerText.includes(word));

      if (isReminder) {
        let reminderText = textMessage;
        if (lowerText.startsWith("recordarme")) {
          reminderText = textMessage.slice("recordarme".length).trim();
        }

        const parsed = await parseReminderWithOpenAI(reminderText);

        if (!parsed) {
          await sendWhatsAppMessage(from, "No pude entender tu recordatorio, por favor intenta de nuevo.");
          return res.sendStatus(200);
        }

        const dateStr = `${parsed.date}T${parsed.time}:00`;
        const eventDate = new Date(dateStr);
        if (isNaN(eventDate.getTime())) {
          await sendWhatsAppMessage(from, "La fecha u hora no es válida. Intenta de nuevo.");
          return res.sendStatus(200);
        }

        let notifyAt = eventDate;
        const notify = parsed.notify.toLowerCase();

        if (notify.includes("antes")) {
          const hoursBefore = parseInt(notify.split(" ")[0]);
          if (!isNaN(hoursBefore)) {
            notifyAt = new Date(eventDate.getTime() - hoursBefore * 3600 * 1000);
          }
        }

        if (notifyAt < new Date()) {
          await sendWhatsAppMessage(from, "La hora para el aviso ya pasó. Por favor poné una fecha/hora futura.");
          return res.sendStatus(200);
        }

        const newReminder = new Reminder({
          phone: from,
          title: parsed.title,
          emoji: parsed.emoji,
          date: eventDate,
          notifyAt,
          sent: false
        });

        await newReminder.save();
        scheduleReminder(newReminder);

        await sendWhatsAppMessage(from, `¡Listo! Te recordaré "${parsed.title}" el ${eventDate.toLocaleString()}`);

      } else {
        // Respuesta normal GPT para otros mensajes
        const gptResponse = await axios.post(
          "https://api.openai.com/v1/chat/completions",
          {
            model,
            messages: [
              { role: "system", content: "Eres un asistente útil que responde de forma clara y breve." },
              { role: "user", content: textMessage }
            ],
            temperature: 0.3
          },
          {
            headers: {
              Authorization: `Bearer ${openaiToken}`,
              "Content-Type": "application/json"
            }
          }
        );

        const replyText = gptResponse.data.choices[0].message.content;
        console.log(`Respuesta GPT: ${replyText}`);

        await sendWhatsAppMessage(from, replyText);
      }
    }
  } catch (err) {
    console.error("Error:", err?.response?.data || err.message);
  }

  res.sendStatus(200);
});

// Iniciar servidor
app.listen(port, () => {
  console.log(`Servidor escuchando en puerto ${port}`);
});
