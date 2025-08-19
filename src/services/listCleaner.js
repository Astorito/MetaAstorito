const List = require('../models/list');
const { DateTime } = require('luxon');
const cron = require('node-cron');

/**
 * Elimina listas que tienen más de 7 días de antigüedad
 */
async function cleanOldLists() {
  try {
    const oneWeekAgo = DateTime.now().minus({ days: 7 }).toJSDate();
    console.log(`🧹 Iniciando limpieza de listas antiguas (antes de ${oneWeekAgo.toISOString()})`);
    
    // Buscar y eliminar listas antiguas
    const result = await List.deleteMany({ 
      createdAt: { $lt: oneWeekAgo } 
    });
    
    console.log(`✅ Limpieza completada: ${result.deletedCount} listas eliminadas`);
  } catch (error) {
    console.error('❌ Error durante la limpieza de listas:', error);
  }
}

/**
 * Inicia el scheduler para limpiar listas antiguas una vez por semana
 */
function startListCleanerScheduler() {
  // Ejecutar todos los domingos a las 3am
  cron.schedule('0 3 * * 0', async () => {
    console.log('🕒 Ejecutando limpieza semanal de listas antiguas');
    await cleanOldLists();
  });
  
  console.log('📋 Scheduler de limpieza de listas inicializado');
}

module.exports = {
  cleanOldLists,
  startListCleanerScheduler
};