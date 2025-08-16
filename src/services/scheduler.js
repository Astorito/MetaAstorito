const Reminder = require('../models/reminder');
const { sendWhatsAppMessage } = require('./whatsapp');
const { DateTime } = require('luxon');

async function checkReminders() {
  try {
    // Verificar también recordatorios pasados que no se enviaron (por si la app estuvo dormida)
    const now = DateTime.now().setZone('America/Argentina/Buenos_Aires');
    console.log(`🔍 Verificando recordatorios pendientes: ${now.toFormat('yyyy-MM-dd HH:mm:ss')}`);
    
    const reminders = await Reminder.find({
      sent: false,
      notifyAt: { $lte: now.toJSDate() }
    });

    console.log(`📝 Encontrados ${reminders.length} recordatorios pendientes`);
    
    for (const reminder of reminders) {
      const eventDate = DateTime.fromJSDate(reminder.date).setZone('America/Argentina/Buenos_Aires');
      const notifyMsg =
        `⏰ ¡Recordatorio!\n\n` +
        `${reminder.emoji} *${reminder.title}*\n` +
        `📅 ${eventDate.toFormat("EEEE d 'de' MMMM", { locale: 'es' })} a las ${eventDate.toFormat('HH:mm')}\n\n` +
        `_¡No lo olvides!_`;

      console.log(`📤 Enviando recordatorio a ${reminder.phone}: ${reminder.title}`);
      await sendWhatsAppMessage(reminder.phone, notifyMsg);
      reminder.sent = true;
      await reminder.save();
    }
  } catch (error) {
    console.error(`❌ Error en el scheduler: ${error.message}`);
  }
}

function startScheduler() {
  // Ejecutar inmediatamente al iniciar
  checkReminders();
  
  // Luego cada minuto
  setInterval(checkReminders, 60 * 1000);
  console.log("⏰ Scheduler iniciado correctamente");
}

module.exports = { startScheduler };

