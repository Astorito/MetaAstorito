const axios = require('axios');
const { sendWhatsAppMessage } = require('./whatsapp');
const { getContext, saveContext } = require('./context');
const { updateWeatherContext } = require('./userContext');

/**
 * Extrae la ciudad de una consulta de clima
 */
function extractCityFromQuery(query) {
  // Patrones ampliados para identificar ciudades
  const patterns = [
    /(?:clima|tiempo|temperatura|pron[oó]stico)(?:\s+en|\s+de|\s+para)?\s+([a-zA-ZáéíóúÁÉÍÓÚñÑ\s]+?)(?:\s+para|\s+el|\s+hoy|\s+mañana|\?|$)/i,
    /(?:como esta|estara|va a estar|hay|habrá)(?:\s+el clima|\s+el tiempo|\s+la temperatura)?(?:\s+en|\s+de|\s+para)?\s+([a-zA-ZáéíóúÁÉÍÓÚñÑ\s]+?)(?:\s+para|\s+el|\s+hoy|\s+mañana|\?|$)/i,
    /(?:lloverá|llueve|nevará|nieva|hace calor|hace frio)(?:\s+en)?\s+([a-zA-ZáéíóúÁÉÍÓÚñÑ\s]+?)(?:\s+para|\s+el|\s+hoy|\s+mañana|\?|$)/i
  ];

  for (const pattern of patterns) {
    const match = query.match(pattern);
    if (match && match[1]) {
      return match[1].trim();
    }
  }
  
  return null;
}

/**
 * Extrae información de fecha de una consulta de clima
 */
function extractDateFromQuery(query) {
  // Si contiene "pronóstico" o "pronóstico del tiempo", mostrar varios días por defecto
  if (/pron[óo]stico|pron[óo]stico del tiempo|previsi[óo]n|previsi[óo]n del tiempo/i.test(query)) {
    return {
      days: 3,
      label: "próximos días"
    };
  }
  
  // Por defecto, el clima es para hoy
  let days = 0;
  let label = "hoy";
  
  // Buscar referencias a mañana
  if (/mañana|manana/i.test(query)) {
    days = 1;
    label = "mañana";
  } 
  // Buscar referencias a días específicos (pasado mañana, en 2 días, etc)
  else if (/pasado\s+mañana|pasado\s+manana/i.test(query)) {
    days = 2;
    label = "pasado mañana";
  }
  // Buscar referencias a "próximos días" o "varios días"
  else if (/proxim(o|a)s\s+d(i|í)as|varios\s+d(i|í)as|siguientes\s+d(i|í)as|fin\s+de\s+semana/i.test(query)) {
    days = 3; // Mostrar pronóstico para 3 días
    label = "próximos días";
  }
  
  return { days, label };
}

/**
 * Formatea un mensaje de clima a partir de los datos de wttr.in
 */
function formatWeatherMessageFromWttr(data, city, dateInfo) {
  try {
    // Determinar qué día mostrar según dateInfo.days
    const currentCondition = data.current_condition[0];
    
    // Para consultas de múltiples días
    if (dateInfo.label === "próximos días") {
      let message = `🌤️ *Pronóstico para ${city}:*\n\n`;
      
      // Agregar información para cada día (hoy y los siguientes)
      for (let i = 0; i < Math.min(data.weather.length, 3); i++) {
        const day = data.weather[i];
        const date = new Date(day.date);
        const dayName = date.toLocaleDateString('es-ES', { weekday: 'long' });
        
        // Traducir descripción y eliminar el emoji extra (solo dejar el texto)
        const description = translateWeatherDescription(day.hourly[4].weatherDesc[0].value);
        
        message += `*${dayName}:* ${description}\n`;
        message += `🌡️ Max: ${day.maxtempC}°C\n`;
        message += `🌡️ Min: ${day.mintempC}°C\n`;
        message += `☔ Lluvia: ${day.hourly[4].chanceofrain}%\n\n`;
      }
      
      return message.trim();
    } 
    // Para consultas de un día específico
    else {
      const dayIndex = Math.min(dateInfo.days, data.weather.length - 1);
      const day = data.weather[dayIndex];
      
      // Usar datos actuales para hoy, o pronóstico para días futuros
      let tempC, description, chanceOfRain, windspeedKmph;
      
      if (dayIndex === 0) {
        // Datos actuales para hoy
        tempC = currentCondition.temp_C;
        // Traducir descripción y eliminar el emoji extra (solo dejar el texto)
        description = translateWeatherDescription(currentCondition.weatherDesc[0].value);
        chanceOfRain = day.hourly[4].chanceofrain;
        windspeedKmph = currentCondition.windspeedKmph;
      } else {
        // Datos del pronóstico para días futuros (usar mediodía)
        tempC = day.hourly[4].tempC;
        // Traducir descripción y eliminar el emoji extra (solo dejar el texto)
        description = translateWeatherDescription(day.hourly[4].weatherDesc[0].value);
        chanceOfRain = day.hourly[4].chanceofrain;
        windspeedKmph = day.hourly[4].windspeedKmph;
      }
      
      let message = `🌤️ Clima en ${city} para ${dateInfo.label}: ${description}\n\n`;
      message += `🌡️ Max: ${day.maxtempC}°C\n`;
      message += `🌡️ Min: ${day.mintempC}°C\n`;
      message += `☔ Lluvia: ${chanceOfRain}%\n`;
      message += `💨 Viento: ${windspeedKmph} km/h`;
      
      return message;
    }
    
  } catch (error) {
    console.error('Error formateando mensaje de clima:', error);
    return `No pude procesar la información del clima para ${city}.`;
  }
}

