const axios = require("axios");
const { sendWhatsAppMessage } = require("./whatsapp");

// Usa siempre gpt-3.5-turbo
async function parseWeatherWithGPT(text) {
  try {
    const systemPrompt = `
Eres un asistente que analiza consultas sobre el clima en español.
Debes responder SOLO con un JSON que indique:
- type: "current" si es clima actual, o "forecast" si pide pronóstico.
- city: nombre de la ciudad.
- days_ahead: número de días desde hoy para el que se pide el clima (0 = hoy, 1 = mañana, etc.).
Si no se especifica el día, usar 0 para "current" y 0 para "forecast".
Ejemplos:
"Clima en Madrid ahora" -> {"type":"current","city":"Madrid","days_ahead":0}
"¿Va a llover en Roma mañana?" -> {"type":"forecast","city":"Roma","days_ahead":1}
"Pronóstico de París para el fin de semana" -> {"type":"forecast","city":"París","days_ahead":2}
Texto a analizar: "${text}"
    `;

    const { data } = await axios.post(
      "https://api.openai.com/v1/chat/completions",
      {
        model: "gpt-3.5-turbo",
        messages: [{ role: "system", content: systemPrompt }],
        temperature: 0
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
          "Content-Type": "application/json"
        }
      }
    );

    return JSON.parse(data.choices[0].message.content.trim());
  } catch (err) {
    console.error("Error parseando clima con GPT:", err.message);
    return null;
  }
}

// Busca coordenadas usando la API de Open-Meteo
async function getCoordinates(city) {
  try {
    const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=es&format=json`;
    const { data } = await axios.get(url);
    if (data.results && data.results.length > 0) {
      const c = data.results[0];
      return { lat: c.latitude, lon: c.longitude, name: c.name, country: c.country };
    }
    return null;
  } catch (err) {
    return null;
  }
}

// Clima actual
async function getCurrentWeather(lat, lon, cityName, country) {
  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current_weather=true&timezone=auto`;
    const { data } = await axios.get(url);
    if (!data.current_weather) return "No pude obtener el clima ahora mismo";
    const temp = data.current_weather.temperature;
    const wind = data.current_weather.windspeed;
    return `🌤️ Clima en ${cityName}, ${country}:\n🌡️ Temp: ${temp}°C\n💨 Viento: ${wind} km/h`;
  } catch (err) {
    return "No pude obtener el clima ahora mismo";
  }
}

// Pronóstico
function formatDate(dateStr) {
  const date = new Date(dateStr);
  return date.toLocaleDateString("es-AR", { weekday: "long", day: "numeric", month: "long" });
}

async function getForecast(lat, lon, cityName, country, daysAhead = 0) {
  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=auto`;
    const { data } = await axios.get(url);

    if (!data.daily) return "No pude obtener el pronóstico";

    if (daysAhead > 0 && daysAhead < data.daily.time.length) {
      return `📅 Pronóstico para ${cityName}, ${country} (${formatDate(data.daily.time[daysAhead])}):\n` +
             `🌡️ Max: ${data.daily.temperature_2m_max[daysAhead]}°C\n` +
             `🌡️ Min: ${data.daily.temperature_2m_min[daysAhead]}°C\n` +
             `☔ Lluvia: ${data.daily.precipitation_probability_max[daysAhead]}%`;
    }

    // Si no, mostramos próximos 3 días
    let forecastMsg = `📅 Pronóstico para ${cityName}, ${country}:\n`;
    for (let i = 0; i < 3; i++) {
      forecastMsg += `\n${formatDate(data.daily.time[i])}:\n` +
                     `🌡️ Max: ${data.daily.temperature_2m_max[i]}°C\n` +
                     `🌡️ Min: ${data.daily.temperature_2m_min[i]}°C\n` +
                     `☔ Lluvia: ${data.daily.precipitation_probability_max[i]}%`;
    }
    return forecastMsg;
  } catch (err) {
    return "No pude obtener el pronóstico";
  }
}

// Handler principal de clima
async function handleWeatherQuery(messageText, from) {
  const parsed = await parseWeatherWithGPT(messageText);
  if (!parsed) {
    await sendWhatsAppMessage(from, "No pude entender tu consulta de clima");
    return true;
  }
  if (!parsed.city) {
    await sendWhatsAppMessage(from, "¿Para qué ciudad querés saber el clima?");
    return true;
  }

  const coords = await getCoordinates(parsed.city);
  if (!coords) {
    await sendWhatsAppMessage(from, `No pude encontrar la ciudad "${parsed.city}"`);
    return true;
  }

  let reply;
  if (parsed.type === "current") {
    reply = await getCurrentWeather(coords.lat, coords.lon, coords.name, coords.country);
  } else {
    reply = await getForecast(coords.lat, coords.lon, coords.name, coords.country, parsed.days_ahead);
  }

  await sendWhatsAppMessage(from, reply);
  return true;
}

module.exports = { handleWeatherQuery };