const axios = require('axios');
const { sendWhatsAppMessage } = require('./whatsapp');
const { saveContext, getContext } = require('./context');

// Formato para el mensaje de clima
function formatWeatherMessage(data, city) {
  // Extraer datos principales
  const temp = Math.round(data.main.temp);
  const feels_like = Math.round(data.main.feels_like);
  const description = data.weather[0].description;
  const humidity = data.main.humidity;
  const windSpeed = Math.round(data.wind.speed * 3.6); // m/s a km/h
  
  // Determinar emoji según descripción
  let emoji = "🌤️";
  if (description.includes("lluvia") || description.includes("llovizna")) {
    emoji = "🌧️";
  } else if (description.includes("tormenta")) {
    emoji = "⛈️";
  } else if (description.includes("nieve")) {
    emoji = "❄️";
  } else if (description.includes("niebla") || description.includes("bruma")) {
    emoji = "🌫️";
  } else if (description.includes("nub")) {
    emoji = "☁️";
  } else if (description.includes("sol") || description.includes("despejado")) {
    emoji = "☀️";
  }
  
  // Construir mensaje
  return `${emoji} *Clima en ${city}*\n\n` +
         `Temperatura: ${temp}°C\n` +
         `Sensación térmica: ${feels_like}°C\n` +
         `Condición: ${description}\n` +
         `Humedad: ${humidity}%\n` +
         `Viento: ${windSpeed} km/h`;
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
    
    // Llamar a la API de OpenWeather
    const apiKey = process.env.OPENWEATHER_API_KEY;
    if (!apiKey) {
      console.error("❌ Falta API key de OpenWeather");
      return await sendWhatsAppMessage(phone, "Lo siento, no puedo consultar el clima en este momento.");
    }
    
    const response = await axios.get(`https://api.openweathermap.org/data/2.5/weather`, {
      params: {
        q: city,
        appid: apiKey,
        units: 'metric',
        lang: 'es'
      }
    });
    
    // Enviar mensaje formateado
    const weatherMessage = formatWeatherMessage(response.data, city);
    await sendWhatsAppMessage(phone, weatherMessage);
    
    console.log(`✅ Información del clima enviada para ${city}`);
    
  } catch (error) {
    console.error('❌ Error consultando el clima:', error.message);
    
    // Si es error 404, la ciudad no existe
    if (error.response && error.response.status === 404) {
      await sendWhatsAppMessage(phone, `No pude encontrar información para esa ciudad. ¿Podrías verificar el nombre?`);
    } else {
      await sendWhatsAppMessage(phone, `Ocurrió un error al consultar el clima. Intenta nuevamente más tarde.`);
    }
  }
}

module.exports = {
  handleWeatherQuery
};
