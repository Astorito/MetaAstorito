const OpenAI = require('openai');
const { openaiToken } = require('../config/environment');
const { DateTime } = require('luxon');

const openai = new OpenAI({ apiKey: openaiToken });

async function getGPTResponse(text) {
  try {
    const response = await openai.chat.completions.create({
      model: model,
      messages: [
        {
          role: "system",
          content: "Eres un asistente ultra conciso. REGLAS IMPORTANTES:\n" +
            "1. Responde en máximo 2 líneas\n" +
            "2. No uses saludos ni despedidas\n" +
            "3. Ve directo al punto\n" +
            "4. Si la pregunta es sobre fecha u hora, responde solo el dato\n" +
            "5. Usa datos actuales y precisos"
        },
        { role: "user", content: text }
      ],
      temperature: 0.2,
      max_tokens: 60
    });

    return {
      type: "chat",
      content: response.choices[0].message.content.trim()
    };
  } catch (err) {
    console.error("Error consultando a GPT:", err);
    return {
      type: "error",
      content: "Disculpa, no pude procesar tu consulta."
    };
  }
}

async function parseReminderWithOpenAI(text) {
  // Verificar si solo tiene hora sin especificar AM/PM
  const timePattern = /\b(\d{1,2})(?::?(\d{2}))?\b/;
  const match = text.match(timePattern);
    
  if (match && !text.toLowerCase().includes('am') && 
      !text.toLowerCase().includes('pm') &&
      !text.toLowerCase().includes('tarde') &&
      !text.toLowerCase().includes('mañana') &&
      !text.toLowerCase().includes('noche')) {
      
    return {
      type: "confirm_time",
      data: {
        originalText: text,
        hour: match[1],
        minutes: match[2] || "00"
      },
      buttons: {
        title: "¿A qué hora del día?",
        buttons: ["Mañana", "Tarde"]
      }
    };
  }
  
  // Primero verificar si parece un recordatorio
  const reminderKeywords = [
    'recordar', 'recordame', 'avisame', 'agenda', 'agendar',
    'mañana', 'hoy', 'siguiente', 'proximo', 'próximo',
    'reunión', 'reunion', 'cita', 'evento', 'buscar',
    'a las', 'el dia', 'el día', 'avisar'
  ];

  const hasReminderKeywords = reminderKeywords.some(keyword => 
    text.toLowerCase().includes(keyword)
  );

  if (!hasReminderKeywords) {
    return await getGPTResponse(text);
  }

  try {
    const now = DateTime.now();
    const currentDate = now.toFormat('yyyy-MM-dd');

    const response = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [
        {
          role: "system",
          content: `Eres un asistente que extrae información de recordatorios en español.
          REGLAS ESTRICTAS PARA FECHAS Y HORAS:
          
          HOY ES: ${currentDate}
          
          - Si el texto menciona una hora (ej: "1930"), interpretarla como "19:30"
          - Si dice "avisar antes", extraer cuánto tiempo antes en el campo notify
          - Si no especifica fecha, asumir que es para hoy
          - El formato de hora debe ser HH:mm (24 horas)
          
          DEBES responder en este formato JSON:
          {
            "title": "título del evento",
            "date": "YYYY-MM-DD",
            "time": "HH:mm",
            "notify": "X minutos/horas antes"
          }`
        },
        {
          role: "user",
          content: text
        }
      ],
      temperature: 0.3
    });

    const parsed = JSON.parse(response.choices[0].message.content);
    return { type: "reminder", data: parsed };
  } catch (err) {
    console.error("Error parseando recordatorio:", err);
    return {
      type: "error",
      content: "No pude entender bien el recordatorio. ¿Podrías reformularlo?"
    };
  }
}

module.exports = { parseReminderWithOpenAI, getGPTResponse };