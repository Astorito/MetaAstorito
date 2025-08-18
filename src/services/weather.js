const axios = require('axios');
const { sendWhatsAppMessage } = require('./whatsapp');
const { saveContext, getContext } = require('./context');

// Formato para el mensaje de clima usando wttr.in
function formatWeatherMessageFromWttr(data, city) {
  try {
    // Extraer datos principales
    const current = data.current_condition[0];
    const temp = current.temp_C;
    const description = current.weatherDesc[0].value;
    const windSpeed = Math.round(current.windspeedKmph);
    
    // Extraer temperaturas máxima y mínima del día actual
    let maxTemp = "N/A";
    let minTemp = "N/A";
    if (data.weather && data.weather[0]) {
      maxTemp = data.weather[0].maxtempC;
      minTemp = data.weather[0].mintempC;
    }
    
    // Obtener probabilidad de lluvia (del pronóstico del día actual)
    let rainProb = "No disponible";
    if (data.weather && data.weather[0] && data.weather[0].hourly) {
      // Buscar la hora más cercana al momento actual
      const now = new Date();
      const currentHour = now.getHours();
      // Encontrar el índice de hora más cercana (cada 3 horas: 0, 3, 6, 9, 12, 15, 18, 21)
      const hourIndex = Math.floor(currentHour / 3);
      if (data.weather[0].hourly[hourIndex]) {
        rainProb = `${data.weather[0].hourly[hourIndex].chanceofrain}%`;
      }
    }
    
    // Determinar emoji según descripción
    let emoji = "🌤️";
    const desc = description.toLowerCase();
    if (desc.includes("lluvia") || desc.includes("llovizna")) {
      emoji = "🌧️";
    } else if (desc.includes("tormenta")) {
      emoji = "⛈️";
    } else if (desc.includes("nieve")) {
      emoji = "❄️";
    } else if (desc.includes("niebla") || desc.includes("bruma")) {
      emoji = "🌫️";
    } else if (desc.includes("nub")) {
      emoji = "☁️";
    } else if (desc.includes("sol") || desc.includes("despejado")) {
      emoji = "☀️";
    }
    
    // Construir mensaje con el nuevo formato
    return `${emoji} Clima en ${city}: ☁️ ${description}\n\n` +
           `🌡️ Max: ${maxTemp}°C\n` +
           `🌡️ Min: ${minTemp}°C\n` +
           `☔ Lluvia: ${rainProb}\n` +
           `💨 Viento: ${windSpeed} km/h`;
  } catch (error) {
    console.error('Error formateando respuesta de wttr.in:', error);
    return `🌤️ *Clima en ${city}*\n\nInformación disponible pero con formato limitado.`;
  }
}

// Extraer la ciudad del mensaje
function extractCityFromQuery(text) {
  // Intentar extraer ciudad con patrones comunes
  const cityPatterns = [
    /en\s+([A-Za-zÁÉÍÓÚáéíóúÑñ\s]+?)(?:\?|$|hoy|mañana|el\s+|la\s+)/i,
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
    
    // Guardar contexto con la ciudad actual
    saveContext(phone, { 
      lastCity: city,
      lastTopic: "clima" 
    });
    
    // Usar wttr.in en lugar de OpenWeather (sin API key)
    console.log(`🔍 Consultando clima para ${city} con wttr.in`);
    const response = await axios.get(`https://wttr.in/${encodeURIComponent(city)}?format=j1&lang=es`);
    
    // Enviar mensaje formateado
    const weatherMessage = formatWeatherMessageFromWttr(response.data, city);
    await sendWhatsAppMessage(phone, weatherMessage);
    
    console.log(`✅ Información del clima enviada para ${city}`);
    
  } catch (error) {
    console.error('❌ Error consultando el clima:', error.message);
    
    // Error genérico
    await sendWhatsAppMessage(phone, `No pude obtener el clima para esa ubicación. Intenta con otra ciudad o verifica el nombre.`);
  }
}

module.exports = {
  handleWeatherQuery
};
