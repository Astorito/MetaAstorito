const emojiMap = {
  // Salud
  "doctor": "👨‍⚕️",
  "medico": "👨‍⚕️",
  "hospital": "🏥",
  "dentista": "🦷",
  "medicina": "💊",
  "farmacia": "💊",

  // Eventos y Recordatorios
  "recordar": "⏰",
  "recordatorio": "⏰",
  "alarma": "⚠️",
  "evento": "📅",
  "cita": "📅",
  "cumple": "🎂",
  "cumpleaños": "🎂",
  "torta": "🎂",
  "aniversario": "💝",
  
  // Transporte
  "buscar": "🚗",
  "auto": "🚗",
  "recoger": "🚗",
  "llevar": "🚗",
  "aeropuerto": "✈️",
  "vuelo": "✈️",
  "tren": "🚂",
  "taxi": "🚕",

  // Trabajo y Estudio
  "reunion": "💼",
  "reunión": "💼",
  "clase": "📚",
  "curso": "📚",
  "estudiar": "📚",
  "facu": "📚",
  "examen": "📝",
  "trabajo": "💼",
  "presentacion": "📊",
  "presentación": "📊",
  
  // Deportes y Ocio
  "fulbo": "⚽",
  "fulbito": "⚽",
  "pelota": "⚽",
  "partido": "⚽",
  "fiesta": "🎉",
  "cine": "🎬",
  "pelicula": "🎬",
  "teatro": "🎭",
  "concierto": "🎵",
  "gimnasio": "💪",
  
  // Comidas
  "almuerzo": "🍽️",
  "comer": "🍽️",
  "cena": "🍽️",
  "desayuno": "☕",
  "cafe": "☕",
  "café": "☕",
  "restaurant": "🍽️",
  "restaurante": "🍽️",
  
  // Pagos y Compras
  "pagar": "💰",
  "comprar": "🛒",
  "banco": "🏦",
  "mercado": "🛒",
  "supermercado": "🛒",
  "factura": "💸",
  
  // Comunicación
  "llamar": "📱",
  "mensaje": "✉️",
  "email": "📧",
  "correo": "📧",
  "videollamada": "📹",
  "zoom": "💻",
  "meet": "💻",

  // Por defecto
  "default": "📅"
};

function findBestEmoji(title) {
  const words = title.toLowerCase().split(/\s+/);
  
  for (const word of words) {
    if (emojiMap[word]) return emojiMap[word];
  }
  
  for (const [key, emoji] of Object.entries(emojiMap)) {
    if (words.some(word => word.includes(key) || key.includes(word))) {
      return emoji;
    }
  }
  
  return emojiMap.default;
}

module.exports = { findBestEmoji };