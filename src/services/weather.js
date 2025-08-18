const axios = require('axios');
const { sendWhatsAppMessage } = require('./whatsapp');
const { saveContext, getContext } = require('./context');
const { DateTime } = require('luxon');

// Función para traducir descripciones del clima al español si vienen en inglés
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
    console.log(`🔤 Traduciendo: "${description}" → "${translations[lowerDescription]}"`);
    return translations[lowerDescription];
  }
  
  // Si no hay coincidencia exacta, buscar coincidencias parciales
  for (const [english, spanish] of Object.entries(translations)) {
    if (lowerDescription.includes(english.toLowerCase())) {
      console.log(`🔤 Traduciendo (parcial): "${description}" → "${spanish}"`);
      return spanish;
    }
  }
  
  // Si no se encontró traducción, registrarlo y devolver la descripción original
  console.log(`⚠️ Sin traducción para: "${description}"`);
  return description;
}

// Función para determinar el emoji según la descripción del clima
function getWeatherEmoji(description) {
  const desc = description.toLowerCase();
  
  if (desc.includes("lluvia") || desc.includes("llovizna") || desc.includes("precipita")) {
    return "🌧️";
  } else if (desc.includes("tormenta")) {
    return "⛈️";
  } else if (desc.includes("nieve")) {
    return "❄️";
  } else if (desc.includes("niebla") || desc.includes("bruma")) {
    return "🌫️";
  } else if (desc.includes("nub")) {
    return "☁️";
  } else if (desc.includes("sol") || desc.includes("despejado") || desc.includes("clear")) {
    return "☀️";
  }
  
  // Emoji predeterminado
  return "🌤️";
}

// Detectar qué día está consultando el usuario
function extractDateFromQuery(text) {
  text = text.toLowerCase();
  
  if (text.includes("proximos 3 dias") || text.includes("próximos 3 días") || 
      text.includes("proximos tres dias") || text.includes("próximos tres días") || 
      text.includes("3 dias siguientes") || text.includes("tres dias siguientes")) {
    return { day: -1, label: "para los próximos 3 días", multiDay: true };
  } else if (text.includes("mañana")) {
    return { day: 1, label: "para mañana" };
  } else if (text.includes("pasado mañana")) {
    return { day: 2, label: "para pasado mañana" };
  } else if (text.match(/para el (lunes|martes|miércoles|miercoles|jueves|viernes|sábado|sabado|domingo)/i)) {
    // Si menciona un día específico, lo marcamos como futura referencia
    return { day: 0, label: "para el " + text.match(/para el (lunes|martes|miércoles|miercoles|jueves|viernes|sábado|sabado|domingo)/i)[1] };
  } else {
    // Por defecto es hoy
    return { day: 0, label: "para hoy" };
  }
}

// Función para formatear pronóstico de múltiples días
function formatMultiDayForecast(data, city) {
  try {
    let forecast = `🌤️ Clima en ${city} para los próximos 3 días:\n\n`;
    
    // Procesar cada día del pronóstico (hasta 3 días)
    const daysToShow = Math.min(data.weather.length, 3);
    
    for (let i = 0; i < daysToShow; i++) {
      const dayData = data.weather[i];
      const date = DateTime.fromFormat(dayData.date, 'yyyy-MM-dd');
      const dayName = date.toFormat('cccc', { locale: 'es' });
      const maxTemp = dayData.maxtempC;
      const minTemp = dayData.mintempC;
      
      // Usar datos del mediodía para el pronóstico
      const noonData = dayData.hourly[4]; // índice 4 = mediodía aprox
      let description = noonData.weatherDesc[0].value;
      const windSpeed = Math.round(noonData.windspeedKmph);
      const rainProb = noonData.chanceofrain || "0";
      
      // Asegurarnos que la descripción esté en español
      description = translateWeatherDescription(description);
      
      // Determinar emoji según descripción
      let emoji = getWeatherEmoji(description);
      
      // Formatear día
      forecast += `📅 *${dayName.charAt(0).toUpperCase() + dayName.slice(1)}*\n`;
      forecast += `${emoji} ${description}\n`;
      forecast += `🌡️ Max: ${maxTemp}°C / Min: ${minTemp}°C\n`;
      forecast += `☔ Lluvia: ${rainProb}%\n`;
      forecast += `💨 Viento: ${windSpeed} km/h\n\n`;
    }
    
    return forecast;
  } catch (error) {
    console.error('Error formateando pronóstico multi-día:', error);
    return `🌤️ *Clima en ${city}*\n\nNo pude obtener el pronóstico de varios días.`;
  }
}

