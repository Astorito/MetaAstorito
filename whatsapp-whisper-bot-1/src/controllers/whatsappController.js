class WhatsappController {
    constructor(audioService, whisperService) {
        this.audioService = audioService;
        this.whisperService = whisperService;
    }

    async handleIncomingMessage(req, res) {
        const { messages } = req.body.entry[0].changes[0].value;

        for (const message of messages) {
            const from = message.from;
            const messageText = message.text?.body;
            const audioUrl = message.audio?.url;

            if (audioUrl) {
                await this.processAudioMessage(audioUrl, from);
            } else if (messageText) {
                await this.sendTextResponse(from, `Recibido: ${messageText}`);
            }
        }

        res.sendStatus(200);
    }

    async processAudioMessage(audioUrl, from) {
        try {
            const audioFile = await this.audioService.downloadAudio(audioUrl);
            const transcription = await this.whisperService.transcribeAudio(audioFile);
            await this.sendTextResponse(from, `Transcripción: ${transcription}`);
        } catch (error) {
            console.error("Error procesando mensaje de audio:", error);
            await this.sendTextResponse(from, "Hubo un error al procesar tu mensaje de audio.");
        }
    }

    async sendTextResponse(to, message) {
        // Implementar lógica para enviar respuesta de texto a través de la API de WhatsApp
    }
}

module.exports = WhatsappController;