const { DateTime } = require('luxon');
const { sendWhatsAppMessage } = require('./whatsapp');
const Reminder = require('../models/reminder');
const User = require('../models/user');

async function scheduleReminder(reminder) {
  const now = new Date();
  const delay = reminder.notifyAt.getTime() - now.getTime();

  if (delay <= 0) {
    console.log("Recordatorio vencido, no se programa:", reminder);
    return;
  }

  setTimeout(async () => {
    const user = await User.findOne({ phone: reminder.phone });
    const userName = user?.name || '';
    
    const message = `Hola ${userName}! Acordate que hoy tenes ${reminder.title} ${reminder.emoji}`;
    await sendWhatsAppMessage(reminder.phone, message);

    reminder.sent = true;
    await reminder.save();
  }, delay);

  console.log(`Recordatorio programado para ${reminder.notifyAt.toLocaleString()}`);
}

module.exports = { scheduleReminder };