const Reminder = require('../models/reminder');
const User = require('../models/user');
const { sendWhatsAppMessage } = require('./whatsapp');
const { DateTime } = require('luxon');

// Función para verificar recordatorios pendientes
async function checkReminders() {
  try {
    // Usar DateTime para obtener la hora actual con zona horaria
    const now = DateTime.now().setZone('America/Argentina/Buenos_Aires');
    console.log(`🔍 Verificando recordatorios pendientes: ${now.toFormat('yyyy-MM-dd HH:mm:ss')}`);
    
    // Buscar recordatorios que deben enviarse ahora y no han sido enviados
    // Usamos una ventana de 2 minutos para evitar perder recordatorios por segundos
    const twoMinutesAgo = now.minus({ minutes: 2 }).toJSDate();
    const pendingReminders = await Reminder.find({
      notifyAt: { $lte: now.toJSDate(), $gte: twoMinutesAgo },
      sent: false
    });
    
    console.log(`📝 Encontrados ${pendingReminders.length} recordatorios pendientes en el rango de tiempo`);
    
    // Para debug: mostrar todos los recordatorios no enviados
    const allPendingReminders = await Reminder.find({ sent: false });
    console.log(`📋 Total de recordatorios pendientes: ${allPendingReminders.length}`);
    for (const rem of allPendingReminders) {
      const remDate = DateTime.fromJSDate(rem.notifyAt).setZone('America/Argentina/Buenos_Aires');
      console.log(`  - "${rem.title}" programado para ${remDate.toFormat('yyyy-MM-dd HH:mm:ss')} (${remDate > now ? 'futuro' : 'pasado'})`);
    }
    
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
        console.log(`📤 Enviando recordatorio a ${reminder.phone}: "${reminder.title}" (programado para ${eventDate.toFormat('yyyy-MM-dd HH:mm:ss')})`);
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

// Iniciar comprobación periódica (cada 1 minuto)
function startScheduler() {
  console.log('🔄 Iniciando programador de recordatorios');
  console.log(`🕒 Zona horaria del sistema: ${DateTime.now().zoneName}`);
  console.log(`🕒 Hora actual: ${DateTime.now().setZone('America/Argentina/Buenos_Aires').toFormat('yyyy-MM-dd HH:mm:ss')}`);
  
  // Ejecutar la verificación cada minuto
  setInterval(checkReminders, 60000); // 60000 ms = 1 minuto
  
  // También ejecutar inmediatamente al iniciar
  checkReminders();
}

// Localiza la función donde se crea el recordatorio y ajusta la zona horaria:
async function createReminder(phone, reminderData) {
  // MODIFICAR: Ajustar la zona horaria para Argentina (GMT-3)
  const reminderDate = new Date(reminderData.date);
  
  // Fix: Ajustar zona horaria para Argentina (GMT-3)
  const argentinaOffset = -3 * 60; // -3 horas en minutos
  const serverOffset = reminderDate.getTimezoneOffset(); // Offset del servidor en minutos
  const totalOffsetMinutes = serverOffset - argentinaOffset;
  
  // Aplicar el ajuste solo si es necesario (si los offset son diferentes)
  if (totalOffsetMinutes !== 0) {
    reminderDate.setMinutes(reminderDate.getMinutes() + totalOffsetMinutes);
    console.log(`Ajuste de zona horaria: Original=${reminderData.date}, Ajustada=${reminderDate}`);
  }
  
  // Usar la fecha ajustada para el recordatorio
  const reminder = new Reminder({
    phone,
    title: reminderData.title,
    date: reminderDate,
    // ... resto del código existente ...
  });
  
  // ... resto de la función ...
}

// Añadir o modificar función para seleccionar emoji apropiado:
function getEmojiForReminder(title) {
  const lowercaseTitle = title.toLowerCase();
  
  // Mapa mejorado de categorías con emojis y palabras clave
  const categories = [
    {
      emoji: "✈️",
      keywords: ["viaje", "viajar", "viajo", "vuelo", "avión", "aeropuerto"]
    },
    {
      emoji: "🏔️",
      keywords: ["montaña", "esquiar", "esquí", "nieve", "chile", "bariloche", "cerro", "montañas", "alpino"]
    },
    {
      emoji: "🏥",
      keywords: ["médico", "doctor", "hospital", "clínica", "salud", "consulta", "medicina", "revisión"]
    },
    {
      emoji: "💼",
      keywords: ["trabajo", "reunión", "oficina", "entrevista", "cliente", "proyecto", "presentación", "negocio"]
    },
    {
      emoji: "🎂",
      keywords: ["cumpleaños", "aniversario", "celebración", "fiesta", "cumple"]
    },
    {
      emoji: "📞",
      keywords: ["llamar", "llamada", "teléfono", "contactar", "comunicar"]
    },
    {
      emoji: "💊",
      keywords: ["medicina", "pastilla", "remedio", "tomar", "tratamiento", "medicación"]
    },
    {
      emoji: "🛒",
      keywords: ["comprar", "compras", "supermercado", "tienda", "shopping"]
    },
    {
      emoji: "📚",
      keywords: ["estudiar", "estudio", "examen", "leer", "curso", "clase"]
    },
    {
      emoji: "⚽",
      keywords: ["partido", "juego", "fútbol", "deporte", "pelota", "cancha", "estadio"]
    },
    {
      emoji: "🍴",
      keywords: ["comer", "comida", "restaurante", "almuerzo", "cena", "desayuno"]
    },
    {
      emoji: "🔄",
      keywords: ["repetir", "recurrente", "diario", "semanal", "mensual"]
    }
  ];
  
  // Buscar coincidencias
  for (const category of categories) {
    if (category.keywords.some(keyword => lowercaseTitle.includes(keyword))) {
      return category.emoji;
    }
  }
  
  // Emoji predeterminado
  return "🔔";
}

module.exports = {
  startScheduler,
  checkReminders
};

