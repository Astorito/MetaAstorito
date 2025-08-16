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

module.exports = { startScheduler };

// ...dentro del router.post("/", async (req, res) => { ... }

if (!messageText || !from) {
  return res.sendStatus(200);
}

// 3. Si no, intenta parsear como recordatorio
try {
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