/**
 * Traduce descripciones del clima de inglés a español
 */
function translateWeatherDescription(description) {
  const translations = {
    // Traducciones existentes
    'clear': 'Despejado',
    'sunny': 'Soleado',
    'partly cloudy': 'Parcialmente nublado',
    'cloudy': 'Nublado',
    'overcast': 'Cubierto',
    'mist': 'Niebla ligera',
    'fog': 'Niebla',
    'light rain': 'Lluvia ligera',
    'patchy rain possible': 'Posibilidad de lluvia dispersa',
    'rain': 'Lluvia',
    'moderate rain': 'Lluvia moderada',
    'heavy rain': 'Lluvia fuerte',
    'light snow': 'Nieve ligera',
    'snow': 'Nieve',
    'heavy snow': 'Nevada fuerte',
    'thunderstorm': 'Tormenta eléctrica',
    'storm': 'Tormenta',
    'freezing rain': 'Lluvia helada',
    
    // Nuevas traducciones
    'drizzle': 'Llovizna',
    'light drizzle': 'Llovizna ligera',
    'moderate drizzle': 'Llovizna moderada',
    'heavy drizzle': 'Llovizna intensa',
    'patchy light drizzle': 'Llovizna ligera dispersa',
    'patchy light rain': 'Lluvia ligera dispersa',
    'patchy moderate rain': 'Lluvia moderada dispersa',
    'patchy heavy rain': 'Lluvia fuerte dispersa',
    'patchy snow': 'Nevada dispersa',
    'patchy sleet': 'Aguanieve dispersa',
    'sleet': 'Aguanieve',
    'ice': 'Hielo',
    'heavy cloud': 'Muy nublado',
    'light cloud': 'Ligeramente nublado',
    'showers': 'Chubascos',
    'light showers': 'Chubascos ligeros',
    'shower': 'Chubasco',
    'mostly cloudy': 'Mayormente nublado',
    'broken clouds': 'Nubes dispersas',
    'few clouds': 'Pocas nubes',
    'scattered clouds': 'Nubes aisladas',
    'haze': 'Calima',
    'smoke': 'Humo',
    'dust': 'Polvo',
    'sand': 'Arena',
    'hail': 'Granizo',
    'thundery outbreaks': 'Brotes tormentosos'
  };
  
  // Verificar si la descripción está en inglés y traducirla
  const lowerDescription = description.toLowerCase();
  
  // Primero intentar una coincidencia exacta
  if (translations[lowerDescription]) {
    return translations[lowerDescription];
  }
  
  // Si no hay coincidencia exacta, buscar coincidencias parciales
  for (const [english, spanish] of Object.entries(translations)) {
    if (lowerDescription.includes(english.toLowerCase())) {
      return spanish;
    }
  }
  
  // Si no se encontró traducción, devolver la descripción original
  return description;
}

/**
 * Maneja consultas relacionadas con el clima
 */
async function handleWeatherQuery(message, phone) {
  try {
    console.log(`🌤️ Procesando consulta de clima: "${message}" de ${phone}`);
    
    let city = extractCityFromQuery(message);
    
    // Si se extrajo una ciudad, actualizar el contexto
    if (city) {
      await updateWeatherContext(phone, city);
    }
    
    // Determinar para qué día es la consulta
    const dateInfo = extractDateFromQuery(message);
    console.log(`📅 Consulta de clima ${dateInfo.label} para ${city}`);
    
    // Guardar contexto con la ciudad actual
    saveContext(phone, { 
      lastCity: city,
      lastTopic: "clima" 
    });
    
    // Usar wttr.in
    console.log(`🔍 Consultando clima para ${city} con wttr.in`);
    
    // Asegurarnos de usar Spanish y obtener 3 días de pronóstico
    const response = await axios.get(`https://wttr.in/${encodeURIComponent(city)}?format=j1&lang=es&days=3`);
    
    // Enviar mensaje formateado
    const weatherMessage = formatWeatherMessageFromWttr(response.data, city, dateInfo);
    await sendWhatsAppMessage(phone, weatherMessage);
    
    console.log(`✅ Información del clima enviada para ${city} ${dateInfo.label}`);
    
  } catch (error) {
    console.error('❌ Error consultando el clima:', error.message);
    
    // Error genérico
    await sendWhatsAppMessage(phone, `No pude obtener el clima para esa ubicación. Intenta con otra ciudad o verifica el nombre.`);
  }
}

module.exports = {
  handleWeatherQuery,
  extractCityFromQuery,
  extractDateFromQuery
};
