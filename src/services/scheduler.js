const Reminder = require('../models/reminder');
const { sendWhatsAppMessage } = require('./whatsapp');
const { DateTime } = require('luxon');

async function checkReminders() {
  const now = new Date();
  const reminders = await Reminder.find({
    sent: false,
    notifyAt: { $lte: now }
  });

  for (const reminder of reminders) {
    const eventDate = DateTime.fromJSDate(reminder.date);
    const notifyMsg =
      `⏰ ¡Recordatorio!\n\n` +
      `${reminder.emoji} *${reminder.title}*\n` +
      `📅 ${eventDate.toFormat("EEEE d 'de' MMMM", { locale: 'es' })} a las ${eventDate.toFormat('HH:mm')}\n\n` +
      `_No te olvides!_`;

    await sendWhatsAppMessage(reminder.phone, notifyMsg);
    reminder.sent = true;
    await reminder.save();
  }
}

// Ejecutar cada minuto
function startScheduler() {
  setInterval(checkReminders, 60 * 1000);
}

module.exports = { startScheduler };