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

// --- Esquema y modelo MongoDB para usuarios ---
const userSchema = new mongoose.Schema({
  phone: { type: String, unique: true },
  name: String,
  email: String,
  onboardingState: {
    currentStep: { 
      type: String, 
      enum: ['welcome', 'ask_name', 'ask_email', 'completed'],
      default: 'welcome'
    },
    completed: { type: Boolean, default: false }
  },
  createdAt: { type: Date, default: Date.now }
});

const User = mongoose.model('User', userSchema);

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

// Agregar después de los requires
const INITIAL_RESPONSES = [
  "Genial",
  "Perfecto",
  "Dale",
  "Bárbaro"
];

// Agregar función helper para capitalizar
function capitalizeFirst(str) {
  return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
}

// Modificar el prompt de OpenAI para ser más estricto con fechas y horas
// Modificar la función parseReminderWithOpenAI para forzar el uso de la hora encontrada
async function parseReminderWithOpenAI(text) {
  const now = new Date();
  const today = now.toISOString().split('T')[0];
  
  const systemPrompt = `Eres un asistente que extrae información de recordatorios en español.
REGLAS ESTRICTAS PARA FECHAS Y HORAS:

HOY ES: ${today}

1. Si el texto dice "mañana", sumar 1 día a ${today}
2. Si el texto dice "pasado mañana", sumar 2 días a ${today}
3. Si menciona fecha específica (ej: "15 de agosto"), usar esa fecha exacta
4. Si menciona hora específica (ej: "10 de la mañana", "15:30"), usar esa hora exacta
5. NUNCA modificar la hora mencionada
6. Si no hay hora específica, usar "09:00"
7. Si menciona "X minutos/horas antes", guardar eso exacto en "notify"

El resultado DEBE ser un JSON con:
{
  "title": "título del evento",
  "emoji": "emoji relacionado o 📝",
  "date": "YYYY-MM-DD",
  "time": "HH:mm",
  "notify": "instrucción exacta de aviso"
}

Ejemplos válidos:
"mañana a las 10 de la mañana" →
{
  "title": "evento",
  "emoji": "📝",
  "date": "2025-08-12",
  "time": "10:00",
  "notify": "sin aviso"
}

"pasado mañana a las 3 de la tarde" →
{
  "title": "evento",
  "emoji": "📝", 
  "date": "2025-08-13",
  "time": "15:00",
  "notify": "sin aviso"
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
    console.log('OpenAI response:', parsed); // Debug

    // Extraer hora del mensaje original
    const horaPatterns = [
      /a las (\d{1,2})(?::(\d{2}))?\s*(?:de la)?\s*(mañana|tarde|noche)?/i,
      /(\d{1,2})(?::(\d{2}))?\s*(?:de la)?\s*(mañana|tarde|noche)/i,
      /(\d{1,2})(?::(\d{2}))?\s*(am|pm)/i
    ];

    for (const pattern of horaPatterns) {
      const match = text.match(pattern);
      if (match) {
        let h = parseInt(match[1]);
        const m = match[2] ? match[2].padStart(2, '0') : "00";
        const period = match[3]?.toLowerCase();
        
        if (period === "tarde" || period === "pm") h = (h < 12) ? h + 12 : h;
        if (period === "noche") h = (h < 12) ? h + 12 : h;
        if ((period === "mañana" || period === "am") && h === 12) h = 0;
        if (period === "mañana" && h < 12) h = h; // Mantener hora si es de mañana
        
        parsed.time = `${h.toString().padStart(2, '0')}:${m}`; // Cambiado aquí
        console.log(`Hora encontrada en texto original: ${parsed.time}`);
        break;
      }
    }

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

    return { 
      type: "reminder", 
      data: {
        title: parsed.title,
        emoji: parsed.emoji,
        date: parsed.date,
        time: parsed.time,
        notify: parsed.notify
      }
    };
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
  if (typeof input !== 'string') return null;
  
  input = input.toLowerCase().trim();
  const now = new Date();
  
  // Manejar "hoy" explícitamente
  if (input === "hoy" || input.includes("hoy")) {
    return formatDateLocal(now);
  }
  
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
  console.log(`Creando fecha local con: ${fechaStr} ${horaStr}`); // Debug
  const [year, month, day] = fechaStr.split('-');
  const [hours, minutes] = horaStr.split(':');
  
  // Crear fecha explícitamente para evitar problemas de timezone
  const date = new Date(
    parseInt(year),
    parseInt(month) - 1, // Mes en JS es 0-based
    parseInt(day),
    parseInt(hours),
    parseInt(minutes),
    0
  );
  
  console.log(`Fecha creada: ${date.toLocaleString()}`); // Debug
  return date;
}

// Agrega arriba, junto a otros requires
const chrono = require('chrono-node');
const fs = require('fs');
const FormData = require('form-data');

// --- Función para manejar onboarding ---
async function handleOnboarding(from, messageText) {
  // Buscar o crear usuario
  let user = await User.findOne({ phone: from });
  if (!user) {
    user = new User({ phone: from });
    await user.save();
  }

  // Si ya completó onboarding, retornar null
  if (user.onboardingState.completed) {
    return null;
  }

  let response;
  let shouldContinue = true;

  switch (user.onboardingState.currentStep) {
    case 'welcome':
      response = "¡Hola! Soy Astorito, ¡qué bueno verte por acá! 👋\n\nPara empezar, ¿podrías decirme tu nombre?";
      user.onboardingState.currentStep = 'ask_name';
      break;

    case 'ask_name':
      user.name = messageText.trim();
      user.onboardingState.currentStep = 'ask_email';
      response = "¡Gracias! Ahora, ¿podrías compartirme tu correo electrónico?";
      break;

    case 'ask_email':
      if (messageText.includes('@')) {
        user.email = messageText.trim();
        user.onboardingState.currentStep = 'completed';
        user.onboardingState.completed = true;
        response = `¡Perfecto ${user.name}! 🌟 Déjame contarte en qué puedo ayudarte:\n\n` +
          "⿡ Puedo crear recordatorios para tus eventos y tareas importantes\n" +
          "⿣ Puedo procesar mensajes de voz si prefieres hablar en lugar de escribir\n\n" +
          "Ademas tenemos Astorito Quiz todos los miercoles, donde podes jugar por premios contra todos tus amigos 🎮\n\n" +
          "Perooo si necesitas un Astorito más poderoso, lo buscas por acá https://astorito.ai donde podés suscribirte a Astorito Todopoderoso, con mil funciones nuevas para que descubras. \n\n" +
          "Un abrazo de carpincho 🦫 y te espero para charlar!\n\n";
        shouldContinue = false;
      } else {
        response = "Por favor, ingresa un correo electrónico válido";
      }
      break;
  }

  await user.save();
  return { message: response, shouldContinue };
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

    // Verificar onboarding primero
    const onboardingResponse = await handleOnboarding(from, messageText);
    if (onboardingResponse) {
      await sendWhatsAppMessage(from, onboardingResponse.message);
      if (!onboardingResponse.shouldContinue) {
        return res.sendStatus(200);
      }
    }

    // Chequear si hay recordatorio pendiente sin notify para este usuario
    if (pendingReminders.has(from)) {
      const partial = pendingReminders.get(from);
      const notifyText = messageText.toLowerCase();
      partial.notify = notifyText;

      const fechaReal = parseRelativeDate(partial.date);
      if (!fechaReal) {
        await sendWhatsAppMessage(from, "No pude entender la fecha. Por favor escribila en formato YYYY-MM-DD o como 'mañana', 'en 2 días', etc.");
        return res.sendStatus(200);
      }

      const hora = partial.time || "09:00";
      const eventDate = createLocalDate(fechaReal, hora);

      if (isNaN(eventDate.getTime())) {
        await sendWhatsAppMessage(from, "La fecha u hora no es válida. Por favor intenta de nuevo.");
        return res.sendStatus(200);
      }

      // Calcular notifyAt
      let notifyAt = null;
      const matchMinutos = notifyText.match(/en (\d+)\s*min/);
      const matchHoras = notifyText.match(/en (\d+)\s*hora/);

      if (matchMinutos) {
        notifyAt = new Date(Date.now() + parseInt(matchMinutos[1]) * 60000);
      } else if (matchHoras) {
        notifyAt = new Date(Date.now() + parseInt(matchHoras[1]) * 3600000);
      } else if (notifyText.includes("antes")) {
        const horasAntes = parseInt(notifyText.split(" ")[0]);
        if (!isNaN(horasAntes)) {
          notifyAt = new Date(eventDate.getTime() - horasAntes * 3600000);
        }
      } else {
        const parsedNotify = chrono.es.parseDate(notifyText);
        if (parsedNotify) notifyAt = parsedNotify;
      }

      if (!notifyAt || notifyAt < new Date()) {
        notifyAt = new Date(Date.now() + 60 * 1000);
      }

      // Elegir emoji
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
        `Genial! Ya lo agendamos 🚀\n\n` +
        `${emoji} ${capitalizeFirst(partial.title)}\n` +
        `🗓️ Fecha: ${formatDateTime(eventDate)}\n` +
        `⌛ Aviso: ${formatDateTime(notifyAt)}\n\n` +
        `Avisanos si necesitas que agendemos otro evento!`
      );

      return res.sendStatus(200);
    }

    // No hay recordatorio pendiente, parseamos con OpenAI
    const parsed = await parseReminderWithOpenAI(messageText);
    
    if (parsed.type === "reminder") {
      // Usar directamente los datos que devuelve OpenAI
      const eventDate = createLocalDate(parsed.data.date, parsed.data.time);
      console.log(`Fecha y hora del evento (desde OpenAI): ${eventDate.toLocaleString()}`);

      // Calcular notifyAt usando la instrucción de notify de OpenAI
      let notifyAt;
      if (parsed.data.notify.includes("antes")) {
        const match = parsed.data.notify.match(/(\d+)\s*(minutos?|horas?)\s*antes/);
        if (match) {
          const cantidad = parseInt(match[1]);
          const unidad = match[2].startsWith('hora') ? 3600000 : 60000;
          notifyAt = new Date(eventDate.getTime() - (cantidad * unidad));
          console.log(`Aviso calculado: ${notifyAt.toLocaleString()}`);
        }
      }

      // Usar el emoji que viene de OpenAI o buscar uno relacionado
      let emoji = parsed.data.emoji;
      if (emoji === "📝") {
        const lowerTitle = parsed.data.title.toLowerCase();
        const foundEmoji = Object.entries(emojiMap).find(([key]) => lowerTitle.includes(key))?.[1];
        if (foundEmoji) emoji = foundEmoji;
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

      // Enviar mensaje con los datos exactos de OpenAI
      await sendWhatsAppMessage(from,
        `${INITIAL_RESPONSES[Math.floor(Math.random() * INITIAL_RESPONSES.length)]}! Ya lo agendamos 🚀\n\n` +
        `${emoji} ${capitalizeFirst(parsed.data.title)}\n` +
        `🗓️ Fecha: ${formatDateTime(eventDate)}\n` +
        `⌛ Aviso: ${formatDateTime(notifyAt)}\n\n` +
        `Avisanos si necesitás que agendamos otro evento!`
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