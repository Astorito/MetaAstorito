/**
 * Servicio para manejar el contexto de las conversaciones
 */

// Almacenamiento en memoria del contexto por usuario
// { phoneNumber: { lastCity, lastTopic, timestamp } }
const conversationContext = {};

// Tiempo de expiración del contexto (15 minutos en ms)
const CONTEXT_EXPIRY = 15 * 60 * 1000; 

/**
 * Guarda el contexto de la conversación para un usuario
 */
function saveContext(phone, context) {
  conversationContext[phone] = {
    ...context,
    timestamp: Date.now()
  };
  console.log(`🧠 Contexto guardado para ${phone}:`, context);
}

/**
 * Obtiene el contexto de conversación para un usuario
 */
function getContext(phone) {
  const context = conversationContext[phone];
  
  // Si no hay contexto, retornar null
  if (!context) return null;
  
  // Verificar si el contexto ha expirado
  if (Date.now() - context.timestamp > CONTEXT_EXPIRY) {
    console.log(`⏰ Contexto expirado para ${phone}`);
    delete conversationContext[phone];
    return null;
  }
  
  // Actualizar timestamp para mantener el contexto "fresco"
  context.timestamp = Date.now();
  return context;
}

/**
 * Limpia el contexto de un usuario específico
 */
function clearContext(phone) {
  delete conversationContext[phone];
  console.log(`🧹 Contexto eliminado para ${phone}`);
}

module.exports = {
  saveContext,
  getContext,
  clearContext
};
