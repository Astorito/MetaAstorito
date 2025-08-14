const OpenAI = require('openai');
const { openaiToken, model } = require('../config/environment');
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
  // Verificar si parece un recordatorio
  const reminderKeywords = [
    'recordar', 'recordame', 'avisame', 'agenda', 'agendar',
    'mañana', 'hoy', 'siguiente', 'proximo', 'próximo',
    'reunión', 'reunion', 'cita', 'evento'
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
      model: model,
      messages: [
        {
          role: "system",
          content: `Eres un asistente que extrae información de recordatorios en español.
            HOY ES: ${currentDate}
            Analizar este mensaje: "${text}"`
        }
      ],
      temperature: 0.3
    });

    const parsed = JSON.parse(response.choices[0].message.content);
    return { type: "reminder", data: parsed };
  } catch (err) {
    console.error("Error parseando recordatorio:", err);
    return { type: "error", message: "No pude entender el recordatorio" };
  }
}

module.exports = { getGPTResponse, parseReminderWithOpenAI };