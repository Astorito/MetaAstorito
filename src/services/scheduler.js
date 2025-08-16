const Reminder = require('../models/reminder');
const { sendWhatsAppMessage } = require('./whatsapp');
const { DateTime } = require('luxon');

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

async function handleWeatherQuery(messageText, from) {
  const parsed = await parseWeatherWithGPT(messageText);
  if (!parsed) {
    await sendWhatsAppMessage(from, "No pude entender tu consulta de clima.");
    return true;
  }
  if (!parsed.city) {
    await sendWhatsAppMessage(from, "¿Para qué ciudad querés saber el clima?");
    return true;
  }

  // ...resto del código...
}

module.exports = { startScheduler };

// En el flujo donde se recibe un mensaje
if (await handleWeatherQuery(messageText, from)) {
  return res.sendStatus(200);
}
// ...luego el flujo de recordatorios...