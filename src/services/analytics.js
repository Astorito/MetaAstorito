/**
 * Módulo para registrar interacciones de usuario
 */

/**
 * Registra una interacción entrante del usuario
 * @param {string} from - Número de teléfono del remitente
 * @param {string} messageType - Tipo de mensaje (text, audio, etc)
 * @param {string} content - Contenido del mensaje
 */
async function logIncomingInteraction(from, messageType, content) {
  console.log(`�� [ANALYTICS] Interacción entrante: ${from}, tipo: ${messageType}`);
  // En una implementación real, aquí guardaríamos en MongoDB
}

/**
 * Registra una interacción saliente del bot
 * @param {string} to - Número de teléfono del destinatario
 * @param {string} content - Contenido del mensaje enviado
 * @param {string} category - Categoría del mensaje (CLIMA, RECORDATORIO, etc)
 */
async function logOutgoingInteraction(to, content, category = "") {
  console.log(`📊 [ANALYTICS] Interacción saliente: ${to}, categoría: ${category || "sin categoría"}`);
  // En una implementación real, aquí guardaríamos en MongoDB
}

module.exports = {
  logIncomingInteraction,
  logOutgoingInteraction
};
