// Importar dependencias
const express = require("express");
const mongoose = require("mongoose");
const OpenAI = require("openai");
const axios = require("axios");
require("dotenv").config();

const app = express();
app.use(express.json());

// Variables de entorno
const port = process.env.PORT || 3000;
const verifyToken = process.env.VERIFY_TOKEN;
const whatsappToken = process.env.WHATSAPP_TOKEN;
const phoneNumberId = process.env.PHONE_NUMBER_ID;
const mongoUri = process.env.MONGODB_URI;
const openaiModel = process.env.OPENAI_MODEL || "gpt-4o-mini";
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Esquema MongoDB para recordatorios
const reminderSchema = new mongoose.Schema({
  phone: String,
  title: String,
  emoji: String,
  date: Date,
  notifyAt: Date,
  sent: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now }
});
const Reminder = mongoose.model("Reminder", reminderSchema);

// Conectar a MongoDB
mongoose.connect(mongoUri, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(() => console.log("✅ Conectado a MongoDB"))
  .catch(err => {
    console.error("❌ Error conectando a MongoDB:", err);
    process.exit(1);
  });

// Enviar mensaje WhatsApp
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

// Parsear recordatorio con OpenAI
async function parseReminderWithOpenAI(text) {
  const prompt = `
Analiza el siguiente mensaje del usuario y devuelve SOLO un JSON con esta estructura:
{
  "title": "título del evento",
  "emoji": "emoji relacionado",
  "date": "YYYY-MM-DD",
  "time": "HH:MM",
  "notify": "instrucciones de aviso"
}

Reglas:
- Si el usuario pide ser avisado X horas antes, en notify pon "X antes"
- Si no especifica aviso, pon "A la hora del evento"
- Si especifica hora concreta para el aviso, en notify pon "YYYY-MM-DD a las HH:MM"
- Si no especifica hora, usa "09:00" por defecto
- Si no especifica emoji, usa "📝" por defecto
- Devuelve SOLO el JSON, sin formato ni comillas triples

Si falta la fecha, responde EXACTAMENTE: Perfecto! Para cuando queres que lo programe
Si falta la hora de aviso, responde EXACTAMENTE: Perfecto! Cuando queres que te avise

Mensaje: "${text}"
  `;

  try {
    const completion = await openai.chat.completions.create({
      model: openaiModel,
      messages: [{ role: "user", content: prompt }],
      temperature: 0
    });

    const response = completion.choices[0].message.content.trim();

    if (response === "Perfecto! Para cuando queres que lo programe" || response === "Perfecto! Cuando queres que te avise") {
      return { type: "message", content: response };
    }

    // Intentar parsear JSON
    let jsonText = response;
    if (jsonText.startsWith("```")) {
      jsonText = jsonText.replace(/```json?/, "").replace(/```$/, "").trim();
    }

    const parsed = JSON.parse(jsonText);

    // Completar con valores por defecto si faltan
    parsed.emoji = parsed.emoji || "📝";
    parsed.time = parsed.time || "09:00";
    parsed.notify = parsed.notify || "A la hora del evento";

    return { type: "reminder", data: parsed };

  } catch (err) {
    console.error("Error en OpenAI:", err);
    return { type: "message", content: "No pude procesar tu recordatorio." };
  }
}

// Programar recordatorio para enviar aviso
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

// Al iniciar, cargar y programar recordatorios pendientes
async function initScheduledReminders() {
  const now = new Date();
  const pending = await Reminder.find({ sent: false, notifyAt: { $gt: now } });
  pending.forEach(scheduleReminder);
}
initScheduledReminders();

// Webhook GET para verificación
app.get("/", (req, res) => {
  const { "hub.mode": mode, "hub.challenge": challenge, "hub.verify_token": token } = req.query;
  if (mode === "subscribe" && token === verifyToken) {
    console.log("✅ Webhook verificado");
    res.status(200).send(challenge);
  } else {
    res.status(403).end();
  }
});

// Webhook POST para recepción mensajes
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

    // Siempre enviar a parseReminderWithOpenAI para decidir si es recordatorio o mensaje normal
    const parsed = await parseReminderWithOpenAI(messageText);

    if (parsed.type === "reminder") {
      // Construir fechas y validar
      const dateStr = `${parsed.data.date}T${parsed.data.time || "09:00"}:00`;
      const eventDate = new Date(dateStr);

      if (isNaN(eventDate.getTime())) {
        await sendWhatsAppMessage(from, "La fecha u hora no es válida. Por favor intenta de nuevo.");
        return res.sendStatus(200);
      }

      // Calcular notifyAt según parsed.data.notify
      let notifyAt = eventDate;
      const notify = (parsed.data.notify || "").toLowerCase();

      if (notify.includes("antes")) {
        const hoursBefore = parseInt(notify.split(" ")[0]);
        if (!isNaN(hoursBefore)) {
          notifyAt = new Date(eventDate.getTime() - hoursBefore * 3600 * 1000);
        }
      } else if (notify.match(/\d{4}-\d{2}-\d{2} a las \d{2}:\d{2}/)) {
        // Ejemplo: "2025-08-15 a las 14:00"
        const notifyMatch = notify.match(/(\d{4}-\d{2}-\d{2}) a las (\d{2}:\d{2})/);
        if (notifyMatch) {
          notifyAt = new Date(`${notifyMatch[1]}T${notifyMatch[2]}:00`);
        }
      }
      // Si notifyAt es pasada, ajustar a ahora + 1 min para evitar no programar
      if (notifyAt < new Date()) {
        notifyAt = new Date(Date.now() + 60 * 1000);
      }

      const newReminder = new Reminder({
        phone: from,
        title: parsed.data.title,
        emoji: parsed.data.emoji || "📝",
        date: eventDate,
        notifyAt,
        sent: false
      });

      await newReminder.save();
      scheduleReminder(newReminder);

      await sendWhatsAppMessage(from, `✅ Recordatorio guardado: ${newReminder.emoji} ${newReminder.title} - ${eventDate.toLocaleString()}`);

    } else {
      // Respuesta normal GPT u otro texto
      await sendWhatsAppMessage(from, parsed.content);
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
