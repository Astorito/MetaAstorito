const axios = require('axios');
const FormData = require('form-data');

const transcript_audio = async (media_id) => {
    try {
        const token = process.env.WHATSAPP_TOKEN;
        
        // Obtener información del archivo de audio desde Facebook Graph API
        const media = await axios({
            method: "GET",
            url: "https://graph.facebook.com/v17.0/" + media_id,
            headers: {
                Authorization: "Bearer " + token
            }
        });

        console.log("🎵 Información de audio obtenida:", media.data.url ? "URL disponible" : "URL no disponible");

        // Descargar el archivo de audio
        const file = await axios({
            method: "GET",
            url: media.data.url,
            responseType: "arraybuffer",
            headers: {
                Authorization: "Bearer " + token,
            },
        });

        console.log("📥 Audio descargado:", file.data.length, "bytes");
        const buffer = Buffer.from(file.data);

        // Crear objeto FormData para enviar a OpenAI
        let formData = new FormData();
        formData.append("file", buffer, {
            filename: "grabacion.ogg",
            contentType: "audio/ogg",
        });
        formData.append("model", "whisper-1");
        formData.append("language", "es");

        // Enviar a OpenAI para transcripción
        const openai_transcription = await axios({
            method: "post",
            url: "https://api.openai.com/v1/audio/transcriptions",
            headers: {
                Authorization: "Bearer " + process.env.OPENAI_API_KEY,
                ...formData.getHeaders(),
            },
            maxBodyLength: Infinity,
            data: formData,
        });

        console.log("🎤 Audio transcrito exitosamente");
        return openai_transcription.data.text;
    } catch (error) {
        console.error("❌ Error transcribiendo audio:", error.message);
        throw error; // Propagar el error
    }
};

// Procesar mensaje de audio completo
async function handleAudioMessage(audioId, from) {
    try {
        console.log("🔊 Procesando mensaje de audio, ID:", audioId);
        
        // Transcribir el audio
        const transcription = await transcript_audio(audioId);
        
        // No enviamos la transcripción, solo la devolvemos para procesarla como comando
        console.log(`🎙️ Transcripción: "${transcription}"`);
        
        return transcription;
    } catch (error) {
        console.error('❌ Error procesando audio:', error.message);
        return null;
    }
}

module.exports = { handleAudioMessage };
