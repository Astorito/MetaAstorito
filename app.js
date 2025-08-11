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

// --- Modifica el prompt de OpenAI para ser más específico
async function parseReminderWithOpenAI(text) {
  const now = new Date();
  const today = now.toISOString().split('T')[0];
  
  const systemPrompt = `Eres un asistente que extrae información de recordatorios en español.
IMPORTANTE - REGLAS ESTRICTAS:
1. HOY ES: ${today}
2. Si el mensaje menciona "hoy", DEBES usar ${today} como fecha
3. Si menciona una hora específica (ej: "10 de la mañana"), DEBES usar esa hora exacta
4. NUNCA modifiques la hora mencionada en el mensaje
5. Si dice "X minutos/horas antes", guarda eso textual en notify

Formato JSON requerido:
{
  "title": "título del evento",
  "emoji": "emoji relacionado o 📝",
  "date": "YYYY-MM-DD",
  "time": "HH:MM en formato 24h",
  "notify": "instrucción de aviso exacta"
}

Ejemplo: "hoy a las 10 de la mañana, avisar 30 min antes"
Respuesta correcta:
{
  "title": "evento",
  "emoji": "📝",
  "date": "${today}",
  "time": "10:00",
  "notify": "30 minutos antes"
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
  // fechaStr: YYYY-MM-DD, horaStr: HH:MM (24h)
  return new Date(`${fechaStr}T${horaStr}:00`);
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
  return { message: response, shouldContinue };
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

    // Verificar onboarding primerogeText) {
    const onboardingResponse = await handleOnboarding(from, messageText);
    if (onboardingResponse) {00);
      await sendWhatsAppMessage(from, onboardingResponse.message);
      if (!onboardingResponse.shouldContinue) {
        return res.sendStatus(200);: ${messageText}`);
      }
    }/ Verificar onboarding primero
    const onboardingResponse = await handleOnboarding(from, messageText);
    // Chequear si hay recordatorio pendiente sin notify para este usuario
    if (pendingReminders.has(from)) { onboardingResponse.message);
      const partial = pendingReminders.get(from);
        return res.sendStatus(200);
      // Este mensaje debería ser la respuesta para notify
      const notifyText = messageText.toLowerCase();

      // Guardar notify en el partialendiente sin notify para este usuario
      partial.notify = notifyText;) {
      const partial = pendingReminders.get(from);
      // Construir fecha real usando parseRelativeDate (tu función que retorna fecha YYYY-MM-DD)
      const fechaReal = parseRelativeDate(partial.date);fy
      if (!fechaReal) {= messageText.toLowerCase();
        await sendWhatsAppMessage(from, "No pude entender la fecha. Por favor escribila en formato YYYY-MM-DD o como 'mañana', 'en 2 días', etc.");
        return res.sendStatus(200);al
      }artial.notify = notifyText;

      // Fecha completa con hora (o default 09:00)Date (tu función que retorna fecha YYYY-MM-DD)
      const hora = partial.time || "09:00";artial.date);
      const eventDate = createLocalDate(fechaReal, hora);
        await sendWhatsAppMessage(from, "No pude entender la fecha. Por favor escribila en formato YYYY-MM-DD o como 'mañana', 'en 2 días', etc.");
      if (isNaN(eventDate.getTime())) {
        await sendWhatsAppMessage(from, "La fecha u hora no es válida. Por favor intenta de nuevo.");
        return res.sendStatus(200);
      }/ Fecha completa con hora (o default 09:00)
      const hora = partial.time || "09:00";
      // Calcular notifyAt usando chrono para interpretar notifyText
      let notifyAt = null;
      // Intentamos parsear offset tipo "en 5 minutos", "en 1 hora"
      const matchMinutos = notifyText.match(/en (\d+)\s*min/); válida. Por favor intenta de nuevo.");
      const matchHoras = notifyText.match(/en (\d+)\s*hora/);
      }
      if (matchMinutos) {
        notifyAt = new Date(Date.now() + parseInt(matchMinutos[1]) * 60000);
      } else if (matchHoras) {
        notifyAt = new Date(Date.now() + parseInt(matchHoras[1]) * 3600000);
      } else if (notifyText.includes("antes")) {(\d+)\s*min/);
        // Si dice "1 hora antes", "2 horas antes")\s*hora/);
        const horasAntes = parseInt(notifyText.split(" ")[0]);
        if (!isNaN(horasAntes)) {
          notifyAt = new Date(eventDate.getTime() - horasAntes * 3600000););
        }lse if (matchHoras) {
      } else {At = new Date(Date.now() + parseInt(matchHoras[1]) * 3600000);
        // Intentamos parsear fecha y hora absoluta con chrono
        const parsedNotify = chrono.es.parseDate(notifyText);
        if (parsedNotify) notifyAt = parsedNotify;it(" ")[0]);
      } if (!isNaN(horasAntes)) {
          notifyAt = new Date(eventDate.getTime() - horasAntes * 3600000);
      // Si no pudimos calcular notifyAt o es en el pasado, lo ponemos 1 minuto en el futuro
      if (!notifyAt || notifyAt < new Date()) {
        notifyAt = new Date(Date.now() + 60 * 1000);con chrono
      } const parsedNotify = chrono.es.parseDate(notifyText);
        if (parsedNotify) notifyAt = parsedNotify;
      // Elegir emoji por palabra clave en title si no viene o está default
      let emoji = partial.emoji || "📝";
      const lowerTitle = partial.title.toLowerCase();asado, lo ponemos 1 minuto en el futuro
      const foundEmoji = Object.entries(emojiMap).find(([key]) => lowerTitle.includes(key))?.[1];
      if (foundEmoji) emoji = foundEmoji; 60 * 1000);

      const newReminder = new Reminder({
        phone: from,i por palabra clave en title si no viene o está default
        title: partial.title,ji || "📝";
        emoji,werTitle = partial.title.toLowerCase();
        date: eventDate, Object.entries(emojiMap).find(([key]) => lowerTitle.includes(key))?.[1];
        notifyAt,oji) emoji = foundEmoji;
        sent: false
      });st newReminder = new Reminder({
        phone: from,
      await newReminder.save();
      scheduleReminder(newReminder);
      pendingReminders.delete(from);
        notifyAt,
      await sendWhatsAppMessage(from,
        `Genial! Ya agendamos tu evento 🚀\n\n` +
        `${emoji} *${partial.title}*\n` +
        `🗓️ Fecha: ${formatDateTime(eventDate)}\n` +
        `⌛ Aviso: ${formatDateTime(notifyAt)}\n\n` +
        `Avisanos si necesitás que agendemos otro evento!`
      );
      await sendWhatsAppMessage(from,
      return res.sendStatus(200);evento 🚀\n\n` +
    }   `${emoji} *${partial.title}*\n` +
        `🗓️ Fecha: ${formatDateTime(eventDate)}\n` +
    // No hay recordatorio pendiente, parseamos normalmente usando OpenAI
    const parsed = await parseReminderWithOpenAI(messageText);
      );
    if (parsed.type === "reminder") {
      // Extraer hora específica del mensaje original - MEJORADO
      let hora = parsed.data.time || "09:00"; // default
      
      // Buscar patrones más específicos primeronormalmente usando OpenAI
      const horaPatterns = [seReminderWithOpenAI(messageText);
        /a las (\d{1,2})(?::(\d{2}))?\s*(?:de la)?\s*(mañana|tarde|noche)?/i,
        /(\d{1,2})(?::(\d{2}))?\s*(?:de la)?\s*(mañana|tarde|noche)/i,
        /(\d{1,2})(?::(\d{2}))?\s*(am|pm)/ie original - MEJORADO
      ];t hora = parsed.data.time || "09:00"; // default
      
      for (const pattern of horaPatterns) {imero
        const match = messageText.match(pattern);
        if (match) {,2})(?::(\d{2}))?\s*(?:de la)?\s*(mañana|tarde|noche)?/i,
          let h = parseInt(match[1]);de la)?\s*(mañana|tarde|noche)/i,
          const m = match[2] ? match[2].padStart(2, '0') : "00";
          const period = match[3]?.toLowerCase();
          
          // Ajustar AM/PMf horaPatterns) {
          if (period === "tarde" && h < 12) h += 12;
          if (period === "noche" && h < 12) h += 12;
          if (period === "mañana" && h === 12) h = 0;
          if (period === "pm" && h < 12) h += 12;2, '0') : "00";
          if (period === "am" && h === 12) h = 0;
          
          hora = `${h.toString().padStart(2, '0')}:${m}`;
          break;riod === "tarde" && h < 12) h += 12;
        } if (period === "noche" && h < 12) h += 12;
      }   if (period === "mañana" && h === 12) h = 0;
          if (period === "pm" && h < 12) h += 12;
      console.log(`Hora extraída del mensaje: ${hora}`); // Debug
          
      // Parsear fecha relativa).padStart(2, '0')}:${m}`;
      const fechaReal = parseRelativeDate(messageText.includes("mañana") ? "mañana" : parsed.data.date);
      if (!fechaReal) {
        await sendWhatsAppMessage(from, "No pude entender la fecha correctamente.");
        return res.sendStatus(200);
      }onsole.log(`Hora extraída del mensaje: ${hora}`); // Debug

      const eventDate = createLocalDate(fechaReal, hora);
      const fechaReal = parseRelativeDate(messageText.includes("mañana") ? "mañana" : parsed.data.date);
      // Calcular tiempo de aviso
      let notifyAt = new Date();e(from, "No pude entender la fecha correctamente.");
      const minutosMatch = messageText.match(/en (\d+)\s*minutos?/);
      const horasMatch = messageText.match(/en (\d+)\s*horas?/);
      
      if (minutosMatch) {reateLocalDate(fechaReal, hora);
        notifyAt = new Date(Date.now() + parseInt(minutosMatch[1]) * 60000);
      } else if (horasMatch) {iso
        notifyAt = new Date(Date.now() + parseInt(horasMatch[1]) * 3600000);
      } else if (parsed.data.notify.includes("antes")) {*minutos?/);
        const match = parsed.data.notify.match(/(\d+)\s*(minutos?|horas?)\s*antes/);
        if (match) {
          const cantidad = parseInt(match[1]);
          const unidad = match[2].startsWith('hora') ? 3600000 : 60000;000);
          // Calcular desde eventDate, no desde now()
          notifyAt = new Date(eventDate.getTime() - (cantidad * unidad));otifyAt = new Date(Date.now() + parseInt(horasMatch[1]) * 3600000);
          console.log(`Calculando aviso: ${cantidad} ${match[2]} antes de ${eventDate}`);f (parsed.data.notify.includes("antes")) {
        }os?|horas?)\s*antes/);
      } else {
        // Intentamos parsear fecha y hora absoluta con chrono
        const parsedNotify = chrono.es.parseDate(parsed.data.notify);   const unidad = match[2].startsWith('hora') ? 3600000 : 60000;
        if (parsedNotify) notifyAt = parsedNotify;          // Calcular desde eventDate, no desde now()
      }() - (cantidad * unidad));
 ${match[2]} antes de ${eventDate}`);
      if (!notifyAt || notifyAt < new Date()) { }
        notifyAt = new Date(Date.now() + 60 * 1000);      } else {
      }
Date(parsed.data.notify);
      // Elegir emoji por palabra clave en title si no viene o está default
      let emoji = parsed.data.emoji || "📝";
      const lowerTitle = parsed.data.title.toLowerCase();
      const foundEmoji = Object.entries(emojiMap).find(([key]) => lowerTitle.includes(key))?.[1];      if (!notifyAt || notifyAt < new Date()) {
      if (foundEmoji) emoji = foundEmoji; 60 * 1000);

      const newReminder = new Reminder({
        phone: from,r emoji por palabra clave en title si no viene o está default
        title: parsed.data.title,.data.emoji || "📝";
        emoji,Title = parsed.data.title.toLowerCase();
        date: eventDate,oji = Object.entries(emojiMap).find(([key]) => lowerTitle.includes(key))?.[1];
        notifyAt,(foundEmoji) emoji = foundEmoji;
        sent: false
      });eminder({

      await newReminder.save();        title: parsed.data.title,
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
app.get('/', (req, res) => {.message);
  const { 'hub.mode': mode, 'hub.challenge': challenge, 'hub.verify_token': token } = req.query;
  if (mode === 'subscribe' && token === verifyToken) {
    console.log('WEBHOOK VERIFIED');Status(200);
    res.status(200).send(challenge);
  } else {
    res.status(403).end();--- Verificación webhook ---
  }app.get('/', (req, res) => {
}); 'hub.challenge': challenge, 'hub.verify_token': token } = req.query;
e' && token === verifyToken) {
// --- Iniciar servidor ---
app.listen(port, () => { res.status(200).send(challenge);


});  console.log(`Servidor escuchando en puerto ${port}`);  } else {
    res.status(403).end();
  }
});

// --- Iniciar servidor ---
app.listen(port, () => {
  console.log(`Servidor escuchando en puerto ${port}`);
});