// Formato para el mensaje de clima usando wttr.in
function formatWeatherMessageFromWttr(data, city, dateInfo) {
  try {
    // Si es una solicitud de pronóstico para varios días
    if (dateInfo.multiDay) {
      return formatMultiDayForecast(data, city);
    }
    
    // Determinar qué día del pronóstico usar (0=hoy, 1=mañana, etc.)
    const dayIndex = dateInfo.day;
    
    // Verificar si tenemos datos para ese día
    if (!data.weather || !data.weather[dayIndex]) {
      throw new Error(`No hay datos disponibles para ${dateInfo.label}`);
    }
    
    const dayData = data.weather[dayIndex];
    const maxTemp = dayData.maxtempC;
    const minTemp = dayData.mintempC;
    
    // Para el día actual podemos usar current_condition
    // Para los demás días usamos el pronóstico del mediodía
    let description, windSpeed, rainProb;
    
    if (dayIndex === 0) {
      // Datos del día actual
      const current = data.current_condition[0];
      description = current.weatherDesc[0].value;
      windSpeed = Math.round(current.windspeedKmph);
      
      // Buscar probabilidad de lluvia para las próximas horas
      const hourIndex = Math.floor(new Date().getHours() / 3);
      rainProb = dayData.hourly[hourIndex]?.chanceofrain || "0";
    } else {
      // Datos de días futuros (usamos el mediodía como referencia)
      const noonData = dayData.hourly[4]; // índice 4 = mediodía aprox
      description = noonData.weatherDesc[0].value;
      windSpeed = Math.round(noonData.windspeedKmph);
      rainProb = noonData.chanceofrain || "0";
    }
    
    // Asegurar que la descripción esté en español
    description = translateWeatherDescription(description);
    
    // Determinar emoji según descripción
    let emoji = getWeatherEmoji(description);
    
    // Construir mensaje con el nuevo formato - siempre incluimos el dayLabel
    return `${emoji} Clima en ${city} ${dateInfo.label}: ☁️ ${description}\n\n` +
           `🌡️ Max: ${maxTemp}°C\n` +
           `🌡️ Min: ${minTemp}°C\n` +
           `☔ Lluvia: ${rainProb}%\n` +
           `💨 Viento: ${windSpeed} km/h`;
  } catch (error) {
    console.error('Error formateando respuesta de wttr.in:', error);
    return `🌤️ *Clima en ${city}*\n\nNo pude obtener la información completa ${dateInfo.label}.`;
  }
}

// Extraer la ciudad del mensaje
function extractCityFromQuery(text) {
  // Intentar extraer ciudad con patrones comunes
  const cityPatterns = [
    /en\s+([A-Za-zÁÉÍÓÚáéíóúÑñ\s]+?)(?:\?|$|hoy|mañana|el\s+|la\s+|para)/i,
    /para\s+([A-Za-zÁÉÍÓÚáéíóúÑñ\s]+?)(?:\?|$|hoy|mañana|el\s+|la\s+)/i,
    /de\s+([A-Za-zÁÉÍÓÚáéíóúÑñ\s]+?)(?:\?|$|hoy|mañana|el\s+|la\s+)/i,
    /clima(?:\s+en)?\s+([A-Za-zÁÉÍÓÚáéíóúÑñ\s]+?)(?:\?|$|hoy|mañana)/i,
  ];
  
  for (const pattern of cityPatterns) {
    const match = text.match(pattern);
    if (match && match[1]) {
      return match[1].trim();
    }
  }
  
  // Si no encuentra con los patrones, devolver el texto mismo como posible ciudad
  return text.trim();
}

// Función principal para manejar consulta de clima
async function handleWeatherQuery(message, phone) {
  try {
    console.log(`🌤️ Procesando consulta de clima: "${message}" de ${phone}`);
    
    let city;
    const context = getContext(phone);
    
    // Detectar si es una pregunta de seguimiento - EXPRESIÓN REGULAR MEJORADA
    const isFollowUpQuestion = /^(y|que tal|como esta|cómo está|va a|va a estar|hay|estará|estara)?\s*(hoy|mañana|ahora|esta tarde|esta noche|pasado mañana|proximos dias|próximos días|siguiente semana|la semana que viene)?\??$/i.test(message.trim()) || 
    // Esta segunda parte detecta patrones como "Y en los próximos días?"
    /^y\s+(en|para)\s+(los|el|la|las)?\s*(próximos?|proximos?|siguientes?|resto de los)?\s*(dias?|semanas?|horas?).*$/i.test(message.trim());
    
    if (isFollowUpQuestion && context && context.lastCity) {
      // Si es pregunta de seguimiento y tenemos contexto, usar la ciudad del contexto
      city = context.lastCity;
      console.log(`🧠 Usando ciudad del contexto: ${city}`);
      
      // Si la pregunta es sobre "próximos días" pero no lo especifica explícitamente,
      // forzar el modo de pronóstico de múltiples días
      if (message.toLowerCase().includes("proxim") || 
          message.toLowerCase().includes("próxim") ||
          message.toLowerCase().includes("siguient")) {
        // Forzar consulta de múltiples días
        message = `clima en ${city} para los próximos 3 días`;
        console.log(`🔄 Reformulando consulta: "${message}"`);
      }
    } else {
      // Si no, intentar extraer ciudad del mensaje
      city = extractCityFromQuery(message);
      
      // Si no se pudo extraer ciudad, pedir al usuario
      if (!city || city.length < 2) {
        return await sendWhatsAppMessage(phone, "¿Para qué ciudad quieres saber el clima?");
      }
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
  handleWeatherQuery
};
