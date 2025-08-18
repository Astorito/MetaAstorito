const axios = require('axios');
const { sendWhatsAppMessage } = require('./whatsapp');
const { saveContext, getContext } = require('./context');
const { DateTime } = require('luxon');

// Detectar qué día está consultando el usuario
function extractDateFromQuery(text) {
  text = text.toLowerCase();
  
  if (text.includes("mañana")) {
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

// Formato para el mensaje de clima usando wttr.in
function formatWeatherMessageFromWttr(data, city, dateInfo) {
  try {
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
    
    // Determinar emoji según descripción
    let emoji = "🌤️";
    const desc = description.toLowerCase();
    if (desc.includes("lluvia") || desc.includes("llovizna") || desc.includes("precipita")) {
      emoji = "🌧️";
    } else if (desc.includes("tormenta")) {
      emoji = "⛈️";
    } else if (desc.includes("nieve")) {
      emoji = "❄️";
    } else if (desc.includes("niebla") || desc.includes("bruma")) {
      emoji = "🌫️";
    } else if (desc.includes("nub")) {
      emoji = "☁️";
    } else if (desc.includes("sol") || desc.includes("despejado") || desc.includes("clear")) {
      emoji = "☀️";
    }
    
    // Construir mensaje con el nuevo formato
    const dayLabel = dateInfo.label === "para hoy" ? "" : ` ${dateInfo.label}`;
    
    return `${emoji} Clima en ${city}${dayLabel}: ☁️ ${description}\n\n` +
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
    
    // Detectar si es una pregunta de seguimiento como "¿y hoy?" o "¿y mañana?"
    const isFollowUpQuestion = /^(y|que tal|como esta|cómo está|va a|va a estar)?\s*(hoy|mañana|ahora|esta tarde|esta noche|pasado mañana)?\??$/i.test(message.trim());
    
    if (isFollowUpQuestion && context && context.lastCity) {
      // Si es pregunta de seguimiento y tenemos contexto, usar la ciudad del contexto
      city = context.lastCity;
      console.log(`🧠 Usando ciudad del contexto: ${city}`);
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
    
    // Usar wttr.in en lugar de OpenWeather (sin API key)
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
