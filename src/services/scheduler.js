const Reminder = require('../models/reminder');
const { sendWhatsAppMessage } = require('./whatsapp');
const { DateTime } = require('luxon');
const { handleWeatherQuery } = require('../services/weather');

async function checkReminders() {
  const now = DateTime.now().setZone('America/Argentina/Buenos_Aires');
  const reminders = await Reminder.find({
    sent: false,
    notifyAt: { $lte: now.toJSDate() }
  });

  for (const reminder of reminders) {
    const eventDate = DateTime.fromJSDate(reminder.date).setZone('America/Argentina/Buenos_Aires');
    const notifyMsg =
      `⏰ ¡Recordatorio!\n\n` +
      `${reminder.emoji} *${reminder.title}*\n` +
      `📅 ${eventDate.toFormat("EEEE d 'de' MMMM", { locale: 'es' })} a las ${eventDate.toFormat('HH:mm')}\n\n` +
      `_¡No lo olvides!_`;

    await sendWhatsAppMessage(reminder.phone, notifyMsg);
    reminder.sent = true;
    await reminder.save();
  }
}

function startScheduler() {
  setInterval(checkReminders, 60 * 1000);
}

function isWeatherQuery(text) {
  return /(clima|tiempo|temperatura|lluvia|pronóstico|pronostico)/i.test(text);
}

function isGreeting(text) {
  return /^(hola|buenas|buen día|buenas tardes|buenas noches)$/i.test(text.trim());
}

module.exports = { startScheduler };

// ...dentro del router.post("/", async (req, res) => { ... }

if (!messageText || !from) {
  return res.sendStatus(200);
}

// 1. Si es clima, responde clima y termina
if (isWeatherQuery(messageText)) {
  await handleWeatherQuery(messageText, from);
  return res.sendStatus(200);
}

// 2. Si es un saludo, responde saludo y termina
if (isGreeting(messageText)) {
  await sendWhatsAppMessage(from, "Hola! En qué puedo ayudarte hoy?");
  return res.sendStatus(200);
}

// 3. Si no, intenta parsear como recordatorio
try {
  const parsed = await parseReminderWithOpenAI(messageText);
  if (parsed.type === "reminder") {
    // ...tu lógica para guardar y confirmar el recordatorio...
    // Ejemplo:
    // await sendWhatsAppMessage(from, "✅ Recordatorio creado!");
    // return res.sendStatus(200);
  } else {
    // Si no es recordatorio ni clima ni saludo, responde por defecto
    await sendWhatsAppMessage(from, "No entendí tu mensaje. ¿Querés agendar un recordatorio o consultar el clima?");
    return res.sendStatus(200);
  }
} catch (err) {
  await sendWhatsAppMessage(from, "Ocurrió un error procesando tu mensaje.");
  return res.sendStatus(200);
}

