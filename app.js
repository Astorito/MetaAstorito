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

        if (parsed.type === "message") {
          await sendWhatsAppMessage(from, parsed.content);
          return res.sendStatus(200);
        }

        if (parsed.type === "reminder") {
          const { title, emoji, date, time, notify } = parsed.data;

          // Validar fecha y hora
          if (!date) {
            await sendWhatsAppMessage(from, "No especificaste la fecha del evento. Por favor intenta de nuevo.");
            return res.sendStatus(200);
          }

          const dateStr = `${date}T${time}:00`;
          const eventDate = new Date(dateStr);
          if (isNaN(eventDate.getTime())) {
            await sendWhatsAppMessage(from, "La fecha u hora no es válida. Intenta de nuevo.");
            return res.sendStatus(200);
          }

          // Calcular notifyAt
          let notifyAt = eventDate;
          const notifyLower = notify.toLowerCase();

          if (notifyLower.includes("antes")) {
            const hoursBefore = parseInt(notifyLower.split(" ")[0]);
            if (!isNaN(hoursBefore)) {
              notifyAt = new Date(eventDate.getTime() - hoursBefore * 3600 * 1000);
            }
          } else if (notifyLower.includes("a la hora del evento")) {
            notifyAt = eventDate;
          } else {
            // Intentar parsear fecha/hora exacta en notify (ejemplo: "2025-08-10 a las 15:00")
            const match = notifyLower.match(/(\d{4}-\d{2}-\d{2})\s*a las\s*(\d{2}:\d{2})/);
            if (match) {
              notifyAt = new Date(`${match[1]}T${match[2]}:00`);
            }
          }

          if (notifyAt < new Date()) {
            await sendWhatsAppMessage(from, "La hora para el aviso ya pasó. Por favor poné una fecha/hora futura.");
            return res.sendStatus(200);
          }

          const newReminder = new Reminder({
            phone: from,
            title,
            emoji,
            date: eventDate,
            notifyAt,
            sent: false
          });

          await newReminder.save();
          scheduleReminder(newReminder);

          await sendWhatsAppMessage(from, `¡Listo! Te recordaré "${title}" el ${eventDate.toLocaleString()}`);
        }
      } else {
        // Respuesta normal GPT para otros mensajes
        const gptResponse = await openai.chat.completions.create({
          model: openaiModel,
          messages: [
            { role: "system", content: "Eres un asistente útil que responde de forma clara y breve." },
            { role: "user", content: textMessage }
          ],
          temperature: 0.3
        });

        const replyText = gptResponse.choices[0].message.content;
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
