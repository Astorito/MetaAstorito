const Reminder = require('../models/reminder');
const User = require('../models/user');
const { sendWhatsAppMessage } = require('./whatsapp');
const { DateTime } = require('luxon');

// Función para verificar recordatorios pendientes
async function checkReminders() {
  // Usar DateTime para obtener la hora actual con zona horaria
  const now = DateTime.now().setZone('America/Argentina/Buenos_Aires').toJSDate();
  console.log(`🔍 Verificando recordatorios pendientes: ${now.toISOString()}`);
  
  try {
    // Buscar recordatorios que deben enviarse ahora y no han sido enviados
    const pendingReminders = await Reminder.find({
      notifyAt: { $lte: now },
      sent: false
    });
    
    console.log(`📝 Encontrados ${pendingReminders.length} recordatorios pendientes`);
    
    // Procesar cada recordatorio pendiente
    for (const reminder of pendingReminders) {
      try {
        // Obtener el usuario para personalizar el mensaje
        const user = await User.findOne({ phone: reminder.phone });
        const userName = user ? user.name : 'Usuario';
        
        // Fecha formateada para el mensaje (usando la zona horaria correcta)
        const eventDate = DateTime.fromJSDate(reminder.date)
                           .setZone('America/Argentina/Buenos_Aires');
        const formattedDate = eventDate.toFormat("EEEE d 'de' MMMM", { locale: 'es' });
        const formattedTime = eventDate.toFormat('HH:mm');
        
        // Mensaje personalizado con el nombre del usuario
        const message = 
          `⏰ ¡Hola ${userName}! Recordatorio:\n\n` +
          `${reminder.emoji} *${reminder.title}*\n` +
          `📅 ${formattedDate} a las ${formattedTime}\n\n` +
          `No te olvides!`;
        
        // Enviar el recordatorio
        console.log(`📤 Enviando recordatorio a ${reminder.phone}: "${reminder.title}" (programado para ${eventDate.toISO()})`);
        await sendWhatsAppMessage(reminder.phone, message);
        
        // Marcar como enviado
        reminder.sent = true;
        await reminder.save();
        
        console.log(`✅ Recordatorio enviado y actualizado: ${reminder._id}`);
      } catch (err) {
        console.error(`❌ Error procesando recordatorio ${reminder._id}:`, err);
      }
    }
  } catch (err) {
    console.error('❌ Error consultando recordatorios:', err);
  }
}

// En la sección donde se crea el recordatorio en webhook.js (snippet parcial)

// Crear y guardar el recordatorio (usa Luxon para fechas)
const eventDate = DateTime.fromISO(`${parsed.data.date}T${parsed.data.time}`)
                  .setZone('America/Argentina/Buenos_Aires');

if (!eventDate.isValid) {
  await sendWhatsAppMessage(from, "La fecha y hora del recordatorio no son válidas. Por favor, revisá el mensaje.");
  return res.sendStatus(200);
}

// Calcula notifyAt según el campo "notify"
let notifyAt = eventDate;
if (parsed.data.notify?.includes('hora')) {
  const horas = parseInt(parsed.data.notify);
  notifyAt = eventDate.minus({ hours: horas });
} else if (parsed.data.notify?.includes('minuto')) {
  const minutos = parseInt(parsed.data.notify);
  notifyAt = eventDate.minus({ minutes: minutos });
}

// Convertir a fechas JavaScript con la zona horaria correcta
const reminder = new Reminder({
  phone: from,
  title: parsed.data.title,
  emoji: findBestEmoji(parsed.data.title),
  date: eventDate.toJSDate(),
  notifyAt: notifyAt.toJSDate(),
  sent: false
});

// Iniciar comprobación periódica (cada 1 minuto)
function startScheduler() {
  console.log('🔄 Iniciando programador de recordatorios');
  console.log(`🕒 Zona horaria del sistema: ${DateTime.now().zoneName}`);
  console.log(`🕒 Hora actual: ${DateTime.now().setZone('America/Argentina/Buenos_Aires').toFormat('yyyy-MM-dd HH:mm:ss')}`);
  
  setInterval(checkReminders, 60000); // 60000 ms = 1 minuto
  
  // También ejecutar inmediatamente al iniciar
  checkReminders();
}

module.exports = {
  startScheduler,
  checkReminders
};

