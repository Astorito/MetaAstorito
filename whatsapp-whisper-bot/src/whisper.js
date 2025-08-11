// filepath: /whatsapp-whisper-bot/whatsapp-whisper-bot/src/whisper.js
const axios = require('axios');
require('dotenv').config();

const whisperApiUrl = process.env.WHISPER_API_URL;
const whisperApiKey = process.env.WHISPER_API_KEY;

// Función para enviar audio a Whisper y recibir la transcripción
async function transcribeAudio(audioFilePath) {
  try {
    const formData = new FormData();
    formData.append('file', fs.createReadStream(audioFilePath));

    const response = await axios.post(whisperApiUrl, formData, {
      headers: {
        'Authorization': `Bearer ${whisperApiKey}`,
        ...formData.getHeaders(),
      },
    });

    return response.data.transcription;
  } catch (error) {
    console.error('Error transcribiendo audio:', error.response?.data || error.message);
    throw new Error('No se pudo transcribir el audio.');
  }
}

// Exportar funciones
module.exports = {
  transcribeAudio,
};