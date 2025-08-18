// Importar las dependencias necesarias
const OpenAI = require('openai');
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// Clasificar el tipo de mensaje
async function classifyMessage(text) {
  try {
    const response = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [
        {
          role: "system",
          content: `Eres un asistente que clasifica mensajes en categorías específicas. 
          Categoriza el mensaje del usuario EXACTAMENTE en una de estas categorías:
          - CLIMA: Si pregunta sobre el clima, temperatura, lluvia, pronóstico, etc.
          - RECORDATORIO: Si quiere crear un recordatorio, agendar una cita o evento.
          - GENERALQUERY: Para cualquier otra consulta general.
          Responde ÚNICAMENTE con la categoría en mayúsculas, sin explicaciones adicionales.`
        },
        { role: "user", content: text }
      ],
      max_tokens: 10
    });
    
    // Obtener solo la categoría (eliminar posibles espacios)
    const category = response.choices[0].message.content.trim();
    console.log(`🧠 Mensaje clasificado como: ${category}`);
    return category;
  } catch (error) {
    console.error('❌ Error clasificando mensaje:', error);
    return "GENERALQUERY"; // Por defecto
  }
}

// Obtener respuesta general de GPT (versión ULTRA corta)
async function getGPTResponse(prompt) {
  try {
    const response = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [
        {
          role: "system",
          content: "Eres un asistente extremadamente conciso. MÁXIMO 15 PALABRAS por respuesta. Sin introducciones ni conclusiones. Solo datos esenciales. Directo y preciso. Prioriza brevedad absoluta sobre cualquier otra consideración."
        },
        { role: "user", content: prompt }
      ],
      max_tokens: 60, // Reducido para forzar respuestas más cortas
      temperature: 0.3 // Reducida para respuestas más predecibles y concretas
    });
    
    return response.choices[0].message;
  } catch (error) {
    console.error('Error en OpenAI API:', error);
    throw error;
  }
}

// Analizar recordatorio con OpenAI
async function parseReminderWithOpenAI(text) {
  try {
    const response = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [
        {
          role: "system",
          content: `Extrae los detalles del recordatorio del mensaje del usuario. 
          Devuelve un JSON con el siguiente formato:
          {
            "type": "reminder",
            "data": {
              "title": "Título o descripción del evento",
              "date": "YYYY-MM-DD", (fecha del evento)
              "time": "HH:MM", (hora del evento en formato 24h)
              "notify": "X horas/minutos antes" (cuánto tiempo antes avisar)
            }
          }
          Si no es posible extraer algún campo, déjalo como null. Si no es un recordatorio, devuelve {"type": "unknown"}`
        },
        { role: "user", content: text }
      ]
    });
    
    // Extraer el JSON de la respuesta
    const content = response.choices[0].message.content;
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    } else {
      return { type: "unknown" };
    }
  } catch (error) {
    console.error('Error extrayendo recordatorio:', error);
    return { type: "unknown" };
  }
}

module.exports = {
  getGPTResponse,
  parseReminderWithOpenAI,
  classifyMessage
};
