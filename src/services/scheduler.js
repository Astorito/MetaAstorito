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

module.exports = { startScheduler };

// ...dentro del router.post("/", async (req, res) => { ... }

if (isWeatherQuery(messageText)) {
  await handleWeatherQuery(messageText, from);
  return res.sendStatus(200);
}

// Aquí sigue el flujo de recordatorios:
const parsed = await parseReminderWithOpenAI(messageText);
// ...resto del flujo de recordatorios...

