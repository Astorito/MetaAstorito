const UserContext = require('../models/userContext');

/**
 * Obtiene el contexto de un usuario
 * @param {string} phone - Número de teléfono del usuario
 * @returns {Promise<Object|null>} - Contexto del usuario o null si no existe
 */
async function getUserContext(phone) {
  try {
    // Verificar si hay un contexto reciente (menos de 30 minutos)
    const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000);
    const context = await UserContext.findOne({
      phone,
      updatedAt: { $gt: thirtyMinutesAgo }
    });
    return context;
  } catch (error) {
    console.error('Error obteniendo contexto de usuario:', error);
    return null;
  }
}

/**
 * Actualiza el contexto de un usuario para listas
 * @param {string} phone - Número de teléfono del usuario
 * @param {string} listName - Nombre de la lista
 * @param {string} action - Acción realizada (crear, ver, actualizar)
 */
async function updateListContext(phone, listName, action = 'ver') {
  try {
    await UserContext.findOneAndUpdate(
      { phone },
      {
        lastService: 'listas',
        lastListName: listName,
        lastListAction: action,
        updatedAt: new Date()
      },
      { upsert: true }
    );
    console.log(`🧠 Contexto actualizado: usuario ${phone} usando lista "${listName}"`);
  } catch (error) {
    console.error('Error actualizando contexto de lista:', error);
  }
}

/**
 * Actualiza el contexto de un usuario para clima
 * @param {string} phone - Número de teléfono del usuario
 * @param {string} city - Ciudad consultada
 */
async function updateWeatherContext(phone, city) {
  try {
    await UserContext.findOneAndUpdate(
      { phone },
      {
        lastService: 'clima',
        lastCity: city,
        updatedAt: new Date()
      },
      { upsert: true }
    );
    console.log(`🧠 Contexto actualizado: usuario ${phone} consultando clima en "${city}"`);
  } catch (error) {
    console.error('Error actualizando contexto de clima:', error);
  }
}

/**
 * Actualiza el contexto de un usuario para recordatorios
 * @param {string} phone - Número de teléfono del usuario
 * @param {string} reminderTitle - Título del recordatorio
 */
async function updateReminderContext(phone, reminderTitle) {
  try {
    await UserContext.findOneAndUpdate(
      { phone },
      {
        lastService: 'recordatorio',
        lastReminderTitle: reminderTitle,
        updatedAt: new Date()
      },
      { upsert: true }
    );
    console.log(`🧠 Contexto actualizado: usuario ${phone} creando recordatorio "${reminderTitle}"`);
  } catch (error) {
    console.error('Error actualizando contexto de recordatorio:', error);
  }
}

/**
 * Limpia el contexto de un usuario (cambia a consulta general)
 * @param {string} phone - Número de teléfono del usuario
 */
async function clearUserContext(phone) {
  try {
    await UserContext.findOneAndUpdate(
      { phone },
      {
        lastService: 'generalquery',
        updatedAt: new Date()
      },
      { upsert: true }
    );
    console.log(`🧠 Contexto limpiado para usuario ${phone}`);
  } catch (error) {
    console.error('Error limpiando contexto de usuario:', error);
  }
}

module.exports = {
  getUserContext,
  updateListContext,
  updateWeatherContext,
  updateReminderContext,
  clearUserContext
};