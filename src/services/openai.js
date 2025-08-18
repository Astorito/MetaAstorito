// Importar las dependencias necesarias
const OpenAI = require('openai');
const { DateTime } = require('luxon');
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
    // Obtener la fecha actual para pasarla como contexto
    const today = DateTime.now().toFormat('yyyy-MM-dd');
    const currentTime = DateTime.now().toFormat('HH:mm');
    
    const response = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [
        {
          role: "system",
          content: `Extrae los detalles del recordatorio del mensaje del usuario.
          HOY ES: ${today} y la hora actual es ${currentTime}.
          
          Cuando el usuario mencione palabras como "hoy", "mañana", "pasado mañana", etc.,
          resuelve a la fecha correcta basándote en la fecha actual proporcionada.
          
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
      const parsed = JSON.parse(jsonMatch[0]);
      
      // Verificación adicional para fechas relativas
      if (parsed.type === "reminder" && parsed.data && parsed.data.date) {
        // Verificar si la fecha parece incorrecta
        const eventDate = DateTime.fromISO(parsed.data.date);
        const currentDate = DateTime.now();
        
        // Si la fecha es más de 60 días en el pasado o más de 365 días en el futuro, probablemente es incorrecta
        if (eventDate < currentDate.minus({days: 60}) || eventDate > currentDate.plus({days: 365})) {
          console.warn("⚠️ Fecha sospechosa detectada:", parsed.data.date);
          
          // Si el mensaje contiene "hoy", usar la fecha actual
          if (text.toLowerCase().includes("hoy")) {
            parsed.data.date = currentDate.toFormat("yyyy-MM-dd");
            console.log("🔄 Corrigiendo fecha a HOY:", parsed.data.date);
          } 
          // Si contiene "mañana", usar mañana
          else if (text.toLowerCase().includes("mañana") || text.toLowerCase().includes("manana")) {
            parsed.data.date = currentDate.plus({days: 1}).toFormat("yyyy-MM-dd");
            console.log("🔄 Corrigiendo fecha a MAÑANA:", parsed.data.date);
          }
        }
      }
      
      return parsed;
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
